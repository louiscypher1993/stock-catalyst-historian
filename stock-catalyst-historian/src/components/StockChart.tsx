import React, { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceDot,
  Scatter,
  ScatterChart,
  Brush,
} from "recharts";
import { StockPoint, StockScanResult } from "../types";
import { Activity, Landmark, Sparkles, Grid, ArrowUpDown, Calendar, HelpCircle, Download, Keyboard, Percent, Sliders, ZoomIn, ZoomOut, ChevronLeft, ChevronRight } from "lucide-react";

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const dataPoint = payload[0].payload as StockPoint;
    const isAnomaly = dataPoint.isAnomaly;
    return (
      <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3 shadow-xl max-w-xs text-xs font-sans">
        <p className="font-bold text-zinc-100 mb-1">{label}</p>
        {payload.map((entry: any, index: number) => {
          let name = entry.name;
          let value = entry.value;
          if (name === "close" || name === "normalizedClose") name = "Close Price";
          if (name === "dailyReturn") {
            name = "Daily Return";
            value = `${Number(value).toFixed(2)}%`;
          } else if (typeof value === "number") {
             value = entry.name.toLowerCase().includes("normalized") ? `${value.toFixed(1)}%` : `$${value.toFixed(2)}`;
          }
          return (
            <div key={index} className="flex justify-between items-center tracking-tight mb-1" style={{ color: entry.color }}>
              <span className="opacity-80">{name}:</span>
              <span className="font-mono font-medium">{value}</span>
            </div>
          );
        })}
        {isAnomaly && dataPoint.analysis?.suspected_catalyst && (
          <div className="mt-2 pt-2 border-t border-zinc-800">
            <p className="text-amber-400 font-semibold mb-1 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              AI Event Analysis
            </p>
            <p className="text-zinc-300 text-[10px] leading-relaxed line-clamp-4">
              {dataPoint.analysis.suspected_catalyst}
            </p>
          </div>
        )}
      </div>
    );
  }
  return null;
};

interface StockChartProps {
  points: StockPoint[];
  selectedAnomalyDate: string | null;
  onSelectDate: (date: string) => void;
  currency: string;
  visualization?: string;
  savedScans?: Record<string, StockScanResult>;
  activeSymbol?: string;
}

export default function StockChart({
  points,
  selectedAnomalyDate,
  onSelectDate,
  currency,
  visualization,
  savedScans = {},
  activeSymbol = "",
}: StockChartProps) {
  const [chartMode, setChartMode] = useState<"price" | "returns" | "engine">("price");
  
  // QoL Features states
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [useLogScale, setUseLogScale] = useState<boolean>(false);
  const [localRangePreset, setLocalRangePreset] = useState<"ALL" | "1Y" | "6M" | "1M">("ALL");
  const [overlayTicker, setOverlayTicker] = useState<string>("");
  const [technicalOverlay, setTechnicalOverlay] = useState<"none" | "sma20" | "bollinger">("none");

  // Advanced Tuning & Normalized Comparing parameters
  const [smaPeriod, setSmaPeriod] = useState<number>(20);
  const [bbStdDev, setBbStdDev] = useState<number>(2.0);
  const [normalizeComparison, setNormalizeComparison] = useState<boolean>(false);
  const [customRangeOn, setCustomRangeOn] = useState<boolean>(false);
  const [customSliceIndexRange, setCustomSliceIndexRange] = useState<[number, number]>([0, 100]);
  const [showHotkeyList, setShowHotkeyList] = useState<boolean>(false);

  const handleGraphAction = (action: "zoomIn" | "zoomOut" | "panLeft" | "panRight") => {
    if (!customRangeOn) setCustomRangeOn(true);
    setCustomSliceIndexRange((prev) => {
      let [start, end] = prev;
      const range = end - start;
      const step = Math.max(2, Math.round(range * 0.1));
      
      switch (action) {
        case "zoomIn":
          start = Math.min(end - 5, start + step);
          end = Math.max(start + 5, end - step);
          break;
        case "zoomOut":
          start = Math.max(0, start - step);
          end = Math.min(100, end + step);
          break;
        case "panLeft":
          if (start > 0) {
            start = Math.max(0, start - step);
            end = Math.min(100, start + range);
          }
          break;
        case "panRight":
          if (end < 100) {
            end = Math.min(100, end + step);
            start = Math.max(0, end - range);
          }
          break;
      }
      return [start, end];
    });
  };

  if (!points || points.length === 0) {
    return (
      <div className="h-[400px] flex items-center justify-center border-2 border-dashed border-slate-800 rounded-xl bg-slate-950/40 text-slate-500">
        <p className="font-sans text-sm">No historical stock series selected.</p>
      </div>
    );
  }

  // Filter keys for overlays (any saved scans that are NOT the active symbol)
  const availableOverlayTickers = useMemo(() => {
    return Object.keys(savedScans).filter((k) => k !== activeSymbol);
  }, [savedScans, activeSymbol]);

  // Compute sliced points based on local presets or custom index range slider
  const processedPoints = useMemo(() => {
    if (customRangeOn) {
      const startIndex = Math.floor((customSliceIndexRange[0] / 100) * (points.length - 1));
      const endIndex = Math.ceil((customSliceIndexRange[1] / 100) * (points.length - 1));
      return points.slice(Math.max(0, startIndex), Math.min(points.length, endIndex + 1));
    }
    if (localRangePreset === "ALL") return points;
    const count = points.length;
    let sliceSize = count;
    if (localRangePreset === "1M") sliceSize = 21; // roughly 21 trading days
    else if (localRangePreset === "6M") sliceSize = 126; // roughly 126 trading days
    else if (localRangePreset === "1Y") sliceSize = 252; // roughly 252 trading days
    return points.slice(Math.max(0, count - sliceSize));
  }, [points, localRangePreset, customRangeOn, customSliceIndexRange]);

  // Merge overlay price data if specified
  const mergedPoints = useMemo(() => {
    if (!overlayTicker || !savedScans[overlayTicker]) {
      return processedPoints;
    }
    const overlayData = savedScans[overlayTicker].points || [];
    // Create map for rapid lookup
    const overlayMap = new Map<string, number>();
    overlayData.forEach((p) => {
      overlayMap.set(p.date, p.close);
    });

    return processedPoints.map((p) => ({
      ...p,
      overlayClose: overlayMap.get(p.date),
    }));
  }, [processedPoints, overlayTicker, savedScans]);

  // Technical Overlays Calculation: SMA & Bollinger Bands (Recalculated over complete series to secure margins!)
  const analystPoints = useMemo(() => {
    const indicatorMap = new Map<string, { sma?: number; bbUpper?: number; bbLower?: number; bbMiddle?: number }>();
    
    for (let i = 0; i < points.length; i++) {
      const windowStart = Math.max(0, i - (smaPeriod - 1));
      const windowSlice = points.slice(windowStart, i + 1);
      const sum = windowSlice.reduce((acc, curr) => acc + curr.close, 0);
      const count = windowSlice.length;
      const sma = sum / count;

      let stdDev = 0;
      if (count > 1) {
        const sqDiffSum = windowSlice.reduce((acc, curr) => acc + Math.pow(curr.close - sma, 2), 0);
        stdDev = Math.sqrt(sqDiffSum / count);
      }
      
      indicatorMap.set(points[i].date, {
        sma: sma,
        bbMiddle: sma,
        bbUpper: sma + bbStdDev * stdDev,
        bbLower: Math.max(0, sma - bbStdDev * stdDev),
      });
    }

    // Capture first item properties to normalize starting value to baseline 100%
    const baseActiveClose = mergedPoints[0]?.close || 1;
    const baseOverlayClose = mergedPoints.find(p => p.overlayClose !== undefined)?.overlayClose || 1;

    return mergedPoints.map((p) => {
      const indicators = indicatorMap.get(p.date) || {};
      
      // Compute normalized prices (scaled to start at 100)
      const normalizedClose = baseActiveClose ? (p.close / baseActiveClose) * 100 : 100;
      const normalizedOverlayClose = p.overlayClose !== undefined && baseOverlayClose
        ? (p.overlayClose / baseOverlayClose) * 100 
        : undefined;

      // Compute normalized overlay values
      const normalizedSma = indicators.sma !== undefined && baseActiveClose
        ? (indicators.sma / baseActiveClose) * 100
        : undefined;
      const normalizedBbUpper = indicators.bbUpper !== undefined && baseActiveClose
        ? (indicators.bbUpper / baseActiveClose) * 100
        : undefined;
      const normalizedBbLower = indicators.bbLower !== undefined && baseActiveClose
        ? (indicators.bbLower / baseActiveClose) * 100
        : undefined;
      const normalizedBbMiddle = indicators.bbMiddle !== undefined && baseActiveClose
        ? (indicators.bbMiddle / baseActiveClose) * 100
        : undefined;

      return {
        ...p,
        ...indicators,
        normalizedClose,
        normalizedOverlayClose,
        normalizedSma,
        normalizedBbUpper,
        normalizedBbLower,
        normalizedBbMiddle,
      };
    });
  }, [mergedPoints, points, smaPeriod, bbStdDev]);

  // Format currency values nicely
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val);
  };

  const anomalyData = processedPoints.filter((p) => p.isAnomaly);

  // Global Hotkey listeners for QoL
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid triggering when focused in input blocks
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.tagName === "SELECT"
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === "g") {
        setShowGrid((prev) => !prev);
      } else if (key === "l" && chartMode === "price") {
        setUseLogScale((prev) => !prev);
      } else if (key === "n" && availableOverlayTickers.length > 0) {
        setNormalizeComparison((prev) => !prev);
      } else if (key === "h") {
        setShowHotkeyList((prev) => !prev);
      } else if (key === "[") {
        setLocalRangePreset((prev) => {
          if (prev === "ALL") return "1Y";
          if (prev === "1Y") return "6M";
          if (prev === "6M") return "1M";
          return "ALL";
        });
      } else if (key === "]") {
        setLocalRangePreset((prev) => {
          if (prev === "1M") return "6M";
          if (prev === "6M") return "1Y";
          if (prev === "1Y") return "ALL";
          return "1M";
        });
      } else if (key === "arrowleft" || key === "arrowright") {
        // Find current anomaly index and slide select date
        if (anomalyData.length > 0) {
          const currentIndex = anomalyData.findIndex(a => a.date === selectedAnomalyDate);
          let nextIdx = 0;
          if (key === "arrowleft") {
            nextIdx = currentIndex <= 0 ? anomalyData.length - 1 : currentIndex - 1;
          } else {
            nextIdx = currentIndex === -1 || currentIndex === anomalyData.length - 1 ? 0 : currentIndex + 1;
          }
          if (anomalyData[nextIdx]) {
            onSelectDate(anomalyData[nextIdx].date);
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [chartMode, availableOverlayTickers, anomalyData, selectedAnomalyDate, onSelectDate]);

  // Export visual stock finding stats package
  const handleExportChartSnapshot = () => {
    const firstPoint = analystPoints[0];
    const lastPoint = analystPoints[analystPoints.length - 1];
    
    const absoluteReturn = firstPoint && lastPoint 
      ? ((lastPoint.close - firstPoint.close) / firstPoint.close) * 100 
      : 0;
      
    const reportText = `================================================
STOCKS ANOMALY SANDBOX DETECTOR - CHART STATS REPORT
================================================
Target Stock Asset: ${activeSymbol}
Trading Period Timeline: ${firstPoint?.date || "N/A"} to ${lastPoint?.date || "N/A"}
Number of Historical Points Loaded: ${analystPoints.length}

Timeline Statistics:
---------------------
- First Close Price: $${firstPoint?.close?.toFixed(2) || "N/A"}
- Last Close Price: $${lastPoint?.close?.toFixed(2) || "N/A"}
- Net Return Trajectory: ${absoluteReturn >= 0 ? "+" : ""}${absoluteReturn.toFixed(2)}%
- Number of Detected Systemic Spikes: ${anomalyData.length}

Active Layout Configuration:
-----------------------------
- Logarithmic Scaling: ${useLogScale ? "ENABLED" : "DISABLED"}
- Gridlines Displayed: ${showGrid ? "YES" : "NO"}
- Technical Indicator: ${technicalOverlay.toUpperCase()} (SMA Period: ${smaPeriod}d, Bollinger Sigma: ${bbStdDev})
- Overlay Benchmark Comparison Ticker: ${overlayTicker || "NONE"}
- Normalizer Comparison Alignment Mode: ${normalizeComparison ? "ACTIVE" : "INACTIVE"}

Timestamps of Anomalies:
-------------------------
${anomalyData.map((a) => `- ${a.date}: Close: $${(a.close ?? 0).toFixed(2)} (Return: ${(a.dailyReturn ?? 0) >= 0 ? "+" : ""}${(a.dailyReturn ?? 0).toFixed(2)}%, Z-Score: ${(a.zScore ?? 0).toFixed(2)} Sigma)`).join("\n")}

Report Generated: ${new Date().toISOString()}
================================================`;

    const blob = new Blob([reportText], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeSymbol}_TimelineReport_${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
  };

  // Format tick date strings
  const formatDateTick = (tickStr: string) => {
    try {
      const parts = tickStr.split("-");
      if (parts.length === 3) {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const monthIdx = parseInt(parts[1], 10) - 1;
        return `${monthNames[monthIdx]} ${parts[2]}`;
      }
      return tickStr;
    } catch {
      return tickStr;
    }
  };

  return (
    <div id="stock-chart-panel" className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-sm">
      {/* Header and Controls */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 mb-6">
        <div>
          <span className="text-[10px] tracking-wider uppercase text-zinc-500 font-mono block">Data Stream Visualizer</span>
          <h2 className="text-base font-bold text-zinc-100 tracking-tight flex items-center gap-2 mt-0.5">
            <Activity className="w-4 h-4 text-blue-500 animate-pulse" />
            Tactical Price Timeline
          </h2>
        </div>

        {/* QoL Control Desk Inside Chart */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Feature: Keyboard shortcuts help panel button */}
          <button
            type="button"
            onClick={() => setShowHotkeyList(!showHotkeyList)}
            className={`p-1.5 rounded border transition-all cursor-pointer flex items-center gap-1.5 text-xs font-mono ${
              showHotkeyList
                ? "bg-amber-955/40 border-amber-850 text-amber-400"
                : "bg-zinc-950 border-zinc-850 text-zinc-400 hover:text-zinc-200"
            }`}
            title="Keyboard Hotkey Cheatsheet (Press 'H')"
          >
            <Keyboard className="w-3.5 h-3.5" />
            <span>Shortcuts</span>
          </button>

          {/* Feature: Download Snapshot stats report */}
          <button
            type="button"
            onClick={handleExportChartSnapshot}
            className="p-1.5 rounded border border-zinc-850 bg-zinc-950 text-zinc-400 hover:text-blue-400 transition-all cursor-pointer flex items-center gap-1.5 text-xs font-mono"
            title="Download Chart Snapshot Stats (.TXT)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Report</span>
          </button>

          {/* Feature: Normalize to 100% baseline toggle */}
          {chartMode === "price" && overlayTicker && (
            <button
              type="button"
              onClick={() => setNormalizeComparison(!normalizeComparison)}
              className={`p-1.5 rounded border transition-all cursor-pointer flex items-center gap-1.5 text-xs font-mono ${
                normalizeComparison
                  ? "bg-purple-955/40 border-purple-850 text-purple-405 font-bold"
                  : "bg-zinc-950 border-zinc-850 text-zinc-400 hover:text-zinc-250"
              }`}
              title="Scale both starting prices to $100 baseline for direct return matching (Press 'N')"
            >
              <Percent className="w-3.5 h-3.5" />
              <span>Normalize Comparison</span>
            </button>
          )}

          {/* Feature: Frontend Quick-Date Preset */}
          <div className="flex bg-zinc-955 p-1 rounded-lg border border-zinc-805 text-xs font-mono">
            {(["ALL", "1Y", "6M", "1M"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setCustomRangeOn(false);
                  setLocalRangePreset(r);
                }}
                className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                  !customRangeOn && localRangePreset === r
                    ? "bg-zinc-800 text-blue-400 font-bold"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
                title={`Slice chart locally to ${r === "ALL" ? "entire series" : r}`}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Feature: Toggle Gridlines */}
          <button
            type="button"
            onClick={() => setShowGrid(!showGrid)}
            className={`p-1.5 rounded border transition-all cursor-pointer ${
              showGrid
                ? "bg-zinc-800 border-zinc-700 text-blue-400"
                : "bg-zinc-950 border-zinc-850 text-zinc-500"
            }`}
            title="Toggle Cartesian Gridlines (Press 'G')"
          >
            <Grid className="w-3.5 h-3.5" />
          </button>

          {/* Feature: Linear vs Logarithmic */}
          {chartMode === "price" && !normalizeComparison && (
            <button
              type="button"
              onClick={() => setUseLogScale(!useLogScale)}
              className={`px-2.5 py-1 rounded border text-[11px] font-mono transition-all cursor-pointer ${
                useLogScale
                  ? "bg-zinc-805 border-zinc-700 text-blue-400 font-bold"
                  : "bg-zinc-955 border-zinc-850 text-zinc-500"
              }`}
              title="Toggle Y-Axis Scale Type (Press 'L')"
            >
              {useLogScale ? "LOG Scale" : "LIN Scale"}
            </button>
          )}

          {/* Feature: Technical Indicator Overlay */}
          {chartMode === "price" && (
            <div className="flex items-center gap-1.5 bg-zinc-950 p-1.5 rounded-lg border border-zinc-850 text-xs font-sans">
              <span className="text-[10px] text-zinc-400 font-mono uppercase px-1">Overlay:</span>
              <select
                value={technicalOverlay}
                onChange={(e) => setTechnicalOverlay(e.target.value as any)}
                className="bg-zinc-900 text-zinc-300 border border-zinc-800 rounded px-1.5 py-0.5 text-[10px] focus:outline-none cursor-pointer"
              >
                <option value="none">None</option>
                <option value="sma20">SMA</option>
                <option value="bollinger">Bollinger Bands</option>
              </select>
            </div>
          )}

          {/* Feature: Saved Stock Compare Overlay */}
          {chartMode === "price" && availableOverlayTickers.length > 0 && (
            <div className="flex items-center gap-1.5 bg-zinc-950 p-1.5 rounded-lg border border-zinc-850 text-xs font-sans">
              <span className="text-[10px] text-zinc-500 font-mono uppercase px-1">Compare:</span>
              <select
                value={overlayTicker}
                onChange={(e) => {
                  setOverlayTicker(e.target.value);
                  if (e.target.value) setNormalizeComparison(true); // default to normalized on compare start!
                }}
                className="bg-zinc-900 text-zinc-300 border border-zinc-800 rounded px-1.5 py-0.5 text-[10px] focus:outline-none cursor-pointer"
              >
                <option value="">(None)</option>
                {availableOverlayTickers.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Chart View Toggle */}
          <div className="flex bg-zinc-950 p-1 rounded-lg border border-zinc-800 gap-1 flex-wrap">
            <button
              id="toggle-price-chart"
              onClick={() => setChartMode("price")}
              className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium tracking-wide transition-all cursor-pointer ${
                chartMode === "price"
                  ? "bg-zinc-800 text-blue-400 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Closing Prices
            </button>
            <button
              id="toggle-returns-chart"
              onClick={() => setChartMode("returns")}
              className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium tracking-wide transition-all cursor-pointer ${
                chartMode === "returns"
                  ? "bg-zinc-800 text-blue-400 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Volatility %
            </button>
            {visualization && (
              <button
                id="toggle-engine-chart"
                onClick={() => setChartMode("engine")}
                className={`px-3 py-1.5 rounded-md text-xs font-mono font-medium tracking-wide transition-all cursor-pointer ${
                  chartMode === "engine"
                    ? "bg-zinc-800 text-emerald-400 shadow-sm font-semibold"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                Engine Graph (Matplotlib Style)
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sub-workspace: Parameter Tuning Sliders + Zoom Index Slider + Hotkey panel */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 mt-1">
        {/* Left: Custom Timeline Zoom slider */}
        <div className="bg-zinc-950/60 border border-zinc-855 p-3 rounded-lg flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-zinc-400 font-mono uppercase font-bold flex flex-wrap items-center gap-1.5">
              <Calendar className="w-3.5 h-[13px] text-zinc-400" />
              Dynamic Index Range Trimmer
            </span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 mr-2 bg-zinc-900 border border-zinc-800 rounded p-0.5">
                <button 
                  onClick={() => handleGraphAction("zoomOut")}
                  className="p-1 text-zinc-500 hover:text-blue-400 hover:bg-zinc-800 rounded transition-all"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={() => handleGraphAction("zoomIn")}
                  className="p-1 text-zinc-500 hover:text-blue-400 hover:bg-zinc-800 rounded transition-all"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-3.5 bg-zinc-700 mx-0.5"></div>
                <button 
                  onClick={() => handleGraphAction("panLeft")}
                  className="p-1 text-zinc-500 hover:text-blue-400 hover:bg-zinc-800 rounded transition-all"
                  title="Pan Left"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={() => handleGraphAction("panRight")}
                  className="p-1 text-zinc-500 hover:text-blue-400 hover:bg-zinc-800 rounded transition-all"
                  title="Pan Right"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={customRangeOn}
                  onChange={(e) => setCustomRangeOn(e.target.checked)}
                  className="accent-blue-500 rounded cursor-pointer w-3.5 h-3.5"
                />
                <span className="text-[10px] text-zinc-400 font-mono uppercase">Zoom On</span>
              </label>
            </div>
          </div>
          {customRangeOn ? (
            <div className="space-y-2 py-1">
              <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                <span>Timeline Start Offset: <strong className="text-zinc-200">{customSliceIndexRange[0]}%</strong></span>
                <span>Timeline End Bounds: <strong className="text-zinc-200">{customSliceIndexRange[1]}%</strong></span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-zinc-650 font-mono">0%</span>
                  <input
                    type="range"
                    min="0"
                    max={String(Math.max(0, customSliceIndexRange[1] - 5))}
                    value={customSliceIndexRange[0]}
                    onChange={(e) => setCustomSliceIndexRange([Number(e.target.value), customSliceIndexRange[1]])}
                    className="flex-grow h-1 bg-zinc-800 rounded appearance-none cursor-pointer accent-blue-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={String(customSliceIndexRange[0] + 5)}
                    max="100"
                    value={customSliceIndexRange[1]}
                    onChange={(e) => setCustomSliceIndexRange([customSliceIndexRange[0], Number(e.target.value)])}
                    className="flex-grow h-1 bg-zinc-800 rounded appearance-none cursor-pointer accent-blue-500"
                  />
                  <span className="text-[9px] text-zinc-650 font-mono">100%</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[10.5px] text-zinc-500 italic mt-1 leading-snug">
              Presets are active. Toggle "Zoom On" to slice precisely down to custom micro-periods using percentages.
            </p>
          )}
        </div>

        {/* Right: Technical Indicators Period Tuning */}
        {chartMode === "price" && technicalOverlay !== "none" ? (
          <div className="bg-zinc-950/60 border border-zinc-855 p-3 rounded-lg flex flex-col gap-2">
            <span className="text-[10px] text-zinc-400 font-mono uppercase font-bold flex items-center gap-1.5">
              <Sliders className="w-3.5 h-[13px] text-amber-500" />
              Dynamic Overlay Modifiers
            </span>
            <div className="grid grid-cols-2 gap-4 py-1">
              <div className="space-y-1">
                <div className="flex justify-between items-center text-[9px] font-mono text-zinc-400">
                  <span>SMA-Period:</span>
                  <span className="text-cyan-400 font-bold">{smaPeriod}d</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="60"
                  step="1"
                  value={smaPeriod}
                  onChange={(e) => setSmaPeriod(Number(e.target.value))}
                  className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer accent-cyan-500"
                />
              </div>

              {technicalOverlay === "bollinger" ? (
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[9px] font-mono text-zinc-400">
                    <span>Bollinger Sigma:</span>
                    <span className="text-amber-400 font-bold">{bbStdDev.toFixed(1)}σ</span>
                  </div>
                  <input
                    type="range"
                    min="1.0"
                    max="4.0"
                    step="0.1"
                    value={bbStdDev}
                    onChange={(e) => setBbStdDev(Number(e.target.value))}
                    className="w-full h-1 bg-zinc-800 rounded appearance-none cursor-pointer accent-amber-500"
                  />
                </div>
              ) : (
                <div className="text-[10.5px] text-zinc-500 italic flex items-center">
                  Select Bollinger overlay to refine standard dev boundaries.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-zinc-950/60 border border-zinc-855 p-3 rounded-lg flex items-center justify-center text-center">
            <p className="text-[10.5px] text-zinc-500 italic leading-snug">
              Choose SMA or Bollinger in Overlays to activate live indicator parameter tuning.
            </p>
          </div>
        )}
      </div>

      {/* Shortcuts/Hotkeys Help Drawer */}
      {showHotkeyList && (
        <div className="bg-amber-955/20 border border-amber-900/40 p-4 rounded-xl mb-4 text-xs font-mono text-amber-300/90 leading-relaxed grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h5 className="font-bold uppercase text-amber-400 mb-1 flex items-center gap-1.5 text-xs">
              <Keyboard className="w-3.5 h-3.5" /> Global Interactive Keyboard Hotkeys
            </h5>
            <p className="text-[10.5px] text-amber-400/70 mb-2">
              Focus anywhere (except input forms) and tap these keys for quick workspace layout changes:
            </p>
            <ul className="space-y-1 text-[11px]">
              <li>• <kbd className="bg-zinc-955 px-1 py-0.5 rounded border border-zinc-800 text-white font-bold inline-block">g</kbd> : Toggle Cartesian background grid lines</li>
              <li>• <kbd className="bg-zinc-955 px-1 py-0.5 rounded border border-zinc-800 text-white font-bold inline-block">l</kbd> : Toggle Linear / Logarithmic scaling on Y axis</li>
              <li>• <kbd className="bg-zinc-955 px-1 py-0.5 rounded border border-zinc-805 text-white font-bold inline-block">n</kbd> : Toggle Percentage Normalizer ($100 index)</li>
            </ul>
          </div>
          <div>
            <h5 className="font-bold uppercase text-amber-400 mb-1 flex items-center gap-1.5 text-xs invisible md:visible">Indices & Navigation</h5>
            <ul className="space-y-1 text-[11px] md:mt-7">
              <li>• <kbd className="bg-zinc-955 px-1 py-0.5 rounded border border-zinc-805 text-white font-bold inline-block">[</kbd> / <kbd className="bg-zinc-955 px-1 py-0.5 rounded border border-zinc-805 text-white font-bold inline-block">]</kbd> : Rotate date range timeline presets (1M, 6M, 1Y, ALL)</li>
              <li>• <kbd className="bg-zinc-955 px-2 py-0.5 rounded border border-zinc-805 text-white font-bold inline-block">Arrow Left</kbd> / <kbd className="bg-zinc-955 px-2 py-0.5 rounded border border-zinc-805 text-white font-bold inline-block">Arrow Right</kbd> : Slide selection cursor forward/backward across anomalies</li>
              <li>• <kbd className="bg-zinc-955 px-1 py-0.5 rounded border border-zinc-805 text-white font-bold inline-block">h</kbd> : Close this hotkey cheatsheet tray</li>
            </ul>
          </div>
        </div>
      )}

      {/* Chart Canvas */}
      <div className="w-full">
        {chartMode === "engine" && visualization ? (
          <div 
            className="w-full h-auto overflow-x-auto text-zinc-100 flex justify-center py-2"
            dangerouslySetInnerHTML={{ __html: visualization }}
          />
        ) : (
          <div className="h-[380px] w-full">
            <ResponsiveContainer width="100%" height="100%">
               {chartMode === "price" ? (
                <AreaChart data={analystPoints} margin={{ top: 20, right: 10, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="colorClose" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />}
                  <XAxis
                    dataKey="date"
                    stroke="#71717a"
                    tickFormatter={formatDateTick}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#71717a"
                    domain={["auto", "auto"]}
                    scale={useLogScale && !normalizeComparison ? "log" : "auto"}
                    tickFormatter={(val) => normalizeComparison ? `${val.toFixed(0)}%` : `$${val.toFixed(0)}`}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    orientation="right"
                  />
                  <Tooltip content={<CustomTooltip />} />
                  {/* Technical Overlay: Bollinger Bands shaded range or boundaries */}
                  {technicalOverlay === "bollinger" && (
                    <Line
                      type="monotone"
                      dataKey={normalizeComparison ? "normalizedBbUpper" : "bbUpper"}
                      stroke="#fbbf24"
                      strokeWidth={1.2}
                      strokeDasharray="4 4"
                      dot={false}
                      name="bbUpper"
                    />
                  )}
                  {technicalOverlay === "bollinger" && (
                    <Line
                      type="monotone"
                      dataKey={normalizeComparison ? "normalizedBbLower" : "bbLower"}
                      stroke="#fbbf24"
                      strokeWidth={1.2}
                      strokeDasharray="4 4"
                      dot={false}
                      name="bbLower"
                    />
                  )}
                  {technicalOverlay === "bollinger" && (
                    <Line
                      type="monotone"
                      dataKey={normalizeComparison ? "normalizedBbMiddle" : "bbMiddle"}
                      stroke="#d97706"
                      strokeWidth={1}
                      dot={false}
                      name="bbMiddle"
                    />
                  )}

                  {/* Technical Overlay: SMA */}
                  {technicalOverlay === "sma20" && (
                    <Line
                      type="monotone"
                      dataKey={normalizeComparison ? "normalizedSma" : "sma"}
                      stroke="#06b6d4"
                      strokeWidth={1.5}
                      dot={false}
                      name="sma"
                    />
                  )}

                  <Area
                    type="monotone"
                    dataKey={normalizeComparison ? "normalizedClose" : "close"}
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorClose)"
                    dot={({ payload, cx, cy }) => {
                      if (payload.isAnomaly) {
                        const isSelected = selectedAnomalyDate === payload.date;
                        const isPositive = payload.dailyReturn > 0;
                        return (
                          <g
                             key={payload.date}
                             onClick={() => onSelectDate(payload.date)}
                             className="cursor-pointer group"
                          >
                            <circle
                              cx={cx}
                              cy={cy}
                              r={isSelected ? 8 : 5}
                              fill={isPositive ? "#10b981" : "#f43f5e"}
                              stroke="#09090b"
                              strokeWidth={2}
                              className="transition-all duration-350 hover:scale-125"
                            />
                            <circle
                              cx={cx}
                              cy={cy}
                              r={isSelected ? 14 : 10}
                              fill="transparent"
                              stroke={isPositive ? "#10b981" : "#f43f5e"}
                              strokeWidth={isSelected ? 2 : 1}
                              strokeDasharray="2 2"
                            />
                          </g>
                        );
                      }
                      return <g />;
                    }}
                  />
                  {overlayTicker && savedScans[overlayTicker] && (
                    <Line
                      type="monotone"
                      dataKey={normalizeComparison ? "normalizedOverlayClose" : "overlayClose"}
                      stroke="#a855f7"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={false}
                      name="overlayClose"
                    />
                  )}
                  <Brush 
                    dataKey="date" 
                    height={20} 
                    stroke="#3b82f6" 
                    fill="#09090b" 
                    tickFormatter={formatDateTick}
                    travellerWidth={10}
                  />
                </AreaChart>
              ) : (
                <LineChart data={processedPoints} margin={{ top: 20, right: 10, left: 10, bottom: 5 }}>
                  {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />}
                  <XAxis
                    dataKey="date"
                    stroke="#71717a"
                    tickFormatter={formatDateTick}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#71717a"
                    domain={["auto", "auto"]}
                    tickFormatter={(val) => `${val.toFixed(0)}%`}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    orientation="right"
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="dailyReturn"
                    stroke="#3b82f6"
                    strokeWidth={1.5}
                    dot={({ payload, cx, cy }) => {
                      if (payload.isAnomaly) {
                        const isSelected = selectedAnomalyDate === payload.date;
                        const isPositive = payload.dailyReturn > 0;
                        return (
                          <circle
                            key={payload.date}
                            cx={cx}
                            cy={cy}
                            r={isSelected ? 7 : 4}
                            fill={isPositive ? "#10b981" : "#f43f5e"}
                            stroke="#09090b"
                            strokeWidth={1.5}
                            onClick={() => onSelectDate(payload.date)}
                            className="cursor-pointer hover:scale-125 transition-all"
                          />
                        );
                      }
                      return null;
                    }}
                  />
                  <Brush 
                    dataKey="date" 
                    height={20} 
                    stroke="#3b82f6" 
                    fill="#09090b" 
                    tickFormatter={formatDateTick}
                    travellerWidth={10}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Legend / Help */}
      <div className="mt-4 flex flex-wrap justify-between items-center bg-zinc-950 p-3.5 rounded-xl border border-zinc-850 gap-4 text-xs font-mono">
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2 text-zinc-400">
            <span className="w-2 h-2 bg-emerald-500 rounded-full inline-block shadow-[0_0_6px_#10b981]"></span>
            <span>Positive Outlier</span>
          </div>
          <div className="flex items-center gap-2 text-zinc-400">
            <span className="w-2 h-2 bg-rose-500 rounded-full inline-block shadow-[0_0_6px_#f43f5e]"></span>
            <span>Negative Outlier</span>
          </div>
          {overlayTicker && (
            <div className="flex items-center gap-2 text-purple-400">
              <span className="px-1.5 py-0.2 select-none border border-purple-800/30 bg-purple-950/20 rounded font-bold text-[9px] uppercase">
                {overlayTicker} Overlay
              </span>
            </div>
          )}
        </div>
        <div className="text-zinc-500 flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
          Select trade day node to trigger historic Gemini breakdown
        </div>
      </div>
    </div>
  );
}
