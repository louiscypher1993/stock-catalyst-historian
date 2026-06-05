import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { StockScanResult, StockPoint } from './src/types';

// Helper to escape CSV strings
const esc = (val: any): string => {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const getVolatility = (pts: StockPoint[]): number => {
  if (!pts || pts.length === 0) return 0;
  const mean = pts.reduce((sum, p) => sum + p.dailyReturn, 0) / pts.length;
  const variance = pts.reduce((sum, p) => sum + Math.pow(p.dailyReturn - mean, 2), 0) / pts.length;
  return Math.sqrt(variance) * 100;
};

const getNetReturn = (pts: StockPoint[]): number => {
  if (!pts || pts.length === 0) return 0;
  return ((pts[pts.length - 1].close - pts[0].close) / pts[0].close) * 100;
};

const headers = [
  "Ticker", "Company Name", "Exchange", "Currency", "Scan Range Limit",
  "Period Net Return (%)", "Period Daily Volatility (%)", "Total Trading Days Scanned",
  "Total Anomalous Spikes", "Date", "Closing Stock Price", "Daily Return (%)", "Z-Score value",
  "Is Anomaly Event?", "Excess Return (%)", "ATR (14)", "ATR Normalized Move", "ATR Shock Score",
  "Volume Ratio", "Volume Shock Category", "Primary Catalyst Tag", "Reason (Suspected Catalyst)",
  "Key Outlook Risk Factor", "Severity Score (0-10)", "Confidence Score (0-10)", "News Grounded Findings",
  "Alternative Data Observations", "Alternative Data Score", "Corporate Governance Observations",
  "Corporate Governance Score", "Macroeconomic Observations", "Macroeconomic Score",
  "Market Structure Observations", "Market Structure Score", "Fundamental & Earnings Observations",
  "Fundamental & Earnings Score", "Causal Attribution Review", "Link Confidence Score",
  "Primary Catalyst Category", "Primary Catalyst Sub-Type", "Statistical Confidence (%)",
  "Causal Confidence (%)", "AI Internal Confidence (%)", "Historical Dataset Confidence (%)",
  "Metadata Completeness Confidence (%)", "Is Rule-Based Fallback?", "VIX at Event",
  "VIX Volatility Regime", "Days Since Prior Anomaly", "Anomaly Density (Lookback)",
  "Days from Earnings Announcement", "Shannon Entropy (30d)", "Amihud Illiquidity (30d)",
  "Barycenter Stretch (20d)", "Kinetic Energy", "L1 Lagrange Point", "Orbital Escape Velocity",
  "Escape Velocity Cleared", "Market Reynolds Number", "Fractal Efficiency Ratio (10d)",
  "Market Jerk", "Seismic Magnitude (Mw)", "Triggered Z-Score Threshold", "Sector Relative Z-Score",
  "max_favorable_excursion_1m", "max_adverse_excursion_1m", "market_cap_log10",
  "dollar_volume_30d", "sector_encoded", "event_type_encoded", "day_sin", "day_cos",
  "month_sin", "month_cos", "body_to_range_ratio", "volume_price_clustering",
  "overnight_gap_pct", "gap_fill_ratio", "relative_volume_30d", "dist_sma_50",
  "dist_sma_200", "rsi_14", "volatility_contraction_index", "days_since_macro_swing",
  "swing_type_encoded", "obv_delta_10d", "idiosyncratic_return", "peer_contagion_delta",
  "peer_average_return", "treasury_10y_yield", "congressional_net_flow_30d",
  "economic_policy_uncertainty", "management_confidence_score", "dark_pool_index",
  "ctb_velocity_7d", "short_interest_pct", "put_call_ratio_t_minus_1", "iv_crush_pct",
  "1-Day Price Return (%)", "1-Day AI Effect Score", "1-Week Price Return (%)",
  "1-Week AI Effect Score", "1-Month Price Return (%)", "1-Month AI Effect Score",
  "6-Month Price Return (%)", "6-Month AI Effect Score", "1-Year Price Return (%)",
  "1-Year AI Effect Score"
];

export async function exportAndUploadToDrive(
  savedScans: Record<string, StockScanResult>,
  marketsList: any[],
  driveToken: string,
  filename: string
): Promise<{ id: string; alternateLink: string }> {
  const tempPath = path.join(process.cwd(), `temp_${crypto.randomBytes(8).toString("hex")}.csv`);

  try {
    const stat = fs.statSync(tempPath);

    // Resumable upload init
    const metadata = {
      name: filename,
      mimeType: "text/csv",
      description: "Exported multi-asset historical stock anomalies and news-grounded event analyses, synthesized via Stock Catalyst Historian.",
    };

    const resInit = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${driveToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "text/csv",
        "X-Upload-Content-Length": stat.size.toString()
      },
      body: JSON.stringify(metadata)
    });

    if (!resInit.ok) {
      throw new Error(`Failed to initiate upload: ${await resInit.text()}`);
    }

    const uploadUri = resInit.headers.get("location");
    if (!uploadUri) {
      throw new Error("No upload URI returned from Google API.");
    }

    // Read stream to Drive
    const readStream = fs.createReadStream(tempPath);

    const resUpload = await fetch(uploadUri, {
      method: "PUT",
      headers: {
        "Content-Length": stat.size.toString()
      },
      body: readStream as any,
      duplex: 'half'
    } as any);

    if (!resUpload.ok) {
      throw new Error(`Upload failed: ${await resUpload.text()}`);
    }

    const result: any = await resUpload.json();

    return {
      id: result.id,
      alternateLink: result.webViewLink || `https://drive.google.com/open?id=${result.id}`,
    };

  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

export async function exportToLocalStream(
  savedScans: Record<string, StockScanResult>,
  marketsList: any[],
  writeStream: any
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    writeStream.on("error", reject);
    writeStream.on("finish", resolve);

    writeStream.write(headers.join(",") + "\n");

    const findMarketForSymbol = (sym: string): string => {
      const market = marketsList.find((m: any) =>
        m.stocks?.some((s: any) => s.symbol.toUpperCase() === sym.toUpperCase()),
      );
      return market ? market.name : "Other Exchanges";
    };

    for (const res of Object.values(savedScans)) {
      const ticker = res.symbol;
      const company = res.companyName || "Asset Tracking Ingest";
      const exchange = findMarketForSymbol(ticker);
      const currency = res.currency || "USD";
      const range = res.meta?.range || "None Specified";

      const points = res.points || [];
      const totalDays = points.length;
      const anomaliesCount = res.anomalies?.length || 0;
      const periodReturn = getNetReturn(points);
      const periodVolatility = getVolatility(points);

      const sortedPoints = [...points].sort((a, b) => a.date.localeCompare(b.date));

      for (const pt of sortedPoints) {
        const isAnomaly = pt.isAnomaly || false;
        const analysis: any = pt.analysis || {};

        const row = [
          esc(ticker), esc(company), esc(exchange), esc(currency), esc(range),
          esc(periodReturn.toFixed(2)), esc(periodVolatility.toFixed(2)), esc(totalDays),
          esc(anomaliesCount), esc(pt.date), esc(pt.close.toFixed(2)),
          esc((pt.dailyReturn * 100).toFixed(2)), esc(pt.zScore.toFixed(3)),
          esc(isAnomaly ? "YES" : "NO"),
          esc(pt.excessReturn !== undefined ? (pt.excessReturn * 100).toFixed(2) : ""),
          esc(pt.atr14 !== undefined ? pt.atr14.toFixed(4) : ""),
          esc(pt.atrNormalizedMove !== undefined ? pt.atrNormalizedMove.toFixed(4) : ""),
          esc(pt.atrShockScore !== undefined ? (pt.atrShockScore * 100).toFixed(2) : ""),
          esc(pt.volumeRatio !== undefined ? pt.volumeRatio.toFixed(2) : pt.relativeVolume !== undefined ? pt.relativeVolume.toFixed(2) : ""),
          esc(pt.volumeShockType || ""),
          esc(analysis.primary_catalyst_tag || ""), esc(analysis.suspected_catalyst || ""),
          esc(analysis.key_risk || ""), esc(analysis.severity_score !== undefined ? analysis.severity_score : ""),
          esc(analysis.confidence_score !== undefined ? analysis.confidence_score : ""),
          esc(analysis.internet_findings || ""), esc(analysis.alternative_data_observations || ""),
          esc(analysis.alternative_data_score !== undefined ? analysis.alternative_data_score : ""),
          esc(analysis.corporate_governance_observations || ""),
          esc(analysis.corporate_governance_score !== undefined ? analysis.corporate_governance_score : ""),
          esc(analysis.macroeconomic_observations || ""),
          esc(analysis.macroeconomic_score !== undefined ? analysis.macroeconomic_score : ""),
          esc(analysis.market_structure_observations || ""),
          esc(analysis.market_structure_score !== undefined ? analysis.market_structure_score : ""),
          esc(analysis.fundamental_and_earnings_observations || ""),
          esc(analysis.fundamental_and_earnings_score !== undefined ? analysis.fundamental_and_earnings_score : ""),
          esc(analysis.coincidence_vs_correlation || ""), esc(analysis.correlation_confidence !== undefined ? analysis.correlation_confidence : ""),
          esc(analysis.primaryCategory || ""), esc(analysis.primarySubType || ""),
          esc(analysis.statisticalConfidence !== undefined ? analysis.statisticalConfidence : ""),
          esc(analysis.causalConfidence !== undefined ? analysis.causalConfidence : ""),
          esc(analysis.aiConfidence !== undefined ? analysis.aiConfidence : ""),
          esc(analysis.historicalConfidence !== undefined ? analysis.historicalConfidence : ""),
          esc(analysis.dataConfidence !== undefined ? analysis.dataConfidence : ""),
          esc(analysis.isFallback ? "YES" : "NO"),
          esc(analysis.vixAtEvent !== undefined ? (analysis.vixAtEvent * 100).toFixed(2) : ""),
          esc(analysis.vixRegime || ""), esc(analysis.daysSincePreviousEvent !== undefined ? analysis.daysSincePreviousEvent : ""),
          esc(analysis.eventDensity !== undefined ? analysis.eventDensity : ""),
          esc(analysis.daysFromEarnings !== undefined ? analysis.daysFromEarnings : ""),
          esc(analysis.shannon_entropy_30d !== undefined ? analysis.shannon_entropy_30d.toFixed(4) : ""),
          esc(analysis.amihud_illiquidity_30d !== undefined ? analysis.amihud_illiquidity_30d.toFixed(4) : ""),
          esc(analysis.barycenter_stretch_20d !== undefined ? analysis.barycenter_stretch_20d.toFixed(4) : ""),
          esc(analysis.kinetic_energy !== undefined ? analysis.kinetic_energy.toFixed(4) : ""),
          esc(analysis.l1_lagrange_point !== undefined ? analysis.l1_lagrange_point.toFixed(4) : ""),
          esc(analysis.orbital_escape_velocity !== undefined ? analysis.orbital_escape_velocity.toFixed(4) : ""),
          esc(analysis.escape_velocity_cleared !== undefined ? analysis.escape_velocity_cleared : ""),
          esc(analysis.market_reynolds_number !== undefined ? analysis.market_reynolds_number.toFixed(4) : ""),
          esc(analysis.fractal_efficiency_ratio_10d !== undefined ? analysis.fractal_efficiency_ratio_10d.toFixed(4) : ""),
          esc(analysis.market_jerk !== undefined ? analysis.market_jerk.toFixed(4) : pt.market_jerk !== undefined ? pt.market_jerk.toFixed(4) : ""),
          esc(analysis.seismic_magnitude_mw !== undefined ? analysis.seismic_magnitude_mw.toFixed(4) : pt.seismic_magnitude_mw !== undefined ? pt.seismic_magnitude_mw.toFixed(4) : ""),
          esc(analysis.triggered_z_score_threshold !== undefined ? analysis.triggered_z_score_threshold.toFixed(4) : pt.triggered_z_score_threshold !== undefined ? pt.triggered_z_score_threshold.toFixed(4) : ""),
          esc(analysis.sector_relative_z_score !== undefined ? analysis.sector_relative_z_score.toFixed(4) : pt.sector_relative_z_score !== undefined ? pt.sector_relative_z_score.toFixed(4) : ""),
          esc(analysis.max_favorable_excursion_1m !== undefined ? (analysis.max_favorable_excursion_1m * 100).toFixed(4) : pt.max_favorable_excursion_1m !== undefined ? (pt.max_favorable_excursion_1m * 100).toFixed(4) : ""),
          esc(analysis.max_adverse_excursion_1m !== undefined ? (analysis.max_adverse_excursion_1m * 100).toFixed(4) : ""),
          esc(analysis.market_cap_log10 !== undefined ? analysis.market_cap_log10.toFixed(4) : ""),
          esc(analysis.dollar_volume_30d !== undefined ? analysis.dollar_volume_30d.toFixed(4) : ""),
          esc(analysis.sector_encoded !== undefined ? analysis.sector_encoded : ""),
          esc(analysis.event_type_encoded !== undefined ? analysis.event_type_encoded : ""),
          esc(analysis.day_sin !== undefined ? analysis.day_sin.toFixed(4) : ""),
          esc(analysis.day_cos !== undefined ? analysis.day_cos.toFixed(4) : ""),
          esc(analysis.month_sin !== undefined ? analysis.month_sin.toFixed(4) : ""),
          esc(analysis.month_cos !== undefined ? analysis.month_cos.toFixed(4) : ""),
          esc(analysis.body_to_range_ratio !== undefined ? analysis.body_to_range_ratio.toFixed(4) : ""),
          esc(analysis.volume_price_clustering !== undefined ? analysis.volume_price_clustering.toFixed(4) : ""),
          esc(analysis.overnight_gap_pct !== undefined ? (analysis.overnight_gap_pct * 100).toFixed(4) : ""),
          esc(analysis.gap_fill_ratio !== undefined ? analysis.gap_fill_ratio.toFixed(4) : ""),
          esc(analysis.relative_volume_30d !== undefined ? analysis.relative_volume_30d.toFixed(4) : ""),
          esc(analysis.dist_sma_50 !== undefined ? analysis.dist_sma_50.toFixed(4) : ""),
          esc(analysis.dist_sma_200 !== undefined ? analysis.dist_sma_200.toFixed(4) : ""),
          esc(analysis.rsi_14 !== undefined ? analysis.rsi_14.toFixed(4) : ""),
          esc(analysis.volatility_contraction_index !== undefined ? (analysis.volatility_contraction_index * 100).toFixed(4) : ""),
          esc(analysis.days_since_macro_swing !== undefined ? analysis.days_since_macro_swing : ""),
          esc(analysis.swing_type_encoded !== undefined ? analysis.swing_type_encoded : ""),
          esc(analysis.obv_delta_10d !== undefined ? analysis.obv_delta_10d.toFixed(4) : ""),
          esc(analysis.idiosyncratic_return !== undefined ? analysis.idiosyncratic_return.toFixed(4) : pt.excessReturn !== undefined ? (pt.excessReturn * 100).toFixed(4) : ""),
          esc(analysis.peer_contagion_delta !== undefined ? (analysis.peer_contagion_delta * 100).toFixed(4) : ""),
          esc(analysis.peer_average_return !== undefined ? (analysis.peer_average_return * 100).toFixed(4) : ""),
          esc(analysis.treasury_10y_yield !== undefined ? analysis.treasury_10y_yield.toFixed(4) : ""),
          esc(analysis.congressional_net_flow_30d !== undefined ? analysis.congressional_net_flow_30d.toFixed(4) : ""),
          esc(analysis.economic_policy_uncertainty !== undefined ? analysis.economic_policy_uncertainty.toFixed(4) : ""),
          esc(analysis.management_confidence_score !== undefined ? analysis.management_confidence_score.toFixed(4) : ""),
          esc(analysis.dark_pool_index !== undefined ? analysis.dark_pool_index.toFixed(4) : ""),
          esc(analysis.ctb_velocity_7d !== undefined ? analysis.ctb_velocity_7d.toFixed(4) : ""),
          esc(analysis.short_interest_pct !== undefined ? analysis.short_interest_pct.toFixed(4) : analysis.short_interest_ratio !== undefined ? analysis.short_interest_ratio.toFixed(4) : ""),
          esc(analysis.put_call_ratio_t_minus_1 !== undefined ? analysis.put_call_ratio_t_minus_1.toFixed(4) : ""),
          esc(analysis.iv_crush_pct !== undefined ? (analysis.iv_crush_pct * 100).toFixed(4) : ""),
          esc(analysis.return_1d !== undefined ? (analysis.return_1d * 100).toFixed(2) : ""),
          esc(analysis.effect_score_1d !== undefined ? analysis.effect_score_1d : ""),
          esc(analysis.return_1w !== undefined ? (analysis.return_1w * 100).toFixed(2) : ""),
          esc(analysis.effect_score_1w !== undefined ? analysis.effect_score_1w : ""),
          esc(analysis.return_1m !== undefined ? (analysis.return_1m * 100).toFixed(2) : ""),
          esc(analysis.effect_score_1m !== undefined ? analysis.effect_score_1m : ""),
          esc(analysis.return_6m !== undefined ? (analysis.return_6m * 100).toFixed(2) : ""),
          esc(analysis.effect_score_6m !== undefined ? analysis.effect_score_6m : ""),
          esc(analysis.return_1y !== undefined ? (analysis.return_1y * 100).toFixed(2) : ""),
          esc(analysis.effect_score_1y !== undefined ? analysis.effect_score_1y : "")
        ];

        writeStream.write(row.join(",") + "\n");
      }
    }
    writeStream.end();
  });
}
