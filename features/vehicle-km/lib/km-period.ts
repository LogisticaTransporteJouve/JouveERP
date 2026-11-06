import { todayInAR } from "@/lib/format";
import type { ResolvedPeriod } from "@/lib/list-period";

/** Strix keeps no km before this. */
const ALL_DATES_FROM = "2020-01-01";

/** The km range for a period filter: «Todas las fechas» is everything up to
 *  today. */
export function kmPeriod(resolved: ResolvedPeriod | null): ResolvedPeriod {
  return resolved ?? { from: ALL_DATES_FROM, to: todayInAR() };
}
