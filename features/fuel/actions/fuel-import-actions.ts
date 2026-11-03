"use server";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { fetchInChunks, paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";
import {
  MAX_UPLOAD_TABLE_BYTES,
  readUploadedTable,
} from "@/lib/tables/read-upload";

import {
  FUEL_IMPORT_LIMITS,
  FUEL_IMPORT_PROVIDER_LABELS,
  buildImportRows,
  findHeaderRow,
  fuelLoadKey,
  missingFields,
  suggestMapping,
  type FuelImportField,
  type FuelImportMapping,
  type FuelImportRow,
} from "../lib/import";
import { FuelImportConfirmSchema, FuelImportPreviewSchema } from "../schema";

export type FuelImportPreview = {
  headers: string[];
  mapping: FuelImportMapping;
  missing: FuelImportField[];
  rows: FuelImportRow[];
  /** The file had more rows than an import reads. */
  truncated: boolean;
};

/** fuelLoadKey of the loads already in the system between the two dates. */
async function existingKeys(
  from: string,
  to: string,
): Promise<Set<string> | null> {
  const service = getServiceClient();
  const { data, error } = await paginateRange((start, end) =>
    service
      .from("fuel_loads")
      .select("vehicle_id, load_date, amount, liters")
      .gte("load_date", from)
      .lte("load_date", to)
      .order("id")
      .range(start, end),
  );
  if (error) return null;
  return new Set(
    data.map((l) =>
      fuelLoadKey({
        vehicle_id: l.vehicle_id,
        load_date: l.load_date,
        amount: Number(l.amount),
        liters: Number(l.liters),
      }),
    ),
  );
}

function dateRange(dates: readonly string[]): [string, string] | null {
  const sorted = [...dates].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return first && last ? [first, last] : null;
}

/** Reads a YPF en Ruta / Axion Card statement and returns its rows matched to
 *  vehicles, flagged as ready, duplicate, without vehicle or unreadable.
 *  Writes nothing. */
export async function previewFuelImportAction(
  formData: FormData,
): Promise<ActionResult<FuelImportPreview>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fuel:write")) {
    return { ok: false, error: "No tenés permiso para importar cargas." };
  }
  let mappingInput: unknown = null;
  const rawMapping = formData.get("mapping");
  if (typeof rawMapping === "string" && rawMapping !== "") {
    try {
      mappingInput = JSON.parse(rawMapping);
    } catch {
      return { ok: false, error: "Columnas inválidas." };
    }
  }
  const parsed = FuelImportPreviewSchema.safeParse({
    provider: formData.get("provider"),
    mapping: mappingInput,
  });
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Elegí el archivo del resumen." };
  }
  if (file.size > MAX_UPLOAD_TABLE_BYTES) {
    return { ok: false, error: "El archivo supera los 4 MB." };
  }
  const table = readUploadedTable(
    file.name,
    new Uint8Array(await file.arrayBuffer()),
    FUEL_IMPORT_LIMITS,
  );
  if (typeof table === "string") return { ok: false, error: table };

  const headerIndex = findHeaderRow(table.rows, parsed.data.provider);
  if (headerIndex < 0) {
    return {
      ok: false,
      error:
        "No encontramos la fila de títulos (Fecha, Patente, Litros, Importe…).",
    };
  }
  const headers = table.rows[headerIndex] ?? [];
  const mapping =
    parsed.data.mapping ?? suggestMapping(headers, parsed.data.provider);
  const missing = missingFields(mapping);
  if (missing.length > 0) {
    return {
      ok: true,
      data: { headers, mapping, missing, rows: [], truncated: table.truncated },
    };
  }

  const service = getServiceClient();
  const vehicles = await paginateRange((from, to) =>
    service
      .from("vehicles")
      .select("id, patente, fuel_card")
      .order("id")
      .range(from, to),
  );
  if (vehicles.error) {
    logger.error("fuel.import.vehicles_failed", {
      userId: ctx.userId,
      error: vehicles.error,
    });
    return { ok: false, error: "No se pudieron leer los vehículos." };
  }

  const body = table.rows.slice(headerIndex + 1);
  // Duplicates need the file's dates first: a dry pass with no known loads.
  const dry = buildImportRows({
    rows: body,
    firstLine: headerIndex + 2,
    mapping,
    vehicles: vehicles.data,
    existing: new Set(),
  });
  const range = dateRange(
    dry.flatMap((r) => (r.load_date ? [r.load_date] : [])),
  );
  const existing = range
    ? await existingKeys(range[0], range[1])
    : new Set<string>();
  if (!existing) {
    logger.error("fuel.import.existing_failed", { userId: ctx.userId });
    return {
      ok: false,
      error: "No se pudieron revisar las cargas existentes.",
    };
  }
  const rows = buildImportRows({
    rows: body,
    firstLine: headerIndex + 2,
    mapping,
    vehicles: vehicles.data,
    existing,
  });
  return {
    ok: true,
    data: { headers, mapping, missing, rows, truncated: table.truncated },
  };
}

/** Inserts the confirmed rows. A row that matches a load already in the
 *  system (or an earlier row of the batch) is skipped unless the user kept it
 *  on purpose, so a second click does not load the statement twice. */
export async function confirmFuelImportAction(
  input: unknown,
): Promise<ActionResult<{ inserted: number; skipped: number }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "fuel:write")) {
    return { ok: false, error: "No tenés permiso para importar cargas." };
  }
  const parsed = FuelImportConfirmSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }
  const { provider, rows } = parsed.data;
  const service = getServiceClient();

  const known = await fetchInChunks(
    rows.map((r) => r.vehicle_id),
    (ids) => service.from("vehicles").select("id").in("id", ids),
  );
  if (known.error) {
    logger.error("fuel.import.vehicles_failed", {
      userId: ctx.userId,
      error: known.error,
    });
    return { ok: false, error: "No se pudieron revisar los vehículos." };
  }
  const knownIds = new Set(known.data.map((v) => v.id));
  if (rows.some((r) => !knownIds.has(r.vehicle_id))) {
    return {
      ok: false,
      error: "Algún vehículo ya no existe. Volvé a leer el archivo.",
    };
  }

  const range = dateRange(rows.map((r) => r.load_date));
  const existing = range ? await existingKeys(range[0], range[1]) : null;
  if (!existing) {
    logger.error("fuel.import.existing_failed", { userId: ctx.userId });
    return {
      ok: false,
      error: "No se pudieron revisar las cargas existentes.",
    };
  }

  const source = FUEL_IMPORT_PROVIDER_LABELS[provider];
  const inserts = [];
  for (const r of rows) {
    const key = fuelLoadKey(r);
    if (existing.has(key) && !r.allow_duplicate) continue;
    existing.add(key);
    inserts.push({
      vehicle_id: r.vehicle_id,
      load_date: r.load_date,
      liters: r.liters,
      amount: r.amount,
      odometer_km: r.odometer_km,
      station: r.station,
      card: r.card,
      notes: [`Importada de ${source}`, r.product && `Producto: ${r.product}`]
        .filter(Boolean)
        .join(" · "),
      created_by: ctx.userId,
    });
  }
  const skipped = rows.length - inserts.length;
  if (inserts.length === 0) {
    return { ok: true, data: { inserted: 0, skipped } };
  }

  const { error } = await service.from("fuel_loads").insert(inserts);
  if (error) {
    logger.error("fuel.import.insert_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron importar las cargas." };
  }

  await logAudit("fuel_load.imported", ctx.userId, {
    provider,
    inserted: inserts.length,
    skipped,
    from: range?.[0] ?? null,
    to: range?.[1] ?? null,
  });
  return { ok: true, data: { inserted: inserts.length, skipped } };
}
