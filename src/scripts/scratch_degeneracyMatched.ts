/**
 * Attribution, done properly. Two problems with the naive pre/post comparison:
 *
 * 1. THE WINDOWS ARE CONFOUNDED. LIVE_FEATURE_PARITY landed 2026-08-09 12:07 UTC and the
 *    universe expanded 2026-08-10 10:29 UTC -- 22 hours apart. A "pre-expansion" window
 *    of 08-04..08-10 is therefore almost entirely PRE-PARITY too, so any drop could be
 *    either change. Splitting into three windows separates them.
 *
 * 2. DISTINCT-SHARE IS NOT SCALE-INVARIANT. Drawing n predictions from a fixed set of
 *    achievable leaf values gives a distinct SHARE that falls as n rises, purely
 *    combinatorially. Comparing 718 rows against 429 against 91 measures sample size as
 *    much as diversity. Fixed by subsampling every window to the same n and averaging
 *    over many draws.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const PARITY    = '2026-08-09T12:07:00Z';
const EXPANSION = '2026-08-10T10:29:00Z';
const HEADS = ['model_b_return_1m', 'model_d1_return_3m', 'model_d2_return_6m',
               'model_d3_return_2d', 'model_d5_return_2w', 'model_c_max_drawdown'];
const TRIALS = 400;

function expansionSymbols(): Set<string> {
  const out = new Set<string>();
  for (const f of ['universe_expansion.json', 'autoListings.json']) {
    const p = path.join(process.cwd(), 'src', f);
    if (!fs.existsSync(p)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const s of j.symbols ?? j.stocks ?? []) if (s?.symbol) out.add(String(s.symbol).toUpperCase());
    } catch { /* degrade gracefully */ }
  }
  return out;
}

async function fetchWindow(gte: string, lt: string) {
  const { supabase } = await import('../db/supabaseClient');
  const rows: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabase.from('inference_results')
      .select(['symbol', ...HEADS].join(','))
      .gte('created_at', gte).lt('created_at', lt)
      .order('created_at', { ascending: true }).range(f, f + 999);
    if (error) throw error;
    const b = data ?? []; rows.push(...b); if (b.length < 1000) break;
  }
  return rows;
}

/** Mean distinct-share over TRIALS random subsamples of size n. */
function matchedDistinct(rows: any[], head: string, n: number): number {
  const vals = rows.map(r => r[head]).filter((v: any) => v != null).map((v: number) => v.toFixed(6));
  if (vals.length < n) return NaN;
  let acc = 0;
  for (let t = 0; t < TRIALS; t++) {
    const pool = vals.slice();
    const pick = new Set<string>();
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
      pick.add(pool[i]);
    }
    acc += pick.size / n;
  }
  return 100 * acc / TRIALS;
}

async function main() {
  const exp = expansionSymbols();
  const preParity  = await fetchWindow('2026-08-04T00:00:00Z', PARITY);
  const postParity = await fetchWindow(PARITY, EXPANSION);
  const postExp    = (await fetchWindow(EXPANSION, '2099-01-01T00:00:00Z'))
    .filter(r => !exp.has(String(r.symbol).toUpperCase()));

  const n = Math.min(preParity.length, postParity.length, postExp.length);
  console.log(`A pre-parity/pre-expansion : ${preParity.length} rows`);
  console.log(`B post-parity/pre-expansion: ${postParity.length} rows   <- the 22-hour window`);
  console.log(`C post-parity/post-expansion (core only): ${postExp.length} rows`);
  console.log(`\nAll three subsampled to n=${n}, ${TRIALS} draws each.\n`);

  console.log(`${'head'.padEnd(24)}${'A pre-par'.padStart(10)}${'B post-par'.padStart(12)}${'C post-exp'.padStart(12)}   attribution`);
  console.log('-'.repeat(82));
  for (const h of HEADS) {
    const a = matchedDistinct(preParity, h, n);
    const b = matchedDistinct(postParity, h, n);
    const c = matchedDistinct(postExp, h, n);
    let note = '';
    if ([a, b, c].some(Number.isNaN)) note = 'insufficient rows';
    else {
      const parityShift = b - a, expShift = c - b;
      if (Math.abs(parityShift) > 5 && Math.abs(expShift) <= 5) note = 'PARITY moved it';
      else if (Math.abs(expShift) > 5 && Math.abs(parityShift) <= 5) note = 'EXPANSION moved it';
      else if (Math.abs(parityShift) > 5 && Math.abs(expShift) > 5) note = 'both moved it';
      else note = 'stable';
    }
    const f = (v: number) => Number.isNaN(v) ? '   n/a' : `${v.toFixed(1)}%`;
    console.log(`${h.padEnd(24)}${f(a).padStart(10)}${f(b).padStart(12)}${f(c).padStart(12)}   ${note}`);
  }
  console.log('\n(>5pp counts as a move; smaller is noise at this sample size.)');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
