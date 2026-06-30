// Pure descriptive statistics for anomaly detection (no DB, no LLM).

/** Linear-interpolation quartiles over an ascending-sorted array (length >= 1). */
export function quartiles(sortedAsc: number[]): { q1: number; q3: number } {
  const at = (p: number): number => {
    const idx = (sortedAsc.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const a = sortedAsc[lo] ?? 0;
    const b = sortedAsc[hi] ?? a;
    return lo === hi ? a : a + (b - a) * (idx - lo);
  };
  return { q1: at(0.25), q3: at(0.75) };
}

/**
 * Tukey IQR fences. Returns null when there's too little history to judge an
 * outlier (< minSamples). Bounds are [Q1 − 1.5·IQR, Q3 + 1.5·IQR].
 */
export function outlierBounds(
  values: number[],
  minSamples = 5,
): { lower: number; upper: number; q1: number; q3: number } | null {
  if (values.length < minSamples) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const { q1, q3 } = quartiles(sorted);
  const iqr = q3 - q1;
  return { lower: q1 - 1.5 * iqr, upper: q3 + 1.5 * iqr, q1, q3 };
}
