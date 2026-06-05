import { EdgarFiling, InsiderTransaction } from "./src/types";
import { 
  getCachedCik, 
  setCachedCik, 
  insertEdgarFilings, 
  getEdgarFilings, 
  insertInsiderTransactions, 
  getInsiderTransactionsFromDb 
} from "./db";
import { logFetch } from "./DataSourceRegistry";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const USER_AGENT = "MarketEcosystemIntelligence lewispiper1993@gmail.com";

function logEdgarFetch(dataType: string, symbol: string, success: boolean, recordCount: number, errorMsg?: string, latencyMs?: number) {
  try {
    logFetch({
      sourceId: "edgar",
      sourceName: "SEC EDGAR",
      dataType,
      symbol,
      fetchedAt: new Date().toISOString(),
      success,
      recordCount,
      errorMessage: errorMsg,
      latencyMs,
      isFallback: false
    });
  } catch (err) {
    console.error("Failed to log EDGAR fetch to DataSourceRegistry:", err);
  }
}

/**
 * Sub-task B: Lookup CIK for ticker symbol from Cache or SEC search
 */
export async function lookupCompanyCik(symbol: string): Promise<string | null> {
  const uppercaseSymbol = symbol.trim().toUpperCase();
  if (!uppercaseSymbol) return null;

  // 1. Check SQLite Cache
  try {
    const cached = getCachedCik(uppercaseSymbol);
    if (cached) {
      const cachedDate = new Date(cached.cachedAt);
      const diffDays = (Date.now() - cachedDate.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays < 90) {
        return cached.cik;
      }
    }
  } catch (err) {
    console.error("[EDGAR] Error checking CIK cache:", err);
  }

  // 2. Query EDGAR search index
  const url = `https://efts.sec.gov/LATEST/search-index?q=%22${uppercaseSymbol}%22&dateRange=custom&startdt=2020-01-01&forms=10-K`;
  const startTime = Date.now();
  await sleep(150);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Encoding": "gzip, deflate"
      }
    });

    const latency = Date.now() - startTime;
    if (!response.ok) {
      logEdgarFetch("fundamentals", uppercaseSymbol, false, 0, `HTTP ${response.status}: ${response.statusText}`, latency);
      return null;
    }

    const data: any = await response.json();
    const hits = data.hits?.hits || [];

    let finalCik: string | null = null;
    let fallbackCik: string | null = null;
    let companyName = uppercaseSymbol;

    for (const h of hits) {
      const source = h._source;
      if (!source) continue;

      let tickers: string[] = [];
      if (typeof source.tickers === "string") {
        tickers = source.tickers.toUpperCase().split(/\s+/).map(t => t.trim());
      } else if (Array.isArray(source.tickers)) {
        tickers = source.tickers.map(t => String(t).toUpperCase().trim());
      }

      let rawCik = "";
      if (Array.isArray(source.ciks) && source.ciks.length > 0) {
        rawCik = String(source.ciks[0]);
      } else if (source.cik) {
        rawCik = String(source.cik);
      } else if (typeof source.ciks === "string") {
        rawCik = source.ciks;
      }

      if (rawCik) {
        const parsedCik = String(parseInt(rawCik, 10));
        if (tickers.includes(uppercaseSymbol)) {
          finalCik = parsedCik;
          if (Array.isArray(source.display_names) && source.display_names.length > 0) {
            companyName = String(source.display_names[0]);
          }
          break;
        } else if (!fallbackCik) {
          fallbackCik = parsedCik;
          if (Array.isArray(source.display_names) && source.display_names.length > 0) {
            companyName = String(source.display_names[0]);
          }
        }
      }
    }

    const cikToUse = finalCik || fallbackCik;
    if (cikToUse) {
      setCachedCik(uppercaseSymbol, cikToUse, companyName);
      logEdgarFetch("fundamentals", uppercaseSymbol, true, 1, undefined, latency);
      return cikToUse;
    }

    logEdgarFetch("fundamentals", uppercaseSymbol, true, 0, "Ticker search returned hits but no usable CIK match", latency);
    return null;
  } catch (error: any) {
    const latency = Date.now() - startTime;
    console.error(`[EDGAR] CIK look up failed for ${uppercaseSymbol}:`, error);
    logEdgarFetch("fundamentals", uppercaseSymbol, false, 0, error.message || String(error), latency);
    return null;
  }
}

/**
 * Parse descriptions of the 8-K document from the raw directory HTML
 */
async function fetch8KDocumentDescription(cik: string, accessionNoDashes: string, primaryDoc: string, itemsStr?: string): Promise<string> {
  const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDashes}/`;
  await sleep(150);

  let defaultDesc = "8-K Current Report";
  
  // Create friendly items details string
  let itemDetails = "";
  if (itemsStr) {
    const items = itemsStr.split(',').map(i => i.trim()).filter(Boolean);
    const friendlyItems = items.map(item => {
      switch (item) {
        case "1.01": return "Material Definitive Agreement";
        case "1.02": return "Termination of Material Agreement";
        case "2.01": return "Acquisition/Disposition of Assets";
        case "2.02": return "Earnings Release / Financial Results";
        case "2.03": return "Creation of Financial Obligation";
        case "2.04": return "Acceleration of Obligation";
        case "2.05": return "Restructuring/Exit Costs";
        case "2.06": return "Material Impairments";
        case "3.01": return "Delisting Notice / Failure to Satisfy Listing Standard";
        case "3.02": return "Unregistered Sale of Securities";
        case "3.03": return "Modification of Rights of Security Holders";
        case "4.01": return "Change in Auditor";
        case "5.01": return "Changes in Control";
        case "5.02": return "Director/Officer Departure/Appointment";
        case "5.03": return "Articles of Incorporation Amendments";
        case "7.01": return "Regulation FD Disclosure";
        case "8.01": return "Other Material Events / General Disclosure";
        case "9.01": return "Financial Statements and Exhibits";
        default: return `Item ${item}`;
      }
    });
    if (friendlyItems.length > 0) {
      itemDetails = ` (Items: ${friendlyItems.join(', ')})`;
    }
  }

  try {
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) {
      return defaultDesc + itemDetails;
    }
    const html = await response.text();
    
    // Parse table rows in file table list
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    let parsedDescription = "";

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const rowContent = rowMatch[1];
      if (rowContent.toLowerCase().includes(primaryDoc.toLowerCase())) {
        const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        const tds: string[] = [];
        let tdMatch;
        while ((tdMatch = tdRegex.exec(rowContent)) !== null) {
          tds.push(tdMatch[1].replace(/<[^>]*>/g, '').trim());
        }
        if (tds.length >= 2) {
          parsedDescription = tds[1];
          break;
        }
      }
    }

    if (parsedDescription && parsedDescription !== primaryDoc) {
      return parsedDescription + itemDetails;
    }

    return defaultDesc + itemDetails;
  } catch (error) {
    console.error(`[EDGAR] Failed to scrape document description for ${primaryDoc}:`, error);
    return defaultDesc + itemDetails;
  }
}

/**
 * Sub-task C: Fetch recent filings of selected types
 */
export async function getRecentFilings(
  symbol: string,
  fromDate: string,
  toDate: string,
  formTypes: string[] = ["8-K", "10-K", "10-Q", "SC 13G", "SC 13D"]
): Promise<EdgarFiling[]> {
  const uppercaseSymbol = symbol.trim().toUpperCase();

  // 1. Try DB Query Cache first
  try {
    const cached = getEdgarFilings(uppercaseSymbol, fromDate, toDate, formTypes);
    if (cached.length > 0) {
      return cached.sort((a, b) => b.filedAt.localeCompare(a.filedAt));
    }
  } catch (err) {
    console.error("[EDGAR] Error querying filings cache:", err);
  }

  // 2. Fetch CIK
  const cik = await lookupCompanyCik(uppercaseSymbol);
  if (!cik) {
    console.warn(`[EDGAR] No CIK found for ticker ${uppercaseSymbol}. Returning empty filings list.`);
    return [];
  }

  const paddedCik = cik.padStart(10, '0');
  const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;
  const startTime = Date.now();
  await sleep(150);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Encoding": "gzip, deflate"
      }
    });

    const latency = Date.now() - startTime;
    if (!response.ok) {
      logEdgarFetch("filings", uppercaseSymbol, false, 0, `HTTP ${response.status}: ${response.statusText}`, latency);
      return [];
    }

    const data: any = await response.json();
    const recent = data.filings?.recent;
    if (!recent || !Array.isArray(recent.form)) {
      logEdgarFetch("filings", uppercaseSymbol, true, 0, "No recent filings key discovered inside submissions", latency);
      return [];
    }

    const length = recent.form.length;
    const zippedFilings: EdgarFiling[] = [];

    for (let i = 0; i < length; i++) {
      const form = recent.form[i];
      const filedAt = recent.filingDate[i];

      // Filter by form types and date range range (inclusive)
      if (!formTypes.includes(form)) continue;
      if (filedAt < fromDate || filedAt > toDate) continue;

      const accessionNumber = recent.accessionNumber[i];
      const primaryDocument = recent.primaryDocument[i];
      const accessionNoDashes = accessionNumber.replace(/-/g, '');
      const docDescription = recent.primaryDocumentDescription?.[i] || `${form} Filing`;
      const itemsStr = recent.items?.[i] || "";

      const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDashes}/${primaryDocument}`;

      zippedFilings.push({
        accessionNumber,
        filedAt,
        form,
        primaryDocument,
        description: docDescription,
        filingUrl,
        issuingCik: cik,
        symbol: uppercaseSymbol
      });
    }

    // Specially backfill 8-K filing descriptions by querying their indexes
    const results: EdgarFiling[] = [];
    for (const filing of zippedFilings) {
      if (filing.form === "8-K") {
        const noDashes = filing.accessionNumber.replace(/-/g, '');
        // Find matching raw index files to get document description
        const itemsList = data.filings?.recent?.items?.[recent.accessionNumber.indexOf(filing.accessionNumber)] || "";
        const detailedDesc = await fetch8KDocumentDescription(cik, noDashes, filing.primaryDocument, itemsList);
        filing.description = detailedDesc;
      }
      results.push(filing);
    }

    // Save fetched results to local db cache
    if (results.length > 0) {
      insertEdgarFilings(results);
    }

    logEdgarFetch("filings", uppercaseSymbol, true, results.length, undefined, latency);
    return results.sort((a, b) => b.filedAt.localeCompare(a.filedAt));
  } catch (error: any) {
    const latency = Date.now() - startTime;
    console.error(`[EDGAR] Filings fetch failed for ${uppercaseSymbol}:`, error);
    logEdgarFetch("filings", uppercaseSymbol, false, 0, error.message || String(error), latency);
    return [];
  }
}

/**
 * Sub-task D: Fetch and parse verified insider Form 4 transactions
 */
export async function getInsiderTransactions(
  symbol: string,
  fromDate: string,
  toDate: string
): Promise<InsiderTransaction[]> {
  const uppercaseSymbol = symbol.trim().toUpperCase();

  // 1. Try DB Query Cache first
  try {
    const cached = getInsiderTransactionsFromDb(uppercaseSymbol, fromDate, toDate);
    if (cached.length > 0) {
      return cached.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
    }
  } catch (err) {
    console.error("[EDGAR] Error querying insider transactions cache:", err);
  }

  // 2. Resolve CIK first
  const cik = await lookupCompanyCik(uppercaseSymbol);
  if (!cik) {
    console.warn(`[EDGAR] CIK lookup failed for ticker ${uppercaseSymbol}. Returning empty insider transactions list.`);
    return [];
  }

  // 3. Search EFTS search-index for Form 4 filings
  const url = `https://efts.sec.gov/LATEST/search-index?q=%22${uppercaseSymbol}%22&forms=4&dateRange=custom&startdt=${fromDate}&enddt=${toDate}`;
  const startTime = Date.now();
  await sleep(150);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Encoding": "gzip, deflate"
      }
    });

    const latency = Date.now() - startTime;
    if (!response.ok) {
      logEdgarFetch("insider", uppercaseSymbol, false, 0, `HTTP ${response.status}: ${response.statusText}`, latency);
      return [];
    }

    const data: any = await response.json();
    const hits = data.hits?.hits || [];
    const recentHits = hits.slice(0, 20); // Limit to 20 most recent

    const allTransactions: InsiderTransaction[] = [];

    for (const h of recentHits) {
      const source = h._source;
      if (!source) continue;

      let accessionNumber = "";
      let primaryDocument = "";

      if (h._id && h._id.includes(':')) {
        const parts = h._id.split(':');
        accessionNumber = parts[0];
        primaryDocument = parts[1];
      } else {
        accessionNumber = source.adsh || h._id;
        primaryDocument = source.primary_doc_id || "form4.xml";
      }

      if (!accessionNumber || !primaryDocument) continue;

      // Extract details from xml
      const accessionNoDashes = accessionNumber.replace(/-/g, '');
      const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDashes}/${primaryDocument}`;
      
      await sleep(150);
      try {
        const xmlResponse = await fetch(xmlUrl, { headers: { "User-Agent": USER_AGENT } });
        if (!xmlResponse.ok) continue;

        const xml = await xmlResponse.text();

        // Parse Reporting Owner Name
        const ownerMatch = xml.match(/<rptOwnerName>([^<]+)<\/rptOwnerName>/i);
        const executiveName = ownerMatch ? ownerMatch[1].trim() : "Unknown Insider";

        // Parse Officer Title
        const titleMatch = xml.match(/<officerTitle>([^<]+)<\/officerTitle>/i) || xml.match(/<officerTitle>\s*<value>([^<]+)<\/value>/i);
        let executiveRole = titleMatch ? titleMatch[1].trim() : "";
        if (!executiveRole) {
          if (xml.toLowerCase().includes("<isdirector>true</isdirector>") || xml.toLowerCase().includes("<isdirector>1</isdirector>")) {
            executiveRole = "Director";
          } else if (xml.toLowerCase().includes("<isofficer>true</isofficer>") || xml.toLowerCase().includes("<isofficer>1</isofficer>")) {
            executiveRole = "Officer";
          } else {
            executiveRole = "Beneficial Owner";
          }
        }

        // Parse individual transaction blocks inside the filing xml
        const txBlocks = xml.match(/<(?:nonDerivativeTransaction|derivativeTransaction)>[\s\S]*?<\/(?:nonDerivativeTransaction|derivativeTransaction)>/gi) || [];
        const filingTransactions: InsiderTransaction[] = [];

        // Parse file date from XML (signature date / period of report) or fallback to hit's file date
        const periodMatch = xml.match(/<periodOfReport>\s*<value>([^<]+)<\/value>/i) || xml.match(/<periodOfReport>([^<]+)<\/periodOfReport>/i);
        const reportDateValue = periodMatch ? periodMatch[1].trim() : (source.file_date || fromDate);

        for (const block of txBlocks) {
          const dateMatch = block.match(/<transactionDate>\s*<value>([^<]+)<\/value>/i) || block.match(/<transactionDate>([^<]+)<\/transactionDate>/i);
          const transactionDate = dateMatch ? dateMatch[1].trim() : reportDateValue;

          const typeMatch = block.match(/<transactionCode>([^<]+)<\/transactionCode>/i);
          const transactionType = typeMatch ? typeMatch[1].trim() : "P"; // Purchase default

          const sharesMatch = block.match(/<transactionShares>\s*<value>([^<]+)<\/value>/i);
          const shares = sharesMatch ? parseFloat(sharesMatch[1]) : 0;

          const priceMatch = block.match(/<transactionPricePerShare>\s*<value>([^<]+)<\/value>/i);
          const pricePerShare = priceMatch ? parseFloat(priceMatch[1]) : 0;

          const ownedAfterMatch = block.match(/<sharesOwnedFollowingTransaction>\s*<value>([^<]+)<\/value>/i);
          const sharesOwnedAfter = ownedAfterMatch ? parseFloat(ownedAfterMatch[1]) : 0;

          const directMatch = block.match(/<directOrIndirectOwnership>\s*<value>([^<]+)<\/value>/i);
          const directVal = directMatch ? directMatch[1].trim() : "D";
          const isDirectOwnership = directVal.toUpperCase() === "D";

          const totalValue = shares * pricePerShare;

          filingTransactions.push({
            filedAt: source.file_date || reportDateValue,
            executiveName,
            executiveRole,
            transactionDate,
            transactionType,
            shares,
            pricePerShare,
            totalValue,
            sharesOwnedAfter,
            isDirectOwnership,
            symbol: uppercaseSymbol,
            filingUrl: xmlUrl,
            source: "edgar"
          });
        }

        if (filingTransactions.length > 0) {
          allTransactions.push(...filingTransactions);
          // Insert into SQL cache
          insertInsiderTransactions(filingTransactions, accessionNumber);
        }
      } catch (xmlErr) {
        console.error(`[EDGAR] Failed to parse Form 4 XML: ${xmlUrl}`, xmlErr);
      }
    }

    logEdgarFetch("insider", uppercaseSymbol, true, allTransactions.length, undefined, latency);
    return allTransactions.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
  } catch (error: any) {
    const latency = Date.now() - startTime;
    console.error(`[EDGAR] Insider transactions search failed for ${uppercaseSymbol}:`, error);
    logEdgarFetch("insider", uppercaseSymbol, false, 0, error.message || String(error), latency);
    return [];
  }
}
