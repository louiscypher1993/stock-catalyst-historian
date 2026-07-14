/**
 * v10 recon (a): extracts the 10,051-row leakage-free test fold
 * (historical_inference_results, already-stored model outputs -- the true
 * held-out temporal split for the currently-deployed models) joined against
 * event_features for the ground-truth forward_return_* columns (not stored
 * on historical_inference_results itself). Writes to the same new local
 * sqlite file the (b) batch-inference script wrote to. Never touches
 * Supabase; only reads market_cache.db (read-only).
 */
const Database = require('better-sqlite3');
const path = require('path');

const SRC_DB = path.join(__dirname, '..', '..', 'market_cache.db');
const OUT_DB = path.join(__dirname, '..', '..', 'synthetic_pots', 'v10_history_sweep.db');

const src = new Database(SRC_DB, { readonly: true });
const out = new Database(OUT_DB);

const rows = src.prepare(`
  SELECT h.symbol, h.date,
         h.model_a_confidence, h.model_b_return_1m, h.model_c_max_drawdown,
         h.model_d1_return_3m, h.model_d2_return_6m, h.model_d3_return_2d, h.model_d5_return_2w,
         e.forward_return_2d, e.forward_return_2w, e.forward_return_3m, e.forward_return_6m
  FROM historical_inference_results h
  JOIN event_features e ON e.symbol = h.symbol AND e.date = h.date
  WHERE e.is_null_sample = 0
`).all();

console.log(`Extracted ${rows.length} rows from historical_inference_results JOIN event_features`);

out.exec(`
  DROP TABLE IF EXISTS model_scores_a;
  CREATE TABLE model_scores_a (
    symbol TEXT, date TEXT,
    model_a_confidence REAL, model_b_return_1m REAL, model_c_max_drawdown REAL,
    model_d1_return_3m REAL, model_d2_return_6m REAL, model_d3_return_2d REAL, model_d5_return_2w REAL,
    forward_return_2d REAL, forward_return_2w REAL, forward_return_3m REAL, forward_return_6m REAL
  );
`);

const insert = out.prepare(`
  INSERT INTO model_scores_a VALUES (@symbol,@date,@model_a_confidence,@model_b_return_1m,@model_c_max_drawdown,
    @model_d1_return_3m,@model_d2_return_6m,@model_d3_return_2d,@model_d5_return_2w,
    @forward_return_2d,@forward_return_2w,@forward_return_3m,@forward_return_6m)
`);
const insertMany = out.transaction((rs) => { for (const r of rs) insert.run(r); });
insertMany(rows);

console.log(`Wrote ${rows.length} rows to ${OUT_DB}::model_scores_a`);

src.close();
out.close();
