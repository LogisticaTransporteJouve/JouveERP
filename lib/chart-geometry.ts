/** A 1-2-5 step near `rough`, for axis ticks. */
export function niceStep(rough: number): number {
  const pow = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / pow;
  if (unit <= 1) return pow;
  if (unit <= 2) return 2 * pow;
  if (unit <= 5) return 5 * pow;
  return 10 * pow;
}

/** Tick values every `niceStep` covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const step = niceStep((max - min) / count || 1);
  const ticks: number[] = [];
  for (
    let t = Math.ceil(min / step) * step;
    t <= max + step * 1e-9;
    t += step
  ) {
    ticks.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  }
  return ticks;
}

export type BarEnd = "top" | "bottom" | "left" | "right";

/**
 * A bar anchored at its baseline and rounded only at its data end (`end`):
 * the top of a positive column, the bottom of a negative one, the right of
 * a positive horizontal bar.
 */
export function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  end: BarEnd,
  radius = 4,
): string {
  if (w <= 0 || h <= 0) return "";
  const r = Math.min(
    radius,
    end === "top" || end === "bottom" ? w / 2 : h / 2,
    end === "top" || end === "bottom" ? h : w,
  );
  const x2 = x + w;
  const y2 = y + h;
  switch (end) {
    case "top":
      return `M ${x} ${y2} V ${y + r} Q ${x} ${y} ${x + r} ${y} H ${x2 - r} Q ${x2} ${y} ${x2} ${y + r} V ${y2} Z`;
    case "bottom":
      return `M ${x} ${y} V ${y2 - r} Q ${x} ${y2} ${x + r} ${y2} H ${x2 - r} Q ${x2} ${y2} ${x2} ${y2 - r} V ${y} Z`;
    case "right":
      return `M ${x} ${y} H ${x2 - r} Q ${x2} ${y} ${x2} ${y + r} V ${y2 - r} Q ${x2} ${y2} ${x2 - r} ${y2} H ${x} Z`;
    case "left":
      return `M ${x2} ${y} H ${x + r} Q ${x} ${y} ${x} ${y + r} V ${y2 - r} Q ${x} ${y2} ${x + r} ${y2} H ${x2} Z`;
  }
}
