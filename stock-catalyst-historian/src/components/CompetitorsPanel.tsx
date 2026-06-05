import React, { useState, useEffect } from "react";

interface Competitor {
  symbol: string;
  name: string;
  relationship: string;
  price?: number;
  marketCap?: number;
  sector?: string;
  beta?: number;
  events?: Array<{
    date: string;
    headline: string;
    type: string;
    severity: string;
    materialityScore?: number;
    direction?: string;
    detail?: string;
    source?: string;
  }>;
}

interface CorrelationData {
  correlation: number;
  alignedDataPoints: number;
  beta: number;
  topEvents: Array<{
    date: string;
    competitorReturn: number;
    targetReturn: number;
  }>;
}

interface Props {
  symbol: string;
  name?: string;
  savedScans?: Record<string, any>;
  onSelectCompetitor?: (symbol: string) => void;
  onCompetitorsLoaded?: (competitors: {symbol: string, companyName: string}[]) => void;
}

const CompetitorsPanel: React.FC<Props> = ({ symbol, name, savedScans, onSelectCompetitor, onCompetitorsLoaded }) => {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [analyzingCompetitor, setAnalyzingCompetitor] = useState<string | null>(null);
  const [correlationData, setCorrelationData] = useState<Record<string, CorrelationData>>({});

  useEffect(() => {
    let active = true;
    const fetchCompetitors = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/competitors?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(name || "")}`);
        const data = await res.json();
        if (active) {
          if (res.ok) {
            const topComps = data.slice(0, 10);
            setCompetitors(topComps);
            if (onCompetitorsLoaded) {
              onCompetitorsLoaded(topComps.map((c: any) => ({ symbol: c.symbol, companyName: c.name })));
            }
          } else {
            setError(data.error || "Failed to load competitors.");
          }
        }
      } catch (err: any) {
        if (active) setError(err.message || "Network Error");
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchCompetitors();
    return () => { active = false; };
  }, [symbol, name]);

  const analyzeCorrelation = async (compSymbol: string) => {
    if (correlationData[compSymbol]) {
      setAnalyzingCompetitor(compSymbol === analyzingCompetitor ? null : compSymbol);
      return;
    }

    setAnalyzingCompetitor(compSymbol);
    try {
      const res = await fetch(`/api/competitor-impact?targetSymbol=${encodeURIComponent(symbol)}&competitorSymbol=${encodeURIComponent(compSymbol)}&years=2`);
      const data = await res.json();
      if (res.ok) {
        setCorrelationData(prev => ({ ...prev, [compSymbol]: data }));
      } else {
        if (data.error && data.error.includes("Missing historical data")) {
          console.warn(`[Correlation] Missing data for ${compSymbol}. Initiating full scan instead.`);
          setAnalyzingCompetitor(null);
          if (onSelectCompetitor) {
            onSelectCompetitor(compSymbol);
          }
        } else {
          console.error("Failed to load correlation:", data.error);
          setAnalyzingCompetitor(null);
        }
      }
    } catch (err) {
      console.error("Failed to load correlation:", err);
      setAnalyzingCompetitor(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded p-4 animate-pulse">
        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-widest font-mono mb-2">Analyzing the Landscape...</h4>
        <div className="h-2 bg-zinc-800 rounded w-1/3 mb-4"></div>
        <div className="space-y-3">
          {[1, 2, 3].map((v) => (
            <div key={v} className="h-10 bg-zinc-800 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-zinc-900 border border-red-900/30 rounded p-4 text-xs font-mono text-center text-red-500/70">
        <p>Could not load competitors.</p>
        <p className="text-[10px] mt-1 text-zinc-500">{error}</p>
      </div>
    );
  }

  if (!competitors.length) {
    return null;
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded p-5 shadow-sm text-left">
      <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-widest font-mono mb-1">
        Primary Competitors &amp; Ecosystem Rivals
      </h4>
      <p className="text-[10px] text-zinc-400 font-sans mb-4">
        Top market peers and direct competitors that may drive sector volatility or systematic risk in {symbol}.
      </p>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {competitors.map((comp) => (
          <div key={comp.symbol} className="bg-zinc-950 p-4 rounded border border-zinc-800 hover:border-zinc-700 transition-colors flex flex-col">
            <div className="flex justify-between items-start mb-2">
              <div 
                className="font-bold text-[12px] font-mono text-blue-400 cursor-pointer hover:underline uppercase"
                onClick={() => onSelectCompetitor && onSelectCompetitor(comp.symbol)}
              >
                {comp.symbol} <span className="text-[10px] text-zinc-500 font-sans tracking-wide ml-1">{comp.name}</span>
              </div>
              <div className="flex items-center gap-2">
                {typeof comp.price === 'number' && !isNaN(comp.price) && (
                  <div className="font-mono text-[10px] font-black text-zinc-300">
                    ${comp.price.toFixed(2)}
                  </div>
                )}
                {savedScans && savedScans[comp.symbol] ? (
                  <button
                    onClick={() => onSelectCompetitor && onSelectCompetitor(comp.symbol)}
                    className="bg-green-900/20 hover:bg-green-900/40 text-green-400 border border-green-900/50 rounded px-2 py-0.5 text-[9px] uppercase font-bold tracking-wider transition-colors"
                  >
                    View Sandbox
                  </button>
                ) : (
                  <button
                    onClick={() => onSelectCompetitor && onSelectCompetitor(comp.symbol)}
                    className="bg-purple-900/20 hover:bg-purple-900/40 text-purple-400 border border-purple-900/50 rounded px-2 py-0.5 text-[9px] uppercase font-bold tracking-wider transition-colors"
                  >
                    + Add to Sandbox
                  </button>
                )}
                <button
                  onClick={() => analyzeCorrelation(comp.symbol)}
                  className="bg-blue-900/20 hover:bg-blue-900/40 text-blue-400 border border-blue-900/50 rounded px-2 py-0.5 text-[9px] uppercase font-bold tracking-wider transition-colors"
                >
                  {analyzingCompetitor === comp.symbol && !correlationData[comp.symbol] ? "Loading..." : "Analyze Impact"}
                </button>
              </div>
            </div>
            
            <div className="text-[10px] text-zinc-400 leading-relaxed max-w-full italic mb-3 flex-grow border-l-2 border-zinc-800 pl-2">
              "{comp.relationship}"
            </div>

            {comp.events && comp.events.length > 0 && (
              <div className="mb-3 bg-zinc-900/60 rounded border border-zinc-850 border-zinc-800 p-3 text-[11px] text-left">
                <div className="flex justify-between items-center mb-1.5 pb-1 border-b border-zinc-800/60">
                  <span className="text-[9px] uppercase font-bold tracking-widest text-[#facc15] font-mono flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#facc15] animate-pulse" />
                    Latest Intel Signal
                  </span>
                  <span className="text-[9px] font-mono text-zinc-500 font-bold">{comp.events[0].date}</span>
                </div>
                <div className="font-bold text-zinc-200 mb-1 leading-tight text-left">
                  {comp.events[0].headline}
                </div>
                {comp.events[0].detail && (
                  <p className="text-zinc-400 text-[10px] leading-relaxed mb-2 font-sans text-left">
                    {comp.events[0].detail}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-[8px] font-mono font-bold uppercase px-1 rounded ${
                    comp.events[0].severity === 'critical' ? 'bg-red-950 text-red-400 border border-red-900/40' :
                    comp.events[0].severity === 'high' ? 'bg-orange-950 text-orange-400 border border-orange-900/40' :
                    comp.events[0].severity === 'moderate' ? 'bg-amber-950 text-amber-400 border border-amber-900/40' :
                    'bg-zinc-800 text-zinc-400'
                  }`}>
                    {comp.events[0].severity}
                  </span>
                  {comp.events[0].type && (
                    <span className="text-[8px] font-mono text-blue-400 bg-blue-950/40 px-1 border border-blue-900/30 rounded uppercase">
                      {comp.events[0].type.replace('_', ' ')}
                    </span>
                  )}
                  {comp.events[0].direction && (
                    <span className={`text-[8px] font-mono font-bold px-1 rounded uppercase ${
                      comp.events[0].direction === 'bullish' ? 'bg-green-950 text-green-400 border border-green-900/40' :
                      comp.events[0].direction === 'bearish' ? 'bg-red-950 text-red-400 border border-red-900/40' :
                      'bg-zinc-800 text-zinc-400'
                    }`}>
                      {comp.events[0].direction}
                    </span>
                  )}
                  {comp.events[0].source && (
                    <span className="ml-auto text-[8px] font-mono text-zinc-600 uppercase">
                      via {comp.events[0].source.replace('_', ' ')}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mb-3">
              {comp.sector && comp.sector !== "Unknown" && (
                <span className="text-[9px] font-mono uppercase bg-zinc-900 border border-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">
                  {comp.sector}
                </span>
              )}
              {comp.marketCap !== undefined && comp.marketCap > 0 && (
                <span className="text-[9px] font-mono uppercase bg-zinc-900 border border-zinc-800 text-blue-400 px-1.5 py-0.5 rounded">
                  MCAP: ${(comp.marketCap / 1e9).toFixed(1)}B
                </span>
              )}
              {typeof comp.beta === 'number' && !isNaN(comp.beta) && (
                <span className="text-[9px] font-mono uppercase bg-zinc-900 border border-zinc-800 text-purple-400 px-1.5 py-0.5 rounded">
                  BETA: {comp.beta.toFixed(2)}
                </span>
              )}
            </div>

            {analyzingCompetitor === comp.symbol && correlationData[comp.symbol] && (
              <div className="mt-2 pt-3 border-t border-zinc-800/80">
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-zinc-900 rounded p-2 text-center border border-zinc-800/50">
                    <div className="text-[9px] uppercase tracking-wider text-zinc-500 mb-1">Correlation (r)</div>
                    <div className={`text-xs font-mono font-black ${correlationData[comp.symbol].correlation > 0.5 ? 'text-green-400' : correlationData[comp.symbol].correlation > 0.2 ? 'text-green-500/70' : correlationData[comp.symbol].correlation < -0.2 ? 'text-red-400' : 'text-zinc-300'}`}>
                      {correlationData[comp.symbol].correlation > 0 ? "+" : ""}{correlationData[comp.symbol].correlation.toFixed(2)}
                    </div>
                  </div>
                  <div className="bg-zinc-900 rounded p-2 text-center border border-zinc-800/50">
                    <div className="text-[9px] uppercase tracking-wider text-zinc-500 mb-1">Impact Beta</div>
                    <div className="text-xs font-mono font-black text-blue-300">
                      {correlationData[comp.symbol].beta.toFixed(2)}x
                    </div>
                  </div>
                </div>
                
                <h5 className="text-[9px] uppercase tracking-widest text-zinc-500 font-bold mb-1.5 flex justify-between">
                  <span>Major Competitor Action Days</span>
                  <span>{symbol} Return</span>
                </h5>
                <div className="space-y-1">
                  {correlationData[comp.symbol].topEvents.map((ev, i) => (
                    <div key={i} className="flex justify-between items-center text-[10px] bg-zinc-900 p-1.5 rounded border border-zinc-800/30">
                      <div className="font-mono text-zinc-400">{ev.date}</div>
                      <div className="flex gap-3 font-mono font-black border-l border-zinc-800 pl-3">
                        <span className={`w-12 text-right ${ev.competitorReturn > 0 ? 'text-green-400/80' : 'text-red-400/80'}`}>
                          {ev.competitorReturn > 0 ? "+" : ""}{ev.competitorReturn.toFixed(1)}%
                        </span>
                        <span className={`w-12 text-right ${ev.targetReturn > 0 ? 'text-green-400' : ev.targetReturn < 0 ? 'text-red-400' : 'text-zinc-500'}`}>
                          {ev.targetReturn > 0 ? "+" : ""}{ev.targetReturn.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-[9px] text-zinc-500 italic">
                  *Based on trailing 24M trading sessions. Positive correlation means they move together, Beta indicates {symbol}'s sensitivity to {comp.symbol}'s moves.
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CompetitorsPanel;
