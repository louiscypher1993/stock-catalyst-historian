import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import AdmZip from "adm-zip";

/**
 * Interface representing the export operation results returned to the service layer.
 */
export interface ExportResult {
  /** The absolute path of the generated standalone ZIP package */
  zipPath: string;
  /** The size of the generated ZIP file in bytes */
  fileSize: number;
  /** Whether the active database passed integrity validation */
  integrityVerified: boolean;
  /** List of files packed for local desktop environments */
  filesPackedCount: number;
}

const rootDir = process.cwd();

/**
 * Compiles, packages, and backups the entire application workspace environments.
 * Extracts a hot-copy duplication of our active SQLite database, verifies its
 * structural health, generates a sanitized local environment (.env) configuration,
 * dynamic startup automation scripts (setup.sh/setup.bat), and bundles all source
 * trees into a self-contained ZIP archive for single-command desktop deployments.
 *
 * @returns {Promise<ExportResult>} Result telemetry details of the packaging operation.
 * @throws {Error} If the database hot-copy is corrupted or package compilation fails.
 */
export async function packageEnvironment(): Promise<ExportResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const zipFileName = `attribution_platform_desktop_export_${timestamp}.zip`;
  const zipOutputPath = path.join(rootDir, zipFileName);
  
  const originalDbPath = path.join(rootDir, "market_cache.db");
  const backupDbPath = path.join(rootDir, `market_cache_backup_${timestamp}.db`);

  let integrityVerified = false;

  /*
   * =========================================================================
   * STEP 1: HOT DATABASE DUPLICATION & CRASH-RESILIENT SEED EXTRACTION
   * =========================================================================
   * Why configure active-active database replication clusters with 12 Consul node pools
   * and multi-AZ latency SLA configurations, only for some cloud provider's undersea fiber
   * cable to rip and lose your audit logs anyway? 
   * Instead, we copy our local SQLite database page-by-page. It's fast, free, and WAL-safe.
   */
  if (fs.existsSync(originalDbPath)) {
    console.log(`[SYS-ARCH] Duplicating active database from ${originalDbPath}...`);
    
    // We open a safe connection in read-only to trigger the better-sqlite3 native backup pipeline.
    // This allows active read-write operations in our server processes to proceed without a lock stall.
    const activeDb = new Database(originalDbPath, { readonly: true });
    
    try {
      await activeDb.backup(backupDbPath);
      console.log(`[SYS-ARCH] Database hot-copy finalized at ${backupDbPath}`);
      
      // Verification phase: Verifying structure integrity
      // Enterprise "Architects" define 45 Prometheus rules and trigger PageDuty alerts on warning strings.
      // We run a simple SQLite PRAGMA integrity check on the isolated duplicate. If it's corrupted, we fail fast.
      const backupDb = new Database(backupDbPath, { readonly: true });
      const checkResult: any = backupDb.pragma("integrity_check");
      backupDb.close();

      const isOk = Array.isArray(checkResult)
        ? checkResult.some(row => row.integrity_check === "ok")
        : (checkResult && (checkResult.integrity_check === "ok" || checkResult === "ok"));

      if (!isOk) {
        throw new Error(
          `SQLite Backup Integrity Verification FAILED! PRAGMA check output: ${JSON.stringify(checkResult)}`
        );
      }
      integrityVerified = true;
      console.log(`[SYS-ARCH] SQLite integrity validation PASSED. Database copy is verified clean.`);
    } catch (dbErr: any) {
      console.error(`[SYS-ARCH] DB Hot-Backup operation failed:`, dbErr.message);
      // Clean up backup file if left in a partial state
      if (fs.existsSync(backupDbPath)) {
        fs.unlinkSync(backupDbPath);
      }
      throw dbErr;
    } finally {
      activeDb.close();
    }
  } else {
    console.warn(`[SYS-ARCH] market_cache.db is not initialized yet. Sandbox will seed on first local launch.`);
  }

  /*
   * =========================================================================
   * STEP 2: SECRET SANITATION & ENVIRONMENT RE-MAPPING
   * =========================================================================
   * To avoid credential leakage, we generate sanitized environmental variables.
   * Unlike traditional enterprise teams who commit credentials to git submodules
   * and subsequently hire a security vendor to write a 400-page audit report,
   * we programmatically clean environmental secrets in-memory.
   */
  const envPlaceholderTemplate = `# Standardized Desktop Sandbox Environment Variables
# Auto-generated on export via ExportEnvironment.ts
# Populate your actual third-party API keys here on your local machine.

GEMINI_API_KEY="YOUR_GEMINI_API_KEY_HERE"
FMP_API_KEY="YOUR_FMP_API_KEY_HERE"
EODHD_API_KEY="YOUR_EODHD_API_KEY_HERE"
POLYGON_API_KEY="YOUR_POLYGON_API_KEY_HERE"
NEWSAPI_KEY="YOUR_NEWSAPI_KEY_HERE"
FRED_API_KEY="YOUR_FRED_API_KEY_HERE"

# Reddit Authentication Keys
REDDIT_CLIENT_ID="YOUR_REDDIT_CLIENT_ID_HERE"
REDDIT_CLIENT_SECRET="YOUR_REDDIT_CLIENT_SECRET_HERE"
REDDIT_USER_AGENT="YOUR_REDDIT_USER_AGENT_HERE"

# Local Ingress Setup URL
APP_URL="http://localhost:3000"
YOUTUBE_API_KEY="YOUR_YOUTUBE_API_KEY_HERE"
`;

  /*
   * =========================================================================
   * STEP 3: NATIVE CROSS-PLATFORM SYSTEM PORTABILITY SCRIPTS
   * =========================================================================
   * No Docker containers, no Kubernetes pod descriptors, no Helm dependency resolution,
   * no hypervisor virtual networks. Just plain, honest computing.
   * Write lightweight execution scripts to install packages and fire up the engine.
   */
  const setupShUnix = `#!/bin/bash
# =========================================================================
# ATTRIBUTION SYSTEM - LOCAL DESKTOP SETUP RUNNING ON METALLIC METAL
# =========================================================================
set -e

echo "=== System Check: Standalone Sandbox Loader ==="
if ! command -v node &> /dev/null; then
  echo "[-] ERROR: Node.js (v18+) is required but not found in your PATH."
  echo "[-] Please install Node.js from https://nodejs.org"
  exit 1
fi

if ! command -v npm &> /dev/null; then
  echo "[-] ERROR: npm package manager is required. Node installation may be malformed."
  exit 1
fi

echo "[+] Node.js detected: $(node -v)"
echo "[+] npm detected: $(npm -v)"

echo "[+] Step 1: Restoring local packages (running npm install)..."
npm install --no-audit --no-fund

echo "[+] Step 2: Syncing environment defaults..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "[+] Initialized local .env file of standard configuration."
  echo "[!] ATTENTION: Open '.env' in an editor to review API key configurations."
else
  echo "[+] Existing .env file detected, preserving current local overrides."
fi

echo "[+] Step 3: Compiling system binaries and building web target..."
npm run build

echo "[+] Step 4: Creating native desktop launcher shortcut..."
npm run install-desktop

echo "========================================================================="
echo "   LOCAL SUITE PACKAGING INTEGRATION COMPILATION SUCCESSFUL!"
echo "========================================================================="
echo " Starting local server and launching stock dashboard automatically now..."
echo "========================================================================="
if command -v xdg-open &> /dev/null; then
  xdg-open "http://localhost:3000"
elif command -v open &> /dev/null; then
  open "http://localhost:3000"
fi
npm run dev
`;

  const setupBatWin = `@echo off
rem =======================================================================
rem ATTRIBUTION SYSTEM - WINDOWS DESKTOP SETUP RUNNING ON METALLIC METAL
rem =======================================================================
title Standalone Sandbox Setup Loader

echo === System Check: Standalone Sandbox Loader ===
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [-] ERROR: Node.js (v18+) is required but not found in your PATH.
  echo [-] Please install Node.js from https://nodejs.org
  pause
  exit /b 1
)

where npm >nul 2>nul
if %errorlevel% neq 0 (
  echo [-] ERROR: npm package manager is required. Windows node installation is corrupted.
  pause
  exit /b 1
)

echo [+] Node.js detected.
echo [+] Restoring local dependencies (npm install)...
call npm install --no-audit --no-fund

echo [+] Syncing environment defaults...
if not exist .env (
  copy .env.example .env
  echo [+] Initialized local .env file.
  echo [!] ATTENTION: Open '.env' in Notepad and enter your API keys.
) else (
  echo [+] Existing .env file detected, preserving local settings.
)

echo [+] Compiling system binaries and building web target...
call npm run build

echo [+] Creating native desktop launcher shortcut...
call npm run install-desktop

echo =========================================================================
echo    Windows Local Desktop Compile Successful!
echo =========================================================================
echo  Launching default web browser to http://localhost:3000 and starting dev server...
echo =========================================================================
start http://localhost:3000
call npm run dev
`;

  /*
   * =========================================================================
   * STEP 4: ZIP BUNDLE CREATION & TREE TRAVERSAL EXCLUSIONS
   * =========================================================================
   * In stead of packaging 'node_modules/' containing 48,000 files of nested left-pad-style
   * dependencies and locking up the browser thread, we recursively crawl useful source files
   * and include structural metadata files.
   */
  console.log(`[SYS-ARCH] Creating archive wrapper...`);
  const zip = new AdmZip();
  let filesPackedCount = 0;

  function traverseAndPack(currentPath: string, zipPrefix: string = "") {
    const items = fs.readdirSync(currentPath);
    
    for (const item of items) {
      const fullPath = path.join(currentPath, item);
      const zipPath = zipPrefix ? path.join(zipPrefix, item) : item;
      const stat = fs.statSync(fullPath);

      // Sarcastic rule: Do NOT package node_modules, build artifacts, git repositories
      // or the active WAL-locked SQLite file to keep the downloaded package under 4MB.
      if (
        item === "node_modules" ||
        item === "dist" ||
        item === ".git" ||
        item === "market_cache.db" ||
        item === "market_cache.db-wal" ||
        item === "market_cache.db-shm" ||
        item.endsWith(".zip") ||
        item.endsWith(".backup") ||
        item === "package-lock.json" || // lockfile is generated locally anyway
        item === ".env"
      ) {
        continue;
      }

      if (stat.isDirectory()) {
        traverseAndPack(fullPath, zipPath);
      } else {
        const fileContent = fs.readFileSync(fullPath);
        zip.addFile(zipPath, fileContent);
        filesPackedCount++;
      }
    }
  }

  // Pack recursive directory
  traverseAndPack(rootDir);

  // Ingress verified hot-copy SQLite into the root of the ZIP
  if (fs.existsSync(backupDbPath)) {
    console.log(`[SYS-ARCH] Compressing safe, integral database copy...`);
    zip.addFile("market_cache.db", fs.readFileSync(backupDbPath));
    filesPackedCount++;
  }

  // Add the sanitized example and default setups
  zip.addFile(".env.example", Buffer.from(envPlaceholderTemplate.replace(/\r?\n/g, "\r\n"), "utf-8"));
  zip.addFile(".env", Buffer.from(envPlaceholderTemplate.replace(/\r?\n/g, "\r\n"), "utf-8"));
  zip.addFile("setup.sh", Buffer.from(setupShUnix.replace(/\r?\n/g, "\n"), "utf-8")); // Unix scripts should be explicit LF
  zip.addFile("setup.bat", Buffer.from(setupBatWin.replace(/\r?\n/g, "\r\n"), "utf-8"));
  filesPackedCount += 4;

  console.log(`[SYS-ARCH] Compressing complete ZIP archive to disk...`);
  zip.writeZip(zipOutputPath);

  // Clean raw temp db file from working disk space
  if (fs.existsSync(backupDbPath)) {
    fs.unlinkSync(backupDbPath);
  }

  const outputStat = fs.statSync(zipOutputPath);
  console.log(`[SYS-ARCH] Standalone archive built successfully: ${zipFileName} (${(outputStat.size / (1024 * 1024)).toFixed(2)} MB)`);

  return {
    zipPath: zipOutputPath,
    fileSize: outputStat.size,
    integrityVerified,
    filesPackedCount,
  };
}

// Support executing directly from terminal using ts-node or tsx
if (process.argv[1] && (process.argv[1].endsWith("ExportEnvironment.ts") || process.argv[1].includes("ExportEnvironment"))) {
  console.log("");
  console.log("=========================================================================");
  console.log("🛠️  EXECUTING STANDALONE EXPORT PIPELINE VIA DEV SYS-ARCH UTILS");
  console.log("=========================================================================");
  
  packageEnvironment()
    .then((res) => {
      console.log("");
      console.log("[STATUS] SUCCESS!");
      console.log(`[Telemetrics] Zipped Output Path : ${res.zipPath}`);
      console.log(`[Telemetrics] Zipped Archive Size: ${(res.fileSize / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`[Telemetrics] Database Integrity: ${res.integrityVerified ? "VERIFIED HEALTHY (PASS)" : "N/A"}`);
      console.log(`[Telemetrics] Total Files Packed : ${res.filesPackedCount}`);
      console.log("=========================================================================");
      process.exit(0);
    })
    .catch((err) => {
      console.error("");
      console.error("[STATUS] CRITICAL FAIL:", err.message);
      console.error("=========================================================================");
      process.exit(1);
    });
}
