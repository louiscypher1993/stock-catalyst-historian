/**
 * scratch_delisting_audit.cjs — RECON ONLY, NO WRITES.
 *
 * Question: does a symbol that gets delisted/acquired/halted mid-window produce a
 * real outcome row, or does it silently vanish from the durable outcome store?
 *
 * Method: reconstruct the set of (symbol, run_date, horizon) rows the tracker
 * SHOULD have produced (applying its own filters: unreliable_reason excluded,
 * null current_price excluded, null prediction excluded, target_date <= today),
 * diff against what's actually in outcome_results, and characterise the gap.
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
const today = new Date().toISOString().slice(0, 10);

async function page(table, select, extra = '') {
  const out = [];
  const size = 1000;
  for (let off = 0; ; off += size) {
    const res = await fetch(`${URL}/rest/v1/${table}?select=${select}${extra}&limit=${size}&offset=${off}`, { headers: H });
    if (!res.ok) throw new Error(`${table} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

// Yahoo symbol normalisation — copied from outcomeTracker.ts
const INTL = new Set(['.AE','.AS','.AT','.AX','.BA','.BD','.BK','.BO','.BR','.CA','.CL','.CO','.DE','.F','.HE','.HK','.IR','.IS','.JK','.JO','.KA','.KL','.KQ','.KS','.KW','.L','.LM','.LS','.MC','.ME','.MI','.MX','.NS','.NZ','.OL','.PA','.PR','.QA','.RO','.SA','.SI','.SN','.SR','.SS','.ST','.SW','.SZ','.T','.TO','.TW','.VN','.WA']);
function yahooSym(s) {
  const u = s.toUpperCase().trim(); const i = u.lastIndexOf('.');
  if (i === -1) return u;
  return INTL.has(u.slice(i)) ? u : u.replace(/\./g, '-');
}
async function lastBar(symbol) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym(symbol))}?interval=1d&range=2y`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { ok: false, note: `HTTP ${r.status}` };
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res?.timestamp?.length) return { ok: false, note: 'no bars returned' };
    const ts = res.timestamp, closes = res.indicators?.quote?.[0]?.close ?? [];
    let last = null;
    for (let i = ts.length - 1; i >= 0; i--) { if (closes[i] != null) { last = new Date(ts[i] * 1000).toISOString().slice(0, 10); break; } }
    return { ok: true, last, n: ts.length };
  } catch (e) { return { ok: false, note: String(e.message || e).slice(0, 60) }; }
}

(async () => {
  console.log('Loading inference_results + outcome_results from Supabase...');
  const inf = await page('inference_results', 'symbol,run_date,current_price,unreliable_reason,' + HORIZONS.map(h => h.pred).join(','));
  const out = await page('outcome_results', 'symbol,run_date,horizon');
  console.log(`  inference_results: ${inf.length} rows`);
  console.log(`  outcome_results:   ${out.length} rows\n`);

  const have = new Set(out.map(r => `${r.symbol}|${r.run_date}|${r.horizon}`));

  let expected = 0, missing = 0, unmatured = 0, exclUnreliable = 0, exclNoPrice = 0, exclNoPred = 0;
  const missBySym = new Map();
  const haveBySym = new Map();
  const missDetail = [];

  for (const r of inf) {
    if (r.unreliable_reason) { exclUnreliable++; continue; }
    if (r.current_price == null) { exclNoPrice++; continue; }
    for (const h of HORIZONS) {
      if (r[h.pred] == null) { exclNoPred++; continue; }
      const target = addDays(r.run_date, h.days);
      if (target > today) { unmatured++; continue; }
      expected++;
      const key = `${r.symbol}|${r.run_date}|${h.label}`;
      if (have.has(key)) { haveBySym.set(r.symbol, (haveBySym.get(r.symbol) || 0) + 1); }
      else {
        missing++;
        missBySym.set(r.symbol, (missBySym.get(r.symbol) || 0) + 1);
        missDetail.push({ symbol: r.symbol, run_date: r.run_date, horizon: h.label, target });
      }
    }
  }

  console.log('='.repeat(72));
  console.log(' EXPECTED vs PRESENT (durable outcome_results)');
  console.log('='.repeat(72));
  console.log(`  expected matured rows : ${expected}`);
  console.log(`  present               : ${expected - missing}`);
  console.log(`  MISSING (silent)      : ${missing}   (${(missing / expected * 100).toFixed(1)}% of expected)`);
  console.log(`  [excluded by design]  unreliable_reason inference rows: ${exclUnreliable}, null current_price: ${exclNoPrice}, null prediction: ${exclNoPred}`);
  console.log(`  [not yet matured]     ${unmatured}`);

  // Symbols where EVERY matured row is missing => strong delisting candidates
  const fullyMissing = [...missBySym.entries()].filter(([s]) => !haveBySym.has(s)).sort((a, b) => b[1] - a[1]);
  const partiallyMissing = [...missBySym.entries()].filter(([s]) => haveBySym.has(s)).sort((a, b) => b[1] - a[1]);

  console.log(`\n  symbols with ANY missing rows : ${missBySym.size}`);
  console.log(`    fully missing (0 rows ever)  : ${fullyMissing.length}  <- delisting/never-resolvable candidates`);
  console.log(`    partially missing            : ${partiallyMissing.length}  <- transient/window-edge candidates`);

  console.log('\n  Top 25 FULLY-missing symbols (missing rows):');
  for (const [s, n] of fullyMissing.slice(0, 25)) console.log(`     ${s.padEnd(14)} ${n}`);
  console.log('\n  Top 15 PARTIALLY-missing symbols (missing / present):');
  for (const [s, n] of partiallyMissing.slice(0, 15)) console.log(`     ${s.padEnd(14)} ${n} missing / ${haveBySym.get(s)} present`);

  // Missing by horizon — a delisting hits ALL horizons; a window-edge issue skews short
  const byH = {};
  for (const m of missDetail) byH[m.horizon] = (byH[m.horizon] || 0) + 1;
  console.log('\n  Missing by horizon:', HORIZONS.map(h => `${h.label}=${byH[h.label] || 0}`).join('  '));

  // Yahoo probe of the top fully-missing symbols: is the series dead?
  const probe = fullyMissing.slice(0, 15).map(([s]) => s);
  if (probe.length) {
    console.log('\n' + '='.repeat(72));
    console.log(' YAHOO PROBE — top fully-missing symbols (is the series dead?)');
    console.log('='.repeat(72));
    for (const s of probe) {
      const earliestTarget = missDetail.filter(m => m.symbol === s).map(m => m.target).sort()[0];
      const r = await lastBar(s);
      const verdict = !r.ok ? `NO DATA (${r.note})`
        : r.last < earliestTarget ? `DEAD — last bar ${r.last} < earliest target ${earliestTarget}`
        : `alive to ${r.last} (target ${earliestTarget}) — NOT a delisting`;
      console.log(`   ${s.padEnd(14)} ${verdict}`);
      await new Promise(r => setTimeout(r, 120));
    }
  }
  console.log('\nRecon complete. No writes performed.');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
