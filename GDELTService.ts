import { Readable } from 'stream';
import unzipper from 'unzipper';
import { parse } from 'csv-parse';
import { logFetch, isSourceRateLimited, markSourceRateLimited } from './DataSourceRegistry';

export interface GDELTToneSummary {
  /** Average tone of GKG records whose Organizations field mentioned the company (null if no matches) */
  matchedToneAvg: number | null;
  /** Average tone across every GKG record that day, used as the z-score baseline */
  globalToneAvg: number | null;
  /** Standard deviation of tone across every GKG record that day */
  globalToneStdDev: number | null;
  /** Number of GKG records whose Organizations field mentioned the company */
  matchCount: number;
}

const EMPTY_SUMMARY: GDELTToneSummary = {
  matchedToneAvg: null,
  globalToneAvg: null,
  globalToneStdDev: null,
  matchCount: 0,
};

export async function fetchGDELTToneForDate(
  symbol: string,
  companyName: string,
  dateStr: string
): Promise<GDELTToneSummary> {
  const start = Date.now();

  if (isSourceRateLimited('gdelt')) {
    console.warn('[GDELT] Skipping fetch due to rate limit being hit previously.');
    return EMPTY_SUMMARY;
  }

  // The GKG feed only goes back to April 2013 — earlier dates always 404, so
  // skip the request entirely and return an empty summary right away.
  const d = new Date(dateStr);
  if (d.getUTCFullYear() < 2013) {
    return EMPTY_SUMMARY;
  }

  // Generate target queries
  // Typically an organization name in GDELT GKG could be the exact company name or part of it
  const baseName = companyName
    .replace(/inc\.?|corp\.?|ltd\.?|plc\.?|company/gi, '')
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
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const fileDate = `${yyyy}${mm}${dd}`;

  const url = `http://data.gdeltproject.org/gkg/${fileDate}.gkg.csv.zip`;

  // Running aggregates — we stream the file row-by-row rather than buffering it,
  // since GKG archives (~50-150MB compressed) are far larger than the old Events Export.
  let matchedToneSum = 0;
  let matchedToneCount = 0;
  let globalToneSum = 0;
  let globalToneSumSq = 0;
  let globalToneCount = 0;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) {
        console.warn(`[GDELT] GKG file not found for ${fileDate} (pre-coverage date or weekend gap)`);
        return EMPTY_SUMMARY;
      }
      if (res.status === 429) {
        markSourceRateLimited('gdelt');
      } else if (res.status === 403) {
        console.warn(`[GDELT] 403 forbidden on ${fileDate}`);
      }
      return EMPTY_SUMMARY;
    }

    await new Promise<void>((resolve, reject) => {
      let rowCount = 0;

      Readable.fromWeb(res.body as any)
        .pipe(unzipper.ParseOne())
        .on('error', reject)
        .pipe(parse({ delimiter: '\t', relax_column_count: true }))
        .on('error', reject)
        .on('data', row => {
          rowCount++;

          // Column 10: Tone — comma-separated, first value is the overall article tone (-100..+100)
          const toneField = row[10] ? String(row[10]) : "";
          if (!toneField) return;
          const tone = parseFloat(toneField.split(',')[0]);
          if (!Number.isFinite(tone)) return;

          // Track the global tone distribution for every record so we can normalise matches into a z-score later
          globalToneSum += tone;
          globalToneSumSq += tone * tone;
          globalToneCount++;

          // Column 9: Organizations — semicolon-separated organization names extracted from the article
          const orgsField = row[9] ? String(row[9]).toUpperCase() : "";
          if (!orgsField) return;

          for (const q of validQueries) {
            if (orgsField.includes(q)) {
              matchedToneSum += tone;
              matchedToneCount++;
              break;
            }
          }
        })
        .on('end', () => {
          console.log(`[GDELT] Processed ${rowCount} GKG records for ${fileDate} (${matchedToneCount} mentioned ${symbol})`);
          resolve();
        });
    });

    logFetch({
      sourceId: "gdelt",
      sourceName: "GDELT Project (GKG)",
      dataType: "sentiment",
      symbol: symbol.toUpperCase(),
      fetchedAt: new Date().toISOString(),
      coverageStart: dateStr,
      coverageEnd: dateStr,
      recordCount: matchedToneCount,
      success: true,
      latencyMs: Date.now() - start,
      isFallback: false
    });

    if (globalToneCount === 0) {
      return EMPTY_SUMMARY;
    }

    const globalToneAvg = globalToneSum / globalToneCount;
    const globalToneVariance = (globalToneSumSq / globalToneCount) - (globalToneAvg * globalToneAvg);
    const globalToneStdDev = Math.sqrt(Math.max(globalToneVariance, 0));

    return {
      matchedToneAvg: matchedToneCount > 0 ? matchedToneSum / matchedToneCount : null,
      globalToneAvg,
      globalToneStdDev,
      matchCount: matchedToneCount,
    };

  } catch (err) {
    console.error("[GDELT] Connection or parsing failed:", err);
    logFetch({
      sourceId: "gdelt",
      sourceName: "GDELT Project (GKG)",
      dataType: "sentiment",
      symbol: symbol.toUpperCase(),
      fetchedAt: new Date().toISOString(),
      recordCount: 0,
      success: false,
      latencyMs: Date.now() - start,
      isFallback: false
    });
    return EMPTY_SUMMARY;
  }
}
