import 'dotenv/config';
import { supabase } from '../db/supabaseClient';

// Verbatim copy of PotService.ts's private fetchCurrentPrice (not exported),
// to match exactly what the real pot-processing loop would see for held
// symbols not already in a given run's results.
async function fetchCurrentPrice(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, status: res.status } as any;
    const data: any = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return { ok: false, reason: 'no result object' } as any;
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const last = closes.filter((c): c is number => c != null).pop();
    return (last ?? null) as any;
  } catch (e: any) {
    return { ok: false, reason: e.message } as any;
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const { data: positions } = await supabase
    .from('pot_positions')
    .select('*')
    .eq('status', 'open')
    .order('pot_id');

  console.log(`Total open positions: ${positions?.length ?? 0}`);
  const uniqueSymbols = [...new Set((positions ?? []).map(p => p.symbol))];
  console.log(`Distinct symbols: ${uniqueSymbols.length}\n`);

  const priceResults: Record<string, any> = {};
  for (const sym of uniqueSymbols) {
    const price = await fetchCurrentPrice(sym);
    priceResults[sym] = price;
    const ok = typeof price === 'number';
    console.log(`${sym.padEnd(15)} ${ok ? `price=${price}` : `NO PRICE: ${JSON.stringify(price)}`}`);
    await sleep(100);
  }

  const noPriceSymbols = uniqueSymbols.filter(s => typeof priceResults[s] !== 'number');
  console.log(`\n=== Symbols with NO obtainable price: ${noPriceSymbols.length} ===`);
  console.log(noPriceSymbols.join(', ') || '(none)');

  if (noPriceSymbols.length > 0) {
    console.log('\n=== Flagged position detail ===');
    const flaggedPositions = (positions ?? []).filter(p => noPriceSymbols.includes(p.symbol));
    console.log(JSON.stringify(flaggedPositions, null, 2));
  }

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
