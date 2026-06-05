import React, { useState, useEffect } from "react";
import { StockPoint, StockAnalysis } from "../types";
import {
  TrendingUp,
  TrendingDown,
  Sparkles,
  Award,
  ShieldAlert,
  Calendar,
  Zap,
  CheckCircle,
  HelpCircle,
  Clock,
  Loader2,
  Filter,
  Globe,
  Search,
  ArrowUpDown,
  Copy,
  Check,
  ArrowLeft,
  ArrowRight,
  Volume2,
  VolumeX,
  ExternalLink,
  Youtube,
  Database,
  CheckCircle2,
  XCircle,
  Edit3,
  Building,
  Activity,
  Landmark,
  Briefcase,
} from "lucide-react";
import { safeToLocaleDateString } from "../utils/dateUtils";

interface AnomalyFeedProps {
  anomalies: StockPoint[];
  symbol: string;
  selectedAnomalyDate: string | null;
  onSelectAnomaly: (date: string) => void;
  onAnalyzeAnomaly: (
    date: string,
    returnVal: number,
    zScore: number,
  ) => Promise<void>;
  analyzingDates: string[];
  onSyncSandbox?: (date: string, dailyReturn: number) => void;
}

interface GoldenDatasetVerificationProps {
  cacheKey: string;
  isVerified?: boolean;
  initialCatalyst: string;
}

function GoldenDatasetVerification({
  cacheKey,
  isVerified,
  initialCatalyst,
}: GoldenDatasetVerificationProps) {
  const [correctedText, setCorrectedText] = useState(initialCatalyst);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifiedState, setVerifiedState] = useState(isVerified);

  const handleVerify = async (verified: boolean) => {
    setLoading(true);
    try {
      const response = await fetch("/api/verify-anomaly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cacheKey,
          isVerified: verified,
          correctedCatalyst: isEditing ? correctedText : undefined,
        }),
      });
      if (response.ok) {
        setVerifiedState(verified);
        setIsEditing(false);
      } else {
        console.error("Verification failed");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (verifiedState) {
    return (
      <div className="bg-emerald-950/20 p-3 rounded-lg border border-emerald-900/30 flex items-center justify-between gap-2 mt-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span className="text-xs text-emerald-400 font-mono">
            Golden Dataset: Human Verified
          </span>
        </div>
        <button
          onClick={() => setVerifiedState(false)}
          className="text-[10px] text-zinc-500 hover:text-zinc-300 underline"
        >
          Undo
        </button>
      </div>
    );
  }

  return (
    <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-900/70 space-y-3 mt-2">
      <div className="text-[9px] font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
        <Database className="w-3.5 h-3.5" />
        Golden Dataset Review
      </div>

      {isEditing ? (
        <textarea
          className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-xs text-zinc-300 font-sans custom-scrollbar"
          rows={3}
          value={correctedText || ""}
          onChange={(e) => setCorrectedText(e.target.value)}
          placeholder="Correct the catalyst here before verifying..."
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          disabled={loading}
          onClick={() => handleVerify(true)}
          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-emerald-950/30 hover:bg-emerald-900/50 text-[11px] font-mono text-emerald-400 transition-all border border-emerald-800 disabled:opacity-50"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Verify (Golden)
        </button>
        <button
          disabled={loading}
          onClick={() => handleVerify(false)}
          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-rose-950/30 hover:bg-rose-900/50 text-[11px] font-mono text-rose-400 transition-all border border-rose-800 disabled:opacity-50"
        >
          <XCircle className="w-3.5 h-3.5" />
          Reject (Hallucination)
        </button>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-blue-950/30 hover:bg-blue-900/50 text-[11px] font-mono text-blue-400 transition-all border border-blue-800"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Correct Hypothesis
          </button>
        )}
      </div>
    </div>
  );
}

export default function AnomalyFeed({
  anomalies,
  symbol,
  selectedAnomalyDate,
  onSelectAnomaly,
  onAnalyzeAnomaly,
  analyzingDates,
  onSyncSandbox,
}: AnomalyFeedProps) {
  const [filterType, setFilterType] = useState<
    "all" | "positive" | "negative" | "analyzed"
  >("all");
  const [eventSearch, setEventSearch] = useState("");
  const [eventSortBy, setEventSortBy] = useState<string>("date-desc");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [copiedDates, setCopiedDates] = useState<Record<string, boolean>>({});
  const [isPlayingTTSFor, setIsPlayingTTSFor] = useState<string | null>(null);

  const itemsPerPage = 5;

  // Whenever filters change, reset back to page 1
  useEffect(() => {
    setCurrentPage(1);
  }, [filterType, eventSearch, eventSortBy, symbol]);

  // Cleanup TTS on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  const handleCopyText = (date: string, analysisObj: any) => {
    if (!analysisObj) return;
    const reportText = `Stock: ${symbol} | Date: ${date} | Catalyst Tag: ${analysisObj.primary_catalyst_tag}
Suspected Catalyst: ${analysisObj.suspected_catalyst}
Key Risk: ${analysisObj.key_risk}
Internet Findings: ${analysisObj.internet_findings || "N/A"}`;

    navigator.clipboard.writeText(reportText).then(() => {
      setCopiedDates((prev) => ({ ...prev, [date]: true }));
      setTimeout(() => {
        setCopiedDates((prev) => ({ ...prev, [date]: false }));
      }, 2000);
    });
  };

  const handleCopyMarkdown = (date: string, analysisObj: any) => {
    if (!analysisObj) return;
    const md = `### Catalyst Attribution Report: ${symbol} (${date})
- **Primary Catalyst Tag**: \`${analysisObj.primary_catalyst_tag}\`
- **Severity Score**: \`${analysisObj.severity_score}/100\`
- **Attribution Confidence**: \`${analysisObj.confidence_score}%\`

#### Suspected Catalyst Trajectory
> ${analysisObj.suspected_catalyst}

#### Outlook Risk Vectors
- ${analysisObj.key_risk}

#### Grounded Search Discoveries
* ${analysisObj.internet_findings || "N/A"}

#### Alternative Data Synthesized Insights (Intensity: ${analysisObj.alternative_data_score || "N/A"}/100)
* ${analysisObj.alternative_data_observations || "N/A"}

#### Corporate Governance & 8-K Insights (Severity: ${analysisObj.corporate_governance_score || "N/A"}/100)
* ${analysisObj.corporate_governance_observations || "N/A"}

#### Macroeconomic Observations (Stress/Impact: ${analysisObj.macroeconomic_score || "N/A"}/100)
* ${analysisObj.macroeconomic_observations || "N/A"}

#### Market Structure & Liquidity Review (Severity: ${analysisObj.market_structure_score || "N/A"}/100)
* ${analysisObj.market_structure_observations || "N/A"}

#### Company Fundamentals & Earnings (Impact: ${analysisObj.fundamental_and_earnings_score || "N/A"}/100)
* ${analysisObj.fundamental_and_earnings_observations || "N/A"}

#### Correlation Review (Causality Confidence: ${analysisObj.correlation_confidence || "N/A"}%)
* ${analysisObj.coincidence_vs_correlation || "N/A"}`;

    navigator.clipboard.writeText(md).then(() => {
      setCopiedDates((prev) => ({ ...prev, [`${date}_md`]: true }));
      setTimeout(() => {
        setCopiedDates((prev) => ({ ...prev, [`${date}_md`]: false }));
      }, 2000);
    });
  };

  const handleToggleSpeak = (date: string, text: string) => {
    if (isPlayingTTSFor === date) {
      window.speechSynthesis.cancel();
      setIsPlayingTTSFor(null);
    } else {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.onend = () => {
        setIsPlayingTTSFor(null);
      };
      utterance.onerror = () => {
        setIsPlayingTTSFor(null);
      };
      setIsPlayingTTSFor(date);
      window.speechSynthesis.speak(utterance);
    }
  };

  // Filter events based on positive/negative/analyzed selection
  let processedEvents = anomalies.filter((item) => {
    if (filterType === "positive") return item.dailyReturn > 0;
    if (filterType === "negative") return item.dailyReturn < 0;
    if (filterType === "analyzed") return item.hasAnalysis;
    return true;
  });

  // Filter events by freeform text keyword
  if (eventSearch.trim() !== "") {
    const q = eventSearch.toLowerCase();
    processedEvents = processedEvents.filter((item) => {
      const dateMatch = item.date.includes(q);
      const tagMatch =
        item.analysis?.primary_catalyst_tag?.toLowerCase().includes(q) || false;
      const suspectedMatch =
        item.analysis?.suspected_catalyst?.toLowerCase().includes(q) || false;
      const riskMatch =
        item.analysis?.key_risk?.toLowerCase().includes(q) || false;
      const findingsMatch =
        item.analysis?.internet_findings?.toLowerCase().includes(q) || false;
      const altDataMatch =
        item.analysis?.alternative_data_observations?.toLowerCase().includes(q) || false;
      const corpGovMatch =
        item.analysis?.corporate_governance_observations?.toLowerCase().includes(q) || false;
      const macroMatch =
        item.analysis?.macroeconomic_observations?.toLowerCase().includes(q) || false;
      const marketStructMatch =
        item.analysis?.market_structure_observations?.toLowerCase().includes(q) || false;
      const fundamentalMatch =
        item.analysis?.fundamental_and_earnings_observations?.toLowerCase().includes(q) || false;
      return (
        dateMatch || tagMatch || suspectedMatch || riskMatch || findingsMatch || altDataMatch || corpGovMatch || macroMatch || marketStructMatch || fundamentalMatch
      );
    });
  }

  // Sort events by designated metrics parameters
  processedEvents = [...processedEvents].sort((a, b) => {
    if (eventSortBy === "date-desc") {
      return b.date.localeCompare(a.date);
    }
    if (eventSortBy === "date-asc") {
      return a.date.localeCompare(b.date);
    }
    if (eventSortBy === "catalyst-alpha") {
      const tagA = (a.analysis?.primary_catalyst_tag || "").toLowerCase();
      const tagB = (b.analysis?.primary_catalyst_tag || "").toLowerCase();
      if (!tagA) return 1;
      if (!tagB) return -1;
      return tagA.localeCompare(tagB);
    }
    if (eventSortBy === "narrative-alpha") {
      const narA = (a.analysis?.suspected_catalyst || "").toLowerCase();
      const narB = (b.analysis?.suspected_catalyst || "").toLowerCase();
      if (!narA) return 1;
      if (!narB) return -1;
      return narA.localeCompare(narB);
    }
    if (eventSortBy === "severity-desc") {
      const sevA = a.analysis?.severity_score ?? -1;
      const sevB = b.analysis?.severity_score ?? -1;
      return sevB - sevA;
    }
    if (eventSortBy === "confidence-desc") {
      const confA = a.analysis?.confidence_score ?? -1;
      const confB = b.analysis?.confidence_score ?? -1;
      return confB - confA;
    }
    if (eventSortBy === "horizon-1d") {
      const scoreA = Number(
        a.analysis?.effect_score_1d ?? a.analysis?.return_1d ?? -9999,
      );
      const scoreB = Number(
        b.analysis?.effect_score_1d ?? b.analysis?.return_1d ?? -9999,
      );
      return scoreB - scoreA;
    }
    if (eventSortBy === "horizon-1w") {
      const scoreA = Number(
        a.analysis?.effect_score_1w ?? a.analysis?.return_1w ?? -9999,
      );
      const scoreB = Number(
        b.analysis?.effect_score_1w ?? b.analysis?.return_1w ?? -9999,
      );
      return scoreB - scoreA;
    }
    if (eventSortBy === "horizon-1m") {
      const scoreA = Number(
        a.analysis?.effect_score_1m ?? a.analysis?.return_1m ?? -9999,
      );
      const scoreB = Number(
        b.analysis?.effect_score_1m ?? b.analysis?.return_1m ?? -9999,
      );
      return scoreB - scoreA;
    }
    if (eventSortBy === "horizon-6m") {
      const scoreA = Number(
        a.analysis?.effect_score_6m ?? a.analysis?.return_6m ?? -9999,
      );
      const scoreB = Number(
        b.analysis?.effect_score_6m ?? b.analysis?.return_6m ?? -9999,
      );
      return scoreB - scoreA;
    }
    if (eventSortBy === "horizon-1y") {
      const scoreA = Number(
        a.analysis?.effect_score_1y ?? a.analysis?.return_1y ?? -9999,
      );
      const scoreB = Number(
        b.analysis?.effect_score_1y ?? b.analysis?.return_1y ?? -9999,
      );
      return scoreB - scoreA;
    }
    return 0;
  });

  const getTagColor = (tag: string | undefined) => {
    const t = (tag || "").toLowerCase();
    if (t.includes("earnings") || t.includes("report"))
      return "bg-blue-500/10 text-blue-300 border-blue-500/30";
    if (t.includes("product") || t.includes("launch"))
      return "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
    if (t.includes("regulat") || t.includes("law"))
      return "bg-amber-500/10 text-amber-300 border-amber-500/30";
    if (t.includes("macro") || t.includes("fed") || t.includes("interest"))
      return "bg-purple-500/10 text-purple-300 border-purple-500/30";
    if (t.includes("statement") || t.includes("ceo") || t.includes("tweet"))
      return "bg-sky-500/10 text-sky-300 border-sky-500/30";
    if (t.includes("merger") || t.includes("acqui"))
      return "bg-pink-500/10 text-pink-300 border-pink-500/30";
    return "bg-zinc-800 text-zinc-300 border-zinc-700";
  };

  return (
    <div
      id="anomaly-feed-container"
      className="flex flex-col h-full bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-sm"
    >
      {/* Header and Filter */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 pb-4 border-b border-zinc-800/60">
        <div>
          <span className="text-[10px] tracking-wider uppercase text-zinc-500 font-mono block">
            Outlying Indexes
          </span>
          <h2 className="text-base font-bold text-zinc-100 tracking-tight flex items-center gap-2 mt-0.5">
            <Zap className="w-4 h-4 text-blue-500" />
            Detected Statistical Spikes
          </h2>
        </div>

        {/* Filter buttons */}
        <div className="flex flex-wrap gap-1.5 bg-zinc-950 p-1 rounded-lg border border-zinc-800/80 self-end md:self-auto">
          <button
            id="filter-all-spikes"
            onClick={() => setFilterType("all")}
            className={`px-2.5 py-1 rounded text-[11px] font-mono transition-all cursor-pointer ${
              filterType === "all"
                ? "bg-zinc-800 text-zinc-200"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            All ({anomalies.length})
          </button>
          <button
            id="filter-positive-spikes"
            onClick={() => setFilterType("positive")}
            className={`px-2.5 py-1 rounded text-[11px] font-mono transition-all cursor-pointer ${
              filterType === "positive"
                ? "bg-emerald-950/60 text-emerald-400 border border-emerald-900/30"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Spikes
          </button>
          <button
            id="filter-negative-spikes"
            onClick={() => setFilterType("negative")}
            className={`px-2.5 py-1 rounded text-[11px] font-mono transition-all cursor-pointer ${
              filterType === "negative"
                ? "bg-rose-950/60 text-rose-450 border border-rose-900/30"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Drops
          </button>
          <button
            id="filter-analyzed-spikes"
            onClick={() => setFilterType("analyzed")}
            className={`px-2.5 py-1 rounded text-[11px] font-mono transition-all cursor-pointer ${
              filterType === "analyzed"
                ? "bg-blue-950/60 text-blue-400 border border-blue-900/30"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            AI Resolved
          </button>
        </div>
      </div>

      {/* Structured Search & Sort Control Deck */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5 bg-zinc-950/45 p-3 rounded-lg border border-zinc-850">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search events, catalyst tags, etc..."
            value={eventSearch}
            onChange={(e) => setEventSearch(e.target.value)}
            className="w-full bg-zinc-950 text-zinc-150 pl-9 pr-3 py-1.5 rounded border border-zinc-800 text-xs focus:outline-none placeholder-zinc-650 font-sans focus:border-zinc-700"
          />
        </div>

        <div className="relative flex items-center bg-zinc-950 px-2.5 py-1.5 rounded border border-zinc-800">
          <ArrowUpDown className="w-3.5 h-3.5 text-zinc-500 mr-2 shrink-0" />
          <select
            value={eventSortBy}
            onChange={(e) => setEventSortBy(e.target.value)}
            className="bg-transparent text-zinc-350 text-xs font-sans focus:outline-none w-full cursor-pointer pr-4"
          >
            <option value="date-desc" className="bg-zinc-900 text-zinc-200">
              Date: Newest to Oldest
            </option>
            <option value="date-asc" className="bg-zinc-900 text-zinc-200">
              Date: Oldest to Newest
            </option>
            <option
              value="catalyst-alpha"
              className="bg-zinc-900 text-zinc-300"
            >
              Catalyst Tag (Alphabetical)
            </option>
            <option
              value="narrative-alpha"
              className="bg-zinc-900 text-zinc-300"
            >
              Narrative text (Alphabetical)
            </option>
            <option value="severity-desc" className="bg-zinc-900 text-zinc-300">
              Severity Score (High to Low)
            </option>
            <option
              value="confidence-desc"
              className="bg-zinc-900 text-zinc-300"
            >
              Confidence Score (High to Low)
            </option>
            <option value="horizon-1d" className="bg-zinc-900 text-zinc-300">
              1-Day Horizon return/score
            </option>
            <option value="horizon-1w" className="bg-zinc-900 text-zinc-300">
              1-Week Horizon Return/Score
            </option>
            <option value="horizon-1m" className="bg-zinc-900 text-zinc-300">
              1-Month Horizon Return/Score
            </option>
            <option value="horizon-6m" className="bg-zinc-900 text-zinc-300">
              6-Month Horizon Return/Score
            </option>
            <option value="horizon-1y" className="bg-zinc-900 text-zinc-300">
              1-Year Horizon Return/Score
            </option>
          </select>
        </div>
      </div>

      {/* Outliers Feed Scrollbox */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-4 max-h-[550px] scrollbar-thin scrollbar-thumb-zinc-800">
        {processedEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
            <Filter className="w-8 h-8 opacity-25 mb-3 text-zinc-600" />
            <p className="text-xs font-mono">No matching event logs found.</p>
          </div>
        ) : (
          (() => {
            const totalPages = Math.ceil(processedEvents.length / itemsPerPage);
            const paginatedEvents = processedEvents.slice(
              (currentPage - 1) * itemsPerPage,
              currentPage * itemsPerPage,
            );
            return (
              <>
                {paginatedEvents.map((item) => {
                  const isSelected = selectedAnomalyDate === item.date;
                  const isPositive = item.dailyReturn > 0;
                  const isAnalyzing = analyzingDates.includes(item.date);

                  return (
                    <div
                      id={`anomaly-card-${item.date}`}
                      key={item.date}
                      onClick={() => onSelectAnomaly(item.date)}
                      className={`group border rounded-xl p-5 transition-all cursor-pointer ${
                        isSelected
                          ? "bg-zinc-850/40 border-blue-500/60 shadow-sm ring-1 ring-blue-500/20"
                          : "bg-zinc-950/45 border-zinc-800/80 hover:bg-zinc-800/20 hover:border-zinc-700/80"
                      }`}
                    >
                      {/* Metric Summary row */}
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={`p-2 rounded-lg ${
                              isPositive
                                ? "bg-emerald-500/10 text-emerald-400"
                                : "bg-rose-500/10 text-rose-400"
                            }`}
                          >
                            {isPositive ? (
                              <TrendingUp className="w-4 h-4" />
                            ) : (
                              <TrendingDown className="w-4 h-4" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-sans font-bold text-zinc-150 group-hover:text-blue-400 transition-colors">
                                {item.date}
                              </span>
                              <span className="font-mono text-[10px] bg-zinc-950 border border-zinc-800 px-2 py-0.5 rounded text-zinc-400">
                                Z: {item.zScore.toFixed(2)}&sigma;
                              </span>
                            </div>
                            <div className="text-zinc-400 text-xs mt-0.5 font-sans">
                              Closing price reached{" "}
                              <strong className="text-zinc-200">
                                ${item.close.toFixed(2)}
                              </strong>
                            </div>
                          </div>
                        </div>

                        {/* Return tag */}
                        <div className="text-right">
                          <span
                            className={`font-mono text-sm font-bold select-none ${
                              isPositive ? "text-emerald-400" : "text-rose-400"
                            }`}
                          >
                            {isPositive ? "+" : ""}
                            {item.dailyReturn.toFixed(2)}%
                          </span>
                          <div className="font-mono text-[9px] text-zinc-500 mt-1">
                            Vol: {(item.volume / 1000000).toFixed(1)}M shares
                          </div>
                        </div>
                      </div>

                      {/* AI Catalyst Analysis Box */}
                      <div className="mt-4 pt-4 border-t border-zinc-850">
                        {item.hasAnalysis && item.analysis ? (
                          <div className="space-y-4 font-sans">
                            {/* Top Tag & Confidence Indicators */}
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-zinc-950 p-2.5 rounded-lg border border-zinc-805">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`text-[9px] uppercase tracking-wider font-semibold border px-2 py-0.5 rounded ${getTagColor(
                                    item.analysis.primary_catalyst_tag,
                                  )}`}
                                >
                                  {item.analysis.primary_catalyst_tag}
                                </span>

                                {/* Feature: Copy simple text findings */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopyText(item.date, item.analysis);
                                  }}
                                  className="p-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all cursor-pointer"
                                  title="Copy simple text findings"
                                >
                                  {copiedDates[item.date] ? (
                                    <Check className="w-3 h-3 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>

                                {/* Feature: Copy Markdown Report */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopyMarkdown(
                                      item.date,
                                      item.analysis,
                                    );
                                  }}
                                  className="p-1 px-1.5 rounded bg-zinc-900 border border-zinc-800 text-purple-400 hover:text-purple-200 transition-all cursor-pointer flex items-center gap-1 text-[9.5px] font-mono leading-none"
                                  title="Copy analysis as clean Markdown report"
                                >
                                  {copiedDates[item.date + "_md"] ? (
                                    <Check className="w-3 h-3 text-emerald-450" />
                                  ) : (
                                    <span className="flex items-center gap-1">
                                      <Copy className="w-2.5 h-2.5" />
                                      <span>Copy MD</span>
                                    </span>
                                  )}
                                </button>

                                {/* Feature: Read Catalyst Aloud (Speech Synthesizer) */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleSpeak(
                                      item.date,
                                      item.analysis.suspected_catalyst,
                                    );
                                  }}
                                  className={`p-1 px-1.5 rounded border transition-all cursor-pointer flex items-center gap-1 text-[9.5px] font-mono leading-none ${
                                    isPlayingTTSFor === item.date
                                      ? "bg-amber-955/40 border-amber-800 text-amber-400 animate-pulse"
                                      : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-250 hover:bg-zinc-800"
                                  }`}
                                  title="Listen/Read Catalyst aloud with Narrator Speech Synthesizer"
                                >
                                  {isPlayingTTSFor === item.date ? (
                                    <>
                                      <VolumeX className="w-2.5 h-2.5 text-amber-400" />
                                      <span>Stop Voice</span>
                                    </>
                                  ) : (
                                    <>
                                      <Volume2 className="w-2.5 h-2.5 text-zinc-400" />
                                      <span>Speak</span>
                                    </>
                                  )}
                                </button>

                                {/* Feature: Sync with Return Sandbox */}
                                {onSyncSandbox && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onSyncSandbox(
                                        item.date,
                                        item.dailyReturn,
                                      );
                                    }}
                                    className="p-1 px-1.5 rounded bg-amber-955/20 border border-amber-900/40 text-amber-500 hover:text-amber-300 transition-all cursor-pointer flex items-center gap-1 text-[9.5px] font-mono leading-none shrink-0"
                                    title="Auto-fill this trading shock in What-If Stress Simulator"
                                  >
                                    <Zap className="w-2.5 h-2.5 animate-pulse" />
                                    <span>Sync Simulator</span>
                                  </button>
                                )}
                              </div>

                              {/* VisualSliders/Horizontal Gauge indications */}
                              <div className="flex items-center gap-4 text-[10px] font-mono text-zinc-450 w-full sm:w-auto shrink-0">
                                <div className="flex flex-col gap-0.5 w-[76px] sm:w-[90px]">
                                  <div className="flex justify-between items-center text-[8.5px]">
                                    <span>SEVERITY:</span>
                                    <span
                                      className={`font-bold ${item.analysis.severity_score > 70 ? "text-rose-450" : item.analysis.severity_score > 40 ? "text-amber-450" : "text-emerald-400"}`}
                                    >
                                      {item.analysis.severity_score}/100
                                    </span>
                                  </div>
                                  <div className="w-full bg-zinc-900 h-1 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${item.analysis.severity_score > 70 ? "bg-rose-500" : item.analysis.severity_score > 40 ? "bg-amber-500" : "bg-emerald-500"}`}
                                      style={{
                                        width: `${item.analysis.severity_score}%`,
                                      }}
                                    />
                                  </div>
                                </div>

                                <div className="flex flex-col gap-0.5 w-[76px] sm:w-[90px]">
                                  <div className="flex justify-between items-center text-[8.5px]">
                                    <span>CONFIDENCE:</span>
                                    <span className="text-blue-400 font-bold">
                                      {item.analysis.confidence_score}%
                                    </span>
                                  </div>
                                  <div className="w-full bg-zinc-900 h-1 rounded-full overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-blue-500"
                                      style={{
                                        width: `${item.analysis.confidence_score}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Catalyst Explanation */}
                            <p className="text-xs text-zinc-300 leading-relaxed font-sans mt-1">
                              {item.analysis.suspected_catalyst}
                            </p>

                            {/* Multi-Period Comparative Dashboard (1d, 1w, 1m, 6m, 1y) */}
                            <div className="grid grid-cols-5 gap-1.5 mt-2">
                              {[
                                {
                                  label: "1 Day",
                                  val: item.analysis.return_1d,
                                  score: item.analysis.effect_score_1d,
                                },
                                {
                                  label: "1 Week",
                                  val: item.analysis.return_1w,
                                  score: item.analysis.effect_score_1w,
                                },
                                {
                                  label: "1 Month",
                                  val: item.analysis.return_1m,
                                  score: item.analysis.effect_score_1m,
                                },
                                {
                                  label: "6 Months",
                                  val: item.analysis.return_6m,
                                  score: item.analysis.effect_score_6m,
                                },
                                {
                                  label: "1 Year",
                                  val: item.analysis.return_1y,
                                  score: item.analysis.effect_score_1y,
                                },
                              ].map((period, pIdx) => (
                                <div
                                  key={pIdx}
                                  className="flex flex-col items-center bg-zinc-950 p-2 rounded border border-zinc-850 text-center font-mono"
                                >
                                  <span className="text-[8px] text-zinc-500 uppercase font-semibold">
                                    {period.label}
                                  </span>

                                  {/* Actual Return */}
                                  <span
                                    className={`text-[10px] font-bold mt-1 ${
                                      period.val !== undefined
                                        ? period.val >= 0
                                          ? "text-emerald-400"
                                          : "text-rose-455"
                                        : "text-zinc-650"
                                    }`}
                                  >
                                    {period.val !== undefined
                                      ? `${period.val >= 0 ? "+" : ""}${period.val.toFixed(1)}%`
                                      : "N/A"}
                                  </span>

                                  {/* Effect score */}
                                  <div className="w-full mt-1.5 pt-1.5 border-t border-zinc-900/50 flex flex-col items-center">
                                    <span className="text-[7.5px] text-zinc-550">
                                      AI Effect
                                    </span>
                                    <span
                                      className={`text-[10px] font-bold mt-0.5 ${
                                        period.score !== undefined
                                          ? period.score >= 0
                                            ? "text-emerald-350"
                                            : "text-rose-400"
                                          : "text-zinc-600"
                                      }`}
                                    >
                                      {period.score !== undefined
                                        ? `${period.score >= 0 ? "+" : ""}${period.score}`
                                        : "N/A"}
                                    </span>
                                    {period.score !== undefined && (
                                      <div className="w-full bg-zinc-900 h-0.75 rounded-full overflow-hidden mt-1 max-w-[32px]">
                                        <div
                                          className={`h-full ${period.score >= 0 ? "bg-emerald-550" : "bg-rose-500"}`}
                                          style={{
                                            width: `${Math.min(100, Math.abs(period.score))}%`,
                                          }}
                                        />
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>

                            {item.analysis.newsList && item.analysis.newsList.length > 0 && (
                              <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-900/70 mt-2">
                                <div className="text-[9px] font-bold text-violet-400 uppercase tracking-wider flex items-center gap-1.5 font-mono mb-2">
                                  <Globe className="w-3.5 h-3.5" />
                                  Relevant News Articles
                                </div>
                                <div className="space-y-2">
                                  {item.analysis.newsList.map((article: any, idx: number) => {
                                    let sentimentColor = "bg-zinc-800 text-zinc-400";
                                    if (article.sentiment === "positive") sentimentColor = "bg-emerald-900/40 text-emerald-400";
                                    else if (article.sentiment === "negative") sentimentColor = "bg-rose-900/40 text-rose-400";

                                    return (
                                      <div key={idx} className="bg-zinc-900/50 p-2 rounded flex flex-col gap-1 border border-zinc-800/60">
                                        <div className="flex justify-between items-start">
                                          <a href={article.url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-blue-300 hover:text-blue-200 line-clamp-2">
                                            {article.title}
                                          </a>
                                          {article.sentiment && (
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded ml-2 uppercase font-mono ${sentimentColor}`}>
                                              {article.sentiment}
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-sans">
                                          <span>{article.sourceName}</span>
                                          <span>•</span>
                                          <span>{safeToLocaleDateString(article.publishedAt)}</span>
                                          {article.relevanceScore !== undefined && (
                                            <>
                                              <span>•</span>
                                              <span>Score: {(article.relevanceScore * 100).toFixed(0)}</span>
                                            </>
                                          )}
                                        </div>
                                        {article.description && (
                                          <p className="text-[10px] text-zinc-400 line-clamp-2 mt-1">
                                            {article.description}
                                          </p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Grounded Web News Discovery Findings */}
                            {item.analysis.internet_findings && (
                              <div className="bg-blue-950/10 p-3 rounded-lg border border-blue-900/20">
                                <div className="text-[9px] font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5 font-mono mb-1">
                                  <Globe className="w-3 h-3 text-blue-400" />
                                  Search Grounded News Intelligence
                                </div>
                                <p className="text-xs text-zinc-350 leading-relaxed font-sans">
                                  {item.analysis.internet_findings}
                                </p>
                              </div>
                            )}

                            {/* Alternative Data Observations */}
                            {item.analysis.alternative_data_observations && (
                              <div className="bg-emerald-950/10 p-3 rounded-lg border border-emerald-900/20 mt-2">
                                <div className="flex items-center justify-between mb-1">
                                  <div className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                                    <Globe className="w-3 h-3 text-emerald-400" />
                                    Alternative Data Synthesized Insights
                                  </div>
                                  {item.analysis.alternative_data_score !==
                                    undefined && (
                                    <div className="text-[10px] font-mono text-emerald-300 font-bold bg-emerald-900/40 px-1.5 py-0.5 rounded">
                                      {item.analysis.alternative_data_score}/100
                                      Intensity
                                    </div>
                                  )}
                                </div>
                                <p className="text-xs text-zinc-350 leading-relaxed font-sans">
                                  {item.analysis.alternative_data_observations}
                                </p>
                              </div>
                            )}

                            {/* Corporate Governance Observations */}
                            {item.analysis
                              .corporate_governance_observations && (
                              <div className="bg-amber-950/10 p-3 rounded-lg border border-amber-900/20 mt-2">
                                <div className="flex items-center justify-between mb-1">
                                  <div className="text-[9px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                                    <Building className="w-3 h-3 text-amber-400" />
                                    Corporate Governance & 8-K Insights
                                  </div>
                                  {item.analysis.corporate_governance_score !==
                                    undefined && (
                                    <div className="text-[10px] font-mono text-amber-300 font-bold bg-amber-900/40 px-1.5 py-0.5 rounded">
                                      {item.analysis.corporate_governance_score}
                                      /100 Severity
                                    </div>
                                  )}
                                </div>
                                <p className="text-xs text-zinc-350 leading-relaxed font-sans">
                                  {
                                    item.analysis
                                      .corporate_governance_observations
                                  }
                                </p>
                              </div>
                            )}

                            {/* Macroeconomic Observations */}
                            {item.analysis
                              .macroeconomic_observations && (
                              <div className="bg-rose-950/10 p-3 rounded-lg border border-rose-900/20 mt-2">
                                <div className="flex items-center justify-between mb-1">
                                  <div className="text-[9px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                                    <Landmark className="w-3 h-3 text-rose-400" />
                                    Macroeconomic Context
                                  </div>
                                  {item.analysis.macroeconomic_score !==
                                    undefined && (
                                    <div className="text-[10px] font-mono text-rose-300 font-bold bg-rose-900/40 px-1.5 py-0.5 rounded">
                                      {item.analysis.macroeconomic_score}
                                      /100 Severity
                                    </div>
                                  )}
                                </div>
                                <p className="text-xs text-zinc-350 leading-relaxed font-sans">
                                  {
                                    item.analysis
                                      .macroeconomic_observations
                                  }
                                </p>
                              </div>
                            )}

                            {/* Market Structure Observations */}
                            {item.analysis
                              .market_structure_observations && (
                              <div className="bg-purple-950/10 p-3 rounded-lg border border-purple-900/20 mt-2">
                                <div className="flex items-center justify-between mb-1">
                                  <div className="text-[9px] font-bold text-purple-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                                    <Activity className="w-3 h-3 text-purple-400" />
                                    Market Structure & Trends
                                  </div>
                                  {item.analysis.market_structure_score !==
                                    undefined && (
                                    <div className="text-[10px] font-mono text-purple-300 font-bold bg-purple-900/40 px-1.5 py-0.5 rounded">
                                      {item.analysis.market_structure_score}
                                      /100 Intensity
                                    </div>
                                  )}
                                </div>
                                <p className="text-xs text-zinc-350 leading-relaxed font-sans">
                                  {
                                    item.analysis
                                      .market_structure_observations
                                  }
                                </p>
                              </div>
                            )}

                            {/* Fundamental & Earnings Observations */}
                            {item.analysis
                              .fundamental_and_earnings_observations && (
                              <div className="bg-sky-950/10 p-3 rounded-lg border border-sky-900/20 mt-2">
                                <div className="flex items-center justify-between mb-1">
                                  <div className="text-[9px] font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                                    <Briefcase className="w-3 h-3 text-sky-400" />
                                    Company Fundamentals & Earnings
                                  </div>
                                  {item.analysis.fundamental_and_earnings_score !==
                                    undefined && (
                                    <div className="text-[10px] font-mono text-sky-300 font-bold bg-sky-900/40 px-1.5 py-0.5 rounded">
                                      {item.analysis.fundamental_and_earnings_score}
                                      /100 Impact
                                    </div>
                                  )}
                                </div>
                                <p className="text-xs text-zinc-350 leading-relaxed font-sans">
                                  {
                                    item.analysis
                                      .fundamental_and_earnings_observations
                                  }
                                </p>
                              </div>
                            )}

                            {/* Coincidence vs Correlation Evaluation */}
                            {item.analysis.coincidence_vs_correlation && (
                              <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-900/60">
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-1.5 mb-1.5">
                                  <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                                    <HelpCircle className="w-3 h-3 text-blue-450" />
                                    Causal Attribution Review
                                  </div>
                                  {item.analysis.correlation_confidence !==
                                    undefined && (
                                    <span className="text-[9.5px] font-mono text-zinc-500">
                                      Link Confidence:{" "}
                                      <strong className="text-zinc-200">
                                        {item.analysis.correlation_confidence}%
                                      </strong>
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                                  {item.analysis.coincidence_vs_correlation}
                                </p>

                                {item.analysis.correlation_confidence !==
                                  undefined && (
                                  <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden mt-2.5">
                                    <div
                                      className={`h-full rounded-full transition-all ${
                                        item.analysis.correlation_confidence >
                                        75
                                          ? "bg-blue-500"
                                          : item.analysis
                                                .correlation_confidence > 50
                                            ? "bg-purple-500"
                                            : "bg-zinc-650"
                                      }`}
                                      style={{
                                        width: `${item.analysis.correlation_confidence}%`,
                                      }}
                                    />
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Wikipedia Spikes */}
                            {item.analysis.wikipediaSpikes &&
                              item.analysis.wikipediaSpikes.length > 0 && (
                                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-900/70">
                                  <div className="text-[9px] font-bold text-amber-500 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                                    <Globe className="w-3.5 h-3.5" />
                                    Pre-Event Wikipedia Traffic Spike (72H)
                                  </div>
                                  <div className="mt-2 space-y-2">
                                    {item.analysis.wikipediaSpikes.map(
                                      (spike: any, idx: number) => (
                                        <div
                                          key={idx}
                                          className="flex flex-col sm:flex-row justify-between sm:items-center text-xs bg-zinc-900/50 p-2 rounded gap-2"
                                        >
                                          <span className="font-medium text-zinc-300">
                                            "{spike.articleTitle}" (
                                            {spike.queryTopic})
                                          </span>
                                          <div className="flex items-center gap-3">
                                            <div className="text-zinc-500 font-mono text-[10px]">
                                              Baseline:{" "}
                                              {Math.round(
                                                spike.baselineViewsAvg,
                                              )}
                                            </div>
                                            <div className="text-amber-400 font-mono font-bold text-[10px]">
                                              Spike:{" "}
                                              {Math.round(spike.spikeViewsAvg)}
                                            </div>
                                            <div className="bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold">
                                              {spike.spikeRatio.toFixed(1)}x
                                            </div>
                                          </div>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                </div>
                              )}

                            {/* GDELT Events */}
                            {item.analysis.gdeltEvents &&
                              item.analysis.gdeltEvents.length > 0 && (
                                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-900/70">
                                  <div className="text-[9px] font-bold text-violet-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                                    <Globe className="w-3.5 h-3.5" />
                                    Global News Events (GDELT)
                                  </div>
                                  <div className="mt-2 space-y-2">
                                    {item.analysis.gdeltEvents
                                      .slice(0, 3)
                                      .map((evt: any, idx: number) => (
                                        <div
                                          key={idx}
                                          className="flex flex-col sm:flex-row justify-between sm:items-center text-xs bg-zinc-900/50 p-2 rounded gap-2"
                                        >
                                          <div className="flex flex-col">
                                            <span className="font-medium text-zinc-300">
                                              Actor 1: {evt.actor1Name}
                                            </span>
                                            {evt.actor2Name && (
                                              <span className="text-zinc-500">
                                                Actor 2: {evt.actor2Name}
                                              </span>
                                            )}
                                            <span className="text-zinc-500 font-mono text-[10px] mt-1 space-x-2">
                                              <span>
                                                Tone:{" "}
                                                <strong
                                                  className={
                                                    evt.avgTone > 0
                                                      ? "text-emerald-400"
                                                      : evt.avgTone < 0
                                                        ? "text-rose-400"
                                                        : "text-zinc-400"
                                                  }
                                                >
                                                  {evt.avgTone.toFixed(1)}
                                                </strong>
                                              </span>
                                              <span>
                                                Goldstein:{" "}
                                                <strong
                                                  className={
                                                    evt.goldsteinScale > 0
                                                      ? "text-emerald-400"
                                                      : evt.goldsteinScale < 0
                                                        ? "text-rose-400"
                                                        : "text-zinc-400"
                                                  }
                                                >
                                                  {evt.goldsteinScale.toFixed(
                                                    1,
                                                  )}
                                                </strong>
                                              </span>
                                            </span>
                                          </div>
                                          {evt.sourceUrl && (
                                            <a
                                              href={evt.sourceUrl}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="text-violet-400 hover:text-violet-300 flex items-center gap-1 font-mono text-[10px]"
                                            >
                                              Source{" "}
                                              <ExternalLink className="w-3 h-3" />
                                            </a>
                                          )}
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              )}

                            {/* YouTube Transcripts */}
                            {item.analysis.youtubeVideos &&
                              item.analysis.youtubeVideos.length > 0 && (
                                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-900/70">
                                  <div className="text-[9px] font-bold text-red-500 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                                    <Youtube className="w-3.5 h-3.5" />
                                    Executive Intelligence (YouTube Transcripts)
                                  </div>
                                  <div className="mt-2 space-y-2">
                                    {item.analysis.youtubeVideos.map(
                                      (vid: any, idx: number) => (
                                        <div
                                          key={idx}
                                          className="flex flex-col text-xs bg-zinc-900/50 p-2 rounded gap-2"
                                        >
                                          <div className="flex justify-between items-start">
                                            <span className="font-medium text-zinc-300">
                                              {vid.title}
                                            </span>
                                            <a
                                              href={`https://youtube.com/watch?v=${vid.videoId}`}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="text-red-400 hover:text-red-300 flex items-center gap-1 font-mono text-[10px] shrink-0"
                                            >
                                              Watch{" "}
                                              <ExternalLink className="w-3 h-3" />
                                            </a>
                                          </div>
                                          <div className="text-zinc-500 font-mono text-[10px]">
                                            Channel: {vid.channelTitle} •{" "}
                                            {safeToLocaleDateString(vid.publishedAt)}
                                          </div>
                                          {vid.transcript &&
                                            vid.transcript !==
                                              "[No auto-generated transcript available]" && (
                                              <p className="text-xs text-zinc-400 mt-1 italic border-l-2 border-red-500/30 pl-2 max-h-24 overflow-y-auto custom-scrollbar">
                                                "
                                                {vid.transcript.substring(
                                                  0,
                                                  300,
                                                )}
                                                ..."
                                              </p>
                                            )}
                                        </div>
                                      ),
                                    )}
                                  </div>
                                </div>
                              )}

                            {/* Key taking / Risk */}
                            <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-900/70">
                              <div className="text-[9px] font-bold text-rose-500 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                                <ShieldAlert className="w-3.5 h-3.5" />
                                Key Outlook Risk Vector
                              </div>
                              <p className="text-xs text-zinc-400 mt-1 leading-relaxed font-sans">
                                {item.analysis.key_risk}
                              </p>
                            </div>

                            <GoldenDatasetVerification
                              cacheKey={`${symbol.toUpperCase().trim()}_${item.date}`}
                              isVerified={item.analysis.is_human_verified}
                              initialCatalyst={
                                item.analysis.suspected_catalyst || ""
                              }
                            />
                          </div>
                        ) : isAnalyzing ? (
                          <div className="py-4 text-center">
                            <Loader2 className="w-5 h-5 animate-spin text-blue-500 mx-auto" />
                            <p className="text-xs text-zinc-500 mt-2 font-mono italic animate-pulse">
                              Grounded report check... indexing metadata for{" "}
                              {item.date}
                            </p>
                          </div>
                        ) : (
                          <div>
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-950 p-3.5 rounded-lg border border-zinc-805">
                              <p className="text-xs text-zinc-505 max-w-sm font-sans">
                                No historical analysis cached on system storage
                                for this volatile session.
                              </p>
                              <button
                                id={`btn-analyze-${item.date}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAnalyzeAnomaly(
                                    item.date,
                                    item.dailyReturn,
                                    item.zScore,
                                  );
                                }}
                                className="flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded bg-zinc-805 hover:bg-zinc-750 text-[11px] font-mono text-zinc-200 transition-all border border-zinc-700 hover:border-zinc-650 focus:outline-none cursor-pointer"
                              >
                                <Sparkles className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                                Consult AI Historian
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Feature: Table Pagination controls */}
                {totalPages > 1 && (
                  <div className="flex justify-between items-center mt-5 pt-4 border-t border-zinc-805/60 font-mono text-xs text-zinc-400">
                    <button
                      type="button"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 disabled:opacity-30 disabled:hover:bg-zinc-950 transition-all cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      Prev
                    </button>

                    <span className="text-zinc-500">
                      Page{" "}
                      <strong className="text-zinc-200">{currentPage}</strong>{" "}
                      of <strong className="text-zinc-350">{totalPages}</strong>
                    </span>

                    <button
                      type="button"
                      disabled={currentPage === totalPages}
                      onClick={() =>
                        setCurrentPage((p) => Math.min(totalPages, p + 1))
                      }
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 disabled:opacity-30 disabled:hover:bg-zinc-950 transition-all cursor-pointer"
                    >
                      Next
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </>
            );
          })()
        )}
      </div>
    </div>
  );
}
