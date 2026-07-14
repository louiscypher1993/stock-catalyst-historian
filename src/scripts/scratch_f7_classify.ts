#!/usr/bin/env npx tsx
/**
 * scratch_f7_classify.ts — F7 divergence classification.
 *
 * For each affected pot (trade_log_hash differs between before/after),
 * classifies the divergence as:
 *   - PHASE2_RESERVATION_INVOLVED: a 'replacement' close appears in either
 *     the before or after trade log for this pot (Fix B was active at
 *     least once in this pot's history; Fix A may also be active).
 *   - PHASE3_ONLY: no 'replacement' close in either log -- divergence is
 *     attributable purely to Fix A's ranking change.
 *
 * For PHASE3_ONLY pots, also checks the expected-return swap direction:
 * for each date where the set of opened symbols differs between before
 * and after (matched by ordinal position within that date, since slot
 * count per date is a portfolio-state fact independent of which fix
 * changed the pick), compares the after-picked symbol's
 * expectedReturnAtEntry against the before-picked symbol's -- reports
 * what fraction of these swaps went toward a HIGHER expected return, as
 * Fix A is designed to guarantee.
 *
 * Usage: npx tsx src/scripts/scratch_f7_classify.ts <before-detail-name> <after-detail-name>
 */
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'synthetic_pots');

interface TradeLogEntry {
  date: string; symbol: string; kind: 'open' | 'close';
  direction: string; reason: string; price: number;
  realisedPnl?: number; holdingDays?: number;
  expectedReturnAtEntry?: number;
}
interface DetailRecord {
  synthetic_pot_id: number; batch_id: string; trade_log_hash: string;
  trade_log: TradeLogEntry[];
}

async function main() {
  const beforeName = process.argv[2];
  const afterName = process.argv[3];
  if (!beforeName || !afterName) { console.error('Usage: scratch_f7_classify.ts <before-detail-name> <after-detail-name>'); process.exit(1); }

  console.log('Loading detail files (this may take a moment -- large files)...');
  const before: DetailRecord[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${beforeName}.json`), 'utf8'));
  const after: DetailRecord[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${afterName}.json`), 'utf8'));
  console.log(`before: ${before.length} pots, after: ${after.length} pots`);

  const afterById = new Map(after.map(r => [r.synthetic_pot_id, r]));

  let phase2Involved = 0;
  let phase3Only = 0;
  const byBatchPhase2: Record<string, number> = {};
  const byBatchPhase3: Record<string, number> = {};

  let swapTotal = 0;
  let swapHigher = 0;
  let swapLower = 0;
  let swapEqual = 0;
  const swapDeltas: number[] = [];

  for (const b of before) {
    const a = afterById.get(b.synthetic_pot_id);
    if (!a) continue;
    if (a.trade_log_hash === b.trade_log_hash) continue; // shouldn't happen (input is pre-filtered to affected), but guard anyway

    const hasReplacementBefore = b.trade_log.some(t => t.kind === 'close' && t.reason === 'replacement');
    const hasReplacementAfter = a.trade_log.some(t => t.kind === 'close' && t.reason === 'replacement');
    const involvesPhase2 = hasReplacementBefore || hasReplacementAfter;

    if (involvesPhase2) {
      phase2Involved++;
      byBatchPhase2[b.batch_id] = (byBatchPhase2[b.batch_id] || 0) + 1;
      continue; // swap-direction check is scoped to PHASE3-only pots
    }

    phase3Only++;
    byBatchPhase3[b.batch_id] = (byBatchPhase3[b.batch_id] || 0) + 1;

    // Group opens by date, match by ordinal position within each date.
    const opensByDateBefore: Record<string, TradeLogEntry[]> = {};
    for (const t of b.trade_log) if (t.kind === 'open') (opensByDateBefore[t.date] = opensByDateBefore[t.date] || []).push(t);
    const opensByDateAfter: Record<string, TradeLogEntry[]> = {};
    for (const t of a.trade_log) if (t.kind === 'open') (opensByDateAfter[t.date] = opensByDateAfter[t.date] || []).push(t);

    const allDates = new Set([...Object.keys(opensByDateBefore), ...Object.keys(opensByDateAfter)]);
    for (const date of allDates) {
      const bOpens = opensByDateBefore[date] || [];
      const aOpens = opensByDateAfter[date] || [];
      const n = Math.max(bOpens.length, aOpens.length);
      for (let i = 0; i < n; i++) {
        const bo = bOpens[i];
        const ao = aOpens[i];
        if (!bo || !ao) continue; // different open-count that day -- not a same-slot swap, skip
        if (bo.symbol === ao.symbol) continue; // same pick, no swap
        swapTotal++;
        const bRet = bo.expectedReturnAtEntry ?? 0;
        const aRet = ao.expectedReturnAtEntry ?? 0;
        const delta = aRet - bRet;
        swapDeltas.push(delta);
        if (delta > 1e-9) swapHigher++;
        else if (delta < -1e-9) swapLower++;
        else swapEqual++;
      }
    }
  }

  console.log(`\n=== Divergence classification ===`);
  console.log(`PHASE2_RESERVATION_INVOLVED: ${phase2Involved}`);
  console.log(`PHASE3_ONLY: ${phase3Only}`);

  console.log(`\n=== PHASE2_RESERVATION_INVOLVED by batch_id ===`);
  for (const [batch, count] of Object.entries(byBatchPhase2)) console.log(`  ${batch.padEnd(30)} ${count}`);

  console.log(`\n=== PHASE3_ONLY by batch_id ===`);
  for (const [batch, count] of Object.entries(byBatchPhase3)) console.log(`  ${batch.padEnd(30)} ${count}`);

  console.log(`\n=== Expected-return swap direction (PHASE3_ONLY pots, same-date/same-ordinal-slot swaps) ===`);
  console.log(`Total swaps: ${swapTotal}`);
  console.log(`  Higher expected return after: ${swapHigher} (${(100 * swapHigher / swapTotal).toFixed(2)}%)`);
  console.log(`  Lower expected return after:  ${swapLower} (${(100 * swapLower / swapTotal).toFixed(2)}%)`);
  console.log(`  Equal: ${swapEqual}`);
  const meanDelta = swapDeltas.reduce((s, d) => s + d, 0) / (swapDeltas.length || 1);
  console.log(`  Mean delta (after - before expected return): ${meanDelta.toFixed(6)}`);

  fs.writeFileSync(path.join(DATA_DIR, 'f7_classification_summary.json'), JSON.stringify({
    phase2Involved, phase3Only, byBatchPhase2, byBatchPhase3,
    swapTotal, swapHigher, swapLower, swapEqual, meanDelta,
  }, null, 2));
  console.log(`\nWrote f7_classification_summary.json`);
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
