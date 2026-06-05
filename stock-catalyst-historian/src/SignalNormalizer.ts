/**
 * Utility for true rolling-window Z-scores.
 *
 * WHY THIS IS REQUIRED:
 * A true rolling z-score compares the current value against its own historical mean and standard deviation.
 * Static multipliers or divisors (e.g., dividing virality by 25) are statistically invalid because they
 * do not account for the baseline volatility of the specific signal or asset. They are just arbitrary scalars
 * that create a false sense of normalization. A real z-score tells us how many standard deviations an event
 * is from the norm, allowing for valid cross-signal and cross-asset threshold comparisons.
 */
export class SignalNormalizer {
  /**
   * Calculates the Z-score for a current value based on a historical series.
   * Returns null (NOT 0.0) if there are fewer than 10 elements in the history or if the standard deviation is
   * close to zero (<= 1e-6). This distinguishes "no usable baseline" from "a genuine zero z-score".
   *
   * @param history Array of historical values
   * @param currentValue Current value
   * @returns The calculated Z-score or null if baseline is unusable
   */
  static calculateZScore(history: number[], currentValue: number): number | null {
    if (!history || history.length < 10) {
      return null;
    }

    const n = history.length;
    let sum = 0;
    for (let i = 0; i < n; i++) {
        sum += history[i];
    }
    const mean = sum / n;

    let varianceSum = 0;
    for (let i = 0; i < n; i++) {
        const diff = history[i] - mean;
        varianceSum += diff * diff;
    }
    
    // Using sample standard deviation
    const variance = varianceSum / (n - 1);
    const stdDev = Math.sqrt(variance);

    if (stdDev <= 1e-6) {
        return null;
    }

    return (currentValue - mean) / stdDev;
  }
}
