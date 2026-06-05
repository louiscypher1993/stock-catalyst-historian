import React, { useEffect, useRef, useState } from "react";
import { Loader2, Play, Square, Activity } from "lucide-react";

const FMP_DAILY_BUDGET = 200;

interface BatchScanStatus {
  isRunning: boolean;
  totalSymbols: number;
  scanned: number;
  remaining: number;
  currentSymbol: string | null;
  estimatedCompletionHours: number;
  eventsCollected: number;
  fmpRequestsUsedToday: number;
}

export default function BatchScannerPanel() {
  const [status, setStatus] = useState<BatchScanStatus | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/batch-scanner/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: BatchScanStatus = await res.json();
      setStatus(data);
      setFetchError(null);
    } catch (err: any) {
      setFetchError(err?.message ?? "Failed to reach server");
    }
  };

  useEffect(() => {
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, 10000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleStart = async () => {
    setActionLoading(true);
    try {
      await fetch("/api/batch-scanner/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ years: 30 }),
      });
      await fetchStatus();
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    setActionLoading(true);
    try {
      await fetch("/api/batch-scanner/stop", { method: "POST" });
      await fetchStatus();
    } finally {
      setActionLoading(false);
    }
  };

  const progressPct = status && status.totalSymbols > 0
    ? Math.round((status.scanned / status.totalSymbols) * 100)
    : 0;

  const fmpPct = status
    ? Math.round((status.fmpRequestsUsedToday / FMP_DAILY_BUDGET) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold text-zinc-100 uppercase tracking-widest font-mono">
            Universe Background Scanner
          </span>
          {status?.isRunning && (
            <span className="flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 px-1.5 py-0.5 rounded animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              Running
            </span>
          )}
          {status && !status.isRunning && (
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-zinc-500 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded">
              Idle
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleStart}
            disabled={actionLoading || status?.isRunning === true}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-bold font-mono uppercase tracking-wider border transition-all cursor-pointer ${
              actionLoading || status?.isRunning
                ? "bg-zinc-900 text-zinc-600 border-zinc-800 cursor-not-allowed"
                : "bg-emerald-950/50 text-emerald-400 border-emerald-900/50 hover:bg-emerald-900/50 hover:text-emerald-300"
            }`}
          >
            {actionLoading && !status?.isRunning ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            Start
          </button>
          <button
            type="button"
            onClick={handleStop}
            disabled={actionLoading || status?.isRunning === false}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-bold font-mono uppercase tracking-wider border transition-all cursor-pointer ${
              actionLoading || !status?.isRunning
                ? "bg-zinc-900 text-zinc-600 border-zinc-800 cursor-not-allowed"
                : "bg-rose-950/50 text-rose-400 border-rose-900/50 hover:bg-rose-900/50 hover:text-rose-300"
            }`}
          >
            {actionLoading && status?.isRunning ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Square className="w-3 h-3" />
            )}
            Stop
          </button>
        </div>
      </div>

      {fetchError && (
        <div className="p-2.5 bg-rose-950/30 border border-rose-900/40 rounded text-[10px] font-mono text-rose-400">
          {fetchError}
        </div>
      )}

      {!status && !fetchError && (
        <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono py-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading scanner status...
        </div>
      )}

      {status && (
        <div className="space-y-4">
          {/* Currently scanning */}
          {status.isRunning && status.currentSymbol && (
            <div className="flex items-center gap-2 p-2.5 bg-cyan-950/20 border border-cyan-900/30 rounded text-[10px] font-mono">
              <Loader2 className="w-3 h-3 animate-spin text-cyan-400 shrink-0" />
              <span className="text-zinc-400">Currently scanning:</span>
              <span className="text-cyan-300 font-bold">{status.currentSymbol}</span>
            </div>
          )}

          {/* Scan progress bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px] font-mono text-zinc-400">
              <span>Scan Progress</span>
              <span className="text-zinc-200 font-bold">
                {status.scanned} / {status.totalSymbols}
                <span className="text-zinc-500 ml-1">({progressPct}%)</span>
              </span>
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-cyan-600 to-cyan-400"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-zinc-950/50 border border-zinc-850 rounded-lg p-3 text-left">
              <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 mb-1">Events Collected</div>
              <div className="text-sm font-bold text-emerald-400 font-mono">{status.eventsCollected.toLocaleString()}</div>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-850 rounded-lg p-3 text-left">
              <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 mb-1">Remaining</div>
              <div className="text-sm font-bold text-zinc-200 font-mono">{status.remaining.toLocaleString()}</div>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-850 rounded-lg p-3 text-left">
              <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 mb-1">Est. Completion</div>
              <div className="text-sm font-bold text-amber-400 font-mono">
                {status.isRunning ? `~${status.estimatedCompletionHours}h` : "—"}
              </div>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-850 rounded-lg p-3 text-left">
              <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 mb-1">Total Symbols</div>
              <div className="text-sm font-bold text-zinc-200 font-mono">{status.totalSymbols.toLocaleString()}</div>
            </div>
          </div>

          {/* FMP budget bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px] font-mono text-zinc-400">
              <span>FMP Daily Budget</span>
              <span className={`font-bold ${fmpPct >= 80 ? "text-rose-400" : fmpPct >= 50 ? "text-amber-400" : "text-zinc-200"}`}>
                {status.fmpRequestsUsedToday} / {FMP_DAILY_BUDGET}
                <span className="text-zinc-500 ml-1">({fmpPct}%)</span>
              </span>
            </div>
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  fmpPct >= 80 ? "bg-rose-500" : fmpPct >= 50 ? "bg-amber-500" : "bg-blue-500"
                }`}
                style={{ width: `${Math.min(fmpPct, 100)}%` }}
              />
            </div>
            <p className="text-[9.5px] font-mono text-zinc-600">
              Scanner pauses automatically when within 20 requests of the daily limit and resumes after UTC midnight.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
