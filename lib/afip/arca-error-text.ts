// What a robot, sign-in or sync error code means, in the words the tray and
// Admin → AFIP show (codes from mis-comprobantes/robot.ts and
// received-sync.ts).
const ARCA_ERROR_TEXT: Record<string, string> = {
  SIGN_IN_REJECTED: "ARCA rechazó el CUIT o la clave",
  SIGN_IN_FAILED: "ARCA no completó el ingreso",
  SERVICE_NOT_AUTHORIZED: "el usuario no tiene Mis Comprobantes habilitado",
  REPRESENTED_NOT_FOUND: "el usuario no representa a la empresa",
  NETWORK: "no se pudo conectar con ARCA",
  QUERY_FAILED: "ARCA no respondió la consulta",
  TOO_MANY: "demasiados comprobantes en el mes",
  INGEST_FAILED: "no se pudo guardar en la bandeja",
  TIME_BUDGET: "no alcanzó el tiempo, pedilo de nuevo",
  RECORD_FAILED: "no se pudo registrar el resultado del ingreso",
};

/** The code in words, or the code itself when it is not known. */
export function arcaErrorText(code: string): string {
  return ARCA_ERROR_TEXT[code] ?? `error ${code}`;
}
