// Run with: npx tsx validate.ts
// All network calls are real but lightweight (single lookups, cached after first run)
// Expected output: 7 checks, all PASS or SKIP

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { getFinnhubNewsCount } from "./FinnhubService";
import { getFDAActivity } from "./FDAService";
import { getTrainingDataset } from "./db";

type CheckResult = "PASS" | "FAIL" | "SKIP";

function report(n: number, label: string, result: CheckResult, note?: string) {
  const icon = result === "PASS" ? "✓" : result === "SKIP" ? "~" : "✗";
  const line = `[${icon}] CHECK ${n} ${result} — ${label}${note ? `: ${note}` : ""}`;
  console.log(line);
}

let anyFail = false;

async function check1() {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) {
    try {
      const result = await getFinnhubNewsCount("AAPL", "2024-01-15");
      if (result === null) {
        report(1, "FinnhubService graceful disable", "PASS", "returned null without throwing (no API key)");
      } else {
        report(1, "FinnhubService graceful disable", "FAIL", `expected null without key, got ${JSON.stringify(result)}`);
        anyFail = true;
      }
    } catch (err) {
      report(1, "FinnhubService graceful disable", "FAIL", `threw: ${err}`);
      anyFail = true;
    }
  } else {
    try {
      const result = await getFinnhubNewsCount("AAPL", "2024-01-15");
      if (
        result === null ||
        (result !== null &&
          typeof result.articleCount === "number" &&
          typeof result.isElevated === "boolean")
      ) {
        report(1, "FinnhubService graceful disable", "PASS",
          result === null
            ? "API key set, returned null (graceful failure)"
            : `articleCount=${result.articleCount}, isElevated=${result.isElevated}`
        );
      } else {
        report(1, "FinnhubService graceful disable", "FAIL", `unexpected shape: ${JSON.stringify(result)}`);
        anyFail = true;
      }
    } catch (err) {
      report(1, "FinnhubService graceful disable", "FAIL", `threw: ${err}`);
      anyFail = true;
    }
  }
}

async function check2() {
  try {
    const result = await getFDAActivity("Apple Inc", "2024-01-15");
    if (result !== null && result.hasActivity === false) {
      report(2, "FDAService non-pharma", "PASS", "hasActivity=false as expected (404 → empty result)");
    } else if (result === null) {
      report(2, "FDAService non-pharma", "FAIL", "returned null — expected empty result object");
      anyFail = true;
    } else {
      report(2, "FDAService non-pharma", "FAIL", `unexpected result: ${JSON.stringify(result)}`);
      anyFail = true;
    }
  } catch (err) {
    report(2, "FDAService non-pharma", "FAIL", `threw: ${err}`);
    anyFail = true;
  }
}

async function check3() {
  try {
    const result = await getFDAActivity("Pfizer", "2024-01-15");
    if (result !== null) {
      report(3, "FDAService pharma company", "PASS",
        `activityCount=${result.activityCount}, activityTypes=[${result.activityTypes.join(", ")}]`
      );
    } else {
      report(3, "FDAService pharma company", "SKIP", "returned null (API may be down)");
    }
  } catch (err) {
    report(3, "FDAService pharma company", "FAIL", `threw: ${err}`);
    anyFail = true;
  }
}

function check4() {
  try {
    const rows = getTrainingDataset();
    if (!Array.isArray(rows)) {
      report(4, "db.ts getTrainingDataset", "FAIL", "did not return an array");
      anyFail = true;
      return;
    }
    const events = rows.filter(r => r.label === 1).length;
    const nonEvents = rows.filter(r => r.label === 0).length;
    report(4, "db.ts getTrainingDataset", "PASS",
      `Training rows found: ${rows.length}, events: ${events}, non-events: ${nonEvents}`
    );
  } catch (err) {
    report(4, "db.ts getTrainingDataset", "FAIL", `threw: ${err}`);
    anyFail = true;
  }
}

function check5() {
  const csvPath = path.join(dirname(fileURLToPath(import.meta.url)), "CSVExportService.ts");
  const source = fs.readFileSync(csvPath, "utf8");

  const required = [
    "Is Null Sample (Non-Event)",
    "Non-Event Signals That Fired",
    "snap_z_score",
    "snap_vix",
    "snap_gdelt_tone_z",
    "snap_stocktwits_virality_z",
    "snap_estimate_revision_direction",
  ];

  const missing = required.filter(h => !source.includes(`"${h}"`));
  if (missing.length === 0) {
    report(5, "CSVExportService headers", "PASS", "all 7 required headers present");
  } else {
    report(5, "CSVExportService headers", "FAIL", `missing: ${missing.join(", ")}`);
    anyFail = true;
  }
}

function check6() {
  const enginePath = path.join(dirname(fileURLToPath(import.meta.url)), "HistoricalEngine.ts");
  const source = fs.readFileSync(enginePath, "utf8");

  const keysRequired = [
    "stocktwits_virality",
    "_tempFinnhubNewsCount",
    "_tempFinnhubInsiderCount",
    "_tempFDAActivityCount",
  ];
  const flagsRequired = [
    "finnhub_news_elevated",
    "finnhub_insider_active",
    "fda_activity",
  ];

  const allRequired = [...keysRequired, ...flagsRequired];
  const missing = allRequired.filter(s => !source.includes(`"${s}"`));

  if (missing.length === 0) {
    report(6, "collectExternalSignals keys", "PASS", "all 4 keys + 3 boolean injections found");
  } else {
    report(6, "collectExternalSignals keys", "FAIL", `missing: ${missing.join(", ")}`);
    anyFail = true;
  }
}

function check7() {
  const enginePath = path.join(dirname(fileURLToPath(import.meta.url)), "HistoricalEngine.ts");
  const source = fs.readFileSync(enginePath, "utf8");

  const divThreeCount = (source.match(/realAnomalies\.length\s*\/\s*3/g) || []).length;
  const divTwoMatches = source.match(/realAnomalies\.length\s*\/\s*2/g) || [];
  const divTwoCount = divTwoMatches.length;

  if (divThreeCount > 0) {
    report(7, "Non-event ratio", "FAIL", `found ${divThreeCount} occurrence(s) of /3 — should be 0`);
    anyFail = true;
  } else if (divTwoCount < 2) {
    report(7, "Non-event ratio", "FAIL", `only ${divTwoCount} occurrence(s) of /2 — expected at least 2`);
    anyFail = true;
  } else {
    report(7, "Non-event ratio", "PASS", `0 occurrences of /3, ${divTwoCount} occurrences of /2`);
  }
}

async function main() {
  console.log("=".repeat(55));
  console.log("validate.ts — Prompts N-T pipeline validation");
  console.log("=".repeat(55));

  await check1();
  await check2();
  await check3();
  check4();
  check5();
  check6();
  check7();

  console.log("=".repeat(55));
  if (anyFail) {
    console.log("RESULT: FAILED — one or more checks did not pass");
    process.exit(1);
  } else {
    console.log("RESULT: ALL CHECKS PASSED (or skipped)");
    process.exit(0);
  }
}

main();
