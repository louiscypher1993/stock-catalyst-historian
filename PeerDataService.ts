import { getPeerCache, setPeerCache } from "./db";

export async function getTopPeers(symbol: string): Promise<string[] | null> {
  const uppercaseSymbol = symbol.toUpperCase().trim();

  const cached = getPeerCache(uppercaseSymbol);
  if (cached) return cached;

  const isUsStock = !uppercaseSymbol.includes(".");

  // SOURCE 1: Finviz
  if (isUsStock) {
    const finvizPeers = await getFinvizPeers(uppercaseSymbol);
    if (finvizPeers && finvizPeers.length > 0) {
      setPeerCache(uppercaseSymbol, finvizPeers);
      return finvizPeers;
    }
  }

  // SOURCE 2: Yahoo Finance
  const yahooPeers = await getYahooPeers(uppercaseSymbol);
  if (yahooPeers && yahooPeers.length > 0) {
    setPeerCache(uppercaseSymbol, yahooPeers);
    return yahooPeers;
  }

  // SOURCE 3: EODHD
  if (!isUsStock) {
    const eodhdPeers = await getEodhdPeers(uppercaseSymbol);
    if (eodhdPeers && eodhdPeers.length > 0) {
      setPeerCache(uppercaseSymbol, eodhdPeers);
      return eodhdPeers;
    }
  }

  return null;
}

async function getFinvizPeers(symbol: string): Promise<string[] | null> {
  try {
    const res = await fetch(`https://finviz.com/quote.ashx?t=${symbol}`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!res.ok) return null;
    const text = await res.text();
    
    // We attempt to parse out the ticker symbols from the Finviz "Similar Stocks" or related links.
    // They are often in links like quote.ashx?t=AAPL
    const peers: string[] = [];
    const regex = /quote\.ashx\?t=([A-Z]+)/g;
    let match;
    let limit = 0;
    while ((match = regex.exec(text)) !== null) {
      const ticker = match[1];
      if (ticker === symbol) continue;
      if (!peers.includes(ticker)) {
        peers.push(ticker);
        limit++;
      }
      if (limit >= 20) break; 
    }
    
    if (peers.length > 0) {
        return peers.slice(0, 8);
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function getYahooPeers(symbol: string): Promise<string[] | null> {
  try {
    const res = await fetch(`https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/${symbol}`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!res.ok) return null;
    const body = await res.json();
    const recommendedSymbols = body?.finance?.result?.[0]?.recommendedSymbols;
    if (recommendedSymbols && Array.isArray(recommendedSymbols)) {
       return recommendedSymbols
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .map(r => r.symbol)
          .slice(0, 6);
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function getEodhdPeers(symbol: string): Promise<string[] | null> {
  try {
    const key = process.env.EODHD_API_KEY;
    if (!key) return null;
    
    // EODHD's symbol format usually uses "." for exchange, which is what we used for checking isUsStock
    const res = await fetch(`https://eodhd.com/api/fundamentals/${symbol}?api_token=${key}&filter=General`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!res.ok) return null;
    const data = await res.json();
    
    // Returns null as it's a best-effort proxy 
    return null;
  } catch (err) {
    return null;
  }
}
