#!/usr/bin/env npx tsx
/**
 * scratch_f7_diff.ts — F7 before/after sweep diff.
 *
 * Joins two lean sweep-signature files (scratch_f7_sweep_with_tradelog.ts's
 * lean-mode output) by synthetic_pot_id, flags pots whose trade_log_hash
 * differs, and reports affected-pot rate (overall + by batch_id) and
 * per-pot metric deltas (total_return_pct/sharpe/max_drawdown_pct/
 * win_rate_pct) restricted to the affected subset. Writes the affected
 * pot-id list to disk for the targeted detail pass (which classifies
 * PHASE3-only vs PHASE2-reservation and checks the expected-return swap
 * direction -- this script does not do that; it needs full trade logs,
 * which the lean signature files don't carry).
 *
 * Usage: npx tsx src/scripts/scratch_f7_diff.ts <before-name> <after-name>
 */
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'synthetic_pots');

interface Signature {
  synthetic_pot_id: number; batch_id: string; trade_log_hash: string;
  ending_value: number; total_return_pct: number; sharpe: number;
  max_drawdown_pct: number; win_rate_pct: number | null; trade_count: number;
  avg_holding_days: number | null; events_skipped_no_price: number;
}

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

async function main() {
  const beforeName = process.argv[2];
  const afterName = process.argv[3];
  if (!beforeName || !afterName) { console.error('Usage: scratch_f7_diff.ts <before-name> <after-name>'); process.exit(1); }

  const before: Signature[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${beforeName}.json`), 'utf8'));
  const after: Signature[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${afterName}.json`), 'utf8'));

  const beforeById = new Map(before.map(s => [s.synthetic_pot_id, s]));
  const afterById = new Map(after.map(s => [s.synthetic_pot_id, s]));

  console.log(`before: ${before.length} pots, after: ${after.length} pots`);
  if (before.length !== after.length) console.log('WARNING: pot counts differ between runs');

  const affected: Array<{ id: number; batch: string; b: Signature; a: Signature }> = [];
  let unaffected = 0;
  let missingInAfter = 0;

  for (const b of before) {
    const a = afterById.get(b.synthetic_pot_id);
    if (!a) { missingInAfter++; continue; }
    if (a.trade_log_hash !== b.trade_log_hash) {
      affected.push({ id: b.synthetic_pot_id, batch: b.batch_id, b, a });
    } else {
      unaffected++;
    }
  }

  console.log(`\n=== Affected-pot rate ===`);
  console.log(`Affected: ${affected.length}/${before.length} (${(100 * affected.length / before.length).toFixed(2)}%)`);
  console.log(`Unaffected: ${unaffected}`);
  if (missingInAfter) console.log(`Missing in after (WARNING): ${missingInAfter}`);

  const byBatch: Record<string, { total: number; affected: number }> = {};
  for (const b of before) {
    byBatch[b.batch_id] = byBatch[b.batch_id] || { total: 0, affected: 0 };
    byBatch[b.batch_id].total++;
  }
  for (const x of affected) byBatch[x.batch].affected++;

  console.log(`\n=== Affected-pot rate by batch_id ===`);
  for (const [batch, { total, affected: aff }] of Object.entries(byBatch)) {
    console.log(`  ${batch.padEnd(30)} ${aff}/${total} (${(100 * aff / total).toFixed(2)}%)`);
  }

  // Metric deltas, affected subset only
  const deltas = affected.map(x => ({
    id: x.id,
    d_total_return_pct: x.a.total_return_pct - x.b.total_return_pct,
    d_sharpe: x.a.sharpe - x.b.sharpe,
    d_max_drawdown_pct: x.a.max_drawdown_pct - x.b.max_drawdown_pct,
    d_win_rate_pct: (x.a.win_rate_pct ?? 0) - (x.b.win_rate_pct ?? 0),
    d_trade_count: x.a.trade_count - x.b.trade_count,
  }));

  console.log(`\n=== Metric deltas (affected subset only, n=${deltas.length}) ===`);
  for (const key of ['d_total_return_pct', 'd_sharpe', 'd_max_drawdown_pct', 'd_win_rate_pct', 'd_trade_count'] as const) {
    const xs = deltas.map(d => d[key]);
    const pos = xs.filter(v => v > 0).length;
    const neg = xs.filter(v => v < 0).length;
    const zero = xs.filter(v => v === 0).length;
    console.log(`  ${key.padEnd(22)} mean=${mean(xs).toFixed(4)} median=${median(xs).toFixed(4)} min=${Math.min(...xs).toFixed(4)} max=${Math.max(...xs).toFixed(4)}  (+${pos} / -${neg} / 0:${zero})`);
  }

  console.log(`\n=== events_skipped_no_price (occupancy/slot-fill sanity check) ===`);
  const skipBefore = before.reduce((s, p) => s + p.events_skipped_no_price, 0);
  const skipAfter = after.reduce((s, p) => s + p.events_skipped_no_price, 0);
  console.log(`  total before: ${skipBefore}, total after: ${skipAfter}, delta: ${skipAfter - skipBefore}`);

  const tradeCountBefore = before.reduce((s, p) => s + p.trade_count, 0);
  const tradeCountAfter = after.reduce((s, p) => s + p.trade_count, 0);
  console.log(`  total trade_count before: ${tradeCountBefore}, after: ${tradeCountAfter}, delta: ${tradeCountAfter - tradeCountBefore}`);

  const outPath = path.join(DATA_DIR, 'f7_affected_pot_ids.json');
  fs.writeFileSync(outPath, JSON.stringify(affected.map(x => x.id)));
  console.log(`\nWrote ${affected.length} affected pot IDs to ${outPath}`);

  const summaryPath = path.join(DATA_DIR, 'f7_diff_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    totalPots: before.length, affectedCount: affected.length, unaffectedCount: unaffected,
    byBatch, deltas, skipBefore, skipAfter, tradeCountBefore, tradeCountAfter,
  }, null, 2));
  console.log(`Wrote summary to ${summaryPath}`);
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
