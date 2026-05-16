// Compact human-readable byte sizes. KB/MB/GB, two-decimal precision when
// useful. Returns "—" for null/undefined sizes so attachment rows don't
// render "NaN B" when metadata is missing.

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes === 0) return "0 B";

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value < 10 && unitIndex > 0 ? 2 : value < 100 && unitIndex > 0 ? 1 : 0;
  return `${value.toFixed(precision)} ${UNITS[unitIndex]}`;
}
