#!/usr/bin/env node
/**
 * watchlist-pulse.mjs — dependency-free intraday price check.
 *
 * Runs BEFORE `npm ci` in watchlist-pulse.yml so a no-op pulse (no symbol
 * moved enough to warrant a full score) costs under a minute of Actions time.
 * Built-in fetch only — zero npm imports. `node:fs` is a Node built-in, not
 * an npm package, so it's fine to use for GITHUB_OUTPUT.
 *
 * Modes:
 *   (default)              read watchlist + open POTS positions + price
 *                          state, decide which symbols need a full score,
 *                          write last_checked_price/at for everything
 *                          checked, emit triggered_symbols via GITHUB_OUTPUT.
 *   --dry-run              same decisions, logged, but zero writes and no
 *                          GITHUB_OUTPUT.
 *   --mark-scored SYM ...  promote last_checked_price/at to
 *                          last_full_score_price/at for the given symbols.
 *                          Called by the workflow only after a full-score run
 *                          succeeds, so a failed run never falsely marks a
 *                          symbol as freshly scored.
 */

import fs from 'node:fs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[Pulse] Missing SUPABASE_URL or SUPABASE_ANON_KEY in env.');
  process.exit(1);
}

// Local copy of LiveInferenceService.ts's normaliseForYahoo (itself a local
// copy of HistoricalEngine.ts's version, duplicated there because of a
// circular-import constraint). This is a third copy, required here by the
// zero-npm-import constraint. NOTE: any suffix not in this set falls through
// to dot->dash replacement, which is wrong for some real Yahoo tickers (e.g.
// Warsaw's ".WA", used by PKO.WA in the current open-positions set, isn't in
// this list) -- a pre-existing gap inherited from the original, not
// introduced here. Affected symbols will fail the price fetch below and get
// logged + skipped, not silently mis-priced.
const YAHOO_INTL_SUFFIXES = new Set([
  '.L', '.PA', '.AS', '.BR', '.DE', '.F', '.HK', '.SS', '.SZ',
  '.T', '.TO', '.AX', '.NS', '.BO', '.KS', '.TW', '.SW', '.ST',
  '.OL', '.CO', '.HE', '.ME', '.SA', '.BA', '.MX', '.IS', '.NZ',
]);
function normaliseForYahoo(symbol) {
  const upper = symbol.toUpperCase().trim();
  const dotIdx = upper.lastIndexOf('.');
  if (dotIdx === -1) return upper;
  const suffix = upper.slice(dotIdx);
  if (YAHOO_INTL_SUFFIXES.has(suffix)) return upper;
  return upper.replace(/\./g, '-');
}

async function fetchYahooPrice(symbol) {
  const ySym = normaliseForYahoo(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?range=5d&interval=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('no chart result');
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const last = closes.filter((c) => c != null).pop();
  if (last == null) throw new Error('no non-null close in range');
  return last;
}

async function sb(pathAndQuery, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase ${pathAndQuery} -> HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function writeGithubOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  fs.appendFileSync(file, `${name}=${value}\n`);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const markScoredIdx = args.indexOf('--mark-scored');

async function markScored(symbols) {
  if (symbols.length === 0) {
    console.log('[Pulse] --mark-scored called with no symbols, nothing to do.');
    return;
  }
  const inList = symbols.map((s) => `"${s}"`).join(',');
  const rows = await sb(
    `watchlist_live_state?symbol=in.(${inList})&select=symbol,last_checked_price,last_checked_at`
  );
  if (!rows || rows.length === 0) {
    console.warn('[Pulse] --mark-scored: no matching state rows found for', symbols.join(', '));
    return;
  }
  const updates = rows.map((r) => ({
    symbol: r.symbol,
    last_full_score_price: r.last_checked_price,
    last_full_score_at: r.last_checked_at,
  }));
  await sb('watchlist_live_state?on_conflict=symbol', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(updates),
  });
  console.log(`[Pulse] Marked ${updates.length} symbol(s) as freshly scored: ${updates.map((u) => u.symbol).join(', ')}`);
  const missing = symbols.filter((s) => !rows.find((r) => r.symbol === s));
  if (missing.length > 0) {
    console.warn(`[Pulse] --mark-scored: no state row for ${missing.join(', ')} (skipped)`);
  }
}

async function runPulse() {
  console.log(`[Pulse] Mode: ${DRY_RUN ? 'DRY RUN (read-only, no writes/output)' : 'LIVE'}`);

  const [watchlistRows, positionRows, stateRows] = await Promise.all([
    sb('watchlist?select=symbol'),
    sb('pot_positions?select=symbol&status=eq.open'),
    sb('watchlist_live_state?select=*'),
  ]);

  const union = new Set();
  (watchlistRows || []).forEach((r) => union.add(r.symbol.toUpperCase()));
  (positionRows || []).forEach((r) => union.add(r.symbol.toUpperCase()));
  const symbols = [...union].sort();

  const stateMap = new Map();
  (stateRows || []).forEach((r) => stateMap.set(r.symbol.toUpperCase(), r));

  console.log(
    `[Pulse] Watchlist symbols: ${watchlistRows?.length ?? 0}  Open-position rows: ${positionRows?.length ?? 0}  Union to check: ${symbols.length}`
  );

  const now = new Date();
  const checked = [];
  const triggered = [];
  const skipped = [];

  for (const symbol of symbols) {
    let price;
    try {
      price = await fetchYahooPrice(symbol);
    } catch (err) {
      console.warn(`[Pulse] SKIP ${symbol}: price fetch failed (${err.message})`);
      skipped.push({ symbol, reason: err.message });
      await sleep(150);
      continue;
    }

    const state = stateMap.get(symbol);
    let reason = null;

    // Treat "never successfully scored" (row exists but last_full_score_*
    // still null, e.g. a prior inference attempt failed) the same as
    // "no row at all" -- both should keep retriggering rather than getting
    // permanently stuck unscored.
    if (!state || state.last_full_score_price == null || state.last_full_score_at == null) {
      reason = 'bootstrap (no successful full score on record)';
    } else {
      const moveFromLastScore = Math.abs(price - state.last_full_score_price) / state.last_full_score_price;
      if (moveFromLastScore >= 0.015) {
        reason = `move ${(moveFromLastScore * 100).toFixed(2)}% since last full score`;
      } else {
        const hoursSinceScore = (now.getTime() - new Date(state.last_full_score_at).getTime()) / 3.6e6;
        if (hoursSinceScore > 4 && state.last_checked_price != null) {
          const moveFromLastChecked = Math.abs(price - state.last_checked_price) / state.last_checked_price;
          if (moveFromLastChecked > 0.0005) {
            reason = `stale ${hoursSinceScore.toFixed(1)}h + moved ${(moveFromLastChecked * 100).toFixed(3)}% since last check`;
          }
        }
      }
    }

    checked.push({ symbol, price, reason });
    if (reason) triggered.push({ symbol, price, reason });

    await sleep(150);
  }

  console.log('\n[Pulse] ===== Decision log =====');
  console.log('Symbol'.padEnd(14) + 'Price'.padEnd(12) + 'Decision');
  for (const c of checked) {
    console.log(c.symbol.padEnd(14) + String(c.price).padEnd(12) + (c.reason ? `TRIGGER -- ${c.reason}` : 'no trigger'));
  }
  for (const s of skipped) {
    console.log(s.symbol.padEnd(14) + ''.padEnd(12) + `SKIPPED -- ${s.reason}`);
  }

  console.log(`\n[Pulse] Checked: ${checked.length}  Triggered: ${triggered.length}  Skipped: ${skipped.length}`);
  if (triggered.length > 0) {
    console.log(`[Pulse] Triggered symbols: ${triggered.map((t) => t.symbol).join(', ')}`);
  }

  if (DRY_RUN) {
    console.log('\n[Pulse] DRY RUN complete -- no writes performed, no GITHUB_OUTPUT set.');
    return;
  }

  if (checked.length > 0) {
    const upserts = checked.map((c) => ({
      symbol: c.symbol,
      last_checked_price: c.price,
      last_checked_at: now.toISOString(),
    }));
    await sb('watchlist_live_state?on_conflict=symbol', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(upserts),
    });
    console.log(`[Pulse] Updated last_checked_price/at for ${upserts.length} symbol(s).`);
  }

  writeGithubOutput('triggered_symbols', triggered.map((t) => t.symbol).join(' '));
}

async function main() {
  if (markScoredIdx !== -1) {
    const symbols = args.slice(markScoredIdx + 1).map((s) => s.toUpperCase());
    await markScored(symbols);
    return;
  }
  await runPulse();
}

main().catch((err) => {
  console.error('[Pulse] FATAL:', err);
  process.exit(1);
});
