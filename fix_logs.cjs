const fs = require('fs');
let content = fs.readFileSync('HistoricalEngine.ts', 'utf8');

content = content.replace("console.error(`[DATA] Polygon fetch failed for ${uppercaseSymbol}, falling back to Yahoo Finance: ${error.message || error}`);",
  "console.warn(`[DATA] Polygon fetch warning for ${uppercaseSymbol}, falling back to Yahoo Finance: ${error.message || error}`);");

content = content.replace("console.error(`[DATA] EODHD fetch failed for ${uppercaseSymbol}, falling back to Yahoo Finance: ${error.message || error}`);",
  "console.warn(`[DATA] EODHD fetch warning for ${uppercaseSymbol}, falling back to Yahoo Finance: ${error.message || error}`);");

fs.writeFileSync('HistoricalEngine.ts', content);
console.log('Fixed fallback logs');
