import { YoutubeTranscript } from 'youtube-transcript';
import { YouTubeVideo } from './src/types';
import { logFetch, isSourceRateLimited, markSourceRateLimited } from './DataSourceRegistry';

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
  
  // Format dates to RFC 3339 string (e.g. 1970-01-01T00:00:00Z)
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
        markSourceRateLimited('youtube', 600000); // 10 minutes
      } else {
        console.warn(`[YouTube] Fetch returned HTTP ${res.status}. Marking rate-limited.`);
        markSourceRateLimited('youtube', 60000); // 1 minute
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
        const transcriptLines = await YoutubeTranscript.fetchTranscript(videoId);
        transcriptText = transcriptLines.map((t) => t.text).join(' ');
        // Optionally chunk the transcript if it's too huge, but usually Gemini flash can chunk it
        // Or limit to first 15,000 characters to prevent prompt blowups
        if (transcriptText.length > 20000) {
            transcriptText = transcriptText.substring(0, 20000) + '... [TRUNCATED]';
        }
      } catch (transcriptErr: any) {
        console.warn(`[YouTube] Could not fetch transcript for ${videoId}: ${transcriptErr.message}`);
        transcriptText = "[No auto-generated transcript available]";
      }

      videos.push({
        videoId,
        title,
        publishedAt,
        channelTitle,
        transcript: transcriptText
      });
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
