// Quincenas CAEA (RG 2926 / RG 5782): orden 1 = día 1–15, orden 2 = 16–fin de
// mes. Un CAEA por (periodo YYYYMM, orden) cubre todos los PV del CUIT. La
// ventana para solicitarlo abre 5 días corridos antes del inicio de la
// quincena y cierra su último día (validación AFIP 15006).

export type Quincena = { periodo: number; orden: 1 | 2 };

export function quincenaOf(dateIso: string): Quincena {
  const [y, m, d] = dateIso.split("-").map(Number);
  return { periodo: y! * 100 + m!, orden: d! <= 15 ? 1 : 2 };
}

export function quincenaStart(q: Quincena): string {
  const year = Math.floor(q.periodo / 100);
  const month = q.periodo % 100;
  const day = q.orden === 1 ? 1 : 16;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function quincenaEnd(q: Quincena): string {
  const year = Math.floor(q.periodo / 100);
  const month = q.periodo % 100;
  if (q.orden === 1) {
    return `${year}-${String(month).padStart(2, "0")}-15`;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
}

export function nextQuincena(q: Quincena): Quincena {
  if (q.orden === 1) return { periodo: q.periodo, orden: 2 };
  const year = Math.floor(q.periodo / 100);
  const month = q.periodo % 100;
  return {
    periodo: month === 12 ? (year + 1) * 100 + 1 : q.periodo + 1,
    orden: 1,
  };
}

/** yyyymmdd (AFIP) → YYYY-MM-DD. */
export function afipDateToIso(afip: string): string {
  return `${afip.slice(0, 4)}-${afip.slice(4, 6)}-${afip.slice(6, 8)}`;
}

/** Timestamp ISO → yyyymmddhhmiss en hora argentina (CbteFchHsGen). */
export function toAfipDateTimeAR(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  // en-CA hour "24" can appear at midnight in some runtimes — normalize.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}${get("month")}${get("day")}${hour}${get("minute")}${get("second")}`;
}
