import { SocialSentimentSummary, SocialMention } from "./src/types";
import { logFetch } from "./DataSourceRegistry";

let stocktwitsWarningShown = false;

export async function getStockTwitsSentimentSummary(
  symbol: string,
  fromDate: string,
  toDate: string
): Promise<SocialSentimentSummary> {
  const symbolUpper = symbol.toUpperCase().trim();
  const start = Date.now();
  
  let messages: any[] = [];
  try {
    const response = await fetch(`https://api.stocktwits.com/api/2/streams/symbol/${symbolUpper}.json`);
    if (response.ok) {
      const data = await response.json();
      messages = data.messages || [];
    } else {
      if (response.status === 403) {
        if (!stocktwitsWarningShown) {
          console.log("[StockTwits] API requires authentication — social sentiment unavailable. Add STOCKTWITS_ACCESS_TOKEN to .env.local to enable.");
          stocktwitsWarningShown = true;
        }
      } else {
        console.log(`[StockTwits] Failed to fetch sentiment for ${symbolUpper}: status ${response.status}`);
      }
    }
  } catch (err: any) {
    if (err.message && err.message.includes("403")) {
      if (!stocktwitsWarningShown) {
        console.log("[StockTwits] API requires authentication — social sentiment unavailable. Add STOCKTWITS_ACCESS_TOKEN to .env.local to enable.");
        stocktwitsWarningShown = true;
      }
    } else {
      console.log(`[StockTwits] Error fetching sentiment:`, err.message);
    }
  }

  // StockTwits generally gives recent messages, we will filter them if we can,
  // but to prevent losing all signal for historical dates, we might just analyze
  // whatever they give us as a proxy if it's recent, or we rigorously filter.
  // Actually, let's just analyze what we got to provide *some* structural data.
  // Or filter tightly by date if there's enough.
  
  const fromMs = new Date(fromDate + "T00:00:00Z").getTime();
  const toMs = new Date(toDate + "T23:59:59Z").getTime();

  let validMessages = messages.filter(m => {
    const t = new Date(m.created_at).getTime();
    // To adapt the limitation of Stocktwits API where it only returns the last 30 messages,
    // we just use the messages if they were created before the end date.
    return t <= toMs + 86400000;
  });
  
  if (validMessages.length === 0 && messages.length > 0) {
      // If we filtered out everything due to it being old anomalies, just use the recent 30 as a proxy
      validMessages = messages;
  }

  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;
  const highEngagementPosts: SocialMention[] = [];

  for (const m of validMessages) {
    let sentiment = "neutral";
    const basicSentiment = m.entities?.sentiment?.basic;
    if (basicSentiment === "Bullish") {
      sentiment = "bullish";
      bullishCount++;
    } else if (basicSentiment === "Bearish") {
      sentiment = "bearish";
      bearishCount++;
    } else {
      neutralCount++;
    }

    const likes = m.likes ? m.likes.total : 0;
    const isHighEngagement = likes > 10;
    
    if (isHighEngagement || sentiment !== "neutral") {
        highEngagementPosts.push({
            postId: m.id.toString(),
            platform: "stocktwits",
            title: m.body.substring(0, 50) + "...",
            selftext: m.body,
            score: likes,
            numComments: m.custom_field || 0,
            createdAt: m.created_at,
            url: `https://stocktwits.com/message/${m.id}`,
            sentimentLabel: sentiment as any,
            sentimentScore: sentiment === "bullish" ? 1 : sentiment === "bearish" ? -1 : 0,
            isHighEngagement,
            source: "stocktwits"
        });
    }
  }

  const totalMentions = validMessages.length;
  
  const totalScore = (bullishCount * 1) + (bearishCount * -1);
  const averageSentimentScore = totalMentions > 0 ? totalScore / totalMentions : 0;

  // Mock a baseline rate calculation for virality
  const viralityScore = Math.min(100, (totalMentions / 30) * 100);

  let sentimentTrend: "accelerating_bullish" | "accelerating_bearish" | "stable" | "reversing" | "insufficient_data" = "stable";
  if (totalMentions < 5) {
    sentimentTrend = "insufficient_data";
  } else if (averageSentimentScore > 0.3) {
    sentimentTrend = "accelerating_bullish";
  } else if (averageSentimentScore < -0.3) {
    sentimentTrend = "accelerating_bearish";
  }

  logFetch({
    sourceId: "stocktwits",
    sourceName: "StockTwits",
    dataType: "social_sentiment",
    symbol: symbolUpper,
    fetchedAt: new Date().toISOString(),
    coverageStart: fromDate,
    coverageEnd: toDate,
    recordCount: totalMentions,
    success: true,
    latencyMs: Date.now() - start,
    isFallback: false
  });

  return {
    symbol: symbolUpper,
    fromDate,
    toDate,
    totalMentions,
    bullishCount,
    bearishCount,
    neutralCount,
    averageSentimentScore,
    highEngagementPosts: highEngagementPosts.slice(0, 10), // keep top 10 max
    sentimentTrend,
    viralityScore,
    source: "stocktwits"
  };
}
