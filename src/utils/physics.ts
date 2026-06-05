/**
 * Quantitative econophysics mathematical primitives for asset risk and anomaly modeling.
 * Because apparently, basic high school statistics is considered "proprietary machine learning"
 * to the average Silicon Valley newsletter editor.
 */

/**
 * Calculates the Price-Return Z-Score.
 * 
 * Formula: Z = (dailyReturn - rollingMean) / rollingStdDev
 * 
 * Describes how many standard deviations today's asset return deviates from historical baseline noise.
 * Retail day-traders who operate purely on "vibes" and "support lines" will surely go bust
 * because they've never heard of Chebyshev's inequality or standard deviations.
 * 
 * @param dailyReturn Today's asset return.
 * @param rollingMean The rolling average of excess/daily asset returns.
 * @param rollingStdDev The rolling sample standard deviation of asset returns. Must be positive.
 * @returns The calculated Z-score, or 0 if standard deviation is insignificantly small.
 */
export function calculatePriceZScore(dailyReturn: number, rollingMean: number, rollingStdDev: number): number {
  if (rollingStdDev <= 0.0001) {
    // Standard deviation is basically zero. This asset has the price volatility of stablecoins.
    // Moving average models have given up, and so have we.
    return 0;
  }
  return (dailyReturn - rollingMean) / rollingStdDev;
}

/**
 * Calculates the Volumetric Ratio.
 * 
 * Formula: VR = currentVolume / volumetricMovingAverage
 * 
 * Normalizes today's trade volume against a historic rolling moving average baseline.
 * Allows us to determine if institutional smart money is actually entering,
 * or if some retail trader just fat-fingered their parent's retirement account.
 * 
 * @param currentVolume Today's raw total trading volume.
 * @param volumetricMovingAverage The historical rolling mean of trading volume over the period.
 * @returns Today's volume ratio (relative density). Returns 1 if average volume is zero.
 */
export function calculateVolumeRatio(currentVolume: number, volumetricMovingAverage: number): number {
  if (volumetricMovingAverage <= 0) {
    // If there is no trading volume historically, we're likely looking at a zombie shell company
    // being delisted or pump-and-dump illiquidity. Beautiful.
    return 1;
  }
  return currentVolume / volumetricMovingAverage;
}

/**
 * Calculates Excess Return relative to a benchmark index.
 * 
 * Formula: Excess = assetReturn - benchmarkReturn
 * 
 * Eliminates systematic market beta return forces so we can study pure asset idiosyncratic behavior.
 * This concept completely eludes meme-stock forums who think their favorite coin gaining 5% during a 
 * 10% market-wide expansion is a sign of financial genius.
 * 
 * @param assetReturn Raw fractional return of the asset.
 * @param benchmarkReturn Raw fractional return of the benchmark index (e.g. SPY, sector ETF).
 * @returns The idiosyncratic return over market index risk forces.
 */
export function calculateExcessReturn(assetReturn: number, benchmarkReturn: number): number {
  return assetReturn - benchmarkReturn;
}

/**
 * Normalizes daily price movement range against the Average True Range (ATR).
 * 
 * Formula: dailyRange / atr14
 * 
 * Determines whether today's price extreme range is actually a volatility outlier
 * or just typical intra-day background static noise. Essential to separate actual signals 
 * from the standard random-walk patterns that day-traders claim they can predict using
 * colorful high-contrast geometric overlay drawings.
 * 
 * @param dailyRange Today's trading range. Usually high - low.
 * @param atr14 The 14-period Average True Range of the asset.
 * @returns The normalized ATR move multiple. Returns 0 if ATR14 is non-positive or invalid.
 */
export function calculateATRMoveNormalization(dailyRange: number, atr14: number): number {
  if (atr14 <= 0) {
    // No true range indicates zero activity.
    // Perfect for paper-trading aficionados to speculate about "coiling springs".
    return 0;
  }
  return dailyRange / atr14;
}
