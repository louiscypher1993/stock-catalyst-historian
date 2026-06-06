import { logFetch } from "./DataSourceRegistry";
import { getCachedFDAData, setCachedFDAData } from "./db";

export async function getFDAActivity(
  companyName: string,
  date: string
): Promise<{
  hasActivity: boolean;
  activityCount: number;
  activityTypes: string[];
} | null> {
  const cached = getCachedFDAData(companyName, date);
  if (cached !== null) return cached;

  const start = Date.now();
  const empty = { hasActivity: false, activityCount: 0, activityTypes: [] };

  try {
    const url = `https://api.fda.gov/drug/drugsfda.json?search=sponsor_name:"${encodeURIComponent(companyName)}"&limit=20`;
    const res = await fetch(url);

    if (res.status === 404) {
      setCachedFDAData(companyName, date, empty);
      logFetch({
        sourceId: "openfda",
        sourceName: "OpenFDA",
        dataType: "drug_submissions",
        symbol: companyName,
        fetchedAt: new Date().toISOString(),
        coverageStart: date,
        coverageEnd: date,
        recordCount: 0,
        success: true,
        latencyMs: Date.now() - start,
        isFallback: false,
      });
      return empty;
    }

    if (!res.ok) {
      logFetch({
        sourceId: "openfda",
        sourceName: "OpenFDA",
        dataType: "drug_submissions",
        symbol: companyName,
        fetchedAt: new Date().toISOString(),
        coverageStart: date,
        coverageEnd: date,
        recordCount: 0,
        success: false,
        latencyMs: Date.now() - start,
        isFallback: false,
      });
      return null;
    }

    const body: { results?: any[] } = await res.json();
    const results = Array.isArray(body.results) ? body.results : [];

    const eventTime = new Date(date).getTime();
    const windowMs = 30 * 24 * 60 * 60 * 1000;

    let activityCount = 0;
    const activityTypeSet = new Set<string>();

    for (const drug of results) {
      const submissions: any[] = Array.isArray(drug.submissions) ? drug.submissions : [];
      for (const sub of submissions) {
        const history: any[] = Array.isArray(sub.submission_history) ? sub.submission_history : [];
        const withinWindow = history.some((h: any) => {
          if (!h.submission_status_date) return false;
          return Math.abs(new Date(h.submission_status_date).getTime() - eventTime) <= windowMs;
        });
        if (withinWindow) {
          activityCount++;
          if (sub.submission_class_code) {
            activityTypeSet.add(String(sub.submission_class_code));
          }
        }
      }
    }

    const result = {
      hasActivity: activityCount > 0,
      activityCount,
      activityTypes: Array.from(activityTypeSet),
    };

    setCachedFDAData(companyName, date, result);

    logFetch({
      sourceId: "openfda",
      sourceName: "OpenFDA",
      dataType: "drug_submissions",
      symbol: companyName,
      fetchedAt: new Date().toISOString(),
      coverageStart: date,
      coverageEnd: date,
      recordCount: activityCount,
      success: true,
      latencyMs: Date.now() - start,
      isFallback: false,
    });

    return result;
  } catch (err) {
    console.error("[FDA] getFDAActivity error:", err);
    return null;
  }
}
