import { EventFeatureVector, SimilarEvent, AnalogueOutcomeSummary } from "./src/types";
import { getAllEventFeatures } from "./db";

export function findSimilarEvents(
  currentEvent: EventFeatureVector,
  topN: number = 10
): SimilarEvent[] {
  const allEvents = getAllEventFeatures();

  // Filter out the current event itself
  const candidates = allEvents.filter(
    (e) => !(e.symbol === currentEvent.symbol && e.date === currentEvent.date)
  );

  if (candidates.length === 0) return [];

  // Find min/max for normalization
  let minZScore = currentEvent.zScore;
  let maxZScore = currentEvent.zScore;
  let minVolumeRatio = currentEvent.volumeRatio;
  let maxVolumeRatio = currentEvent.volumeRatio;
  let minAtrShock = currentEvent.atrShockScore;
  let maxAtrShock = currentEvent.atrShockScore;
  let minExcessReturn = currentEvent.excessReturn;
  let maxExcessReturn = currentEvent.excessReturn;

  for (const c of candidates) {
    if (c.zScore < minZScore) minZScore = c.zScore;
    if (c.zScore > maxZScore) maxZScore = c.zScore;
    if (c.volumeRatio < minVolumeRatio) minVolumeRatio = c.volumeRatio;
    if (c.volumeRatio > maxVolumeRatio) maxVolumeRatio = c.volumeRatio;
    if (c.atrShockScore < minAtrShock) minAtrShock = c.atrShockScore;
    if (c.atrShockScore > maxAtrShock) maxAtrShock = c.atrShockScore;
    if (c.excessReturn < minExcessReturn) minExcessReturn = c.excessReturn;
    if (c.excessReturn > maxExcessReturn) maxExcessReturn = c.excessReturn;
  }

  const rangeZScore = maxZScore - minZScore || 1;
  const rangeVolumeRatio = maxVolumeRatio - minVolumeRatio || 1;
  const rangeAtrShock = maxAtrShock - minAtrShock || 1;
  const rangeExcessReturn = maxExcessReturn - minExcessReturn || 1;

  const weights = {
    zScore: 0.25,
    vixRegime: 0.15,
    trendRegime: 0.15,
    primaryCategory: 0.20,
    volumeRatio: 0.10,
    atrShockScore: 0.10,
    excessReturn: 0.05,
  };

  const results: SimilarEvent[] = [];

  for (const candidate of candidates) {
    // Distances (0 to 1)
    const zScoreDist = Math.abs(candidate.zScore - currentEvent.zScore) / rangeZScore;
    const volRatioDist = Math.abs(candidate.volumeRatio - currentEvent.volumeRatio) / rangeVolumeRatio;
    const atrShockDist = Math.abs(candidate.atrShockScore - currentEvent.atrShockScore) / rangeAtrShock;
    const exRetDist = Math.abs(candidate.excessReturn - currentEvent.excessReturn) / rangeExcessReturn;

    const vixRegimeDist = candidate.vixRegime === currentEvent.vixRegime ? 0 : 1;
    const trendRegimeDist = candidate.trendRegime === currentEvent.trendRegime ? 0 : 1;
    const catDist = candidate.primaryCategory === currentEvent.primaryCategory ? 0 : 1;

    const totalDistance =
      zScoreDist * weights.zScore +
      vixRegimeDist * weights.vixRegime +
      trendRegimeDist * weights.trendRegime +
      catDist * weights.primaryCategory +
      volRatioDist * weights.volumeRatio +
      atrShockDist * weights.atrShockScore +
      exRetDist * weights.excessReturn;

    const similarityScore = 1 - totalDistance;

    results.push({
      symbol: candidate.symbol,
      date: candidate.date,
      similarityScore,
      features: candidate,
      outcome: {
        return_1d: candidate.return_1d,
        return_1w: candidate.return_1w,
        return_1m: candidate.return_1m,
        return_6m: candidate.return_6m,
        return_1y: candidate.return_1y,
      },
    });
  }

  return results.sort((a, b) => b.similarityScore - a.similarityScore).slice(0, topN);
}

export function computeAnalogueOutcomes(similarEvents: SimilarEvent[]): AnalogueOutcomeSummary {
  const validEvents = similarEvents.filter((e) => e.outcome.return_1m !== null && e.outcome.return_6m !== null);
  const sampleSize = validEvents.length;

  if (sampleSize === 0) {
    return {
      sampleSize: 0,
      averageReturn1w: null,
      averageReturn1m: null,
      averageReturn6m: null,
      winRate1m: 0,
      winRate6m: 0,
      maxDrawdown1m: null,
      probabilisticOutlook: {
        strongRally: 0,
        mildRally: 0,
        sideways: 0,
        mildDecline: 0,
        strongDecline: 0,
      },
      confidenceNote: "No valid historical analogues found with complete forward returns to compute statistics.",
    };
  }

  let sum1w = 0, count1w = 0;
  let sum1m = 0;
  let sum6m = 0;
  let wins1m = 0;
  let wins6m = 0;
  let min1mRet: number | null = null;

  let strongRallyCount = 0;
  let mildRallyCount = 0;
  let sidewaysCount = 0;
  let mildDeclineCount = 0;
  let strongDeclineCount = 0;

  for (const e of validEvents) {
    if (e.outcome.return_1w !== null) {
      sum1w += e.outcome.return_1w;
      count1w++;
    }

    const r1m = e.outcome.return_1m as number;
    const r6m = e.outcome.return_6m as number;

    sum1m += r1m;
    sum6m += r6m;

    if (r1m > 0) wins1m++;
    if (r6m > 0) wins6m++;

    if (min1mRet === null || r1m < min1mRet) {
      min1mRet = r1m;
    }

    // F6 fix: r1m (EventFeatureVector.return_1m, from HistoricalEngine.ts's
    // div100(p.analysis.return_1m)) is fractional (e.g. 0.02 = 2%), not
    // percent -- these thresholds were previously percent-scale (10/2/-2/-10),
    // ~100x too large, so ~98% of real events fell into the `else if (r1m >= -2)`
    // branch regardless of actual outcome. Corrected to fractional scale and
    // verified against a real 5,000-row sample of event_features' return_1m
    // (median 0.0208, matching this bug's own reported median): produces a
    // sensible, well-spread 5-way split (~28/22/16/19/15%), not just "not 98%
    // sideways" -- the sideways band is centered close to the real median, as
    // intended. winRate1m/winRate6m/averageReturn* are unaffected by this fix
    // (units-independent, computed directly from the same r1m/r6m values).
    if (r1m > 0.10) {
      strongRallyCount++;
    } else if (r1m > 0.02) {
      mildRallyCount++;
    } else if (r1m >= -0.02) {
      sidewaysCount++;
    } else if (r1m >= -0.10) {
      mildDeclineCount++;
    } else {
      strongDeclineCount++;
    }
  }

  const confidenceNote = sampleSize < 5
    ? `Based on ${sampleSize} similar historical event${sampleSize === 1 ? "" : "s"} — low sample size, statistics may be unreliable.`
    : `Based on ${sampleSize} similar historical events.`;

  return {
    sampleSize,
    averageReturn1w: count1w > 0 ? sum1w / count1w : null,
    averageReturn1m: sum1m / sampleSize,
    averageReturn6m: sum6m / sampleSize,
    winRate1m: (wins1m / sampleSize) * 100,
    winRate6m: (wins6m / sampleSize) * 100,
    maxDrawdown1m: min1mRet !== null && min1mRet < 0 ? min1mRet : 0,
    probabilisticOutlook: {
      strongRally: strongRallyCount / sampleSize,
      mildRally: mildRallyCount / sampleSize,
      sideways: sidewaysCount / sampleSize,
      mildDecline: mildDeclineCount / sampleSize,
      strongDecline: strongDeclineCount / sampleSize,
    },
    confidenceNote,
  };
}
