/**
 * PREREG_2026-08-21_riskscore_refit.md — PART C1.
 *
 * Refit HORIZON_TIER_CONFIG cutoffs on post-parity CLEAN LIVE output percentiles
 * (standing rule 1: never fold percentiles), then check occupancy against the
 * ~10/10/10/70 design target.
 *
 * Each head's TIER STRUCTURE is preserved — only thresholds move. D3 has no BUY, D1
 * has no BUY/SELL, D2's ceiling is BUY, B is deliberately empty. Changing structure is
 * not in the pre-registration.
 *
 * C1 is largely self-fulfilling by construction (fit to live percentiles -> hit the
 * target occupancy). It is a check that the fit was applied correctly, NOT evidence
 * that the refit helps. That is C2's job, and C2 needs matured 2W outcomes.
 *
 * READ-ONLY: prints proposed constants, changes no code.
 */
import 'dotenv/config';
import { HORIZON_TIER_CONFIG, resolveTierFromConfig } from '../PotService';

const HEADS: Array<{ field: string; label: string; tiers: string[] }> = [
  { field: 'model_d3_return_2d', label: 'D3 2D', tiers: ['strongBuy', 'sell'] },
  { field: 'model_d5_return_2w', label: 'D5 2W', tiers: ['strongBuy', 'buy', 'sell'] },
  { field: 'model_d1_return_3m', label: 'D1 3M', tiers: ['strongBuy'] },
  { field: 'model_d2_return_6m', label: 'D2 6M', tiers: ['buy'] },
];

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabase.from('inference_results')
      .select('run_date, unreliable_reason, ' + HEADS.map(h => h.field).join(', '))
      .gte('run_date', '2026-08-09').range(f, f + 999);
    if (error) throw error;
    rows.push(...(data ?? [])); if ((data ?? []).length < 1000) break;
  }
  const clean = rows.filter(r => !r.unreliable_reason);
  const days = new Set(clean.map(r => String(r.run_date).slice(0, 10)));
  console.log(`post-parity clean rows ${clean.length} over ${days.size} run_dates`);
  console.log(`C1 gate needs >=10 run_dates: ${days.size >= 10 ? 'MET' : 'NOT MET'}\n`);

  const occ = (vals: number[], cfg: any) => {
    const c: Record<string, number> = { STRONG_BUY: 0, BUY: 0, SELL: 0, HOLD: 0 };
    for (const v of vals) { const t = resolveTierFromConfig(v, cfg); c[t] = (c[t] ?? 0) + 1; }
    const n = vals.length;
    return Object.fromEntries(Object.entries(c).map(([k, x]) => [k, 100 * x / n]));
  };
  const fmt = (o: any) => `SB ${o.STRONG_BUY.toFixed(1)}%  BUY ${o.BUY.toFixed(1)}%  SELL ${o.SELL.toFixed(1)}%  HOLD ${o.HOLD.toFixed(1)}%`;

  const proposed: string[] = [];
  for (const h of HEADS) {
    const vals = clean.map(r => r[h.field]).filter(v => v != null).map(Number);
    if (!vals.length) { console.log(`${h.label}: no live values\n`); continue; }
    const s = [...vals].sort((a, b) => a - b);
    const cur = HORIZON_TIER_CONFIG[h.field as keyof typeof HORIZON_TIER_CONFIG] as any;

    // Refit: strongBuy=p90, buy=[p80,p90), sell=p10 — the ~10/10/10/70 design target,
    // restricted to the tiers this head actually has.
    const p90 = pct(s, 0.90), p80 = pct(s, 0.80), p10 = pct(s, 0.10);
    const nu: any = {};
    if (h.tiers.includes('strongBuy')) nu.strongBuy = (v: number) => v >= p90;
    if (h.tiers.includes('buy')) nu.buy = h.tiers.includes('strongBuy')
      ? (v: number) => v >= p80 && v < p90
      : (v: number) => v >= p90;                 // D2: BUY is the ceiling -> top decile
    if (h.tiers.includes('sell')) nu.sell = (v: number) => v <= p10;

    console.log(`▸ ${h.label}  n=${vals.length}`);
    console.log(`    deployed  ${fmt(occ(vals, cur))}`);
    console.log(`    refitted  ${fmt(occ(vals, nu))}`);
    const parts: string[] = [];
    if (nu.strongBuy) parts.push(`strongBuy: v => v >= ${p90.toFixed(6)}`);
    if (nu.buy) parts.push(h.tiers.includes('strongBuy')
      ? `buy:       v => v >= ${p80.toFixed(6)} && v < ${p90.toFixed(6)}`
      : `buy:       v => v >= ${p90.toFixed(6)}`);
    if (nu.sell) parts.push(`sell:      v => v <= ${p10.toFixed(6)}`);
    console.log(`    proposed  ${parts.join('\n              ')}\n`);
    proposed.push(`  ${h.field}: {\n    ${parts.join(',\n    ')},\n  },`);
  }

  console.log('='.repeat(70));
  console.log('PROPOSED HORIZON_TIER_CONFIG (live-percentile refit, NOT applied):');
  console.log('='.repeat(70));
  console.log(proposed.join('\n'));
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
