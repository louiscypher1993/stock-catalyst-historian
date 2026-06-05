import crypto from 'crypto';
import { SocialMention, SocialSentimentSummary } from "./src/types";
import { logFetch } from "./DataSourceRegistry";
import { getSocialMentionsForAnomaly, saveSocialMentions, getRedditBaselineCount } from "./db";

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const userAgent = process.env.REDDIT_USER_AGENT || "scrapesentiment/0.1 by lewispiper1993";

  if (!clientId || !clientSecret) {
    throw new Error("Missing REDDIT_CLIENT_ID or REDDIT_CLIENT_SECRET");
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent
    },
    body: "grant_type=client_credentials"
  });

  if (!response.ok) {
    console.warn(`[RedditSentimentService] Failed to fetch Reddit access token: status ${response.status}`);
    return "";
  }

  const data = await response.json();
  if (!data.access_token) {
    console.warn("[RedditSentimentService] Reddit access token response is missing access_token");
    return "";
  }

  cachedToken = data.access_token;
  // Expire 10 seconds early to prevent edge latency issues
  const expiresInMs = (data.expires_in || 3600) * 1000 - 10000;
  tokenExpiresAt = Date.now() + expiresInMs;

  return cachedToken;
}

export async function searchSubredditMentions(
  symbol: string,
  companyName: string,
  fromDate: string,
  toDate: string,
  subreddits: string[] = ["wallstreetbets", "investing", "stocks", "stockmarket", "options", "SecurityAnalysis"]
): Promise<SocialMention[]> {
  const start = Date.now();
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.warn("[RedditSentimentService] REDDIT_CLIENT_ID or REDDIT_CLIENT_SECRET missing");
    return [];
  }

  const userAgent = process.env.REDDIT_USER_AGENT || "scrapesentiment/0.1 by lewispiper1993";

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err: any) {
    console.error(`[RedditSentimentService] Failed to get OAuth token: ${err.message}`);
    return [];
  }

  const symbolUpper = symbol.toUpperCase().trim();
  const query = `${symbolUpper} OR "${companyName}"`;
  const allMentions: SocialMention[] = [];

  for (const subreddit of subreddits) {
    const url = `https://oauth.reddit.com/r/${subreddit}/search?q=${encodeURIComponent(query)}&sort=top&t=all&limit=25&restrict_sr=true`;
    try {
      const response = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "User-Agent": userAgent
        }
      });

      if (!response.ok) {
        if (response.status === 429) {
          console.warn(`[RedditSentimentService] Rate limit hit on r/${subreddit}`);
          // Reddit does not use markSourceRateLimited for now, but following the rule:
        }
        console.warn(`[RedditSentimentService] Failed to query r/${subreddit}: status ${response.status}`);
        continue;
      }

      const listing = await response.json();
      if (!listing.data || !listing.data.children) {
        continue;
      }

      for (const child of listing.data.children) {
        const post = child.data;
        if (!post) continue;

        // Date filter - Reddit utc timestamp is in seconds
        const createdAtISO = new Date(post.created_utc * 1000).toISOString();
        const postDateStr = createdAtISO.split('T')[0];

        if (postDateStr < fromDate || postDateStr > toDate) {
          continue;
        }

        // Sentiment Classification
        const title = post.title || "";
        const selftext = post.selftext || "";
        const combinedText = `${title} ${selftext}`.toLowerCase();

        const bullishKeywords = ["moon", "bull", "calls", "long", "buy", "undervalued", "breakout", "yolo", "squeeze", "rocket", "green", "gains", "+", "beat"];
        const bearishKeywords = ["puts", "short", "overvalued", "crash", "dump", "sell", "red", "loss", "bear", "bubble", "down", "-", "miss"];

        let bullishCount = 0;
        let bearishCount = 0;

        for (const keyword of bullishKeywords) {
          let pos = combinedText.indexOf(keyword);
          while (pos !== -1) {
            bullishCount++;
            pos = combinedText.indexOf(keyword, pos + keyword.length);
          }
        }

        for (const keyword of bearishKeywords) {
          let pos = combinedText.indexOf(keyword);
          while (pos !== -1) {
            bearishCount++;
            pos = combinedText.indexOf(keyword, pos + keyword.length);
          }
        }

        const scoreDenom = bullishCount + bearishCount + 1;
        const sentimentScore = (bullishCount - bearishCount) / scoreDenom;
        const sentimentLabel = sentimentScore > 0.1 ? "bullish" : sentimentScore < -0.1 ? "bearish" : "neutral";

        const upvotes = post.score || 0;
        const comments = post.num_comments || 0;
        const isHighEngagement = upvotes > 500 || comments > 100;

        allMentions.push({
          postId: post.id || "",
          platform: subreddit,
          title,
          selftext: selftext || undefined,
          score: upvotes,
          numComments: comments,
          createdAt: createdAtISO,
          url: post.url || `https://www.reddit.com${post.permalink || ""}`,
          flairText: post.link_flair_text || undefined,
          sentimentLabel,
          sentimentScore,
          isHighEngagement,
          source: "reddit"
        });
      }
    } catch (err: any) {
      console.error(`[RedditSentimentService] Error searching r/${subreddit}:`, err);
    }
  }

  // Deduplicate mentions map
  const uniqueMentionsMap = new Map<string, SocialMention>();
  for (const m of allMentions) {
    uniqueMentionsMap.set(m.postId, m);
  }
  const uniqueMentions = Array.from(uniqueMentionsMap.values());

  // Store in SQLite and log fetches
  if (uniqueMentions.length > 0) {
    try {
      saveSocialMentions(uniqueMentions, symbolUpper, fromDate);
    } catch (err) {
      console.error("[RedditSentimentService] Failed to save reddit_mentions into SQLite cache:", err);
    }
  }

  logFetch({
    sourceId: "reddit",
    sourceName: "Reddit API",
    dataType: "reddit_sentiment",
    symbol: symbolUpper,
    fetchedAt: new Date().toISOString(),
    coverageStart: fromDate,
    coverageEnd: toDate,
    recordCount: uniqueMentions.length,
    success: true,
    latencyMs: Date.now() - start,
    isFallback: false
  });

  return uniqueMentions;
}

export async function getSocialSentimentSummary(
  symbol: string,
  fromDate: string,
  toDate: string
): Promise<SocialSentimentSummary> {
  const symbolUpper = symbol.toUpperCase().trim();

  // Try retrieving cached mentions first!
  let mentions = getSocialMentionsForAnomaly(symbolUpper, fromDate);
  if (mentions.length === 0) {
    mentions = await searchSubredditMentions(symbolUpper, symbolUpper, fromDate, toDate);
  }

  const totalMentions = mentions.length;
  const bullishCount = mentions.filter(m => m.sentimentLabel === "bullish").length;
  const bearishCount = mentions.filter(m => m.sentimentLabel === "bearish").length;
  const neutralCount = mentions.filter(m => m.sentimentLabel === "neutral" || m.sentimentLabel === "ambiguous").length;

  const totalScore = mentions.reduce((sum, m) => sum + m.sentimentScore, 0);
  const averageSentimentScore = totalMentions > 0 ? totalScore / totalMentions : 0;

  const highEngagementPosts = mentions.filter(m => m.isHighEngagement);

  const startMs = new Date(fromDate + "T00:00:00Z").getTime();
  const endMs = new Date(toDate + "T23:59:59Z").getTime();
  const durationDays = Math.max(1, Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24)));

  const activeRate = totalMentions / durationDays;
  const baselineCount = getRedditBaselineCount(symbolUpper, fromDate);
  const baselineRate = Math.max(1 / 30, baselineCount / 30);

  const ratio = activeRate / baselineRate;
  let viralityScore = 0;
  if (ratio > 1) {
    viralityScore = Math.min(100, Math.max(0, ((ratio - 1) / (10 - 1)) * 100));
  }

  let sentimentTrend: "accelerating_bullish" | "accelerating_bearish" | "stable" | "reversing" | "insufficient_data";
  if (totalMentions < 5) {
    sentimentTrend = "insufficient_data";
  } else {
    const midMs = startMs + (endMs - startMs) / 2;
    const firstHalfScores = mentions.filter(m => new Date(m.createdAt).getTime() < midMs).map(m => m.sentimentScore);
    const secondHalfScores = mentions.filter(m => new Date(m.createdAt).getTime() >= midMs).map(m => m.sentimentScore);

    const avgFirst = firstHalfScores.length > 0 ? (firstHalfScores.reduce((sum, v) => sum + v, 0) / firstHalfScores.length) : 0;
    const avgSecond = secondHalfScores.length > 0 ? (secondHalfScores.reduce((sum, v) => sum + v, 0) / secondHalfScores.length) : 0;

    const diff = avgSecond - avgFirst;

    if (diff > 0.1) {
      sentimentTrend = "accelerating_bullish";
    } else if (diff < -0.1) {
      sentimentTrend = "accelerating_bearish";
    } else if ((avgFirst > 0 && avgSecond < 0) || (avgFirst < 0 && avgSecond > 0)) {
      sentimentTrend = "reversing";
    } else {
      sentimentTrend = "stable";
    }
  }

  return {
    symbol: symbolUpper,
    fromDate,
    toDate,
    totalMentions,
    bullishCount,
    bearishCount,
    neutralCount,
    averageSentimentScore,
    highEngagementPosts,
    sentimentTrend,
    viralityScore,
    source: "reddit"
  };
}
