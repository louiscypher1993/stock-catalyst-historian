/**
 * benchmarkAdjudication.ts — decide LIVE_BENCHMARK_MODE: 'spy' (current) or 'native'.
 *
 * THE QUESTION. Live hedges every symbol against SPY; training used 11 native
 * per-market indices (39.1% of training rows, 445 symbols). excess_return is both a
 * model input AND the basis of the z-score that decides what counts as an anomaly, so
 * the two modes DETECT DIFFERENT BARS — measured at only 67% overlap
 * (scratch_v12_live_shadow.py). A backtest cannot settle which set is better because
 * both are self-consistent; only realised forward outcomes on the two DISJOINT sets can.
 * `LIVE_BENCHMARK_MODE=shadow` has been accumulating exactly that since 2026-08-03:
 * decisions still ride on SPY, the native verdict is computed alongside, and every
 * disagreement lands in shadow_benchmark_divergence.
 *
 * WHAT IS BEING MEASURED, AND WHAT IS NOT. A detection is not a trade — it is a claim
 * that a bar is anomalous enough to run the model on. The native-only bars never entered
 * the pipeline, so no prediction, recommendation or P&L exists for them and none can be
 * reconstructed. What CAN be measured is whether a flagged bar was actually followed by
 * unusual movement, which is precisely what an anomaly detector is for. So this script
 * scores DETECTION QUALITY, not profit. Read a win here as "this benchmark finds the
 * real events", not "this benchmark makes more money" — the second claim needs the model
 * to have run, and it did not.
 *
 * THE CONFOUND, AND THE FIX. The two groups do not hold the same symbols: native-only
 * detections skew hard toward .HK/.PA/.L names, SPY-only toward US ones. Comparing raw
 * |forward return| between them would therefore mostly measure which markets happened to
 * be volatile this fortnight, not which detector is sharper. Every detection is instead
 * scored against ITS OWN symbol's typical bar:
 *
 *     eventfulness = |forward return of the flagged bar| / mean |forward return| of
 *                    every bar of that symbol over the trailing year
 *
 * 1.0 means the detector flagged a bar no more eventful than that symbol's average —
 * i.e. no information. Above 1.0 means it found genuine movement. The ratio is unitless
 * and cross-market comparable, so the two groups can be compared directly.
 *
 * THE SECOND CONFOUND, WHICH NEARLY INVERTED THIS. Scoring on RAW forward return is
 * biased toward SPY by construction. Consider a Hong Kong name: if the HSI moves hard
 * and the stock moves with it, native excess is ~0 (not flagged) while SPY excess is
 * large (flagged). SPY-only detections are therefore enriched in bars where the LOCAL
 * MARKET moved — and market-wide moves are followed by more raw volatility than
 * idiosyncratic ones, because volatility clusters at the market level. A raw-return
 * metric would hand SPY a win that is really just beta.
 *
 * So the headline metric hedges: the numerator is the symbol's forward return MINUS its
 * native index's forward return over the same window, and the baseline is rebuilt the
 * same hedged way. This measures idiosyncratic movement — which is both what an "event"
 * means and what the model actually targets (excess_return, not raw return).
 *
 * Note the direction of that choice: hedging against the NATIVE index is the metric most
 * favourable to the native benchmark, since it strips out exactly the market-wide moves
 * SPY-only detections are enriched in. It is deliberately the alternative hypothesis's
 * best case. Raw is still reported alongside so the two can be compared.
 *
 * READ-ONLY. Reads shadow_benchmark_divergence and Yahoo; writes nothing, so it is safe
 * to re-run at any time and does not touch daily_prices_cache (deliberately — a readout
 * that mutates shared cache state is a readout you cannot trust to be repeatable).
 *
 * Horizons follow outcomeTracker's convention (2D=+2, 2W=+14 calendar days, ±3-day
 * nearest-bar tolerance) so numbers here are comparable with the outcome scoreboard.
 */
import 'dotenv/config';

const TOLERANCE_DAYS = 3;
const HORIZONS: Array<{ label: string; days: number }> = [
  { label: '2D', days: 2 },
  { label: '2W', days: 14 },
];
/** Below this many matured rows in a group, a horizon is reported but not adjudicated. */
const MIN_PER_GROUP = 30;
const YAHOO_DELAY_MS = 250;

// ── Yahoo (same normalisation + nearest-match convention as outcomeTracker.ts) ──
const YAHOO_INTL_SUFFIXES = new Set([
  '.AS', '.AT', '.AX', '.BA', '.BD', '.BK', '.BO', '.BR', '.CN', '.CO', '.DE', '.DU',
  '.F', '.HE', '.HK', '.IC', '.IL', '.IR', '.IS', '.JK', '.JO', '.KA', '.KL', '.KQ',
  '.KS', '.KW', '.L', '.LM', '.LS', '.MC', '.ME', '.MI', '.MX', '.NS', '.NZ', '.OL',
  '.PA', '.PR', '.QA', '.RO', '.SA', '.SI', '.SN', '.SR', '.SS', '.ST', '.SW', '.SZ',
  '.T', '.TO', '.TW', '.VN', '.WA',
]);

function normaliseForYahoo(symbol: string): string {
  const upper = symbol.toUpperCase().trim();
  const dotIdx = upper.lastIndexOf('.');
  if (dotIdx === -1) return upper;
  const suffix = upper.slice(dotIdx);
  if (YAHOO_INTL_SUFFIXES.has(suffix)) return upper;
  return upper.replace(/\./g, '-');
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchYahooHistory(symbol: string): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normaliseForYahoo(symbol))}?interval=1d&range=1y`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return priceMap;
    const data: any = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return priceMap;
    const ts: number[] = result.timestamp ?? [];
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (c === null || c === undefined) continue;
      priceMap.set(new Date(ts[i] * 1000).toISOString().slice(0, 10), c);
    }
  } catch { /* empty map = unresolvable, handled by caller */ }
  return priceMap;
}

/**
 * Nearest bar to `target`, searching closest-first within ±TOLERANCE_DAYS.
 *
 * `after` is a HARD floor and exists because the horizon here (2D) is shorter than the
 * tolerance (3D): searching ±3 around bar+2 reaches bar+0 and bar−1, so without it a
 * sparse symbol could resolve its "forward" return to the flagged bar itself (return
 * exactly 0) or to a bar BEFORE it (a backward return scored as forward). That is not
 * hypothetical — the native-only group is concentrated in .HK/.NS/.AX, precisely the
 * calendars with the most holiday gaps, so the bias would fall hardest on one arm of
 * the comparison and understate it.
 */
function nearestFromMap(m: Map<string, number>, target: string, after?: string): number | null {
  const base = new Date(target);
  for (let dist = 0; dist <= TOLERANCE_DAYS; dist++) {
    for (const sign of dist === 0 ? [0] : [-1, 1]) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + dist * sign);
      const key = d.toISOString().slice(0, 10);
      if (after && key <= after) continue;
      const v = m.get(key);
      if (v !== undefined) return v;
    }
  }
  return null;
}

function addCalendarDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── statistics ────────────────────────────────────────────────────────────────
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

function stdev(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

/** Welch's t — the two groups have different sizes and variances, so not Student's. */
function welchT(a: number[], b: number[]): number {
  if (a.length < 2 || b.length < 2) return NaN;
  const va = stdev(a) ** 2 / a.length;
  const vb = stdev(b) ** 2 / b.length;
  if (va + vb === 0) return NaN;
  return (mean(a) - mean(b)) / Math.sqrt(va + vb);
}

/**
 * Baseline: mean |H-day forward return| across every bar of the trailing year. This is
 * the denominator that makes cross-market comparison legitimate — it is the symbol's own
 * "typical bar", so a ratio against it carries no market-volatility signal.
 */
function baselineAbsReturn(
  m: Map<string, number>,
  horizonDays: number,
  bench?: Map<string, number>,
): number | null {
  const dates = [...m.keys()].sort();
  const rs: number[] = [];
  for (const d of dates) {
    const p0 = m.get(d)!;
    // Same strictly-forward floor as the detection lookup -- the denominator has to be
    // built the identical way as the numerator or the ratio is not a ratio of like things.
    const p1 = nearestFromMap(m, addCalendarDays(d, horizonDays), d);
    if (p1 == null || !p0) continue;
    const r = fwdReturn(m, bench, d, horizonDays);
    if (r == null) continue;
    rs.push(Math.abs(r));
  }
  return rs.length >= 30 ? mean(rs) : null;
}

/**
 * Forward return from `bar` over `days`, hedged against `bench` when supplied.
 * Unhedged when bench is absent or lacks bars in the window -- a missing index must
 * degrade to raw rather than silently substituting 0 for the benchmark leg, which is
 * the exact defect (`?? 0`) that made the live SPY hedge wrong in the first place.
 */
function fwdReturn(
  m: Map<string, number>,
  bench: Map<string, number> | undefined,
  bar: string,
  days: number,
): number | null {
  const p0 = m.get(bar) ?? nearestFromMap(m, bar);
  const p1 = nearestFromMap(m, addCalendarDays(bar, days), bar);
  if (p0 == null || p1 == null || !p0) return null;
  const raw = (p1 - p0) / p0;
  if (!bench || bench.size === 0) return raw;
  const b0 = bench.get(bar) ?? nearestFromMap(bench, bar);
  const b1 = nearestFromMap(bench, addCalendarDays(bar, days), bar);
  if (b0 == null || b1 == null || !b0) return raw;
  return raw - (b1 - b0) / b0;
}

async function page<T>(q: (f: number, t: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await q(f, f + 999);
    if (error) throw error;
    const b = (data ?? []) as T[];
    out.push(...b);
    if (b.length < 1000) break;
  }
  return out;
}

interface Row {
  run_date: string; run_slot: string; symbol: string; benchmark: string;
  bar_date: string | null; z_spy: number | null; z_native: number | null;
  detected_spy: boolean; detected_native: boolean; close: number | null;
}

async function main() {
  const { supabase } = await import('../db/supabaseClient');

  const rows = await page<Row>((f, t) => supabase
    .from('shadow_benchmark_divergence')
    .select('run_date, run_slot, symbol, benchmark, bar_date, z_spy, z_native, detected_spy, detected_native, close')
    .order('run_date', { ascending: true })
    .range(f, t));

  if (rows.length === 0) {
    console.log('shadow_benchmark_divergence is empty — is LIVE_BENCHMARK_MODE=shadow set on live-inference.yml?');
    process.exit(0);
  }

  const dates = rows.map(r => r.run_date).sort();
  console.log(`shadow rows: ${rows.length}   ${dates[0]} → ${dates[dates.length - 1]}`);

  // The table is meant to hold disagreements ONLY. Agreeing rows would mean the writer
  // is logging more than it claims, which would silently dilute both groups.
  const agreeing = rows.filter(r => r.detected_spy === r.detected_native);
  if (agreeing.length) {
    console.log(`\n!! ${agreeing.length} row(s) have detected_spy == detected_native — the table should ` +
                `contain disagreements only. Excluded here; the writer needs checking.`);
  }

  const spyOnly    = rows.filter(r => r.detected_spy && !r.detected_native);
  const nativeOnly = rows.filter(r => !r.detected_spy && r.detected_native);
  console.log(`  SPY-only detections    : ${spyOnly.length}`);
  console.log(`  native-only detections : ${nativeOnly.length}`);

  const byMarket = new Map<string, { spy: number; nat: number }>();
  for (const r of rows) {
    const k = r.benchmark || '(none)';
    if (!byMarket.has(k)) byMarket.set(k, { spy: 0, nat: 0 });
    const e = byMarket.get(k)!;
    if (r.detected_spy && !r.detected_native) e.spy++;
    if (!r.detected_spy && r.detected_native) e.nat++;
  }
  console.log('\nComposition (why raw returns cannot be compared directly):');
  console.log(`  ${'benchmark'.padEnd(12)}${'SPY-only'.padStart(10)}${'native-only'.padStart(13)}`);
  for (const [k, v] of [...byMarket.entries()].sort((a, b) => (b[1].spy + b[1].nat) - (a[1].spy + a[1].nat)))
    console.log(`  ${k.padEnd(12)}${String(v.spy).padStart(10)}${String(v.nat).padStart(13)}`);

  const usable = [...spyOnly, ...nativeOnly].filter(r => r.bar_date && r.close);
  const symbols = [...new Set(usable.map(r => r.symbol))];
  console.log(`\nFetching ${symbols.length} symbol histories from Yahoo (~${Math.ceil(symbols.length * YAHOO_DELAY_MS / 1000)}s)...`);

  const hist = new Map<string, Map<string, number>>();
  let failed = 0;
  for (const s of symbols) {
    const m = await fetchYahooHistory(s);
    if (m.size === 0) failed++;
    hist.set(s, m);
    await sleep(YAHOO_DELAY_MS);
  }
  if (failed) console.log(`  ${failed}/${symbols.length} symbol(s) returned no history — their rows drop out below.`);

  // Native index histories, for the hedged metric. Small set (~11), cheap.
  const benchTickers = [...new Set(usable.map(r => r.benchmark).filter(Boolean))];
  console.log(`Fetching ${benchTickers.length} native index histories...`);
  const benchHist = new Map<string, Map<string, number>>();
  for (const b of benchTickers) {
    const m = await fetchYahooHistory(b);
    if (m.size === 0) console.log(`  !! ${b} returned no history — its rows fall back to RAW (unhedged).`);
    benchHist.set(b, m);
    await sleep(YAHOO_DELAY_MS);
  }

  const today = new Date().toISOString().slice(0, 10);

  for (const H of HORIZONS) {
    console.log(`\n${'='.repeat(74)}\n=== ${H.label} (+${H.days} calendar days) ===`);

    const score = (group: Row[], hedged: boolean) => {
      const ratios: number[] = [];
      const signed: number[] = [];
      let immature = 0, unresolved = 0, noBaseline = 0, floored = 0;

      for (const r of group) {
        const bar = r.bar_date!;
        const target = addCalendarDays(bar, H.days);
        // A row is only usable once its target date is genuinely in the past --
        // otherwise the ±3-day tolerance would silently match a bar BEFORE the horizon
        // and report an immature outcome as a matured one.
        if (target > today) { immature++; continue; }

        const m = hist.get(r.symbol);
        if (!m || m.size === 0) { unresolved++; continue; }
        const p1 = nearestFromMap(m, target, bar);
        if (p1 == null) { unresolved++; continue; }
        // How often the strictly-forward floor actually bites, per group -- if this is
        // large and lopsided, the headline is a calendar artefact, not a finding.
        if (nearestFromMap(m, target) !== p1) floored++;

        const bench = hedged ? benchHist.get(r.benchmark) : undefined;
        const ret = fwdReturn(m, bench, bar, H.days);
        if (ret == null) { unresolved++; continue; }

        const base = baselineAbsReturn(m, H.days, bench);
        if (base == null || base === 0) { noBaseline++; continue; }

        ratios.push(Math.abs(ret) / base);
        signed.push(ret);
      }
      return { ratios, signed, immature, unresolved, noBaseline, floored };
    };

    const line = (name: string, g: ReturnType<typeof score>) => {
      if (g.ratios.length === 0) {
        console.log(`  ${name.padEnd(22)} no matured rows  (immature ${g.immature}, unresolved ${g.unresolved})`);
        return;
      }
      console.log(`  ${name.padEnd(22)} n=${String(g.ratios.length).padStart(4)}  ` +
        `eventfulness ${mean(g.ratios).toFixed(3)}  ` +
        `mean ret ${(100 * mean(g.signed)).toFixed(2)}%  ` +
        `mean |ret| ${(100 * mean(g.signed.map(Math.abs))).toFixed(2)}%   ` +
        `(immature ${g.immature}, unresolved ${g.unresolved + g.noBaseline}, fwd-floor bit ${g.floored})`);
    };

    let decidable = true;
    for (const [metric, hedged] of [['HEDGED (headline — vs native index)', true],
                                    ['RAW    (beta-contaminated, for contrast)', false]] as const) {
      const S = score(spyOnly, hedged);
      const N = score(nativeOnly, hedged);
      console.log(`\n  -- ${metric} --`);
      line('SPY-only', S);
      line('native-only', N);

      if (S.ratios.length < MIN_PER_GROUP || N.ratios.length < MIN_PER_GROUP) {
        console.log(`\n  NOT DECIDABLE — needs >=${MIN_PER_GROUP} matured rows per group ` +
          `(have SPY ${S.ratios.length}, native ${N.ratios.length}).`);
        const pending = S.immature + N.immature;
        if (pending) console.log(`  ${pending} row(s) already logged are still maturing at this horizon.`);
        decidable = false;
        break;
      }

      const t = welchT(N.ratios, S.ratios);
      const diff = mean(N.ratios) - mean(S.ratios);
      console.log(`     native − SPY: ${diff >= 0 ? '+' : ''}${diff.toFixed(3)}  (Welch t=${t.toFixed(2)})` +
        `${hedged ? '   <-- the one that counts' : ''}`);
    }
    if (!decidable) continue;

    const t = welchT(score(nativeOnly, true).ratios, score(spyOnly, true).ratios);
    console.log(`\n  1.000 would mean "flagged bars are no more eventful than that symbol's average bar".`);
    if (Math.abs(t) < 2) {
      console.log(`  VERDICT: no significant difference. Keep LIVE_BENCHMARK_MODE=spy — churning 33% of ` +
                  `live detections needs positive evidence, and |t|<2 is not it.`);
    } else if (t > 0) {
      console.log(`  VERDICT: native detections are significantly more eventful. Supports switching.`);
    } else {
      console.log(`  VERDICT: SPY detections are significantly more eventful even under the metric that ` +
                  `favours native. Stay on spy.`);
    }
  }

  console.log('\nNote: this scores DETECTION QUALITY (did the flagged bar precede real movement),');
  console.log('not P&L — the native-only bars never ran through the model, so no P&L exists for them.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
