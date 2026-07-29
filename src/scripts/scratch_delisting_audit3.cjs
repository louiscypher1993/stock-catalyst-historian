/**
 * scratch_delisting_audit3.cjs — RECON ONLY, NO WRITES. Root-cause of the drops.
 *
 * Audit #2 showed the 295 genuine drops cluster on target dates 2026-07-21/22/23
 * and hit mega-caps (TSLA, SHEL, BRK.B) — so NOT delisting. Two candidate causes:
 *   (a) still-unresolvable: Yahoo genuinely has no bar in the +/-3d window, and the
 *       tracker retries + fails every run (rows never inserted anywhere).
 *   (b) MIRROR GAP: the row WAS inserted into the CI-local outcome_tracker.db, but
 *       the Supabase upsert failed; on every later run existsStmt sees the local row,
 *       counts it "already checked", and never re-mirrors => permanently absent from
 *       the durable store, with no repair path.
 *
 * Decisive test: replay the tracker's EXACT resolution logic (Yahoo range=1y,
 * nearestFromMap +/-3 calendar days) against a sample of dropped rows today.
 *   resolves now => data was always available => (b) mirror gap.
 *   unresolvable  => (a) genuine data hole.
 */
require('dotenv/config');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const TOLERANCE_DAYS = 3;

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

const INTL = new Set(['.AE','.AS','.AT','.AX','.BA','.BD','.BK','.BO','.BR','.CA','.CL','.CO','.DE','.F','.HE','.HK','.IR','.IS','.JK','.JO','.KA','.KL','.KQ','.KS','.KW','.L','.LM','.LS','.MC','.ME','.MI','.MX','.NS','.NZ','.OL','.PA','.PR','.QA','.RO','.SA','.SI','.SN','.SR','.SS','.ST','.SW','.SZ','.T','.TO','.TW','.VN','.WA']);
function yahooSym(s) { const u = s.toUpperCase().trim(); const i = u.lastIndexOf('.'); if (i === -1) return u; return INTL.has(u.slice(i)) ? u : u.replace(/\./g, '-'); }

async function fetchMap(symbol) {
  const map = new Map();
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym(symbol))}?interval=1d&range=1y`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { map, err: `HTTP ${r.status}` };
    const j = await r.json(); const res = j?.chart?.result?.[0];
    if (!res) return { map, err: 'no result' };
    const ts = res.timestamp ?? [], cl = res.indicators?.quote?.[0]?.close ?? [];
    for (let i = 0; i < ts.length; i++) { if (cl[i] != null) map.set(new Date(ts[i] * 1000).toISOString().slice(0, 10), cl[i]); }
    return { map, err: null };
  } catch (e) { return { map, err: String(e.message || e).slice(0, 50) }; }
}
// tracker-identical nearest match
function nearest(map, target) {
  const base = new Date(target);
  for (let dist = 0; dist <= TOLERANCE_DAYS; dist++) {
    for (const sign of dist === 0 ? [0] : [-1, 1]) {
      const d = new Date(base); d.setUTCDate(d.getUTCDate() + dist * sign);
      const k = d.toISOString().slice(0, 10);
      if (map.has(k)) return { price: map.get(k), date: k };
    }
  }
  return null;
}

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
  const out = await page('outcome_results', 'symbol,run_date,horizon');
  const have = new Set(out.map(r => `${r.symbol}|${r.run_date}|${r.horizon}`));

  const stale = [];
  for (const r of inf) {
    if (r.unreliable_reason || r.current_price == null) continue;
    for (const h of HORIZONS) {
      if (r[h.pred] == null) continue;
      const target = addDays(r.run_date, h.days);
      if (target > today) continue;
      if (have.has(`${r.symbol}|${r.run_date}|${h.label}`)) continue;
      const age = daysBetween(target, today);
      if (age >= 3) stale.push({ symbol: r.symbol, run_date: r.run_date, horizon: h.label, target, age, entry: r.current_price });
    }
  }

  // Sample across the affected target dates, mixing US / UK / Asia
  const sample = [];
  const seen = new Set();
  for (const s of stale) {
    const k = s.symbol;
    if (seen.has(k)) continue;
    seen.add(k); sample.push(s);
    if (sample.length >= 25) break;
  }

  console.log('='.repeat(76));
  console.log(' REPLAY: can the tracker resolve these dropped rows TODAY?');
  console.log(` (tracker-identical: Yahoo range=1y, nearest bar within +/-${TOLERANCE_DAYS} calendar days)`);
  console.log('='.repeat(76));
  let resolvable = 0, unresolvable = 0;
  for (const s of sample) {
    const { map, err } = await fetchMap(s.symbol);
    if (err || map.size === 0) { console.log(`   ${s.symbol.padEnd(13)} ${s.horizon} target ${s.target}  -> FETCH FAIL (${err || 'empty'})`); unresolvable++; continue; }
    const m = nearest(map, s.target);
    if (m) {
      const ret = ((m.price - s.entry) / s.entry * 100).toFixed(2);
      console.log(`   ${s.symbol.padEnd(13)} ${s.horizon} target ${s.target}  -> RESOLVES: bar ${m.date} @ ${m.price.toFixed(2)}  (would be ${ret >= 0 ? '+' : ''}${ret}%)`);
      resolvable++;
    } else {
      const near = [...map.keys()].filter(d => Math.abs(daysBetween(d, s.target)) <= 10).sort();
      console.log(`   ${s.symbol.padEnd(13)} ${s.horizon} target ${s.target}  -> NO BAR in window. nearby bars: ${near.join(',') || 'none within 10d'}`);
      unresolvable++;
    }
    await new Promise(r => setTimeout(r, 120));
  }

  console.log('\n' + '='.repeat(76));
  console.log(` RESULT: ${resolvable}/${sample.length} dropped rows resolve fine TODAY, ${unresolvable}/${sample.length} do not.`);
  if (resolvable > unresolvable) {
    console.log(' => Data was available all along. The tracker is NOT retrying these.');
    console.log('    Consistent with (b) MIRROR GAP: row exists in CI-local sqlite, absent from');
    console.log('    Supabase; existsStmt short-circuits it as "already checked" on every run,');
    console.log('    so the durable store can never self-heal.');
  } else {
    console.log(' => Rows are genuinely unresolvable from Yahoo (a real data hole).');
  }
  console.log('='.repeat(76));
  console.log('\nRecon complete. No writes performed.');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
