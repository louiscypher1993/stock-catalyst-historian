/**
 * measureSignalDecay.ts — the missing 8th cost component.
 *
 * THE GAP. The signal is computed from a CLOSE and executed at the NEXT OPEN. The cost
 * model prices 7 components (tax, commission, FX, spread, dividend credit, lot size,
 * slippage/borrow) but none of them capture what is lost in that gap. The research
 * report names it directly: "measure your own close-to-next-open decay explicitly
 * (compare theoretical close-execution vs realized next-open fills) and fold it into the
 * cost model — you already model 7 cost components; signal decay is the missing 8th."
 *
 * WHAT IS MEASURED, per selected name:
 *     theoretical = (close[d+H] - close[d])  / close[d]      <- what a backtest assumes
 *     realised    = (close[d+H] - open[d+1]) / open[d+1]     <- what you can actually get
 *     decay       = theoretical - realised
 * Both exit at the same bar, so the difference is purely the entry you cannot have.
 * For a signal that fires on a move, the overnight gap tends to run AGAINST the entry —
 * a positive decay is the expected result, not a bug.
 *
 * DIRECTION MATTERS. Decay is signed against the intended direction: for a short
 * (negative predicted return) an adverse gap is a gap DOWN, so the sign is flipped.
 * Averaging raw differences across longs and shorts would cancel a real cost to ~0.
 *
 * MEASURES ONLY — costModel.ts is deliberately NOT touched. There is a standing rule
 * that the September checkpoint gets read once against the frozen 7-component model
 * before anything is added to it, so this produces the number and stops.
 *
 * Usage:
 *   npx tsx src/scripts/measureSignalDecay.ts            # top-3/day, the live rule
 *   npx tsx src/scripts/measureSignalDecay.ts --topk 10
 */
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB = join(__dirname, '..', '..', 'market_cache.db');

// head -> (prediction column, holding period in TRADING bars)
const HEADS: Array<[string, string, number]> = [
  ['D3 (2D)', 'model_d3_return_2d', 2],
  ['D5 (2W)', 'model_d5_return_2w', 10],
  ['D1 (3M)', 'model_d1_return_3m', 63],
];

function pct(x: number) { return (x * 100).toFixed(3) + '%'; }
function bps(x: number) { return (x * 10000).toFixed(1) + 'bps'; }

function median(a: number[]) {
  if (!a.length) return NaN;
  const b = [...a].sort((x, y) => x - y);
  return b[Math.floor(b.length / 2)];
}

function main() {
  const topkArg = process.argv.indexOf('--topk');
  const TOPK = topkArg >= 0 ? Number(process.argv[topkArg + 1]) : 3;
  const db = new Database(DB, { readonly: true });

  // price series per symbol, indexed by date
  const priceStmt = db.prepare(
    'SELECT date, open, close FROM daily_prices WHERE symbol=? ORDER BY date');
  const cache = new Map<string, { dates: string[]; open: number[]; close: number[]; idx: Map<string, number> }>();
  function series(sym: string) {
    if (!cache.has(sym)) {
      const rows = priceStmt.all(sym) as { date: string; open: number | null; close: number }[];
      const idx = new Map<string, number>();
      rows.forEach((r, i) => idx.set(r.date, i));
      cache.set(sym, {
        dates: rows.map(r => r.date),
        open: rows.map(r => (r.open ?? NaN)),
        close: rows.map(r => r.close),
        idx,
      });
    }
    return cache.get(sym)!;
  }

  const rows = db.prepare(`
    SELECT symbol, date, recommendation, model_d3_return_2d, model_d5_return_2w,
           model_d1_return_3m
    FROM historical_inference_results ORDER BY date, symbol
  `).all() as any[];

  const byDate = new Map<string, any[]>();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }
  console.log(`backtest track record: ${rows.length.toLocaleString()} rows over ` +
              `${byDate.size} run_dates; selection rule = top-${TOPK} per day by |prediction|\n`);

  console.log(`${'head'.padEnd(10)}${'n'.padStart(7)}${'theoretical'.padStart(13)}` +
              `${'realised'.padStart(11)}${'DECAY(mean)'.padStart(13)}${'decay(med)'.padStart(12)}` +
              `${'% adverse'.padStart(11)}`);
  console.log('-'.repeat(77));

  const stash: Array<[string, number[]]> = [];
  for (const [label, col, H] of HEADS) {
    const theo: number[] = [], real: number[] = [], decay: number[] = [];
    for (const [, day] of byDate) {
      // the live rule ranks by predicted magnitude and takes the top k
      const picks = day
        .filter(r => typeof r[col] === 'number' && Number.isFinite(r[col]))
        .sort((a, b) => Math.abs(b[col]) - Math.abs(a[col]))
        .slice(0, TOPK);
      for (const p of picks) {
        const s = series(p.symbol);
        const i = s.idx.get(p.date);
        if (i === undefined) continue;
        const entryClose = s.close[i];
        const entryOpen = s.open[i + 1];
        const exitClose = s.close[i + H];
        if (!entryClose || !Number.isFinite(entryOpen) || !entryOpen || !exitClose) continue;
        const dir = p[col] >= 0 ? 1 : -1;   // signed so a short's adverse gap is not netted out
        const t = dir * (exitClose - entryClose) / entryClose;
        const r = dir * (exitClose - entryOpen) / entryOpen;
        theo.push(t); real.push(r); decay.push(t - r);
      }
    }
    if (!decay.length) { console.log(`${label.padEnd(10)} no usable rows`); continue; }
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const adverse = decay.filter(d => d > 0).length / decay.length;
    console.log(`${label.padEnd(10)}${decay.length.toString().padStart(7)}` +
                `${pct(mean(theo)).padStart(13)}${pct(mean(real)).padStart(11)}` +
                `${bps(mean(decay)).padStart(13)}${bps(median(decay)).padStart(12)}` +
                `${(100 * adverse).toFixed(1).padStart(10)}%`);
    stash.push([label, decay]);
  }

  // The median sits at ~0 and fewer than half the trades are adverse, so the positive
  // mean is driven by a minority of large adverse gaps. Before anyone charges this as a
  // fixed cost it is worth knowing HOW tail-dependent it is and whether it is even
  // distinguishable from zero — a mean built from a fat tail on ~1,000 observations can
  // be very noisy.
  console.log(`\n${'head'.padEnd(10)}${'mean'.padStart(10)}${'std err'.padStart(10)}` +
              `${'t'.padStart(7)}${'95% CI'.padStart(22)}${'10% trimmed'.padStart(14)}`);
  console.log('-'.repeat(73));
  for (const [label, d] of stash) {
    const n = d.length;
    const m = d.reduce((s, v) => s + v, 0) / n;
    const sd = Math.sqrt(d.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1));
    const se = sd / Math.sqrt(n);
    const lo = m - 1.96 * se, hi = m + 1.96 * se;
    const srt = [...d].sort((a, b) => a - b);
    const cut = Math.floor(n * 0.1);
    const trimmed = srt.slice(cut, n - cut);
    const tm = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
    console.log(`${label.padEnd(10)}${bps(m).padStart(10)}${bps(se).padStart(10)}` +
                `${(m / se).toFixed(2).padStart(7)}` +
                `${(`[${bps(lo)}, ${bps(hi)}]`).padStart(22)}${bps(tm).padStart(14)}`);
  }

  console.log('\nDECAY = theoretical - realised, signed toward the intended direction.');
  console.log('Positive = the next-open entry is WORSE than the close a backtest assumes,');
  console.log('i.e. a real cost the 7-component model does not currently charge.');
  console.log('\nNOT applied to costModel.ts — the September checkpoint is read against the');
  console.log('frozen 7-component model first, per the retroactive-application rule.');
  db.close();
}

main();
