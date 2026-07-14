/**
 * F8 verification (read-only): both choke points (LiveInferenceService.ts's
 * potResults.push and PotService.ts's evaluateRun needsFetch loop) call the
 * identical convertToGBPIfHighNominal function -- verifying the function
 * itself with representative real symbols/prices/dates validates both call
 * sites, since code review already confirmed each passes the raw price
 * through unmodified.
 */
import 'dotenv/config';
import { convertToGBPIfHighNominal } from '../../FREDService';

async function main() {
  console.log('=== High-nominal currency (INR) -- should be CONVERTED, differ from input ===');
  const bajfinance = await convertToGBPIfHighNominal('BAJFINANCE.NS', 918.3, '2026-06-14');
  console.log(`BAJFINANCE.NS 918.3 (INR) on 2026-06-14 -> ${bajfinance.toFixed(4)} GBP (changed: ${bajfinance !== 918.3})`);

  const bo500510 = await convertToGBPIfHighNominal('500510.BO', 4050.2, '2026-06-14');
  console.log(`500510.BO 4050.2 (INR) on 2026-06-14 -> ${bo500510.toFixed(4)} GBP (changed: ${bo500510 !== 4050.2})`);

  const freshInr = await convertToGBPIfHighNominal('BAJFINANCE.NS', 1006.6, '2026-07-14');
  console.log(`BAJFINANCE.NS 1006.6 (INR) on 2026-07-14 (today, simulating a fresh scan) -> ${freshInr.toFixed(4)} GBP (changed: ${freshInr !== 1006.6})`);

  console.log('\n=== Close-in-value currencies (USD/EUR/AUD/CAD) -- should be UNCHANGED ===');
  const usd = await convertToGBPIfHighNominal('TSLA', 250.50, '2026-07-14');
  console.log(`TSLA 250.50 (USD) -> ${usd} (unchanged: ${usd === 250.50})`);

  const eur = await convertToGBPIfHighNominal('UCB.BR', 145.20, '2026-07-14');
  console.log(`UCB.BR 145.20 (EUR) -> ${eur} (unchanged: ${eur === 145.20})`);

  const aud = await convertToGBPIfHighNominal('QAN.AX', 10.25, '2026-07-14');
  console.log(`QAN.AX 10.25 (AUD) -> ${aud} (unchanged: ${aud === 10.25})`);

  const gbp = await convertToGBPIfHighNominal('EZJ.L', 675.20, '2026-07-14');
  console.log(`EZJ.L 675.20 (GBP, already correct) -> ${gbp} (unchanged: ${gbp === 675.20})`);

  console.log('\n=== JPY (mapped, DEXJPUS) -- should be CONVERTED automatically, no code change needed for this to work ===');
  const jpy = await convertToGBPIfHighNominal('7203.T', 2850, '2026-07-14');
  console.log(`7203.T 2850 (JPY) -> ${jpy.toFixed(4)} GBP (changed: ${jpy !== 2850})`);

  console.log('\n=== KRW (mapped, DEXKOUS) -- should be CONVERTED automatically ===');
  const krw = await convertToGBPIfHighNominal('005930.KS', 71000, '2026-07-14');
  console.log(`005930.KS 71000 (KRW) -> ${krw.toFixed(4)} GBP (changed: ${krw !== 71000})`);


  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
