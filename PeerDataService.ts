import { getPeerCache, setPeerCache, getCachedCompetitorMap } from "./db";

const COMPETITOR_MAP_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days, mirrors getCompetitorMap's TTL

export async function getTopPeers(symbol: string): Promise<string[] | null> {
  const uppercaseSymbol = symbol.toUpperCase().trim();

  const cached = getPeerCache(uppercaseSymbol);
  if (cached) return cached;

  // SOURCE 1: competitor_maps table — already populated by the CompetitorsPanel's getCompetitorMap, no Gemini call needed
  const competitorMap = getCachedCompetitorMap(uppercaseSymbol);
  if (competitorMap) {
    const fetchedDate = new Date(competitorMap.fetchedAt).getTime();
    if (Date.now() - fetchedDate < COMPETITOR_MAP_TTL_MS) {
      const symbols = competitorMap.map.map((c: any) => c.symbol).filter(Boolean);
      if (symbols.length > 0) {
        setPeerCache(uppercaseSymbol, symbols);
        return symbols;
      }
    }
  }

  // SOURCE 2: FMP stock peers
  const fmpPeers = await getFmpPeers(uppercaseSymbol);
  if (fmpPeers && fmpPeers.length > 0) {
    setPeerCache(uppercaseSymbol, fmpPeers);
    return fmpPeers;
  }

  return null;
}

async function getFmpPeers(symbol: string): Promise<string[] | null> {
  try {
    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) return null;

    const res = await fetch(`https://financialmodelingprep.com/api/v4/stock_peers?symbol=${symbol}&apikey=${apiKey}`);
    if (!res.ok) return null;

    const data: any = await res.json();
    const entry = Array.isArray(data) ? data[0] : data;
    const peersList = entry?.peersList;
    if (Array.isArray(peersList) && peersList.length > 0) {
      return peersList.slice(0, 5);
    }
    return null;
  } catch (err) {
    return null;
  }
}
