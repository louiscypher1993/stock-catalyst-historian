import { Readable } from 'stream';
import unzipper from 'unzipper';
import { parse } from 'csv-parse';
import { GDELTEvent } from './src/types';
import { logFetch, isSourceRateLimited, markSourceRateLimited } from './DataSourceRegistry';

export async function fetchGDELTEventsForDate(
  symbol: string,
  companyName: string,
  dateStr: string
): Promise<GDELTEvent[]> {
  const start = Date.now();
  
  if (isSourceRateLimited('gdelt')) {
    console.warn('[GDELT] Skipping fetch due to rate limit being hit previously.');
    return [];
  }

  // Generate target queries
  // Typically an actor name in GDELT could be the exact company name or part of it
  const baseName = companyName
    .replace(/inc\\.?|corp\\.?|ltd\\.?|plc\\.?|company/gi, '')
    .trim()
    .toUpperCase();
  
  const queries = [baseName];
  if (baseName.includes(' ')) {
    queries.push(baseName.split(' ')[0]);
  }
  queries.push(symbol.toUpperCase());
  
  // Create unique short queries, 3 chars or more
  const validQueries = Array.from(new Set(queries)).filter(q => q.length >= 3);
  
  // Format the date for GDELT URL: YYYYMMDD
  const d = new Date(dateStr);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const fileDate = `${yyyy}${mm}${dd}`;
  
  const url = `http://data.gdeltproject.org/events/${fileDate}.export.CSV.zip`;
  
  const events: GDELTEvent[] = [];
  
  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) {
        console.warn(`[GDELT] File not found for ${fileDate} (may be too early in the day or weekend missing)`);
        return [];
      }
      if (res.status === 429) {
        markSourceRateLimited('gdelt');
      } else if (res.status === 403) {
        console.warn(`[GDELT] 403 forbidden on ${fileDate}`);
      }
      return [];
    }

    await new Promise<void>((resolve, reject) => {
      let rowCount = 0;
      
      Readable.fromWeb(res.body as any)
        .pipe(unzipper.ParseOne())
        .on('error', reject)
        .pipe(parse({ delimiter: '\\t', relax_column_count: true }))
        .on('error', reject)
        .on('data', row => {
           rowCount++;
           const actor1Name = row[6] ? String(row[6]).toUpperCase() : "";
           const actor2Name = row[16] ? String(row[16]).toUpperCase() : "";
           
           let matched = false;
           for (const q of validQueries) {
             if (actor1Name.includes(q) || actor2Name.includes(q)) {
               matched = true;
               break;
             }
           }
           
           if (matched) {
             events.push({
               eventId: String(row[0]),
               date: dateStr,
               actor1Name: String(row[6]),
               actor2Name: String(row[16] || ""),
               eventCode: String(row[26] || ""),
               goldsteinScale: parseFloat(row[30]) || 0,
               avgTone: parseFloat(row[34]) || 0,
               sourceUrl: String(row[57] || "")
             });
           }
        })
        .on('end', () => {
           console.log(`[GDELT] Processed ${rowCount} daily global events for ${fileDate}`);
           resolve();
        });
    });

    logFetch({
      sourceId: "gdelt",
      sourceName: "GDELT Project",
      dataType: "events",
      symbol: symbol.toUpperCase(),
      fetchedAt: new Date().toISOString(),
      coverageStart: dateStr,
      coverageEnd: dateStr,
      recordCount: events.length,
      success: true,
      latencyMs: Date.now() - start,
      isFallback: false
    });
    
    // Sort events by avgTone magnitude ascending (for maximum negative/positive relevance? No, let's sort by goldstein scale)
    // No, most interesting events are those with the highest magnitude Tone or Goldstein Scale or Mentions.
    // Let's sort by magnitude of Tone for now, since it indicates extreme sentiment.
    events.sort((a, b) => Math.abs(b.avgTone) - Math.abs(a.avgTone));
    
    // Cap to 20 events to avoid bloating the context
    return events.slice(0, 20);
    
  } catch (err) {
    console.error("[GDELT] Connection or parsing failed:", err);
    logFetch({
      sourceId: "gdelt",
      sourceName: "GDELT Project",
      dataType: "events",
      symbol: symbol.toUpperCase(),
      fetchedAt: new Date().toISOString(),
      recordCount: 0,
      success: false,
      latencyMs: Date.now() - start,
      isFallback: false
    });
    return [];
  }
}
