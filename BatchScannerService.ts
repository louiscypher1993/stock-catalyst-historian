import { HistoricalEngine } from "./HistoricalEngine";
import { fmpDailyRequestCount, FMP_DAILY_BUDGET } from "./FMPService";
import {
  initBatchScanProgress,
  markBatchScanComplete,
  markBatchScanError,
  getBatchScanProgress,
} from "./db";

// Symbols are passed in from server.ts (derived from GLOBAL_MARKETS), not hardcoded here.
// Build the universe in server.ts:
//   const SCANNER_UNIVERSE = GLOBAL_MARKETS
//     .flatMap(m => m.stocks.map(s => s.symbol))
//     .filter(sym => !sym.startsWith('SPSX'));

export interface BatchScanStatus {
  isRunning: boolean;
  totalSymbols: number;
  scanned: number;
  remaining: number;
  currentSymbol: string | null;
  estimatedCompletionHours: number;
  eventsCollected: number;
  fmpRequestsUsedToday: number;
}

export class BatchScanner {
  private symbols: string[];
  private yearsBack: number;
  private running = false;
  private stopRequested = false;
  private currentSymbol: string | null = null;

  private static readonly VALID_YEARS = [0.5, 1, 2, 5, 30] as const;

  constructor(symbols: string[], yearsBack: number = 5) {
    this.yearsBack = (BatchScanner.VALID_YEARS as readonly number[]).includes(yearsBack) ? yearsBack : 5;
    this.symbols = Array.from(new Set(symbols.map(s => s.toUpperCase().trim()))).filter(Boolean);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;

    console.log(`[BatchScanner] Starting universe scan: ${this.symbols.length} symbols, ${this.yearsBack}y back.`);
    initBatchScanProgress(this.symbols);

    const pending = this._pendingSymbols();
    console.log(`[BatchScanner] ${pending.length} symbols pending (${this.symbols.length - pending.length} already done).`);

    for (const sym of pending) {
      if (this.stopRequested) {
        console.log('[BatchScanner] Stop requested — halting.');
        break;
      }

      if (fmpDailyRequestCount >= FMP_DAILY_BUDGET - 20) {
        await this._sleepUntilMidnightUTC();
      }

      this.currentSymbol = sym;
      console.log(`[BatchScanner] Scanning ${sym}…`);

      try {
        const engine = new HistoricalEngine([sym], 2.15, 90, { skipGemini: true });
        const result = await engine.run_scan(sym, this.yearsBack);
        const eventsFound = result?.anomalies?.length ?? 0;
        markBatchScanComplete(sym, eventsFound);
        console.log(`[BatchScanner] ${sym} done — ${eventsFound} anomalies.`);
      } catch (err: any) {
        const msg = String(err?.message ?? 'unknown error');
        markBatchScanError(sym, msg);
        console.warn(`[BatchScanner] ${sym} error: ${msg}`);
      }

      this.currentSymbol = null;
      if (!this.stopRequested) await this._sleep(2000);
    }

    this.running = false;
    this.currentSymbol = null;
    console.log('[BatchScanner] Scan loop finished.');
  }

  stop(): void {
    this.stopRequested = true;
    console.log('[BatchScanner] Stop signal received — will halt after current symbol completes.');
  }

  getStatus(): BatchScanStatus {
    const rows = getBatchScanProgress();
    const bySymbol = new Map(rows.map(r => [r.symbol, r]));

    let scanned = 0;
    let eventsCollected = 0;
    for (const sym of this.symbols) {
      const row = bySymbol.get(sym);
      if (row && (row.status === 'complete' || row.status === 'error')) {
        scanned++;
        eventsCollected += row.events_found;
      }
    }

    const remaining = this.symbols.length - scanned;
    // Rough estimate: ~3 minutes per symbol on average
    const estimatedCompletionHours = Math.round((remaining * 3) / 60 * 10) / 10;

    return {
      isRunning: this.running,
      totalSymbols: this.symbols.length,
      scanned,
      remaining,
      currentSymbol: this.currentSymbol,
      estimatedCompletionHours,
      eventsCollected,
      fmpRequestsUsedToday: fmpDailyRequestCount,
    };
  }

  private _pendingSymbols(): string[] {
    const rows = getBatchScanProgress();
    const done = new Set(
      rows.filter(r => r.status === 'complete' || r.status === 'error').map(r => r.symbol)
    );
    return this.symbols.filter(s => !done.has(s));
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async _sleepUntilMidnightUTC(): Promise<void> {
    const now = new Date();
    // 30-second buffer after midnight ensures FMP has reset before we resume
    const midnight = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0, 0, 30
    ));
    const ms = midnight.getTime() - now.getTime();
    console.log(
      `[BatchScanner] FMP budget near limit (${fmpDailyRequestCount}/${FMP_DAILY_BUDGET}). ` +
      `Pausing ${Math.round(ms / 60000)} min until UTC midnight.`
    );
    await this._sleep(ms);
  }
}
