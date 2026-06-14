import { db } from './db';

interface FinraShortInterestRecord {
  symbol: string;
  settlement_date: string;
  short_interest_shares: number;
  short_interest_ratio: number;
  pct_of_float: number;
  fetched_at: number;
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function getShortInterest(
  symbol: string,
  date: string
): Promise<{
  shortInterestShares: number;
  shortInterestRatio: number | null;
  pctOfFloat: number;
  settlementDate: string;
  source: "finra" | "yahoo";
} | null> {
  const uppercaseSymbol = symbol.toUpperCase().trim();

  // Check local database cache first
  try {
    const stmt = db.prepare(`
      SELECT * FROM finra_short_interest
      WHERE symbol = ? AND settlement_date <= ?
      ORDER BY settlement_date DESC
      LIMIT 1
    `);

    const cached = stmt.get(uppercaseSymbol, date) as FinraShortInterestRecord | undefined;
    if (cached) {
      const now = Date.now();
      if (now - cached.fetched_at < CACHE_TTL_MS) {
        return {
          shortInterestShares: cached.short_interest_shares,
          shortInterestRatio: cached.short_interest_ratio,
          pctOfFloat: cached.pct_of_float,
          settlementDate: cached.settlement_date,
          source: "finra"
        };
      }
    }
  } catch (error) {
    // Cache lookup failure shouldn't block the fallback attempts below
  }

  // Primary: FINRA point-in-time data (historical settlement dates).
  // FINRA has no simple public REST endpoint, so this attempt commonly fails —
  // any failure falls through to the Yahoo fallback below.
  try {
    const url = `https://query.finra.org/FINRA/FINRA/eqs/data?symbol=${uppercaseSymbol}&date=${date}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`FINRA API failed with status ${res.status}`);
    }

    const data = await res.json();
    if (!data || !data.shortInterest) {
      throw new Error("No short interest data found in response");
    }

    const results = {
      shortInterestShares: Number(data.shortInterestShares) || 0,
      shortInterestRatio: Number(data.shortInterestRatio) || 0,
      pctOfFloat: Number(data.pctOfFloat) || 0,
      settlementDate: data.settlementDate || date,
      source: "finra" as const
    };

    // Cache it
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO finra_short_interest (
        symbol, settlement_date, short_interest_shares, short_interest_ratio, pct_of_float, fetched_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertStmt.run(
      uppercaseSymbol,
      results.settlementDate,
      results.shortInterestShares,
      results.shortInterestRatio,
      results.pctOfFloat,
      Date.now()
    );

    return results;
  } catch (error) {
    // fall through to Yahoo fallback
  }

  // Fallback: current short interest snapshot from Yahoo Finance.
  // This is "current" data (not point-in-time), so it's only a rough proxy
  // for historical events but is better than no signal at all.
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(uppercaseSymbol)}?modules=defaultKeyStatistics`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await res.json();
    const stats = data?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
    const sharesShort = stats?.sharesShort?.raw;
    const floatShares = stats?.floatShares?.raw;
    if (sharesShort && floatShares && floatShares > 0) {
      return {
        shortInterestShares: sharesShort,
        shortInterestRatio: stats?.shortRatio?.raw ?? null,
        pctOfFloat: sharesShort / floatShares,
        settlementDate: new Date().toISOString().split('T')[0],
        source: 'yahoo'
      };
    }
  } catch (error) {
    // fall through to null sentinel
  }

  // No data from any source — write null sentinel
  return null;
}

export async function getShortInterestVelocity(
  symbol: string,
  date: string
): Promise<number | null> {
  try {
    const uppercaseSymbol = symbol.toUpperCase().trim();
    
    // We need the two most recent records before the given date
    const stmt = db.prepare(`
      SELECT * FROM finra_short_interest 
      WHERE symbol = ? AND settlement_date <= ?
      ORDER BY settlement_date DESC 
      LIMIT 2
    `);
    
    const records = stmt.all(uppercaseSymbol, date) as FinraShortInterestRecord[];
    
    if (records.length < 2) {
      // If we don't have enough history in our cache, we would theoretically fetch more from FINRA.
      // For this degradation pattern, we'll return null if not cached.
      return null;
    }
    
    const current = records[0];
    const previous = records[1];
    
    if (previous.short_interest_shares === 0) {
      return null;
    }
    
    const velocityPct = ((current.short_interest_shares - previous.short_interest_shares) / previous.short_interest_shares) * 100;
    return Math.round(velocityPct * 100) / 100; // Round to 2 decimal places
    
  } catch (error) {
    return null;
  }
}
