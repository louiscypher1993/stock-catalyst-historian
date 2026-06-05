import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

/**
 * Quant Scanner Pipeline Standalone Desktop Installer Utility.
 * 
 * Provides automated bootstrapping for on-premise local metallic-metal execution,
 * copying environmental default states, building databases without RDS clusters,
 * installing packages, and dropping direct native launch shortcuts onto
 * Windows and macOS desktops.
 * 
 * Jargon-Free Architecture Philosophy:
 * We don't need a single virtual network mesh gateway or a multi-region VPC peer
 * configuration to manage local file system links. A simple script is safer
 * and costs $0.00 in cloud provider ingress bills.
 */

const rootDir = process.cwd();

/**
 * Resolves the user's native desktop directory in a crash-resilient fashion.
 * Accurately handles OneDrive desktop structures on Windows and homedir on macOS.
 * 
 * @returns {string} The fully-qualified path to the active Desktop directory.
 */
function getDesktopDirectory(): string {
  const home = os.homedir();
  
  if (process.platform === "win32") {
    // Sarcastic architectural note: Windows loves burying the Desktop folder in OneDrive/Desktop 
    // when corporate administrators want to auto-sync your gaming wallpapers to enterprise SharePoint sites.
    const onedriveDesktop = path.join(home, "OneDrive", "Desktop");
    if (fs.existsSync(onedriveDesktop)) {
      return onedriveDesktop;
    }
    const defaultDesktop = path.join(home, "Desktop");
    if (fs.existsSync(defaultDesktop)) {
      return defaultDesktop;
    }
    // Deep fallback if user overrides home profile configurations
    return process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Desktop") : defaultDesktop;
  }
  
  return path.join(home, "Desktop");
}

/**
 * Automates package restoration via a child process shell execution.
 * Streams standard output live to the terminal to avoid the dreaded corporate
 * experience of watching a completely silent, frozen loading bar for 10 minutes.
 */
function bootstrapDependencies(): void {
  console.log("\n[BOOTSTRAP] Commencing local Node.js dependency restoration...");
  console.log("[BOOTSTRAP] Executing: npm install --no-audit --no-fund");
  
  try {
    execSync("npm install --no-audit --no-fund", {
      cwd: rootDir,
      stdio: "inherit" // Direct IO streaming to preserve native console feedback
    });
    console.log("[BOOTSTRAP] Dependancy tree compiled and stored locally in node_modules/.");
  } catch (error: any) {
    console.warn("[-] WARNING: Local dependency install returned a non-zero exit code:", error.message);
    console.warn("[!] The installer will proceed, but you may need to run 'npm install' manually inside the extracted folder.");
  }
}

/**
 * Validates the local environment variable storage state.
 * If there is no existing `.env` profile, duplicates `.env.example`.
 */
function verifyEnvironmentConfiguration(): void {
  const envPath = path.join(rootDir, ".env");
  const envExamplePath = path.join(rootDir, ".env.example");
  
  console.log("\n[ENV-VERIFY] Checking environment variables configuration...");
  
  if (fs.existsSync(envPath)) {
    console.log("[ENV-VERIFY] Active '.env' configurations file detected.");
    return;
  }
  
  if (fs.existsSync(envExamplePath)) {
    console.log("[ENV-VERIFY] Creating fresh '.env' file from '.env.example' prototype...");
    try {
      fs.copyFileSync(envExamplePath, envPath);
      console.log("[ENV-VERIFY] Successfully synchronized environment files.");
    } catch (err: any) {
      console.error("[-] Failed copying environment placeholder file:", err.message);
    }
  } else {
    // Sarcastic Comment: Missing both configuration templates usually implies an engineer 
    // ran 'rm -rf' blindly to "solve" a minor TypeScript warning. Write a brand new one.
    console.log("[ENV-VERIFY] '.env.example' not found. Creating a clean environment configuration from scratch...");
    const rawEnv = `GEMINI_API_KEY="YOUR_GEMINI_API_KEY_HERE"
FMP_API_KEY="YOUR_FMP_API_KEY_HERE"
EODHD_API_KEY="YOUR_EODHD_API_KEY_HERE"
POLYGON_API_KEY="YOUR_POLYGON_API_KEY_HERE"
NEWSAPI_KEY="YOUR_NEWSAPI_KEY_HERE"
FRED_API_KEY="YOUR_FRED_API_KEY_HERE"
APP_URL="http://localhost:3000"`;
    try {
      fs.writeFileSync(envPath, rawEnv, "utf-8");
      console.log("[ENV-VERIFY] Created fallback local '.env' file with mock API parameters.");
    } catch (err: any) {
      console.error("[-] Failed saving manual fallback .env file:", err.message);
    }
  }
}

/**
 * Builds the structural database cache state.
 * SQLite creates files on demand, so checking if it exists is sufficient.
 * No multi-node replication cluster topology maps required!
 */
function verifyDatabasePresence(): void {
  const dbPath = path.join(rootDir, "market_cache.db");
  console.log("\n[DATABASE] Locating active analytical database state...");
  
  if (fs.existsSync(dbPath)) {
    console.log(`[DATABASE] Found healthy pre-existing database cache file: ${dbPath}`);
  } else {
    console.log("[DATABASE] No pre-existing SQLite file has been detected.");
    console.log("[DATABASE] A localized SQLite db file will be created on the fly during the first pipeline launch cycle.");
  }
}

/**
 * Creates an OS-specific terminal launcher shortcut on the user's Desktop.
 * 
 * Supports Windows (.lnk via PowerShell integration object shell) and
 * macOS (.command double-click executable shell wrappers).
 */
function createDesktopShortcut(): void {
  const desktopDir = getDesktopDirectory();
  const platform = process.platform;
  
  console.log(`\n[OS-DETECTION] Host kernel architecture: ${platform}`);
  console.log(`[OS-DETECTION] Target Desktop location : ${desktopDir}`);
  
  if (!fs.existsSync(desktopDir)) {
    console.warn("[-] WARNING: Could not verify Desktop folder exists at path:", desktopDir);
    return;
  }

  const shortcutTitle = "Quant Scanner Pipeline";

  if (platform === "win32") {
    // Sarcastic note on Microsoft shortcuts: Windows likes binary shell stream descriptors (.lnk) 
    // instead of plain readable files, forcing us to invoke PowerShell to create a COM automation shell.
    const shortcutPath = path.join(desktopDir, `${shortcutTitle}.lnk`);
    console.log(`[SHORTCUT] Formatting native Windows shortcut at: ${shortcutPath}`);
    
    // We target cmd.exe to launch and remain open (/k) running our express live stock loop.
    // The command must change directories to rootDir first.
    const runCommand = `cmd.exe`;
    const runArgs = `/k cd /d "${rootDir}" && npm run scan:live`;
    
    const psScript = `$WshShell = New-Object -ComObject WScript.Shell; ` +
                     `$Shortcut = $WshShell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}'); ` +
                     `$Shortcut.TargetPath = '${runCommand}'; ` +
                     `$Shortcut.Arguments = '${runArgs.replace(/'/g, "''")}'; ` +
                     `$Shortcut.WorkingDirectory = '${rootDir.replace(/'/g, "''")}'; ` +
                     `$Shortcut.Description = 'Quant Scanner Live Pipeline Monitor'; ` +
                     `$Shortcut.Save()`;
    
    try {
      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript}"`);
      console.log("[SHORTCUT] Success! Native '.lnk' Windows Desktop shortcut generated cleanly.");
    } catch (error: any) {
      console.error("[-] ERROR: PowerShell desktop link generation faulted:", error.message);
      console.log("[SHORTCUT] Falling back to creating a standard batch file direct launcher...");
      
      const batLegacyPath = path.join(desktopDir, `Launch_Quant_Scanner.bat`);
      const batContent = `@echo off\r\ncd /d "${rootDir}"\r\nnpm run scan:live\r\npause\r\n`;
      try {
        fs.writeFileSync(batLegacyPath, batContent, "utf-8");
        console.log(`[SHORTCUT] Created secondary fallback batch shortcut at ${batLegacyPath}`);
      } catch (batErr: any) {
        console.error("[-] Secondary batch fallback failed:", batErr.message);
      }
    }
  } else if (platform === "darwin") {
    // macOS double-clickable terminal command file. Simple, elegant, Unix-compliant.
    const shortcutPath = path.join(desktopDir, `${shortcutTitle}.command`);
    console.log(`[SHORTCUT] Formatting native macOS command launcher at: ${shortcutPath}`);
    
    const commandContent = `#!/bin/bash
clear
echo "========================================================================="
echo "📈 STARTING PORTABLE QUANT SCANNER LIVE MONITOR PIPELINE"
echo "========================================================================="
cd "${rootDir}"
npm run scan:live
`;

    try {
      fs.writeFileSync(shortcutPath, commandContent, { encoding: "utf-8", mode: 0o755 });
      // Extra chmod call just to force-stamp execute privilege over MacOS gatekeepers
      execSync(`chmod +x "${shortcutPath}"`);
      console.log("[SHORTCUT] Success! Executable double-clickable '.command' file created on Desktop.");
    } catch (macErr: any) {
      console.error("[-] ERROR: macOS .command file instantiation faulted:", macErr.message);
    }
  } else {
    // Sarcastic Comment: Linux developers don't need shortcuts. They write 80-line systemd configuration 
    // templates and boot scanners from a custom customized system tty anyway.
    console.log("[SHORTCUT] Linux cluster detected. Real-metal engineers boot directly via standard term pipes:");
    console.log(`    cd "${rootDir}" && npm run scan:live`);
  }
}

/**
 * Runner system installer orchestration core sequence.
 */
function runInstaller(): void {
  console.log("=========================================================================");
  console.log("🛠️  QUANT STOCK ANALYSIS ENGINE - LOCAL ENVIRONMENT MAIN INSTALL SYSTEM");
  console.log("=========================================================================");
  console.log("[SYS-ARCH] Preparing hardware loopback workspace state...");
  console.log("[SYS-ARCH] Source Directory: " + rootDir);
  
  bootstrapDependencies();
  verifyEnvironmentConfiguration();
  verifyDatabasePresence();
  createDesktopShortcut();
  
  console.log("\n=========================================================================");
  console.log("🎉 INSTALLATION PIPELINE FULLY COMPLETED.");
  console.log("=========================================================================");
  console.log(" Ready to monitor market shock anomalies out of your own hardware workspace.");
  console.log(" Double-click the 'Quant Scanner Pipeline' shortcut on your Desktop");
  console.log(" or execute 'npm run scan:live' directly inside this terminal.");
  console.log("=========================================================================\n");
}

// Execute the bootstrapping orchestration routine
runInstaller();
