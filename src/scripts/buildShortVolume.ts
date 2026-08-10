/**
 * FINRA daily short-sale volume capture (weekly, pit-snapshot.yml).
 *
 * Source: https://cdn.finra.org/equity/regsho/daily/CNMSshvol{YYYYMMDD}.txt
 *   pipe-delimited: Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market
 *   Consolidated NMS tape, ~12k symbols/day, published every trading day, no key.
 *
 * UNLIKE the register-style sources in this workflow, FINRA archives these files
 * publicly back to 2009 — history is fully backfillable at retrain time, so this
 * artifact deliberately stores only a compact CURRENT state per symbol (what live
 * serving parity will need), not raw history:
 *   short_ratio_1d   = ShortVolume/TotalVolume on the latest trading day
 *   short_ratio_5d   = volume-weighted ratio over the last 5 trading days
 *   short_ratio_20d  = volume-weighted ratio over the last 20 trading days
 *   adv_20d          = average daily TotalVolume over those days
 *
 * The off-exchange short ratio is the closest free analogue to the short-flow data
 * institutional platforms sell. NOT a feature yet — wiring is retrain-gated like
 * every other capture (see TODO.md).
 *
 * US symbols only (FINRA is NMS). Our dash-class forms (BRK-B) appear in FINRA files
 * dot-form (BRK.B); both are tried.
 *
 * Usage: npx tsx src/scripts/buildShortVolume.ts [--days 30]
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { GLOBAL_MARKETS } from '../marketsData';

const OUT = path.join(process.cwd(), 'src', 'scripts', 'symbol_short_volume.json');
const daysIdx = process.argv.indexOf('--days');
const LOOKBACK_CAL_DAYS = daysIdx > -1 ? Number(process.argv[daysIdx + 1]) : 30;

interface DayRow { date: string; short: number; total: number }

async function main() {
  const usSymbols = new Set<string>();
  for (const m of GLOBAL_MARKETS) {
    for (const s of m.stocks) {
      const sym = s.symbol.toUpperCase();
      if (!sym.includes('.')) usSymbols.add(sym);
    }
  }
  console.log(`US universe symbols: ${usSymbols.size}`);

  // FINRA files key dot-form for share classes; map both spellings to our symbol.
  const finraToOurs = new Map<string, string>();
  for (const sym of usSymbols) {
    finraToOurs.set(sym, sym);
    if (sym.includes('-')) finraToOurs.set(sym.replace(/-/g, '.'), sym);
  }

  const bySymbol = new Map<string, DayRow[]>();
  let filesOk = 0;
  for (let back = 0; back < LOOKBACK_CAL_DAYS; back++) {
    const d = new Date(Date.now() - back * 86400000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    const url = `https://cdn.finra.org/equity/regsho/daily/CNMSshvol${ymd}.txt`;
    try {
      const res = await fetch(url);
      if (!res.ok) { if (res.status !== 404) console.warn(`${ymd}: HTTP ${res.status}`); continue; }
      const text = await res.text();
      let matched = 0;
      for (const line of text.split('\n')) {
        const [date, symbol, shortVol, , totalVol] = line.split('|');
        const ours = finraToOurs.get(symbol);
        if (!ours || !date || date === 'Date') continue;
        const short = Number(shortVol), total = Number(totalVol);
        if (!Number.isFinite(short) || !(total > 0)) continue;
        if (!bySymbol.has(ours)) bySymbol.set(ours, []);
        bySymbol.get(ours)!.push({ date, short, total });
        matched++;
      }
      filesOk++;
      console.log(`${ymd}: ${matched} universe rows`);
    } catch (e: any) {
      console.warn(`${ymd}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  if (filesOk < 3) throw new Error(`only ${filesOk} daily files retrieved -- refusing to write a thin snapshot`);

  const out: Record<string, { latest: string; short_ratio_1d: number; short_ratio_5d: number; short_ratio_20d: number; adv_20d: number }> = {};
  for (const [sym, rows] of bySymbol) {
    rows.sort((a, b) => b.date.localeCompare(a.date));
    const win = (n: number) => {
      const w = rows.slice(0, n);
      const short = w.reduce((s, r) => s + r.short, 0);
      const total = w.reduce((s, r) => s + r.total, 0);
      return total > 0 ? short / total : 0;
    };
    const w20 = rows.slice(0, 20);
    out[sym] = {
      latest: rows[0].date,
      short_ratio_1d: Number(win(1).toFixed(4)),
      short_ratio_5d: Number(win(5).toFixed(4)),
      short_ratio_20d: Number(win(20).toFixed(4)),
      adv_20d: Math.round(w20.reduce((s, r) => s + r.total, 0) / Math.max(1, w20.length)),
    };
  }

  fs.writeFileSync(OUT, JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    trading_days_used: filesOk,
    note: 'FINRA CNMS daily short-sale volume, compact current state. Raw history is ' +
      'archived by FINRA to 2009 and fully backfillable at retrain time. Not a feature yet.',
    symbols: out,
  }, null, 1));
  console.log(`wrote ${OUT}: ${Object.keys(out).length} symbols over ${filesOk} trading days`);
}

main().catch(e => { console.error(e); process.exit(1); });
