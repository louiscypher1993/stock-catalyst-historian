/**
 * buildShortInterest.ts — Stage-3 data item: consolidated US equity short
 * interest (FINRA, official, free, no auth, no signup).
 *
 * Source: https://cdn.finra.org/equity/otcmarket/biweekly/shrt<YYYYMMDD>.csv
 * (settlement-date-stamped, so point-in-time-safe). This is FINRA's own CDN
 * direct-download file, DISTINCT from developer.finra.org's Query API (which
 * requires free OAuth2 registration -- a real signup step this script avoids
 * entirely). Covers ALL exchange-listed US equities (NYSE/NNM/AMEX/ARCA/BZX/
 * SC) plus OTC in one consolidated file (confirmed: post-June-2021 files are
 * consolidated, not OTC-only). US-only by nature -- non-US suffixed symbols
 * in the scan universe are correctly out of scope, not "unmatched".
 *
 * SETTLEMENT SCHEDULE IS NOT HARDCODED. FINRA settlement dates are the 15th
 * and last calendar day of each month, SHIFTED for weekends/holidays in a way
 * that isn't a clean formula (confirmed empirically: 2026-06-30 has a file,
 * 2026-05-31 does not). Rather than guess the shift rule, this probes
 * backward from today (cheap HEAD requests) and uses the first date that
 * resolves -- self-correcting against whatever FINRA's actual calendar is.
 *
 * DUAL-CLASS TICKER FORMAT (a THIRD distinct convention, confirmed live):
 * Yahoo="BRK.B", OpenFIGI="BRK/B" (buildOpenFigiMap.ts), FINRA="BRKB" (no
 * separator at all). Each data source picked its own convention -- this is
 * now the second time this exact landmine has surfaced (see
 * buildOpenFigiMap.ts's note); worth revisiting costModel.ts's suffixOf()
 * more broadly if a third instance appears.
 *
 * Usage:
 *   npx tsx src/scripts/buildShortInterest.ts
 *   npx tsx src/scripts/buildShortInterest.ts --date 20260715   # specific settlement date
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CDN_BASE = 'https://cdn.finra.org/equity/otcmarket/biweekly/shrt';
const PROBE_WINDOW_DAYS = 45; // comfortably spans a full settlement cycle + holiday shifts

const DUAL_CLASS_US_TICKERS: Record<string, string> = { 'BRK.B': 'BRKB' };

function ymd(d: Date): string { return d.toISOString().slice(0, 10).replace(/-/g, ''); }

async function fileExists(dateStr: string): Promise<boolean> {
  const res = await fetch(`${CDN_BASE}${dateStr}.csv`, { method: 'HEAD' });
  return res.ok;
}

/** Probe backward from today for the most recent settlement file that actually exists. */
async function findLatestSettlementDate(): Promise<string> {
  const today = new Date();
  for (let i = 0; i < PROBE_WINDOW_DAYS; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const ds = ymd(d);
    if (await fileExists(ds)) return ds;
  }
  throw new Error(`No settlement file found in the last ${PROBE_WINDOW_DAYS} days -- FINRA CDN layout may have changed.`);
}

interface ShortInterestRow {
  symbolCode: string; issueName: string; marketClassCode: string;
  currentShortPositionQuantity: number; previousShortPositionQuantity: number;
  averageDailyVolumeQuantity: number; daysToCoverQuantity: number;
  changePercent: number; settlementDate: string;
}

function parseCsv(text: string): Map<string, ShortInterestRow> {
  const lines = text.split('\n');
  const header = lines[0].split('|');
  const idx = (name: string) => header.indexOf(name);
  const iSym = idx('symbolCode'), iName = idx('issueName'), iMkt = idx('marketClassCode'),
    iCur = idx('currentShortPositionQuantity'), iPrev = idx('previousShortPositionQuantity'),
    iAdv = idx('averageDailyVolumeQuantity'), iDtc = idx('daysToCoverQuantity'),
    iChg = idx('changePercent'), iDate = idx('settlementDate');

  const out = new Map<string, ShortInterestRow>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const f = line.split('|');
    const symbol = f[iSym];
    if (!symbol) continue;
    out.set(symbol, {
      symbolCode: symbol, issueName: f[iName], marketClassCode: f[iMkt],
      currentShortPositionQuantity: Number(f[iCur]) || 0,
      previousShortPositionQuantity: Number(f[iPrev]) || 0,
      averageDailyVolumeQuantity: Number(f[iAdv]) || 0,
      daysToCoverQuantity: Number(f[iDtc]) || 0,
      changePercent: Number(f[iChg]) || 0,
      settlementDate: f[iDate],
    });
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const forcedDate = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;

  const settlementDate = forcedDate ?? await findLatestSettlementDate();
  console.log(`Settlement file: ${settlementDate}${forcedDate ? ' (forced via --date)' : ' (auto-discovered, latest available)'}`);

  const res = await fetch(`${CDN_BASE}${settlementDate}.csv`);
  if (!res.ok) throw new Error(`Fetch failed for ${settlementDate}: HTTP ${res.status}`);
  const text = await res.text();
  const bySymbol = parseCsv(text);
  console.log(`Parsed ${bySymbol.size} rows from FINRA's consolidated short interest file.`);

  const spreadPath = join(__dirname, 'symbol_spread_bps.json');
  const universe: string[] = Object.keys(JSON.parse(readFileSync(spreadPath, 'utf8')).spreadBps);
  // A plain "no dot" filter would exclude known US dual-class tickers (BRK.B
  // contains a literal dot but IS US-listed) -- the same landmine class noted
  // in buildOpenFigiMap.ts, caught here by testing against real output rather
  // than trusting the filter.
  const usSymbols = universe.filter(s => !s.includes('.') || DUAL_CLASS_US_TICKERS[s]);
  console.log(`Universe: ${universe.length} total, ${usSymbols.length} US-listed (the only ones this US-only dataset can cover).`);

  const out: Record<string, {
    shortShares: number; prevShortShares: number; daysToCover: number;
    avgDailyVolume: number; changePercent: number; exchange: string; settlementDate: string;
  }> = {};
  const unmatched: string[] = [];

  for (const symbol of usSymbols) {
    const finraKey = DUAL_CLASS_US_TICKERS[symbol] ?? symbol;
    const row = bySymbol.get(finraKey);
    if (!row) { unmatched.push(symbol); continue; }
    out[symbol] = {
      shortShares: row.currentShortPositionQuantity, prevShortShares: row.previousShortPositionQuantity,
      daysToCover: row.daysToCoverQuantity, avgDailyVolume: row.averageDailyVolumeQuantity,
      changePercent: row.changePercent, exchange: row.marketClassCode, settlementDate: row.settlementDate,
    };
  }

  console.log(`\nMatched ${Object.keys(out).length}/${usSymbols.length} US-listed symbols (${(Object.keys(out).length / usSymbols.length * 100).toFixed(1)}%).`);
  if (unmatched.length) console.log(`  unmatched: ${unmatched.join(', ')}`);
  console.log(`  (${universe.length - usSymbols.length} non-US symbols in the universe are correctly out of scope -- this dataset is US-only.)`);

  const outPath = join(__dirname, 'symbol_short_interest.json');
  writeFileSync(outPath, JSON.stringify({
    _note: 'symbol -> FINRA consolidated short interest (US-listed only). Source: cdn.finra.org biweekly settlement file, free/no-auth. Point-in-time via settlementDate. Rebuild via buildShortInterest.ts.',
    _built: new Date().toISOString().slice(0, 10),
    _settlementDate: settlementDate,
    _sourceUrl: `${CDN_BASE}${settlementDate}.csv`,
    _unmatched: unmatched,
    shortInterest: out,
  }, null, 2));
  console.log(`\nWrote ${Object.keys(out).length} entries -> ${outPath}`);

  console.log('\nSanity check (known symbols):');
  for (const s of ['AAPL', 'TSLA', 'KO', 'BRK.B']) {
    const e = out[s];
    console.log(`   ${s.padEnd(8)} ${e ? `short=${e.shortShares.toLocaleString()}  daysToCover=${e.daysToCover}  Δ=${e.changePercent.toFixed(1)}%  (${e.exchange}, settled ${e.settlementDate})` : 'NOT MATCHED'}`);
  }
}

main().catch(e => { console.error('[ShortInterest] FATAL:', e); process.exit(1); });
