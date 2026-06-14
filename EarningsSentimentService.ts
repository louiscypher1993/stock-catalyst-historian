import { GoogleGenAI, Type, Schema } from "@google/genai";
import { getRecentFilings } from "./EdgarService";

// SEC fair-access policy requires a descriptive User-Agent identifying the requester
const EDGAR_USER_AGENT = "MarketEcosystemIntelligence lewispiper1993@gmail.com";

export async function scoreManagementConfidence(transcriptText: string): Promise<{ confidence_score: number, primary_concern: string } | null> {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const responseSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        confidence_score: {
          type: Type.INTEGER,
          description: "A hard integer from 1-100 representing the management confidence score based on the Q&A segment. 1 is extremely panicked/defensive, 100 is highly confident/optimistic."
        },
        primary_concern: {
          type: Type.STRING,
          description: "The primary concern or theme of the Q&A segment, or 'None' if heavily confident."
        }
      },
      required: ["confidence_score", "primary_concern"]
    };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `You are an NLP Machine Learning AI designed to score management confidence from earnings call transcripts.
Task:
1. Isolate the Q&A portion of this transcript. If no Q&A is present, evaluate the forward outlook section.
2. Evaluate executive hesitation, defensive language, or confident forward outlooks.
3. Return a management confidence score (1-100) and the primary concern (or 'None' if completely confident).

Transcript:
${transcriptText.substring(0, 80000)}` // Safeguard transcript length
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        temperature: 0.1,
      }
    });

    if (response.text) {
      const parsed = JSON.parse(response.text);
      return {
        confidence_score: parsed.confidence_score,
        primary_concern: parsed.primary_concern
      };
    }
    return null;
  } catch (error) {
    console.error("[EarningsSentimentService] Error scoring management confidence:", error);
    return null;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// SOURCE A — Seeking Alpha transcript scrape. Seeking Alpha frequently blocks
// non-browser requests, so any failure here is expected and non-fatal.
async function fetchSeekingAlphaTranscript(symbol: string, eventDate: string): Promise<string | null> {
  try {
    const listUrl = `https://seekingalpha.com/symbol/${symbol}/earnings/transcripts`;
    const listRes = await fetch(listUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
    });
    if (!listRes.ok) return null;
    const listHtml = await listRes.text();

    const linkMatches = [...listHtml.matchAll(/href="(\/article\/[^"]*earnings-call-transcript[^"]*)"/gi)];
    if (linkMatches.length === 0) return null;

    // Pick the transcript link whose embedded date is closest to eventDate
    const targetTime = new Date(eventDate).getTime();
    let bestUrl = linkMatches[0][1];
    let bestDiff = Infinity;
    for (const m of linkMatches) {
      const href = m[1];
      const dateMatch = href.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!dateMatch) continue;
      const diff = Math.abs(new Date(dateMatch[0]).getTime() - targetTime);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestUrl = href;
      }
    }

    const transcriptUrl = bestUrl.startsWith('http') ? bestUrl : `https://seekingalpha.com${bestUrl}`;
    const transcriptRes = await fetch(transcriptUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }
    });
    if (!transcriptRes.ok) return null;

    const text = stripHtml(await transcriptRes.text());
    return text.length > 200 ? text.substring(0, 3000) : null;
  } catch {
    return null;
  }
}

// SOURCE B — EDGAR 8-K "Results of Operations" (Item 2.02) filed shortly
// before the event date. US-listed symbols only.
async function fetchEdgar8KTranscript(symbol: string, eventDate: string): Promise<string | null> {
  try {
    const toDate = eventDate;
    const fromDateObj = new Date(eventDate);
    fromDateObj.setUTCDate(fromDateObj.getUTCDate() - 7);
    const fromDate = fromDateObj.toISOString().split('T')[0];

    const filings = await getRecentFilings(symbol, fromDate, toDate, ['8-K']);
    const match = filings.find(f =>
      f.description?.includes('2.02') || /results of operations/i.test(f.description ?? '')
    );
    if (!match) return null;

    const docRes = await fetch(match.filingUrl, { headers: { 'User-Agent': EDGAR_USER_AGENT } });
    if (!docRes.ok) return null;

    const text = stripHtml(await docRes.text());
    return text.length > 200 ? text.substring(0, 3000) : null;
  } catch {
    return null;
  }
}

// SOURCE C — Gemini grounding fallback: ask Gemini to summarize management
// sentiment from its own knowledge when no transcript text is available.
async function fetchGeminiGroundingSummary(symbol: string, eventDate: string): Promise<string | null> {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const prompt = `You are analysing management sentiment for ${symbol} around ${eventDate}. Based on your knowledge of this company's earnings calls and management communications around this date, provide a brief assessment of management confidence, tone, and key concerns. If you have no specific knowledge of this date, say so clearly. Keep response under 200 words.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ]
    });

    return response.text ?? null;
  } catch (error) {
    console.error("[EarningsSentimentService] Gemini grounding fallback error:", error);
    return null;
  }
}

/**
 * Tries alternative transcript/sentiment sources in order: Seeking Alpha scrape,
 * EDGAR 8-K Item 2.02 (US-listed only, gated by passing a non-null `exchange`),
 * then Gemini grounding from its own knowledge. Returns the first non-null result.
 */
export async function getTranscriptFromAlternativeSources(
  symbol: string,
  eventDate: string,
  exchange: string | null
): Promise<string | null> {
  const seekingAlpha = await fetchSeekingAlphaTranscript(symbol, eventDate);
  if (seekingAlpha) return seekingAlpha;

  if (exchange) {
    const edgar = await fetchEdgar8KTranscript(symbol, eventDate);
    if (edgar) return edgar;
  }

  if (!process.env.GEMINI_API_KEY) return null;
  return await fetchGeminiGroundingSummary(symbol, eventDate);
}
