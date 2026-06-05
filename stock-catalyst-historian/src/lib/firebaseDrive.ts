import { initializeApp, getApp, getApps } from "firebase/app";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
} from "firebase/auth";
import { StockScanResult, StockPoint } from "../types";

// Safe, Lazy Firebase Initialization
const firebaseConfig = {
  apiKey: (import.meta as any).env?.VITE_FIREBASE_API_KEY || "",
  authDomain: (import.meta as any).env?.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: (import.meta as any).env?.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: (import.meta as any).env?.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: (import.meta as any).env?.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: (import.meta as any).env?.VITE_FIREBASE_APP_ID || ""
};
const hasFirebaseConfig = Boolean(firebaseConfig.apiKey);
const app = hasFirebaseConfig ? (getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)) : null;
const auth = hasFirebaseConfig ? getAuth(app!) : null;

const provider = new GoogleAuthProvider();
provider.addScope("https://www.googleapis.com/auth/drive.file");
provider.addScope("https://www.googleapis.com/auth/spreadsheets");

let isSigningIn = false;
let cachedAccessToken: string | null = null;

// Initialize auth state listener
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void,
) => {
  if (!auth) {
    if (onAuthFailure) onAuthFailure();
    return () => {}; // return empty unsubscribe function
  }
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Sign in with Google
export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  if (!auth) {
    throw new Error("Firebase configuration is missing or invalid. Please configure your .env variables.");
  }
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        "Failed to secure Google Drive API access token from authentication provider.",
      );
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error("Authentication popup failed:", error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  if (auth) {
    await auth.signOut();
  }
  cachedAccessToken = null;
};

// CSV helper escaping function
const esc = (val: any): string => {
  if (val === undefined || val === null) return "";
  const str = String(val);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};



export { };

// Create a native Google Sheets spreadsheet with a worksheet per company
export const uploadMultiSheetSpreadsheetToGoogleDrive = async (
  accessToken: string,
  savedScans: Record<string, StockScanResult>,
  marketsList: any[],
  filename: string,
): Promise<{ id: string; alternateLink: string }> => {
  const findMarketForSymbol = (sym: string): string => {
    const market = marketsList.find((m: any) =>
      m.stocks?.some((s: any) => s.symbol.toUpperCase() === sym.toUpperCase()),
    );
    return market ? market.name : "Other Exchanges";
  };

  const getVolatility = (pts: StockPoint[]): number => {
    if (!pts || pts.length === 0) return 0;
    const mean = pts.reduce((sum, p) => sum + p.dailyReturn, 0) / pts.length;
    const variance =
      pts.reduce((sum, p) => sum + Math.pow(p.dailyReturn - mean, 2), 0) /
      pts.length;
    return Math.sqrt(variance) * 100; // expressed as % percentage
  };

  const getNetReturn = (pts: StockPoint[]): number => {
    if (!pts || pts.length === 0) return 0;
    return ((pts[pts.length - 1].close - pts[0].close) / pts[0].close) * 100;
  };

  const num = (v: any, decimals?: number): any => {
    if (v === undefined || v === null || v === "") return "";
    const n = Number(v);
    if (isNaN(n)) return v;
    return decimals !== undefined ? Number(n.toFixed(decimals)) : n;
  };

  // CSV/Sheets Headers
  const headers = [
    "Ticker",
    "Company Name",
    "Exchange",
    "Currency",
    "Scan Range Limit",
    "Period Net Return (%)",
    "Period Daily Volatility (%)",
    "Total Trading Days Scanned",
    "Total Anomalous Spikes",
    "Date",
    "Closing Stock Price",
    "Daily Return (%)",
    "Z-Score value",
    "Is Anomaly Event?",
    // New StockPoint indicators:
    "Excess Return (%)",
    "ATR (14)",
    "ATR Normalized Move",
    "ATR Shock Score",
    "Volume Ratio",
    "Volume Shock Category",
    // Event data columns
    "Primary Catalyst Tag",
    "Reason (Suspected Catalyst)",
    "Key Outlook Risk Factor",
    "Severity Score (0-10)",
    "Confidence Score (0-10)",
    "News Grounded Findings",
    "Alternative Data Observations",
    "Alternative Data Score",
    "Corporate Governance Observations",
    "Corporate Governance Score",
    "Macroeconomic Observations",
    "Macroeconomic Score",
    "Market Structure Observations",
    "Market Structure Score",
    "Fundamental & Earnings Observations",
    "Fundamental & Earnings Score",
    "Causal Attribution Review",
    "Link Confidence Score",
    // New StockAnalysis metrics:
    "Primary Catalyst Category",
    "Primary Catalyst Sub-Type",
    "Statistical Confidence (%)",
    "Causal Confidence (%)",
    "AI Internal Confidence (%)",
    "Historical Dataset Confidence (%)",
    "Metadata Completeness Confidence (%)",
    "Is Rule-Based Fallback?",
    "VIX at Event",
    "VIX Volatility Regime",
    "Days Since Prior Anomaly",
    "Anomaly Density (Lookback)",
    "Days from Earnings Announcement",
    // Horizon details
    "1-Day Price Return (%)",
    "1-Day AI Effect Score",
    "1-Week Price Return (%)",
    "1-Week AI Effect Score",
    "1-Month Price Return (%)",
    "1-Month AI Effect Score",
    "6-Month Price Return (%)",
    "6-Month AI Effect Score",
    "1-Year Price Return (%)",
    "1-Year AI Effect Score",
  ];

  // Track unique sheet titles
  const seenSheetTitles = new Set<string>();
  const cleanSheetTitle = (title: string): string => {
    let cleaned = title.replace(/[*?\\/\[\]:]/g, "").trim();
    if (cleaned.length > 30) {
      cleaned = cleaned.substring(0, 30);
    }
    if (!cleaned) {
      cleaned = "Sheet1";
    }
    let candidate = cleaned;
    let counter = 1;
    while (seenSheetTitles.has(candidate.toLowerCase())) {
      const suffix = `_${counter}`;
      candidate = cleaned.substring(0, 30 - suffix.length) + suffix;
      counter++;
    }
    seenSheetTitles.add(candidate.toLowerCase());
    return candidate;
  };

  // Step 1: Create a blank spreadsheet with one sheet/tab per company
  const scanList = Object.values(savedScans);
  const sheetsToCreate = scanList.map((res) => ({
    properties: {
      title: cleanSheetTitle(res.symbol),
    },
  }));

  const createUrl = "https://sheets.googleapis.com/v4/spreadsheets";
  const createResponse = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        title: filename,
      },
      sheets: sheetsToCreate,
    }),
  });

  if (!createResponse.ok) {
    const errorBody = await createResponse.text();
    console.error("Sheets create spreadsheet response error:", errorBody);
    throw new Error(
      `Google Sheets creation failed with status ${createResponse.status}: ${errorBody || createResponse.statusText}`,
    );
  }

  const spreadsheetData = await createResponse.json();
  const spreadsheetId = spreadsheetData.spreadsheetId;
  const webViewLink = spreadsheetData.spreadsheetUrl;

  // Step 2: Formulate data update payload for each sheet
  seenSheetTitles.clear();
  const dataPayload = scanList.map((res) => {
    const sheetTitle = cleanSheetTitle(res.symbol);
    const ticker = res.symbol;
    const company = res.companyName || "Asset Tracking Ingest";
    const exchange = findMarketForSymbol(ticker);
    const currency = res.currency || "USD";
    const range = res.meta?.range || "None Specified";

    // Calculated stock-level parameters
    const points = res.points || [];
    const totalDays = points.length;
    const anomaliesCount = res.anomalies?.length || 0;
    const periodReturn = getNetReturn(points);
    const periodVolatility = getVolatility(points);

    // Sort dates chronologically (oldest to newest)
    const sortedPoints = [...points].sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    // Populate values grid
    const rows: any[][] = [headers];

    sortedPoints.forEach((pt) => {
      const isAnomaly = pt.isAnomaly || false;
      const analysis = pt.analysis;

      const row = [
        ticker,
        company,
        exchange,
        currency,
        range,
        num(periodReturn, 2),
        num(periodVolatility, 2),
        totalDays,
        anomaliesCount,
        pt.date,
        num(pt.close, 2),
        num(pt.dailyReturn * 100, 2),
        num(pt.zScore, 3),
        isAnomaly ? "YES" : "NO",

        // New StockPoint columns
        pt.excessReturn !== undefined ? num(pt.excessReturn * 100, 2) : "",
        pt.atr14 !== undefined ? num(pt.atr14, 4) : "",
        pt.atrNormalizedMove !== undefined ? num(pt.atrNormalizedMove, 4) : "",
        pt.atrShockScore !== undefined ? num(pt.atrShockScore, 2) : "",
        pt.volumeRatio !== undefined
          ? num(pt.volumeRatio, 2)
          : pt.relativeVolume !== undefined
            ? num(pt.relativeVolume, 2)
            : "",
        pt.volumeShockType || "",

        // Event data columns
        analysis?.primary_catalyst_tag || "",
        analysis?.suspected_catalyst || "",
        analysis?.key_risk || "",
        num(analysis?.severity_score),
        num(analysis?.confidence_score),
        analysis?.internet_findings || "",
        analysis?.alternative_data_observations || "",
        num(analysis?.alternative_data_score),
        analysis?.corporate_governance_observations || "",
        num(analysis?.corporate_governance_score),
        analysis?.macroeconomic_observations || "",
        num(analysis?.macroeconomic_score),
        analysis?.market_structure_observations || "",
        num(analysis?.market_structure_score),
        analysis?.fundamental_and_earnings_observations || "",
        num(analysis?.fundamental_and_earnings_score),
        analysis?.coincidence_vs_correlation || "",
        num(analysis?.correlation_confidence),

        // Additional StockAnalysis columns:
        analysis?.primaryCategory || "",
        analysis?.primarySubType || "",
        num(analysis?.statisticalConfidence),
        num(analysis?.causalConfidence),
        num(analysis?.aiConfidence),
        num(analysis?.historicalConfidence),
        num(analysis?.dataConfidence),
        analysis?.isFallback ? "YES" : "NO",
        analysis?.vixAtEvent !== undefined ? num(analysis.vixAtEvent, 2) : "",
        analysis?.vixRegime || "",
        num(analysis?.daysSincePreviousEvent),
        num(analysis?.eventDensity),
        num(analysis?.daysFromEarnings),

        // Horizon details
        analysis?.return_1d !== undefined
          ? num(analysis.return_1d * 100, 2)
          : "",
        num(analysis?.effect_score_1d),
        analysis?.return_1w !== undefined
          ? num(analysis.return_1w * 100, 2)
          : "",
        num(analysis?.effect_score_1w),
        analysis?.return_1m !== undefined
          ? num(analysis.return_1m * 100, 2)
          : "",
        num(analysis?.effect_score_1m),
        analysis?.return_6m !== undefined
          ? num(analysis.return_6m * 100, 2)
          : "",
        num(analysis?.effect_score_6m),
        analysis?.return_1y !== undefined
          ? num(analysis.return_1y * 100, 2)
          : "",
        num(analysis?.effect_score_1y),
      ];

      rows.push(row);
    });

    return {
      range: `'${sheetTitle}'!A1`,
      values: rows,
    };
  });

  // Step 3: Populate all sheets in a single batch values update of Google Sheets API
  const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`;
  const updateResponse = await fetch(updateUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: dataPayload,
    }),
  });

  if (!updateResponse.ok) {
    const errorBody = await updateResponse.text();
    console.error("Sheets batchUpdate value payload error:", errorBody);
    throw new Error(
      `Failed to populate spreadsheet worksheet values with status ${updateResponse.status}: ${errorBody || updateResponse.statusText}`,
    );
  }

  return {
    id: spreadsheetId,
    alternateLink:
      webViewLink ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
};

// Upload JSON backup to Google Drive
export const uploadJSONToGoogleDrive = async (
  accessToken: string,
  jsonContent: string,
  filename: string,
): Promise<{ id: string; alternateLink: string }> => {
  const metadata = {
    name: filename,
    mimeType: "application/json",
    description:
      "Database Backup from Stock Catalyst Historian (savedScans JSON format).",
  };

  const boundary = "historian_json_multipart_boundary";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const bodyStr =
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    jsonContent +
    closeDelimiter;

  const url =
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: bodyStr,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Drive upload JSON error:", errorBody);
    throw new Error(
      `Google Drive backup upload failed with status ${response.status}: ${errorBody || response.statusText}`,
    );
  }

  const result = await response.json();
  return {
    id: result.id,
    alternateLink:
      result.webViewLink || `https://drive.google.com/open?id=${result.id}`,
  };
};

export const updateFileInGoogleDrive = async (
  accessToken: string,
  fileId: string,
  jsonContent: string,
): Promise<void> => {
  const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: jsonContent,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Drive JSON update failed:", errorBody);
    throw new Error(
      `Failed to update JSON in Google Drive with status ${response.status}: ${errorBody || response.statusText}`,
    );
  }
};

// List available JSON or CSV backup files on Google Drive
export const listJSONBackupsInGoogleDrive = async (
  accessToken: string,
): Promise<
  Array<{ id: string; name: string; createdTime: string; mimeType?: string }>
> => {
  const q = encodeURIComponent(
    "(mimeType = 'application/json' or mimeType = 'text/csv') and (name contains 'AnomalySandbox_Backup' or name contains 'Stock_Anomalies_History_Backup') and trashed = false",
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime,mimeType)&orderBy=createdTime+desc`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("List active drive backups failed:", errorBody);
    throw new Error(
      `Failed to list backups from Google Drive with status ${response.status}: ${errorBody || response.statusText}`,
    );
  }

  const result = await response.json();
  return result.files || [];
};

// Download active JSON backup content from Google Drive
export const downloadJSONFromGoogleDrive = async (
  accessToken: string,
  fileId: string,
): Promise<any> => {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Download drive backup failed:", errorBody);
    throw new Error(
      `Failed to download backup file with status ${response.status}: ${errorBody || response.statusText}`,
    );
  }

  return response.json();
};

// Search JSON & CSV files inside Google Drive based on query
export const searchDriveBackupFiles = async (
  accessToken: string,
  searchQuery?: string,
): Promise<
  Array<{
    id: string;
    name: string;
    createdTime: string;
    size?: string;
    mimeType?: string;
  }>
> => {
  let qStr =
    "(mimeType = 'application/json' or mimeType = 'text/csv' or mimeType = 'application/vnd.google-apps.spreadsheet') and trashed = false";
  if (searchQuery && searchQuery.trim().length > 0) {
    const cleanSearch = searchQuery.replace(/'/g, "\\'");
    qStr = `(${qStr}) and name contains '${cleanSearch}'`;
  }
  const q = encodeURIComponent(qStr);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime,size,mimeType)&orderBy=createdTime+desc&pageSize=50`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Search drive files failed:", errorBody);
    throw new Error(
      `Failed to search Google Drive files with status ${response.status}: ${errorBody || response.statusText}`,
    );
  }

  const result = await response.json();
  return result.files || [];
};

// Download raw text content of any file from Google Drive, exporting all Sheets/workbooks in case of a Google Sheet
export const downloadTextFromGoogleDrive = async (
  accessToken: string,
  fileId: string,
): Promise<string> => {
  // Query metadata to check for Google Docs/Sheets MIME Types
  const metaUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType`;
  const metaResponse = await fetch(metaUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!metaResponse.ok) {
    const errorBody = await metaResponse.text();
    console.error("Fetch file metadata failed:", errorBody);
    throw new Error(
      `Failed to fetch file metadata with status ${metaResponse.status}: ${errorBody || metaResponse.statusText}`,
    );
  }

  const { mimeType } = await metaResponse.json();

  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    try {
      // Query Sheets API to enumerate worksheets (books/tabs list)
      const sheetsApiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${fileId}?fields=sheets(properties(sheetId,title))`;
      const sheetsResponse = await fetch(sheetsApiUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (sheetsResponse.ok) {
        const sheetsData = await sheetsResponse.json();
        const sheetList = sheetsData.sheets || [];
        if (sheetList.length > 1) {
          const csvChunks: string[] = [];
          for (const sheet of sheetList) {
            const sheetId = sheet.properties?.sheetId;
            const title = sheet.properties?.title || "";
            // Fetch worksheet individual CSV export
            const exportUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv&gid=${sheetId}`;
            const chunkRes = await fetch(exportUrl, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            });
            if (chunkRes.ok) {
              const csvText = await chunkRes.text();
              csvChunks.push(csvText);
            } else {
              console.warn(
                `Failed to export worksheet sheetId ${sheetId} (${title})`,
              );
            }
          }

          if (csvChunks.length > 0) {
            const combinedRows: string[] = [];
            for (let i = 0; i < csvChunks.length; i++) {
              const lines = csvChunks[i].split(/\r?\n/);
              if (i === 0) {
                combinedRows.push(...lines);
              } else {
                // For sheets 1, 2, etc, skip the header line to retain unified header row
                combinedRows.push(...lines.slice(1));
              }
            }
            return combinedRows.join("\n");
          }
        }
      }
    } catch (e) {
      console.warn(
        "Sheets API multi-tab export query failed, using standard fallback",
        e,
      );
    }

    // Default Fallback: export only the first sheet as CSV using modern exporter
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to download spreadsheet file with status ${response.status}: ${errorBody}`,
      );
    }
    return response.text();
  }

  // Native files (JSON/CSV) download directly
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Download drive backup text failed:", errorBody);
    throw new Error(
      `Failed to download file with status ${response.status}: ${errorBody || response.statusText}`,
    );
  }

  return response.text();
};

export const parseStockCSV = (
  csvStr: string,
): Record<string, StockScanResult> => {
  // A robust hand-crafted CSV parser that handles double-quoted values (with commas & double-quotes)
  const parseCSVRows = (text: string): string[][] => {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = "";
    let insideQuote = false;
    let i = 0;
    while (i < text.length) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (insideQuote) {
        if (char === '"') {
          if (nextChar === '"') {
            currentCell += '"';
            i += 2;
            continue;
          } else {
            insideQuote = false;
            i++;
            continue;
          }
        } else {
          currentCell += char;
        }
      } else {
        if (char === '"') {
          insideQuote = true;
          i++;
          continue;
        } else if (char === ",") {
          currentRow.push(currentCell);
          currentCell = "";
        } else if (char === "\r" || char === "\n") {
          currentRow.push(currentCell);
          currentCell = "";
          if (
            currentRow.length > 0 &&
            !(currentRow.length === 1 && currentRow[0] === "")
          ) {
            rows.push(currentRow);
          }
          currentRow = [];
          if (char === "\r" && nextChar === "\n") {
            i += 2;
            continue;
          }
        } else {
          currentCell += char;
        }
      }
      i++;
    }
    if (currentCell || currentRow.length > 0) {
      currentRow.push(currentCell);
      if (
        currentRow.length > 0 &&
        !(currentRow.length === 1 && currentRow[0] === "")
      ) {
        rows.push(currentRow);
      }
    }
    return rows;
  };

  const parsed = parseCSVRows(csvStr);
  if (parsed.length < 2) return {};

  const headers = parsed[0].map((h) => h.trim());
  const idx = (headerName: string) => headers.indexOf(headerName);

  // We need column indexes for mapping back
  const tIdx = idx("Ticker");
  const cNameIdx = idx("Company Name");
  const compIdx = cNameIdx !== -1 ? cNameIdx : idx("Company Name");
  const currencyIdx = idx("Currency");
  const rangeIdx = idx("Scan Range Limit");
  const dateIdx = idx("Date");
  const closeIdx = idx("Closing Stock Price");
  const retIdx = idx("Daily Return (%)");
  const zIdx = idx("Z-Score value");
  const isAnomIdx = idx("Is Anomaly Event?");

  // New StockPoint indicators:
  const excessRetIdx = idx("Excess Return (%)");
  const atr14Idx = idx("ATR (14)");
  const atrNormIdx = idx("ATR Normalized Move");
  const atrShockIdx = idx("ATR Shock Score");
  const volRatioIdx = idx("Volume Ratio");
  const volShockIdx = idx("Volume Shock Category");

  const catTagIdx = idx("Primary Catalyst Tag");
  const reasonIdx = idx("Reason (Suspected Catalyst)");
  const riskIdx = idx("Key Outlook Risk Factor");
  const sevIdx = idx("Severity Score (0-10)");
  const confIdx = idx("Confidence Score (0-10)");
  const newsIdx = idx("News Grounded Findings");
  const altDataIdx = idx("Alternative Data Observations");
  const altDataScoreIdx = idx("Alternative Data Score");
  const corpGovIdx = idx("Corporate Governance Observations");
  const corpGovScoreIdx = idx("Corporate Governance Score");
  const macroObsIdx = idx("Macroeconomic Observations");
  const macroScoreIdx = idx("Macroeconomic Score");
  const marketStructObsIdx = idx("Market Structure Observations");
  const marketStructScoreIdx = idx("Market Structure Score");
  const funEarnObsIdx = idx("Fundamental & Earnings Observations");
  const funEarnScoreIdx = idx("Fundamental & Earnings Score");
  const causalIdx = idx("Causal Attribution Review");
  const lConfIdx = idx("Link Confidence Score");

  // New StockAnalysis metrics:
  const primCatIdx = idx("Primary Catalyst Category");
  const primSubIdx = idx("Primary Catalyst Sub-Type");
  const statConfIdx = idx("Statistical Confidence (%)");
  const causConfIdx = idx("Causal Confidence (%)");
  const aiConfIdx = idx("AI Internal Confidence (%)");
  const histConfIdx = idx("Historical Dataset Confidence (%)");
  const dataConfIdx = idx("Metadata Completeness Confidence (%)");
  const fallbackIdx = idx("Is Rule-Based Fallback?");
  const vixIdx = idx("VIX at Event");
  const vixRegIdx = idx("VIX Volatility Regime");
  const daysPriorIdx = idx("Days Since Prior Anomaly");
  const densityIdx = idx("Anomaly Density (Lookback)");
  const earningsDaysIdx = idx("Days from Earnings Announcement");

  const shannonEntropyIdx = idx("Shannon Entropy (30d)");
  const amihudIlliquidityIdx = idx("Amihud Illiquidity (30d)");
  const barycenterStretchIdx = idx("Barycenter Stretch (20d)");
  const kineticEnergyIdx = idx("Kinetic Energy");
  const l1LagrangeIdx = idx("L1 Lagrange Point");
  const orbitalEscapeIdx = idx("Orbital Escape Velocity");
  const escapeVelocityClearedIdx = idx("Escape Velocity Cleared");
  const reynoldsNumberIdx = idx("Market Reynolds Number");
  const fractalEfficiencyIdx = idx("Fractal Efficiency Ratio (10d)");
  const marketJerkIdx = idx("Market Jerk");
  const seismicMagnitudeIdx = idx("Seismic Magnitude (Mw)");
  const triggeredZScoreIdx = idx("Triggered Z-Score Threshold");
  const sectorRelativeZScoreIdx = idx("Sector Relative Z-Score");

  const r1dIdx = idx("1-Day Price Return (%)");
  const s1dIdx = idx("1-Day AI Effect Score");
  const r1wIdx = idx("1-Week Price Return (%)");
  const s1wIdx = idx("1-Week AI Effect Score");
  const r1mIdx = idx("1-Month Price Return (%)");
  const s1mIdx = idx("1-Month AI Effect Score");
  const r6mIdx = idx("6-Month Price Return (%)");
  const s6mIdx = idx("6-Month AI Effect Score");
  const r1yIdx = idx("1-Year Price Return (%)");
  const s1yIdx = idx("1-Year AI Effect Score");

  const results: Record<string, StockScanResult> = {};

  for (let r = 1; r < parsed.length; r++) {
    const row = parsed[r];
    if (row.length < 5) continue; // safety check

    const ticker = row[tIdx]?.trim();
    if (!ticker) continue;

    const companyName = row[compIdx] || ticker;
    const currency = row[currencyIdx] || "USD";
    const range = row[rangeIdx] || "None Specified";
    const dateStr = row[dateIdx]?.trim();
    if (!dateStr) continue;

    const closeVal = parseFloat(row[closeIdx]) || 0;
    const dailyReturnVal = (parseFloat(row[retIdx]) || 0) / 100; // raw percentage decimal representation
    const zScoreVal = parseFloat(row[zIdx]) || 0;
    const isAnomalyVal =
      row[isAnomIdx]?.toUpperCase() === "YES" ||
      row[isAnomIdx]?.toUpperCase() === "TRUE";

    // New StockPoint column data parsing:
    const excessReturnVal =
      excessRetIdx !== -1 && row[excessRetIdx]
        ? parseFloat(row[excessRetIdx]) / 100
        : undefined;
    const atr14Val =
      atr14Idx !== -1 && row[atr14Idx] ? parseFloat(row[atr14Idx]) : undefined;
    const atrNormVal =
      atrNormIdx !== -1 && row[atrNormIdx]
        ? parseFloat(row[atrNormIdx])
        : undefined;
    const atrShockVal =
      atrShockIdx !== -1 && row[atrShockIdx]
        ? parseFloat(row[atrShockIdx])
        : undefined;
    const volRatioVal =
      volRatioIdx !== -1 && row[volRatioIdx]
        ? parseFloat(row[volRatioIdx])
        : undefined;
    const volShockVal =
      volShockIdx !== -1 && row[volShockIdx]
        ? row[volShockIdx].trim()
        : undefined;

    if (!results[ticker]) {
      results[ticker] = {
        symbol: ticker,
        companyName,
        currency,
        points: [],
        anomalies: [],
        meta: {
          range,
          regularMarketPrice: null,
          chartPreviousClose: null,
          appliedZScoreThreshold: 2.5, // default fallback
        },
      };
    }

    const currentStock = results[ticker];
    const timestamp = new Date(dateStr).getTime() || Date.now();

    // Reconstruct optional analysis if primary fields exist
    let analysis: any = undefined;
    const hasAnalysis =
      isAnomalyVal || row[reasonIdx] || row[riskIdx] || row[catTagIdx];
    if (hasAnalysis) {
      analysis = {
        primary_catalyst_tag: row[catTagIdx] || "",
        suspected_catalyst: row[reasonIdx] || "",
        key_risk: row[riskIdx] || "",
        severity_score:
          row[sevIdx] !== undefined && row[sevIdx] !== ""
            ? parseFloat(row[sevIdx])
            : 0,
        confidence_score:
          row[confIdx] !== undefined && row[confIdx] !== ""
            ? parseFloat(row[confIdx])
            : 0,
        internet_findings: row[newsIdx] || "",
        alternative_data_observations:
          altDataIdx !== -1 ? row[altDataIdx] || "" : "",
        alternative_data_score:
          altDataScoreIdx !== -1 && row[altDataScoreIdx] !== ""
            ? parseFloat(row[altDataScoreIdx])
            : undefined,
        corporate_governance_observations:
          corpGovIdx !== -1 ? row[corpGovIdx] || "" : "",
        corporate_governance_score:
          corpGovScoreIdx !== -1 && row[corpGovScoreIdx] !== ""
            ? parseFloat(row[corpGovScoreIdx])
            : undefined,
        macroeconomic_observations: macroObsIdx !== -1 ? row[macroObsIdx] || "" : "",
        macroeconomic_score:
          macroScoreIdx !== -1 && row[macroScoreIdx] !== ""
            ? parseFloat(row[macroScoreIdx])
            : undefined,
        market_structure_observations: marketStructObsIdx !== -1 ? row[marketStructObsIdx] || "" : "",
        market_structure_score:
          marketStructScoreIdx !== -1 && row[marketStructScoreIdx] !== ""
            ? parseFloat(row[marketStructScoreIdx])
            : undefined,
        fundamental_and_earnings_observations: funEarnObsIdx !== -1 ? row[funEarnObsIdx] || "" : "",
        fundamental_and_earnings_score:
          funEarnScoreIdx !== -1 && row[funEarnScoreIdx] !== ""
            ? parseFloat(row[funEarnScoreIdx])
            : undefined,
        coincidence_vs_correlation: row[causalIdx] || "",
        correlation_confidence:
          row[lConfIdx] !== undefined && row[lConfIdx] !== ""
            ? parseFloat(row[lConfIdx])
            : 0,

        // New StockAnalysis fields:
        primaryCategory:
          primCatIdx !== -1 && row[primCatIdx]
            ? row[primCatIdx].trim()
            : undefined,
        primarySubType:
          primSubIdx !== -1 && row[primSubIdx]
            ? row[primSubIdx].trim()
            : undefined,
        statisticalConfidence:
          statConfIdx !== -1 && row[statConfIdx]
            ? parseFloat(row[statConfIdx])
            : undefined,
        causalConfidence:
          causConfIdx !== -1 && row[causConfIdx]
            ? parseFloat(row[causConfIdx])
            : undefined,
        aiConfidence:
          aiConfIdx !== -1 && row[aiConfIdx]
            ? parseFloat(row[aiConfIdx])
            : undefined,
        historicalConfidence:
          histConfIdx !== -1 && row[histConfIdx]
            ? parseFloat(row[histConfIdx])
            : undefined,
        dataConfidence:
          dataConfIdx !== -1 && row[dataConfIdx]
            ? parseFloat(row[dataConfIdx])
            : undefined,
        isFallback:
          fallbackIdx !== -1 && row[fallbackIdx]
            ? row[fallbackIdx].trim().toUpperCase() === "YES" ||
              row[fallbackIdx].trim().toUpperCase() === "TRUE"
            : undefined,
        vixAtEvent:
          vixIdx !== -1 && row[vixIdx] ? parseFloat(row[vixIdx]) : undefined,
        vixRegime:
          vixRegIdx !== -1 && row[vixRegIdx]
            ? row[vixRegIdx].trim()
            : undefined,
        daysSincePreviousEvent:
          daysPriorIdx !== -1 && row[daysPriorIdx]
            ? parseInt(row[daysPriorIdx])
            : undefined,
        eventDensity:
          densityIdx !== -1 && row[densityIdx]
            ? parseInt(row[densityIdx])
            : undefined,
        daysFromEarnings:
          earningsDaysIdx !== -1 && row[earningsDaysIdx]
            ? parseInt(row[earningsDaysIdx])
            : undefined,
            
        shannon_entropy_30d:
          shannonEntropyIdx !== -1 && row[shannonEntropyIdx]
            ? parseFloat(row[shannonEntropyIdx])
            : undefined,
        amihud_illiquidity_30d:
          amihudIlliquidityIdx !== -1 && row[amihudIlliquidityIdx]
            ? parseFloat(row[amihudIlliquidityIdx])
            : undefined,
        barycenter_stretch_20d:
          barycenterStretchIdx !== -1 && row[barycenterStretchIdx]
            ? parseFloat(row[barycenterStretchIdx])
            : undefined,
        kinetic_energy:
          kineticEnergyIdx !== -1 && row[kineticEnergyIdx]
            ? parseFloat(row[kineticEnergyIdx])
            : undefined,
        l1_lagrange_point:
          l1LagrangeIdx !== -1 && row[l1LagrangeIdx]
            ? parseFloat(row[l1LagrangeIdx])
            : undefined,
        orbital_escape_velocity:
          orbitalEscapeIdx !== -1 && row[orbitalEscapeIdx]
            ? parseFloat(row[orbitalEscapeIdx])
            : undefined,
        escape_velocity_cleared:
          escapeVelocityClearedIdx !== -1 && row[escapeVelocityClearedIdx]
            ? parseFloat(row[escapeVelocityClearedIdx])
            : undefined,
        market_reynolds_number:
          reynoldsNumberIdx !== -1 && row[reynoldsNumberIdx]
            ? parseFloat(row[reynoldsNumberIdx])
            : undefined,
        fractal_efficiency_ratio_10d:
          fractalEfficiencyIdx !== -1 && row[fractalEfficiencyIdx]
            ? parseFloat(row[fractalEfficiencyIdx])
            : undefined,
        market_jerk:
          marketJerkIdx !== -1 && row[marketJerkIdx]
            ? parseFloat(row[marketJerkIdx])
            : undefined,
        seismic_magnitude_mw:
          seismicMagnitudeIdx !== -1 && row[seismicMagnitudeIdx]
            ? parseFloat(row[seismicMagnitudeIdx])
            : undefined,
        triggered_z_score_threshold:
          triggeredZScoreIdx !== -1 && row[triggeredZScoreIdx]
            ? parseFloat(row[triggeredZScoreIdx])
            : undefined,
        sector_relative_z_score:
          sectorRelativeZScoreIdx !== -1 && row[sectorRelativeZScoreIdx]
            ? parseFloat(row[sectorRelativeZScoreIdx])
            : undefined,

        return_1d:
          row[r1dIdx] !== undefined && row[r1dIdx] !== ""
            ? parseFloat(row[r1dIdx]) / 100
            : undefined,
        effect_score_1d:
          row[s1dIdx] !== undefined && row[s1dIdx] !== ""
            ? parseFloat(row[s1dIdx])
            : undefined,
        return_1w:
          row[r1wIdx] !== undefined && row[r1wIdx] !== ""
            ? parseFloat(row[r1wIdx]) / 100
            : undefined,
        effect_score_1w:
          row[s1wIdx] !== undefined && row[s1wIdx] !== ""
            ? parseFloat(row[s1wIdx])
            : undefined,
        return_1m:
          row[r1mIdx] !== undefined && row[r1mIdx] !== ""
            ? parseFloat(row[r1mIdx]) / 100
            : undefined,
        effect_score_1m:
          row[s1mIdx] !== undefined && row[s1mIdx] !== ""
            ? parseFloat(row[s1mIdx])
            : undefined,
        return_6m:
          row[r6mIdx] !== undefined && row[r6mIdx] !== ""
            ? parseFloat(row[r6mIdx]) / 100
            : undefined,
        effect_score_6m:
          row[s6mIdx] !== undefined && row[s6mIdx] !== ""
            ? parseFloat(row[s6mIdx])
            : undefined,
        return_1y:
          row[r1yIdx] !== undefined && row[r1yIdx] !== ""
            ? parseFloat(row[r1yIdx]) / 100
            : undefined,
        effect_score_1y:
          row[s1yIdx] !== undefined && row[s1yIdx] !== ""
            ? parseFloat(row[s1yIdx])
            : undefined,
      };
    }

    const pt: StockPoint = {
      date: dateStr,
      timestamp,
      open: closeVal, // close serves as base proxy
      high: closeVal,
      low: closeVal,
      close: closeVal,
      volume: 0,
      dailyReturn: dailyReturnVal,
      rollingMean: 0,
      rollingStd: 0,
      zScore: zScoreVal,
      isAnomaly: isAnomalyVal,
      hasAnalysis: !!hasAnalysis,
      analysis,

      excessReturn: excessReturnVal,
      atr14: atr14Val,
      atrNormalizedMove: atrNormVal,
      atrShockScore: atrShockVal,
      volumeRatio: volRatioVal,
      relativeVolume: volRatioVal,
      volumeShockType: volShockVal,
    };

    currentStock.points.push(pt);
    if (isAnomalyVal) {
      currentStock.anomalies.push(pt);
    }
  }

  // Final touches (sorting dates, updating regularMarketPrice, etc)
  Object.values(results).forEach((stock) => {
    stock.points.sort((a, b) => a.date.localeCompare(b.date));
    stock.anomalies.sort((a, b) => a.date.localeCompare(b.date));

    if (stock.points.length > 0) {
      const lastPt = stock.points[stock.points.length - 1];
      stock.meta.regularMarketPrice = lastPt.close;
      if (stock.points.length > 1) {
        stock.meta.chartPreviousClose =
          stock.points[stock.points.length - 2].close;
      }
    }
  });

  return results;
};
