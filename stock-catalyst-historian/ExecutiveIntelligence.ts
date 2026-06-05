/*
EXECUTIVE INTELLIGENCE MODULE — ETHICAL USE GUIDELINES
This module searches for publicly reported personal news about named corporate
executives for the purpose of financial materiality assessment. It operates 
exclusively on information that has been reported by credible news sources, 
regulatory filings (SEC EDGAR), or the executives' own public social media 
accounts. It does not access private information, conduct surveillance, or 
aggregate personal data beyond what is publicly available in the financial press.
All findings are assessed for materiality to the company's stock price — 
personal information that has no plausible financial relevance is filtered out.
Unverified information is clearly labeled as such throughout.
*/

export * from "./src/types";
import { GoogleGenAI, Type } from "@google/genai";
import { ExecutiveProfile, ExecutiveEvent, CompetitorEvent, MarketRegime, ExecutiveIntelligenceReport } from "./src/types";
import { getCachedRoster, setCachedRoster, getCachedCompetitorMap, setCachedCompetitorMap } from "./db";
import { getInsiderTransactions } from "./EdgarService";
import { detectWikipediaSpike } from "./WikipediaService";
import { extractAndParseJson } from "./src/JsonParser";
import { WikipediaTrafficSignal } from "./src/types";

let aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is missing. Configure it in the Settings > Secrets panel.");
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

export async function getExecutiveRoster(
  symbol: string,
  companyName: string
): Promise<ExecutiveProfile[]> {
  const cached = getCachedRoster(symbol);
  if (cached) {
    const fetchedDate = new Date(cached.fetchedAt).getTime();
    const now = Date.now();
    // 30 days in ms = 30 * 24 * 60 * 60 * 1000 = 2592000000
    if (now - fetchedDate < 2592000000) {
      return cached.roster;
    }
  }

  const ai = getAIClient();
  const prompt = `Search for the current senior executive team of ${companyName} (${symbol}). 
Find the full names, titles, and any known public social media presence of:
the CEO, CFO, COO, CTO, Chairman or Executive Chairman, President (if separate 
from CEO), and any other C-suite officers or board members who are particularly
prominent or frequently in the news. For each person found, also note any known
political connections, major board memberships at other companies, or significant
personal relationships with other business leaders that are a matter of public record.

Return results as a JSON array of objects with fields: name, role, twitterHandle
(if publicly known), knownPoliticalConnections (array of strings, names only),
knownBusinessConnections (array of strings, brief descriptions).`;

  let rawText = "[]";
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        tools: [{ googleSearch: {} }],
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              role: { type: Type.STRING },
              twitterHandle: { type: Type.STRING },
              knownPoliticalConnections: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              knownBusinessConnections: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["name", "role"]
          }
        }
      }
    });
    rawText = response.text || "[]";
  } catch (error: any) {
    if (error?.status === 429 || String(error).includes("429") || String(error).includes("credits are depleted") || String(error).includes("spending cap") || String(error).includes("quota")) {
      console.warn("Returning empty roster due to rate limit/quota.");
      return [];
    }
    console.error("[EXEC-INTEL] Failed to fetch executive roster from Gemini:", error.message || error);
  }

  let rosterRaw = [];
  try {
    rosterRaw = extractAndParseJson(rawText);
  } catch (e) {
    console.error("Failed to parse Gemini roster response:", e);
    rosterRaw = [];
  }

  const roleWeightMapping = (role: string): number => {
    const r = role.toLowerCase();
    if (r.includes("ceo") || r.includes("chief executive") || r.includes("managing director")) return 1.0;
    if (r.includes("cfo") || r.includes("chief financial")) return 0.9;
    if (r.includes("chairman") || r.includes("executive chair")) return 0.9;
    if (r.includes("coo") || r.includes("chief operating") || r.includes("president")) return 0.85;
    if (r.includes("cto") || r.includes("chief technology")) return 0.8;
    if (r.includes("cro") || r.includes("chief revenue")) return 0.75;
    if (r.includes("chief")) return 0.7;
    if (r.includes("vp ") || r.includes("vice president")) return 0.4;
    if (r.includes("director")) return 0.25;
    return 0.2;
  };

  const roster: ExecutiveProfile[] = rosterRaw.map((item: any) => ({
    name: item.name,
    role: item.role,
    roleWeight: roleWeightMapping(item.role),
    twitterHandle: item.twitterHandle,
    knownPoliticalConnections: item.knownPoliticalConnections,
    knownBusinessConnections: item.knownBusinessConnections
  }));

  setCachedRoster(symbol, roster);

  const roles = roster.map(r => r.role).join(", ");
  console.log(`[EXEC-INTEL] ${symbol} roster: found ${roster.length} executives (${roles})`);

  return roster;
}

export async function scanExecutiveNews(
  symbol: string,
  companyName: string,
  executives: ExecutiveProfile[],
  startDate: string,
  endDate: string
): Promise<ExecutiveEvent[]> {
  const allEvents: ExecutiveEvent[] = [];
  const ai = getAIClient();

  for (let i = 0; i < executives.length; i++) {
    const exec = executives[i];

    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const prompt = `You are an executive intelligence analyst. Search specifically for personal news about ${exec.name}, ${exec.role} of ${companyName} (${symbol}), between ${startDate} and ${endDate}.

Focus your search on the following specific categories — do NOT report routine business announcements or earnings calls, as those are covered separately:

1. LEGAL & REGULATORY: Any lawsuits filed against them personally, arrests, investigations, SEC inquiries, restraining orders, court appearances, or criminal/civil proceedings.
   
2. SOCIAL MEDIA & PUBLIC STATEMENTS: Any controversial posts, deleted tweets, public arguments, offensive statements, or notable social media activity that generated significant public reaction. Search Twitter/X, LinkedIn, and news coverage of their social media activity.
   
3. POLITICAL CONNECTIONS: Meetings with politicians, senators, regulators, government officials, or political donors. Campaign contributions. Appearances at political events. Lobbying activity.
   
4. PERSONAL RELATIONSHIPS & MEETINGS: High-profile dinners, social events with other business leaders, private equity contacts, investment bankers, or competitor executives. Any relationship news that entered the public domain.
   
5. HEALTH & PERSONAL: Any health-related news that entered the public domain. Personal crises that were publicly reported.
   
6. INSIDER TRANSACTIONS: DO NOT SEARCH OR RETURN INSIDER TRANSACTIONS IN THIS BATCH. They are handled separately.
   
7. DEPARTURE SIGNALS: Any public statements hinting at resignation, retirement, reduced involvement, or dissatisfaction with the company's direction.

For each finding, assess: is this information verifiably reported by at least one credible source, or is it rumour/speculation? 

Return a JSON array. Each item should have: eventType (from the categories above, as a snake_case string, but excluding insider_transactions), eventSeverity (low/moderate/high/critical), headline (one sentence), detail (2-3 sentences with specifics), isVerified (boolean), sourceDescription (name of source, e.g. 'Reuters', 'Bloomberg'), potentialDirection (bullish/bearish/neutral/uncertain), and stockRelevanceReason (one sentence explaining why this specifically could affect ${symbol}'s stock price).

If no relevant personal news is found in any category, return an empty array.`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          tools: [{ googleSearch: {} }],
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                eventType: { type: Type.STRING },
                eventSeverity: { type: Type.STRING },
                headline: { type: Type.STRING },
                detail: { type: Type.STRING },
                isVerified: { type: Type.BOOLEAN },
                sourceDescription: { type: Type.STRING },
                potentialDirection: { type: Type.STRING },
                stockRelevanceReason: { type: Type.STRING }
              },
              required: ["eventType", "eventSeverity", "headline", "detail", "isVerified", "sourceDescription", "potentialDirection", "stockRelevanceReason"]
            }
          }
        }
      });

      const rawText = response.text || "[]";
      let eventsArray: any[] = [];
      try {
        eventsArray = extractAndParseJson(rawText);
      } catch (e) {
        console.error(`Failed to parse Gemini news response for ${exec.name}:`, e);
      }

      for (const item of eventsArray) {
        if (!item || !item.headline || item.headline.trim() === "") continue;
        if (item.eventType === "insider_transactions") continue; // Filter out if Gemini still returns it

        const execEvent: ExecutiveEvent = {
          executiveName: exec.name,
          executiveRole: exec.role,
          roleWeight: exec.roleWeight,
          eventDate: endDate, // using endDate as default substitution
          eventType: item.eventType,
          eventSeverity: item.eventSeverity as "low" | "moderate" | "high" | "critical",
          headline: item.headline,
          detail: item.detail,
          sourceUrl: item.sourceDescription,
          isVerified: item.isVerified,
          materialityScore: 0, // computed later by MaterialityEngine
          stockRelevanceReason: item.stockRelevanceReason,
          potentialDirection: item.potentialDirection as "bullish" | "bearish" | "neutral" | "uncertain",
          potentialMagnitude: "moderate" // default substitution
        };
        allEvents.push(execEvent);
      }

      // Replace insider transactions search with direct call to getInsiderTransactions
      console.log("[EDGAR] Using verified Form 4 data for insider transactions instead of web search.");
      try {
        const insiderTxs = await getInsiderTransactions(symbol, startDate, endDate);
        const matchedTxs = insiderTxs.filter(tx => {
          const normFull = tx.executiveName.toLowerCase().replace(/[^a-z ]/g, '');
          const normExec = exec.name.toLowerCase().replace(/[^a-z ]/g, '');
          const tokens = normExec.split(' ').filter(t => t.length > 2);
          return tokens.every(token => normFull.includes(token));
        });

        for (const tx of matchedTxs) {
          allEvents.push({
            executiveName: exec.name,
            executiveRole: exec.role,
            roleWeight: exec.roleWeight,
            eventDate: tx.transactionDate,
            eventType: "insider_transactions",
            eventSeverity: tx.totalValue > 1000000 ? "high" : tx.totalValue > 100000 ? "moderate" : "low",
            headline: `Insider Transaction: ${exec.name} (${exec.role}) ${tx.transactionType === "P" ? "purchased" : "sold"} ${tx.shares.toLocaleString()} shares ($${tx.totalValue.toLocaleString()})`,
            detail: `${exec.name}, ${exec.role}, executed a legally verified transaction (Form 4) on ${tx.transactionDate}, ${tx.transactionType === "P" ? "acquiring" : "disposing of"} ${tx.shares.toLocaleString()} shares at average price $${tx.pricePerShare.toFixed(2)} per share, leaving a post-transaction holding of ${tx.sharesOwnedAfter.toLocaleString()} shares. This transaction was verified via SEC EDGAR.`,
            sourceUrl: tx.filingUrl,
            isVerified: true,
            materialityScore: 0,
            stockRelevanceReason: `Legally filed Form 4 transactions denote direct executive conviction or liquidity needs and are highly relevant for price trends.`,
            potentialDirection: tx.transactionType === "P" ? "bullish" : tx.transactionType === "S" ? "bearish" : "neutral",
            potentialMagnitude: tx.totalValue > 1000000 ? "major" : tx.totalValue > 100000 ? "moderate" : "minor"
          });
        }
      } catch (edgarErr) {
        console.error("[EXEC-INTEL] Failed to fetch or match insider transactions from EDGAR:", edgarErr);
      }

    } catch (err) {
      console.warn(`[EXEC-INTEL] Failed to scan executive news for ${exec.name}, continuing...`, err);
    }
  }

  const validEvents = allEvents.filter(ev => {
    if (!ev.stockRelevanceReason || ev.stockRelevanceReason.trim() === "") return false;
    const lower = ev.stockRelevanceReason.toLowerCase();
    if (lower.length < 40 && (lower.includes("may affect") || lower.includes("could impact") || lower.includes("might impact"))) return false;
    return true;
  });

  const filteredCount = allEvents.length - validEvents.length;
  if (filteredCount > 0) {
    console.warn(`[EXEC-INTEL] Filtered out ${filteredCount} events with insufficient stock relevance reasoning.`);
  }

  return validEvents;
}

const FALLBACK_COMPETITORS: Record<string, Array<{symbol: string, name: string, relationship: string}>> = {
  "AAPL": [
    { symbol: "MSFT", name: "Microsoft Corporation", relationship: "Primary rival in personal computing, enterprise SaaS, and operating systems." },
    { symbol: "GOOGL", name: "Alphabet Inc.", relationship: "Direct competitor in mobile operating systems (iOS vs Android) and app store platforms." },
    { symbol: "SAMSUNG", name: "Samsung Electronics", relationship: "Biggest global competitor in premium smartphone hardware sales." },
    { symbol: "AMZN", name: "Amazon.com, Inc.", relationship: "Competitor in smart home devices, cloud storage, and digital media streaming." },
    { symbol: "SONY", name: "Sony Group Corporation", relationship: "Competitor in premium consumer electronics, audio equipment, and wearables." }
  ],
  "MSFT": [
    { symbol: "AAPL", name: "Apple Inc.", relationship: "Direct rival in cloud capabilities and hardware." },
    { symbol: "GOOGL", name: "Alphabet Inc.", relationship: "Fierce competitor in AI models, search, and cloud." },
    { symbol: "AMZN", name: "Amazon.com, Inc.", relationship: "Primary competitor in cloud services (Azure vs AWS)." },
    { symbol: "ORCL", name: "Oracle", relationship: "Enterprise database and software rival." }
  ],
  "NVDA": [
    { symbol: "AMD", name: "Advanced Micro Devices", relationship: "Direct competitor in GPUs and AI accelerators." },
    { symbol: "INTC", name: "Intel Corporation", relationship: "Traditional competitor in data center and consumer compute chips." },
    { symbol: "AVGO", name: "Broadcom Inc.", relationship: "Rival in custom silicon and networking for AI clusters." },
    { symbol: "TSM", name: "Taiwan Semiconductor", relationship: "Key supplier but also proxy competitor in silicon dominance." }
  ],
  "TSLA": [
    { symbol: "BYDDY", name: "BYD Company", relationship: "Largest global EV competitor, particularly dominant in the Chinese market." },
    { symbol: "F", name: "Ford Motor Company", relationship: "Legacy automaker aggressively transitioning to EVs in the US market." },
    { symbol: "TM", name: "Toyota Motor Corporation", relationship: "Global automotive volume leader competing in hybrids and next-gen EVs." },
    { symbol: "RIVN", name: "Rivian Automotive", relationship: "Direct competitor in the premium electric truck and SUV segments." }
  ]
};

function getDynamicFallbackCompetitors(symbol: string, companyName: string): Array<{symbol: string, name: string, relationship: string}> {
  const sym = symbol.toUpperCase().trim();
  
  // Games Workshop / Tabletop Gaming
  if (sym === "GAW.L" || sym === "GAW" || sym.includes("GAW") || companyName.toLowerCase().includes("games workshop")) {
    return [
      {
        symbol: "HAS",
        name: "Hasbro, Inc.",
        relationship: "Owner of Wizards of the Coast (D&D, Magic: The Gathering); Games Workshop's primary rival for tabletop gaming and fantasy IP dominance."
      },
      {
        symbol: "EMBRAC.B",
        name: "Embracer Group AB (Asmodee)",
        relationship: "Major global board games distributor and publisher, owning competitor miniature games such as Star Wars: Legion and Marvel: Crisis Protocol."
      },
      {
        symbol: "MAT",
        name: "Mattel, Inc.",
        relationship: "Global toy and IP conglomerate competing for general consumer entertainment and collectible figurine markets."
      },
      {
        symbol: "NCBDY",
        name: "Bandai Namco Holdings",
        relationship: "Japanese giant dominating high-end character scale-model kits (Gundam), sharing a massive hobbyist modeling and assembly demographic overlap."
      },
      {
        symbol: "FNKO",
        name: "Funko, Inc.",
        relationship: "Producer of licensed pop-culture physical collectibles and vinyl figures, competing directly on character IP and licensing real-estate."
      }
    ];
  }

  if (sym === "AAPL") {
    return [
      { symbol: "MSFT", name: "Microsoft Corporation", relationship: "Primary rival in personal computing, enterprise SaaS, and operating systems." },
      { symbol: "GOOGL", name: "Alphabet Inc.", relationship: "Direct competitor in mobile operating systems (iOS vs Android) and app store platforms." },
      { symbol: "SAMSUNG", name: "Samsung Electronics", relationship: "Biggest global competitor in premium smartphone hardware sales." },
      { symbol: "AMZN", name: "Amazon.com, Inc.", relationship: "Competitor in smart home devices, cloud storage, and digital media streaming." },
      { symbol: "SONY", name: "Sony Group Corporation", relationship: "Competitor in premium consumer electronics, audio equipment, and wearables." }
    ];
  }
  if (sym === "MSFT") {
    return [
      { symbol: "AAPL", name: "Apple Inc.", relationship: "Direct rival in consumer devices, hardware, and premium ecosystems." },
      { symbol: "GOOGL", name: "Alphabet Inc.", relationship: "Fierce competitor in artificial intelligence (OpenAI/Copilot vs Gemini), cloud, and developer platforms." },
      { symbol: "AMZN", name: "Amazon.com, Inc.", relationship: "Primary competitor in cloud infrastructure services (Azure vs AWS)." },
      { symbol: "ORCL", name: "Oracle Corporation", relationship: "Rival in enterprise database solutions, ERP, and enterprise cloud applications." },
      { symbol: "CRM", name: "Salesforce, Inc.", relationship: "Enterprise competitor in customer relationship management and team productivity tools." }
    ];
  }
  if (sym === "NVDA") {
    return [
      { symbol: "AMD", name: "Advanced Micro Devices, Inc.", relationship: "Direct competitor in high-performance GPUs and AI accelerators." },
      { symbol: "INTC", name: "Intel Corporation", relationship: "Traditional competitor in data center CPUs and consumer computer hardware." },
      { symbol: "AVGO", name: "Broadcom Inc.", relationship: "Rival in custom ASICs, machine learning hardware, and AI network interconnects." },
      { symbol: "TSM", name: "Taiwan Semiconductor Manufacturing Co.", relationship: "Key manufacturing partner and semiconductor supply-chain linchpin." },
      { symbol: "QCOM", name: "Qualcomm Inc.", relationship: "Competitor in edge AI processors and mobile compute chipsets." }
    ];
  }
  if (sym === "TSLA") {
    return [
      { symbol: "BYDDY", name: "BYD Company Limited", relationship: "Largest global EV competitor, dominant in Asian markets and expanding worldwide." },
      { symbol: "F", name: "Ford Motor Company", relationship: "Legacy automotive giant competing in electric pickup trucks and commercial vehicle fleets." },
      { symbol: "TM", name: "Toyota Motor Corporation", relationship: "Global automotive volume champion presenting competing hybrid and alternative energy drivetrains." },
      { symbol: "RIVN", name: "Rivian Automotive, Inc.", relationship: "Pure-play EV maker competing directly in premium electric trucks, SUVs, and commercial vans." },
      { symbol: "GM", name: "General Motors Company", relationship: "Legacy manufacturer rolling out scaled electric platforms and autonomous vehicle solutions." }
    ];
  }
  
  // Pharma / Healthcare / Biotech
  if (["LLY", "JNJ", "PFE", "MRK", "ABBV", "BMY", "REGN", "EW", "HCA"].includes(sym)) {
    const pharma = [
      { symbol: "LLY", name: "Eli Lilly and Company", relationship: "Major pharmaceutical giant specializing in diabetes, GLP-1 weight loss, and oncology solutions." },
      { symbol: "JNJ", name: "Johnson & Johnson", relationship: "Diversified healthcare conglomerate leading in clinical pharmaceuticals and medical devices." },
      { symbol: "PFE", name: "Pfizer Inc.", relationship: "Global pharmaceutical leader with deep portfolios in vaccines, oncology, and specialty immunology." },
      { symbol: "MRK", name: "Merck & Co., Inc.", relationship: "Direct weight in oncology therapeutics, immunology products, and critical vaccine developments." },
      { symbol: "ABBV", name: "AbbVie Inc.", relationship: "Biopharmaceutical power player with leading assets in immunology and aesthetics." },
      { symbol: "BMY", name: "Bristol-Myers Squibb", relationship: "Global biopharma developer focusing heavily on premium cardiovascular and oncology therapeutics." }
    ];
    return pharma.filter(p => p.symbol !== sym).slice(0, 5);
  }

  // Banking / Finance
  if (["JPM", "BAC", "GS", "MS", "CFF", "BLK", "CB", "PGR", "APO", "FI"].includes(sym)) {
    const finance = [
      { symbol: "JPM", name: "JPMorgan Chase & Co.", relationship: "Largest US banking institution dominating retail deposit, commercial debt, and asset advisory." },
      { symbol: "BAC", name: "Bank of America Corp.", relationship: "Primary retail consumer banking rival with extensive commercial wealth segments." },
      { symbol: "GS", name: "Goldman Sachs Group Inc.", relationship: "Premier global investment banking, capital markets, and institutional market-maker." },
      { symbol: "MS", name: "Morgan Stanley", relationship: "Investment advisory and absolute industry champion in retail wealth management." },
      { symbol: "BLK", name: "BlackRock, Inc.", relationship: "World's largest asset manager leading passive ETF flows, index funds, and risk platform services." },
      { symbol: "C", name: "Citigroup Inc.", relationship: "Direct global banking competitor with unparalleled international transaction banking footprints." }
    ];
    return finance.filter(f => f.symbol !== sym).slice(0, 5);
  }

  // Energy / Industrials
  if (["XOM", "CVX", "COP", "SLB", "EOG", "GE", "LMT", "RTX", "CAT", "DE"].includes(sym)) {
    const energy = [
      { symbol: "XOM", name: "Exxon Mobil Corporation", relationship: "Largest Western supermajor with sprawling upstream production and downstream refinement." },
      { symbol: "CVX", name: "Chevron Corporation", relationship: "Direct oil and gas supermajor pursuing massive Permian Basin shale extraction and global LNG." },
      { symbol: "COP", name: "ConocoPhillips", relationship: "Largest pure-play upstream energy explorer and producer with low cost-of-supply assets." },
      { symbol: "SLB", name: "Schlumberger N.V.", relationship: "Premier global oilfields technology and engineering supplier to raw producers." },
      { symbol: "EOG", name: "EOG Resources, Inc.", relationship: "Leading independent shale play explorer employing advanced tactical drilling analytics." }
    ];
    if (["XOM", "CVX", "COP", "SLB", "EOG"].includes(sym)) {
      return energy.filter(e => e.symbol !== sym).slice(0, 5);
    }
  }

  // Defense / Aerospace
  if (["LMT", "RTX", "NOC", "BA", "GD"].includes(sym)) {
    return [
      { symbol: "LMT", name: "Lockheed Martin Corporation", relationship: "Primary competitor in advanced fighter aviation (F-35) and missile defence technology." },
      { symbol: "RTX", name: "RTX Corporation", relationship: "Direct competitor in propulsion systems, aerospace defense avionics, and radar guidance." },
      { symbol: "NOC", name: "Northrop Grumman", relationship: "Aerospace rival in stealth bombers, space weapon payload systems, and radar components." },
      { symbol: "BA", name: "The Boeing Company", relationship: "Direct competitor in defense aviation platforms and commercial space projects." },
      { symbol: "GD", name: "General Dynamics", relationship: "Competitor in naval combat submarines, battle armor, and administrative communication tech." }
    ];
  }

  // Large Tech / General Software / Platforms
  if (["GOOGL", "AMZN", "META", "NFLX", "PLTR", "CRM"].includes(sym)) {
    const heavyTech = [
      { symbol: "MSFT", name: "Microsoft Corporation", relationship: "Primary enterprise cloud, database, software, and AI assistant competitor." },
      { symbol: "GOOGL", name: "Alphabet Inc.", relationship: "Direct rival in digital ad real-estate, AI modeling research, mobile ecosystems, and video entertainment." },
      { symbol: "AMZN", name: "Amazon.com, Inc.", relationship: "Competitor in retail logistics, streaming media, cloud hosting, and enterprise platform automation." },
      { symbol: "META", name: "Meta Platforms, Inc.", relationship: "Rival in digital marketplace tools, advanced social networks, and artificial intelligence models." },
      { symbol: "PLTR", name: "Palantir Technologies Inc.", relationship: "Competitor in specialized custom enterprise AI search platforms and state analytics pipelines." }
    ];
    return heavyTech.filter(t => t.symbol !== sym).slice(0, 5);
  }

  // Telecom / Utilities
  if (["VZ", "T", "TMUS", "VOD", "ORAN", "BCE", "RCI"].includes(sym)) {
    return [
      { symbol: "VZ", name: "Verizon Communications Inc.", relationship: "Direct competitor in nationwide 5G mobile networks, broadband, and enterprise fiber." },
      { symbol: "T", name: "AT&T Inc.", relationship: "Major telecom provider competing in fiber broadband and wireless consumer service contracts." },
      { symbol: "TMUS", name: "T-Mobile US, Inc.", relationship: "Primary competitor in wireless, leading aggressively with high-speed multi-band 5G spectrum." },
      { symbol: "BCE", name: "BCE Inc.", relationship: "Major Canadian telecom competitor battling in cellular coverage and media distributions." },
      { symbol: "RCI", name: "Rogers Communications Inc.", relationship: "Broadband and wireless peer competing across Canadian consumer metrics." }
    ];
  }

  // Default generic high quality stock bucket
  return [
    { symbol: "AAPL", name: "Apple Inc.", relationship: "Global consumer electronics leader driving brand ecosystem value." },
    { symbol: "MSFT", name: "Microsoft Corporation", relationship: "Sprawling enterprise backend platform and software standards benchmark." },
    { symbol: "GOOGL", name: "Alphabet Inc.", relationship: "Direct competitor in machine learning, information ecosystems, and search directories." },
    { symbol: "AMZN", name: "Amazon.com, Inc.", relationship: "E-commerce infrastructure giant and cloud computing benchmark." },
    { symbol: "NVDA", name: "NVIDIA Corporation", relationship: "GPU and accelerated hardware innovator driving AI-enabled computing." }
  ];
}

export async function getCompetitorMap(
  symbol: string,
  companyName: string
): Promise<Array<{symbol: string, name: string, relationship: string}>> {
  const cached = getCachedCompetitorMap(symbol);
  if (cached) {
    const fetchedDate = new Date(cached.fetchedAt).getTime();
    const now = Date.now();
    // 60 days in ms = 60 * 24 * 60 * 60 * 1000 = 5184000000
    if (now - fetchedDate < 5184000000) {
      return cached.map;
    }
  }

  const prompt = `Identify the 5 most significant direct competitors and close market rivals of ${companyName} (${symbol}). For each competitor, provide their stock ticker symbol, company name, and a one-sentence description of the competitive relationship (e.g. 'Direct competitor in the GPU market' or 'Primary rival for enterprise cloud contracts'). Focus on companies where news about the competitor could materially affect ${symbol}'s stock price. Return as a JSON array with fields: symbol, name, relationship.`;

  let mapData: Array<{symbol: string, name: string, relationship: string}> = [];
  try {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        tools: [{ googleSearch: {} }],
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              symbol: { type: Type.STRING },
              name: { type: Type.STRING },
              relationship: { type: Type.STRING }
            },
            required: ["symbol", "name", "relationship"]
          }
        }
      }
    });

    const rawText = response.text || "[]";
    try {
      mapData = extractAndParseJson(rawText);
    } catch (e) {
      console.error("Failed to parse Gemini competitor map response:", e);
    }
  } catch (error: any) {
    if (error?.status === 429 || String(error).includes("429") || String(error).includes("credits are depleted") || String(error).includes("spending cap") || String(error).includes("quota")) {
      console.warn("Returning fallback competitor list due to rate limit/quota.");
      // Fallback
      if (FALLBACK_COMPETITORS[symbol.toUpperCase()]) {
        mapData = FALLBACK_COMPETITORS[symbol.toUpperCase()];
      } else {
        mapData = getDynamicFallbackCompetitors(symbol, companyName);
      }
    } else {
      console.error("[EXEC-INTEL] Failed to fetch competitor map from Gemini:", error.message || error);
      mapData = getDynamicFallbackCompetitors(symbol, companyName);
    }
  }

  if (!mapData || mapData.length === 0) {
    mapData = getDynamicFallbackCompetitors(symbol, companyName);
  }

  if (mapData.length > 0) {
    setCachedCompetitorMap(symbol, mapData);
  }
  return mapData;
}

export async function scanCompetitorNews(
  targetSymbol: string,
  targetCompanyName: string,
  competitors: Array<{symbol: string, name: string, relationship: string}>,
  startDate: string,
  endDate: string
): Promise<CompetitorEvent[]> {
  const allEvents: CompetitorEvent[] = [];
  const ai = getAIClient();

  for (let i = 0; i < competitors.length; i++) {
    const comp = competitors[i];

    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const prompt = `You are a competitive intelligence analyst monitoring ${comp.name} (${comp.symbol}) as a rival to ${targetCompanyName} (${targetSymbol}).

Search for significant news about ${comp.name} between ${startDate} and ${endDate} that would be relevant to ${targetSymbol} investors. The competitive relationship is: ${comp.relationship}.

Look specifically for: major product launches or failures, significant executive changes (especially CEO/CTO departures), large customer wins or losses, legal or regulatory actions, major partnership or acquisition announcements, pricing changes or price wars, earnings surprises that reveal market dynamics, bankruptcy or financial distress signals, and technology breakthroughs.

For each item found, explain specifically why it matters to ${targetSymbol} — does this strengthen or weaken the competitive threat? Does it open or close market opportunities for ${targetSymbol}?

Return a JSON array with fields: eventType, headline, detail, impactOnTargetStock (positive/negative/neutral/uncertain), impactReason, estimatedMateriality (0-100 score for how much this could affect ${targetSymbol}).`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          tools: [{ googleSearch: {} }],
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                eventType: { type: Type.STRING },
                headline: { type: Type.STRING },
                detail: { type: Type.STRING },
                impactOnTargetStock: { type: Type.STRING },
                impactReason: { type: Type.STRING },
                estimatedMateriality: { type: Type.INTEGER }
              },
              required: [
                "eventType",
                "headline",
                "detail",
                "impactOnTargetStock",
                "impactReason",
                "estimatedMateriality"
              ]
            }
          }
        }
      });

      const rawText = response.text || "[]";
      let eventsArray: any[] = [];
      try {
        eventsArray = extractAndParseJson(rawText);
      } catch (e) {
        console.error(`Failed to parse Gemini news response for competitor ${comp.name}:`, e);
      }

      for (const item of eventsArray) {
        if (!item || !item.headline || item.headline.trim() === "") continue;

        const compEvent: CompetitorEvent = {
          competitorSymbol: comp.symbol,
          competitorName: comp.name,
          eventDate: endDate, // using endDate as default
          eventType: item.eventType,
          headline: item.headline,
          detail: item.detail,
          impactOnTargetStock: item.impactOnTargetStock as "positive" | "negative" | "neutral" | "uncertain",
          impactReason: item.impactReason,
          materialityScore: item.estimatedMateriality
        };
        allEvents.push(compEvent);
      }
    } catch (err) {
      console.warn(`[EXEC-INTEL] Failed to scan competitor news for ${comp.name}, continuing...`, err);
    }
  }

  return allEvents;
}

export function assessMateriality(
  event: ExecutiveEvent | CompetitorEvent,
  symbol: string,
  currentMarketRegime?: MarketRegime
): number {
  let score = 0;

  if ("executiveName" in event) {
    const execEvent = event as ExecutiveEvent;
    let baseScore = 0;
    switch (execEvent.eventType) {
      case "legal_issue": baseScore = 70; break;
      case "social_media_controversy": baseScore = 35; break;
      case "political_connection": baseScore = 45; break;
      case "personal_relationship": baseScore = 30; break;
      case "health_event": baseScore = 60; break;
      case "insider_transaction": baseScore = 65; break;
      case "public_statement": baseScore = 40; break;
      case "board_activity": baseScore = 50; break;
      case "competitor_meeting": baseScore = 55; break;
      case "regulatory_inquiry": baseScore = 75; break;
      case "lifestyle_event": baseScore = 15; break;
      case "departure_signal": baseScore = 80; break;
      default: baseScore = 30; break;
    }

    score = baseScore;

    // Multiply by roleWeight
    score *= (execEvent.roleWeight || 0.5);

    // Multiply by severity
    let severityMultiplier = 1.0;
    switch (execEvent.eventSeverity) {
      case "low": severityMultiplier = 0.5; break;
      case "moderate": severityMultiplier = 0.8; break;
      case "high": severityMultiplier = 1.0; break;
      case "critical": severityMultiplier = 1.3; break;
    }
    score *= severityMultiplier;

    // Multiply by verification
    score *= execEvent.isVerified ? 1.0 : 0.6;
    
  } else {
    const compEvent = event as CompetitorEvent;
    score = compEvent.materialityScore || 0;
    
    let directionMultiplier = 1.0;
    switch (compEvent.impactOnTargetStock) {
      case "negative": directionMultiplier = 1.1; break;
      case "positive": directionMultiplier = 1.0; break;
      case "uncertain": directionMultiplier = 0.8; break;
      case "neutral": directionMultiplier = 0.5; break;
    }
    score *= directionMultiplier;
  }

  if (currentMarketRegime && 
      (currentMarketRegime.volatilityRegime === "high_volatility" || currentMarketRegime.volatilityRegime === "panic")) {
    score *= 1.2;
  }

  score = Math.min(100, Math.max(0, score));

  // Scores above 70 are considered high-materiality events that should be prominently flagged in the UI,
  // 40-70 are moderate and worth noting, and below 40 are low-materiality background intelligence.
  event.materialityScore = score;
  
  return score;
}

export async function generateIntelligenceReport(
  symbol: string,
  companyName: string,
  startDate: string,
  endDate: string,
  currentMarketRegime?: MarketRegime
): Promise<ExecutiveIntelligenceReport> {
  const executives = await getExecutiveRoster(symbol, companyName);
  const competitors = await getCompetitorMap(symbol, companyName);

  const execEvents = await scanExecutiveNews(symbol, companyName, executives, startDate, endDate);
  const compEvents = await scanCompetitorNews(symbol, companyName, competitors, startDate, endDate);

  // Wikipedia traffic spike detection (72h prior)
  const wikipediaSpikes: WikipediaTrafficSignal[] = [];
  try {
    const ceo = executives.find(e => e.roleWeight >= 1.0 || e.role.toLowerCase().includes("ceo"));
    const cfo = executives.find(e => (!ceo || e.name !== ceo.name) && (e.roleWeight === 0.9 || e.role.toLowerCase().includes("cfo")));
    
    // Check Company, CEO, CFO
    const queries = [companyName];
    if (ceo) queries.push(ceo.name);
    if (cfo) queries.push(cfo.name);
    
    // We use endDate as the relative point of the event
    const spikes = await Promise.all(queries.map(q => detectWikipediaSpike(q, endDate)));
    for (const spike of spikes) {
      if (spike && spike.isSpike) {
        wikipediaSpikes.push(spike);
      }
    }
  } catch (err) {
    console.error("[EXEC-INTEL] Failed to fetch Wikipedia spikes:", err);
  }

  const allEvents: Array<ExecutiveEvent | CompetitorEvent> = [...execEvents, ...compEvents];
  
  allEvents.forEach(e => assessMateriality(e, symbol, currentMarketRegime));

  const filteredEvents = allEvents.filter(e => (e.materialityScore || 0) >= 20);
  filteredEvents.sort((a, b) => (b.materialityScore || 0) - (a.materialityScore || 0));

  let finalExecEvents: ExecutiveEvent[] = [];
  let finalCompEvents: CompetitorEvent[] = [];

  let scoreSum = 0;
  for (const e of filteredEvents) {
    if ("executiveName" in e) {
      finalExecEvents.push(e as ExecutiveEvent);
      scoreSum += (e.materialityScore || 0) * (e.roleWeight || 0.5);
    } else {
      finalCompEvents.push(e as CompetitorEvent);
      scoreSum += (e.materialityScore || 0) * 0.5;
    }
  }

  const verifiedEvents = finalExecEvents.filter(e => e.isVerified);
  const unverifiedEvents = finalExecEvents.filter(e => !e.isVerified);

  const overallMaterialityScore = filteredEvents.length > 0 ? scoreSum / filteredEvents.length : 0;

  const top5 = filteredEvents.slice(0, 5);
  let overallSignal: "bullish" | "bearish" | "neutral" | "mixed" | "insufficient_data" = "neutral";
  
  if (top5.length < 3) {
    overallSignal = "insufficient_data";
  } else {
    let bullishCount = 0;
    let bearishCount = 0;
    for (const e of top5) {
      if ("executiveName" in e) {
        if (e.potentialDirection === "bullish") bullishCount++;
        if (e.potentialDirection === "bearish") bearishCount++;
      } else {
        if (e.impactOnTargetStock === "positive") bullishCount++;
        if (e.impactOnTargetStock === "negative") bearishCount++;
      }
    }
    
    const pctBullish = bullishCount / top5.length;
    const pctBearish = bearishCount / top5.length;

    if (pctBearish >= 0.7) {
      overallSignal = "bearish";
    } else if (pctBullish >= 0.7) {
      overallSignal = "bullish";
    } else if (bullishCount > 0 && bearishCount > 0) {
      overallSignal = "mixed";
    } else {
      overallSignal = "neutral";
    }
  }

  const highImpactEvents = filteredEvents.filter(e => (e.materialityScore || 0) >= 40);
  let summary = "No material executive or competitor events found during this period.";

  if (highImpactEvents.length > 0 || wikipediaSpikes.length > 0) {
    const ai = getAIClient();
    const prompt = `You are a senior equity analyst writing an executive intelligence briefing for investors in ${companyName} (${symbol}). Based on the following intelligence findings about company executives and competitors from ${startDate} to ${endDate}, write a single analytical paragraph of 4-6 sentences that: synthesises the most material findings, explains what they collectively suggest about near-term stock risk or opportunity, notes any patterns or concerning combinations of events, and gives an overall assessment of whether the executive/competitive intelligence picture is a net positive, negative, or neutral for the stock. 
Write professionally and factually. Do not speculate beyond what the evidence supports. Clearly note if any findings are unverified rumour. Important: preface any claim from an unverified source with "Unconfirmed reports suggest..." rather than stating it as fact.

Intelligence findings: ${JSON.stringify(highImpactEvents, null, 2)}
${wikipediaSpikes.length > 0 ? `\nNotable pre-anomaly Wikipedia traffic spikes (72h prior to event, suggesting potential informed interest): ${JSON.stringify(wikipediaSpikes, null, 2)}` : ''}`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt
      });
      if (response.text) {
        summary = response.text.trim();
      }
    } catch (err) {
      console.error("[EXEC-INTEL] Failed to generate summary paragraph:", err);
      summary = "Error generating intelligence summary.";
    }
  }

  console.log(`[EXEC-INTEL] ${symbol} report complete: ${finalExecEvents.length} executive events, ${finalCompEvents.length} competitor events, overall signal: ${overallSignal}, materiality: ${overallMaterialityScore.toFixed(2)}`);

  return {
    symbol,
    reportDate: new Date().toISOString(),
    executivesScanned: executives.map(e => e.name),
    wikipediaSpikes,
    executiveEvents: finalExecEvents,
    verifiedEvents,
    unverifiedEvents,
    competitorEvents: finalCompEvents,
    overallSignal,
    overallMaterialityScore,
    summary,
    searchCoverage: `${startDate} to ${endDate}`
  };
}

