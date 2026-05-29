export function percentiles(samples: readonly number[]): {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  max: number;
} {
  if (samples.length === 0) {
    return { p50: 0, p95: 0, p99: 0, avg: 0, max: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number => {
    const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
    return sorted[idx] ?? 0;
  };
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), avg, max: sorted[sorted.length - 1] ?? 0 };
}

export const elapsedMs = (startNs: bigint): number =>
  Number((process.hrtime.bigint() - startNs) / 1_000_000n);
