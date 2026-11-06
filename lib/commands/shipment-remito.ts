import { PG_UNIQUE_VIOLATION } from "@/lib/db/pg-error-codes";

const REMITO_UNIQUE_INDEX = "shipments_client_remito_unique";

export const REMITO_TAKEN_ERROR =
  "Ese número de remito ya está en otra carga del cliente.";

/** A carga write hit the remito-per-client unique index. */
export function isRemitoTaken(
  error: { code?: string | null; message?: string | null } | null,
): boolean {
  return (
    error?.code === PG_UNIQUE_VIOLATION &&
    (error.message ?? "").includes(REMITO_UNIQUE_INDEX)
  );
}
