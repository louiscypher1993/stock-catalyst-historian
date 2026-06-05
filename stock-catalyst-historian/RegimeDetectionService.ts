import { MarketRegime } from "./src/types";

export function detectRegime(benchmarkReturns: Map<string, number>, vixValue: number | null, date: string): MarketRegime {
  const dates = Array.from(benchmarkReturns.keys()).sort();
  const dateIdx = dates.indexOf(date);
  
  let validDates = dates;
  if (dateIdx !== -1) {
    validDates = dates.slice(0, dateIdx + 1);
  } else {
    validDates = dates.filter(d => d <= date);
  }

  // 60-day cumulative return
  const slice60 = validDates.slice(Math.max(0, validDates.length - 60));
  let cumReturn60 = 1;
  for (const d of slice60) {
    cumReturn60 *= (1 + (benchmarkReturns.get(d) || 0) / 100);
  }
  cumReturn60 = (cumReturn60 - 1) * 100;

  let trendRegime: MarketRegime["trendRegime"] = "sideways";
  if (cumReturn60 > 8) trendRegime = "bull";
  else if (cumReturn60 < -8) trendRegime = "bear";

  let volatilityRegime: MarketRegime["volatilityRegime"] = "normal";
  if (vixValue !== null) {
    if (vixValue < 15) volatilityRegime = "low_volatility";
    else if (vixValue <= 20) volatilityRegime = "normal";
    else if (vixValue <= 30) volatilityRegime = "high_volatility";
    else volatilityRegime = "panic";
  } else {
    // stddev of 20 days proxy
    const slice20 = validDates.slice(Math.max(0, validDates.length - 20));
    let mean = 0;
    const rets = slice20.map(d => benchmarkReturns.get(d) || 0);
    if (rets.length > 0) {
      mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      let variance = rets.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / rets.length;
      const stdDev = Math.sqrt(variance);
      const proxyVix = Math.abs(stdDev * 16);
      if (proxyVix < 15) volatilityRegime = "low_volatility";
      else if (proxyVix <= 20) volatilityRegime = "normal";
      else if (proxyVix <= 30) volatilityRegime = "high_volatility";
      else volatilityRegime = "panic";
    }
  }

  const slice10 = validDates.slice(Math.max(0, validDates.length - 10));
  let cumReturn10 = 1;
  for (const d of slice10) {
    cumReturn10 *= (1 + (benchmarkReturns.get(d) || 0) / 100);
  }
  cumReturn10 = (cumReturn10 - 1) * 100;

  let macroRegime: MarketRegime["macroRegime"] = "transitioning";
  const isPos = cumReturn10 >= 0;
  
  if (isPos && (volatilityRegime === "low_volatility" || volatilityRegime === "normal")) {
    macroRegime = "risk_on";
  } else if (!isPos || volatilityRegime === "high_volatility" || volatilityRegime === "panic") {
    macroRegime = "risk_off";
  }

  return { trendRegime, volatilityRegime, macroRegime };
}
