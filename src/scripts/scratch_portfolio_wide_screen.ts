/**
 * Portfolio-wide Phenomenon 1/3 precondition screen (read-only). Pulls all
 * currently open positions plus positions closed in the last 30 days,
 * cross-references each distinct symbol against symbol_snapshots coverage
 * and staleness AT ENTRY TIME. Since every symbol_snapshots row still
 * carries updated_at=2026-06-13 even as of today (confirmed separately --
 * the table has never updated post-migration), the precondition check
 * reduces to: does a row exist at all (Phenomenon 1 candidate if not), and
 * if it exists, does its fixed 2026-06-13 timestamp predate entry_date by
 * enough to matter (Phenomenon 3 candidate). This is a SCREEN only -- it
 * flags precondition matches for the expensive per-position replay, it
 * does not itself determine whether a flagged position is a real casualty.
 */
import 'dotenv/config';

async function main() {
  const { supabase } = await import('../db/supabaseClient');

  const { data: openPositions } = await supabase
    .from('pot_positions')
    .select('id, pot_id, symbol, direction, entry_date, entry_price, status, exit_date, unrealised_pnl, realised_pnl, realised_return_pct, exit_reason')
    .eq('status', 'open')
    .order('entry_date', { ascending: true });

  const { data: closedPositions } = await supabase
    .from('pot_positions')
    .select('id, pot_id, symbol, direction, entry_date, entry_price, status, exit_date, unrealised_pnl, realised_pnl, realised_return_pct, exit_reason')
    .eq('status', 'closed')
    .gte('exit_date', '2026-06-14')
    .order('entry_date', { ascending: true });

  const allPositions = [...(openPositions || []), ...(closedPositions || [])];
  console.log(`Open: ${openPositions?.length}, Closed(last 30d): ${closedPositions?.length}, Total: ${allPositions.length}`);

  // Exclude pot 5's 3 already-resolved positions
  const RESOLVED_IDS = new Set([85, 103, 109]);
  const inScope = allPositions.filter(p => !RESOLVED_IDS.has(p.id));
  console.log(`In scope (excl. pot 5's 3 resolved): ${inScope.length}`);

  const distinctSymbols = Array.from(new Set(inScope.map(p => p.symbol)));
  console.log(`Distinct symbols: ${distinctSymbols.length}`);

  // Fetch symbol_snapshots coverage for all distinct symbols, paginated
  const snapBySymbol = new Map<string, any>();
  const CHUNK = 100;
  for (let i = 0; i < distinctSymbols.length; i += CHUNK) {
    const chunk = distinctSymbols.slice(i, i + CHUNK);
    const { data } = await supabase.from('symbol_snapshots').select('symbol, updated_at, latest_signal_snapshot').in('symbol', chunk);
    for (const row of data || []) snapBySymbol.set(row.symbol, row);
  }
  console.log(`symbol_snapshots coverage found for ${snapBySymbol.size}/${distinctSymbols.length} distinct symbols\n`);

  interface Flagged {
    id: number; pot_id: number; symbol: string; entry_date: string; status: string;
    phenomenon: string; snap_updated_at: string | null;
    pnl: number | null; exit_reason: string | null;
  }
  const flagged: Flagged[] = [];
  const clean: Flagged[] = [];

  for (const p of inScope) {
    const snap = snapBySymbol.get(p.symbol);
    const pnl = p.status === 'open' ? p.unrealised_pnl : p.realised_pnl;
    if (!snap) {
      flagged.push({
        id: p.id, pot_id: p.pot_id, symbol: p.symbol, entry_date: p.entry_date, status: p.status,
        phenomenon: 'PHENOM1_ZERO_COVERAGE', snap_updated_at: null, pnl, exit_reason: p.exit_reason,
      });
      continue;
    }
    const snapDate = (snap.updated_at || '').slice(0, 10);
    if (snapDate < p.entry_date) {
      // snapshot existed and predates entry -> was already stale at entry
      flagged.push({
        id: p.id, pot_id: p.pot_id, symbol: p.symbol, entry_date: p.entry_date, status: p.status,
        phenomenon: 'PHENOM3_STALE_AT_ENTRY', snap_updated_at: snap.updated_at, pnl, exit_reason: p.exit_reason,
      });
    } else {
      // snapshot's timestamp is on/after entry_date -> was fresh (or didn't predate) at entry
      clean.push({
        id: p.id, pot_id: p.pot_id, symbol: p.symbol, entry_date: p.entry_date, status: p.status,
        phenomenon: 'NOT_FLAGGED', snap_updated_at: snap.updated_at, pnl, exit_reason: p.exit_reason,
      });
    }
  }

  console.log(`=== FLAGGED (precondition match): ${flagged.length} ===`);
  for (const f of flagged.sort((a, b) => a.entry_date.localeCompare(b.entry_date))) {
    console.log(`  #${f.id} pot${f.pot_id} ${f.symbol.padEnd(12)} entry=${f.entry_date} status=${f.status.padEnd(6)} ${f.phenomenon.padEnd(24)} snap_updated=${f.snap_updated_at ?? 'NONE'} pnl=${f.pnl} exit_reason=${f.exit_reason ?? ''}`);
  }

  console.log(`\n=== NOT FLAGGED (snapshot postdates or equals entry_date): ${clean.length} ===`);
  for (const c of clean.sort((a, b) => a.entry_date.localeCompare(b.entry_date))) {
    console.log(`  #${c.id} pot${c.pot_id} ${c.symbol.padEnd(12)} entry=${c.entry_date} status=${c.status.padEnd(6)} snap_updated=${c.snap_updated_at} pnl=${c.pnl}`);
  }

  const fs = await import('fs');
  const out = 'C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/cedc837a-6594-4cda-a4ab-f3b79971424e/scratchpad/portfolio_screen.json';
  fs.writeFileSync(out, JSON.stringify({ flagged, clean, distinctSymbols, coverageCount: snapBySymbol.size }, null, 2));
  console.log(`\nWrote ${out}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
