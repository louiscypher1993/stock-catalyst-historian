import crypto from 'crypto';
import { NewsArticle } from "./src/types";
import { logFetch, markSourceRateLimited, isSourceRateLimited } from "./DataSourceRegistry";

function generateArticleId(url: string, publishedAt: string): string {
  return crypto.createHash('md5').update(`${url}_${publishedAt}`).digest('hex');
}

export async function searchNewsForStock(
  symbol: string,
  companyName: string,
  fromDate: string,
  toDate: string,
  maxArticles: number = 20
): Promise<NewsArticle[]> {
  const start = Date.now();
  
  if (isSourceRateLimited('newsapi')) {
    console.warn('[newsapi] Skipping fetch due to rate limit being hit previously.');
    return [];
  }
  
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) {
    console.warn("[NewsAPIService] NEWSAPI_KEY environment variable is missing.");
    return [];
  }

  const query = `${symbol} OR "${companyName}"`;
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&from=${fromDate}&to=${toDate}&language=en&sortBy=relevancy&pageSize=${maxArticles}&apiKey=${apiKey}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 429 || response.status === 403) {
        markSourceRateLimited('newsapi');
        return [];
      }
      if (response.status === 426) {
        console.warn(`[NewsAPIService] 426 Free Tier limitation: Historical news is only available for the last 30 days.`);
        logFetch({
          sourceId: "newsapi",
          sourceName: "NewsAPI",
          dataType: "news_articles",
          symbol,
          fetchedAt: new Date().toISOString(),
          coverageStart: fromDate,
          coverageEnd: toDate,
          success: false,
          errorMessage: "NewsAPI 426: Free tier historical limitation",
          isFallback: false
        });
        return [];
      } else if (response.status === 429) {
        markSourceRateLimited('newsapi');
        return [];
      } else if (response.status === 403) {
        console.warn(`[NewsAPIService] 403 forbidden`);
        return [];
      }
      console.warn(`[NewsAPIService] request failed with status ${response.status}`);
      return [];
    }

    const data = await response.json();
    if (data.status === "error") {
      if (data.code === "parameterOutOfRange" || response.status === 426) {
        console.warn(`[NewsAPIService] NewsAPI error: ${data.message}`);
        logFetch({
          sourceId: "newsapi",
          sourceName: "NewsAPI",
          dataType: "news_articles",
          symbol,
          fetchedAt: new Date().toISOString(),
          coverageStart: fromDate,
          coverageEnd: toDate,
          success: false,
          errorMessage: data.message || "NewsAPI 426: Parameter out of range",
          isFallback: false
        });
        return [];
      } else if (data.code === "rateLimited") {
        markSourceRateLimited('newsapi');
        return [];
      }
      console.warn(`[NewsAPIService] error: ${data.message}`);
      return [];
    }

    const articles: NewsArticle[] = (data.articles || []).map((art: any) => {
      const publishedAt = art.publishedAt || new Date().toISOString();
      const articleUrl = art.url || "";
      const content = art.content ? art.content.substring(0, 200) : undefined;
      return {
        id: generateArticleId(articleUrl, publishedAt),
        publishedAt,
        title: art.title || "",
        description: art.description || undefined,
        content,
        url: articleUrl,
        sourceName: art.source?.name || "Unknown Source",
        sourceId: art.source?.id || undefined,
        author: art.author || undefined,
        dataSource: "newsapi"
      };
    });

    logFetch({
      sourceId: "newsapi",
      sourceName: "NewsAPI",
      dataType: "news_articles",
      symbol,
      fetchedAt: new Date().toISOString(),
      coverageStart: fromDate,
      coverageEnd: toDate,
      recordCount: articles.length,
      success: true,
      latencyMs: Date.now() - start,
      isFallback: false
    });

    return articles;
  } catch (error: any) {
    console.error("[NewsAPIService] Error querying NewsAPI:", error);
    logFetch({
      sourceId: "newsapi",
      sourceName: "NewsAPI",
      dataType: "news_articles",
      symbol,
      fetchedAt: new Date().toISOString(),
      coverageStart: fromDate,
      coverageEnd: toDate,
      success: false,
      errorMessage: error.message || String(error),
      isFallback: false
    });
    return [];
  }
}

export async function rankArticlesByRelevance(
  articles: NewsArticle[],
  symbol: string,
  anomalyDate: string,
  anomalyReturn: number
): Promise<NewsArticle[]> {
  const highCredSources = [
    "reuters",
    "bloomberg",
    "associated press",
    "financial times",
    "wall street journal",
    "cnbc",
    "marketwatch",
    "barron's",
    "barrons",
    "sec news digest"
  ];

  const anomalyTime = new Date(anomalyDate).getTime();

  const ranked = articles.map((article) => {
    let points = 0;
    
    // Time difference scoring
    if (article.publishedAt) {
      const articleTime = new Date(article.publishedAt).getTime();
      const diffMs = Math.abs(articleTime - anomalyTime);
      const diffHours = diffMs / (1000 * 60 * 60);

      if (diffHours <= 24) {
        points += 3;
      } else if (diffHours <= 48) {
        points += 2;
      }
    }

    // Symbol in title scoring
    const titleLower = (article.title || "").toLowerCase();
    const symbolLower = symbol.toLowerCase();
    if (titleLower.includes(symbolLower)) {
      points += 1;
    }

    // High credibility source scoring
    const sourceNameLower = (article.sourceName || "").toLowerCase();
    const isHighCred = highCredSources.some(src => sourceNameLower.includes(src));
    if (isHighCred) {
      points += 2;
    }

    // Sentiment logic
    const positiveKeywords = ["beat", "surge", "jump", "raised guidance", "approved", "wins", "deal", "soar", "gain", "up", "rally", "growth", "strong", "beats", "raises"];
    const negativeKeywords = ["miss", "drop", "fall", "investigation", "recall", "downgrade", "cuts", "plunge", "tumble", "down", "weak", "misses", "lowers", "slips", "lawsuit"];
    
    let sentiment: "positive" | "negative" | "neutral" = "neutral";
    let positiveHits = 0;
    let negativeHits = 0;
    
    const combinedText = ((article.title || "") + " " + (article.description || "")).toLowerCase();
    
    positiveKeywords.forEach(kw => {
      if (combinedText.includes(kw)) positiveHits++;
    });
    
    negativeKeywords.forEach(kw => {
      if (combinedText.includes(kw)) negativeHits++;
    });
    
    if (positiveHits > negativeHits && positiveHits > 0) {
      sentiment = "positive";
    } else if (negativeHits > positiveHits && negativeHits > 0) {
      sentiment = "negative";
    }
    
    // Direction keyword matching in title for scoring
    if (anomalyReturn > 0) {
      if (sentiment === "positive") {
        points += 1;
      }
    } else if (anomalyReturn < 0) {
      if (sentiment === "negative") {
        points += 1;
      }
    }

    const relevanceScore = points / 9;
    return {
      ...article,
      relevanceScore,
      sentiment
    };
  });

  return ranked.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
}
