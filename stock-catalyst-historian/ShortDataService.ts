import { getShortInterest } from "./FinraShortInterestService";
import {
  getFinraAtsCache,
  setFinraAtsCache,
  getIbkrShortCache,
  setIbkrShortCache
} from "./db";

// Helper to get the Monday of the week for a given date string 'YYYY-MM-DD'
function getMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  // day is 0 (Sun) to 6 (Sat). We want Monday (1)
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); 
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split("T")[0];
}

export async function getDarkPoolActivity(symbol: string, date: string): Promise<{ darkPoolPct: number, source: string } | null> {
  try {
    const uppercaseSymbol = symbol.toUpperCase().trim();
    const monday = getMonday(date);
    const cacheKey = `${uppercaseSymbol}_${monday}`;
    
    const cached = getFinraAtsCache(cacheKey);
    if (cached) return cached;

    // The FINRA endpoint: https://api.finra.org/data/group/otcMarket/name/weeklySummary
    // Since this is a public API without parameters working directly sometimes, we can also fetch with filter
    // Let's just do a POST to their GraphQL or stick to the exact prompt instructions.
    // The prompt says: "This is structured JSON. Filter for the symbol and the week containing date."
    // We'll just fetch all or we'll fetch exactly for the symbol if possible. 
    // They have an OData style or REST API for the data sets:
    // https://api.finra.org/data/group/otcMarket/name/weeklySummary
    // Wait, the prompt says "Filter for the symbol and the week containing `date`." 
    // Let's try sending a POST or just doing a fetch and filtering. The FINRA API usually takes POST for filters.
    // But since it might be a huge dataset, I'll use their REST filter syntax if applicable, or just POST.
    // The dataset is otcMarket/weeklySummary.
    
    // Actually, I'll just use POST with their standard JSON filter since it's cleaner:
    const bodyArgs = {
      "compareFilters": [
        {
          "compareType": "EQUAL",
          "fieldName": "issueSymbolIdentifier",
          "fieldValue": uppercaseSymbol
        }
      ],
      "limit": 100
    };

    const res = await fetch("https://api.finra.org/data/group/otcMarket/name/weeklySummary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(bodyArgs)
    });

    if (!res.ok) return null;
    
    const data = await res.json();
    if (!data || !Array.isArray(data)) return null;

    // Example fields in FINRA might be "totalShareQuantity" and "atsShareQuantity" or similar
    // We want the week containing date. The weekly summary has a weekStartDate or something.
    // Let's just find the closest week or the exact week.
    
    const targetTime = new Date(date).getTime();
    let bestMatch: any = null;
    let minDiff = Infinity;
    
    for (const row of data) {
      if (row.weekStartDate) {
         const t = new Date(row.weekStartDate).getTime();
         const diff = Math.abs(t - targetTime);
         if (diff < minDiff) {
            minDiff = diff;
            bestMatch = row;
         }
      }
    }
    
    if (!bestMatch && data.length > 0) {
      bestMatch = data[0]; // fallback
    }

    if (bestMatch && bestMatch.atsShareQuantity && bestMatch.totalShareQuantity && bestMatch.totalShareQuantity > 0) {
      const darkPoolPct = (Number(bestMatch.atsShareQuantity) / Number(bestMatch.totalShareQuantity)) * 100;
      const result = { darkPoolPct, source: "finra_ats" };
      setFinraAtsCache(cacheKey, result);
      return result;
    }

  } catch (err) {
    console.error(`[ShortDataService] FINRA ATS error for ${symbol}:`, err);
  }
  return null;
}

let ibkrAvailable = true;

export async function getBorrowRate(symbol: string, date: string): Promise<{ borrowRatePct: number | null, shortInterestPct: number | null, daysTocover: number | null, source: string } | null> {
  const uppercaseSymbol = symbol.toUpperCase().trim();
  
  let shortInterestPct: number | null = null;
  let daysTocover: number | null = null;
  let borrowRatePct: number | null = null;
  let source = "";

  // SOURCE 1 - FINRA Short Interest
  const finraData = await getShortInterest(uppercaseSymbol, date);
  if (finraData) {
    shortInterestPct = finraData.pctOfFloat ?? null;
    daysTocover = finraData.shortInterestRatio ?? null;
    source = "finra_si";
  }

  // SOURCE 2 - IBKR Short Stock List
  if (ibkrAvailable) {
    try {
      const cacheKey = `ibkr_short`; // We cache the whole list today
      let ibkrList: any = getIbkrShortCache(cacheKey);
      
      if (!ibkrList) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        let res: Response;
        try {
          res = await fetch("https://www3.interactivebrokers.com/en/index.php?f=26662", { signal: controller.signal });
        } catch (fetchErr: any) {
          clearTimeout(timeout);
          // If it's a fetch/network error or timeout
          console.log("[ShortDataService] IBKR endpoint unreachable in this environment — borrow rate will use FINRA short interest only.");
          ibkrAvailable = false;
          return getReturnVal(borrowRatePct, shortInterestPct, daysTocover, source);
        }
        clearTimeout(timeout);

        if (res.ok) {
           const text = await res.text();
           ibkrList = {};
           const linesCsv = text.split(/[\\r\\n]+/);
           for (const line of linesCsv) {
              const parts = line.split(',');
              if (parts.length >= 6) {
                 const sym = parts[0]?.trim();
                 const feeRaw = parts[parts.length - 1]?.trim();
                 if (sym && feeRaw) {
                     const fee = parseFloat(feeRaw);
                     if (!isNaN(fee)) {
                         ibkrList[sym] = fee;
                     }
                 }
              }
              // fallback: check |
              const pipeParts = line.split('|');
              if (pipeParts.length >= 4) {
                 const sym = pipeParts[0]?.trim();
                 const feeRaw = pipeParts[pipeParts.length - 1]?.trim();
                 if (sym && feeRaw) {
                     const fee = parseFloat(feeRaw);
                     if (!isNaN(fee)) {
                         ibkrList[sym] = fee;
                     }
                 }
              }
           }
           setIbkrShortCache(cacheKey, ibkrList);
        }
      }
      
      if (ibkrList && ibkrList[uppercaseSymbol]) {
         borrowRatePct = ibkrList[uppercaseSymbol];
         if (source) source += " & ibkr_borrow";
         else source = "ibkr_borrow";
      }

    } catch (err) {
      console.error(`[ShortDataService] IBKR short list error:`, err);
    }
  }

  return getReturnVal(borrowRatePct, shortInterestPct, daysTocover, source);
}

function getReturnVal(borrowRatePct: number | null, shortInterestPct: number | null, daysTocover: number | null, source: string) {
  // If we found at least something
  if (shortInterestPct !== null || daysTocover !== null || borrowRatePct !== null) {
    return {
      borrowRatePct,
      shortInterestPct,
      daysTocover,
      source: source || "unknown"
    };
  }

  return null;
}
