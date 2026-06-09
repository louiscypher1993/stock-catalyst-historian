import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import { HistoricalEngine, generateLocalFallbackAnalysis, enrichConfidences, normaliseForYahoo } from "./HistoricalEngine";
import { getCachedAnalysis, setCachedAnalysis, getLatestIntelligenceReport, saveIntelligenceReport, getHighMaterialityEvents, getExecutiveEventsBySymbol, saveExecutiveEvents, getCachedProfile, setCachedProfile, getDataSourceLogs, getEventFeature, setEventFeatures, getDatabaseCacheStats, verifyCachedAnalysis, getEventsForCompetitor, clearScannerState, clearAllCompletedCheckpoints, getTrainingDataset } from "./db";
import { findSimilarEvents, computeAnalogueOutcomes } from "./HistoricalSimilarityService";
import { generateIntelligenceReport, getCompetitorMap } from "./ExecutiveIntelligence";
import { generateStockProfile } from "./StockProfileService";
import { getCompanyProfile, fmpDailyRequestCount, FMP_DAILY_BUDGET } from "./FMPService";
import { computeCompetitorImpact } from "./CorrelationEngine";
import { fetchInternationalPriceHistory } from "./EODHDService";
import { ExecutiveEvent } from "./src/types";
import { GLOBAL_MARKETS } from "./src/marketsData";
import { SOURCE_REGISTRY, getSourceReliability, getRateLimitedSources } from "./DataSourceRegistry";
import { extractAndParseJson } from "./src/JsonParser";
import { EVENT_TAXONOMY } from "./EventTaxonomy";
import { exportAndUploadToDrive, exportToLocalStream } from "./CSVExportService";
import { runSignalValidation } from "./SignalValidationService";
import { BatchScanner } from "./BatchScannerService";

dotenv.config();

//console.log("DEBUG GEMINI KEY LAST 8:", process.env.GEMINI_API_KEY?.slice(-8));
//console.log("DEBUG GEMINI KEY FIRST 8:", process.env.GEMINI_API_KEY?.slice(0, 8));

const SYMBOL_PATTERN = /^[A-Z0-9.\-]{1,15}$/;

function isValidSymbol(sym: string): boolean {
  return SYMBOL_PATTERN.test(sym.toUpperCase().trim());
}

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: "10mb" }));

// Lazy initialization of Gemini GoogleGenAI SDK client
let aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing. Configure it in the Settings > Secrets panel.");
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

// REST Endpoint: Stock Profile Aggregation
app.post("/api/stock-profile", async (req, res, next) => {
  const { symbol, forceRefresh } = req.body;
  if (!symbol || typeof symbol !== "string" || !symbol.trim()) {
    return res.status(400).json({ error: "symbol is a required non-empty string." });
  }
  if (forceRefresh !== undefined && typeof forceRefresh !== "boolean") {
    return res.status(400).json({ error: "forceRefresh must be a boolean if provided." });
  }

  const uppercaseSymbol = symbol.toUpperCase().trim();

  if (!isValidSymbol(uppercaseSymbol)) {
    return res.status(400).json({ error: "symbol contains invalid characters. Use only letters, numbers, dots, and hyphens (max 15 chars)." });
  }

  try {
    if (!forceRefresh) {
      const cached = getCachedProfile(uppercaseSymbol);
      if (cached && cached.generatedAt) {
        const genTime = new Date(cached.generatedAt).getTime();
        const now = new Date().getTime();
        // If profile is less than 7 days old, return it
        if (now - genTime < 7 * 24 * 60 * 60 * 1000) {
          return res.json(cached);
        }
      }
    }

    const profile = await generateStockProfile(uppercaseSymbol);
    setCachedProfile(uppercaseSymbol, profile);
    return res.json(profile);
  } catch (error: any) {
    next(error);
  }
});

// REST Endpoint: Stock Scan & Rolling Statistical Analysis
app.get("/api/competitors", async (req, res) => {
  try {
    const symbol = req.query.symbol as string;
    const name = req.query.name as string;
    if (!symbol) return res.status(400).json({ error: "Missing symbol" });

    // 1. Get the list of competitors via ExecutiveIntelligence
    const competitors = await getCompetitorMap(symbol.toUpperCase(), name || symbol.toUpperCase());

    // 2. Hydrate with FMP profile data to get prices
    
    const hydratedCompetitors = await Promise.all(
      competitors.map(async (comp: any) => {
        try {
          const profile = await getCompanyProfile(comp.symbol);
          const compEvents = getEventsForCompetitor(comp.symbol, symbol);
          return {
            ...comp,
            price: profile?.price,
            marketCap: profile?.marketCap,
            sector: profile?.sector || "Unknown",
            beta: profile?.beta,
            name: profile?.name || comp.name,
            events: compEvents
          };
        } catch (err: any) {
          console.warn(`[Competitors API] Failed to fetch profile for ${comp.symbol}`, err);
          let compEvents: any[] = [];
          try {
            compEvents = getEventsForCompetitor(comp.symbol, symbol);
          } catch {
            // events unavailable too
          }
          return {
            ...comp,
            events: compEvents,
            profileError: err?.message || "Failed to load financial data"
          };
        }
      })
    );

    res.json(hydratedCompetitors);
  } catch (err: any) {
    console.error("[Competitors API] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/competitor-impact", async (req, res) => {
  try {
    const { targetSymbol, competitorSymbol, years } = req.query;
    if (!targetSymbol || typeof targetSymbol !== "string" || !competitorSymbol || typeof competitorSymbol !== "string") {
      return res.status(400).json({ error: "targetSymbol and competitorSymbol are required." });
    }

    const impact = await computeCompetitorImpact(
      targetSymbol.toUpperCase(), 
      competitorSymbol.toUpperCase(), 
      years ? parseInt(years as string) : 2
    );

    res.json({
      targetSymbol: targetSymbol.toUpperCase(),
      competitorSymbol: competitorSymbol.toUpperCase(),
      ...impact
    });
  } catch (err: any) {
    if (err.message && err.message.includes("Missing historical data")) {
      console.warn("[Competitor Impact API] Warn:", err.message);
      return res.status(404).json({ error: err.message });
    }
    console.error("[Competitor Impact API] Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/export-environment", async (req, res) => {
  try {
    console.log("[SYS-ARCH] Express Request Received: Standalone export process initiated.");
    const { packageEnvironment } = await import("./src/utils/ExportEnvironment");
    const result = await packageEnvironment();

    res.download(result.zipPath, path.basename(result.zipPath), (err) => {
      // Sarcastic Comment: If the user closed their tab while downloading a 3MB package, 
      // we don't trigger a Sev-1 Kubernetes orchestration emergency response. Just a logging warn.
      if (err) {
        console.warn("[SYS-ARCH] Streaming interrupted or download canceled by user.", err.message);
      } else {
        console.log("[SYS-ARCH] Standalone sandbox package streamed successfully to physical client.");
      }

      // Cleanup local disk copy because AWS EBS GP3 volumes cost $0.08 per GB-month and we aren't made of gold.
      try {
        if (fs.existsSync(result.zipPath)) {
          fs.unlinkSync(result.zipPath);
          console.log("[SYS-ARCH] Server temporary archive file cleaned up successfully from workspace root.");
        }
      } catch (cleanErr: any) {
        console.error("[SYS-ARCH] Failed to clean up server temp zip file:", cleanErr.message);
      }
    });
  } catch (err: any) {
    console.error("[SYS-ARCH] Failed compiling enterprise bundle:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Failed packaging system sandbox pipeline." });
    }
  }
});

const largeJsonParser = express.json({ limit: "100mb" });

app.post("/api/export-local-csv", largeJsonParser, async (req, res) => {
  const { savedScans, markets } = req.body;
  if (!savedScans || !markets) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // To avoid V8 stringification limits, we use the same stream approach via CSVExportService
  try {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=Stock_Anomalies_LocalExport_${new Date().toISOString().slice(0, 10)}.csv`);
    
    await exportToLocalStream(savedScans, markets, res);
  } catch (error: any) {
    console.error("Local CSV export error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Failed to generate CSV" });
    }
  }
});

app.post("/api/export-drive-csv", largeJsonParser, async (req, res) => {
  const { savedScans, markets, driveToken, filename } = req.body;
  if (!savedScans || !markets || !driveToken || !filename) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const result = await exportAndUploadToDrive(savedScans, markets, driveToken, filename);
    return res.json(result);
  } catch (error: any) {
    console.error("Export to drive error:", error);
    return res.status(500).json({ error: error.message || "Failed to export and upload" });
  }
});

app.post("/api/stock-scan", async (req, res, next) => {

  const { symbol, years = 1, zScoreThreshold = 2.5, rollingWindow, forceRescan } = req.body;
  
  if (!symbol || (typeof symbol !== "string" && !Array.isArray(symbol))) {
    return res.status(400).json({ error: "symbol must be a non-empty string or a non-empty array of strings." });
  }

  if (typeof symbol === "string" && !symbol.trim()) {
    return res.status(400).json({ error: "symbol must be a non-empty string." });
  }

  if (Array.isArray(symbol)) {
    if (symbol.length === 0) {
      return res.status(400).json({ error: "symbol array cannot be empty." });
    }
    if (symbol.some((s) => typeof s !== "string" || !s.trim() || !isValidSymbol(s))) {
      return res.status(400).json({ error: "Every symbol must contain only letters, numbers, dots, and hyphens (max 15 chars)." });
    }
  }

  if (req.body.years !== undefined) {
    const yearsNum = Number(years);
    if (![0.5, 1, 2, 5, 30].includes(yearsNum)) {
      return res.status(400).json({ error: "years must be one of [0.5, 1, 2, 5, 30] if provided." });
    }
  }

  if (req.body.zScoreThreshold !== undefined) {
    const zThreshold = Number(zScoreThreshold);
    if (isNaN(zThreshold) || zThreshold < 1.5 || zThreshold > 4.0) {
      return res.status(400).json({ error: "zScoreThreshold must be between 1.5 and 4.0 if provided." });
    }
  }

  if (rollingWindow !== undefined) {
    const rWindow = Number(rollingWindow);
    if (isNaN(rWindow) || rWindow < 30 || rWindow > 200) {
      return res.status(400).json({ error: "rollingWindow must be between 30 and 200 if provided." });
    }
  }

  try {
    // Check if symbol query contains multiple tickers (either string comma separated, or array)
    const symbols = Array.isArray(symbol)
      ? symbol
      : (typeof symbol === "string" ? symbol.split(",") : [symbol])
          .map((s) => s.trim())
          .filter(Boolean);

    if (symbols.length === 0) {
      return res.status(400).json({ error: "At least one valid stock symbol is required." });
    }

    if (forceRescan) {
      symbols.forEach(sym => clearScannerState(sym));
    }

    const rWindow = rollingWindow !== undefined ? Number(rollingWindow) : 90;
    const engine = new HistoricalEngine(symbols, zScoreThreshold, rWindow);

    if (symbols.length > 1) {
      const multiResults = await engine.run_multi_scan(symbols, years);
      return res.json({
        multi: true,
        results: multiResults,
        rateLimitedSources: getRateLimitedSources()
      });
    } else {
      const singleResult = await engine.run_scan(symbols[0], years);
      // attach it conceptually if needed or wrap it. But frontend treats data.multi for multi.
      // let's add rateLimitedSources to singleResult object directly
      (singleResult as any).rateLimitedSources = getRateLimitedSources();
      return res.json(singleResult);
    }
  } catch (error: any) {
    next(error);
  }
});

app.post("/api/clear-checkpoints", async (req, res, next) => {
  try {
    const { symbol } = req.body;
    let cleared = 0;
    if (symbol && typeof symbol === "string" && symbol.trim()) {
      clearScannerState(symbol);
      cleared = 1;
      console.log(`[Checkpoint] Cleared checkpoint for ${symbol.trim().toUpperCase()}`);
    } else {
      cleared = clearAllCompletedCheckpoints();
      console.log(`[Checkpoint] Cleared ${cleared} checkpoint(s)`);
    }
    return res.json({ cleared, message: `Cleared ${cleared} checkpoint(s)` });
  } catch (error: any) {
    next(error);
  }
});

app.post("/api/similar-events", async (req, res, next) => {
  const { symbol, date } = req.body;
  if (!symbol || typeof symbol !== "string" || !symbol.trim()) {
    return res.status(400).json({ error: "symbol must be a non-empty string." });
  }
  if (!date || typeof date !== "string" || !date.trim()) {
    return res.status(400).json({ error: "date must be a non-empty string." });
  }

  try {
    const uppercaseSymbol = symbol.toUpperCase().trim();

    if (!isValidSymbol(uppercaseSymbol)) {
      return res.status(400).json({ error: "symbol contains invalid characters. Use only letters, numbers, dots, and hyphens (max 15 chars)." });
    }

    const currentEvent = getEventFeature(uppercaseSymbol, date);
    if (!currentEvent) {
      return res.status(404).json({ error: "Event features not found in database." });
    }

    const similarEvents = findSimilarEvents(currentEvent, 10);
    const analogueOutcomes = computeAnalogueOutcomes(similarEvents);
    return res.json({ similarEvents, currentEvent, analogueOutcomes });
  } catch (error: any) {
    next(error);
  }
});

app.post("/api/verify-anomaly", async (req, res) => {
  const { cacheKey, isVerified, correctedCatalyst } = req.body;
  if (!cacheKey) {
    return res.status(400).json({ error: "cacheKey is required." });
  }

  try {
    verifyCachedAnalysis(cacheKey, isVerified === true, correctedCatalyst);
    return res.json({ success: true, cacheKey, isVerified });
  } catch (error: any) {
    console.error("Failed to verify anomaly:", error);
    return res.status(500).json({ error: error.message || "Failed to verify anomaly" });
  }
});

// REST Endpoint: Manual Catalyst Analysis on specific date
app.post("/api/analyze-anomaly", async (req, res, next) => {
  const { symbol, date, dailyReturn, zScore, return_1d, return_1w, return_1m, return_6m, return_1y, gatingVerdict } = req.body;
  
  if (!symbol || typeof symbol !== "string" || !symbol.trim()) {
    return res.status(400).json({ error: "symbol is required and must be a non-empty string." });
  }
  
  if (!date || typeof date !== "string" || !date.trim()) {
    return res.status(400).json({ error: "date is required and must be a non-empty string." });
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(date)) {
    return res.status(400).json({ error: "date must match the pattern YYYY-MM-DD." });
  }

  const uppercaseSymbol = symbol.toUpperCase().trim();

  if (!isValidSymbol(uppercaseSymbol)) {
    return res.status(400).json({ error: "symbol contains invalid characters. Use only letters, numbers, dots, and hyphens (max 15 chars)." });
  }

  const cacheKey = `${uppercaseSymbol}_${date}`;

  const buildContextResponse = async (baseData: any, uppercaseSymbol: string, dateStr: string) => {
    try {
      let currentEvent = getEventFeature(uppercaseSymbol, dateStr);
      
      // If we just generated a new AI analysis, we should update the feature vector
      // to reflect its new primaryCategory, causalConfidence, etc.
      if (currentEvent && baseData.analysis) {
        let updated = false;
        if (baseData.analysis.primaryCategory !== undefined && currentEvent.primaryCategory !== baseData.analysis.primaryCategory) {
           currentEvent.primaryCategory = baseData.analysis.primaryCategory;
           updated = true;
        }
        if (baseData.analysis.primarySubType !== undefined && currentEvent.primarySubType !== baseData.analysis.primarySubType) {
           currentEvent.primarySubType = baseData.analysis.primarySubType;
           updated = true;
        }
        if (baseData.analysis.statisticalConfidence !== undefined && currentEvent.statisticalConfidence !== baseData.analysis.statisticalConfidence) {
           currentEvent.statisticalConfidence = baseData.analysis.statisticalConfidence;
           updated = true;
        }
        if (baseData.analysis.causalConfidence !== undefined && currentEvent.causalConfidence !== baseData.analysis.causalConfidence) {
           currentEvent.causalConfidence = baseData.analysis.causalConfidence;
           updated = true;
        }
        if (updated) {
           setEventFeatures(`${uppercaseSymbol}_${dateStr}`, currentEvent);
        }

        const similarEvents = findSimilarEvents(currentEvent, 10);
        const analogueSummary = computeAnalogueOutcomes(similarEvents);

        // This system presents probability distributions derived from historical precedent, NOT price predictions.
        // The distinction matters — the system is saying "here is what happened in similar past situations" not "here is what will happen."
        // This is epistemically honest and more useful for serious investors than deterministic price targets.
        baseData.historicalContext = {
          similarEventsFound: similarEvents.length,
          analogueSummary,
          topAnalogues: similarEvents.slice(0, 3)
        };
      }
    } catch (e) {
      console.error("Failed to build historical context", e);
    }

    try {
      if (gatingVerdict) {
        baseData.gatingVerdict = gatingVerdict;
      } else {
        const ce = getEventFeature(uppercaseSymbol, dateStr);
        if (ce?.gatingVerdict) {
          baseData.gatingVerdict = ce.gatingVerdict;
        }
      }
    } catch (e) {
      console.error("Failed to inject gating verdict context", e);
    }

    try {
      const recentReport = getLatestIntelligenceReport(uppercaseSymbol);
      if (recentReport) {
        // Check if report is within 30 days of this anomaly date
        const anomalyDate = new Date(dateStr).getTime();
        const reportDate = new Date(recentReport.reportDate).getTime();
        if (Math.abs(anomalyDate - reportDate) < 30 * 24 * 60 * 60 * 1000) {
          const highMaterialityEvents = (recentReport.executiveEvents || []).filter(e => e.materialityScore > 50);
          baseData.executiveContext = {
            hasRelevantEvents: true,
            highMaterialityEvents,
            overallSignal: recentReport.overallSignal || "neutral",
            note: "Executive intelligence data was available for this period and may provide additional context for this anomaly."
          };
        } else {
          baseData.executiveContext = {
            hasRelevantEvents: false,
            note: "No recent executive intelligence data for this symbol in this timeframe. Run an executive intelligence scan to check for personal/insider catalysts."
          };
        }
      } else {
        baseData.executiveContext = {
          hasRelevantEvents: false,
          note: "No executive intelligence data available for this symbol. Run an executive intelligence scan to check for personal/insider catalysts."
        };
      }
    } catch (e) {
      console.error("Failed to build executive context", e);
    }

    return baseData;
  };

  // Check cache first
  const cachedAnalysis = getCachedAnalysis(cacheKey);
  if (cachedAnalysis) {
    return res.json(await buildContextResponse({ date, analysis: cachedAnalysis, cached: true }, uppercaseSymbol, date));
  }

  try {
    const ai = getAIClient();

    // Gating formatting
    const compactVerdict = gatingVerdict ? {
      event_classification: gatingVerdict.event_classification,
      is_macro_gravity_dominant: gatingVerdict.is_macro_gravity_dominant,
      divergence_detected: gatingVerdict.divergence_detected,
      conflicting_signals: gatingVerdict.conflicting_signals,
      dominant_physics_regime: gatingVerdict.dominant_physics_regime,
      dominant_alternative_vector: gatingVerdict.dominant_alternative_vector
    } : undefined;
    const verdictText = compactVerdict ? `\nDETERMINISTIC GATING VERDICT (GROUND TRUTH - DO NOT CONTRADICT):\n${JSON.stringify(compactVerdict, null, 2)}\n` : "";

    const rText = `Post-event Stock Performance Returns: ` + [
      return_1d !== undefined ? `1 Day: ${Number(return_1d) >= 0 ? "+" : ""}${return_1d}%` : `1d: N/A`,
      return_1w !== undefined ? `1 Week (5d): ${Number(return_1w) >= 0 ? "+" : ""}${return_1w}%` : `1w: N/A`,
      return_1m !== undefined ? `1 Month (21d): ${Number(return_1m) >= 0 ? "+" : ""}${return_1m}%` : `1m: N/A`,
      return_6m !== undefined ? `6 Months (126d): ${Number(return_6m) >= 0 ? "+" : ""}${return_6m}%` : `6m: N/A`,
      return_1y !== undefined ? `1 Year (252d): ${Number(return_1y) >= 0 ? "+" : ""}${return_1y}%` : `1y: N/A`,
    ].join(", ");

    const prompt = `You are simulating point-in-time analysis as if today is ${date}. When using Google Search, prefer the operator before:${date} and do not let any later-published article contaminate your attribution of this specific day.

Specifically for stock "${uppercaseSymbol}" on trading date ${date}, investigate the precise corporate news, CEO activity, board adjustments, competitor actions, macroeconomic developments, central bank updates, or regulatory reforms that occurred on or surrounding this date.
${verdictText}
Returns of this session were ${Number(dailyReturn).toFixed(2)}% with a calculated Z-Score of ${Number(zScore).toFixed(2)} Sigma (over 90 sessions).
${rText}

Formulate findings as raw JSON containing EXACTLY these fields:
- suspected_catalyst: the specific real event that best explains this. If event_classification is SUPPRESSED_NON_EVENT, instead explain what notable news DID exist around this date that the market appears to have absorbed WITHOUT a price reaction, and why it may already have been priced in.
- primaryCategory: identify using EVENT_TAXONOMY (see below)
- primarySubType: identify using EVENT_TAXONOMY (see below)
- secondaryCategories: array of strings using EVENT_TAXONOMY
- divergence_narrative: if divergence_detected is true, 2-3 sentences explaining the real-world reason the listed sources disagree; otherwise an empty string.
- causal_attribution_review: assess plausibility. Do NOT mention forward-looking price action or future returns.
- aiConfidence: integer 0-100.

Taxonomy:
${JSON.stringify(EVENT_TAXONOMY, null, 2)}

Do not include any search citation brackets (e.g. [1]) inside JSON string values. Output only raw, parsable JSON with no text before or after it.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are a financial catalyst attribution and narrative analyst. A deterministic engine has ALREADY classified this event. Treat the provided gating verdict as fixed ground truth — never recompute or contradict its fields. Use Google Search grounding to find real-world news surrounding the date. Do NOT output probabilities, action signals, or any numeric verdict field.",
        tools: [{ googleSearch: {} }]
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("Unable to construct catalyst summary. AI returned empty structure.");
    }

    const aiData = extractAndParseJson(text);
    // Merge returns to cache
    const mergedData = {
      ...aiData,
      return_1d,
      return_1w,
      return_1m,
      return_6m,
      return_1y
    };
    enrichConfidences(mergedData);
    setCachedAnalysis(cacheKey, uppercaseSymbol, date, mergedData as any, false);

    return res.json(await buildContextResponse({ date, analysis: mergedData, cached: false }, uppercaseSymbol, date));
  } catch (error: any) {
    console.error("Gemini manual analyst error (falling back to local rules due to quota or config):", error);
    try {
      const fallbackData = generateLocalFallbackAnalysis(
        uppercaseSymbol, 
        date, 
        Number(dailyReturn || 0), 
        Number(zScore || 0),
        { return_1d, return_1w, return_1m, return_6m, return_1y }
      );
      enrichConfidences(fallbackData);
      setCachedAnalysis(cacheKey, uppercaseSymbol, date, fallbackData as any, true);
      return res.json(await buildContextResponse({ 
        date, 
        analysis: fallbackData, 
        cached: false, 
        fallback: true, 
        notice: "Displaying adaptive rule-based financial estimation due to Gemini API quota limits." 
      }, uppercaseSymbol, date));
    } catch (fallbackError) {
      console.error("Fallback generator error:", fallbackError);
      return res.status(500).json({ error: error.message || "Catalyst analysis model process failed. Check your configuration." });
    }
  }
});

// REST Endpoint: Interactive Historical Dialogue GROUNDED on Anomaly Datasets
app.post("/api/stock-chat", async (req, res) => {
  const { symbol, messages, anomalies } = req.body;
  if (!symbol || !messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Symbol and messages list are required." });
  }

  try {
    const ai = getAIClient();

    const anomalySummary =
      anomalies && anomalies.length > 0
        ? anomalies
            .map(
              (a: any) =>
                `- Date: ${a.date}, Return: ${Number(a.dailyReturn).toFixed(2)}%, Close: $${Number(a.close).toFixed(
                  2
                )}, Z-Score: ${Number(a.zScore).toFixed(2)}σ. Catalyst: ${
                  a.analysis?.primary_catalyst_tag || "Pending resolution"
                } - ${a.analysis?.suspected_catalyst || ""}`
            )
            .join("\n")
        : "No anomalies detected yet.";

    const systemInstructions = `You are a sophisticated AI Stock Historian and Investment Analyst specializing in tracking structural corporate changes, macroeconomic catalysts, and historical pricing anomalies.
We are analyzing the stock symbol: "${symbol.toUpperCase()}". 
Below are key volatility spikes (Returns exceeding statistical thresholds of rolling standard deviation) along with resolved catalysts:
${anomalySummary}

Instructions:
1. Conduct a friendly, professional, analytical dialogue.
2. Provide objective, logical answers leveraging your financial, macroeconomic, and corporate knowledge.
3. If the user asks about specific anomalies, refer directly to the computed dates list.
4. Try to explain long-term trends and structural risks. Keep responses clear and clean using standard Markdown lists and elements.`;

    // Build the system + context prefix as the first user turn
    const contextTurn = {
      role: "user" as const,
      parts: [{ text: systemInstructions }]
    };
    const contextAck = {
      role: "model" as const,
      parts: [{ text: "Understood. I am ready to analyze the anomaly data for " + symbol.toUpperCase() + "." }]
    };

    // Map the conversation history to the Gemini multi-turn format
    const conversationTurns = messages.map((msg: any) => ({
      role: msg.role === "user" ? ("user" as const) : ("model" as const),
      parts: [{ text: msg.content }]
    }));

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [contextTurn, contextAck, ...conversationTurns],
    });

    return res.json({ reply: response.text });
  } catch (err: any) {
    console.error("AI Assistant stock chat exception (providing rate-limit response):", err);
    const isQuota = err.message && (err.message.includes("quota") || err.message.includes("429") || err.message.includes("RESOURCE_EXHAUSTED"));
    let friendlyReply = "I apologize, but we have reached the temporary Google Gemini API quota limits (rate limit 429). The system is fully operational locally, so you can still add custom stocks or view the statistical deviation chart below. Please try submitting another prompt in 10-15 seconds!";
    if (!isQuota) {
      friendlyReply = `I encountered an issue connecting to the financial database: ${err.message || "Connection interrupted"}. Please inspect your API configuration.`;
    }
    return res.json({ reply: friendlyReply, is_fallback: true });
  }
});

// REST Endpoint: Retrieve global cached stats
app.get("/api/cache-stats", (req, res) => {
  try {
    const stats = getDatabaseCacheStats();
    return res.json(stats);
  } catch (error) {
    console.error("Failed to gather cached status information:", error);
    return res.status(500).json({ error: "Failed to gather cached status information." });
  }
});

app.get("/api/fmp-budget", (req, res) => {
  res.json({
    requestsUsed: fmpDailyRequestCount,
    budgetLimit: FMP_DAILY_BUDGET,
    remainingToday: Math.max(0, FMP_DAILY_BUDGET - fmpDailyRequestCount),
    resetsAt: "midnight UTC"
  });
});

// REST Endpoint: Securely preload/cache batch datasets bounded to prevent API limitations
app.post("/api/preload-batch", async (req, res) => {
  const { symbols, maxRequests = 20 } = req.body;
  if (!symbols || !Array.isArray(symbols)) {
    return res.status(400).json({ error: "An array of symbols is required." });
  }

  const subset = symbols.slice(0, Math.min(25, maxRequests));
  const results: { symbol: string; status: "success" | "error"; anomaliesCount?: number; error?: string }[] = [];

  console.log(`[PRELOADER] Starting paced batch preload of ${subset.length} stock charts...`);

  for (let i = 0; i < subset.length; i++) {
    const sym = subset[i].toUpperCase().trim();
    try {
      // Small 50ms delay between fetches to respect external rate limits
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const engine = new HistoricalEngine([sym], 2.5);
      const scanResult = await engine.run_scan(sym, 1, true); // 1 Year statistical rolling analysis
      
      results.push({
        symbol: sym,
        status: "success",
        anomaliesCount: scanResult.anomalies?.length || 0,
      });
    } catch (err: any) {
      console.warn(`[PRELOADER] Symbol ${sym} preload skipping:`, err.message);
      results.push({
        symbol: sym,
        status: "error",
        error: err.message || "Failed scanning symbol.",
      });
    }
  }

  return res.json({
    totalProcessed: results.length,
    successCount: results.filter(r => r.status === "success").length,
    results,
  });
});

// REST Endpoint: Batch update existing scanned stocks with new data only
app.post("/api/batch-update", async (req, res) => {
  const { currentScans } = req.body; // e.g., { TSLA: 1782384000000, AAPL: 1782384000000 }
  if (!currentScans || typeof currentScans !== "object") {
    return res.status(400).json({ error: "Object mapping currentScans (symbol: lastTimestamp) is required." });
  }

  const symbols = Object.keys(currentScans).slice(0, 25);
  if (symbols.length === 0) {
    return res.json({ message: "No active scanned stocks saved to update.", updated: {}, skipped: [] });
  }

  const activeLimited = getRateLimitedSources();
  const isCriticalLimitActive = activeLimited.some((s: string) => 
    s.toLowerCase().includes("polygon") || s.toLowerCase().includes("fmp")
  );

  if (isCriticalLimitActive) {
    return res.status(429).json({
      error: "API rate limit is active for standard providers (Polygon/FMP). Update paused.",
      rateLimitedSources: activeLimited,
      totalChecked: symbols.length,
      updatedCount: 0,
      skippedCount: 0,
      updated: {},
      skipped: []
    });
  }

  console.log(`[BATCH-UPDATE] Checking updates for symbols: ${symbols.join(", ")} using official batch guidelines`);
  const updatedResults: Record<string, any> = {};
  const skippedSymbols: string[] = [];
  let hitRateLimit = false;

  for (const sym of symbols) {
    const uppercaseSym = sym.toUpperCase().trim();
    const lastTimestamp = Number(currentScans[sym]) || 0;

    // Fast-check rate limits before attempting this ticker scan
    const currentLimits = getRateLimitedSources();
    if (currentLimits.some((s: string) => s.toLowerCase().includes("polygon") || s.toLowerCase().includes("fmp"))) {
      hitRateLimit = true;
      console.warn(`[BATCH-UPDATE] Standard API provider is rate-limited. Suspending remaining batch updates.`);
      break;
    }

    try {
      let latestYahooTime: number | null = null;

      try {
        // Fetch latest daily quote from Yahoo to verify if new trading days have occurred
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${normaliseForYahoo(uppercaseSym)}?range=1y&interval=1d`;
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36",
          },
        });

        if (response.ok) {
          const data: any = await response.json();
          const result = data.chart?.result?.[0];
          const timestamps = result?.timestamp;
          if (timestamps && timestamps.length > 0) {
            latestYahooTime = timestamps[timestamps.length - 1] * 1000;
          }
        }
      } catch (e) {
        // Safe to suppress
      }

      // If Yahoo fetch was not successful or did not return timestamps, try EODHD if configured
      if (!latestYahooTime && process.env.EODHD_API_KEY) {
        try {
          const fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const toDate = new Date().toISOString().split('T')[0];
          const history = await fetchInternationalPriceHistory(uppercaseSym, fromDate, toDate);
          if (history && history.length > 0) {
            latestYahooTime = history[history.length - 1].timestamp;
          }
        } catch (e) {
          // Safe to suppress
        }
      }

      // If we still don't have a latest timestamp, check if 24 hours have passed since last scan.
      // If yes, we can proceed with a fresh scan (supporting synthetic stocks/reconstruction).
      if (!latestYahooTime) {
        const oneDayMs = 24 * 60 * 60 * 1000;
        if (Date.now() - lastTimestamp > oneDayMs) {
          console.log(`[BATCH-UPDATE] Ticker ${uppercaseSym} couldn't be resolved via Yahoo/EODHD APIs. Triggering synthetic/timed update.`);
          latestYahooTime = Date.now();
        } else {
          console.log(`[BATCH-UPDATE] Skipping ${uppercaseSym}: could not reach Yahoo/EODHD API and scanned within last 24 hours.`);
          skippedSymbols.push(uppercaseSym);
          continue;
        }
      }

      // Only update if there is strictly new data
      if (latestYahooTime <= lastTimestamp) {
        console.log(`[BATCH-UPDATE] Ticker ${uppercaseSym} is up to date (Latest: ${latestYahooTime} <= saved: ${lastTimestamp}). Skipping.`);
        skippedSymbols.push(uppercaseSym);
        continue;
      }

      // There is new data! Ingest it and generate fresh rolling stats and detect anomalies
      console.log(`[BATCH-UPDATE] Ticker ${uppercaseSym} has NEW data! (Latest: ${latestYahooTime} > saved: ${lastTimestamp}) Ingesting...`);
      const engine = new HistoricalEngine([uppercaseSym], 2.5);
      const scanResult = await engine.run_scan(uppercaseSym, 1, true);
      
      updatedResults[uppercaseSym] = scanResult;
    } catch (err: any) {
      console.warn(`[BATCH-UPDATE] Failed to run update scan for ${uppercaseSym}:`, err.message);
      skippedSymbols.push(uppercaseSym);

      const isLimit =
        err.status === 429 ||
        err.code === 429 ||
        err.isRateLimit === true ||
        (err.message && (
          err.message.toLowerCase().includes("429") ||
          err.message.toLowerCase().includes("quota") ||
          err.message.toLowerCase().includes("rate limit") ||
          err.message.toLowerCase().includes("limit has been reached") ||
          err.message.toLowerCase().includes("limit active") ||
          err.message.toLowerCase().includes("limit exceeded") ||
          err.message.toLowerCase().includes("throttled")
        ));
      
      if (isLimit) {
        hitRateLimit = true;
        console.warn(`[BATCH-UPDATE] Hit API rate limit/quota during update execution for ${uppercaseSym}. Halting batch update pipeline.`);
        break;
      }
    }
  }

  const finalRateLimits = getRateLimitedSources();
  const isResultRateLimited = hitRateLimit || finalRateLimits.some((s: string) => 
    s.toLowerCase().includes("polygon") || s.toLowerCase().includes("fmp")
  );

  return res.status(isResultRateLimited ? 429 : 200).json({
    totalChecked: symbols.length,
    updatedCount: Object.keys(updatedResults).length,
    skippedCount: skippedSymbols.length,
    updated: updatedResults,
    skipped: skippedSymbols,
    rateLimitedSources: finalRateLimits,
    isRateLimited: isResultRateLimited
  });
});

// REST Endpoint: Executive Intelligence Pipeline
app.post("/api/executive-intelligence", async (req, res) => {
  try {
    const { symbol, companyName, startDate, endDate, forceRefresh } = req.body;
    if (!symbol || !companyName) {
      return res.status(400).json({ error: "Missing symbol or companyName." });
    }

    const uppercaseSymbol = symbol.toUpperCase().trim();

    if (!isValidSymbol(uppercaseSymbol)) {
      return res.status(400).json({ error: "symbol contains invalid characters. Use only letters, numbers, dots, and hyphens (max 15 chars)." });
    }
    
    // Default dates: 90 days ago to today
    const now = new Date();
    const defaultEndDate = now.toISOString().split('T')[0];
    const defaultStartDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const finalStartDate = startDate || defaultStartDate;
    const finalEndDate = endDate || defaultEndDate;

    // Validate date range does not exceed 365 days
    const startMs = new Date(finalStartDate).getTime();
    const endMs = new Date(finalEndDate).getTime();
    if (endMs - startMs > 365 * 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: "Date range cannot exceed 365 days." });
    }

    if (!forceRefresh) {
      const recentReport = getLatestIntelligenceReport(uppercaseSymbol);
      if (recentReport) {
        const reportTime = new Date(recentReport.reportDate).getTime();
        // If report is less than 7 days old, return it
        if (now.getTime() - reportTime < 7 * 24 * 60 * 60 * 1000) {
          return res.json({ report: recentReport, cached: true });
        }
      }
    }

    const report = await generateIntelligenceReport(uppercaseSymbol, companyName, finalStartDate, finalEndDate);
    
    saveIntelligenceReport(uppercaseSymbol, report);
    
    const allEvents: ExecutiveEvent[] = [...(report.executiveEvents as any[]), ...(report.competitorEvents as any[])];
    
    if (allEvents.length > 0) {
      saveExecutiveEvents(uppercaseSymbol, allEvents);
    }

    const isKnownSymbol = GLOBAL_MARKETS.some(market => market.stocks.some(stock => stock.symbol === uppercaseSymbol));
    const warning = isKnownSymbol ? undefined : "Symbol not in known markets database — executive roster and competitor identification may be less accurate for lesser-known companies.";
    
    return res.json({ report, cached: false, warning });
  } catch (error: any) {
    console.error("Failed to generate intelligence report:", error);
    return res.status(500).json({ error: error.message || "Failed to generate intelligence report" });
  }
});

// REST Endpoint: High Materiality Market Alerts
app.get("/api/high-materiality-alerts", (req, res) => {
  try {
    const minScore = req.query.minScore ? parseInt(req.query.minScore as string, 10) : 70;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

    const alerts = getHighMaterialityEvents(minScore, limit);
    return res.json({ alerts, count: alerts.length });
  } catch (error: any) {
    console.error("Failed to fetch high materiality alerts:", error);
    return res.status(500).json({ error: "Failed to load alerts" });
  }
});

// REST Endpoint: Executive History for specific symbol
app.get("/api/executive-history/:symbol", (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    const events = getExecutiveEventsBySymbol(symbol, limit);
    return res.json({ events, symbol });
  } catch (error: any) {
    console.error(`Failed to fetch executive history for ${req.params.symbol}:`, error);
    return res.status(500).json({ error: "Failed to load historical events" });
  }
});

// REST Endpoint: Live Data Source Health Dashboard
app.get("/api/source-health", (req, res) => {
  try {
    const isSourceConfigured = (sourceId: string): boolean => {
      switch (sourceId) {
        case "yahoo":
        case "edgar":
          return true;
        case "polygon":
          return !!process.env.POLYGON_API_KEY;
        case "fmp":
          return !!process.env.FMP_API_KEY;
        case "eodhd":
          return !!process.env.EODHD_API_KEY;
        case "fred":
          return !!process.env.FRED_API_KEY;
        case "newsapi":
          return !!(process.env.NEWSAPI_KEY || process.env.NEWS_API_KEY);
        case "reddit":
          return !!process.env.REDDIT_CLIENT_ID;
        default:
          return false;
      }
    };

    const sources = Object.values(SOURCE_REGISTRY).map((src) => {
      const stats = getSourceReliability(src.id);
      const isConfigured = isSourceConfigured(src.id);
      const logs = getDataSourceLogs(src.id, undefined, undefined, 100);
      const recentErrors = logs
        .filter(log => !log.success && log.errorMessage)
        .map(log => log.errorMessage!)
        .slice(0, 3);

      return {
        sourceId: src.id,
        sourceName: src.name,
        isActive: src.isActive,
        isConfigured: isConfigured,
        capabilities: src.capabilities,
        reliability: stats,
        recentErrors: recentErrors,
        dataTypes: src.capabilities
      };
    });

    let overallHealth: "healthy" | "degraded" | "critical" = "healthy";

    const primaryBadSources = sources.filter(src => {
      const reg = SOURCE_REGISTRY[src.sourceId as keyof typeof SOURCE_REGISTRY];
      return reg?.isPrimary && (!src.isConfigured || src.reliability.successRate < 95);
    });

    if (primaryBadSources.length > 0) {
      let criticalFound = false;
      for (const badSrc of primaryBadSources) {
        for (const cap of badSrc.capabilities) {
          const fallbackExists = sources.some(otherSrc => 
            otherSrc.sourceId !== badSrc.sourceId &&
            otherSrc.isActive &&
            otherSrc.isConfigured &&
            otherSrc.capabilities.includes(cap) &&
            otherSrc.reliability.successRate >= 95
          );
          if (!fallbackExists) {
            criticalFound = true;
            break;
          }
        }
        if (criticalFound) break;
      }
      overallHealth = criticalFound ? "critical" : "degraded";
    }

    const allDataTypes = Array.from(
      new Set(
        Object.values(SOURCE_REGISTRY).flatMap((src) => src.capabilities)
      )
    );

    const coverageGaps = allDataTypes.filter((dt) => {
      return !Object.values(SOURCE_REGISTRY).some((src) => 
        src.capabilities.includes(dt) &&
        src.isActive &&
        isSourceConfigured(src.id)
      );
    });

    const recommendations: string[] = [];
    Object.values(SOURCE_REGISTRY).forEach((src) => {
      if (!src.isActive) {
        if (src.id === "edgar") {
          recommendations.push(
            "EDGAR is free and requires no API key. Enabling it would add official SEC filing correlation and verified insider transaction data to all anomaly analyses. To activate: no setup required, just set edgar.isActive = true in DataSourceRegistry.ts."
          );
        } else if (src.id === "polygon") {
          recommendations.push(
            "Polygon.io is a primary financial data source with a free tier (5 req/min). Enabling it would unlock official high-quality stock OHLCV prices, news, and sentiment indicators. To activate: get a free API key from polygon.io, configure POLYGON_API_KEY in your environment, and set polygon.isActive = true in DataSourceRegistry.ts."
          );
        } else if (src.id === "fmp") {
          recommendations.push(
            "Financial Modeling Prep has a generous free tier (250 req/day). Enabling it would unlock corporate fundamentals, ratios, and real-time earnings calendars to augment anomaly reports. To activate: obtain a free API key, configure FMP_API_KEY in your environment, and set fmp.isActive = true in DataSourceRegistry.ts."
          );
        } else if (src.id === "fred") {
          recommendations.push(
            "Federal Reserve FRED is a free service providing official macroeconomic time-series data. Enabling it would unlock interest rates, GDP, and inflation tracking context for anomaly comparisons. To activate: register for a free FRED API key, configure FRED_API_KEY in your environment, and set fred.isActive = true in DataSourceRegistry.ts."
          );
        } else if (src.id === "newsapi") {
          recommendations.push(
            "NewsAPI.org provides a free tier for fetching recent articles around volatile trading periods. Enabling it would enrich anomalies with contemporaneous press coverage. To activate: register for a free API key at newsapi.org, configure NEWSAPI_KEY in your environment, and set newsapi.isActive = true in DataSourceRegistry.ts."
          );
        } else if (src.id === "stocktwits") {
          recommendations.push(
            "StockTwits API is a free social listening source used to gauge retail momentum. It provides structured sentiment and is enabled by default with no API key required."
          );
        } else if (src.id === "gdelt") {
          recommendations.push(
            "GDELT Project is an extraordinary free global news event database that monitors news in 100+ languages. It publishes structured event data files and is perfect for global coverage. Enabled by default."
          );
        } else if (src.id === "yahoo") {
          recommendations.push(
            "Yahoo Finance is free and requires no API key. To activate: set yahoo.isActive = true in DataSourceRegistry.ts to enable fallback price data."
          );
        }
      }
    });

    if (!SOURCE_REGISTRY.eodhd.isActive) {
      recommendations.push("Configure EODHD_API_KEY to improve international ticker data quality");
    }

    return res.json({
      generatedAt: new Date().toISOString(),
      overallHealth,
      sources,
      coverageGaps,
      recommendations
    });
  } catch (error: any) {
    console.error("Failed to fetch source health:", error);
    return res.status(500).json({ error: "Failed to load data source health indicators" });
  }
});

// Global Express error handler using the four-argument middleware signature
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const status = typeof err.status === "number" ? err.status : (typeof err.statusCode === "number" ? err.statusCode : 500);
  if (status === 429 || err?.isRateLimit) {
    // Silently handle expected 429 errors from scanner engines to not flood AI Studio console heuristics
  } else {
    console.error("Global error handler caught:", err);
  }
  res.status(status).json({
    error: err.message || "An unexpected error occurred.",
    code: status,
    timestamp: new Date().toISOString()
  });
});

// REST Endpoint: Signal validation — measures which signals predict forward returns
app.get("/api/signal-validation", async (req, res, next) => {
  try {
    const rawHorizon = req.query.horizon as string | undefined;
    const horizon =
      rawHorizon === "1d" || rawHorizon === "1w" || rawHorizon === "1m"
        ? rawHorizon
        : "1w";
    const report = await runSignalValidation({ horizon });
    return res.json(report);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Training dataset export — reads all persisted events + null samples
// ---------------------------------------------------------------------------

app.get("/api/export-training-data", (req, res, next) => {
  try {
    const symbolFilter = req.query.symbol as string | undefined;
    const format = req.query.format === "json" ? "json" : "csv";

    const rows = getTrainingDataset({ symbolFilter });

    if (format === "json") {
      return res.json(rows);
    }

    // CSV — collect all snap keys from the first row that has a snapshot
    const snapKeys: string[] = [];
    for (const row of rows) {
      if (row.signal_snapshot && typeof row.signal_snapshot === "object") {
        for (const k of Object.keys(row.signal_snapshot)) {
          if (!snapKeys.includes(k)) snapKeys.push(k);
        }
        break;
      }
    }

    const escCsv = (val: any): string => {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const baseHeaders = [
      "symbol", "date", "label", "non_event_reason",
      "z_score", "price_change_pct",
      "forward_return_1d", "forward_return_1w", "forward_return_1m",
      ...snapKeys.map(k => `snap_${k}`),
    ];

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="training_data.csv"');
    res.write(baseHeaders.join(",") + "\n");

    for (const row of rows) {
      const snap = row.signal_snapshot ?? {};
      const cells = [
        escCsv(row.symbol),
        escCsv(row.date),
        escCsv(row.label),
        escCsv(row.non_event_reason ?? ""),
        row.z_score != null ? row.z_score.toFixed(4) : "",
        row.price_change_pct != null ? row.price_change_pct.toFixed(4) : "",
        row.forward_return_1d != null ? row.forward_return_1d.toFixed(4) : "",
        row.forward_return_1w != null ? row.forward_return_1w.toFixed(4) : "",
        row.forward_return_1m != null ? row.forward_return_1m.toFixed(4) : "",
        ...snapKeys.map(k => {
          const v = (snap as any)[k];
          if (v === null || v === undefined) return "";
          if (typeof v === "boolean") return String(v);
          if (typeof v === "number") return isFinite(v) ? v.toFixed(4) : "";
          return escCsv(v);
        }),
      ];
      res.write(cells.join(",") + "\n");
    }

    res.end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Batch Scanner — full-universe background training data collector
// ---------------------------------------------------------------------------

const SCANNER_UNIVERSE = GLOBAL_MARKETS
  .flatMap(m => m.stocks.map(s => s.symbol))
  .filter(sym => !sym.startsWith('SPSX'));

const batchScanner = new BatchScanner(SCANNER_UNIVERSE, 30);

app.get("/api/batch-scanner/status", (_req, res) => {
  const trainingRows = getTrainingDataset();
  const eventRows = trainingRows.filter(r => r.label === 1).length;
  const nonEventRows = trainingRows.filter(r => r.label === 0).length;
  return res.json({
    ...batchScanner.getStatus(),
    trainingRows: trainingRows.length,
    eventRows,
    nonEventRows,
  });
});

app.post("/api/batch-scanner/start", (_req, res) => {
  // Fire-and-forget — start() runs the loop in the background
  batchScanner.start().catch(err => {
    console.error("[BatchScanner] Unhandled error during universe scan:", err);
  });
  return res.json({ started: true, status: batchScanner.getStatus() });
});

app.post("/api/batch-scanner/stop", (_req, res) => {
  batchScanner.stop();
  return res.json({ stopped: true, status: batchScanner.getStatus() });
});

// Configure Vite middleware or production build output serving
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: false // Prevent opening separate WebSocket listeners that trigger port conflicts
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const serverInstance = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SYS] Server running on http://localhost:${PORT}`);
  });

  serverInstance.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[ERR] Port ${PORT} is already in use. This commonly occurs during rapid live-reloads before the old process exits. Please wait a moment or restart the dev server.`);
    } else {
      console.error("[ERR] Server error encountered:", err);
    }
  });
}

startServer();
