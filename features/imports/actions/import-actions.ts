"use server";

import { createHash } from "node:crypto";

import { logAudit } from "@/lib/actions/audit";
import { requireUserContext, type UserContext } from "@/lib/auth/context";
import { userCan, userCanAll } from "@/lib/auth/permissions";
import { mapDbGuardError } from "@/lib/db/guard-errors";
import { todayInAR } from "@/lib/format";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { fetchInChunks, paginateRange } from "@/lib/supabase/paginate";
import { getServiceClient } from "@/lib/supabase/service";
import { findHeaderRowIndex, suggestColumnMapping } from "@/lib/tables/columns";
import type { TableLimits } from "@/lib/tables/csv";
import { decodeText, readUploadedTable } from "@/lib/tables/read-upload";
import { MAX_UPLOAD_TABLE_BYTES } from "@/lib/tables/limits";

import { isAccountType, isCheckAccount } from "@/features/accounts/schema";
import { DRIVER_POSITION } from "@/features/hr/schema";

import { fieldAliases, fieldKeys } from "../lib/fields";
import {
  checkKey,
  clientTariffKey,
  existingCounterpartyKeys,
  existingEmployeeKeys,
  historicPayrollKey,
  loanKey,
  openingBalanceKey,
  plateKey,
  vehicleKey,
} from "../lib/keys";
import {
  mergeDescriptionOverflow,
  buildRows,
  countRows,
  markDuplicates,
  missingRequired,
  toPreviewRow,
  type BuiltRow,
  type ImportCounts,
  type ImportLookups,
  type ImportMapping,
  type ImportPreviewRow,
} from "../lib/rows";
import {
  IMPORT_KIND_PERMISSION,
  ImportRequestSchema,
  UndoImportRunSchema,
  isImportKind,
  isImportRunStatus,
  kindHasStrictKeys,
  kindNeedsAccount,
  kindNeedsChannel,
  type ImportKind,
  type ImportRunStatus,
} from "../schema";

/** A source hash is 64 characters, not a 36-character uuid: 200 of them in
 *  one `.in()` overflow the proxy's URL limit (a statement of a few hundred
 *  lines failed to read back). */
const HASH_CHUNK_SIZE = 100;

/** Rows of one import; commit_import_run takes up to 5000. */
const IMPORT_LIMITS: TableLimits = { rows: 5000, columns: 60, cellChars: 500 };

const DENIED = "No tenés permiso para importar.";

export type ImportPreview = {
  kind: ImportKind;
  fileName: string;
  fileSha256: string;
  headers: string[];
  mapping: ImportMapping;
  /** Required fields the mapping leaves out. */
  missing: string[];
  rows: ImportPreviewRow[];
  counts: ImportCounts;
  /** The file had more rows or columns than an import reads. */
  truncated: boolean;
  /** Earlier runs of this same file (same SHA-256). */
  previousRuns: { id: string; created_at: string; status: ImportRunStatus }[];
  /** Statement lines left out for being outside the chosen period. */
  outsidePeriod: number;
};

type Prepared = Omit<ImportPreview, "rows"> & { rows: BuiltRow[] };

function canImport(ctx: UserContext, kind: ImportKind): boolean {
  return (
    userCan(ctx.access, "imports:write") &&
    userCanAll(ctx.access, IMPORT_KIND_PERMISSION[kind])
  );
}

function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

type Failed = { error: string };

type Targets = Pick<ImportLookups, "account" | "channelId">;

/** The account and channel the user picked, checked against the database:
 *  the account must exist, be active and fit the kind (a cartera for checks,
 *  any other type for a statement); the channel must be active. */
async function resolveTargets(
  kind: ImportKind,
  accountId: string | null,
  channelId: string | null,
): Promise<Targets | Failed> {
  const service = getServiceClient();
  const targets: Targets = { account: null, channelId: null };
  if (kindNeedsAccount(kind)) {
    if (!accountId) return { error: "Elegí la cuenta." };
    const { data, error } = await service
      .from("accounts")
      .select("id, name, type, currency, is_active")
      .eq("id", accountId)
      .maybeSingle();
    if (error) return { error: "No se pudo leer la cuenta." };
    if (!data || !data.is_active)
      return { error: "La cuenta no existe o está inactiva." };
    const type = isAccountType(data.type) ? data.type : undefined;
    const isCartera = isCheckAccount(type);
    if (kind === "checks" && !isCartera) {
      return { error: "Los cheques van a una cuenta de cheques en cartera." };
    }
    if (kind === "bank_statement" && (isCartera || !type)) {
      return {
        error:
          "El extracto es de una cuenta de banco, billetera, caja o inversión.",
      };
    }
    if (data.currency !== "ARS" && data.currency !== "USD") {
      return { error: "La moneda de la cuenta no es válida." };
    }
    targets.account = {
      id: data.id,
      name: data.name,
      type: data.type,
      currency: data.currency,
    };
  }
  if (kindNeedsChannel(kind)) {
    if (!channelId) return { error: "Elegí el canal." };
    const { data, error } = await service
      .from("invoicing_channels")
      .select("id, is_active")
      .eq("id", channelId)
      .maybeSingle();
    if (error) return { error: "No se pudo leer el canal." };
    if (!data || !data.is_active)
      return { error: "El canal no existe o está inactivo." };
    targets.channelId = data.id;
  }
  return targets;
}

/** What each kind matches its rows against; null when a read failed. */
async function loadLookups(
  kind: ImportKind,
  targets: Targets,
): Promise<ImportLookups | null> {
  const service = getServiceClient();
  const lookups: ImportLookups = {
    today: todayInAR(),
    hash: sha256,
    employees: [],
    vehicles: [],
    drivers: [],
    clients: [],
    fuelCards: new Map(),
    realPayroll: new Set(),
    account: targets.account,
    channelId: targets.channelId,
    tariffs: [],
    supplierCategories: [],
    expenseAccounts: [],
    costCenters: [],
    areas: [],
  };
  if (kind === "client_tariffs") {
    const [tariffs, areas] = await Promise.all([
      paginateRange((from, to) =>
        service
          .from("client_tariffs")
          .select("client_id, concept, area_id, valid_from, valid_to")
          .order("id")
          .range(from, to),
      ),
      paginateRange((from, to) =>
        service
          .from("storage_areas")
          .select("id, name, is_active, warehouse_id, warehouses ( name )")
          .order("id")
          .range(from, to),
      ),
    ]);
    if (tariffs.error || areas.error) return null;
    lookups.tariffs = tariffs.data;
    lookups.areas = areas.data.map((a) => ({
      id: a.id,
      name: a.name,
      is_active: a.is_active,
      warehouse_id: a.warehouse_id,
      warehouse_name: a.warehouses?.name ?? "",
    }));
  }
  if (kind === "suppliers") {
    const [categories, accounts, centers] = await Promise.all([
      paginateRange((from, to) =>
        service
          .from("supplier_categories")
          .select("id, name, is_active")
          .order("id")
          .range(from, to),
      ),
      paginateRange((from, to) =>
        service
          .from("expense_leaf_accounts")
          .select("id, code, name")
          .order("id")
          .range(from, to),
      ),
      paginateRange((from, to) =>
        service
          .from("cost_centers")
          .select("id, code, name, is_active")
          .order("id")
          .range(from, to),
      ),
    ]);
    if (categories.error || accounts.error || centers.error) return null;
    lookups.supplierCategories = categories.data;
    lookups.expenseAccounts = accounts.data.flatMap((a) =>
      a.id && a.code && a.name
        ? [{ id: a.id, code: a.code, name: a.name }]
        : [],
    );
    lookups.costCenters = centers.data;
  }
  if (kind === "vehicles" || kind === "historic_trips") {
    const vehicles = await paginateRange((from, to) =>
      service
        .from("vehicles")
        .select("id, patente, fuel_card")
        .order("id")
        .range(from, to),
    );
    if (vehicles.error) return null;
    lookups.vehicles = vehicles.data;
    lookups.fuelCards = new Map(
      vehicles.data.flatMap((v) =>
        v.fuel_card ? [[v.fuel_card, plateKey(v.patente)] as const] : [],
      ),
    );
  }
  if (kind === "historic_payroll") {
    const employees = await paginateRange((from, to) =>
      service
        .from("employees")
        .select("id, cuil, legal_name")
        .order("id")
        .range(from, to),
    );
    if (employees.error) return null;
    lookups.employees = employees.data;
    const entries = await paginateRange((from, to) =>
      service
        .from("payroll_entries")
        .select("employee_id, payroll_periods ( year, month, kind )")
        .order("id")
        .range(from, to),
    );
    if (entries.error) return null;
    lookups.realPayroll = new Set(
      entries.data.flatMap((e) =>
        e.payroll_periods
          ? [
              historicPayrollKey({
                employee_id: e.employee_id,
                period: `${e.payroll_periods.year}-${String(e.payroll_periods.month).padStart(2, "0")}`,
                kind: e.payroll_periods.kind,
              }),
            ]
          : [],
      ),
    );
  }
  if (
    kind === "historic_trips" ||
    kind === "client_tariffs" ||
    kind === "opening_balances"
  ) {
    const clients = await paginateRange((from, to) =>
      service
        .from("clients")
        .select("id, legal_name, display_name, cuit")
        .order("id")
        .range(from, to),
    );
    if (clients.error) return null;
    lookups.clients = clients.data;
  }
  if (kind === "historic_trips") {
    const drivers = await paginateRange((from, to) =>
      service
        .from("drivers")
        .select("id, full_name, cuit")
        .order("id")
        .range(from, to),
    );
    if (drivers.error) return null;
    lookups.drivers = drivers.data;
  }
  return lookups;
}

/** The natural keys already in the system for these rows; null on a failed
 *  read (a partial answer would let duplicates through). */
async function existingKeys(
  kind: ImportKind,
  rows: readonly BuiltRow[],
  lookups: ImportLookups,
): Promise<Set<string> | null> {
  const service = getServiceClient();
  switch (kind) {
    case "clients": {
      const res = await paginateRange((from, to) =>
        service
          .from("clients")
          .select("cuit, legal_name, is_fiscal")
          .order("id")
          .range(from, to),
      );
      return res.error ? null : existingCounterpartyKeys(res.data);
    }
    case "suppliers": {
      const res = await paginateRange((from, to) =>
        service
          .from("suppliers")
          .select("cuit, legal_name, is_fiscal")
          .order("id")
          .range(from, to),
      );
      return res.error ? null : existingCounterpartyKeys(res.data);
    }
    case "employees": {
      const res = await paginateRange((from, to) =>
        service
          .from("employees")
          .select("cuil, legal_name")
          .order("id")
          .range(from, to),
      );
      return res.error ? null : existingEmployeeKeys(res.data);
    }
    case "vehicles":
      return new Set(lookups.vehicles.map((v) => vehicleKey(v.patente)));
    case "historic_payroll": {
      const ids = rows.flatMap((r) =>
        r.payload && typeof r.payload.employee_id === "string"
          ? [r.payload.employee_id]
          : [],
      );
      const res = await fetchInChunks(ids, (chunk) =>
        paginateRange((from, to) =>
          service
            .from("historic_payroll_entries")
            .select("employee_id, period, kind")
            .in("employee_id", chunk)
            .order("id")
            .range(from, to),
        ),
      );
      return res.error ? null : new Set(res.data.map(historicPayrollKey));
    }
    case "historic_trips": {
      const hashes = rows.flatMap((r) => (r.key ? [r.key] : []));
      const res = await fetchInChunks(
        hashes,
        (chunk) =>
          service
            .from("historic_trips")
            .select("source_hash")
            .in("source_hash", chunk),
        HASH_CHUNK_SIZE,
      );
      return res.error ? null : new Set(res.data.map((t) => t.source_hash));
    }
    case "client_tariffs":
      return new Set(lookups.tariffs.map(clientTariffKey));
    case "loans": {
      const res = await paginateRange((from, to) =>
        service
          .from("loans")
          .select("description, lender, first_due_date")
          .order("id")
          .range(from, to),
      );
      return res.error ? null : new Set(res.data.map(loanKey));
    }
    case "checks": {
      const numbers = rows.flatMap((r) =>
        r.payload && typeof r.payload.check_number === "string"
          ? [r.payload.check_number]
          : [],
      );
      const res = await fetchInChunks(numbers, (chunk) =>
        paginateRange((from, to) =>
          service
            .from("checks")
            .select("kind, bank_name, check_number")
            .in("check_number", chunk)
            .order("id")
            .range(from, to),
        ),
      );
      return res.error ? null : new Set(res.data.map(checkKey));
    }
    case "opening_balances": {
      const ids = rows.flatMap((r) =>
        r.payload && typeof r.payload.client_id === "string"
          ? [r.payload.client_id]
          : [],
      );
      const res = await fetchInChunks(ids, (chunk) =>
        service
          .from("client_opening_balances")
          .select("client_id")
          .in("client_id", chunk),
      );
      return res.error
        ? null
        : new Set(res.data.map((o) => openingBalanceKey(o.client_id)));
    }
    case "bank_statement": {
      const accountId = lookups.account?.id;
      if (!accountId) return new Set();
      const hashes = rows.flatMap((r) => (r.key ? [r.key] : []));
      const res = await fetchInChunks(
        hashes,
        (chunk) =>
          service
            .from("bank_statement_lines")
            .select("source_hash")
            .eq("account_id", accountId)
            .in("source_hash", chunk),
        HASH_CHUNK_SIZE,
      );
      if (res.error) return null;
      const existing = new Set(res.data.map((l) => l.source_hash));
      // A bank rewrites a line's text between downloads (Galicia adds a
      // «Leyenda» later): the same day, amount and running balance is the
      // same line, whatever its description now says.
      const pending = rows.filter(
        (r) =>
          r.key &&
          !existing.has(r.key) &&
          typeof r.payload?.balance === "number",
      );
      const dates = pending.flatMap((r) =>
        typeof r.payload?.line_date === "string" ? [r.payload.line_date] : [],
      );
      if (dates.length === 0) return existing;
      const loaded = await service
        .from("bank_statement_lines")
        .select("line_date, amount, balance")
        .eq("account_id", accountId)
        .not("balance", "is", null)
        .gte(
          "line_date",
          dates.reduce((a, b) => (a < b ? a : b)),
        )
        .lte(
          "line_date",
          dates.reduce((a, b) => (a > b ? a : b)),
        )
        .limit(20000);
      if (loaded.error) return null;
      const triple = (date: unknown, amount: unknown, balance: unknown) =>
        `${String(date)}|${Number(amount).toFixed(2)}|${Number(balance).toFixed(2)}`;
      const seen = new Set(
        loaded.data.map((l) => triple(l.line_date, l.amount, l.balance)),
      );
      for (const r of pending) {
        const p = r.payload;
        if (r.key && p && seen.has(triple(p.line_date, p.amount, p.balance))) {
          existing.add(r.key);
        }
      }
      return existing;
    }
  }
}

/** The loaded statement lines of the file that have no bank code yet: an
 *  import of the same file with its code fills them. */
async function statementLinesWithoutCode(
  rows: readonly BuiltRow[],
  lookups: ImportLookups,
): Promise<Set<string> | null> {
  const accountId = lookups.account?.id;
  if (!accountId) return new Set();
  const hashes = rows.flatMap((r) =>
    r.key && r.payload && typeof r.payload.bank_code === "string"
      ? [r.key]
      : [],
  );
  const res = await fetchInChunks(
    hashes,
    (chunk) =>
      getServiceClient()
        .from("bank_statement_lines")
        .select("source_hash")
        .eq("account_id", accountId)
        .is("bank_code", null)
        .in("source_hash", chunk),
    HASH_CHUNK_SIZE,
  );
  return res.error ? null : new Set(res.data.map((l) => l.source_hash));
}

/** Reads the uploaded file and builds every row. Writes nothing. */
async function prepare(
  ctx: UserContext,
  formData: FormData,
): Promise<Prepared | Failed> {
  let mappingInput: unknown = null;
  const rawMapping = formData.get("mapping");
  if (typeof rawMapping === "string" && rawMapping !== "") {
    try {
      mappingInput = JSON.parse(rawMapping);
    } catch {
      return { error: "Columnas inválidas." };
    }
  }
  const optional = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" && value !== "" ? value : null;
  };
  const parsed = ImportRequestSchema.safeParse({
    kind: formData.get("kind"),
    mapping: mappingInput,
    account_id: optional("account_id"),
    channel_id: optional("channel_id"),
    date_from: optional("date_from"),
    date_to: optional("date_to"),
  });
  if (!parsed.success) return { error: "Datos inválidos." };
  const { kind } = parsed.data;
  if (!canImport(ctx, kind)) return { error: DENIED };
  const targets = await resolveTargets(
    kind,
    parsed.data.account_id,
    parsed.data.channel_id,
  );
  if ("error" in targets) return { error: targets.error };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Elegí el archivo." };
  }
  if (file.size > MAX_UPLOAD_TABLE_BYTES) {
    return { error: "El archivo supera los 4 MB." };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  // A bank or a Spanish-locale Excel writes CSV in windows-1252.
  const keys = fieldKeys(kind);
  const aliases = fieldAliases(kind);
  const table = readUploadedTable(file.name, bytes, IMPORT_LIMITS, {
    decode: decodeText,
    header: { fields: keys, aliases },
  });
  if (typeof table === "string") return { error: table };

  const headerIndex = findHeaderRowIndex(table.rows, keys, aliases);
  if (headerIndex < 0) {
    return {
      error:
        "No encontramos la fila de títulos: la planilla tiene que tener una fila con los nombres de las columnas.",
    };
  }
  const headers = table.rows[headerIndex] ?? [];
  const mapping: ImportMapping = parsed.data.mapping
    ? Object.fromEntries(
        Object.entries(parsed.data.mapping).filter(
          ([key, index]) => keys.includes(key) && index < headers.length,
        ),
      )
    : suggestColumnMapping(headers, keys, aliases);

  const fileSha256 = sha256(bytes);
  const service = getServiceClient();
  const previous = await service
    .from("import_runs")
    .select("id, created_at, status")
    .eq("file_sha256", fileSha256)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(20);
  if (previous.error) {
    logger.error("imports.prepare.previous_failed", {
      userId: ctx.userId,
      error: previous.error,
    });
    return { error: "No se pudieron revisar las importaciones anteriores." };
  }
  const previousRuns = previous.data.flatMap((r) =>
    isImportRunStatus(r.status)
      ? [{ id: r.id, created_at: r.created_at, status: r.status }]
      : [],
  );

  const base = {
    kind,
    fileName: file.name,
    fileSha256,
    headers,
    mapping,
    truncated: table.truncated,
    previousRuns,
    outsidePeriod: 0,
  };
  const missing = missingRequired(kind, mapping);
  if (missing.length > 0) {
    return {
      ...base,
      missing,
      rows: [],
      counts: { ready: 0, fill: 0, duplicate: 0, invalid: 0 },
    };
  }

  const lookups = await loadLookups(kind, targets);
  if (!lookups) {
    logger.error("imports.prepare.lookups_failed", {
      userId: ctx.userId,
      kind,
    });
    return { error: "No se pudieron leer los datos cargados." };
  }
  const built = buildRows({
    kind,
    rows:
      kind === "bank_statement"
        ? mergeDescriptionOverflow(
            table.rows.slice(headerIndex + 1),
            headers.length,
            mapping.description,
          )
        : table.rows.slice(headerIndex + 1),
    firstLine: headerIndex + 2,
    mapping,
    lookups,
  });
  const existing = await existingKeys(kind, built, lookups);
  if (!existing) {
    logger.error("imports.prepare.existing_failed", {
      userId: ctx.userId,
      kind,
    });
    return { error: "No se pudo revisar qué ya está cargado." };
  }
  const fillable =
    kind === "bank_statement"
      ? await statementLinesWithoutCode(built, lookups)
      : new Set<string>();
  if (!fillable) {
    logger.error("imports.prepare.fillable_failed", {
      userId: ctx.userId,
      kind,
    });
    return { error: "No se pudo revisar qué ya está cargado." };
  }
  const marked = markDuplicates(
    built,
    existing,
    kindHasStrictKeys(kind),
    fillable,
  );
  const { date_from, date_to } = parsed.data;
  const inPeriod = (r: BuiltRow) => {
    const date = r.payload?.line_date;
    if (kind !== "bank_statement" || typeof date !== "string") return true;
    return (!date_from || date >= date_from) && (!date_to || date <= date_to);
  };
  const rows = marked.filter(inPeriod);
  return {
    ...base,
    missing,
    rows,
    counts: countRows(rows),
    outsidePeriod: marked.length - rows.length,
  };
}

/** Reads the file and shows each row as it would import: ready, already
 *  loaded or with errors (and its warnings). Writes nothing. */
export async function previewImportAction(
  formData: FormData,
): Promise<ActionResult<ImportPreview>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "imports:write")) {
    return { ok: false, error: DENIED };
  }
  const prepared = await prepare(ctx, formData);
  if ("error" in prepared) return { ok: false, error: prepared.error };
  return {
    ok: true,
    data: { ...prepared, rows: prepared.rows.map(toPreviewRow) },
  };
}

export type ImportCommitResult = {
  runId: string;
  inserted: number;
  /** Statement lines already loaded that only got their bank code; null when
   *  the run could not be read back. */
  filled: number | null;
  skipped: number;
  invalid: number;
};

/** Reads the file again (the client never sends rows) and imports the ready
 *  rows in one transaction. Rows with errors are left out and counted; a row
 *  already loaded is skipped, so importing the same file twice adds nothing
 *  (a statement line loaded without its bank code gets the code). */
export async function commitImportAction(
  formData: FormData,
): Promise<ActionResult<ImportCommitResult>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "imports:write")) {
    return { ok: false, error: DENIED };
  }
  const prepared = await prepare(ctx, formData);
  if ("error" in prepared) return { ok: false, error: prepared.error };
  if (prepared.missing.length > 0) {
    return { ok: false, error: "Faltan columnas obligatorias." };
  }
  if (prepared.truncated) {
    return {
      ok: false,
      error:
        "El archivo tiene más de 5000 filas o celdas muy largas: dividilo y volvé a importar.",
    };
  }
  const payloads = prepared.rows.flatMap((r) =>
    (r.status === "ready" || r.status === "fill") && r.payload
      ? [r.payload]
      : [],
  );
  if (payloads.length === 0) {
    return { ok: false, error: "No hay filas nuevas para importar." };
  }

  const service = getServiceClient();
  const { data: runId, error } = await service.rpc("commit_import_run", {
    p_kind: prepared.kind,
    p_file_name: prepared.fileName.slice(0, 255),
    p_file_sha256: prepared.fileSha256,
    p_mapping: prepared.mapping,
    p_total_rows: prepared.rows.length,
    p_skipped_rows: prepared.counts.duplicate,
    p_invalid_rows: prepared.counts.invalid,
    p_rows: payloads,
    p_user_id: ctx.userId,
    p_driver_position: DRIVER_POSITION,
  });
  if (error || !runId) {
    const guard = mapDbGuardError(error, {
      slug: "imports.commit.rejected",
      userId: ctx.userId,
    });
    if (!guard) {
      logger.error("imports.commit.failed", {
        userId: ctx.userId,
        kind: prepared.kind,
        error,
      });
    }
    return { ok: false, error: guard ?? "No se pudo importar el archivo." };
  }

  const run = await service
    .from("import_runs")
    .select("inserted_rows, filled_rows, skipped_rows, invalid_rows")
    .eq("id", runId)
    .single();
  if (run.error) {
    logger.error("imports.commit.read_failed", {
      userId: ctx.userId,
      runId,
      error: run.error,
    });
  }
  const result: ImportCommitResult = {
    runId,
    inserted: run.data?.inserted_rows ?? prepared.counts.ready,
    filled: run.data?.filled_rows ?? null,
    skipped: run.data?.skipped_rows ?? prepared.counts.duplicate,
    invalid: run.data?.invalid_rows ?? prepared.counts.invalid,
  };
  await logAudit(
    "import_run.committed",
    ctx.userId,
    {
      kind: prepared.kind,
      file_name: prepared.fileName,
      file_sha256: prepared.fileSha256,
      inserted: result.inserted,
      filled: result.filled,
      skipped: result.skipped,
      invalid: result.invalid,
    },
    runId,
  );
  return { ok: true, data: result };
}

/** Deletes what a run imported, when nothing was edited or uses it since. */
export async function undoImportRunAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "imports:write")) {
    return { ok: false, error: DENIED };
  }
  const parsed = UndoImportRunSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };
  const { id } = parsed.data;

  const service = getServiceClient();
  const run = await service
    .from("import_runs")
    .select("kind, status")
    .eq("id", id)
    .maybeSingle();
  if (run.error) {
    logger.error("imports.undo.read_failed", {
      userId: ctx.userId,
      id,
      error: run.error,
    });
    return { ok: false, error: "No se pudo leer la importación." };
  }
  if (!run.data || !isImportKind(run.data.kind)) {
    return { ok: false, error: "La importación no existe." };
  }
  if (!canImport(ctx, run.data.kind)) return { ok: false, error: DENIED };
  if (run.data.status === "undone") return { ok: true, data: { id } };

  const { error } = await service.rpc("undo_import_run", {
    p_run_id: id,
    p_user_id: ctx.userId,
  });
  if (error) {
    const guard = mapDbGuardError(error, {
      slug: "imports.undo.rejected",
      userId: ctx.userId,
      id,
    });
    if (!guard) {
      logger.error("imports.undo.failed", { userId: ctx.userId, id, error });
    }
    return { ok: false, error: guard ?? "No se pudo deshacer la importación." };
  }
  await logAudit("import_run.undone", ctx.userId, { kind: run.data.kind }, id);
  return { ok: true, data: { id } };
}

export type ImportRunRow = {
  id: string;
  kind: ImportKind;
  status: ImportRunStatus;
  file_name: string;
  total_rows: number;
  inserted_rows: number;
  filled_rows: number;
  skipped_rows: number;
  invalid_rows: number;
  created_at: string;
  created_by_name: string | null;
  undone_at: string | null;
  undone_by_name: string | null;
};

/** The latest 200 runs, newest first. */
export async function listImportRunsAction(): Promise<
  ActionResult<ImportRunRow[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "imports:read")) {
    return { ok: false, error: "No tenés permiso para ver las importaciones." };
  }
  const service = getServiceClient();
  const { data, error } = await service
    .from("import_runs")
    .select(
      "id, kind, status, file_name, total_rows, inserted_rows, filled_rows, skipped_rows, invalid_rows, created_at, created_by, undone_at, undone_by",
    )
    .order("created_at", { ascending: false })
    .order("id")
    .limit(200);
  if (error) {
    logger.error("imports.runs.list_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron leer las importaciones." };
  }
  const userIds = data.flatMap((r) =>
    [r.created_by, r.undone_by].flatMap((v) => (v ? [v] : [])),
  );
  const profiles = await fetchInChunks(userIds, (chunk) =>
    service
      .from("user_profiles")
      .select("user_id, first_name, last_name")
      .in("user_id", chunk),
  );
  if (profiles.error) {
    logger.warn("imports.runs.profiles_failed", { userId: ctx.userId });
  }
  const names = new Map(
    (profiles.data ?? []).map((p) => [
      p.user_id,
      `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || null,
    ]),
  );
  const rows = data.flatMap((r): ImportRunRow[] => {
    if (!isImportKind(r.kind) || !isImportRunStatus(r.status)) {
      logger.warn("imports.runs.unknown_kind", { id: r.id });
      return [];
    }
    return [
      {
        id: r.id,
        kind: r.kind,
        status: r.status,
        file_name: r.file_name,
        total_rows: r.total_rows,
        inserted_rows: r.inserted_rows,
        filled_rows: r.filled_rows,
        skipped_rows: r.skipped_rows,
        invalid_rows: r.invalid_rows,
        created_at: r.created_at,
        created_by_name: r.created_by
          ? (names.get(r.created_by) ?? null)
          : null,
        undone_at: r.undone_at,
        undone_by_name: r.undone_by ? (names.get(r.undone_by) ?? null) : null,
      },
    ];
  });
  return { ok: true, data: rows };
}
