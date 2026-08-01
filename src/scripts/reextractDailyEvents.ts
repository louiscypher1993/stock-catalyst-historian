/**
 * reextractDailyEvents.ts — rebuild anomaly events from TRUE DAILY bars.
 *
 * THE DEFECT THIS FIXES. `HistoricalEngine` passes `range` straight to Yahoo's chart
 * API (`range=max` for deep history). Yahoo silently ignores `interval=1d` on long
 * ranges and returns MONTHLY/QUARTERLY bars, so every event extracted for a pre-2021
 * date was detected and measured on the wrong time scale. Evidence:
 *   - 63.7% of pre-2000 event dates land on the 1st of a month, and 13-21% fall on a
 *     SATURDAY or SUNDAY — impossible for real trading days.
 *   - median gap between consecutive events for a symbol is 123-275d pre-2021 vs 19d
 *     for 2021+.
 *   - `forward_return_1m` (engine `calcRet(21)` = 21 BARS) reproduces exactly at N=21
 *     trading days for 2021+, but fingerprints to N~441 (21 months) for every
 *     pre-2021 era.
 *
 * WHY THESE ROWS CANNOT BE REPAIRED IN PLACE. The event DATES are themselves artifacts
 * of monthly sampling — a "2008-10-01 anomaly" is a whole-October move, and many dates
 * are not trading days at all. There is nothing to recompute at. The rows have to be
 * re-detected from daily bars, which yields a different (and larger) set of events.
 *
 * WHY THIS IS SAFE NOW. `daily_prices` holds 8.26M genuine daily bars back to 1962
 * (Yahoo backfill, commits 79ce0e4/b7e7570), so this needs ZERO API calls. It cannot
 * touch FMP premium data — that data sits overwhelmingly on 2021+ rows (pre-2021
 * premium fill is 0-8% for most fields), and this script writes only to its own new
 * table and reads everything else read-only.
 *
 * WHAT IS DELIBERATELY REPRODUCED vs FIXED. To keep the new pre-2021 rows on the same
 * scale as the existing (clean) 2021+ rows, every feature formula is ported verbatim
 * from HistoricalEngine, including the v9.4 11-suffix benchmark map. The ONLY
 * intentional changes are the two provably-broken labels:
 *   - forward_return_1m  -> 21 TRADING BARS (was 21 bars of whatever granularity)
 *   - MFE/MAE_1m         -> next 21 TRADING BARS
 * The async-close benchmark fix and the VIX/commodity fixes are deliberately NOT
 * applied here — they are separate, individually-attributable changes.
 *
 * VALIDATION FIRST. `--validate` re-derives 2021+ rows (known good, genuinely daily)
 * and compares against the stored values. If the port has drifted, that control fails
 * and nothing downstream should be trusted.
 *
 * Usage:
 *   npx tsx src/scripts/reextractDailyEvents.ts --validate            # control only
 *   npx tsx src/scripts/reextractDailyEvents.ts --validate --limit 300
 *   npx tsx src/scripts/reextractDailyEvents.ts --run --until 2021-01-01
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', '..', 'market_cache.db');

const Z_THRESHOLD = 2.5;      // HistoricalEngine constructor default
const ROLLING_WINDOW = 90;    // HistoricalEngine constructor default
const BETA_WINDOW = 60;       // betaStartIdx = max(1, i-59)

// v9.4 benchmark map — ported verbatim from HistoricalEngine.ts:1533-1543.
const NATIVE_BENCHMARK: Record<string, string> = {
  '.AX': '^AXJO', '.SW': '^SSMI', '.ST': '^OMX', '.SI': '^STI', '.L': '^FTSE',
  '.DE': '^GDAXI', '.PA': '^FCHI', '.TO': '^GSPTSE', '.NS': '^BSESN',
  '.BO': '^BSESN', '.HK': '^HSI',
};
// HistoricalEngine.ts:132
const SECTOR_COMMODITY_MAP: Record<string, string> = {
  'Airlines': 'DCOILWTICO', 'Transportation': 'DCOILWTICO',
  'Logistics & Transportation': 'DCOILWTICO', 'Energy': 'DCOILWTICO',
  'Utilities': 'DCOILWTICO', 'Semiconductors': 'PCOPPUSDM',
  'Technology': 'PCOPPUSDM', 'Industrials': 'PCOPPUSDM',
  'Basic Materials': 'PCOPPUSDM', 'Machinery': 'PCOPPUSDM',
};

interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number; }

function benchmarkFor(symbol: string): string {
  const u = symbol.toUpperCase();
  for (const suf of Object.keys(NATIVE_BENCHMARK)) if (u.endsWith(suf)) return NATIVE_BENCHMARK[suf];
  return '^GSPC';
}

/** OLS beta of stock on bench over the paired window.
 *  Mirrors HistoricalEngine.ts:1706-1723 exactly (>=10 pairs, var > 0.0001).
 *  `fallback` differs by leg and this matters: the benchmark leg initialises
 *  beta = 1, but the COMMODITY leg initialises commodityBeta = 0 and only ever
 *  assigns cov/varC — so an under-determined commodity beta must stay 0, not 1.
 *  Getting this wrong would activate a term that has been inert in every model
 *  to date (PCOPPUSDM is monthly, so it never reaches 10 pairs). */
function betaOf(sRet: number[], bRet: number[], fallback: number): number {
  if (bRet.length < 10) return fallback;
  const mb = bRet.reduce((a, c) => a + c, 0) / bRet.length;
  const ms = sRet.reduce((a, c) => a + c, 0) / sRet.length;
  let cov = 0, varB = 0;
  for (let j = 0; j < bRet.length; j++) {
    cov += (bRet[j] - mb) * (sRet[j] - ms);
    varB += (bRet[j] - mb) ** 2;
  }
  return varB > 0.0001 ? cov / varB : fallback;
}

/** Wilder RSI — ported from HistoricalEngine.ts:277 */
function rsiArray(bars: Bar[], period = 14): number[] {
  const rsi = new Array(bars.length).fill(0);
  if (bars.length <= period) return rsi;
  let sumGain = 0, sumLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = bars[i].close - bars[i - 1].close;
    if (ch > 0) sumGain += ch; else sumLoss += Math.abs(ch);
  }
  let avgGain = sumGain / period, avgLoss = sumLoss / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < bars.length; i++) {
    const ch = bars[i].close - bars[i - 1].close;
    const gain = ch > 0 ? ch : 0, loss = ch < 0 ? Math.abs(ch) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

/** price on/after `date + days` calendar days, searching up to 10 days forward.
 *  Mirrors calculate_forward_returns.ts findNearestPrice(maxDaysForward=10). */
function calendarForward(bars: Bar[], i: number, days: number): number | null {
  const t = new Date(bars[i].date + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + days);
  const want = t.toISOString().slice(0, 10);
  for (let j = i + 1; j < bars.length; j++) {
    if (bars[j].date >= want) {
      const gap = (new Date(bars[j].date + 'T00:00:00Z').getTime() - t.getTime()) / 86400000;
      return gap <= 10 ? bars[j].close : null;
    }
  }
  return null;
}

function main() {
  const argv = process.argv.slice(2);
  const validate = argv.includes('--validate');
  const run = argv.includes('--run');
  const limitArg = argv.indexOf('--limit');
  const LIMIT = limitArg >= 0 ? Number(argv[limitArg + 1]) : 0;
  const untilArg = argv.indexOf('--until');
  const UNTIL = untilArg >= 0 ? argv[untilArg + 1] : '2021-01-01';
  if (!validate && !run) { console.error('specify --validate and/or --run'); process.exit(1); }

  const db = new Database(DB_PATH, { readonly: !run });

  // ---- benchmark + commodity return maps (from the local benchmark_prices table)
  const benchStmt = db.prepare('SELECT date, close FROM benchmark_prices WHERE ticker=? ORDER BY date');
  const benchCache = new Map<string, Map<string, number>>();
  function benchReturns(ticker: string): Map<string, number> {
    let m = benchCache.get(ticker);
    if (!m) {
      const bars = benchStmt.all(ticker) as { date: string; close: number }[];
      m = new Map();
      for (let i = 1; i < bars.length; i++) {
        if (bars[i - 1].close) m.set(bars[i].date, ((bars[i].close - bars[i - 1].close) / bars[i - 1].close) * 100);
      }
      benchCache.set(ticker, m);
    }
    return m;
  }

  const sectorOf = new Map<string, string | null>();
  for (const r of db.prepare('SELECT UPPER(symbol) s, sector FROM company_profiles').all() as any[]) {
    sectorOf.set(r.s, r.sector ?? null);
  }

  const priceStmt = db.prepare(
    'SELECT date, open, high, low, close, volume FROM daily_prices WHERE symbol=? ORDER BY date'
  );

  /** Full per-symbol derivation. Returns one record per bar. */
  function derive(symbol: string) {
    const bars = priceStmt.all(symbol) as Bar[];
    if (bars.length < 30) return null;
    const bm = benchReturns(benchmarkFor(symbol));
    const sector = sectorOf.get(symbol.toUpperCase()) ?? null;
    const commodityId = sector ? SECTOR_COMMODITY_MAP[sector] : undefined;
    const cm = commodityId ? benchReturns(commodityId) : null;

    // pass 1 — dailyReturn / beta / excessReturn (HistoricalEngine.ts:1678-1810)
    const dailyReturn = new Array(bars.length).fill(0);
    const excessReturn = new Array(bars.length).fill(0);
    for (let i = 1; i < bars.length; i++) {
      if (!bars[i - 1].close) continue;
      dailyReturn[i] = ((bars[i].close - bars[i - 1].close) / bars[i - 1].close) * 100;
      const start = Math.max(1, i - (BETA_WINDOW - 1));
      const sR: number[] = [], bR: number[] = [];
      for (let k = start; k <= i; k++) {
        const b = bm.get(bars[k].date);
        if (b === undefined || !bars[k - 1].close) continue;
        sR.push(((bars[k].close - bars[k - 1].close) / bars[k - 1].close) * 100);
        bR.push(b);
      }
      const beta = betaOf(sR, bR, 1);
      const bToday = bm.get(bars[i].date) || 0;

      let commodityBeta = 0, cToday = 0;
      if (cm) {
        const cS: number[] = [], cB: number[] = [];
        for (let k = start; k <= i; k++) {
          const c = cm.get(bars[k].date);
          if (c === undefined || !bars[k - 1].close) continue;
          cS.push(((bars[k].close - bars[k - 1].close) / bars[k - 1].close) * 100);
          cB.push(c);
        }
        commodityBeta = betaOf(cS, cB, 0);
        cToday = cm.get(bars[i].date) || 0;
      }
      excessReturn[i] = dailyReturn[i] - beta * bToday - commodityBeta * cToday;
    }

    const rsi = rsiArray(bars, 14);

    // pass 2 — z-score and volume ratios for EVERY bar. These must exist before the
    // anomaly decision because HistoricalEngine's threshold is ADAPTIVE (see below)
    // and its null-sample candidacy test depends on volumeRatio.
    const zArr = new Array(bars.length).fill(0);
    const enoughWindow = new Array(bars.length).fill(false);
    const volRatio = new Array(bars.length).fill(1);
    const relVol90 = new Array(bars.length).fill(1);
    const relVol30 = new Array(bars.length).fill(1);
    for (let i = 1; i < bars.length; i++) {
      const wStart = Math.max(1, i - (ROLLING_WINDOW - 1));
      const win: number[] = [];
      for (let k = wStart; k <= i; k++) win.push(excessReturn[k]);
      if (win.length >= 10) {
        enoughWindow[i] = true;
        const mean = win.reduce((a, c) => a + c, 0) / win.length;
        const ss = win.reduce((a, c) => a + (c - mean) ** 2, 0);
        const sd = Math.sqrt(ss / (win.length > 1 ? win.length - 1 : 1));
        if (sd > 0.0001) zArr[i] = (excessReturn[i] - mean) / sd;
      }
      const v20s = Math.max(0, i - 19);
      let v20 = 0; for (let k = v20s; k <= i; k++) v20 += bars[k].volume;
      const vol20Avg = v20 / (i - v20s + 1);
      const v90s = Math.max(0, i - (ROLLING_WINDOW - 1));
      let v90 = 0; for (let k = v90s; k <= i; k++) v90 += bars[k].volume;
      const vol90Avg = v90 / (i - v90s + 1);
      const v30s = Math.max(0, i - 29);
      let v30 = 0; for (let k = v30s; k <= i; k++) v30 += bars[k].volume;
      const vol30Avg = v30 / (i - v30s + 1);
      if (vol20Avg > 0) volRatio[i] = bars[i].volume / vol20Avg;
      if (vol90Avg > 0) relVol90[i] = bars[i].volume / vol90Avg;
      if (vol30Avg > 0) relVol30[i] = bars[i].volume / vol30Avg;
    }

    // ADAPTIVE THRESHOLD — ported from HistoricalEngine.ts:2256-2280. When a symbol
    // yields fewer than 20 anomalies the engine walks the z-threshold down in 0.05
    // steps to a floor of 1.80. Omitting this was causing 97/400 stored rows to go
    // undetected in the control. The count it tests is real anomalies PLUS the
    // null-samples it admits (capped at half the real count), so both are modelled.
    const nullCandidate = new Array(bars.length).fill(false);
    for (let i = 1; i < bars.length; i++) {
      nullCandidate[i] = enoughWindow[i] && Math.abs(zArr[i]) < 0.5 && volRatio[i] > 1.5;
    }
    const nCandidates = nullCandidate.reduce((a, c) => a + (c ? 1 : 0), 0);
    let threshold = Z_THRESHOLD;
    const countReal = (t: number) => {
      let n = 0;
      for (let i = 1; i < bars.length; i++) if (enoughWindow[i] && Math.abs(zArr[i]) > t) n++;
      return n;
    };
    let real = countReal(threshold);
    let loop = 0;
    while (real + Math.min(nCandidates, Math.floor(real / 2)) < 20 && threshold > 1.80 && loop < 40) {
      threshold = Math.max(1.80, threshold - 0.05);
      real = countReal(threshold);
      loop++;
    }
    const maxNull = Math.floor(real / 2);

    // DELIBERATE DEPARTURE from HistoricalEngine. The engine does
    // `nullCandidates.slice(0, maxNull)` — the FIRST N candidates chronologically.
    // Over the engine's short 2y/5y fetch that was harmless, but this script runs over
    // 60 years, so slicing from the front puts every null sample in the oldest years:
    // a first pass produced 55.6% null samples pre-2000 vs 20% for 2010-15. That makes
    // label composition a proxy for the date, which is the very failure class this
    // re-extraction exists to remove. Instead we stride evenly through the candidates
    // so nulls keep the same COUNT but are spread across the whole series.
    const candIdx: number[] = [];
    for (let i = 1; i < bars.length; i++) if (nullCandidate[i]) candIdx.push(i);
    const chosenNulls = new Set<number>();
    if (maxNull > 0 && candIdx.length) {
      const stride = candIdx.length / Math.min(maxNull, candIdx.length);
      for (let k = 0; k < Math.min(maxNull, candIdx.length); k++) {
        chosenNulls.add(candIdx[Math.floor(k * stride)]);
      }
    }

    const out: any[] = [];
    for (let i = 1; i < bars.length; i++) {
      const p = bars[i];
      const zScore = zArr[i];
      const isReal = enoughWindow[i] && Math.abs(zScore) > threshold;
      let isNull = false;
      if (!isReal) {
        if (!chosenNulls.has(i)) continue;
        isNull = true;
      }

      const volumeRatio = volRatio[i];
      const relativeVolume90 = relVol90[i];
      const relativeVolume30 = relVol30[i];
      const prev = bars[i - 1];
      const body_to_range_ratio = Math.abs(p.close - p.open) / Math.max(0.0001, p.high - p.low);
      const overnight_gap_pct = ((p.open - prev.close) / prev.close) * 100;

      let gap_fill_ratio = 0;
      const gap = p.open - prev.close;
      if (Math.abs(gap) > 0) {
        const retr = gap > 0 ? p.open - p.low : p.high - p.open;
        gap_fill_ratio = Math.min((retr / Math.abs(gap)) * 100, 100);
      }

      // obv_delta_10d — the REDEFINED formula (HistoricalEngine.ts:1928-1940)
      const o10s = Math.max(0, i - 9);
      let signed = 0, totalV = 0;
      for (let k = o10s; k <= i; k++) {
        totalV += bars[k].volume;
        if (k > 0) {
          if (bars[k].close > bars[k - 1].close) signed += bars[k].volume;
          else if (bars[k].close < bars[k - 1].close) signed -= bars[k].volume;
        }
      }
      const obv_delta_10d = (signed / Math.max(1, totalV)) * 100;

      const s50 = bars.slice(Math.max(0, i - 49), i + 1);
      const sma50 = s50.reduce((a, c) => a + c.close, 0) / s50.length;
      const s200 = bars.slice(Math.max(0, i - 199), i + 1);
      const sma200 = s200.reduce((a, c) => a + c.close, 0) / s200.length;

      const atr_shock_score = ((p.high - p.low) / (p.close > 0 ? p.close : 1)) * 100;

      // ---- LABELS
      // FIXED: 21 TRADING bars, not 21 bars of unknown granularity.
      const fwdBar = (n: number) => (bars[i + n] ? (bars[i + n].close - p.close) / p.close : null);
      const win21 = bars.slice(i + 1, i + 22);
      const mfe = win21.length ? (Math.max(...win21.map(b => b.high)) - p.close) / p.close : null;
      const mae = win21.length ? (Math.min(...win21.map(b => b.low)) - p.close) / p.close : null;
      const cal = (d: number) => { const c = calendarForward(bars, i, d); return c === null ? null : (c - p.close) / p.close; };

      out.push({
        symbol, date: p.date,
        excess_return: excessReturn[i] / 100,   // engine stores /100 (EventFeatureVector)
        z_score: zScore,
        daily_return: dailyReturn[i] / 100,
        atr_shock_score: atr_shock_score / 100,
        volume_ratio: volumeRatio,
        relative_volume_30d: relativeVolume30,
        relative_volume_90d: relativeVolume90,
        body_to_range_ratio,
        overnight_gap_pct: overnight_gap_pct / 100,
        gap_fill_ratio,
        obv_delta_10d,
        dist_sma_50: ((p.close - sma50) / Math.max(0.0001, sma50)) * 100,
        dist_sma_200: ((p.close - sma200) / Math.max(0.0001, sma200)) * 100,
        rsi_14: rsi[i],
        forward_return_1m: fwdBar(21),
        max_favorable_excursion_1m: mfe,
        max_adverse_excursion_1m: mae,
        forward_return_2d: cal(2), forward_return_3d: cal(3), forward_return_2w: cal(10),
        forward_return_3m: cal(91), forward_return_6m: cal(182), forward_return_12m: cal(365),
        sector, benchmark: benchmarkFor(symbol), commodity_id: commodityId ?? null,
        _z: zScore,
        is_null_sample: isNull ? 1 : 0,
        triggered_z_threshold: threshold,
        // engine's tiering, HistoricalEngine.ts:494-497
        confidence_tier: threshold >= 2.15 ? 'high' : threshold >= 1.8 ? 'medium' : 'low',
      });
    }
    const zByDate = new Map<string, number>();
    for (let i = 1; i < bars.length; i++) zByDate.set(bars[i].date, zArr[i]);
    (out as any)._zByDate = zByDate;
    (out as any)._threshold = threshold;
    return out;
  }

  // ------------------------------------------------------------------ VALIDATE
  if (validate) {
    console.log('=== CONTROL: re-derive known-good 2021+ rows and compare to stored ===');
    console.log('A port that has drifted from HistoricalEngine will show up here.\n');
    let rows = db.prepare(`
      SELECT symbol, date, features_json, signal_snapshot_json FROM event_features
      WHERE is_null_sample = 0 AND date >= '2021-01-01'
      ORDER BY symbol, date
    `).all() as any[];
    if (LIMIT) rows = rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / LIMIT)) === 0).slice(0, LIMIT);
    console.log(`comparing ${rows.length} stored 2021+ rows\n`);

    const bySym = new Map<string, any[]>();
    for (const r of rows) { if (!bySym.has(r.symbol)) bySym.set(r.symbol, []); bySym.get(r.symbol)!.push(r); }

    // features_json stores several of these camelCase (EventFeatureVector), while the
    // snapshot uses snake_case — mirror feature_extractor.ts NUMERIC_ACCESSORS, which
    // reads snapshot first then falls back to the camelCase feature key.
    const FIELDS: Array<[string, string[]]> = [
      ['excess_return', ['excess_return', 'excessReturn']],
      ['z_score', ['z_score', 'zScore']],
      ['volume_ratio', ['volume_ratio', 'volumeRatio']],
      ['atr_shock_score', ['atr_shock_score', 'atrShockScore']],
      ['overnight_gap_pct', ['overnight_gap_pct']],
      ['rsi_14', ['rsi_14']],
      ['dist_sma_50', ['dist_sma_50']],
      ['dist_sma_200', ['dist_sma_200']],
      ['body_to_range_ratio', ['body_to_range_ratio']],
    ];
    const diffs: Record<string, number[]> = {}; for (const [f] of FIELDS) diffs[f] = [];
    let detected = 0, missed = 0, noPrice = 0;
    // why a stored row failed to re-detect: date absent from daily_prices at all, or
    // present but below OUR threshold (the engine's adaptive threshold ran over a
    // short 2y/5y fetch and often fell to 1.80, ours runs over decades and stays 2.5)
    let missNoDate = 0, missBelowThresh = 0, missOther = 0;
    const missZ: number[] = [];
    const missMonth: Record<string, number> = {};
    const hitMonth: Record<string, number> = {};

    for (const [sym, rs] of bySym) {
      let derived: any[] | null;
      try { derived = derive(sym); } catch { derived = null; }
      if (!derived) { noPrice += rs.length; continue; }
      const byDate = new Map(derived.map(d => [d.date, d]));
      const zByDate: Map<string, number> = (derived as any)._zByDate;
      const thr: number = (derived as any)._threshold;
      for (const r of rs) {
        const dstr = String(r.date).slice(0, 10);
        const d = byDate.get(dstr);
        if (!d) {
          missed++;
          const z = zByDate.get(dstr);
          if (z === undefined) missNoDate++;
          else {
            missMonth[dstr.slice(0, 7)] = (missMonth[dstr.slice(0, 7)] ?? 0) + 1;
            if (Math.abs(z) <= thr) { missBelowThresh++; missZ.push(Math.abs(z)); }
            else missOther++;
          }
          continue;
        }
        hitMonth[dstr.slice(0, 7)] = (hitMonth[dstr.slice(0, 7)] ?? 0) + 1;
        detected++;
        let f: any; try { f = JSON.parse(r.features_json); } catch { continue; }
        let snap: any = null; try { snap = r.signal_snapshot_json ? JSON.parse(r.signal_snapshot_json) : null; } catch { /* ignore */ }
        for (const [k, keys] of FIELDS) {
          let a: any;
          for (const kk of keys) {
            if (snap && typeof snap[kk] === 'number') { a = snap[kk]; break; }
            if (typeof f[kk] === 'number') { a = f[kk]; break; }
          }
          const b = d[k];
          if (typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b)) {
            diffs[k].push(Math.abs(a - b));
          }
        }
      }
    }
    // hoisted: used by the miss diagnostic above
    const med = (a: number[]) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
    console.log(`stored rows re-detected as anomalies : ${detected}`);
    console.log(`stored rows NOT re-detected          : ${missed}`);
    console.log(`   - date absent from daily_prices   : ${missNoDate}`);
    console.log(`   - present but |z| <= our threshold: ${missBelowThresh}${missZ.length ? `  (median |z| ${med(missZ).toFixed(2)})` : ''}`);
    console.log(`   - present, |z| above, still missed: ${missOther}`);
    console.log(`symbols with no usable price series  : ${noPrice}\n`);
    const months = Array.from(new Set([...Object.keys(missMonth), ...Object.keys(hitMonth)])).sort();
    console.log('miss rate by month (boundary effect would concentrate misses early):');
    for (const m of months) {
      const mi = missMonth[m] ?? 0, hi = hitMonth[m] ?? 0;
      if (mi + hi < 3) continue;
      console.log(`   ${m}  matched ${String(hi).padStart(4)}  missed ${String(mi).padStart(4)}  miss-rate ${(100 * mi / (mi + hi)).toFixed(0).padStart(3)}%`);
    }
    console.log('');
    console.log(`${'field'.padEnd(24)} ${'n'.padStart(7)} ${'median|diff|'.padStart(13)} ${'p90|diff|'.padStart(12)}  verdict`);
    console.log('-'.repeat(76));
    for (const [f] of FIELDS) {
      const a = diffs[f];
      if (!a.length) { console.log(`${f.padEnd(24)} ${'0'.padStart(7)}   (no overlap)`); continue; }
      const s = a.slice().sort((x, y) => x - y);
      const m = med(a), p90 = s[Math.floor(s.length * 0.9)];
      const verdict = m < 1e-6 ? 'EXACT' : m < 1e-3 ? 'close' : 'DRIFT';
      console.log(`${f.padEnd(24)} ${String(a.length).padStart(7)} ${m.toExponential(2).padStart(13)} ${p90.toExponential(2).padStart(12)}  ${verdict}`);
    }
  }

  // ---------------------------------------------------------------------- RUN
  if (run) {
    db.exec(`CREATE TABLE IF NOT EXISTS event_features_daily (
        symbol TEXT NOT NULL, date TEXT NOT NULL,
        excess_return REAL, z_score REAL, daily_return REAL, atr_shock_score REAL,
        volume_ratio REAL, relative_volume_30d REAL, relative_volume_90d REAL,
        body_to_range_ratio REAL, overnight_gap_pct REAL, gap_fill_ratio REAL,
        obv_delta_10d REAL, dist_sma_50 REAL, dist_sma_200 REAL, rsi_14 REAL,
        forward_return_1m REAL, max_favorable_excursion_1m REAL, max_adverse_excursion_1m REAL,
        forward_return_2d REAL, forward_return_3d REAL, forward_return_2w REAL,
        forward_return_3m REAL, forward_return_6m REAL, forward_return_12m REAL,
        sector TEXT, benchmark TEXT, commodity_id TEXT,
        is_null_sample INTEGER, triggered_z_threshold REAL, confidence_tier TEXT,
        source TEXT DEFAULT 'daily_reextract',
        PRIMARY KEY (symbol, date));`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_efd_date ON event_features_daily(date);`);

    const cols = ['symbol','date','excess_return','z_score','daily_return','atr_shock_score',
      'volume_ratio','relative_volume_30d','relative_volume_90d','body_to_range_ratio',
      'overnight_gap_pct','gap_fill_ratio','obv_delta_10d','dist_sma_50','dist_sma_200','rsi_14',
      'forward_return_1m','max_favorable_excursion_1m','max_adverse_excursion_1m',
      'forward_return_2d','forward_return_3d','forward_return_2w',
      'forward_return_3m','forward_return_6m','forward_return_12m',
      'sector','benchmark','commodity_id',
      'is_null_sample','triggered_z_threshold','confidence_tier'];
    const ins = db.prepare(
      `INSERT OR IGNORE INTO event_features_daily (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`
    );
    const insMany = db.transaction((rs: any[]) => { let n = 0; for (const r of rs) n += ins.run(r).changes; return n; });

    let symbols = (db.prepare('SELECT DISTINCT symbol FROM daily_prices ORDER BY symbol').all() as any[]).map(r => r.symbol);
    // --maxSymbols lets us size the output before committing to a full pass: a faithful
    // daily re-detection finds far more events than the 16.4k monthly-bar artifacts it
    // replaces, and that ratio changes the training distribution, so it is measured
    // rather than assumed.
    const maxSymArg = argv.indexOf('--maxSymbols');
    if (maxSymArg >= 0) {
      const n = Number(argv[maxSymArg + 1]);
      const step = Math.max(1, Math.floor(symbols.length / n));
      symbols = symbols.filter((_, i) => i % step === 0).slice(0, n);
      console.log(`[estimate mode] sampling ${symbols.length} symbols evenly across the universe`);
    }
    console.log(`\n=== RUN: re-extracting daily events for ${symbols.length} symbols, dates < ${UNTIL} ===`);
    let done = 0, written = 0, skipped = 0;
    for (const s of symbols) {
      let d: any[] | null;
      try { d = derive(s); } catch (e: any) { console.warn(`  ${s}: ${e.message}`); d = null; }
      if (!d) { skipped++; continue; }
      const keep = d.filter(r => r.date < UNTIL);
      if (keep.length) written += insMany(keep);
      if (++done % 200 === 0) console.log(`  ${done}/${symbols.length} symbols, ${written.toLocaleString()} events written`);
    }
    const tot = db.prepare('SELECT COUNT(*) c, MIN(date) lo, MAX(date) hi FROM event_features_daily').get() as any;
    console.log(`\ndone. ${done} symbols processed, ${skipped} skipped (no price series)`);
    console.log(`event_features_daily: ${tot.c.toLocaleString()} rows, ${tot.lo} -> ${tot.hi}`);
  }

  db.close();
}

main();
