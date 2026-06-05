import React, { useState, useEffect, useMemo, useRef } from "react";
import { StockScanResult, StockPoint, Market, StockAsset } from "./types";
import { GLOBAL_MARKETS } from "./marketsData";
import StockChart from "./components/StockChart";
import AnomalyFeed from "./components/AnomalyFeed";
import StockChatAssistant from "./components/StockChatAssistant";
import CompetitorsPanel from "./components/CompetitorsPanel";
import BatchScannerPanel from "./components/BatchScannerPanel";
import {
  initAuth,
  googleSignIn,
  uploadMultiSheetSpreadsheetToGoogleDrive,
  uploadJSONToGoogleDrive,
  updateFileInGoogleDrive,
  listJSONBackupsInGoogleDrive,
  downloadJSONFromGoogleDrive,
  searchDriveBackupFiles,
  downloadTextFromGoogleDrive,
  parseStockCSV,
  logout
} from "./lib/firebaseDrive";
import { safeToLocaleString } from "./utils/dateUtils";
import { User } from "firebase/auth";
import {
  TrendingUp,
  Search,
  AlertOctagon,
  Percent,
  Calendar,
  Layers,
  Sparkles,
  HelpCircle,
  Database,
  BarChart3,
  Loader2,
  AlertTriangle,
  Info,
  Clock,
  Plus,
  Trash2,
  Globe,
  Minimize2,
  Maximize2,
  CloudUpload,
  ExternalLink,
  LogOut,
  Download,
  Upload,
  FileJson,
  FolderOpen, FolderDown,
  RefreshCw, X,
  CheckCircle2
} from "lucide-react";

const DEFAULT_MARKETS: Market[] = GLOBAL_MARKETS;

function cleanErrorMessage(textStr: string, status: number): string {
  if (!textStr) return `Server Error (${status})`;
  const trimmed = textStr.trim();
  if (
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html") ||
    trimmed.includes("<html") ||
    trimmed.includes("Starting Server") ||
    trimmed.includes("Please wait while your application starts") ||
    trimmed.includes("<title>Starting Server...</title>")
  ) {
    return "The analytics server is currently starting or restarting. Please give it 10-15 seconds and try again.";
  }
  if (textStr.length > 250) {
    return textStr.substring(0, 250) + "... (response truncated)";
  }
  return textStr;
}

const safeSaveScans = (scans: Record<string, StockScanResult>) => {
  const toSave = { ...scans };
  while (true) {
    try {
      localStorage.setItem("saved_scans_history_v2", JSON.stringify(toSave));
      break;
    } catch (e: any) {
      if (
        e &&
        (e.name === "QuotaExceededError" || 
         e.message?.includes("exceeded the quota") ||
         e.code === 22 || 
         e.code === 1014)
      ) {
        const keys = Object.keys(toSave);
        if (keys.length === 0) break;
        // Evict the scan with the oldest scannedAt timestamp
        let oldestKey = keys[0];
        let oldestTime = (toSave[oldestKey]?.meta as any)?.scannedAt ?? 0;
        for (const k of keys) {
          const t = (toSave[k]?.meta as any)?.scannedAt ?? 0;
          if (t < oldestTime) {
            oldestTime = t;
            oldestKey = k;
          }
        }
        delete toSave[oldestKey];
      } else {
        console.error("Local storage error:", e);
        break;
      }
    }
  }
};

export default function App() {
  const [markets, setMarkets] = useState<Market[]>(() => {
    const saved = localStorage.getItem("anomaly_detector_markets");
    if (saved) {
      try {
        let parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) {
          return DEFAULT_MARKETS;
        }

        // Clean up obsolete/dismantled markets from local storage state
        const obsoleteMarketNames = [
          "custom watchlist",
          "global competitors expansion",
          "other global equities",
          "euronext exchanges"
        ];
        parsed = parsed.filter(
          (m: any) => m && m.name && !obsoleteMarketNames.includes(m.name.toLowerCase().trim())
        );

        // Merge with DEFAULT_MARKETS to ensure new markets (ASX, etc.) and new stock listings/competitors are included
        for (const defaultMarket of DEFAULT_MARKETS) {
          const userMarket = parsed.find((m: any) => m && m.name && m.name.toLowerCase().trim() === defaultMarket.name.toLowerCase().trim());
          if (!userMarket) {
            parsed.push(defaultMarket);
          } else {
            // Merge elements: add missing stocks from default to user market
            if (!Array.isArray(userMarket.stocks)) {
              userMarket.stocks = [];
            }
            const userSymbols = new Set(
              userMarket.stocks
                .filter((s: any) => s && s.symbol)
                .map((s: any) => s.symbol.toUpperCase().trim())
            );
            for (const stock of defaultMarket.stocks) {
              if (stock && stock.symbol && !userSymbols.has(stock.symbol.toUpperCase().trim())) {
                userMarket.stocks.push(stock);
              }
            }
          }
        }

        // Deduplicate stocks inside each market to avoid duplicate keys and elements
        const sanitized = parsed.map((m: any) => {
          if (!m || !Array.isArray(m.stocks)) return m;
          const seen = new Set<string>();
          const uniqueStocks = m.stocks.filter((s: any) => {
            if (!s || !s.symbol) return false;
            const symUpper = s.symbol.toUpperCase().trim();
            if (seen.has(symUpper)) return false;
            seen.add(symUpper);
            return true;
          });
          return { ...m, stocks: uniqueStocks };
        });
        return sanitized;
      } catch (e) {
        // fallback to default
      }
    }
    return DEFAULT_MARKETS;
  });

  const [selectedMarketIndex, setSelectedMarketIndex] = useState<number>(0);
  const [newMarketName, setNewMarketName] = useState("");
  const [newStockSymbol, setNewStockSymbol] = useState("");
  const [newStockName, setNewStockName] = useState("");
  const [showAddMarket, setShowAddMarket] = useState(false);
  const [showAddStock, setShowAddStock] = useState(false);

  const [symbol, setSymbol] = useState("TSLA");
  const [years, setYears] = useState(5);
  const [zScoreThreshold, setZScoreThreshold] = useState(2.15);
  const [isEditingZScore, setIsEditingZScore] = useState(false);
  const [tempZScore, setTempZScore] = useState("");
  const [isMarketDeskMinimized, setIsMarketDeskMinimized] = useState(false);
  const [scanResult, setScanResult] = useState<StockScanResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  
  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 5000);
  };

  const [selectedAnomalyDate, setSelectedAnomalyDate] = useState<string | null>(null);
  const [analyzingDates, setAnalyzingDates] = useState<string[]>([]);
  const [isApiKeyWarning, setIsApiKeyWarning] = useState(false);
  const [multiResults, setMultiResults] = useState<Record<string, StockScanResult> | null>(null);
  const [cacheStats, setCacheStats] = useState<{ totalCachedAnomalies: number; uniquelySymbolScannedCount: number; scannedSymbols: string[] } | null>(null);
  const [isPreloading, setIsPreloading] = useState(false);
  const [preloadProgress, setPreloadProgress] = useState("");
  const [isBatchUpdating, setIsBatchUpdating] = useState(false);
  const [batchUpdateStatus, setBatchUpdateStatus] = useState<string | null>(null);

  // Scan all unscanned helper states
  const [isScanAllRunning, setIsScanAllRunning] = useState(false);
  const [scanAllTotal, setScanAllTotal] = useState(0);
  const [scanAllProcessed, setScanAllProcessed] = useState(0);
  const [scanAllProgressText, setScanAllProgressText] = useState("");
  const scanAllPauseRef = useRef(false);
  const scanAbortControllerRef = useRef<AbortController | null>(null);

  const [activeLeftTab, setActiveLeftTab] = useState<"focused" | "market" | "saved">("focused");
  const [bulkFilter, setBulkFilter] = useState<"all" | "anomalies" | "gainers" | "decliners">("all");
  const [bulkSearch, setBulkSearch] = useState("");
  const [isSectorMapExpanded, setIsSectorMapExpanded] = useState(false);

  const [savedScans, setSavedScans] = useState<Record<string, StockScanResult>>(() => {
    try {
      const saved = localStorage.getItem("saved_scans_history_v2");
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
  const [savedSearch, setSavedSearch] = useState("");
  const [savedSortBy, setSavedSortBy] = useState<"name" | "market" | "anomalies" | "return" | "volatility">("name");
  const [savedSortOrder, setSavedSortOrder] = useState<"asc" | "desc">("desc");

  // What-if Stress testing state
  const [stressOverrides, setStressOverrides] = useState<Record<string, number>>({});
  const [stressOverrideDate, setStressOverrideDate] = useState<string>("");
  const [stressOverrideValue, setStressOverrideValue] = useState<number>(0);

  // Google Drive Export Integration states
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [isDriveLoading, setIsDriveLoading] = useState(false);
  const [driveExportStatus, setDriveExportStatus] = useState<string | null>(null);

  // Desktop Suite Export States
  const [isExportingEnvironment, setIsExportingEnvironment] = useState(false);
  const [environmentExportStatus, setEnvironmentExportStatus] = useState<string | null>(null);
  const [driveLink, setDriveLink] = useState<string | null>(null);
  const [driveBackups, setDriveBackups] = useState<Array<{ id: string; name: string; createdTime: string }>>([]);
  const [isListingBackups, setIsListingBackups] = useState(false);
  const [showBackupList, setShowBackupList] = useState(false);

  // Advanced Interactive Drive File Selector Window States
  const [isDrivePickerOpen, setIsDrivePickerOpen] = useState(false);
  const [drivePickerSearchQuery, setDrivePickerSearchQuery] = useState("");
  const [drivePickerFiles, setDrivePickerFiles] = useState<Array<{ id: string; name: string; createdTime: string; size?: string }>>([]);
  const [isSearchingPicker, setIsSearchingPicker] = useState(false);
  const [drivePickerError, setDrivePickerError] = useState<string | null>(null);

  // Auto-Save Google Drive Database States
  const [autoSaveDbId, setAutoSaveDbId] = useState<string>(() => localStorage.getItem("drive_db_id") || "");
  const [isAutoSaveEnabled, setIsAutoSaveEnabled] = useState<boolean>(() => localStorage.getItem("drive_db_autosave") === "true");
  const [isSyncing, setIsSyncing] = useState(false);
  
  useEffect(() => {
    localStorage.setItem("drive_db_id", autoSaveDbId);
  }, [autoSaveDbId]);

  useEffect(() => {
    localStorage.setItem("drive_db_autosave", isAutoSaveEnabled ? "true" : "false");
  }, [isAutoSaveEnabled]);

  useEffect(() => {
    if (!isAutoSaveEnabled || !autoSaveDbId || !driveToken) return;
    
    let isMounted = true;
    const timeout = setTimeout(async () => {
      if (!isMounted) return;
      try {
        setIsSyncing(true);
        const jsonContent = JSON.stringify(savedScans, null, 2);
        await updateFileInGoogleDrive(driveToken, autoSaveDbId, jsonContent);
        if (isMounted) console.log(`Auto-saved to Drive DB ${autoSaveDbId} successfully.`);
      } catch (err: any) {
        console.error("Auto-save failed:", err);
        if (isMounted) {
          setError(`Google Drive Auto-save failed: ${err.message || 'Unknown error'}. Disabling auto-save to prevent data loss.`);
          setIsAutoSaveEnabled(false);
        }
      } finally {
        if (isMounted) setIsSyncing(false);
      }
    }, 5000);
    
    return () => {
      isMounted = false;
      clearTimeout(timeout);
    };
  }, [savedScans, isAutoSaveEnabled, autoSaveDbId, driveToken]);

  const [showBatchScanner, setShowBatchScanner] = useState(false);

  // Main UI Tabs Navigation States
  const [activeMainTab, setActiveMainTab] = useState<"volatility" | "market" | "stock" | "advisor" | "settings">("volatility");
  const [activeStockSubTab, setActiveStockSubTab] = useState<"price" | "simulator" | "competitors">("price");

  const [rateLimitedSources, setRateLimitedSources] = useState<string[]>([]);

  const findMarketForSymbol = (sym: string): string => {
    const market = markets.find(m => m.stocks.some(s => s.symbol.toUpperCase() === sym.toUpperCase()));
    return market ? market.name : "Other";
  };

  const getVolatility = (res: StockScanResult): number => {
    const pts = res.points || [];
    if (pts.length === 0) return 0;
    const mean = pts.reduce((sum, p) => sum + p.dailyReturn, 0) / pts.length;
    const variance = pts.reduce((sum, p) => sum + Math.pow(p.dailyReturn - mean, 2), 0) / pts.length;
    return Math.sqrt(variance);
  };

  const getNetReturn = (res: StockScanResult): number => {
    const pts = res.points || [];
    if (pts.length === 0) return 0;
    return ((pts[pts.length - 1].close - pts[0].close) / pts[0].close) * 100;
  };

  // Google Drive Export Flow Handlers
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setDriveUser(user);
        setDriveToken(token);
      },
      () => {
        setDriveUser(null);
        setDriveToken(null);
      }
    );
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const handleDriveLogin = async () => {
    setIsDriveLoading(true);
    setDriveExportStatus(null);
    setDriveLink(null);
    try {
      const res = await googleSignIn();
      if (res) {
        setDriveUser(res.user);
        setDriveToken(res.accessToken);
        setDriveExportStatus("Logged in successfully. Ready to export.");
      }
    } catch (err: any) {
      console.error(err);
      setDriveExportStatus(`Sign-in failed: ${err.message || err}`);
    } finally {
      setIsDriveLoading(false);
    }
  };

  const handleDriveLogout = async () => {
    try {
      await logout();
      setDriveUser(null);
      setDriveToken(null);
      setDriveLink(null);
      setDriveExportStatus("Logged out successfully.");
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleExportToDrive = async () => {
    if (!driveToken) {
      setDriveExportStatus("Please connect your Google Account first.");
      return;
    }
    const savedKeys = Object.keys(savedScans);
    if (savedKeys.length === 0) {
      setDriveExportStatus("No historic scanned stocks are currently saved.");
      return;
    }

    setIsDriveLoading(true);
    setDriveExportStatus("Initializing multi-sheet Google Spreadsheet...");
    setDriveLink(null);

    try {
      const filename = `Stock_Anomalies_History_by_Company_${new Date().toISOString().slice(0, 10)}`;
      
      setDriveExportStatus("Creating spreadsheet and writing value ranges...");
      const result = await uploadMultiSheetSpreadsheetToGoogleDrive(driveToken, savedScans, markets, filename);
      
      setDriveExportStatus(`Export complete! Saved as native Google Sheet: "${filename}"`);
      setDriveLink(result.alternateLink);
    } catch (err: any) {
      console.error(err);
      setDriveExportStatus(`Error during export: ${err.message || err}`);
    } finally {
      setIsDriveLoading(false);
    }
  };

  const handleBackupToDriveJSON = async () => {
    if (!driveToken) {
      setDriveExportStatus("Please connect your Google Account first.");
      return;
    }
    const savedKeys = Object.keys(savedScans);
    if (savedKeys.length === 0) {
      setDriveExportStatus("No historic scanned stocks are currently saved to backup.");
      return;
    }

    setIsDriveLoading(true);
    setDriveExportStatus("Packaging sandbox database JSON backup...");
    setDriveLink(null);

    try {
      const jsonStr = JSON.stringify(savedScans, null, 2);
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, "0");
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      const filename = `AnomalySandbox_Backup_${timestamp}.json`;
      
      setDriveExportStatus("Uploading JSON backup package to Google Drive...");
      const result = await uploadJSONToGoogleDrive(driveToken, jsonStr, filename);
      
      setDriveExportStatus(`Backup successfully uploaded to Google Drive as "${filename}"!`);
      if (showBackupList) {
        handleFetchDriveBackups();
      }
    } catch (err: any) {
      console.error(err);
      setDriveExportStatus(`JSON backup to Drive failed: ${err.message || err}`);
    } finally {
      setIsDriveLoading(false);
    }
  };

  const handleBackupCSVToDrive = async () => {
    if (!driveToken) {
      setDriveExportStatus("Please connect your Google Account first.");
      return;
    }
    const savedKeys = Object.keys(savedScans);
    if (savedKeys.length === 0) {
      setDriveExportStatus("No historic scanned stocks are currently saved to backup.");
      return;
    }

    setIsDriveLoading(true);
    setDriveExportStatus("Streaming database to backend & uploading directly to Google Drive...");
    setDriveLink(null);

    try {
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, "0");
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      const filename = `Stock_Anomalies_History_Backup_${timestamp}.csv`;
      
      const res = await fetch("/api/export-drive-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ savedScans, markets, driveToken, filename })
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Export API error: ${errorText}`);
      }

      const result = await res.json();
      
      setDriveExportStatus(`Relational CSV backup uploaded to Drive as "${filename}"!`);
      if (showBackupList) {
        handleFetchDriveBackups();
      }
    } catch (err: any) {
      console.error(err);
      setDriveExportStatus(`CSV backup to Drive failed: ${err.message || err}`);
    } finally {
      setIsDriveLoading(false);
    }
  };

  const handleFetchDriveBackups = async () => {
    if (!driveToken) {
      setDriveExportStatus("Please connect your Google Account first.");
      return;
    }
    setIsListingBackups(true);
    setDriveExportStatus("Querying Google Drive for database backups (JSON & CSV)...");
    try {
      const files = await listJSONBackupsInGoogleDrive(driveToken);
      setDriveBackups(files);
      setShowBackupList(true);
      if (files.length === 0) {
        setDriveExportStatus("No Sandbox database files (.json/.csv) found on your Google Drive.");
      } else {
        setDriveExportStatus(`Discovered ${files.length} database backup file(s) on Google Drive.`);
      }
    } catch (err: any) {
      console.error(err);
      setDriveExportStatus(`Failed to search backups: ${err.message || err}`);
    } finally {
      setIsListingBackups(false);
    }
  };

  const handleImportDriveBackup = async (fileId: string) => {
    if (!driveToken) return;
    setIsDriveLoading(true);
    setDriveExportStatus("Downloading file from Google Drive...");
    try {
      const textContent = await downloadTextFromGoogleDrive(driveToken, fileId);
      const isJson = textContent.trim().startsWith("{") || textContent.trim().startsWith("[");
      
      let parsed: Record<string, StockScanResult> = {};
      if (isJson) {
        parsed = JSON.parse(textContent);
      } else {
        parsed = parseStockCSV(textContent);
      }

      if (typeof parsed !== "object" || parsed === null || Object.keys(parsed).length === 0) {
        throw new Error("Invalid structure, empty format or no stock profiles detected inside the document.");
      }
      
      const parsedKeys = Object.keys(parsed);
      const action = confirm(`Successfully parsed ${parsedKeys.length} stock profiles from Google Drive file. Do you want to MERGE these onto your current sandbox (${Object.keys(savedScans).length} items)? Click OK to MERGE, Cancel to OVERWRITE.`);
      let merged;
      if (action) {
        merged = { ...savedScans, ...parsed };
      } else {
        merged = parsed;
      }

      setSavedScans(merged);
      safeSaveScans(merged);
      setDriveExportStatus(`Database restored/merged successfully! Loaded ${parsedKeys.length} constituent profile(s).`);
    } catch (err: any) {
      console.error(err);
      setDriveExportStatus(`Failed to import backup: ${err.message || err}`);
    } finally {
      setIsDriveLoading(false);
    }
  };

  const handleTriggerDrivePicker = async () => {
    if (!driveToken) {
      setDriveExportStatus("Please connect your Google Account first.");
      return;
    }
    setIsDrivePickerOpen(true);
    setDrivePickerError(null);
    handleSearchDrivePicker("");
  };

  const handleSearchDrivePicker = async (queryStr: string) => {
    if (!driveToken) return;
    setIsSearchingPicker(true);
    setDrivePickerError(null);
    try {
      const files = await searchDriveBackupFiles(driveToken, queryStr);
      setDrivePickerFiles(files);
    } catch (err: any) {
      console.error(err);
      setDrivePickerError(err.message || "Failed to search Drive files");
    } finally {
      setIsSearchingPicker(false);
    }
  };

  const fetchCacheStats = async () => {
    try {
      const response = await fetch("/api/cache-stats");
      if (response.ok) {
        const data = await response.json();
        setCacheStats(data);
      }
    } catch (e) {
      console.warn("Failed fetching cache stats due to temporary server network changes", e);
    }
  };

  useEffect(() => {
    fetchCacheStats();
  }, [scanResult]);

  const handlePreloadMarket = async () => {
    const activeMarket = markets[selectedMarketIndex];
    if (!activeMarket || activeMarket.stocks.length === 0) return;

    setIsPreloading(true);
    setPreloadProgress("Initializing preloader...");

    const symbols = activeMarket.stocks.map(s => s.symbol).slice(0, 15); // process top 15 in this active exchange
    
    try {
      setPreloadProgress(`Processing sequential scan for top ${symbols.length} tickers in "${activeMarket.name}"...`);
      const response = await fetch("/api/preload-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: symbols,
          maxRequests: 15,
        })
      });

      let data;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const textStr = await response.text();
        throw new Error(cleanErrorMessage(textStr, response.status));
      }

      if (!response.ok) {
        throw new Error(data.error || "Batch request failed.");
      }
      setPreloadProgress(`Success! Loaded ${data.successCount} of ${data.totalProcessed} tickers.`);
      fetchCacheStats();
    } catch (e: any) {
      setPreloadProgress(`Error during preload: ${e.message}`);
    } finally {
      setIsPreloading(false);
      setTimeout(() => setPreloadProgress(""), 6000);
    }
  };

  // Sync markets to localstorage
  useEffect(() => {
    localStorage.setItem("anomaly_detector_markets", JSON.stringify(markets));
  }, [markets]);

  // QoL Feature States
  const [showSearchSuggestions, setShowSearchSuggestions] = useState<boolean>(false);
  const [isSimulatingLive, setIsSimulatingLive] = useState<boolean>(false);
  const [liveIntervalRate] = useState<number>(3); // Tick once every 3 seconds
  const [savedMinAnomaliesFilter, setSavedMinAnomaliesFilter] = useState<number>(0);
  const [stockNotes, setStockNotes] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem("stock_user_notes_v1");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Feature 1: Autocomplete list for Ticker searches
  const allTickerOptions = useMemo(() => {
    const list: StockAsset[] = [];
    const seen = new Set<string>();
    markets.forEach((m) => {
      m.stocks.forEach((s) => {
        const key = s.symbol.toUpperCase();
        if (!seen.has(key)) {
          seen.add(key);
          list.push(s);
        }
      });
    });
    return list;
  }, [markets]);

  const filteredSuggestions = useMemo(() => {
    const sTrimmed = (symbol || "").trim();
    if (!sTrimmed || allTickerOptions.some(o => o.symbol.toUpperCase() === sTrimmed.toUpperCase())) {
      return [];
    }
    const q = sTrimmed.toUpperCase();
    return allTickerOptions.filter((o) => 
      o.symbol.toUpperCase().startsWith(q) || 
      o.companyName.toUpperCase().includes(q)
    ).slice(0, 6);
  }, [symbol, allTickerOptions]);

  // Feature 12: Notes persist handers
  const handleSaveNote = (sym: string, noteText: string) => {
    const updated = { ...stockNotes, [sym.toUpperCase()]: noteText };
    setStockNotes(updated);
    localStorage.setItem("stock_user_notes_v1", JSON.stringify(updated));
  };

  // Feature 2: Bulk clear confirmed
  const handleClearSavedScans = () => {
    if (confirm("Are you sure you want to permanently empty your Saved Sandbox cache and historical scan data? File uploads and local storage backups will be cleared.")) {
      setSavedScans({});
      localStorage.removeItem("saved_scans_history_v2");
    }
  };

  // Feature 6 & 7: Exports
  const handleLocalCSVDownload = async () => {
    try {
      setDriveExportStatus("Streaming local CSV export...");
      const res = await fetch("/api/export-local-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ savedScans, markets })
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Stock_Anomalies_LocalExport_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      setDriveExportStatus("");
    } catch (err: any) {
      console.error(err);
      setDriveExportStatus(`CSV export failed: ${err.message || err}`);
    }
  };

  const handleBackupExportJSON = () => {
    const jsonStr = JSON.stringify(savedScans, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `AnomalySandbox_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
  };

  const handleDownloadStandaloneEnvironment = async () => {
    try {
      setIsExportingEnvironment(true);
      setEnvironmentExportStatus("Compiling local sandbox environment, hot-copying SQLite cache, and sanitizing core secrets...");
      
      const res = await fetch("/api/export-environment");
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Failed packaging the environment ZIP.");
      }
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Attribution_Platform_Portable_Suite_${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      
      setEnvironmentExportStatus("Success! Standalone environment ZIP downloaded cleanly. Deflate and run setup.sh or setup.bat to deploy locally.");
      
      setTimeout(() => {
        setEnvironmentExportStatus(null);
      }, 7000);
    } catch (err: any) {
      console.error(err);
      setEnvironmentExportStatus(`Desktop export failed: ${err.message || err}`);
    } finally {
      setIsExportingEnvironment(false);
    }
  };

  // Feature 14: Import backup JSON
  const handleJSONImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (typeof parsed !== "object" || parsed === null) {
          throw new Error("Invalid structure");
        }
        const merged = { ...savedScans, ...parsed };
        setSavedScans(merged);
        safeSaveScans(merged);
        showSuccess("Backup scan results imported successfully! " + Object.keys(parsed).length + " profile profiles merged.");
      } catch (err) {
        setError("Failed to parse JSON backup. Assure the document is a valid serialized savedScans package.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Import backup CSV of the same format as the output
  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = parseStockCSV(text);
        const parsedKeys = Object.keys(parsed);
        if (parsedKeys.length === 0) {
          throw new Error("No active stock profiles found inside the CSV.");
        }
        
        const shouldMerge = confirm(`Successfully parsed ${parsedKeys.length} stock profiles from the CSV. Do you want to MERGE these onto your current sandbox (${Object.keys(savedScans).length} items)? Click OK to MERGE, Cancel to OVERWRITE.`);
        let merged;
        if (shouldMerge) {
          merged = { ...savedScans, ...parsed };
        } else {
          merged = parsed;
        }

        setSavedScans(merged);
        safeSaveScans(merged);
        showSuccess(`CSV import successful! Loaded catalog profiles: ${parsedKeys.join(", ")}`);
      } catch (err: any) {
        setError("Failed to parse CSV. Make sure the document conforms exactly to the exported CSV format: " + (err.message || err));
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Feature 13: Simulated real-time price loop
  useEffect(() => {
    if (!isSimulatingLive || !scanResult) return;
    const interval = setInterval(() => {
      setScanResult((prev) => {
        if (!prev || prev.points.length === 0) return prev;
        const lastIdx = prev.points.length - 1;
        const lastPoint = prev.points[lastIdx];
        
        // Simulating a tiny fluctuation between -0.4% and +0.4%
        const pctChange = (Math.random() - 0.5) * 0.008;
        const newClose = lastPoint.close * (1 + pctChange);
        const newReturn = pctChange * 100;

        const updatedPoints = [...prev.points];
        updatedPoints[lastIdx] = {
          ...lastPoint,
          close: Number(newClose.toFixed(2)),
          dailyReturn: Number(newReturn.toFixed(2)),
        };

        return {
          ...prev,
          points: updatedPoints,
        };
      });
    }, liveIntervalRate * 1000);

    return () => clearInterval(interval);
  }, [isSimulatingLive, scanResult, liveIntervalRate]);

  // Auto-scan on boot or load saved data
  useEffect(() => {
    const keys = Object.keys(savedScans);
    if (keys.length > 0) {
      // Auto-load the first saved scan result
      const firstKey = keys[0];
      const savedRes = savedScans[firstKey];
      setScanResult(savedRes);
      setSymbol(savedRes.symbol);
      setYears(
        savedRes.meta?.range === "2y"
          ? 2
          : savedRes.meta?.range === "5y"
          ? 5
          : savedRes.meta?.range === "6m"
          ? 0.5
          : 1
      );
      if (savedRes.anomalies && savedRes.anomalies.length > 0) {
        setSelectedAnomalyDate(savedRes.anomalies[0].date);
      }
    } else {
      if (new URLSearchParams(window.location.search).get("autorun") === "true") {
        handleScan("TSLA", 5, 2.15);
      }
    }
  }, []);

  const getAllUnscannedStocks = () => {
    if (!markets) return [];
    const allSymbols: string[] = Array.from(new Set(
      markets.flatMap(m => m?.stocks?.map(s => s?.symbol?.toUpperCase().trim()).filter((s): s is string => !!s) || [])
    ));
    const savedKeysUpper = new Set(Object.keys(savedScans || {}).map(k => k.toUpperCase().trim()));
    return allSymbols.filter(sym => !savedKeysUpper.has(sym));
  };

  const handleScanAllUnscanned = async () => {
    if (isScanAllRunning) {
      scanAllPauseRef.current = true;
      setScanAllProgressText("Pause requested. Gracefully stopping after current batch...");
      return;
    }

    const unscanned = getAllUnscannedStocks();
    if (unscanned.length === 0) {
      setError("All stocks across all markets have already been scanned!");
      return;
    }

    scanAllPauseRef.current = false;
    setIsScanAllRunning(true);
    setScanAllTotal(unscanned.length);
    setScanAllProcessed(0);
    setError(null);

    const batchSize = 10;
    let currentIndex = 0;

    while (currentIndex < unscanned.length) {
      if (scanAllPauseRef.current) {
        setScanAllProgressText("Batch scan paused. Progress has been stored.");
        break;
      }

      const chunk = unscanned.slice(currentIndex, currentIndex + batchSize);
      const batchNum = Math.floor(currentIndex / batchSize) + 1;
      const totalBatches = Math.ceil(unscanned.length / batchSize);
      setScanAllProgressText(`Scanning batch ${batchNum} of ${totalBatches}: ${chunk.join(", ")}...`);

      try {
        const response = await fetch("/api/stock-scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: chunk, // Send the array of symbols for bulk scanning!
            years: years,
            zScoreThreshold: zScoreThreshold,
          }),
        });

        let data;
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          data = await response.json();
        } else {
          const textStr = await response.text();
          throw new Error(cleanErrorMessage(textStr, response.status));
        }

        if (!response.ok) {
          throw new Error(data.error || "Batch scan failed");
        }

        if (data.multi) {
          if (data.rateLimitedSources) {
            setRateLimitedSources((prev) => Array.from(new Set([...prev, ...data.rateLimitedSources])));
          }
          setSavedScans((prev) => {
            const next = { ...prev, ...data.results };
            safeSaveScans(next);
            return next;
          });
        } else if (data.symbol) {
          if (data.rateLimitedSources) {
            setRateLimitedSources((prev) => Array.from(new Set([...prev, ...data.rateLimitedSources])));
          }
          setSavedScans((prev) => {
            const next = { ...prev, [data.symbol.toUpperCase()]: data };
            safeSaveScans(next);
            return next;
          });
        }

        currentIndex += chunk.length;
        setScanAllProcessed(currentIndex);

        // Check if any critical API provider was newly marked rate limited after this successful batch
        const activeLimits = data?.rateLimitedSources || [];
        const isCriticalLimitActive = activeLimits.some((s: string) => 
          s.toLowerCase().includes("fmp") || 
          s.toLowerCase().includes("financial modeling") || 
          s.toLowerCase().includes("polygon")
        );

        if (isCriticalLimitActive) {
          setScanAllProgressText(`⚠️ API Limit Reached during scan! Remaining scan paused after chunk [${chunk.join(", ")}].`);
          scanAllPauseRef.current = true;
          break;
        }

        // Add a gentle rate-limit buffer before starting the next batch, if we have more left to do
        if (currentIndex < unscanned.length && !scanAllPauseRef.current) {
          setScanAllProgressText(`Preparing next batch... Pausing 1.2s to prevent rate limits.`);
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      } catch (err: any) {
        console.error("Scan all batch issue:", err);
        const errMsg = (err.message || "").toLowerCase();
        const isRateLimit =
          errMsg.includes("429") ||
          errMsg.includes("quota") ||
          errMsg.includes("rate limit") ||
          errMsg.includes("limit has been reached") ||
          errMsg.includes("limit active") ||
          errMsg.includes("fmp limit") ||
          errMsg.includes("polygon limit") ||
          errMsg.includes("eodhd limit") ||
          errMsg.includes("exhausted") ||
          errMsg.includes("throttled") ||
          rateLimitedSources.length > 0;

        if (isRateLimit) {
          console.warn("[Scanner] Critical API rate limit triggered. Pausing background scanner loop.");
          setScanAllProgressText(`⚠️ API Limit Reached! Scan paused at tickers [${chunk.join(", ")}]. Reset your API key or resume manually later.`);
          scanAllPauseRef.current = true;
          break; // Exits the while loop, stops scanning, avoids incrementing currentIndex!
        } else {
          // Normal error handling for temporary ticker-specific glitches
          setScanAllProgressText(`Error scanning [${chunk.join(", ")}]: ${err.message || err}. Continuing in 2s...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          currentIndex += chunk.length;
          setScanAllProcessed(currentIndex);
        }
      }
    }

    setIsScanAllRunning(false);
  };

  const handleBatchUpdate = async () => {
    const keys = Object.keys(savedScans);
    if (keys.length === 0) {
      setBatchUpdateStatus("No saved scans found to update.");
      setTimeout(() => setBatchUpdateStatus(null), 3000);
      return;
    }

    setIsBatchUpdating(true);
    setBatchUpdateStatus("Preparing batch updates...");
    setError(null);

    try {
      // Compile mapping of symbol -> lastTimestamp based on currently saved points
      const currentScans: Record<string, number> = {};
      keys.forEach((sym) => {
        const pts = savedScans[sym].points || [];
        const lastPt = pts[pts.length - 1];
        currentScans[sym] = lastPt ? lastPt.timestamp : 0;
      });

      setBatchUpdateStatus("Contacting Gemini batch processing...");
      const response = await fetch("/api/batch-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentScans }),
      });

      let data: any;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const textStr = await response.text();
        throw new Error(cleanErrorMessage(textStr, response.status));
      }

      // Check if we got rate limited (either explicitly 429 or through response payload)
      const isRateLimited = response.status === 429 || data?.isRateLimited;
      if (data?.rateLimitedSources) {
        setRateLimitedSources((prev) => Array.from(new Set([...prev, ...data.rateLimitedSources])));
      }

      const { updatedCount = 0, updated = {}, skippedCount = 0 } = data || {};

      if (updatedCount > 0) {
        setSavedScans((prev) => {
          const next = { ...prev, ...updated };
          safeSaveScans(next);
          
          // If the currently displayed active result was updated, update its instance too
          if (scanResult && updated[scanResult.symbol.toUpperCase()]) {
            setScanResult(updated[scanResult.symbol.toUpperCase()]);
          }
          return next;
        });
      }

      if (isRateLimited) {
        setBatchUpdateStatus(`⚠️ API Limit Reached! Partial update saved (${updatedCount} updated, ${skippedCount} skipped).`);
      } else if (response.ok) {
        if (updatedCount > 0) {
          setBatchUpdateStatus(`Complete! Updated ${updatedCount} stocks, ${skippedCount} up to date.`);
        } else {
          setBatchUpdateStatus("All scanned stocks are already up to date.");
        }
      } else {
        throw new Error(data.error || "Batch update failed on server.");
      }

      setTimeout(() => setBatchUpdateStatus(null), 5000);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed running batch stock updates.");
      setBatchUpdateStatus("Update failed.");
      setTimeout(() => setBatchUpdateStatus(null), 3000);
    } finally {
      setIsBatchUpdating(false);
    }
  };

  const handleCompetitorsLoaded = (newCompetitors: { symbol: string, companyName: string }[]) => {
    setMarkets(prevMarkets => {
      let hasChanges = false;
      let newMarkets = [...prevMarkets];
      
      let compsMarketIndex = newMarkets.findIndex(m => m.name === "Discovered Competitors");
      
      if (compsMarketIndex === -1) {
        newMarkets.push({ name: "Discovered Competitors", stocks: [] });
        compsMarketIndex = newMarkets.length - 1;
        hasChanges = true;
      }

      const allKnownSymbols = new Set<string>();
      newMarkets.forEach(m => m.stocks.forEach(s => allKnownSymbols.add(s.symbol)));

      for (const comp of newCompetitors) {
        if (!allKnownSymbols.has(comp.symbol)) {
          newMarkets[compsMarketIndex].stocks.push({ symbol: comp.symbol, companyName: comp.companyName });
          allKnownSymbols.add(comp.symbol);
          hasChanges = true;
        }
      }

      if (hasChanges) {
        localStorage.setItem("anomaly_detector_markets", JSON.stringify(newMarkets));
        return newMarkets;
      }
      return prevMarkets;
    });
  };

  const handleScan = async (searchSymbol: string, rangeYears: number, sensitivity: number) => {
    if (scanAbortControllerRef.current) {
      scanAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    scanAbortControllerRef.current = controller;

    let isTimeout = false;
    const timeoutId = setTimeout(() => {
      isTimeout = true;
      controller.abort();
    }, 180000);

    setIsLoading(true);
    setError(null);
    setSelectedAnomalyDate(null);
    setMultiResults(null);
    setStressOverrides({});
    setStressOverrideDate("");
    setStressOverrideValue(0);

    try {
      const response = await fetch("/api/stock-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: searchSymbol,
          years: rangeYears,
          zScoreThreshold: sensitivity,
          forceRescan: true,
        }),
        signal: controller.signal,
      });

      let data;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        await response.text();
        throw new Error("The server is busy or the scan timed out — please try again");
      }

      if (!response.ok) {
        throw new Error(data.error || "Tactical scan execution failed.");
      }

      if (data.multi) {
        if (data.rateLimitedSources) {
          setRateLimitedSources((prev) => Array.from(new Set([...prev, ...data.rateLimitedSources])));
        }
        setMultiResults(data.results);
        setActiveLeftTab("market");
        // Default scanResult to the first valid result ticker found
        const firstTicker = Object.keys(data.results)[0];
        if (firstTicker && data.results[firstTicker]) {
          setScanResult(data.results[firstTicker]);
          if (data.results[firstTicker].anomalies && data.results[firstTicker].anomalies.length > 0) {
            setSelectedAnomalyDate(data.results[firstTicker].anomalies[0].date);
          }
        }
        setSavedScans(prev => {
          const next = { ...prev, ...data.results };
          safeSaveScans(next);
          return next;
        });
      } else {
        if (data.rateLimitedSources) {
          setRateLimitedSources((prev) => Array.from(new Set([...prev, ...data.rateLimitedSources])));
        }
        setScanResult(data);
        setActiveLeftTab("focused");
        if (data.anomalies && data.anomalies.length > 0) {
          setSelectedAnomalyDate(data.anomalies[0].date);
        }
        setSavedScans(prev => {
          const next = { ...prev, [data.symbol]: data };
          safeSaveScans(next);
          return next;
        });
      }
      setActiveMainTab("stock");
    } catch (err: any) {
      if (err.name === "AbortError" || err.message?.includes("aborted")) {
        if (isTimeout) {
          setError("The scan took too long and was stopped. Try a shorter date range or a single symbol.");
        } else {
          setError("Tactical scan cancelled by user.");
        }
      } else {
        setError(err.message || "Failed historical scan execution.");
      }
      setScanResult(null);
      setMultiResults(null);
    } finally {
      clearTimeout(timeoutId);
      if (scanAbortControllerRef.current === controller) {
        scanAbortControllerRef.current = null;
      }
      setIsLoading(false);
    }
  };

  const handleCancelScan = () => {
    if (scanAbortControllerRef.current) {
      scanAbortControllerRef.current.abort();
      scanAbortControllerRef.current = null;
    }
    setIsLoading(false);
    setError("Tactical scan cancelled by user.");
  };

  const executeManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol.trim()) return;
    handleScan(symbol.toUpperCase().trim(), years, zScoreThreshold);
  };

  const handleQuickScan = (ticker: string) => {
    setSymbol(ticker);
    handleScan(ticker, years, zScoreThreshold);
  };

  const handleAddMarket = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newMarketName.toUpperCase().trim();
    if (!cleanName) return;
    const exists = markets.some(m => m.name.toUpperCase() === cleanName.toUpperCase());
    if (exists) {
      setError("A market with this name already exists.");
      return;
    }
    const updated = [...markets, { name: cleanName, stocks: [] }];
    setMarkets(updated);
    setSelectedMarketIndex(updated.length - 1);
    setNewMarketName("");
    setShowAddMarket(false);
  };

  const handleDeleteMarket = (index: number) => {
    if (markets.length <= 1) {
      setError("You must keep at least one market.");
      return;
    }
    if (confirm(`Are you sure you want to delete the market "${markets[index].name}" and all its stocks?`)) {
      const updated = markets.filter((_, idx) => idx !== index);
      setMarkets(updated);
      setSelectedMarketIndex(0);
    }
  };

  const handleAddStock = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSymbol = newStockSymbol.toUpperCase().trim();
    if (!cleanSymbol) return;
    const activeMarket = markets[selectedMarketIndex];
    if (!activeMarket) return;
    
    const exists = activeMarket.stocks.some(s => s.symbol === cleanSymbol);
    if (exists) {
      setError("This symbol already exists in this market.");
      return;
    }
    
    const updatedStocks = [...activeMarket.stocks, {
      symbol: cleanSymbol,
      companyName: newStockName.trim() || `${cleanSymbol} Asset`
    }];
    
    const updatedMarkets = markets.map((m, idx) => {
      if (idx === selectedMarketIndex) {
        return { ...m, stocks: updatedStocks };
      }
      return m;
    });
    
    setMarkets(updatedMarkets);
    setNewStockSymbol("");
    setNewStockName("");
    setShowAddStock(false);
  };

  const handleDeleteStock = (stockSymbol: string) => {
    const activeMarket = markets[selectedMarketIndex];
    if (!activeMarket) return;
    const updatedStocks = activeMarket.stocks.filter(s => s.symbol !== stockSymbol);
    const updatedMarkets = markets.map((m, idx) => {
      if (idx === selectedMarketIndex) {
        return { ...m, stocks: updatedStocks };
      }
      return m;
    });
    setMarkets(updatedMarkets);
  };

  const handleScanMarket = (marketIndex: number) => {
    const currentMarket = markets[marketIndex];
    if (!currentMarket || currentMarket.stocks.length === 0) return;
    const symbolsCsv = currentMarket.stocks.map(s => s.symbol).join(",");
    setSymbol(currentMarket.stocks[0].symbol);
    handleScan(symbolsCsv, years, zScoreThreshold);
  };

  const handleResetAndRescan = async () => {
    if (!symbol || !symbol.trim()) return;
    try {
      await fetch("/api/clear-checkpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol })
      });
      // Now do a normal scan
      handleScan(symbol, years, zScoreThreshold);
    } catch (err) {
      console.error("Failed to clear checkpoints:", err);
    }
  };

  const handleAnalyzeAnomaly = async (date: string, returnVal: number, zScore: number) => {
    if (analyzingDates.includes(date)) return;
    setAnalyzingDates((prev) => [...prev, date]);

    try {
      const pObj = scanResult?.points.find((p) => p.date === date);
      
      const response = await fetch("/api/analyze-anomaly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: scanResult?.symbol || symbol,
          date,
          dailyReturn: returnVal,
          zScore,
          return_1d: pObj?.analysis?.return_1d,
          return_1w: pObj?.analysis?.return_1w,
          return_1m: pObj?.analysis?.return_1m,
          return_6m: pObj?.analysis?.return_6m,
          return_1y: pObj?.analysis?.return_1y,
        }),
      });

      let data;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const textStr = await response.text();
        throw new Error(cleanErrorMessage(textStr, response.status));
      }

      if (!response.ok) {
        throw new Error(data.error || "Analysis failed.");
      }

      // Update scanResult points & anomalies with newly generated AI analysis inline
      if (scanResult) {
        const updatedPoints = scanResult.points.map((p) => {
          if (p.date === date) {
            return { ...p, hasAnalysis: true, analysis: data.analysis };
          }
          return p;
        });

        const updatedAnomalies = scanResult.anomalies.map((a) => {
          if (a.date === date) {
            return { ...a, hasAnalysis: true, analysis: data.analysis };
          }
          return a;
        });

        const updatedResult = {
          ...scanResult,
          points: updatedPoints,
          anomalies: updatedAnomalies,
        };

        setScanResult(updatedResult);
        setSavedScans(prev => {
          const next = { ...prev, [updatedResult.symbol]: updatedResult };
          safeSaveScans(next);
          return next;
        });
      }
    } catch (err: any) {
      setError(`AI Analyst Error: ${err.message || "Failed to query Gemini AI models."}`);
    } finally {
      setAnalyzingDates((prev) => prev.filter((d) => d !== date));
    }
  };

  // What-if dynamic cascading calculations logic
  const computedPoints = useMemo(() => {
    if (!scanResult || !scanResult.points || scanResult.points.length === 0) return [];
    if (Object.keys(stressOverrides).length === 0) return scanResult.points;

    // Deep clone to avoid mutating standard cached stock data objects
    const pointsCopy = JSON.parse(JSON.stringify(scanResult.points)) as StockPoint[];
    
    // Ensure chronological order
    pointsCopy.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Apply any customized return overrides and recompute close prices
    for (let i = 0; i < pointsCopy.length; i++) {
      const p = pointsCopy[i];
      if (stressOverrides[p.date] !== undefined) {
        p.dailyReturn = stressOverrides[p.date];
        if (i > 0) {
          p.close = pointsCopy[i - 1].close * (1 + p.dailyReturn / 100);
        }
      } else if (i > 0 && Object.keys(stressOverrides).some(d => new Date(d).getTime() <= new Date(p.date).getTime())) {
        // Cascade changes forward for closing prices
        p.close = pointsCopy[i - 1].close * (1 + p.dailyReturn / 100);
      }
    }

    // Now recalculate rolling standard deviations and relative Z-scores (rolling window 90 days)
    const windowSize = 90;
    for (let i = 0; i < pointsCopy.length; i++) {
      const rollingStart = Math.max(0, i - windowSize + 1);
      const slice = pointsCopy.slice(rollingStart, i + 1);
      const returns = slice.map((item) => item.dailyReturn);
      
      const mean = returns.reduce((sum, val) => sum + val, 0) / returns.length;
      const squaredDiffs = returns.map((val) => Math.pow(val - mean, 2));
      const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / returns.length;
      const stdDev = Math.sqrt(variance);

      pointsCopy[i].rollingStd = Math.max(0.0001, stdDev);
      pointsCopy[i].zScore = stdDev > 0 ? (pointsCopy[i].dailyReturn - mean) / stdDev : 0;
      pointsCopy[i].isAnomaly = Math.abs(pointsCopy[i].zScore) >= zScoreThreshold;
    }

    return pointsCopy;
  }, [scanResult, stressOverrides, zScoreThreshold]);

  const computedAnomalies = useMemo(() => {
    if (!scanResult) return [];
    if (Object.keys(stressOverrides).length === 0) return scanResult.anomalies || [];
    
    return computedPoints
      .filter((p) => p.isAnomaly)
      .map((p) => {
        const existing = (scanResult.anomalies || []).find((a) => a.date === p.date);
        return {
          ...p,
          hasAnalysis: existing ? existing.hasAnalysis : false,
          analysis: existing ? existing.analysis : undefined,
          isSimulated: existing ? false : true,
        } as StockPoint;
      });
  }, [scanResult, computedPoints, stressOverrides]);

  // Compute stats card values
  const getStatsSummary = () => {
    if (!scanResult || computedPoints.length === 0) return null;
    const pts = computedPoints;
    const initialPrice = pts[0].close;
    const finalPrice = pts[pts.length - 1].close;
    const netReturnVal = ((finalPrice - initialPrice) / initialPrice) * 100;

    const highestClose = Math.max(...pts.map((p) => p.close));
    const lowestClose = Math.min(...pts.map((p) => p.close));

    // Calculate historical volatility rating (Average absolute Daily return)
    const avgReturnDev = pts.reduce((sum, p) => sum + Math.abs(p.dailyReturn), 0) / pts.length;

    return {
      lastPrice: finalPrice,
      netReturn: netReturnVal,
      highClose: highestClose,
      lowClose: lowestClose,
      volatility: avgReturnDev,
    };
  };

  const stats = getStatsSummary();

  const processedSavedScans: StockScanResult[] = (Object.values(savedScans) as any[]).filter((res: any) => {
    const q = savedSearch.toLowerCase();
    const ticker = (res.symbol || "").toLowerCase();
    const name = (res.companyName || "").toLowerCase();
    const currency = (res.currency || "").toLowerCase();
    
    const matchesQuery = ticker.includes(q) || name.includes(q) || currency.includes(q);
    if (!matchesQuery) return false;

    // QoL Filter: Minimum anomaly count slider requirement
    const anomaliesCount = res.anomalies?.length || 0;
    return anomaliesCount >= savedMinAnomaliesFilter;
  });

  processedSavedScans.sort((a, b) => {
    let valA: any = "";
    let valB: any = "";

    if (savedSortBy === "name") {
      valA = a.symbol;
      valB = b.symbol;
    } else if (savedSortBy === "market") {
      valA = findMarketForSymbol(a.symbol);
      valB = findMarketForSymbol(b.symbol);
    } else if (savedSortBy === "anomalies") {
      valA = a.anomalies?.length || 0;
      valB = b.anomalies?.length || 0;
    } else if (savedSortBy === "return") {
      valA = getNetReturn(a);
      valB = getNetReturn(b);
    } else if (savedSortBy === "volatility") {
      valA = getVolatility(a);
      valB = getVolatility(b);
    }

    if (typeof valA === "string") {
      const comp = valA.localeCompare(valB);
      return savedSortOrder === "asc" ? comp : -comp;
    } else {
      const comp = (valA as number) - (valB as number);
      return savedSortOrder === "asc" ? comp : -comp;
    }
  });

  const filteredBulkList = multiResults ? Object.entries(multiResults).filter(([ticker, rawRes]) => {
    const res = rawRes as StockScanResult;
    // Search match
    const matchesSearch = ticker.toLowerCase().includes(bulkSearch.toLowerCase()) || 
      (res.companyName && res.companyName.toLowerCase().includes(bulkSearch.toLowerCase()));
      
    if (!matchesSearch) return false;
    
    // Tab filter match
    if (bulkFilter === "anomalies") return (res.anomalies?.length || 0) > 0;
    if (bulkFilter === "gainers") {
      const resPoints = res.points || [];
      const netRet = resPoints.length > 0 
        ? ((resPoints[resPoints.length - 1].close - resPoints[0].close) / resPoints[0].close) * 100 
        : 0;
      return netRet > 0;
    }
    if (bulkFilter === "decliners") {
      const resPoints = res.points || [];
      const netRet = resPoints.length > 0 
        ? ((resPoints[resPoints.length - 1].close - resPoints[0].close) / resPoints[0].close) * 100 
        : 0;
      return netRet < 0;
    }
    return true;
  }) : [];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 flex flex-col font-sans selection:bg-blue-550/20 selection:text-blue-300">
      {/* Navigation Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4.5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_#10b981]"></div>
            <span className="font-bold text-[11px] tracking-widest uppercase text-zinc-100 font-sans">
              Market Ecosystem AI Engine v5.0.2 &bull; Stock Catalyst Historian
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-zinc-500">
            <span>Connected to <strong className="text-zinc-300">Gemini-3.5-Flash</strong></span>
            <span className="text-zinc-700">&bull;</span>
            <span title={cacheStats?.scannedSymbols?.join(", ")}>Intel Cache: <strong className="text-blue-400 uppercase">{cacheStats ? `${cacheStats.totalCachedAnomalies} Events (${cacheStats.uniquelySymbolScannedCount} Stocks)` : "Loading..."}</strong></span>
            <span className="text-zinc-700">&bull;</span>
            <button
              id="header-export-to-desktop"
              type="button"
              onClick={handleDownloadStandaloneEnvironment}
              disabled={isExportingEnvironment}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-sans font-bold uppercase tracking-wider transition-all border shadow-sm cursor-pointer ${
                isExportingEnvironment
                  ? "bg-amber-955/20 text-amber-500 border-amber-900/40 cursor-not-allowed animate-pulse"
                  : "bg-amber-900/20 hover:bg-amber-900/30 text-amber-400 hover:text-amber-200 border-amber-900/40 hover:border-amber-700/60"
              }`}
              title="Compile, sanitize, and download entire interactive environment with live database to local desktop machine"
            >
              <FolderDown className={`w-3.5 h-3.5 text-amber-400 ${isExportingEnvironment ? "animate-bounce" : ""}`} />
              <span>{isExportingEnvironment ? "Exporting..." : "Export to Desktop"}</span>
            </button>
          </div>
        </div>
        {environmentExportStatus && (
          <div id="header-env-export-status" className={`border-t border-b text-[10.5px] font-mono py-2 px-6 leading-relaxed transition-all text-center ${
            environmentExportStatus.includes("failed") || environmentExportStatus.includes("failed:")
              ? "bg-rose-955/20 border-rose-900/30 text-rose-400"
              : environmentExportStatus.includes("Success")
              ? "bg-emerald-955/20 border-emerald-900/30 text-emerald-400"
              : "bg-amber-955/20 border-amber-900/30 text-amber-300 animate-pulse"
          }`}>
            {environmentExportStatus}
          </div>
        )}
      </header>

      {/* Main Terminal Grid System */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 space-y-6">

        {/* Main Tab Navigation Bar */}
        <div className="bg-zinc-900 border border-zinc-850 rounded-xl p-2.5 flex flex-wrap gap-2 shadow-lg">
          <button
            type="button"
            id="tab-nav-volatility"
            onClick={() => setActiveMainTab("volatility")}
            className={`flex-grow md:flex-initial min-w-[140px] px-4 py-3 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer border ${
              activeMainTab === "volatility"
                ? "bg-purple-950/40 text-purple-400 border-purple-500/35 font-semibold shadow-[0_0_12px_rgba(147,51,234,0.15)]"
                : "bg-zinc-950/40 border-zinc-900/60 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-950/20"
            }`}
          >
            <Globe className="w-4 h-4 text-purple-400 animate-spin-slow" />
            System Volatility
          </button>
          <button
            type="button"
            id="tab-nav-market"
            onClick={() => setActiveMainTab("market")}
            className={`flex-grow md:flex-initial min-w-[140px] px-4 py-3 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer border ${
              activeMainTab === "market"
                ? "bg-emerald-950/40 text-emerald-400 border-emerald-500/35 font-semibold shadow-[0_0_12px_rgba(16,185,129,0.15)]"
                : "bg-zinc-950/40 border-zinc-900/60 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-950/20"
            }`}
          >
            <Layers className="w-4 h-4 text-emerald-400" />
            Market Desks
          </button>
          <button
            type="button"
            id="tab-nav-stock"
            onClick={() => setActiveMainTab("stock")}
            className={`flex-grow md:flex-initial min-w-[140px] px-4 py-3 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer border ${
              activeMainTab === "stock"
                ? "bg-blue-950/40 text-blue-400 border-blue-500/35 font-semibold shadow-[0_0_12px_rgba(59,130,246,0.15)]"
                : "bg-zinc-950/40 border-zinc-900/60 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-950/20"
            }`}
          >
            <TrendingUp className="w-4 h-4 text-blue-400" />
            Focused Stock {scanResult ? `[${scanResult.symbol}]` : ""}
          </button>
          <button
            type="button"
            id="tab-nav-advisor"
            onClick={() => setActiveMainTab("advisor")}
            className={`flex-grow md:flex-initial min-w-[140px] px-4 py-3 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer border ${
              activeMainTab === "advisor"
                ? "bg-amber-950/40 text-amber-400 border-amber-500/35 font-semibold shadow-[0_0_12px_rgba(245,158,11,0.15)]"
                : "bg-zinc-950/40 border-zinc-900/60 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-950/20"
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
            AI Historian Consultant
          </button>
          <button
            type="button"
            id="tab-nav-settings"
            onClick={() => setActiveMainTab("settings")}
            className={`flex-grow md:flex-initial min-w-[140px] px-4 py-3 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer border ${
              activeMainTab === "settings"
                ? "bg-rose-950/40 text-rose-400 border-rose-500/35 font-semibold shadow-[0_0_12px_rgba(244,63,94,0.15)]"
                : "bg-zinc-950/40 border-zinc-900/60 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-950/20"
            }`}
          >
            <Database className="w-4 h-4 text-rose-400" />
            Database & Sync
          </button>
        </div>

        {activeMainTab === "volatility" && (
          /* Systemic Volatility Sector Bento Heat Panel */
          <section id="ecosystem-sector-map" className="bg-zinc-900 border border-zinc-805 rounded-xl shadow-sm overflow-hidden text-left animate-fade-in">
            <div className="p-4 bg-zinc-950/60 border-b border-zinc-850 flex items-center justify-between cursor-pointer select-none" onClick={() => setIsSectorMapExpanded(!isSectorMapExpanded)}>
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-purple-400 animate-spin-slow" />
                <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-widest font-mono">Systemic Volatility Sector Heat breakdown</h3>
                <span className="text-[10px] bg-purple-950 text-purple-300 font-mono px-1.5 py-0.5 rounded border border-purple-900">Predefined Macro Profiles</span>
              </div>
              <button type="button" className="text-xs text-zinc-400 hover:text-zinc-200 transition-all font-mono font-bold">
                {isSectorMapExpanded ? "[ Collapse Map ]" : "[ Expand Map ]"}
              </button>
            </div>

            {isSectorMapExpanded && (
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {/* Sector 1 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-amber-400 uppercase tracking-wider font-mono">Tech / AI & Cloud</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-rose-950/30 text-rose-300 border border-rose-900 rounded font-mono font-black uppercase">ELEVATED</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">AI Catalyst & Cloud Infrastructure</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">High outlier sensitivity due to microchip delivery cycles, datacenter capital expenditure guidance, and tech-sector earnings reports.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">NVDA, MSFT, AAPL, AMD, AMZN, GOOGL, META, AVGO, ORCL, QCOM, 0700.HK, SAP.DE, INFY, 6758.T</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Semiconductor Fabs, SaaS & Cyber, Media & Entertainment</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("NVDA,MSFT,AAPL,AMD,AMZN,GOOGL,META,AVGO,ORCL,QCOM,0700.HK,SAP.DE,INFY,6758.T", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-amber-600 hover:bg-amber-500 hover:scale-[1.01] transition-all text-zinc-950 rounded cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Sector 2 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-blue-400 uppercase tracking-wider font-mono">Fintech & Banking</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-blue-950/30 text-blue-300 border border-blue-900 rounded font-mono font-black uppercase">MODERATE</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">Fintech & Systemic Banking Desk</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">Responsive to Fed fund updates, credit card volume reports, consumer leverage stats, and localized fintech disruptions.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">JPM, V, MA, PYPL, SQ, MS, GS, BAC, COF, AXP, HSBA.L, BNP.PA, RY.TO, 8306.T, CBA.AX</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Tech / AI & Cloud, SaaS & Cyber, Consumer Retail, Real Estate</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("JPM,V,MA,PYPL,SQ,MS,GS,BAC,COF,AXP,HSBA.L,BNP.PA,RY.TO,8306.T,CBA.AX", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Sector 3 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-emerald-400 uppercase tracking-wider font-mono">Biotech & Pharma</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-emerald-950/30 text-emerald-300 border border-emerald-900 rounded font-mono font-black uppercase">HIGH DRIVERS</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">Clinical Development & Therapeutics</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">High outlier sensitivity triggered heavily by FDA approvals, phase results, and corporate patent exclusivity dates.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">LLY, MRK, PFE, AMGN, BIIB, GILD, MRNA, REGN, JNJ, ABBV, NOVOB.CO, ROG.SW, AZN.L, GSK.L, SAN.PA, 4502.T</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Tech / AI & Cloud, SaaS & Cyber</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("LLY,MRK,PFE,AMGN,BIIB,GILD,MRNA,REGN,JNJ,ABBV,NOVOB.CO,ROG.SW,AZN.L,GSK.L,SAN.PA,4502.T", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Sector 4 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-purple-400 uppercase tracking-wider font-mono">Energy & Power</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-zinc-900 text-zinc-400 border border-zinc-805 rounded font-mono font-black uppercase">LOW VOL</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">Fossil, Nuclear & Utility Power</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">Foundations of grid capacity and heavy logistical shipping, driven by nuclear energy re-acceleration and global oil benchmarks.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">XOM, CVX, CAT, GE, NEE, COP, SLB, ENPH, FSLR, DUK, SHEL.L, BP.L, TTE.PA, ENI.MI, EQNR.OL, IBE.MC</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Materials & Mining, Global Logistics, E-Mobility</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("XOM,CVX,CAT,GE,NEE,COP,SLB,ENPH,FSLR,DUK,SHEL.L,BP.L,TTE.PA,ENI.MI,EQNR.OL,IBE.MC", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Sector 5 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-zinc-400 uppercase tracking-wider font-mono">Consumer Retail</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-blue-950/30 text-blue-300 border border-blue-900 rounded font-mono font-black uppercase">STABLE</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">Hyper-Retail & Consumer Goods</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">Consumer credit status gauges, physical store networks, inventory turn metrics, and general retail foot-traffic trends.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">WMT, COST, TGT, HD, LOW, EL, NKE, SBUX, LULU, TJX, AMZN, MC.PA, OR.PA, ITX.MC, 9983.T, BABA</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Global Logistics, Fintech & Banking, Real Estate</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("WMT,COST,TGT,HD,LOW,EL,NKE,SBUX,LULU,TJX,AMZN,MC.PA,OR.PA,ITX.MC,9983.T,BABA", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Sector 6 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-cyan-400 uppercase tracking-wider font-mono">E-Mobility & Transit</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-cyan-950/30 text-cyan-300 border border-cyan-900 rounded font-mono font-black uppercase">VOLATILE</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">Automotive, Robotics & EV Transit</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">High-beta vehicle manufacturers, robotic delivery fleets, and autonomous navigation providers responding to regulatory tariffs and battery costs.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">TSLA, BYDDY, TM, GM, F, RIVN, LCID, STLA, HMC, RACE, 1211.HK, 7203.T, MBG.DE, BMW.DE, VOW3.DE</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Semiconductor Fabs, Energy & Power, Consumer Retail</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("TSLA,BYDDY,TM,GM,F,RIVN,LCID,STLA,HMC,RACE,1211.HK,7203.T,MBG.DE,BMW.DE,VOW3.DE", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Sector 7 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-orange-400 uppercase tracking-wider font-mono">Aerospace & Defense</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-orange-950/30 text-orange-300 border border-orange-900 rounded font-mono font-black uppercase">SENSITIVE</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">Defense, Space & Logistics</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">Responsive to global geopolitical friction, defense budget allocations, satellite constellations, and aerospace parts procurement.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">LMT, RTX, GD, NOC, BA, HEI, TDG, HWM, BWXT, LHX, AIR.PA, SAF.PA, BA.L, RHM.DE, RR.L</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Energy & Power, Tech / AI & Cloud, Semiconductor Fabs</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("LMT,RTX,GD,NOC,BA,HEI,TDG,HWM,BWXT,LHX,AIR.PA,SAF.PA,BA.L,RHM.DE,RR.L", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Sector 8 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-pink-400 uppercase tracking-wider font-mono">Semiconductor Fabs</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-pink-950/30 text-pink-300 border border-pink-900 rounded font-mono font-black uppercase">HIGH BETA</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">Lithography & Fab Materials</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">Capital expenditure backbones for advanced microchip fabs, EUV tooling limits, and specialized silicon wafer supply chains.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">ASML, AMAT, LRCX, KLAC, TSM, INTC, MU, TXN, ADI, ON, NVDA, AMD, 8035.T, IFX.DE, STM.PA, 6920.T</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Tech / AI & Cloud, SaaS & Cyber, E-Mobility</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("ASML,AMAT,LRCX,KLAC,TSM,INTC,MU,TXN,ADI,ON,NVDA,AMD,8035.T,IFX.DE,STM.PA,6920.T", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Sector 9 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-teal-400 uppercase tracking-wider font-mono">SaaS & Cyber</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-teal-950/30 text-teal-300 border border-teal-900 rounded font-mono font-black uppercase">FAST GROW</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">SaaS Devs & Cybersecurity Nodes</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">Crucial software hubs defending infrastructure endpoints, SaaS renewals, database queries, and custom LLM enterprise integration pipelines.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">PANW, CRWD, NET, SNOW, PLTR, DDOG, TEAM, OKTA, ZS, MDB, MSFT, AMZN, GOOGL, SAP.DE</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Tech / AI & Cloud, Fintech & Banking, Semiconductor Fabs</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("PANW,CRWD,NET,SNOW,PLTR,DDOG,TEAM,OKTA,ZS,MDB,MSFT,AMZN,GOOGL,SAP.DE", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Sector 10 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-amber-500 uppercase tracking-wider font-mono">Global Logistics</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-amber-950/30 text-amber-400 border border-amber-900 rounded font-mono font-black uppercase">MACRO DEVIATION</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">Maritime Commerce & Delivery Rails</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">Freight delivery times, global trade route disruptions, rail capacity benchmarks, and business-to-business shipping volumes.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">UPS, FDX, UNP, CSX, NSC, LUV, DAL, UAL, EXPD, ODFL, DPW.DE, DSV.CO, MAERSK-B.CO, 9101.T, CP.TO, CNR.TO</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Energy & Power, Consumer Retail, Materials & Mining</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("UPS,FDX,UNP,CSX,NSC,LUV,DAL,UAL,EXPD,ODFL,DPW.DE,DSV.CO,MAERSK-B.CO,9101.T,CP.TO,CNR.TO", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Sector 11 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-indigo-400 uppercase tracking-wider font-mono">Real Estate & REITs</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-indigo-950/30 text-indigo-300 border border-indigo-900 rounded font-mono font-black uppercase">RATE SENSITIVE</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">Commercial & Digital Infrastructure</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">Physical infrastructure footprint covering datacenters, cell towers, warehouses, and commercial space yields reacting to interest rates.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">PLD, AMT, EQIX, CCI, PSA, O, SPG, WELL, AVB, DLR, AMZN, VNA.DE, URW.AS, 8802.T, 1113.HK, SGRO.L</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Fintech & Banking, Telecommunications, Energy & Power</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("PLD,AMT,EQIX,CCI,PSA,O,SPG,WELL,AVB,DLR,AMZN,VNA.DE,URW.AS,8802.T,1113.HK,SGRO.L", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Sector 12 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-lime-400 uppercase tracking-wider font-mono">Materials & Mining</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-lime-950/30 text-lime-300 border border-lime-900 rounded font-mono font-black uppercase">COMMODITY CYCLICAL</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">Industrial Metals & Resources</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">Global extraction of raw materials, base metals, and rare earth elements that power construction and complex electronics manufacturing.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">BHP, RIO, VALE, FCX, NEM, NUE, SCCO, ALB, SQM, VMC, BHP.AX, RIO.L, GLEN.L, AAL.L, VALE3.SA</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Energy & Power, Global Logistics, E-Mobility</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("BHP,RIO,VALE,FCX,NEM,NUE,SCCO,ALB,SQM,VMC,BHP.AX,RIO.L,GLEN.L,AAL.L,VALE3.SA", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Sector 13 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-rose-400 uppercase tracking-wider font-mono">Telecommunications</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-rose-950/30 text-rose-300 border border-rose-900 rounded font-mono font-black uppercase">DEFENSIVE</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">Connectivity & Broadband Infra</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">The communication backbone supporting global network traffic, broadband expansion, and next-generation 5G cellular infrastructure.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">VZ, T, TMUS, CHTR, CMCSA, VOD, ORAN, TU, BCE, RCI, DTE.DE, VOD.L, ORA.PA, 9432.T, BT-A.L</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Media & Entertainment, Tech / AI & Cloud, Real Estate</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("VZ,T,TMUS,CHTR,CMCSA,VOD,ORAN,TU,BCE,RCI,DTE.DE,VOD.L,ORA.PA,9432.T,BT-A.L", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Sector 14 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-fuchsia-400 uppercase tracking-wider font-mono">Media & Entertainment</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-fuchsia-950/30 text-fuchsia-300 border border-fuchsia-900 rounded font-mono font-black uppercase">DISCRETIONARY</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">Streaming & Broadcast Networks</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">Audience engagement, subscription growth, and content licensing across digital streaming platforms, live events, and traditional broadcasters.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">DIS, NFLX, WBD, FOXA, PARA, SPOT, LYV, PINS, ROKU, SIRI, AAPL, AMZN, UMG.AS, 0700.HK, 6758.T, ITV.L</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Telecommunications, Tech / AI & Cloud, Consumer Retail</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("DIS,NFLX,WBD,FOXA,PARA,SPOT,LYV,PINS,ROKU,SIRI,AAPL,AMZN,UMG.AS,0700.HK,6758.T,ITV.L", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Sector 15 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-emerald-300 uppercase tracking-wider font-mono">Healthcare Providers</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-emerald-950/30 text-emerald-300 border border-emerald-900 rounded font-mono font-black uppercase">DEFENSIVE</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">Insurers, Hospitals & Distributors</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">Systemic tracking of health insurance utilization rates, hospital network volumes, and pharmaceutical distribution rails.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">UNH, CVS, CI, HUM, ELV, CNC, MCK, COR, CAH, UHS, HCA</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Biotech & Pharma, Fintech & Banking, Real Estate</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("UNH,CVS,CI,HUM,ELV,CNC,MCK,COR,CAH,UHS,HCA", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Sector 16 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-yellow-500 uppercase tracking-wider font-mono">Food & Agriculture</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-yellow-950/30 text-yellow-400 border border-yellow-900 rounded font-mono font-black uppercase">STAPLES</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">Consumer Staples & Agribusiness</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">Global caloric pipelines, crop yield cycles, packaged goods pricing power, and essential beverage distribution.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">KO, PEP, K, GIS, ADM, BG, MDLZ, NSRGY, MNST, KDP, DEO, HSY</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Consumer Retail, Global Logistics, Materials & Mining</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("KO,PEP,K,GIS,ADM,BG,MDLZ,NSRGY,MNST,KDP,DEO,HSY", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Sector 17 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-sky-400 uppercase tracking-wider font-mono">Industrial Machinery</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-sky-950/30 text-sky-300 border border-sky-900 rounded font-mono font-black uppercase">CYCLICAL</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">Automation, Tools & Heavy Equip</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">Capital goods foundational to manufacturing cycles, factory automation rollouts, and broad construction activity.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">DE, ITW, ETN, EMR, ROK, CMI, PH, DOV, IR, HON, AME</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Energy & Power, E-Mobility, Aerospace & Defense</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("DE,ITW,ETN,EMR,ROK,CMI,PH,DOV,IR,HON,AME", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Sector 18 */}
              <div className="bg-zinc-950/40 p-4 rounded-lg border border-zinc-850 hover:border-zinc-700 transition-all flex flex-col justify-between text-left">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[9.5px] font-bold text-rose-500 uppercase tracking-wider font-mono">Travel & Leisure</span>
                    <span className="text-[8.5px] px-1 py-0.5 bg-rose-950/30 text-rose-400 border border-rose-900 rounded font-mono font-black uppercase">REOPENING</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">Hospitality, Cruises & Booking Apps</h4>
                  <p className="text-[10.5px] text-zinc-400 leading-relaxed">Proxy for discretionary consumer health, cross-border mobility, hotel occupancy rates, and airline passenger volumes.</p>
                  <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Tracked Tickers: <strong className="text-zinc-200">BKNG, ABNB, MAR, HLT, CCL, RCL, EXPE, LVS, MGM, IHG, UAL, DAL</strong></p>
                  <p className="text-[9px] font-mono mt-1 text-zinc-500 leading-relaxed">Tightly Linked: <span className="text-zinc-400">Consumer Retail, Global Logistics, Media & Entertainment</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan("BKNG,ABNB,MAR,HLT,CCL,RCL,EXPE,LVS,MGM,IHG,UAL,DAL", 2, 2.15)}
                  className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                >
                  Quick Cluster Scan
                </button>
              </div>

              {/* Market Top 20 Panels */}
              {markets.map((market, idx) => {
                const top20 = market.stocks.slice(0, 20);
                if (top20.length === 0) return null;
                const symbolsCsv = top20.map(s => s.symbol).join(",");
                
                // Extract brief name for the tiny badge (e.g. 'NYSE')
                const badgeMatch = market.name.match(/\(([^)]+)\)/);
                const badgeText = badgeMatch ? badgeMatch[1] : (market.name.split(' ')[0] || 'MARKET');

                return (
                  <div key={`market-panel-${idx}`} className="bg-zinc-950/50 p-4 rounded-lg border border-zinc-800/80 hover:border-zinc-600 transition-all flex flex-col justify-between text-left">
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[9.5px] font-bold text-blue-300 uppercase tracking-wider font-mono">{badgeText}</span>
                        <span className="text-[8.5px] px-1 py-0.5 bg-blue-900/40 text-blue-300 border border-blue-800/50 rounded font-mono font-black uppercase">TOP 20</span>
                      </div>
                      <h4 className="text-xs font-bold text-zinc-100 uppercase font-sans mb-1">{market.name}</h4>
                      <p className="text-[10.5px] text-zinc-400 leading-relaxed">Top constituents by capitalization and regional systemic importance.</p>
                      <p className="text-[9px] font-mono mt-3 text-zinc-400 leading-relaxed">Top 20 Tickers: <strong className="text-zinc-200">{top20.map(s => s.symbol).join(", ")}</strong></p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleScan(symbolsCsv, 2, 2.15)}
                      className="mt-4 w-full py-1.5 text-center text-[10px] font-bold uppercase tracking-wider font-sans bg-zinc-800 hover:bg-zinc-700 hover:scale-[1.01] transition-all text-zinc-200 rounded border border-zinc-700 cursor-pointer"
                    >
                      Quick Cluster Scan
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        )}

        {activeMainTab === "market" && (
          /* Settings Control Dashboard Panel */
          <section id="terminal-control-board" className="bg-zinc-900 border border-zinc-805 rounded-xl p-6 shadow-sm animate-fade-in text-left">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
            
            {/* Left Column workspace containing tabs and ticker lookup form */}
            <div className={`w-full flex flex-col justify-between bg-zinc-950/45 rounded-xl p-5 border border-zinc-800/80 min-h-[480px] transition-all duration-300 ${
              isMarketDeskMinimized ? "xl:col-span-12" : "xl:col-span-5"
            }`}>
              
              {/* Tab options header */}
              <div className="flex items-center justify-between border-b border-zinc-805/60 pb-3 mb-4 shrink-0">
                <div className="flex gap-2">
                  <button
                    id="tab-focused-analysis"
                    type="button"
                    onClick={() => setActiveLeftTab("focused")}
                    className={`px-3 py-1.5 rounded text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                      activeLeftTab === "focused"
                        ? "bg-zinc-800 text-blue-400 font-bold shadow-sm border border-blue-500/20"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    Focused Stock
                  </button>
                  <button
                    id="tab-market-scans"
                    type="button"
                    onClick={() => setActiveLeftTab("market")}
                    className={`px-3 py-1.5 rounded text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                      activeLeftTab === "market"
                        ? "bg-zinc-800 text-emerald-400 font-bold shadow-sm border border-emerald-500/20"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    Market Scan Results {multiResults ? `(${Object.keys(multiResults).length})` : ""}
                  </button>
                  <button
                    id="tab-saved-scans"
                    type="button"
                    onClick={() => setActiveLeftTab("saved")}
                    className={`px-3 py-1.5 rounded text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                      activeLeftTab === "saved"
                        ? "bg-zinc-800 text-purple-400 font-bold shadow-sm border border-purple-500/20"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    Saved Sandbox ({Object.keys(savedScans).length})
                  </button>
                </div>
                
                <div className="flex items-center gap-2">
                  <div className="text-[10px] font-mono text-zinc-500 uppercase">
                    {activeLeftTab === "focused" ? "Active focus" : activeLeftTab === "market" ? "bulk results" : "saved sandbox"}
                  </div>
                  {isMarketDeskMinimized && (
                    <button
                      id="btn-expand-market-desk"
                      type="button"
                      onClick={() => setIsMarketDeskMinimized(false)}
                      className="ml-2 px-2.5 py-1 text-[10.5px] bg-emerald-950/50 hover:bg-emerald-900 border border-emerald-800 rounded text-emerald-400 font-bold tracking-tight transition-all flex items-center gap-1 cursor-pointer shadow-sm animate-pulse-slow"
                      title="Expand Markets Desk"
                    >
                      <Maximize2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> Expand Market Desk
                    </button>
                  )}
                </div>
              </div>

              {/* Tab content area */}
              <div className="flex-1 min-h-0 flex flex-col justify-start">
                {activeLeftTab === "focused" ? (
                  <div className="space-y-4 py-1 animate-fade-in text-left">
                    {scanResult ? (
                      <div className="space-y-4">
                        <div className="flex justify-between items-start gap-4">
                          <div>
                            <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest block font-sans">Primary Track Target</span>
                            <h3 className="text-2xl font-black font-sans tracking-tight text-white uppercase">{scanResult.symbol}</h3>
                            <p className="text-xs text-zinc-400 font-medium truncate max-w-[220px]" title={scanResult.companyName}>{scanResult.companyName || "Asset Tracking Ingest"}</p>
                          </div>
                          <div className="text-right bg-zinc-900/60 border border-zinc-800 px-3 py-2 rounded-lg shrink-0">
                            <span className="text-[9px] font-mono text-zinc-500 uppercase block">Anomalies Detected</span>
                            <span className="text-xs font-mono font-black text-rose-500 flex items-center gap-1.5 justify-end mt-0.5">
                              <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse"></span>
                              {scanResult.anomalies?.length || 0} Events
                            </span>
                          </div>
                        </div>
                        
                        {/* Summary panel stats */}
                        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-lg p-3.5 space-y-2 text-xs font-mono">
                          <div className="flex justify-between text-zinc-400">
                            <span>Observed range:</span>
                            <span className="text-zinc-300 font-extrabold">
                              ${(scanResult.points && scanResult.points.length > 0 ? Math.min(...scanResult.points.map(p => p.close)) : 0).toFixed(2)} - 
                              ${(scanResult.points && scanResult.points.length > 0 ? Math.max(...scanResult.points.map(p => p.close)) : 0).toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between text-zinc-400">
                            <span>Scanning filter:</span>
                            <span className="text-blue-400 font-bold">
                              {scanResult.meta.appliedZScoreThreshold && scanResult.meta.appliedZScoreThreshold !== zScoreThreshold ? 
                                <span className="text-amber-400">{scanResult.meta.appliedZScoreThreshold.toFixed(1)}σ auto</span> : 
                                <>{zScoreThreshold}σ</>
                              } sigma limits
                            </span>
                          </div>
                          {scanResult.anomalies && scanResult.anomalies.length > 0 && (
                            <div className="flex justify-between text-zinc-400">
                              <span>Max volatile movement:</span>
                              <span className="text-emerald-400 font-extrabold">
                                ${(scanResult.anomalies && scanResult.anomalies.length > 0 ? Math.max(...scanResult.anomalies.map(a => Math.abs(a.dailyReturn))) : 0).toFixed(2)}%
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Severe Threat Alert badge counters */}
                        {(() => {
                          const highSeverityEvents = (scanResult.anomalies || []).filter(
                            (a) => a.hasAnalysis && a.analysis && a.analysis.severity_score > 70
                          );
                          if (highSeverityEvents.length === 0) return null;
                          return (
                            <div className="p-3 bg-red-950/20 border border-red-900/30 rounded-lg flex gap-2.5 items-start animate-fade-in my-3">
                              <AlertOctagon className="w-4 h-4 text-red-500 shrink-0 mt-0.5 animate-pulse" />
                              <div className="space-y-0.5 text-left">
                                <span className="text-[9px] font-mono font-bold uppercase text-red-400 tracking-wide">
                                  ALERT: CURRENTLY DETECTING {highSeverityEvents.length} CRITICAL SPIKES
                                </span>
                                <p className="text-[10.5px] text-zinc-400 leading-normal font-sans">
                                  Highly destructive catalyst vectors (above 70/100 severity scores) were successfully matched for this security.
                                </p>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Simulated Live Ticker */}
                        <div className="flex justify-between items-center p-2.5 rounded-lg bg-zinc-950 border border-zinc-850 my-3">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${isSimulatingLive ? "bg-emerald-500 animate-ping" : "bg-zinc-650"}`}></span>
                            <span className="text-[10px] font-mono text-zinc-400 font-bold uppercase">Real-Time Ingest Simulator</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsSimulatingLive(!isSimulatingLive)}
                            className="px-2.5 py-1 rounded text-[10px] font-mono font-bold uppercase transition-all border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                          >
                            {isSimulatingLive ? "PAUSE TICKING" : "RUN INGEST"}
                          </button>
                        </div>

                        {/* User persistent Note Pad Workspace */}
                        <div className="space-y-1.5 p-3 rounded-lg bg-zinc-950 border border-zinc-850 my-3">
                          <div className="flex justify-between items-center">
                            <span className="text-[9.5px] font-mono uppercase text-zinc-400 font-bold tracking-wide">Analyst Journal: {scanResult.symbol}</span>
                            <span className="text-[8.5px] text-zinc-550 font-mono">Autosave Local</span>
                          </div>
                          <textarea
                            value={stockNotes[scanResult.symbol.toUpperCase()] || ""}
                            onChange={(e) => handleSaveNote(scanResult.symbol, e.target.value)}
                            placeholder="Type investment ideas, key insights or critical risks to flag..."
                            className="w-full h-16 bg-zinc-900/60 border border-zinc-900 hover:border-zinc-805 text-zinc-200 rounded p-2 text-[11px] focus:outline-none placeholder-zinc-650 resize-none font-sans"
                          />
                        </div>

                        <p className="text-[10px] text-zinc-550 leading-relaxed font-sans italic">
                          Click any volatility point Node inside the main Recharts timeline or under the "Spikes" ledger to view the Grounded AI Historian catalyst report.
                        </p>
                      </div>
                    ) : (
                      <div className="text-center py-10 text-zinc-500 font-mono">
                        <Info className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
                        <p className="text-xs">No active ticker scanned yet.</p>
                      </div>
                    )}
                  </div>
                ) : activeLeftTab === "market" ? (
                  <div className="space-y-3 flex-1 flex flex-col min-h-0 py-1 animate-fade-in text-left">
                    {multiResults ? (
                      <div className="space-y-3 flex-1 flex flex-col min-h-0">
                        {/* Text search and filter tabs */}
                        <div className="flex flex-col gap-2 shrink-0">
                          <input
                            type="text"
                            placeholder="Search scanned ticker..."
                            value={bulkSearch}
                            onChange={(e) => setBulkSearch(e.target.value)}
                            className="bg-zinc-950 text-zinc-200 border border-zinc-800 rounded px-2.5 py-1.5 text-xs focus:outline-none placeholder-zinc-650 font-mono w-full"
                          />
                          <div className="flex flex-wrap gap-1 text-[9px] font-mono">
                            {(["all", "anomalies", "gainers", "decliners"] as const).map((mode) => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => setBulkFilter(mode)}
                                className={`px-2 py-0.5 rounded transition-all cursor-pointer border ${
                                  bulkFilter === mode
                                    ? "bg-zinc-800 border-zinc-700 text-zinc-100 font-bold"
                                    : "bg-zinc-950/40 border-transparent text-zinc-500 hover:text-zinc-400"
                                }`}
                              >
                                {mode.toUpperCase()}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Interactive list area */}
                        <div className="flex-1 overflow-y-auto max-h-[190px] rounded border border-zinc-800 bg-zinc-950/50 p-2 space-y-1.5 scrollbar-thin scrollbar-thumb-zinc-800">
                          {filteredBulkList.length === 0 ? (
                            <div className="text-center py-10 text-zinc-500 italic text-xs font-mono">
                              No scanned assets match these criteria.
                            </div>
                          ) : (
                            filteredBulkList.map(([ticker, rawRes]) => {
                              const res = rawRes as StockScanResult;
                              const isSelected = scanResult?.symbol === ticker;
                              const anomaliesCount = res.anomalies?.length || 0;
                              const resPoints = res.points || [];
                              const netRet = resPoints.length > 0 
                                ? ((resPoints[resPoints.length - 1].close - resPoints[0].close) / resPoints[0].close) * 100 
                                : 0;

                              return (
                                <button
                                  id={`bulk-item-${ticker}`}
                                  key={ticker}
                                  type="button"
                                  onClick={() => {
                                    setScanResult(res);
                                    if (res.anomalies && res.anomalies.length > 0) {
                                      setSelectedAnomalyDate(res.anomalies[0].date);
                                    } else {
                                      setSelectedAnomalyDate(null);
                                    }
                                    setActiveMainTab("stock");
                                  }}
                                  className={`w-full text-left px-3 py-2 rounded flex items-center justify-between border transition-all cursor-pointer ${
                                    isSelected
                                      ? "bg-zinc-850 border-blue-500/50 text-white shadow-sm font-semibold"
                                      : "bg-zinc-900/40 border-zinc-850 hover:border-zinc-800 text-zinc-400 hover:text-zinc-200"
                                  }`}
                                >
                                  <div className="flex flex-col min-w-0 flex-1 mr-2">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-xs font-bold font-sans uppercase tracking-wide">{ticker}</span>
                                      {isSelected && (
                                        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse shrink-0"></span>
                                      )}
                                    </div>
                                    <span className="text-[9px] font-mono text-zinc-500 truncate max-w-[150px]">{res.companyName || "Asset"}</span>
                                  </div>
                                  <div className="flex items-center gap-3 font-mono text-right shrink-0">
                                    <div className="flex flex-col">
                                      <span className={`text-[10px] font-bold ${anomaliesCount > 0 ? "text-rose-450 font-bold" : "text-zinc-500"}`}>
                                        {anomaliesCount} spikes
                                        {res.meta?.appliedZScoreThreshold && res.meta.appliedZScoreThreshold !== zScoreThreshold && (
                                          <span className="text-[9px] text-amber-500/80 tracking-tighter ml-1" title={`Filter auto-adjusted to ${res.meta.appliedZScoreThreshold.toFixed(1)}σ`}>
                                            ({res.meta.appliedZScoreThreshold.toFixed(1)}σ)
                                          </span>
                                        )}
                                      </span>
                                      <span className={`text-[9px] font-semibold ${netRet >= 0 ? "text-emerald-400" : "text-rose-450"}`}>
                                        {netRet >= 0 ? "+" : ""}{netRet.toFixed(1)}% Return
                                      </span>
                                    </div>
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-12 text-zinc-650 font-mono flex-1 flex flex-col justify-center items-center">
                        <Database className="w-6 h-6 text-zinc-800 mb-2 animate-pulse" />
                        <span className="text-[9.5px] uppercase tracking-wider text-zinc-500 font-bold block">No Joint Market Scan Active</span>
                        <p className="text-[9px] text-zinc-600 max-w-[210px] mt-1 leading-normal">
                          Select an exchange and click <strong className="text-zinc-405">Scan Market</strong> or <strong className="text-zinc-405">Preload Intel</strong> on the right desk to analyze entire directories jointly.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3 flex-1 flex flex-col min-h-0 py-1 animate-fade-in text-left">
                    <div className="flex flex-col gap-2 shrink-0 bg-zinc-950/25 p-2 rounded border border-zinc-850">
                      <input
                        type="text"
                        placeholder="Search workspace by ticker/name..."
                        value={savedSearch}
                        onChange={(e) => setSavedSearch(e.target.value)}
                        className="bg-zinc-950 text-zinc-200 border border-zinc-800 rounded px-2.5 py-1.5 text-xs focus:outline-none placeholder-zinc-650 font-sans w-full"
                      />

                      {/* QoL slider filter */}
                      <div className="flex justify-between items-center text-[10px] bg-zinc-950/40 p-1.5 rounded border border-zinc-900/60 font-mono text-zinc-400">
                        <span>Min anomalies filter: <strong className="text-purple-400 font-bold">{savedMinAnomaliesFilter}</strong></span>
                        <input
                          type="range"
                          min="0"
                          max="8"
                          value={savedMinAnomaliesFilter}
                          onChange={(e) => setSavedMinAnomaliesFilter(Number(e.target.value))}
                          className="w-24 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                        />
                      </div>

                      {/* Batch Update Scanned Stocks Trigger */}
                      <button
                        id="btn-batch-update-stocks"
                        type="button"
                        onClick={handleBatchUpdate}
                        disabled={isBatchUpdating || Object.keys(savedScans).length === 0}
                        className={`w-full py-2 px-3 rounded text-xs font-bold font-sans tracking-wide flex items-center justify-center gap-1.5 transition-all select-none ${
                          isBatchUpdating
                            ? "bg-purple-900/30 text-purple-450 border border-purple-900/40 cursor-not-allowed animate-pulse"
                            : Object.keys(savedScans).length === 0
                            ? "bg-zinc-950 text-zinc-650 border border-zinc-900 cursor-not-allowed"
                            : "bg-purple-950/60 hover:bg-purple-900/40 text-purple-300 hover:text-purple-100 border border-purple-800/40 hover:border-purple-650 shadow-sm cursor-pointer"
                        }`}
                        title="Batch update existing stocks, using the Gemini Batch API"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 text-purple-400 ${isBatchUpdating ? "animate-spin" : ""}`} />
                        {isBatchUpdating ? "Syncing Batch Data..." : "Update Saved Stocks"}
                      </button>

                      {batchUpdateStatus && (
                        <div id="batch-update-status" className="text-[9.5px] bg-purple-955/20 border border-purple-900/30 text-purple-300 font-mono py-1 px-2.5 rounded text-center animate-pulse-slow">
                          {batchUpdateStatus}
                        </div>
                      )}

                      {/* QoL Actions: CSV, Backup JSON export & Import JSON, Import CSV plus Bulk Clear */}
                      <div className="grid grid-cols-2 gap-1.5 text-[9.5px] font-mono">
                        <button
                          type="button"
                          onClick={handleLocalCSVDownload}
                          className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-300 flex items-center justify-center gap-1 transition-all cursor-pointer"
                          title="Download local stock table CSV"
                        >
                          <Download className="w-3 h-3 text-emerald-400" />
                          <span>Local CSV</span>
                        </button>
                        
                        <button
                          type="button"
                          onClick={handleBackupExportJSON}
                          className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-300 flex items-center justify-center gap-1 transition-all cursor-pointer"
                          title="Save offline JSON backup file"
                        >
                          <Database className="w-3 h-3 text-blue-400" />
                          <span>Backup JSON</span>
                        </button>

                        <label className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-350 flex items-center justify-center gap-1 transition-all cursor-pointer text-center relative">
                          <Upload className="w-3 h-3 text-purple-400" />
                          <span>Import JSON</span>
                          <input
                            type="file"
                            accept=".json"
                            onChange={handleJSONImport}
                            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                          />
                        </label>

                        <label className="px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-350 flex items-center justify-center gap-1 transition-all cursor-pointer text-center relative" title="Import historic CSV file format back into current sandbox">
                          <Upload className="w-3 h-3 text-cyan-400" />
                          <span>Import CSV</span>
                          <input
                            type="file"
                            accept=".csv"
                            onChange={handleCSVImport}
                            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                          />
                        </label>

                        <button
                          type="button"
                          onClick={handleClearSavedScans}
                          className="col-span-2 px-2 py-1 rounded bg-rose-950/20 hover:bg-rose-900/20 border border-rose-900/30 text-rose-400 flex items-center justify-center gap-1 transition-all cursor-pointer"
                          title="Irreversibly delete saved scans storage"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Bulk Clear Sandbox</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleDownloadStandaloneEnvironment}
                          disabled={isExportingEnvironment}
                          className={`col-span-2 mt-2 py-1.5 px-2 rounded text-[10.5px] font-bold font-sans tracking-wide flex items-center justify-center gap-1.5 transition-all border ${
                            isExportingEnvironment
                              ? "bg-amber-955/20 text-amber-500 border-amber-900/40 cursor-not-allowed animate-pulse"
                              : "bg-amber-950/40 hover:bg-amber-900/30 text-amber-400 hover:text-amber-200 border-amber-950/40 hover:border-amber-700/60 cursor-pointer shadow-sm"
                          }`}
                          title="Compile, sanitize, and download entire interactive environment with live database to local desktop machine"
                        >
                          <FolderDown className={`w-3.5 h-3.5 text-amber-400 ${isExportingEnvironment ? "animate-bounce" : ""}`} />
                          <span>{isExportingEnvironment ? "Packaging Local Suite..." : "Export Portable Desktop Suite"}</span>
                        </button>

                        {environmentExportStatus && (
                          <div id="env-export-status" className={`col-span-2 text-[9px] border font-mono py-1.5 px-2 rounded text-center leading-relaxed transition-all ${
                            environmentExportStatus.includes("failed") || environmentExportStatus.includes("failed:")
                              ? "bg-rose-955/20 border-rose-900/30 text-rose-400"
                              : environmentExportStatus.includes("Success")
                              ? "bg-emerald-955/20 border-emerald-900/30 text-emerald-400"
                              : "bg-amber-955/20 border-amber-900/30 text-amber-300 animate-pulse-slow"
                          }`}>
                            {environmentExportStatus}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap justify-between items-center gap-2 text-[10px] font-mono text-zinc-400 pt-1 border-t border-zinc-900/50">
                        <div className="flex items-center gap-1.5">
                          <span>Sort:</span>
                          <select
                            value={savedSortBy}
                            onChange={(e) => setSavedSortBy(e.target.value as any)}
                            className="bg-zinc-900 text-zinc-300 border border-zinc-800 rounded px-1.5 py-0.5 text-[10px] focus:outline-none cursor-pointer"
                          >
                            <option value="name">Ticker A-Z</option>
                            <option value="market">Exchange</option>
                            <option value="anomalies">Anomalies count</option>
                            <option value="return">Net Return (%)</option>
                            <option value="volatility">Volatility (σ)</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setSavedSortOrder("asc")}
                            className={`px-1.5 py-0.5 rounded border text-[9px] cursor-pointer transition-all ${
                              savedSortOrder === "asc"
                                ? "bg-zinc-800 border-zinc-700 text-zinc-100 font-bold"
                                : "bg-zinc-950/40 border-transparent text-zinc-500"
                            }`}
                          >
                            ASC
                          </button>
                          <button
                            type="button"
                            onClick={() => setSavedSortOrder("desc")}
                            className={`px-1.5 py-0.5 rounded border text-[9px] cursor-pointer transition-all ${
                              savedSortOrder === "desc"
                                ? "bg-zinc-800 border-zinc-700 text-zinc-100 font-bold"
                                : "bg-zinc-950/40 border-transparent text-zinc-500"
                            }`}
                          >
                            DESC
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto max-h-[190px] rounded border border-zinc-800 bg-zinc-950/50 p-2 space-y-1.5 scrollbar-thin scrollbar-thumb-zinc-800">
                      {processedSavedScans.length === 0 ? (
                        <div className="text-center py-10 text-zinc-500 italic text-xs font-mono">
                          No saved scans found matching filter.
                        </div>
                      ) : (
                        processedSavedScans.map((res) => {
                          const ticker = res.symbol;
                          const isSelected = scanResult?.symbol === ticker;
                          const anomaliesCount = res.anomalies?.length || 0;
                          const netRet = getNetReturn(res);
                          const volVal = getVolatility(res);

                          return (
                            <button
                              id={`saved-item-${ticker}`}
                              key={ticker}
                              type="button"
                              onClick={() => {
                                setScanResult(res);
                                if (res.anomalies && res.anomalies.length > 0) {
                                  setSelectedAnomalyDate(res.anomalies[0].date);
                                } else {
                                  setSelectedAnomalyDate(null);
                                }
                                setActiveMainTab("stock");
                              }}
                              className={`w-full text-left px-3 py-2 rounded flex items-center justify-between border transition-all cursor-pointer ${
                                isSelected
                                  ? "bg-zinc-850 border-purple-500/50 text-white shadow-sm font-semibold"
                                  : "bg-zinc-900/40 border-zinc-850 hover:border-zinc-800 text-zinc-400 hover:text-zinc-200"
                              }`}
                            >
                              <div className="flex flex-col min-w-0 flex-1 mr-2 text-left">
                                <span className="text-xs font-bold font-sans uppercase tracking-wide flex items-center gap-1.5">
                                  {ticker}
                                  <span className="text-[8px] bg-zinc-950 border border-zinc-800 px-1 py-0.2 rounded text-zinc-500 font-mono tracking-normal uppercase shrink-0">
                                    {findMarketForSymbol(ticker)}
                                  </span>
                                </span>
                                <span className="text-[9px] font-mono text-zinc-500 truncate max-w-[150px]">{res.companyName || "Asset Tracking Ingest"}</span>
                              </div>
                              <div className="flex items-center gap-3 font-mono text-right shrink-0">
                                <div className="flex flex-col text-right">
                                  <span className={`text-[10px] font-bold ${anomaliesCount > 0 ? "text-rose-450 font-bold" : "text-zinc-500"}`}>
                                    {anomaliesCount} spikes
                                  </span>
                                  <div className="flex items-center justify-end gap-1.5 text-[9px]">
                                    <span className={netRet >= 0 ? "text-emerald-400 font-bold" : "text-rose-450 font-bold"}>
                                      {netRet >= 0 ? "+" : ""}{netRet.toFixed(1)}%
                                    </span>
                                    <span className="text-zinc-500 font-medium">Vol:{volVal.toFixed(1)}%</span>
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>

                    {/* Google Drive Export Module */}
                    <div className="mt-2.5 p-3 rounded bg-zinc-950/40 border border-zinc-850 space-y-2 flex flex-col shrink-0">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold font-mono uppercase tracking-wider text-purple-400 flex items-center gap-10">
                          <span className="flex items-center gap-1">
                            <CloudUpload className="w-3.5 h-3.5 animate-pulse" />
                            Google Drive Workspace
                          </span>
                        </span>
                        {driveUser && (
                          <button
                            type="button"
                            onClick={handleDriveLogout}
                            title="Disconnect Google Account"
                            className="text-[9px] font-mono text-zinc-500 hover:text-rose-400 hover:bg-rose-950/20 px-1.5 py-0.5 rounded border border-transparent hover:border-rose-900/30 flex items-center gap-1 cursor-pointer transition-all"
                          >
                            <LogOut className="w-2.5 h-2.5" />
                            Disconnect
                          </button>
                        )}
                      </div>

                      {!driveUser ? (
                        <div className="space-y-2 text-left">
                          <p className="text-[9.5px] text-zinc-500 leading-normal leading-relaxed">
                            Connect your Google Account to securely upload the entire historic database of compiled stocks and AI catalysts to Google Drive as a relational CSV.
                          </p>
                          <button
                            type="button"
                            onClick={handleDriveLogin}
                            disabled={isDriveLoading}
                            className="w-full flex items-center justify-center gap-2.5 px-3 py-2 bg-zinc-900 hover:bg-zinc-850 text-zinc-200 border border-zinc-800 hover:border-zinc-700 rounded font-sans text-xs font-semibold cursor-pointer transition-all focus:outline-none disabled:opacity-50 disabled:pointer-events-none"
                          >
                            <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-4 h-4">
                              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                            </svg>
                            <span>Connect with Google Drive</span>
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2 text-left">
                          <div className="flex items-center gap-2 px-2 py-1 bg-zinc-950/60 rounded border border-zinc-900">
                            {driveUser.photoURL && (
                              <img
                                src={driveUser.photoURL}
                                alt="Avatar"
                                referrerPolicy="no-referrer"
                                className="w-5 h-5 rounded-full border border-zinc-800"
                              />
                            )}
                            <div className="flex flex-col min-w-0">
                              <span className="text-[9.5px] font-sans font-bold text-zinc-300 truncate">
                                {driveUser.displayName || "Google Drive Account"}
                              </span>
                              <span className="text-[8.5px] font-mono text-zinc-500 truncate">
                                {driveUser.email}
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-1.5 pt-1">
                            {/* Native Multi-sheet Google Sheet Export */}
                            <button
                              type="button"
                              onClick={handleExportToDrive}
                              disabled={isDriveLoading || Object.keys(savedScans).length === 0}
                              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 hover:border-zinc-700 text-zinc-250 hover:text-white rounded font-sans text-2xs font-semibold cursor-pointer transition-all disabled:opacity-40 disabled:pointer-events-none"
                            >
                              <CloudUpload className="w-3 h-3 text-purple-400 shrink-0" />
                              <span>Export to Google Sheet ({Object.keys(savedScans).length} tabs)</span>
                            </button>

                            {/* Raw JSON backup uploaded to google drive */}
                            <button
                              type="button"
                              onClick={handleBackupToDriveJSON}
                              disabled={isDriveLoading || Object.keys(savedScans).length === 0}
                              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 hover:border-zinc-700 text-zinc-250 hover:text-white rounded font-sans text-2xs font-semibold cursor-pointer transition-all disabled:opacity-40 disabled:pointer-events-none"
                            >
                              <FileJson className="w-3 h-3 text-indigo-400 shrink-0" />
                              <span>Backup JSON to Drive</span>
                            </button>

                            {/* Raw CSV backup uploaded to google drive */}
                            <button
                              type="button"
                              onClick={handleBackupCSVToDrive}
                              disabled={isDriveLoading || Object.keys(savedScans).length === 0}
                              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 hover:border-zinc-700 text-zinc-250 hover:text-white rounded font-sans text-2xs font-semibold cursor-pointer transition-all disabled:opacity-40 disabled:pointer-events-none"
                              title="Upload the relational database format of your stocks history directly to Drive as a CSV file"
                            >
                              <Upload className="w-3 h-3 text-cyan-400 shrink-0" />
                              <span>Backup CSV to Drive</span>
                            </button>

                            {/* Query & Import database from Google Drive backup */}
                            <button
                              type="button"
                              onClick={handleTriggerDrivePicker}
                              disabled={isDriveLoading || isSearchingPicker}
                              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-800 hover:bg-zinc-850 hover:border-zinc-700 text-zinc-250 hover:text-white rounded font-sans text-2xs font-semibold cursor-pointer transition-all disabled:opacity-40 disabled:pointer-events-none"
                              title="Open interactive file picker selector to search and restore database backups from Drive"
                            >
                              {isSearchingPicker ? (
                                <Loader2 className="w-3 h-3 animate-spin text-purple-400 shrink-0" />
                              ) : (
                                <FolderOpen className="w-3 h-3 text-emerald-400 shrink-0" />
                              )}
                              <span>Import Backup (JSON/CSV) from Drive</span>
                            </button>
                          </div>

                          {/* Interactive Backup list selection panel */}
                          {showBackupList && (
                            <div className="mt-1 p-2 rounded bg-zinc-950 border border-zinc-900 space-y-1.5 text-left max-h-[140px] overflow-y-auto custom-scrollbar">
                              <div className="flex justify-between items-center pb-1 border-b border-zinc-900 text-[8.5px] font-mono uppercase tracking-wider text-zinc-500">
                                <span>Drive Backups (JSON & CSV)</span>
                                <button
                                  type="button"
                                  onClick={() => setShowBackupList(false)}
                                  className="text-[8px] hover:text-zinc-300"
                                >
                                  Close
                                </button>
                              </div>
                              {driveBackups.length === 0 ? (
                                <p className="text-[9px] text-zinc-500 italic py-1">No backups found.</p>
                              ) : (
                                driveBackups.map((bk) => {
                                  const isCsvFile = bk.name.toLowerCase().endsWith(".csv");
                                  return (
                                    <div
                                      key={bk.id}
                                      className="flex items-center justify-between gap-2 p-1 py-1 rounded hover:bg-zinc-900/80 transition-colors border border-transparent hover:border-zinc-800 text-[9.5px]"
                                    >
                                      <div className="flex flex-col min-w-0 flex-1">
                                        <span className="font-mono text-zinc-300 truncate font-semibold flex items-center gap-1" title={bk.name}>
                                          {isCsvFile ? (
                                            <Upload className="w-2.5 h-2.5 text-cyan-400 inline shrink-0" />
                                          ) : (
                                            <FileJson className="w-2.5 h-2.5 text-indigo-400 inline shrink-0" />
                                          )}
                                          <span className="truncate">{bk.name}</span>
                                        </span>
                                        <span className="text-[8px] text-zinc-600 font-mono">
                                          {safeToLocaleString(bk.createdTime)}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleImportDriveBackup(bk.id)}
                                        className="px-1.5 py-0.5 bg-emerald-950/40 text-emerald-400 border border-emerald-900/40 hover:bg-emerald-900/30 hover:text-emerald-300 rounded text-[9px] font-mono cursor-pointer transition-all"
                                      >
                                        Import
                                      </button>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}

                          {driveExportStatus && (
                            <div className={`p-2 rounded border text-[9.5px] font-mono leading-relaxed truncate ${
                              driveExportStatus.includes("Error") || driveExportStatus.includes("failed") || driveExportStatus.includes("failed:") || driveExportStatus.includes("failed.")
                                ? "bg-rose-950/20 border-rose-900/30 text-rose-455"
                                : driveExportStatus.includes("complete") || driveExportStatus.includes("connected") || driveExportStatus.includes("successfully")
                                ? "bg-emerald-950/20 border-emerald-900/30 text-emerald-450"
                                : "bg-zinc-900/30 border-zinc-800 text-zinc-400"
                            }`}>
                              {driveExportStatus}
                            </div>
                          )}

                          {driveLink && (
                            <a
                              href={driveLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full flex items-center justify-center gap-1 py-2 bg-purple-950/30 hover:bg-purple-900/30 text-purple-400 hover:text-purple-300 border border-purple-900/40 rounded font-mono text-[9.5px] uppercase font-bold transition-all cursor-pointer"
                            >
                              <span>Open Exported CSV on Drive</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Ticker Selector form */}
              <form onSubmit={executeManualSearch} className="w-full flex flex-col sm:flex-row gap-3 pt-4 border-t border-zinc-900 mt-auto shrink-0">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-3 w-4 h-4 text-zinc-500" />
                  <input
                    id="stock-symbol-search"
                    type="text"
                    value={symbol}
                    onChange={(e) => {
                      setSymbol(e.target.value);
                      setShowSearchSuggestions(true);
                    }}
                    onFocus={() => setShowSearchSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSearchSuggestions(false), 200)}
                    placeholder="Enter ticker (e.g. AZN.L)"
                    className="w-full bg-zinc-950 text-zinc-150 rounded pl-10 pr-4 py-2.5 text-xs font-mono border border-zinc-800 hover:border-zinc-700/80 focus:outline-none focus:ring-1 focus:ring-blue-555/30 focus:border-blue-555/30 transition-all uppercase"
                  />
                  
                  {/* Floating Suggestions Dropdown */}
                  {showSearchSuggestions && filteredSuggestions.length > 0 && (
                    <div id="search-suggestions-dropdown" className="absolute left-0 right-0 bottom-full mb-1.5 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl overflow-hidden z-50 text-left font-mono">
                      <div className="px-3 py-1 bg-zinc-950/80 text-[8.5px] text-zinc-550 border-b border-zinc-850 font-bold uppercase tracking-wider">
                        Suggested Tickers
                      </div>
                      {filteredSuggestions.map((s) => (
                        <button
                          key={s.symbol}
                          type="button"
                          onMouseDown={() => {
                            setSymbol(s.symbol);
                            handleScan(s.symbol, years, zScoreThreshold);
                            setShowSearchSuggestions(false);
                          }}
                          className="w-full text-left px-3 py-1.5 hover:bg-zinc-800/80 flex items-center justify-between text-[11px] border-b border-zinc-950/40 text-zinc-300 hover:text-white transition-all cursor-pointer"
                        >
                          <span className="font-bold text-blue-400">{s.symbol}</span>
                          <span className="text-[9.5px] text-zinc-500 truncate max-w-[170px]">{s.companyName}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Years Selector */}
                <div className="flex bg-zinc-950 p-1 rounded border border-zinc-800">
                  <span className="text-[10px] text-zinc-500 self-center px-1.5 select-none uppercase font-mono">Range</span>
                  {[0.5, 1, 2, 5].map((y) => (
                    <button
                      id={`range-select-${y}`}
                      key={y}
                      type="button"
                      onClick={() => setYears(y)}
                      className={`px-2 py-1 rounded text-[11px] font-mono transition-all cursor-pointer ${
                        years === y ? "bg-zinc-800 text-blue-400 font-bold shadow-sm" : "text-zinc-505 hover:text-zinc-300"
                      }`}
                    >
                      {y === 0.5 ? "6M" : `${y}Y`}
                    </button>
                  ))}
                </div>

                {/* Scan Trigger Button */}
                <div className="flex gap-2">
                  <button
                    id="btn-scan-trigger"
                    type="submit"
                    disabled={isLoading}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-xs font-semibold text-zinc-50 tracking-wide rounded shadow-sm transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Scanning...
                      </>
                    ) : (
                      <>
                        <BarChart3 className="w-4 h-4" />
                        Tactical Scan
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleResetAndRescan}
                    disabled={isLoading || !symbol.trim()}
                    className="px-3 py-2 bg-zinc-800 hover:bg-amber-600/20 hover:text-amber-300 border border-zinc-700 hover:border-amber-500/50 text-zinc-300 text-[11px] font-semibold tracking-wide rounded shadow-sm transition-all focus:outline-none focus:ring-1 focus:ring-amber-500/50 active:bg-amber-600/30 flex items-center justify-center cursor-pointer shrink-0"
                    title="Clear scanner checkpoints and do a fresh scan for this symbol"
                  >
                    Reset & Rescan
                  </button>
                  {isLoading && (
                    <button
                      id="btn-scan-cancel"
                      type="button"
                      onClick={handleCancelScan}
                      className="px-3 py-2 bg-rose-950/40 hover:bg-rose-900 border border-rose-900/60 text-rose-300 hover:text-zinc-100 text-xs font-semibold rounded shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                      title="Cancel the ongoing tactical scan"
                    >
                      <X className="w-4 h-4 text-rose-450" />
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* Markets and Tickers Ecosystem Module */}
            {!isMarketDeskMinimized && (
              <div className="w-full xl:col-span-7 flex flex-col gap-3 h-full animate-fade-in">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-805/60 pb-2">
                  <div className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="text-[11px] font-mono text-zinc-300 uppercase tracking-widest font-bold">Markets Desk</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      id="btn-minimize-market-desk"
                      type="button"
                      onClick={() => setIsMarketDeskMinimized(true)}
                      className="px-2 py-1 text-[10px] bg-zinc-955 hover:bg-zinc-800 border border-zinc-800 rounded text-zinc-400 hover:text-rose-450 transition-all flex items-center gap-1 cursor-pointer"
                      title="Minimize this panel for fully expanded terminal focus"
                    >
                      <Minimize2 className="w-3 h-3 text-zinc-500" /> Minimize Desk
                    </button>

                    <button
                      id="btn-reset-markets-default"
                      type="button"
                      onClick={() => {
                        if (confirm("Are you sure you want to restore the default global exchange directories? This will discard your custom changes.")) {
                          setMarkets(GLOBAL_MARKETS);
                          setSelectedMarketIndex(0);
                          if (GLOBAL_MARKETS[0]?.stocks[0]) {
                            setSymbol(GLOBAL_MARKETS[0].stocks[0].symbol);
                          }
                        }
                      }}
                    className="px-2 py-1 text-[10px] bg-zinc-950/40 hover:bg-zinc-800 border border-zinc-800 rounded text-zinc-400 hover:text-rose-400 transition-all flex items-center gap-1 cursor-pointer"
                    title="Restore all default pre-loaded global market indices"
                  >
                    <Database className="w-3 h-3 text-zinc-500" /> Reset to Defaults
                  </button>

                  <button
                    id="btn-add-market-toggle"
                    type="button"
                    onClick={() => {
                      setShowAddMarket(!showAddMarket);
                      setShowAddStock(false);
                    }}
                    className="px-2 py-1 text-[10px] bg-zinc-805 hover:bg-zinc-800 border border-zinc-700/60 rounded text-zinc-350 hover:text-zinc-150 transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3 h-3 text-emerald-500" /> Add Market
                  </button>
                </div>
              </div>

              {/* Markets Tabs Bar */}
              <div className="flex flex-wrap gap-2">
                {markets.map((m, idx) => (
                  <div key={idx} className="flex items-center gap-1">
                    <button
                      id={`market-tab-${idx}`}
                      type="button"
                      onClick={() => {
                        setSelectedMarketIndex(idx);
                        if (m.stocks.length > 0) {
                          setSymbol(m.stocks[0].symbol);
                        }
                      }}
                      className={`px-3 py-1.5 rounded text-xs font-semibold tracking-wide transition-all cursor-pointer border ${
                        selectedMarketIndex === idx
                          ? "bg-zinc-800 border-blue-500/40 text-blue-400"
                          : "bg-zinc-950/40 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {m.name}
                    </button>
                    {markets.length > 1 && (
                      <button
                        id={`btn-delete-market-${idx}`}
                        type="button"
                        onClick={() => handleDeleteMarket(idx)}
                        title={`Delete market ${m.name}`}
                        className="p-1.5 text-zinc-600 hover:text-rose-400 hover:bg-zinc-950/20 rounded transition-all cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Add Market Inline Form */}
              {showAddMarket && (
                <form onSubmit={handleAddMarket} className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 flex gap-2 max-w-sm mt-1">
                  <input
                    id="new-market-name-input"
                    type="text"
                    required
                    placeholder="New Market Name (e.g. GERMAN TECH)"
                    value={newMarketName}
                    onChange={(e) => setNewMarketName(e.target.value)}
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-150 focus:outline-none focus:ring-1 focus:ring-blue-500/30 uppercase font-mono"
                  />
                  <button
                    id="btn-add-market-submit"
                    type="submit"
                    className="bg-emerald-600 hover:bg-emerald-500 text-zinc-100 text-[10px] font-semibold px-3 py-1.5 rounded transition-all cursor-pointer"
                  >
                    Create
                  </button>
                  <button
                    id="btn-add-market-cancel"
                    type="button"
                    onClick={() => {
                      setShowAddMarket(false);
                      setNewMarketName("");
                    }}
                    className="bg-zinc-800 hover:bg-zinc-700 text-zinc-350 text-[10px] px-2 py-1.5 rounded transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                </form>
              )}

              {/* Tickers in Current Market Area */}
              <div className="bg-zinc-950/50 rounded-lg p-3 border border-zinc-800/80 mt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-wrap">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block mr-2">Stocks:</span>
                  {markets[selectedMarketIndex]?.stocks.length === 0 ? (
                    <span className="text-[11px] text-zinc-500 italic">No stocks inside this market yet.</span>
                  ) : (
                    markets[selectedMarketIndex]?.stocks.map((stock, idx) => {
                      const isActiveSymbol = symbol === stock.symbol;
                      return (
                        <div key={`${stock.symbol}-${idx}`} className={`inline-flex items-center bg-zinc-950 rounded border transition-all ${
                          isActiveSymbol ? "border-blue-500/60 bg-zinc-900" : "border-zinc-800 hover:border-zinc-700"
                        }`}>
                          <button
                            id={`quick-ticker-${stock.symbol}`}
                            type="button"
                            onClick={() => handleQuickScan(stock.symbol)}
                            className={`px-2.5 py-1 text-[11px] font-mono font-bold tracking-wide rounded-l transition-all cursor-pointer ${
                              isActiveSymbol ? "text-blue-400 font-extrabold" : "text-zinc-300 hover:text-white"
                            }`}
                            title={stock.companyName}
                          >
                            {stock.symbol}
                          </button>
                          <button
                            id={`btn-delete-stock-${stock.symbol}`}
                            type="button"
                            onClick={() => handleDeleteStock(stock.symbol)}
                            title={`Remove ${stock.symbol}`}
                            className="p-1 px-2 border-l border-zinc-900 text-zinc-650 hover:text-rose-400 hover:bg-zinc-900 rounded-r transition-all cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                {preloadProgress && (
                  <div className="w-full mt-2.5 p-2 bg-zinc-900/80 rounded border border-zinc-800 text-[10px] font-mono text-zinc-300 flex items-center gap-2 animate-fade-in">
                    <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                    <span>{preloadProgress}</span>
                  </div>
                )}

                {/* Global Batch Scanner Progress Panel */}
                {(isScanAllRunning || (scanAllTotal > 0 && scanAllProcessed < scanAllTotal)) && (
                  <div className="w-full mt-2.5 p-3 bg-zinc-900/95 rounded-lg border border-zinc-700/80 text-[11px] font-mono text-zinc-300 flex flex-col gap-2 animate-fade-in shadow-md">
                    <div className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-1.5 font-bold text-purple-400">
                        <Loader2 className={`w-3.5 h-3.5 ${isScanAllRunning ? "animate-spin text-purple-400" : "text-zinc-500"}`} />
                        <span>Multi-Market Batch Scanner</span>
                      </div>
                      <span className="text-zinc-400 font-bold">
                        {scanAllProcessed} / {scanAllTotal} Tickers ({scanAllTotal > 0 ? Math.round((scanAllProcessed / scanAllTotal) * 100) : 0}%)
                      </span>
                    </div>

                    {/* Progress Bar Container */}
                    <div className="w-full bg-zinc-950 h-1.5 rounded-full overflow-hidden border border-zinc-850">
                      <div
                        className="bg-gradient-to-r from-purple-500 via-indigo-500 to-blue-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${scanAllTotal > 0 ? (scanAllProcessed / scanAllTotal) * 100 : 0}%` }}
                      ></div>
                    </div>

                    <div className="flex justify-between items-center gap-4">
                      <span className="text-[10px] text-zinc-400 truncate max-w-[70%]">
                        {scanAllProgressText}
                      </span>
                      <button
                        type="button"
                        onClick={handleScanAllUnscanned}
                        className={`text-[9.5px] px-2 py-0.5 rounded font-bold transition-all select-none cursor-pointer border ${
                          isScanAllRunning
                            ? "bg-rose-955 hover:bg-rose-900 border-rose-900 hover:border-rose-750 text-rose-300"
                            : "bg-purple-950 hover:bg-purple-900 border-purple-900 hover:border-purple-750 text-purple-300 animate-pulse"
                        }`}
                      >
                        {isScanAllRunning
                          ? (scanAllPauseRef.current ? "Stopping..." : "Pause Scan")
                          : "Resume Scan"}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {markets[selectedMarketIndex]?.stocks.length > 0 && (
                    <button
                      id="btn-preload-active-market"
                      type="button"
                      disabled={isPreloading}
                      onClick={handlePreloadMarket}
                      className="px-2.5 py-1 bg-emerald-950/40 hover:bg-emerald-950/70 border border-emerald-800 text-[10.5px] font-medium rounded text-emerald-400 transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50"
                      title="Load and cache historical anomalies/returns for the first 15 tickers in this market"
                    >
                      <Database className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      {isPreloading ? "Preloading..." : `Preload Top 15 Intel`}
                    </button>
                  )}

                  {markets[selectedMarketIndex]?.stocks.length > 0 && (
                    <button
                      id="btn-scan-entire-market"
                      type="button"
                      onClick={() => handleScanMarket(selectedMarketIndex)}
                      className="px-2.5 py-1 bg-blue-900/40 hover:bg-blue-900/60 border border-blue-800 text-[10.5px] font-medium rounded text-blue-300 transition-all cursor-pointer flex items-center gap-1"
                      title="Scan all tickers in this market jointly to compare anomalies"
                    >
                      <Layers className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      Scan Market ({markets[selectedMarketIndex]?.stocks.length})
                    </button>
                  )}

                  {/* Scan All Unscanned Button */}
                  <button
                    id="btn-scan-all-unscanned-stocks"
                    type="button"
                    onClick={handleScanAllUnscanned}
                    disabled={isPreloading || isBatchUpdating}
                    className={`px-2.5 py-1 text-[10.5px] font-medium rounded transition-all cursor-pointer flex items-center gap-1 border ${
                      isScanAllRunning
                        ? "bg-rose-955/40 hover:bg-rose-955/60 border-rose-800 text-rose-300 animate-pulse"
                        : "bg-purple-900/40 hover:bg-purple-900/60 border-purple-800 text-purple-300"
                    }`}
                    title="Batch scan all tickers across all markets that haven't been scanned yet"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-purple-400 shrink-0 ${isScanAllRunning && !scanAllPauseRef.current ? "animate-spin" : ""}`} />
                    {isScanAllRunning
                      ? "Scanning All..."
                      : `Scan All Remaining (${getAllUnscannedStocks().length} left)`}
                  </button>
                  
                  <button
                    id="btn-add-stock-toggle"
                    type="button"
                    onClick={() => {
                      setShowAddStock(!showAddStock);
                      setShowAddMarket(false);
                    }}
                    className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[10.5px] rounded text-zinc-400 hover:text-zinc-200 transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 text-emerald-500" />
                    Add Stock
                  </button>
                </div>
              </div>

              {/* Add Stock Inline Form */}
              {showAddStock && (
                <form onSubmit={handleAddStock} className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 flex flex-col sm:flex-row gap-3 mt-1 items-end sm:items-center">
                  <div className="flex-1 w-full">
                    <label className="text-[10px] text-zinc-500 uppercase font-mono mb-1 block">Ticker Symbol</label>
                    <input
                      id="new-stock-symbol-input"
                      type="text"
                      required
                      placeholder="e.g. GOOG"
                      value={newStockSymbol}
                      onChange={(e) => setNewStockSymbol(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-150 focus:outline-none focus:ring-1 focus:ring-blue-500/30 uppercase font-mono font-bold"
                    />
                  </div>
                  <div className="flex-[2] w-full">
                    <label className="text-[10px] text-zinc-500 uppercase font-mono mb-1 block">Company / Asset Name</label>
                    <input
                      id="new-stock-name-input"
                      type="text"
                      placeholder="e.g. Alphabet Inc."
                      value={newStockName}
                      onChange={(e) => setNewStockName(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-150 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      id="btn-add-stock-submit"
                      type="submit"
                      className="bg-emerald-600 hover:bg-emerald-500 text-zinc-100 text-xs font-semibold px-4 py-2 rounded transition-all cursor-pointer whitespace-nowrap"
                    >
                      Add Ticker
                    </button>
                    <button
                      id="btn-add-stock-cancel"
                      type="button"
                      onClick={() => {
                        setShowAddStock(false);
                        setNewStockSymbol("");
                        setNewStockName("");
                      }}
                      className="bg-zinc-800 hover:bg-zinc-700 text-zinc-350 text-xs px-3 py-2 rounded transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
          </div>

          {/* Sensitivity Setting Controls */}
          <div className="mt-5 pt-4 border-t border-zinc-800/60 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-1 text-blue-400 bg-blue-500/10 rounded border border-blue-500/20">
                <Layers className="w-3.5 h-3.5" />
              </div>
              <div>
                <span className="text-xs font-semibold text-zinc-200 font-mono block">Statistical Sigma Tolerance Threshold</span>
                <p className="text-[10px] text-zinc-500">
                  Daily returns exceeding this Sigma boundary relative to the 90-period rolling statistics are classified as outliers.
                </p>
              </div>
            </div>

            {/* Range Slider for Z-score Threshold */}
            <div className="flex items-center gap-4 bg-zinc-950 px-4 py-2.5 rounded border border-zinc-800">
              <span className="text-xs font-mono text-zinc-500 select-none">Z-Score Boundaries:</span>
              <input
                id="z-score-threshold-slider"
                type="range"
                min="1.5"
                max="3.5"
                step="0.1"
                value={zScoreThreshold}
                onChange={(e) => setZScoreThreshold(parseFloat(e.target.value))}
                className="w-36 h-1 bg-zinc-800 rounded appearance-none cursor-pointer accent-blue-550"
              />
              <span
                id="z-score-threshold-display"
                onClick={() => {
                  if (!isEditingZScore) {
                    setTempZScore(zScoreThreshold.toFixed(1));
                    setIsEditingZScore(true);
                  }
                }}
                className="text-xs font-mono font-bold text-blue-400 w-12 text-right cursor-pointer select-none hover:underline hover:text-blue-300"
                title="Click to manually enter a Z-score (1.5 - 3.5)"
              >
                {isEditingZScore ? (
                  <input
                    id="z-score-text-input"
                    type="text"
                    autoFocus
                    value={tempZScore}
                    onChange={(e) => setTempZScore(e.target.value)}
                    onBlur={() => {
                      const parsed = parseFloat(tempZScore);
                      if (isNaN(parsed) || parsed < 1.5 || parsed > 3.5) {
                        setZScoreThreshold(2.0);
                      } else {
                        setZScoreThreshold(parseFloat(parsed.toFixed(2)));
                      }
                      setIsEditingZScore(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const parsed = parseFloat(tempZScore);
                        if (isNaN(parsed) || parsed < 1.5 || parsed > 3.5) {
                          setZScoreThreshold(2.0);
                        } else {
                          setZScoreThreshold(parseFloat(parsed.toFixed(2)));
                        }
                        setIsEditingZScore(false);
                      } else if (e.key === "Escape") {
                        setIsEditingZScore(false);
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-10 bg-zinc-900 text-blue-400 font-mono font-bold text-xs text-right border border-blue-500/40 rounded px-1 py-0 focus:outline-none"
                  />
                ) : (
                  <>±{zScoreThreshold.toFixed(1)}σ</>
                )}
              </span>
            </div>
          </div>
        </section>
        )}

        {/* Error notification display (Global, visible across all tabs) */}
        {error && (
          <div id="error-screen-card" className="bg-rose-950/20 border border-rose-900/60 rounded-2xl p-4 flex gap-3 text-rose-300 items-start text-left animate-fade-in">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-rose-400" />
            <div>
              <span className="font-semibold text-xs uppercase tracking-wider font-mono">Market Ingestion Interrupted</span>
              <p className="text-xs mt-1 text-rose-300/90 leading-relaxed font-sans">{error}</p>
            </div>
          </div>
        )}

        {successMsg && (
          <div id="success-screen-card" className="bg-emerald-950/20 border border-emerald-900/60 rounded-2xl p-4 flex gap-3 text-emerald-300 items-start text-left animate-fade-in">
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-400" />
            <div>
              <span className="font-semibold text-xs uppercase tracking-wider font-mono">Operation Successful</span>
              <p className="text-xs mt-1 text-emerald-300/90 leading-relaxed font-sans">{successMsg}</p>
            </div>
          </div>
        )}

        {/* Tab 3: Focused Stock Workspace */}
        {activeMainTab === "stock" && (
          <div className="space-y-6 animate-fade-in text-left">
            {isLoading ? (
          <div className="h-[450px] flex flex-col items-center justify-center bg-zinc-900 border border-zinc-805 rounded-xl p-8 text-center">
            <Loader2 className="w-10 h-10 animate-spin text-blue-500 opacity-80 mb-4" />
            <h3 className="text-zinc-200 text-xs font-bold tracking-widest uppercase font-mono animate-pulse">Executing Returns Scan Engine</h3>
            <p className="text-xs text-zinc-500 mt-2 max-w-sm font-sans">
              Downloading ticks, computing rolling standard deviation indices, and resolving cached historical reports...
            </p>
            <button
              id="btn-scan-cancel-workspace"
              type="button"
              onClick={handleCancelScan}
              className="mt-6 px-4 py-2 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-950/80 hover:border-rose-900 text-rose-300 text-xs font-medium rounded-lg shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer hover:scale-102"
              title="Cancel the ongoing tactical scan"
            >
              <X className="w-4.5 h-4.5 text-rose-400" />
              Cancel Tactical Scan
            </button>
          </div>
        ) : scanResult ? (
          <div className="space-y-6">
            
            {/* Ticker Display bento card */}
            <div className="bg-zinc-900 border border-zinc-805 rounded-xl p-6 flex flex-col sm:flex-row justify-between items-baseline gap-4 shadow-sm">
              <div className="flex items-baseline gap-4">
                <span className="text-4xl font-black font-sans tracking-tight text-zinc-100 uppercase">
                  {scanResult.symbol}
                </span>
                <span className="text-xs font-medium text-zinc-400 font-mono">
                  {scanResult.companyName || "Asset Tracking Ingest"}
                </span>
              </div>
              <div className="sm:ml-auto text-left sm:text-right">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 block font-mono">Detected Anomalies</span>
                <span className="font-mono text-xs font-bold text-zinc-300">
                  &gt; {scanResult.meta.appliedZScoreThreshold && scanResult.meta.appliedZScoreThreshold !== zScoreThreshold ? 
                    <span className="text-amber-400">
                      {scanResult.meta.appliedZScoreThreshold.toFixed(1)}&sigma; (Auto-adjusted)
                    </span> : 
                    <>{zScoreThreshold}&sigma;</>
                  } Tolerance Range
                </span>
              </div>
            </div>

            {/* Stats summary row widget */}
            {stats && (
              <div id="stats-summary-grid" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                
                {/* Last pricing closed */}
                <div className="bg-zinc-900 border border-zinc-805 p-5 rounded-xl shadow-sm flex flex-col justify-between">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider block font-mono">Current Market price</span>
                  <div className="flex items-baseline gap-2 mt-2">
                    <span className="text-2xl font-mono font-extrabold text-zinc-50">${stats.lastPrice.toFixed(2)}</span>
                    <span className="text-[10px] text-zinc-500 font-mono">{scanResult.currency}</span>
                  </div>
                </div>

                {/* Net growth / return */}
                <div className="bg-zinc-900 border border-zinc-805 p-5 rounded-xl shadow-sm flex flex-col justify-between">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider block font-mono">Net Return (Period)</span>
                  <div className="flex items-center gap-1.5 mt-2">
                    {stats.netReturn >= 0 ? (
                      <TrendingUp className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : (
                      <TrendingUp className="w-4 h-4 rotate-180 text-rose-500 shrink-0" />
                    )}
                    <span
                      className={`text-2xl font-mono font-extrabold ${
                        stats.netReturn >= 0 ? "text-emerald-400" : "text-rose-450"
                      }`}
                    >
                      {stats.netReturn >= 0 ? "+" : ""}
                      {stats.netReturn.toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* Anomalies Outliers identified */}
                <div className="bg-zinc-900 border border-zinc-805 p-5 rounded-xl shadow-sm flex flex-col justify-between">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider block font-mono">Anomalous Trade Days</span>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-2xl font-mono font-extrabold text-zinc-50">{computedAnomalies.length}</span>
                    {computedAnomalies.length > 0 && (
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-450 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Average Volatility index */}
                <div className="bg-zinc-900 border border-zinc-805 p-5 rounded-xl shadow-sm flex flex-col justify-between">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider block font-mono">Volatility Index (Avg Dev)</span>
                  <div className="flex items-baseline gap-1.5 mt-2">
                    <Percent className="w-4 h-4 text-blue-500" />
                    <span className="text-2xl font-mono font-extrabold text-zinc-50">{stats.volatility.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            )}

            {/* Sub-Tabs Selector Header */}
            <div className="flex border-b border-zinc-800 pb-px gap-6 mb-2">
              <button
                type="button"
                id="subtab-btn-price"
                onClick={() => setActiveStockSubTab("price")}
                className={`pb-3 text-xs font-bold uppercase tracking-wider font-mono cursor-pointer transition-all border-b-2 relative ${
                  activeStockSubTab === "price"
                    ? "text-blue-400 border-blue-500"
                    : "text-zinc-500 border-transparent hover:text-zinc-300"
                }`}
              >
                Price, History &amp; Statistical Spikes
              </button>
              <button
                type="button"
                id="subtab-btn-simulator"
                onClick={() => setActiveStockSubTab("simulator")}
                className={`pb-3 text-xs font-bold uppercase tracking-wider font-mono cursor-pointer transition-all border-b-2 relative ${
                  activeStockSubTab === "simulator"
                    ? "text-amber-500 border-amber-500"
                    : "text-zinc-500 border-transparent hover:text-zinc-300"
                }`}
              >
                Tactical Simulator
              </button>
              <button
                type="button"
                id="subtab-btn-competitors"
                onClick={() => setActiveStockSubTab("competitors")}
                className={`pb-3 text-xs font-bold uppercase tracking-wider font-mono cursor-pointer transition-all border-b-2 relative ${
                  activeStockSubTab === "competitors"
                    ? "text-purple-400 border-purple-500"
                    : "text-zinc-500 border-transparent hover:text-zinc-300"
                }`}
              >
                Competitors
              </button>
            </div>

            {/* Split Panels Workspace */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* Primary Visual Center (LineChart + Outliers table Feed) */}
              <div className="lg:col-span-8 space-y-6">
                
                {activeStockSubTab === "price" && (
                  <>
                    <StockChart
                      points={computedPoints}
                      selectedAnomalyDate={selectedAnomalyDate}
                      onSelectDate={(date) => setSelectedAnomalyDate(date)}
                      currency={scanResult.currency}
                      visualization={scanResult.visualization}
                      savedScans={savedScans}
                      activeSymbol={scanResult.symbol}
                    />
                  </>
                )}

                {activeStockSubTab === "competitors" && (
                    <CompetitorsPanel 
                      symbol={scanResult.symbol} 
                      name={scanResult.companyName}
                      savedScans={savedScans}
                      onSelectCompetitor={(sym) => {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                        handleScan(sym, years, zScoreThreshold);
                      }}
                      onCompetitorsLoaded={handleCompetitorsLoaded}
                    />
                )}

                {activeStockSubTab === "simulator" && (
                  /* Financial Stress Sandbox Desktop */
                  <div id="stress-sandbox-controls" className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-sm space-y-4 font-mono animate-fade-in text-left">
                  <div className="flex justify-between items-center pb-2 border-b border-zinc-800/80">
                    <div>
                      <span className="text-[10px] tracking-wider uppercase text-zinc-500 font-mono block">Tactical Simulator Workspace</span>
                      <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-tight flex items-center gap-1.5 mt-0.5 font-mono">
                        <span className="w-2 h-2 rounded-full bg-amber-500 inline-block animate-pulse shrink-0"></span>
                        What-If Return Impact Simulator
                      </h4>
                    </div>
                    {Object.keys(stressOverrides).length > 0 && (
                      <button
                        type="button"
                        onClick={() => setStressOverrides({})}
                        className="px-2.5 py-1 text-[9.5px] font-mono font-bold bg-rose-950/40 hover:bg-rose-900/40 border border-rose-900/50 hover:border-rose-700 text-rose-300 rounded cursor-pointer transition-all uppercase flex items-center gap-1.5 shadow-sm"
                      >
                        <Trash2 className="w-3 h-[12px]" /> Clear Simulated Shocks ({Object.keys(stressOverrides).length})
                      </button>
                    )}
                  </div>

                  <p className="text-[11px] text-zinc-400 leading-relaxed font-sans mt-1">
                    Inject mock returns on past trading dates to forecast cascading close price projections, rolling volatility shifts, and dynamic statistical standard deviation bands.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end bg-zinc-950 p-4 rounded-lg border border-zinc-900">
                    {/* Date Selector */}
                    <div className="md:col-span-4 space-y-1 text-left">
                      <label htmlFor="sandbox-date-select" className="text-[10px] uppercase font-mono text-zinc-500 font-bold block">1. Target Day</label>
                      <select
                        id="sandbox-date-select"
                        value={stressOverrideDate}
                        onChange={(e) => {
                          const val = e.target.value;
                          setStressOverrideDate(val);
                          const found = computedPoints.find(p => p.date === val);
                          setStressOverrideValue(found ? found.dailyReturn : 0);
                        }}
                        className="w-full bg-zinc-900 hover:bg-zinc-850 border border-zinc-850 text-zinc-200 rounded px-2.5 py-1.5 text-xs focus:outline-none cursor-pointer font-mono text-left"
                      >
                        <option value="">-- Choose trading day --</option>
                        {computedPoints.slice().reverse().map((p) => (
                          <option key={p.date} value={p.date}>
                            {p.date} (${p.close.toFixed(2)} | {(p.dailyReturn || 0).toFixed(2)}%) {stressOverrides[p.date] !== undefined ? "🔥 overriden" : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Return shock slider */}
                    <div className="md:col-span-5 space-y-1.5 text-left">
                      <div className="flex justify-between items-center text-[10px] uppercase font-mono font-bold text-zinc-500">
                        <span>2. Return Overwrite</span>
                        <span className={`font-black ${stressOverrideValue > 0 ? "text-emerald-400" : stressOverrideValue < 0 ? "text-rose-450" : "text-zinc-500"}`}>
                          {stressOverrideValue > 0 ? "+" : ""}{Number(stressOverrideValue).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[9px] text-zinc-600 font-mono">-40%</span>
                        <input
                          id="sandbox-return-range"
                          type="range"
                          min="-40"
                          max="40"
                          step="0.5"
                          disabled={!stressOverrideDate}
                          value={stressOverrideValue}
                          onChange={(e) => setStressOverrideValue(Number(e.target.value))}
                          className="flex-grow h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500 disabled:opacity-30 disabled:cursor-not-allowed"
                        />
                        <span className="text-[9px] text-zinc-600 font-mono">+40%</span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="md:col-span-3">
                      <button
                        id="btn-sandbox-apply"
                        type="button"
                        disabled={!stressOverrideDate}
                        onClick={() => {
                          if (!stressOverrideDate) return;
                          setStressOverrides(prev => ({
                            ...prev,
                            [stressOverrideDate]: stressOverrideValue
                          }));
                        }}
                        className={`w-full py-1.5 px-3 rounded text-xs font-bold font-sans tracking-wide transition-all border shadow-sm select-none ${
                          stressOverrideDate
                            ? "bg-amber-600 hover:bg-amber-500 hover:scale-[1.01] text-zinc-950 border-amber-500 cursor-pointer shadow-amber-950/20"
                            : "bg-zinc-900 border-zinc-850 text-zinc-650 cursor-not-allowed"
                        }`}
                      >
                        Apply Return Overwrite
                      </button>
                    </div>
                  </div>

                  {/* Active List of custom overrides */}
                  {Object.keys(stressOverrides).length > 0 && (
                    <div className="space-y-1.5 text-left">
                      <span className="text-[9px] font-mono text-zinc-500 uppercase font-bold tracking-wider">Active Simulated Parameters</span>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(stressOverrides).map(([dt, retVal]) => {
                          const ret = Number(retVal);
                          return (
                            <span
                              key={dt}
                              className={`pl-2 pr-1.5 py-0.5 rounded text-[10px] font-mono border flex items-center gap-1.5 transition-all uppercase ${
                                ret > 0
                                  ? "bg-emerald-950/30 border-emerald-900/40 text-emerald-300"
                                  : "bg-rose-950/30 border-rose-900/40 text-rose-300"
                              }`}
                            >
                              <span>{dt}: <strong>{ret > 0 ? "+" : ""}{ret.toFixed(1)}%</strong></span>
                              <button
                                type="button"
                                onClick={() => {
                                  setStressOverrides(prev => {
                                    const next = { ...prev };
                                    delete next[dt];
                                    return next;
                                  });
                                }}
                                className="text-zinc-500 hover:text-zinc-200 transition-all font-sans p-0.5 cursor-pointer font-bold"
                                title="Delete override"
                              >
                                &times;
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
                )}

                {activeStockSubTab === "price" && (
                  /* Statistical Feed list */
                  <AnomalyFeed
                  anomalies={computedAnomalies}
                  symbol={scanResult.symbol}
                  selectedAnomalyDate={selectedAnomalyDate}
                  onSelectAnomaly={(date) => setSelectedAnomalyDate(date)}
                  onAnalyzeAnomaly={handleAnalyzeAnomaly}
                  analyzingDates={analyzingDates}
                  onSyncSandbox={(date, dailyReturn) => {
                    setStressOverrideDate(date);
                    setStressOverrideValue(dailyReturn);
                    // Smoothly scroll the sandbox container into view
                    document.getElementById("stress-sandbox-controls")?.scrollIntoView({ behavior: "smooth" });
                  }}
                />
                )}
              </div>

              {/* Chat Sidebar Companion */}
              <div className="lg:col-span-4 h-full">
                <div className="sticky top-20">
                  <StockChatAssistant symbol={scanResult.symbol} anomalies={computedAnomalies} />
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Empty/Initial Landing Screen state */
          <div className="bg-zinc-900 border border-zinc-805 rounded-xl p-8 lg:p-12 text-center max-w-3xl mx-auto flex flex-col items-center">
            <div className="p-4 bg-zinc-950 text-blue-400 rounded-lg border border-zinc-800 shrink-0 mb-6">
              <Sparkles className="w-8 h-[32px] animate-pulse text-blue-500" />
            </div>

            <h2 className="text-base font-bold text-zinc-100 tracking-tight sm:text-lg uppercase font-mono">
              Tactical Outliers Intelligence System
            </h2>
            <p className="text-zinc-450 text-xs mt-3 leading-relaxed max-w-lg font-sans">
              Scan historic stock ticker sequences below to identify statistical volatility anomalies based on custom Sigma limits. Pair your scans with the **AI Historian** to isolate corporate news files, macro policies, or earnings reports behind those extreme events.
            </p>

            {/* CTA selection buttons */}
            <div className="mt-8 flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <button
                id="btn-onboard-tsla"
                onClick={() => handleQuickScan("TSLA")}
                className="px-5 py-3 bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 text-xs font-mono font-semibold text-zinc-200 transition-all cursor-pointer rounded"
              >
                Scan Tesla (TSLA)
              </button>
              <button
                id="btn-onboard-nvda"
                onClick={() => handleQuickScan("NVDA")}
                className="px-5 py-3 bg-blue-600 hover:bg-blue-500 text-xs font-mono font-semibold text-zinc-50 transition-all cursor-pointer rounded shadow-md"
              >
                Scan Nvidia (NVDA)
              </button>
              <button
                id="btn-onboard-gaw"
                onClick={() => handleQuickScan("GAW.L")}
                className="px-5 py-3 bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 text-xs font-mono font-semibold text-zinc-200 transition-all cursor-pointer rounded"
              >
                Scan Games Workshop (GAW.L)
              </button>
            </div>
          </div>
        )}
        </div>
        )}

        {/* Tab 4: AI Historian Advisor */}
        {activeMainTab === "advisor" && (
          <div className="space-y-6 animate-fade-in text-left">
            <div className="bg-zinc-900 border border-zinc-805 rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex gap-3 items-center">
                <Sparkles className="w-5 h-5 text-amber-400 animate-pulse" />
                <div>
                  <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-widest font-mono">AI Historian Consultant Terminal</h3>
                  <p className="text-xs text-zinc-450 mt-0.5 font-sans leading-relaxed text-zinc-400">
                    Consult our model regarding company catalyst reports, regulatory filings, and volatility event drivers.
                  </p>
                </div>
              </div>
              <div className="text-left sm:text-right font-mono text-xs text-zinc-400 uppercase">
                Active Analysis Focus: <strong className="text-blue-400 uppercase">{scanResult ? scanResult.symbol : "TSLA (Default fallback)"}</strong>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-805 rounded-xl p-4 shadow-sm min-h-[500px]">
              <StockChatAssistant symbol={scanResult ? scanResult.symbol : "TSLA"} anomalies={scanResult ? computedAnomalies : []} />
            </div>
          </div>
        )}

        {/* Tab 5: Database Settings */}
        {activeMainTab === "settings" && (
          <div className="space-y-6 animate-fade-in text-left">
            <section className="bg-zinc-900 border border-zinc-805 rounded-xl shadow-sm p-5 sm:p-6 space-y-6 text-left">
              <div className="flex items-center gap-3 border-b border-zinc-850 pb-4">
                <Database className="w-5 h-5 text-rose-400" />
                <div>
                  <h2 className="text-sm font-bold text-zinc-100 uppercase tracking-widest font-mono">
                    Google Drive Database Configuration
                  </h2>
                  <p className="text-xs text-zinc-500 mt-1">
                    Continuously synchronize your local scans and anomaly state across devices securely.
                  </p>
                </div>
              </div>
              
              <div className="space-y-5">
                <div>
                  <label className="block text-[10px] uppercase font-mono font-bold tracking-widest text-zinc-400 mb-1.5 break-words">
                    Database File ID (e.g. 1aBcDeFgHiJkLmNoPqRsTuVwXyZ)
                  </label>
                  <input
                    type="text"
                    value={autoSaveDbId}
                    onChange={(e) => setAutoSaveDbId(e.target.value)}
                    placeholder="Enter file ID from Google Drive..."
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-rose-500/50 rounded-lg p-2.5 text-xs text-zinc-200 outline-none font-mono"
                  />
                  <p className="text-[10px] text-zinc-600 mt-2 font-mono">
                    Setting this ID determines immediately where the data resolves.
                  </p>
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg border border-zinc-850 bg-zinc-950/40">
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-zinc-200 uppercase tracking-wide flex items-center gap-2">
                       {isSyncing && <Loader2 className="w-3 h-3 animate-spin text-rose-400" />}
                       Auto-Save Link
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono tracking-wider">
                       Continuously save background scans natively into the configured Drive ID
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAutoSaveEnabled(!isAutoSaveEnabled)}
                    className={`px-4 py-1.5 text-xs font-bold font-mono tracking-wider ml-4 rounded uppercase transition-colors border ${
                      isAutoSaveEnabled 
                        ? "bg-rose-950/60 text-rose-350 border-rose-900 hover:bg-rose-900/60 hover:text-rose-300"
                        : "bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300"
                    }`}
                  >
                    {isAutoSaveEnabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!autoSaveDbId) {
                        setDriveExportStatus("Please enter a valid Google Drive file ID first.");
                        return;
                      }
                      
                      try {
                        setIsDriveLoading(true);
                        setDriveExportStatus("Authenticating Google Drive...");
                        
                        let token = driveToken;
                        if (!token) {
                          const res = await googleSignIn();
                          if (res) {
                            token = res.accessToken;
                            setDriveToken(token);
                            setDriveUser(res.user);
                          }
                        }

                        if (!token) {
                           setDriveExportStatus("Failed to sign in to Google Drive.");
                           return;
                        }

                        setDriveExportStatus(`Downloading data from ${autoSaveDbId}...`);
                        const textContent = await downloadJSONFromGoogleDrive(token, autoSaveDbId);
                        
                        if (textContent) {
                           setSavedScans(textContent);
                           setDriveExportStatus("Successfully loaded and applied the database state!");
                        } else {
                           setDriveExportStatus("File was empty or invalid JSON.");
                        }
                      } catch (err: any) {
                        console.error(err);
                        setDriveExportStatus("Load failed: " + (err.message || String(err)));
                      } finally {
                        setIsDriveLoading(false);
                      }
                    }}
                    className="flex-1 px-4 py-2.5 bg-blue-950/40 text-blue-400 hover:bg-blue-900/40 border border-blue-900/40 hover:text-blue-300 hover:border-blue-700/50 rounded font-mono text-xs uppercase font-bold text-center flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <Download className="w-4 h-4" /> Load State from Database
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        setIsDriveLoading(true);
                        setDriveExportStatus("Authenticating Google Drive...");
                        
                        let token = driveToken;
                        if (!token) {
                          const res = await googleSignIn();
                          if (res) {
                            token = res.accessToken;
                            setDriveToken(token);
                            setDriveUser(res.user);
                          }
                        }

                        if (!token) {
                           setDriveExportStatus("Failed to sign in to Google Drive.");
                           return;
                        }

                        setDriveExportStatus(`Creating new Database JSON File on Google Drive...`);
                        
                        const filename = `Stock_Anomalies_History_Backup_${new Date().toISOString().slice(0, 10)}.json`;
                        const res = await uploadJSONToGoogleDrive(token, JSON.stringify(savedScans, null, 2), filename);
                        if (res && res.id) {
                           setAutoSaveDbId(res.id);
                           setDriveExportStatus(`Successfully created Database! New ID configured: ${res.id}`);
                        } else {
                           setDriveExportStatus("Failed to extract file ID after creation.");
                        }
                      } catch (err: any) {
                        console.error(err);
                        setDriveExportStatus("Create failed: " + (err.message || String(err)));
                      } finally {
                        setIsDriveLoading(false);
                      }
                    }}
                    className="flex-1 px-4 py-2.5 bg-emerald-950/40 text-emerald-400 hover:bg-emerald-900/40 border border-emerald-900/40 hover:text-emerald-300 hover:border-emerald-700/50 rounded font-mono text-xs uppercase font-bold text-center flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <Plus className="w-4 h-4" /> Create New Drive Database
                  </button>
                </div>
                
                {driveExportStatus && activeMainTab === "settings" && (
                   <div className="p-3 bg-zinc-950/50 border border-zinc-805 rounded text-xs font-mono text-zinc-400">
                     {driveExportStatus}
                   </div>
                )}
              </div>
            </section>

            {/* Batch Universe Scanner */}
            <section className="bg-zinc-900 border border-zinc-805 rounded-xl shadow-sm overflow-hidden text-left">
              <div
                className="p-4 bg-zinc-950/60 border-b border-zinc-850 flex items-center justify-between cursor-pointer select-none"
                onClick={() => setShowBatchScanner(!showBatchScanner)}
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-cyan-500" />
                  <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-widest font-mono">
                    Batch Universe Scanner
                  </h3>
                  <span className="text-[10px] bg-cyan-950 text-cyan-300 font-mono px-1.5 py-0.5 rounded border border-cyan-900">
                    Background Training
                  </span>
                </div>
                <button type="button" className="text-xs text-zinc-400 hover:text-zinc-200 transition-all font-mono font-bold">
                  {showBatchScanner ? "[ Collapse ]" : "[ Expand ]"}
                </button>
              </div>
              {showBatchScanner && (
                <div className="p-5">
                  <BatchScannerPanel />
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {rateLimitedSources.length > 0 && (
        <div className="fixed bottom-4 right-4 max-w-sm w-full bg-red-950/90 border border-red-900 rounded-lg p-4 shadow-2xl z-50 animate-fade-in flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-red-400 font-bold text-xs uppercase tracking-wider flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              API Limit Reached
            </h3>
            <button
              onClick={() => setRateLimitedSources([])}
              className="text-red-400 hover:text-red-300 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-red-200 text-[11px] leading-relaxed">
            The daily usage limit has been reached for the following data providers: <strong className="text-red-100">{rateLimitedSources.join(", ")}</strong>. 
            These sources will be automatically skipped for the remainder of this session to prevent further errors. Fallback providers will be used where available.
          </p>
        </div>
      )}

      {/* Dynamic Google Drive File Picker Window Pop-up */}
      {isDrivePickerOpen && (
        <div id="drive-picker-backdrop" className="fixed inset-0 bg-black/85 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div id="drive-picker-window" className="max-w-xl w-full bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl flex flex-col h-[420px] overflow-hidden">
            {/* Header portion */}
            <div className="flex justify-between items-center p-4 border-b border-zinc-805 shrink-0 bg-zinc-950/30">
              <div className="flex items-center gap-2">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="w-5 h-5 shrink-0">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                </svg>
                <div className="text-left">
                  <h3 className="text-xs font-bold font-mono text-zinc-100 uppercase tracking-widest leading-none">Drive File Selector</h3>
                  <span className="text-[10px] text-zinc-500 font-sans">Browse, search, and import sandbox JSON backups</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDrivePickerOpen(false)}
                className="text-zinc-400 hover:text-zinc-250 font-mono text-xs px-2 py-1 bg-zinc-950/40 rounded border border-zinc-800 hover:bg-zinc-800 cursor-pointer transition-colors"
              >
                Cancel
              </button>
            </div>

            {/* Filter Search Input */}
            <div className="p-3 border-b border-zinc-805 bg-zinc-950/20 flex gap-2 shrink-0">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Search JSON files in your entire Google Drive..."
                  value={drivePickerSearchQuery}
                  onChange={(e) => {
                    setDrivePickerSearchQuery(e.target.value);
                    handleSearchDrivePicker(e.target.value);
                  }}
                  className="w-full bg-zinc-950/80 border border-zinc-800 hover:border-zinc-700 focus:border-cyan-500 text-zinc-200 rounded pl-8 pr-3 py-1.5 text-xs focus:outline-none transition-all placeholder:text-zinc-650"
                />
              </div>
              <button
                type="button"
                onClick={() => handleSearchDrivePicker(drivePickerSearchQuery)}
                className="px-3 py-1.5 bg-zinc-850 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded border border-zinc-800 text-xs font-mono transition-all cursor-pointer"
              >
                Refresh
              </button>
            </div>

            {/* File List Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-zinc-950/45 min-h-0 custom-scrollbar">
              {isSearchingPicker ? (
                <div className="flex flex-col items-center justify-center py-24 gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                  <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">Browsing user database documents...</span>
                </div>
              ) : drivePickerError ? (
                <div className="p-3 bg-rose-950/20 border border-rose-900/30 text-rose-450 text-xs rounded text-center font-mono">
                  {drivePickerError}
                </div>
              ) : drivePickerFiles.length === 0 ? (
                <div className="text-center py-16 text-zinc-500 text-xs italic font-mono space-y-1">
                  <p>No JSON configuration or database backups found.</p>
                  <p className="text-[10px] text-zinc-600 block">Tip: Upload data files with name ending with .json extension first.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {drivePickerFiles.map((f) => {
                    const formatByteSize = (bytesStr?: string) => {
                      if (!bytesStr) return "Unknown size";
                      const bytes = parseInt(bytesStr, 10);
                      if (isNaN(bytes)) return "Unknown size";
                      if (bytes < 1024) return `${bytes} B`;
                      if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
                      return `${(bytes / 1048576).toFixed(1)} MB`;
                    };

                    return (
                      <div
                        key={f.id}
                        className="flex items-center justify-between gap-3 p-2 bg-zinc-900/90 hover:bg-zinc-850 rounded border border-zinc-805 hover:border-zinc-700 transition-all text-left"
                      >
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileJson className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                            <span className="font-mono text-xs font-semibold text-zinc-200 truncate block" title={f.name}>
                              {f.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[9px] text-zinc-500 font-mono uppercase">
                            <span>{formatByteSize(f.size)}</span>
                            <span className="text-zinc-750 font-black">&bull;</span>
                            <span>Modified: {safeToLocaleString(f.createdTime)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            setIsDrivePickerOpen(false);
                            await handleImportDriveBackup(f.id);
                          }}
                          className="px-2.5 py-1 bg-emerald-950/60 text-emerald-350 border border-emerald-900 hover:bg-emerald-900/40 hover:text-emerald-300 font-mono text-2xs font-semibold rounded cursor-pointer transition-all shrink-0 hover:scale-[1.01]"
                        >
                          Import
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bottom guide info line */}
            <div className="p-3 border-t border-zinc-805 bg-zinc-950/30 font-mono text-[8.5px] text-zinc-500 uppercase flex justify-between tracking-wider shrink-0">
              <span>Selected cloud resource parses automatically</span>
              <span>JSON format validated on ingress</span>
            </div>
          </div>
        </div>
      )}

      {/* Footer info bar */}
      <footer className="mt-auto py-8 border-t border-zinc-900 bg-zinc-950/80">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
          <div>
            &copy; 2026 Stock Catalyst Historian &bull; Grounded on Google Gemini 3.5 &bull; Real-Time Returns Scanned
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Database className="w-3.5 h-[14px] text-zinc-500 font-sans" />
              Local Container File Caching: active
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
