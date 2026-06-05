export type SwingType = 'PEAK' | 'DIP';

export interface SwingPoint {
  date: string;
  timestamp: number;
  price: number;
  type: SwingType;
}

export function detectMacroSwings(
  points: { date: string; timestamp: number; high: number; low: number; close: number }[],
  deviationThreshold: number = 8.0
): SwingPoint[] {
  if (points.length === 0) return [];
  const swings: SwingPoint[] = [];
  let isUptrend = true;
  let extremePrice = points[0].high;
  let extremePoint = { date: points[0].date, timestamp: points[0].timestamp, price: points[0].high };

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (isUptrend) {
      if (p.high > extremePrice) {
        extremePrice = p.high;
        extremePoint = { date: p.date, timestamp: p.timestamp, price: p.high };
      }
      const retracement = ((extremePrice - p.low) / extremePrice) * 100;
      if (retracement >= deviationThreshold) {
        swings.push({ ...extremePoint, type: 'PEAK' });
        isUptrend = false;
        extremePrice = p.low;
        extremePoint = { date: p.date, timestamp: p.timestamp, price: p.low };
      }
    } else {
      if (p.low < extremePrice) {
        extremePrice = p.low;
        extremePoint = { date: p.date, timestamp: p.timestamp, price: p.low };
      }
      const retracement = ((p.high - extremePrice) / extremePrice) * 100;
      if (retracement >= deviationThreshold) {
        swings.push({ ...extremePoint, type: 'DIP' });
        isUptrend = true;
        extremePrice = p.high;
        extremePoint = { date: p.date, timestamp: p.timestamp, price: p.high };
      }
    }
  }
  swings.push({ ...extremePoint, type: isUptrend ? 'PEAK' : 'DIP' });
  return swings;
}
