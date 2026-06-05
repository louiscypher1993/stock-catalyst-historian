import { GoogleGenAI } from "@google/genai";
import { StockProfile, EventFeatureVector } from "./src/types";
import { getAllEventFeatures } from "./db";

let aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing. Configure it in the Settings > Secrets panel.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

export async function generateStockProfile(symbol: string): Promise<StockProfile> {
  const allEvents = getAllEventFeatures();
  const sysEvents = allEvents.filter(e => e.symbol === symbol && e.return_1d !== null && e.return_1d !== undefined);
  
  if (sysEvents.length < 3) {
    throw new Error(`Insufficient data to generate a profile for ${symbol}. Found ${sysEvents.length} analysed anomalies, need at least 3.`);
  }

  const categoryCounts: Record<string, number> = {};
  const subTypeCounts: Record<string, number> = {};
  
  let valid1m = 0;
  let sum1m = 0;
  let valid6m = 0;
  let sum6m = 0;
  
  let reversionCount = 0;
  let macroSectorCount = 0;
  
  let sumStatConf = 0;
  let countStatConf = 0;
  
  let sumCausalConf = 0;
  let countCausalConf = 0;

  let highestSeverityEvent: { date: string, catalyst: string, return1y: number | null } | null = null;
  let maxAbsZScore = -1;

  for (const ev of sysEvents) {
    if (ev.primaryCategory) {
      categoryCounts[ev.primaryCategory] = (categoryCounts[ev.primaryCategory] || 0) + 1;
      if (ev.primaryCategory === "macro" || ev.primaryCategory === "market_structure") {
        macroSectorCount++;
      }
    }
    if (ev.primarySubType) {
      const st = ev.primarySubType;
      subTypeCounts[st] = (subTypeCounts[st] || 0) + 1;
    }

    if (ev.return_1m !== null) {
      valid1m++;
      sum1m += ev.return_1m;
      // Mean reversion: if initial move (zScore) sign is opposite to 1m return
      if (ev.zScore && ev.zScore !== 0 && Math.sign(ev.return_1m) !== Math.sign(ev.zScore)) {
        reversionCount++;
      }
    }

    if (ev.return_6m !== null) {
      valid6m++;
      sum6m += ev.return_6m;
    }

    if (ev.statisticalConfidence !== undefined && ev.statisticalConfidence !== null) {
      sumStatConf += ev.statisticalConfidence;
      countStatConf++;
    }

    if (ev.causalConfidence !== undefined && ev.causalConfidence !== null) {
      sumCausalConf += ev.causalConfidence;
      countCausalConf++;
    }

    const absZ = Math.abs(ev.zScore);
    if (absZ > maxAbsZScore) {
      maxAbsZScore = absZ;
      highestSeverityEvent = {
        date: ev.date,
        catalyst: (ev.primarySubType || ev.primaryCategory) ?? "Unknown",
        return1y: ev.return_1y
      };
    }
  }

  const mostCommonCategory = Object.keys(categoryCounts).sort((a,b) => categoryCounts[b] - categoryCounts[a])[0] || "Unknown";
  const mostCommonSubType = Object.keys(subTypeCounts).sort((a,b) => subTypeCounts[b] - subTypeCounts[a])[0] || "Unknown";
  
  const meanReversionRate = valid1m > 0 ? (reversionCount / valid1m) * 100 : 0;
  const sectorEventRate = sysEvents.length > 0 ? (macroSectorCount / sysEvents.length) * 100 : 0;
  
  const avgStatConf = countStatConf > 0 ? sumStatConf / countStatConf : 0;
  const avgCausalConf = countCausalConf > 0 ? sumCausalConf / countCausalConf : 0;

  const avg1m = valid1m > 0 ? sum1m / valid1m : 0;
  const avg6m = valid6m > 0 ? sum6m / valid6m : 0;

  const dataNote = `Based on ${sysEvents.length} analysed anomalies over the observed period.`;

  const prompt = `You are a senior equity analyst writing a short sell-side analyst characterisation note (4-6 sentences) for the stock ticker ${symbol}.
Based on the quantitative analysis below, describe this stock's characteristic behaviour around extreme events (anomalies).
Cover how it typically reacts to its most common catalyst type, whether it tends to sustain or revert moves, how much volatility is driven by macro/sector versus company-specific forces, and what this implies for investors.
Respond with ONLY the text paragraph.

STATISTICS:
- Anomalies Analysed: ${sysEvents.length}
- Most Common Category: ${mostCommonCategory}
- Most Common Sub-Type: ${mostCommonSubType}
- Average 1-Month Return: ${avg1m.toFixed(2)}%
- Average 6-Month Return: ${avg6m.toFixed(2)}%
- Mean Reversion Rate (1m): ${meanReversionRate.toFixed(2)}%
- Macro/Sector Driven Volatility Rate: ${sectorEventRate.toFixed(2)}%
- Average Causal Confidence: ${avgCausalConf.toFixed(2)} / 100

Highest Severity Event details: ${highestSeverityEvent ? `${highestSeverityEvent.date}, Catalyst: ${highestSeverityEvent.catalyst}, 1-Year Return: ${highestSeverityEvent.return1y !== null ? (highestSeverityEvent.return1y*1).toFixed(2) + '%' : 'N/A'}` : 'N/A'}
`;

  const ai = getAIClient();
  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "text/plain"
    }
  });

  const profileSummary = response.text?.trim() || "Failed to generate profile summary.";

  return {
    symbol,
    generatedAt: new Date().toISOString(),
    totalAnomaliesAnalysed: sysEvents.length,
    mostCommonCatalystCategory: mostCommonCategory,
    mostCommonCatalystSubType: mostCommonSubType,
    averageReturn1m: avg1m,
    averageReturn6m: avg6m,
    meanReversionRate,
    sectorEventRate,
    averageStatisticalConfidence: avgStatConf,
    averageCausalConfidence: avgCausalConf,
    highestSeverityEvent,
    profileSummary,
    dataNote
  };
}
