/**
 * scratch_delisting_audit4.cjs — RECON ONLY, NO WRITES. Bias impact of the gap.
 *
 * Audits #1-3 established: ~295 matured rows are absent from the durable store,
 * not because of delisting (they resolve fine today) but because the tracker's
 * Supabase mirror is fail-soft AND non-retrying (existsStmt consults only local
 * sqlite), so a failed upsert batch is permanently lost from outcome_results.
 *
 * The question that decides whether this matters for the 08-05 checkpoint:
 * are the missing rows RANDOM, or do they skew the realized-return distribution
 * the scoreboard/harness read? Reconstruct every dropped row's would-be return
 * and compare against what IS recorded, per horizon.
 */
require('dotenv/config');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const TOL = 3;

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
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const std = a => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
function spearman(a, b) {
  const rk = v => { const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = new Array(v.length); let i = 0;
    while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const av = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = av; i = j + 1; } return r; };
  const x = rk(a), y = rk(b), n = a.length; if (n < 2) return NaN;
  const mx = mean(x), my = mean(y); let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const p = x[i] - mx, q = y[i] - my; num += p * q; dx += p * p; dy += q * q; }
  return Math.sqrt(dx * dy) === 0 ? NaN : num / Math.sqrt(dx * dy);
}

const INTL = new Set(['.AE','.AS','.AT','.AX','.BA','.BD','.BK','.BO','.BR','.CA','.CL','.CO','.DE','.F','.HE','.HK','.IR','.IS','.JK','.JO','.KA','.KL','.KQ','.KS','.KW','.L','.LM','.LS','.MC','.ME','.MI','.MX','.NS','.NZ','.OL','.PA','.PR','.QA','.RO','.SA','.SI','.SN','.SR','.SS','.ST','.SW','.SZ','.T','.TO','.TW','.VN','.WA']);
const ysym = s => { const u = s.toUpperCase().trim(); const i = u.lastIndexOf('.'); return i === -1 ? u : (INTL.has(u.slice(i)) ? u : u.replace(/\./g, '-')); };
async function fetchMap(symbol) {
  const map = new Map();
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym(symbol))}?interval=1d&range=1y`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return map;
    const j = await r.json(); const res = j?.chart?.result?.[0]; if (!res) return map;
    const ts = res.timestamp ?? [], cl = res.indicators?.quote?.[0]?.close ?? [];
    for (let i = 0; i < ts.length; i++) if (cl[i] != null) map.set(new Date(ts[i] * 1000).toISOString().slice(0, 10), cl[i]);
  } catch {}
  return map;
}
function nearest(map, target) {
  const base = new Date(target);
  for (let d = 0; d <= TOL; d++) for (const s of d === 0 ? [0] : [-1, 1]) {
    const x = new Date(base); x.setUTCDate(x.getUTCDate() + d * s);
    const k = x.toISOString().slice(0, 10); if (map.has(k)) return map.get(k);
  }
  return null;
}
async function page(table, select) {
  const out = []; const size = 1000;
  for (let off = 0; ; off += size) {
    const res = await fetch(`${URL}/rest/v1/${table}?select=${select}&limit=${size}&offset=${off}`, { headers: H });
    if (!res.ok) throw new Error(`${table} HTTP ${res.status}`);
    const rows = await res.json(); out.push(...rows); if (rows.length < size) break;
  }
  return out;
}

(async () => {
  const inf = await page('inference_results', 'symbol,run_date,current_price,unreliable_reason,' + HORIZONS.map(h => h.pred).join(','));
  const out = await page('outcome_results', 'symbol,run_date,horizon,predicted_return,actual_return,target_date');
  const have = new Set(out.map(r => `${r.symbol}|${r.run_date}|${r.horizon}`));

  const stale = [];
  for (const r of inf) {
    if (r.unreliable_reason || r.current_price == null) continue;
    for (const h of HORIZONS) {
      const pred = r[h.pred]; if (pred == null) continue;
      const target = addDays(r.run_date, h.days);
      if (target > today) continue;
      if (have.has(`${r.symbol}|${r.run_date}|${h.label}`)) continue;
      if (daysBetween(target, today) < 3) continue;
      stale.push({ symbol: r.symbol, run_date: r.run_date, horizon: h.label, target, entry: r.current_price, pred });
    }
  }

  // present-vs-missing per target_date (batch-boundary signature)
  const presentByTarget = {}, missingByTarget = {};
  for (const r of out) if (r.target_date) presentByTarget[r.target_date] = (presentByTarget[r.target_date] || 0) + 1;
  for (const s of stale) missingByTarget[s.target] = (missingByTarget[s.target] || 0) + 1;
  console.log('='.repeat(74));
  console.log(' PRESENT vs MISSING by target_date (affected dates only)');
  console.log('='.repeat(74));
  for (const d of Object.keys(missingByTarget).sort()) {
    const p = presentByTarget[d] || 0, m = missingByTarget[d];
    console.log(`   ${d}   present ${String(p).padStart(4)}   missing ${String(m).padStart(4)}   (${(m / (p + m) * 100).toFixed(0)}% of that day lost)`);
  }

  // Reconstruct would-be returns for ALL dropped rows
  const bySym = new Map();
  for (const s of stale) { if (!bySym.has(s.symbol)) bySym.set(s.symbol, []); bySym.get(s.symbol).push(s); }
  console.log(`\nReconstructing ${stale.length} dropped rows across ${bySym.size} symbols...`);
  const recovered = [];
  let done = 0;
  for (const [sym, rows] of bySym) {
    const map = await fetchMap(sym);
    for (const r of rows) {
      const px = map.size ? nearest(map, r.target) : null;
      if (px != null) recovered.push({ ...r, actual: (px - r.entry) / r.entry });
    }
    if (++done % 50 === 0) console.log(`   ${done}/${bySym.size} symbols`);
    await new Promise(r => setTimeout(r, 90));
  }
  console.log(`   recovered ${recovered.length}/${stale.length} (${stale.length - recovered.length} genuinely unresolvable)\n`);

  console.log('='.repeat(74));
  console.log(' BIAS CHECK — recorded rows vs the rows that went missing');
  console.log('='.repeat(74));
  for (const h of HORIZONS.map(x => x.label)) {
    const rec = out.filter(r => r.horizon === h && r.actual_return != null);
    const mis = recovered.filter(r => r.horizon === h);
    if (!mis.length) continue;
    const recAct = rec.map(r => r.actual_return), misAct = mis.map(r => r.actual);
    const icRec = spearman(rec.map(r => r.predicted_return), recAct);
    const icMis = spearman(mis.map(r => r.pred), misAct);
    const comboP = [...rec.map(r => r.predicted_return), ...mis.map(r => r.pred)];
    const comboA = [...recAct, ...misAct];
    console.log(`\n  ${h}:`);
    console.log(`    recorded  n=${String(rec.length).padStart(4)}  mean actual ${(mean(recAct) * 100).toFixed(3)}%  sd ${(std(recAct) * 100).toFixed(2)}%  IC ${icRec.toFixed(4)}`);
    console.log(`    MISSING   n=${String(mis.length).padStart(4)}  mean actual ${(mean(misAct) * 100).toFixed(3)}%  sd ${(std(misAct) * 100).toFixed(2)}%  IC ${icMis.toFixed(4)}`);
    console.log(`    combined  n=${String(comboA.length).padStart(4)}  mean actual ${(mean(comboA) * 100).toFixed(3)}%  IC ${spearman(comboP, comboA).toFixed(4)}   <= what the true IC would be`);
    console.log(`    => IC shift if repaired: ${(spearman(comboP, comboA) - icRec >= 0 ? '+' : '')}${(spearman(comboP, comboA) - icRec).toFixed(4)}`);
  }
  console.log('\nRecon complete. No writes performed.');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
