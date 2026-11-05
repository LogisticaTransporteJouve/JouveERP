import {
  MAX_SYNC_MONTHS,
  SYNC_WARN_MONTHS_BACK,
} from "@/lib/afip/received-sync-limits";

export type SyncPeriod = { from: string; to: string };

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The dates «Traer de ARCA» asks for, from two months (YYYY-MM): the first
 *  day of `fromMonth` to the last of `toMonth`, cut at today. A message when
 *  the period is not valid. */
export function syncPeriodFromMonths(
  fromMonth: string,
  toMonth: string,
  today: string,
): SyncPeriod | string {
  const a = MONTH.exec(fromMonth);
  const b = MONTH.exec(toMonth);
  if (!a || !b) return "Elegí el mes desde y el mes hasta.";
  if (fromMonth > toMonth)
    return "El mes desde tiene que ser anterior al mes hasta.";
  if (fromMonth > today.slice(0, 7)) return "El período no puede ser futuro.";
  const months =
    (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2])) + 1;
  if (months > MAX_SYNC_MONTHS) {
    return `Elegí hasta ${MAX_SYNC_MONTHS} meses por vez.`;
  }
  const lastDay = new Date(
    Date.UTC(Number(b[1]), Number(b[2]), 0),
  ).getUTCDate();
  const end = `${toMonth}-${String(lastDay).padStart(2, "0")}`;
  return { from: `${fromMonth}-01`, to: end > today ? today : end };
}

/** Whether a period starts so far back it is probably a wrong year. */
export function isSyncPeriodOld(fromMonth: string, today: string): boolean {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const back = new Date(Date.UTC(y, m - 1 - SYNC_WARN_MONTHS_BACK, 1));
  const limit = `${back.getUTCFullYear()}-${String(back.getUTCMonth() + 1).padStart(2, "0")}`;
  return fromMonth < limit;
}
