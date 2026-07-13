import 'dotenv/config';
import { db } from '../../db';

async function main() {
  // How many distinct dates does each symbol appear on in event_features?
  // (a proxy for "how often does a symbol get scanned/flagged again")
  const rows = db.prepare(`
    SELECT symbol, date FROM event_features
    WHERE signal_snapshot_json IS NOT NULL
    ORDER BY symbol, date
  `).all() as { symbol: string; date: string }[];

  console.log(`Total event_features rows with signal_snapshot_json: ${rows.length}`);

  const bySymbol = new Map<string, string[]>();
  for (const r of rows) {
    if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, []);
    bySymbol.get(r.symbol)!.push(r.date);
  }

  console.log(`Distinct symbols: ${bySymbol.size}`);

  const multiEventSymbols = [...bySymbol.entries()].filter(([, dates]) => dates.length > 1);
  console.log(`Symbols with >1 event (repeat anomalies): ${multiEventSymbols.length} / ${bySymbol.size} (${(100*multiEventSymbols.length/bySymbol.size).toFixed(1)}%)`);

  const allGapsDays: number[] = [];
  for (const [, dates] of multiEventSymbols) {
    const sorted = [...new Set(dates)].sort();
    for (let i = 1; i < sorted.length; i++) {
      const d1 = new Date(sorted[i - 1]).getTime();
      const d2 = new Date(sorted[i]).getTime();
      const gapDays = (d2 - d1) / 86400000;
      if (gapDays > 0) allGapsDays.push(gapDays);
    }
  }
  allGapsDays.sort((a, b) => a - b);
  console.log(`\nTotal consecutive-event gaps measured: ${allGapsDays.length}`);
  const pct = (p: number) => allGapsDays[Math.floor(p * (allGapsDays.length - 1))];
  console.log(`p10=${pct(0.10)}  p25=${pct(0.25)}  p50(median)=${pct(0.50)}  p75=${pct(0.75)}  p90=${pct(0.90)}  p95=${pct(0.95)}  max=${allGapsDays[allGapsDays.length-1]}`);
  console.log(`mean=${(allGapsDays.reduce((a,b)=>a+b,0)/allGapsDays.length).toFixed(1)}`);

  // Distribution of just the MOST RECENT event's date per symbol, relative to
  // "today" -- proxy for how old event_features itself typically is right now.
  const mostRecentPerSymbol = [...bySymbol.entries()].map(([sym, dates]) => {
    const sorted = [...dates].sort();
    return { sym, mostRecent: sorted[sorted.length - 1] };
  });
  const today = new Date('2026-07-13').getTime();
  const agesDays = mostRecentPerSymbol.map(x => (today - new Date(x.mostRecent).getTime()) / 86400000).sort((a,b)=>a-b);
  console.log(`\nAge (days, relative to 2026-07-13) of each symbol's MOST RECENT event_features row:`);
  console.log(`p10=${agesDays[Math.floor(0.10*(agesDays.length-1))]}  p50=${agesDays[Math.floor(0.50*(agesDays.length-1))]}  p90=${agesDays[Math.floor(0.90*(agesDays.length-1))]}  max=${agesDays[agesDays.length-1]}`);

  // Now check symbol_snapshots itself for updated_at variance (confirm single frozen date)
  const { supabase } = await import('../db/supabaseClient');
  const { data: snapRows, count } = await supabase.from('symbol_snapshots').select('updated_at', { count: 'exact' });
  const uniqueUpdatedAt = new Set((snapRows ?? []).map(r => r.updated_at));
  console.log(`\nsymbol_snapshots total rows: ${count}, distinct updated_at values: ${uniqueUpdatedAt.size}`);
  console.log(`distinct values: ${[...uniqueUpdatedAt].slice(0, 5).join(', ')}`);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
