/*
 * SYSTEM REQUIREMENTS for Whisper fallback transcription:
 *   1. yt-dlp  (downloads audio from YouTube):
 *        Windows : winget install yt-dlp.yt-dlp   OR   pip install yt-dlp
 *        macOS   : brew install yt-dlp             OR   pip install yt-dlp
 *        Linux   : apt install yt-dlp              OR   pip install yt-dlp
 *      yt-dlp must be on PATH so spawn('yt-dlp', ...) can find it.
 *   2. whisper.cpp model (used by nodejs-whisper, already in package.json):
 *        nodejs-whisper auto-downloads the 'base.en' model (~75 MB) on first use.
 *        It also requires a C++ build toolchain; run  npx nodejs-whisper download
 *        after npm install to pre-compile whisper.cpp and pre-fetch the model.
 */

import { YoutubeTranscript } from 'youtube-transcript';
import { YouTubeVideo } from './src/types';
import { logFetch, isSourceRateLimited, markSourceRateLimited } from './DataSourceRegistry';
import { getCachedYouTubeTranscript, setCachedYouTubeTranscript } from './db';
import { nodewhisper } from 'nodejs-whisper';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';

async function getTranscriptViaWhisper(videoId: string): Promise<string | null> {
  // Always check permanent SQLite cache first — transcripts never change
  const cached = getCachedYouTubeTranscript(videoId);
  if (cached !== null) {
    console.log(`[YouTube/Whisper] Serving cached transcript for ${videoId}`);
    return cached;
  }

  const tmpDir = os.tmpdir();
  // yt-dlp replaces %(ext)s with the final extension after conversion (wav)
  const audioTemplate = path.join(tmpDir, `yt-whisper-${videoId}.%(ext)s`);
  const audioPath = path.join(tmpDir, `yt-whisper-${videoId}.wav`);

  try {
    // Download audio-only as WAV using the yt-dlp system binary
    console.log(`[YouTube/Whisper] Downloading audio for ${videoId} via yt-dlp...`);
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('yt-dlp', [
        '-x', '--audio-format', 'wav', '--audio-quality', '0',
        '--no-playlist',
        '-o', audioTemplate,
        '--', `https://www.youtube.com/watch?v=${videoId}`,
      ]);
      proc.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`yt-dlp exited with code ${code}`))
      );
      proc.on('error', reject);
    });

    // Transcribe locally with Whisper base.en (no API key, works offline)
    console.log(`[YouTube/Whisper] Transcribing ${videoId} with Whisper base.en...`);
    const text = await nodewhisper(audioPath, {
      modelName: 'base.en',
      autoDownloadModelName: 'base.en',
      removeWavFileAfterTranscription: true,
      whisperOptions: { outputInText: true },
    });

    const trimmed = (text || '').trim();
    if (trimmed) {
      // Cache permanently — a video's transcript never changes
      setCachedYouTubeTranscript(videoId, trimmed);
      console.log(`[YouTube/Whisper] Transcript cached permanently for ${videoId}`);
    }
    return trimmed || null;
  } catch (err: any) {
    console.warn(`[YouTube/Whisper] Failed for ${videoId}: ${err.message}`);
    return null;
  } finally {
    // Belt-and-suspenders: remove temp audio if removeWavFileAfterTranscription didn't fire
    try {
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    } catch (_) {}
  }
}

export async function fetchYouTubeTranscripts(
  query: string,
  symbol: string,
  startDateStr: string,
  endDateStr: string
): Promise<YouTubeVideo[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn('[YouTube] apiKey not configured.');
    return [];
  }

  if (isSourceRateLimited('youtube')) {
    console.warn('[YouTube] Skipping fetch due to rate limit being hit previously.');
    return [];
  }

  const start = Date.now();

  const startDate = new Date(startDateStr);
  const publishedAfter = startDate.toISOString();

  const endDate = new Date(endDateStr);
  const publishedBefore = endDate.toISOString();

  const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&publishedAfter=${publishedAfter}&publishedBefore=${publishedBefore}&maxResults=2&order=relevance&key=${apiKey}`;

  try {
    const res = await fetch(searchUrl);
    if (!res.ok) {
      if (res.status === 403) {
        console.warn(`[YouTube] Quota exceeded, forbidden, or invalid credentials. Marking rate-limited.`);
        markSourceRateLimited('youtube', 600000);
      } else {
        console.warn(`[YouTube] Fetch returned HTTP ${res.status}. Marking rate-limited.`);
        markSourceRateLimited('youtube', 60000);
      }
      logFetch({
        sourceId: "youtube",
        sourceName: "YouTube Data API v3",
        dataType: "transcripts",
        symbol: symbol.toUpperCase(),
        fetchedAt: new Date().toISOString(),
        coverageStart: startDateStr,
        coverageEnd: endDateStr,
        recordCount: 0,
        success: false,
        latencyMs: Date.now() - start,
        isFallback: true
      });
      return [];
    }

    const data = await res.json();
    const items = data.items || [];

    const videos: YouTubeVideo[] = [];

    for (const item of items) {
      const videoId = item.id?.videoId;
      if (!videoId) continue;

      const snippet = item.snippet || {};
      const title = snippet.title || "";
      const publishedAt = snippet.publishedAt || "";
      const channelTitle = snippet.channelTitle || "";

      let transcriptText = "";

      try {
        // Fast path: YouTube auto-captions (instant when available)
        const transcriptLines = await YoutubeTranscript.fetchTranscript(videoId);
        transcriptText = transcriptLines.map((t) => t.text).join(' ');
        if (transcriptText.length > 20000) {
          transcriptText = transcriptText.substring(0, 20000) + '... [TRUNCATED]';
        }
        console.log(`[YouTube] Caption transcript fetched for ${videoId}`);
      } catch (_captionErr) {
        // Captions disabled — fall back to local Whisper transcription
        console.log(`[YouTube] Captions unavailable for ${videoId}, falling back to Whisper...`);
        const whisperText = await getTranscriptViaWhisper(videoId);
        if (whisperText) {
          transcriptText = whisperText.length > 20000
            ? whisperText.substring(0, 20000) + '... [TRUNCATED]'
            : whisperText;
          console.log(`[YouTube] Whisper transcript obtained for ${videoId}`);
        } else {
          transcriptText = "[No transcript available]";
          console.warn(`[YouTube] Both caption and Whisper paths failed for ${videoId}`);
        }
      }

      videos.push({ videoId, title, publishedAt, channelTitle, transcript: transcriptText });
    }

    logFetch({
      sourceId: "youtube",
      sourceName: "YouTube Data API v3",
      dataType: "transcripts",
      symbol: symbol.toUpperCase(),
      fetchedAt: new Date().toISOString(),
      coverageStart: startDateStr,
      coverageEnd: endDateStr,
      recordCount: videos.length,
      success: true,
      latencyMs: Date.now() - start,
      isFallback: false
    });

    return videos;
  } catch (err) {
    console.error("[YouTube] Connection or parsing failed:", err);
    logFetch({
      sourceId: "youtube",
      sourceName: "YouTube Data API v3",
      dataType: "transcripts",
      symbol: symbol.toUpperCase(),
      fetchedAt: new Date().toISOString(),
      coverageStart: startDateStr,
      coverageEnd: endDateStr,
      recordCount: 0,
      success: false,
      latencyMs: Date.now() - start,
      isFallback: false
    });
    return [];
  }
}
