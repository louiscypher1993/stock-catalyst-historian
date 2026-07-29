/**
 * scratch_delisting_audit2.cjs — RECON ONLY, NO WRITES. Refinement of audit #1.
 *
 * Audit #1 found 570 "missing" rows, but concentrated entirely in 2D/2W with
 * target dates at/near today — which looks like cron lag (matured since the last
 * tracker run), not delisting. This separates the two: age the missing rows by
 * how long ago their target date passed. A row whose target passed WEEKS ago and
 * is still absent is a genuine silent drop; one whose target passed yesterday is
 * simply awaiting the next tracker run.
 */
require('dotenv/config');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const HORIZONS = [
  { label: '2D', days: 2, pred: 'model_d3_return_2d' },
  { label: '2W', days: 14, pred: 'model_d5_return_2w' },
  { label: '1M', days: 30, pred: 'model_b_return_1m' },
  { label: '3M', days: 91, pred: 'model_d1_return_3m' },
  { label: '6M', days: 182, pred: 'model_d2_return_6m' },
];
const addDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const today = new Date().toISOString().slice(0, 10);

async function page(table, select) {
  const out = []; const size = 1000;
  for (let off = 0; ; off += size) {
    const res = await fetch(`${URL}/rest/v1/${table}?select=${select}&limit=${size}&offset=${off}`, { headers: H });
    if (!res.ok) throw new Error(`${table} HTTP ${res.status}`);
    const rows = await res.json(); out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

(async () => {
  const inf = await page('inference_results', 'symbol,run_date,current_price,unreliable_reason,' + HORIZONS.map(h => h.pred).join(','));
  const out = await page('outcome_results', 'symbol,run_date,horizon,target_date,checked_at,actual_source');
  const have = new Set(out.map(r => `${r.symbol}|${r.run_date}|${r.horizon}`));

  // When did the tracker last actually run / last successfully record anything?
  const checked = out.map(r => r.checked_at).filter(Boolean).sort();
  const maxTarget = out.map(r => r.target_date).filter(Boolean).sort();
  const infDates = [...new Set(inf.map(r => r.run_date))].sort();
  console.log('='.repeat(74));
  console.log(' TIMELINE');
  console.log('='.repeat(74));
  console.log(`  today                        : ${today}`);
  console.log(`  inference_results run_dates  : ${infDates[0]} -> ${infDates[infDates.length - 1]} (${infDates.length} distinct)`);
  console.log(`  last 6 run_dates             : ${infDates.slice(-6).join(', ')}`);
  console.log(`  outcome rows last checked_at : ${checked[checked.length - 1] ?? 'n/a'}`);
  console.log(`  max target_date recorded     : ${maxTarget[maxTarget.length - 1] ?? 'n/a'}`);

  const missing = [];
  for (const r of inf) {
    if (r.unreliable_reason || r.current_price == null) continue;
    for (const h of HORIZONS) {
      if (r[h.pred] == null) continue;
      const target = addDays(r.run_date, h.days);
      if (target > today) continue;
      if (!have.has(`${r.symbol}|${r.run_date}|${h.label}`)) {
        missing.push({ symbol: r.symbol, run_date: r.run_date, horizon: h.label, target, ageDays: daysBetween(target, today) });
      }
    }
  }

  // Age buckets — the decisive split
  const buckets = { '0 (today)': 0, '1': 0, '2': 0, '3-6': 0, '7-13': 0, '14-29': 0, '30+': 0 };
  for (const m of missing) {
    const a = m.ageDays;
    if (a <= 0) buckets['0 (today)']++;
    else if (a === 1) buckets['1']++;
    else if (a === 2) buckets['2']++;
    else if (a <= 6) buckets['3-6']++;
    else if (a <= 13) buckets['7-13']++;
    else if (a <= 29) buckets['14-29']++;
    else buckets['30+']++;
  }
  console.log('\n' + '='.repeat(74));
  console.log(' MISSING ROWS BY AGE OF TARGET DATE  (how long ago the window closed)');
  console.log('='.repeat(74));
  console.log(`  total missing: ${missing.length}`);
  for (const [k, v] of Object.entries(buckets)) {
    const tag = k === '0 (today)' || k === '1' || k === '2' ? '  <- plausible cron lag' : '  <- GENUINELY DROPPED (window long closed)';
    console.log(`    target aged ${k.padEnd(10)} days : ${String(v).padStart(4)}${v ? tag : ''}`);
  }

  const stale = missing.filter(m => m.ageDays >= 3);
  console.log(`\n  => cron-lag (aged <=2d) : ${missing.length - stale.length}`);
  console.log(`  => GENUINE DROPS (>=3d) : ${stale.length}`);

  if (stale.length) {
    const byH = {}, bySym = new Map(), byRun = {};
    for (const m of stale) {
      byH[m.horizon] = (byH[m.horizon] || 0) + 1;
      bySym.set(m.symbol, (bySym.get(m.symbol) || 0) + 1);
      byRun[m.run_date] = (byRun[m.run_date] || 0) + 1;
    }
    console.log(`\n  genuine drops by horizon : ${Object.entries(byH).map(([k, v]) => `${k}=${v}`).join('  ')}`);
    console.log(`  distinct symbols affected: ${bySym.size}`);
    console.log(`\n  by run_date (top 15):`);
    for (const [d, n] of Object.entries(byRun).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`     ${d}  ${n}`);
    console.log(`\n  top 30 symbols (genuine drops):`);
    for (const [s, n] of [...bySym.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`     ${s.padEnd(14)} ${n}`);
    console.log(`\n  sample of 20 genuinely-dropped rows:`);
    for (const m of stale.slice(0, 20)) console.log(`     ${m.symbol.padEnd(13)} run ${m.run_date}  ${m.horizon.padEnd(3)} target ${m.target}  (${m.ageDays}d ago)`);
  }

  // Distribution of actual_source on rows that DID resolve — how reliant are we on Yahoo?
  const bySrc = {};
  for (const r of out) bySrc[r.actual_source || 'null'] = (bySrc[r.actual_source || 'null'] || 0) + 1;
  console.log('\n' + '='.repeat(74));
  console.log(' RESOLVED-ROW PRICE SOURCE MIX');
  console.log('='.repeat(74));
  for (const [k, v] of Object.entries(bySrc).sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(18)} ${v}`);
  console.log('\nRecon complete. No writes performed.');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
