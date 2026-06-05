import { HistoricalEngine } from "./HistoricalEngine.js";

async function run() {
  const engine = new HistoricalEngine();
  try {
    const res = await engine.run_scan("BINT.L", 1, true);
    console.log("Success BINT.L", res.points.length);
  } catch(e) {
    console.log("Error BINT.L", e);
  }
}
run();
