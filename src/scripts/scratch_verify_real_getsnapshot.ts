import 'dotenv/config';
import { getSymbolSnapshot } from '../LiveInferenceService';

async function main() {
  for (const sym of ['GFC.PA', 'XBI', 'BBAR', 'SNP.RO', 'MOH.AT', 'PKO.WA', 'DVN']) {
    const enrichment = await getSymbolSnapshot(sym);
    console.log(`${sym}: snap===null? ${enrichment.snap === null}  companyName=${enrichment.companyName}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
