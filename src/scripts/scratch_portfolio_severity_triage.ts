/**
 * Cheap severity triage (read-only) for the 50 distinct PHENOM3_STALE_AT_ENTRY
 * symbols found by scratch_portfolio_wide_screen.ts. NOT a point-in-time
 * replay -- uses TODAY's fresh z_score/excess_return as a proxy to rank how
 * far each symbol's frozen 2026-06-13 snapshot has since diverged from
 * reality, same magnitude metric as the earlier pot-5 blast-radius recon
 * (|z_score| + 10*|excess_return| divergence). Purpose: prioritize which
 * symbols actually warrant the expensive full point-in-time-correct replay
 * (vintage-correct code + historical bars + infer.py) vs which are probably
 * immaterial. Also separately flags PHENOM1_ZERO_COVERAGE symbols (no
 * severity signal possible -- listed for completeness).
 */
import 'dotenv/config';
import {
  fetchYahooDailyHistory,
  buildSpyReturnMap,
  detectAnomaly,
} from '../LiveInferenceService';

async function main() {
  const fs = await import('fs');
  const screenPath = 'C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/cedc837a-6594-4cda-a4ab-f3b79971424e/scratchpad/portfolio_screen.json';
  const screen = JSON.parse(fs.readFileSync(screenPath, 'utf-8'));

  const phenom3 = screen.flagged.filter((f: any) => f.phenomenon === 'PHENOM3_STALE_AT_ENTRY');
  const phenom1 = screen.flagged.filter((f: any) => f.phenomenon === 'PHENOM1_ZERO_COVERAGE');
  const distinctPhenom3Symbols: string[] = Array.from(new Set(phenom3.map((f: any) => f.symbol)));
  console.log(`Phenom3 distinct symbols to triage: ${distinctPhenom3Symbols.length}`);
  console.log(`Phenom1 distinct symbols (no severity signal, listed separately): ${Array.from(new Set(phenom1.map((f:any)=>f.symbol))).length}`);

  const { supabase } = await import('../db/supabaseClient');
  const { data: snapRows } = await supabase.from('symbol_snapshots').select('symbol, latest_signal_snapshot').in('symbol', distinctPhenom3Symbols);
  const snapBySymbol = new Map((snapRows || []).map((r: any) => [r.symbol, r.latest_signal_snapshot ?? {}]));

  const spyBars = await fetchYahooDailyHistory('SPY', '1y');
  const spyReturnByDate = buildSpyReturnMap(spyBars);

  const severity: Array<{ symbol: string; staleZ: number | null; staleER: number | null; freshZ: number | null; freshER: number | null; divergence: number | null; error?: string }> = [];

  for (const symbol of distinctPhenom3Symbols) {
    const staleSnap = snapBySymbol.get(symbol) || {};
    try {
      const bars = await fetchYahooDailyHistory(symbol, '1y');
      const anomaly = detectAnomaly(symbol, symbol, bars, spyReturnByDate, true);
      if (!anomaly) {
        severity.push({ symbol, staleZ: staleSnap.z_score ?? null, staleER: staleSnap.excess_return ?? null, freshZ: null, freshER: null, divergence: null, error: 'detectAnomaly null' });
      } else {
        const staleZ = staleSnap.z_score ?? 0;
        const staleER = staleSnap.excess_return ?? 0;
        const divergence = Math.abs(anomaly.zScore - staleZ) + 10 * Math.abs(anomaly.excessReturn - staleER);
        severity.push({ symbol, staleZ: staleSnap.z_score ?? null, staleER: staleSnap.excess_return ?? null, freshZ: anomaly.zScore, freshER: anomaly.excessReturn, divergence });
      }
    } catch (e: any) {
      severity.push({ symbol, staleZ: staleSnap.z_score ?? null, staleER: staleSnap.excess_return ?? null, freshZ: null, freshER: null, divergence: null, error: e.message });
    }
    await new Promise(r => setTimeout(r, 130));
  }

  severity.sort((a, b) => (b.divergence ?? -1) - (a.divergence ?? -1));
  console.log('\n=== Severity ranking (proxy divergence, NOT point-in-time-correct) ===');
  for (const s of severity) {
    console.log(`  ${s.symbol.padEnd(12)} staleZ=${s.staleZ?.toFixed?.(3) ?? s.staleZ} staleER=${s.staleER?.toFixed?.(3) ?? s.staleER}  freshZ=${s.freshZ?.toFixed?.(3) ?? 'ERR'} freshER=${s.freshER?.toFixed?.(3) ?? 'ERR'}  divergence=${s.divergence?.toFixed?.(3) ?? 'N/A'} ${s.error ?? ''}`);
  }

  const out = 'C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/cedc837a-6594-4cda-a4ab-f3b79971424e/scratchpad/portfolio_severity.json';
  fs.writeFileSync(out, JSON.stringify({ severity, phenom1 }, null, 2));
  console.log(`\nWrote ${out}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
