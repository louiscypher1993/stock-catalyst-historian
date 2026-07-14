/**
 * F8 recon (read-only): classify all open + recently-closed pot_positions
 * by native currency (via exchange suffix), quantify how many are
 * non-GBP, and flag which of those are "high-nominal-currency" (JPY/INR/
 * KRW/HUF/etc. -- order-of-magnitude price levels vs GBP) where the
 * shares===0 floor bias would most plausibly cause silent universe-
 * selection bias, vs "close-in-value" currencies (USD/EUR/CHF/AUD/CAD)
 * where the same bug exists but the magnitude effect is much smaller.
 */
import fs from 'node:fs';

const SCRATCH = 'C:/Users/Lewis/AppData/Local/Temp/claude/d--Projects-stock-catalyst-historian/cedc837a-6594-4cda-a4ab-f3b79971424e/scratchpad';
const positions = JSON.parse(fs.readFileSync(`${SCRATCH}/f8_positions.json`, 'utf-8'));

// Approximate GBP value of 1 unit of local currency (rough, for classification only)
const SUFFIX_CURRENCY: Array<[RegExp, string, number]> = [
  [/\.L$/, 'GBP', 1.0],
  [/\.NS$|\.BO$/, 'INR', 0.0095],
  [/\.T$/, 'JPY', 0.0052],
  [/\.SS$|\.SZ$/, 'CNY', 0.11],
  [/\.HK$/, 'HKD', 0.10],
  [/\.KS$/, 'KRW', 0.00057],
  [/\.PA$|\.DE$|\.AS$|\.MI$|\.MC$|\.BR$|\.IR$|\.LS$|\.VI$/, 'EUR', 0.86],
  [/\.AX$/, 'AUD', 0.52],
  [/\.TO$/, 'CAD', 0.58],
  [/\.OL$/, 'NOK', 0.075],
  [/\.SW$/, 'CHF', 0.90],
  [/\.WA$/, 'PLN', 0.20],
  [/\.MX$/, 'MXN', 0.043],
  [/\.SA$/, 'BRL', 0.14],
  [/\.RO$/, 'RON', 0.17],
  [/\.ST$/, 'SEK', 0.076],
  [/\.HE$/, 'EUR', 0.86],
  [/\.SI$/, 'SGD', 0.59],
  [/\.TW$/, 'TWD', 0.025],
  [/\.BK$/, 'THB', 0.023],
];

function classify(symbol: string): { currency: string; gbpPerUnit: number } {
  for (const [re, currency, gbpPerUnit] of SUFFIX_CURRENCY) {
    if (re.test(symbol)) return { currency, gbpPerUnit };
  }
  return { currency: 'USD', gbpPerUnit: 0.79 }; // no suffix = bare US ticker
}

const byCurrency: Record<string, { count: number; symbols: Set<string> }> = {};
const nonGbpRows: any[] = [];

for (const p of positions) {
  const { currency, gbpPerUnit } = classify(p.symbol);
  byCurrency[currency] = byCurrency[currency] || { count: 0, symbols: new Set() };
  byCurrency[currency].count++;
  byCurrency[currency].symbols.add(p.symbol);
  if (currency !== 'GBP') {
    const trueGbpPrice = p.entry_price * gbpPerUnit;
    const impliedSharesAsGBP = p.shares; // what was actually computed, treating entry_price as GBP
    nonGbpRows.push({ ...p, currency, gbpPerUnit, trueGbpPrice, impliedSharesAsGBP });
  }
}

console.log('=== Position count by currency ===');
for (const [cur, { count, symbols }] of Object.entries(byCurrency).sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${cur.padEnd(5)} ${count} positions, ${symbols.size} distinct symbols: ${[...symbols].join(', ')}`);
}

const totalNonGbp = positions.length - (byCurrency['GBP']?.count ?? 0);
console.log(`\nTotal non-GBP-native positions: ${totalNonGbp}/${positions.length} (${(100*totalNonGbp/positions.length).toFixed(1)}%)`);

// High-nominal currencies: >100 units per GBP roughly (JPY, INR, KRW, HUF, CLP, IDR etc.)
const HIGH_NOMINAL = new Set(['JPY', 'INR', 'KRW', 'HUF']);
console.log('\n=== High-nominal-currency positions (order-of-magnitude price-level mismatch vs GBP) ===');
for (const r of nonGbpRows) {
  if (HIGH_NOMINAL.has(r.currency)) {
    console.log(`  #${r.id} ${r.symbol} (${r.currency}) entry_price=${r.entry_price} treated-as-GBP -> true GBP price ~£${r.trueGbpPrice.toFixed(2)}  shares=${r.shares}  position_size_gbp=${r.position_size_gbp}`);
  }
}

console.log('\n=== Close-in-value currency positions (USD/EUR/AUD/CAD/CHF/HKD/CNY etc -- same bug, smaller magnitude) ===');
const closeGroups: Record<string, number> = {};
for (const r of nonGbpRows) {
  if (!HIGH_NOMINAL.has(r.currency)) closeGroups[r.currency] = (closeGroups[r.currency] || 0) + 1;
}
for (const [cur, n] of Object.entries(closeGroups)) console.log(`  ${cur}: ${n} positions`);

// shares===0 floor bias check: for each non-GBP position, what WOULD position sizing have
// looked like with correct FX conversion, using a representative £1000 allocation (typical
// single-slot size seen in this portfolio) -- flags cases close to or past the shares=0 boundary
console.log('\n=== shares===0 floor bias check (representative £1000 slot) ===');
const REPRESENTATIVE_SLOT_GBP = 1000;
let nearMissCount = 0;
for (const r of nonGbpRows) {
  const trueSharesIfCorrect = Math.floor(REPRESENTATIVE_SLOT_GBP / r.trueGbpPrice);
  const sharesAsCurrentlyComputed = Math.floor(REPRESENTATIVE_SLOT_GBP / r.entry_price);
  if (sharesAsCurrentlyComputed === 0 && trueSharesIfCorrect > 0) {
    nearMissCount++;
    console.log(`  #${r.id} ${r.symbol} (${r.currency}): CURRENT LOGIC WOULD SKIP (0 shares from £1000/${r.entry_price}) but TRUE GBP price ~£${r.trueGbpPrice.toFixed(2)} -> would allow ${trueSharesIfCorrect} shares`);
  }
}
console.log(`\nPositions in this sample where current logic's shares===0 floor WOULD have skipped but a corrected FX conversion would NOT have: ${nearMissCount}`);
console.log('(Note: these positions DID open in reality -- meaning their pot allocation was large enough this specific time; this checks the boundary sensitivity generally, not an actual observed skip, since skipped candidates are never persisted to the DB.)');
