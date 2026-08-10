/**
 * Out-of-training-universe cohort readout.
 *
 * outcomeTracker deliberately never checks unreliable_reason rows, so the
 * null_enrichment cohort (Phenomenon-1 symbols + the 2026-08-10 universe expansion)
 * accumulates predictions with no outcome trail. This script closes that loop ON
 * DEMAND without touching the checkpoint pipeline: it re-derives realized returns
 * straight from Yahoo bars and reports day-clustered IC per horizon for the cohort.
 *
 * Both entry and exit prices come from the SAME Yahoo bar series (entry = event-date
 * bar, exit = nearest bar to entry+horizon, ±3 trading-day tolerance) -- immune to
 * the GBp/GBP unit mismatches that using stored current_price against a fresh Yahoo
 * close would reintroduce (the III.L 113x lesson).
 *
 * Rows are segmented at the 2026-08-09 parity boundary like readoutHarness; the two
 * regimes are NOT merged.
 *
 * Usage: npx tsx src/scripts/expansionReadout.ts [--since 2026-07-22]
 */
import 'dotenv/config';
import { fetchYahooDailyHistory } from '../LiveInferenceService';

const PARITY = '2026-08-09';
const sinceIdx = process.argv.indexOf('--since');
const SINCE = sinceIdx > -1 ? process.argv[sinceIdx + 1] : '2026-07-22';
const TOL_DAYS = 3;
const HORIZONS: Array<{ label: string; days: number; pred: string }> = [
  { label: '2D', days: 2,  pred: 'model_d3_return_2d' },
  { label: '2W', days: 14, pred: 'model_d5_return_2w' },
  { label: '1M', days: 30, pred: 'model_b_return_1m' },
];

function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const idx = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array(xs.length).fill(0);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a), rb = rank(b);
  const ma = ra.reduce((s, v) => s + v, 0) / ra.length;
  const mb = rb.reduce((s, v) => s + v, 0) / rb.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

async function main() {
  const { supabase } = await import('../db/supabaseClient');
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('inference_results')
      .select('symbol, run_date, z_score, unreliable_reason, model_d3_return_2d, model_d5_return_2w, model_b_return_1m')
      .eq('unreliable_reason', 'null_enrichment')
      .gte('run_date', SINCE)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  console.log(`null_enrichment rows since ${SINCE}: ${rows.length} ` +
              `(${new Set(rows.map(r => r.symbol)).size} symbols)`);

  const barsBySymbol = new Map<string, Array<{ date: string; close: number }>>();
  const symbols = [...new Set(rows.map(r => r.symbol))];
  for (const s of symbols) {
    try {
      barsBySymbol.set(s, await fetchYahooDailyHistory(s, '6mo'));
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 120));
  }

  for (const regime of [`pre-parity  (< ${PARITY})`, `post-parity (>= ${PARITY})`]) {
    const isPost = regime.startsWith('post');
    const seg = rows.filter(r => isPost === (String(r.run_date).slice(0, 10) >= PARITY));
    console.log(`\n=== ${regime}: ${seg.length} rows ===`);
    for (const h of HORIZONS) {
      const perDay = new Map<string, Array<{ p: number; y: number }>>();
      let matured = 0;
      for (const r of seg) {
        const bars = barsBySymbol.get(r.symbol);
        const pred = Number(r[h.pred]);
        if (!bars || !Number.isFinite(pred)) continue;
        const d0 = String(r.run_date).slice(0, 10);
        const i0 = bars.findIndex(b => b.date >= d0);
        if (i0 < 0) continue;
        const target = new Date(new Date(d0).getTime() + h.days * 86400000);
        let best: { close: number } | null = null, bestGap = Infinity;
        for (const b of bars) {
          const gap = Math.abs((new Date(b.date).getTime() - target.getTime()) / 86400000);
          if (gap < bestGap && new Date(b.date) > new Date(d0)) { bestGap = gap; best = b; }
        }
        if (!best || bestGap > TOL_DAYS) continue;
        const entry = bars[i0].close;
        if (!(entry > 0)) continue;
        matured++;
        const y = best.close / entry - 1;
        if (!perDay.has(d0)) perDay.set(d0, []);
        perDay.get(d0)!.push({ p: pred, y });
      }
      const ics: number[] = [];
      for (const [, g] of perDay) {
        if (g.length >= 5) ics.push(spearman(g.map(x => x.p), g.map(x => x.y)));
      }
      const mean = ics.length ? ics.reduce((s, v) => s + v, 0) / ics.length : NaN;
      const sd = ics.length > 1
        ? Math.sqrt(ics.reduce((s, v) => s + (v - mean) ** 2, 0) / (ics.length - 1)) : NaN;
      const t = ics.length > 1 ? mean / (sd / Math.sqrt(ics.length)) : NaN;
      console.log(`  ${h.label}: matured rows ${matured}, days with >=5 rows ${ics.length}, ` +
                  `day-IC ${Number.isFinite(mean) ? mean.toFixed(4) : 'n/a'}` +
                  `${Number.isFinite(t) ? ` (t=${t.toFixed(2)})` : ''}`);
    }
  }
  console.log('\nInterpretation: compare against the in-training-universe fold anchors ' +
              '(D3 0.083, D5 0.107 day-IC). The expansion cohort earns trust when its ' +
              'post-parity day-IC is same-sign and within ~2x of those over >=10 days.');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
