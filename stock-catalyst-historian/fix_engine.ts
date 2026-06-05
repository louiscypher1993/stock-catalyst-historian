import fs from 'fs';

let text = fs.readFileSync('HistoricalEngine.ts', 'utf8');

function repl(findReg, replacement) {
  const match = text.match(findReg);
  if (!match) {
    console.log("Could not find:", findReg);
  } else {
    text = text.replace(findReg, replacement);
  }
}

// target:
//       if (process.env.EODHD_API_KEY) {
//         try {
// ...
//         } catch (error: any) {
//           const errMsg = error.message || String(error);

const search = `      if (process.env.EODHD_API_KEY) {
        try {
          const history = await fetchInternationalPriceHistory(
            uppercaseSymbol,
            fromDate,
            toDate,
          );
          if (history.length === 0) {
            throw new Error(
              \`No data returned from EODHD for international symbol \${uppercaseSymbol}\`,
            );
          }
          const sanitizedPoints = history.map((p) => ({
            time: p.timestamp,
            dateStr: p.date,
            open: p.open,
            high: p.high,
            low: p.low,
            close: p.close,
            volume: p.volume,
          }));`;

const replace = `      if (process.env.EODHD_API_KEY) {
        try {
          const history = await fetchInternationalPriceHistory(
            uppercaseSymbol,
            fromDate,
            toDate,
          );
          if (history.length < 30) {
            throw new Error(
              \`EODHD returned fewer than 30 bars (\${history.length}) for international symbol \${uppercaseSymbol}\`,
            );
          }
          const sanitizedPoints = history.map((p) => ({
            time: p.timestamp,
            dateStr: p.date,
            open: p.open,
            high: p.high,
            low: p.low,
            close: p.close,
            volume: p.volume,
          }));
          console.log(\`[DATA] \${uppercaseSymbol} international price data from EODHD (\${sanitizedPoints.length} bars)\`);`;

repl(search, replace);

const search2 = `          if (!errMsg.includes("429")) {
            console.warn(
              \`[DATA] EODHD fetch warning for \${uppercaseSymbol}, falling back to Yahoo Finance: \${errMsg}\`,
            );
          }
          const res = await this.fetchYahooPriceData(uppercaseSymbol, range);
          return {
            ...res,
            sourceUsed: (res.meta as any).isSynthesized
              ? "synthesized"
              : "yahoo",
          };
        }
      } else {
        const res = await this.fetchYahooPriceData(uppercaseSymbol, range);
        return {
          ...res,
          sourceUsed: (res.meta as any).isSynthesized ? "synthesized" : "yahoo",
        };
      }`;

const replace2 = `          console.warn(
            \`[DATA] EODHD fetch error/warning for \${uppercaseSymbol}, falling back to Yahoo Finance: \${errMsg}\`,
          );
          const res = await this.fetchYahooPriceData(uppercaseSymbol, range);
          console.log(\`[DATA] \${uppercaseSymbol} international price data from Yahoo (\${res.sanitizedPoints.length} bars)\`);
          return {
            ...res,
            sourceUsed: (res.meta as any).isSynthesized
              ? "synthesized"
              : "yahoo",
          };
        }
      } else {
        const res = await this.fetchYahooPriceData(uppercaseSymbol, range);
        console.log(\`[DATA] \${uppercaseSymbol} international price data from Yahoo (\${res.sanitizedPoints.length} bars)\`);
        return {
          ...res,
          sourceUsed: (res.meta as any).isSynthesized ? "synthesized" : "yahoo",
        };
      }`;

repl(search2, replace2);

fs.writeFileSync('HistoricalEngine.ts', text, 'utf8');
