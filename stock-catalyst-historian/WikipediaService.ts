import { logFetch } from "./DataSourceRegistry";
import { WikipediaTrafficSignal } from "./src/types";

export async function detectWikipediaSpike(
  query: string,
  anomalyDateStr: string
): Promise<WikipediaTrafficSignal | null> {
  const start = Date.now();
  
  try {
    // 1. Find the Wikipedia article title using OpenSearch
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&format=json`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    
    if (!searchData[1] || searchData[1].length === 0) return null;
    const articleTitle = searchData[1][0].replace(/ /g, '_');
    
    // 2. Determine dates: 30 days before anomaly for baseline, and 3 days before anomaly for the spike window.
    // Wikipedia API wants YYYYMMDD00 format
    const anomalyTime = new Date(anomalyDateStr + "T00:00:00Z").getTime();
    
    const baselineStartTime = anomalyTime - (33 * 24 * 60 * 60 * 1000);
    const spikeStartTime = anomalyTime - (3 * 24 * 60 * 60 * 1000);
    
    const formatDate = (dateMs: number) => {
      const d = new Date(dateMs);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${yyyy}${mm}${dd}00`;
    };
    
    const startStr = formatDate(baselineStartTime);
    const endStr = formatDate(anomalyTime);
    
    // 3. Fetch Pageviews
    const pvUrl = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${encodeURIComponent(articleTitle)}/daily/${startStr}/${endStr}`;
    const pvRes = await fetch(pvUrl, {
      headers: { "User-Agent": "HistoricalAnomalyEngine/1.0 (contact: admin@example.com)" }
    });
    
    if (!pvRes.ok) return null;
    const pvData = await pvRes.json();
    if (!pvData.items) return null;
    
    let baselineTotal = 0;
    let baselineCount = 0;
    let spikeTotal = 0;
    let spikeCount = 0;
    
    for (const item of pvData.items) {
      // item.timestamp is YYYYMMDD00
      const year = parseInt(item.timestamp.substring(0, 4));
      const month = parseInt(item.timestamp.substring(4, 6)) - 1;
      const day = parseInt(item.timestamp.substring(6, 8));
      const itemTime = Date.UTC(year, month, day);
      
      if (itemTime >= baselineStartTime && itemTime < spikeStartTime) {
        baselineTotal += item.views;
        baselineCount++;
      } else if (itemTime >= spikeStartTime && itemTime < anomalyTime) {
        spikeTotal += item.views;
        spikeCount++;
      }
    }
    
    const baselineViewsAvg = baselineCount > 0 ? baselineTotal / baselineCount : 0;
    const spikeViewsAvg = spikeCount > 0 ? spikeTotal / spikeCount : 0;
    
    // We consider it a spike if views in the 3 days before are > 2x the 30-day average and minimum volume is hit.
    // e.g. at least 50 views avg to avoid low-volume noise.
    const spikeRatio = baselineViewsAvg > 0 ? spikeViewsAvg / baselineViewsAvg : 0;
    const isSpike = spikeRatio >= 2.0 && spikeViewsAvg >= 50;

    logFetch({
      sourceId: "wikipedia",
      sourceName: "Wikipedia API",
      dataType: "pageviews",
      symbol: query,
      fetchedAt: new Date().toISOString(),
      coverageStart: startStr,
      coverageEnd: endStr,
      recordCount: pvData.items.length,
      success: true,
      latencyMs: Date.now() - start,
      isFallback: false
    });

    return {
      articleTitle,
      queryTopic: query,
      baselineViewsAvg,
      spikeViewsAvg,
      anomalyDate: anomalyDateStr,
      isSpike,
      spikeRatio
    };

  } catch (err) {
    console.error("[WikipediaService] Failed to fetch page views:", err);
    return null;
  }
}
