"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCanAll } from "@/lib/auth/permissions";
import {
  echeqsToLoad,
  parseEcheqListado,
  type ListedEcheq,
} from "@/lib/checks/echeq-listado";
import { createReceipt } from "@/lib/commands/create-receipt";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { getServiceClient } from "@/lib/supabase/service";
import { readUploadedTable } from "@/lib/tables/read-upload";

import { ReceiptCreateSchema } from "../schema";

import {
  getNextReceiptNumeroAction,
  listPendingComprobantesForClientAction,
} from "./receipts-actions";

// A receipt with an eCheq: the receipt, the check into the cartera and the
// treasury movement of the cartera.
const PERMISSIONS = [
  "receipts:write",
  "cheques:write",
  "transactions:write",
] as const;
const MAX_BYTES = 5 * 1024 * 1024;

export type EcheqListadoRow = ListedEcheq & {
  client_id: string | null;
  /** Why it is not loaded, when it is not. */
  issue: string | null;
};

export type EcheqListadoPreview = {
  rows: EcheqListadoRow[];
  ready: number;
  cartera_account: string | null;
};

const digits = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");

async function prepare(formData: FormData): Promise<
  | { ok: false; error: string }
  | {
      ok: true;
      preview: EcheqListadoPreview;
      channel: string;
      cartera: string | null;
    }
> {
  const file = formData.get("file");
  const from = String(formData.get("from") ?? "");
  if (!(file instanceof File) || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return { ok: false, error: "Elegí el listado y desde qué fecha cargar." };
  }
  if (file.size > MAX_BYTES)
    return { ok: false, error: "El archivo es demasiado grande." };
  const table = readUploadedTable(
    file.name,
    new Uint8Array(await file.arrayBuffer()),
    {
      rows: 3000,
      columns: 150,
      cellChars: 300,
    },
  );
  if (typeof table === "string") return { ok: false, error: table };

  const service = getServiceClient();
  const [company, channel, cartera] = await Promise.all([
    service.from("business_units").select("cuit").limit(1).maybeSingle(),
    service
      .from("invoicing_channels")
      .select("id")
      .eq("is_fiscal", true)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle(),
    service
      .from("accounts")
      .select("id, name")
      .eq("type", "echeq")
      .eq("is_active", true)
      .eq("currency", "ARS")
      .order("name")
      .limit(1)
      .maybeSingle(),
  ]);
  if (company.error || channel.error || cartera.error || !channel.data) {
    return {
      ok: false,
      error:
        "No se pudo leer la empresa, el canal fiscal o la cartera de e-cheq.",
    };
  }
  const parsed = parseEcheqListado(table.rows, company.data?.cuit ?? "");
  if (!parsed.ok) return parsed;
  const toLoad = echeqsToLoad(parsed.cheques, from);

  const cuits = [...new Set(toLoad.map((c) => c.client_cuit).filter(Boolean))];
  const [clients, checks] = await Promise.all([
    service
      .from("clients")
      .select("id, cuit")
      .in("cuit", cuits.length ? cuits : ["-"])
      .eq("is_fiscal", true),
    service
      .from("checks")
      .select("check_number, amount")
      .in("check_number", [
        ...new Set(
          toLoad.flatMap((c) => [c.check_number, digits(c.check_number)]),
        ),
      ]),
  ]);
  if (clients.error || checks.error) {
    return {
      ok: false,
      error: "No se pudieron revisar los clientes y los cheques cargados.",
    };
  }
  const clientByCuit = new Map(clients.data.map((c) => [c.cuit, c.id]));
  const loaded = new Set(
    checks.data.map(
      (c) => `${digits(c.check_number)}|${Number(c.amount).toFixed(2)}`,
    ),
  );

  const rows: EcheqListadoRow[] = toLoad.map((c) => {
    const client_id = clientByCuit.get(c.client_cuit) ?? null;
    const issue = loaded.has(`${digits(c.check_number)}|${c.amount.toFixed(2)}`)
      ? "Ya está cargado."
      : !cartera.data
        ? "No hay una cartera de e-cheq activa."
        : !client_id
          ? `No hay un cliente con el CUIT ${c.client_cuit}: crealo en Ventas › Clientes.`
          : null;
    return { ...c, client_id, issue };
  });
  return {
    ok: true,
    channel: channel.data.id,
    cartera: cartera.data?.id ?? null,
    preview: {
      rows,
      ready: rows.filter((r) => r.issue === null).length,
      cartera_account: cartera.data?.name ?? null,
    },
  };
}

/** What the listado would load, without writing anything. */
export async function previewEcheqListadoAction(
  formData: FormData,
): Promise<ActionResult<EcheqListadoPreview>> {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, PERMISSIONS)) {
    return { ok: false, error: "Sin permiso para cargar cobros con cheques." };
  }
  const prepared = await prepare(formData);
  if (!prepared.ok) return prepared;
  return { ok: true, data: prepared.preview };
}

/** Loads each listed eCheq as the receipt of the client who endorsed it:
 *  the check enters the e-cheq cartera and pays the client's oldest
 *  comprobantes (what is left stays on account). */
export async function importEcheqListadoAction(
  formData: FormData,
): Promise<ActionResult<{ created: number; failed: string[] }>> {
  const ctx = await requireUserContext();
  if (!userCanAll(ctx.access, PERMISSIONS)) {
    return { ok: false, error: "Sin permiso para cargar cobros con cheques." };
  }
  const prepared = await prepare(formData);
  if (!prepared.ok) return prepared;
  const { preview, channel, cartera } = prepared;
  if (!cartera)
    return { ok: false, error: "No hay una cartera de e-cheq activa." };

  let created = 0;
  const failed: string[] = [];
  for (const row of preview.rows) {
    if (row.issue !== null || !row.client_id) continue;
    const next = await getNextReceiptNumeroAction({ channel_id: channel });
    if (!next.ok) return next;
    const input = ReceiptCreateSchema.safeParse({
      channel_id: channel,
      numero: next.data.next,
      client_id: row.client_id,
      receipt_date: row.received_date,
      total_amount: row.amount,
      currency: "ARS",
      notes: `e-cheq ${row.check_number} del listado de Galicia`,
      allocation_mode: "fifo",
      payment_lines: [
        {
          account_id: cartera,
          amount: row.amount,
          check: {
            check_number: row.check_number,
            bank_name: row.bank_name.slice(0, 120),
            drawer_name: row.drawer_name.slice(0, 120),
            drawer_cuit: row.drawer_cuit ?? "",
            issue_date: row.issue_date,
            due_date: row.due_date,
          },
        },
      ],
    });
    if (!input.success) {
      failed.push(
        `${row.check_number}: ${input.error.issues[0]?.message ?? "datos inválidos"}`,
      );
      continue;
    }
    const res = await createReceipt(
      ctx.userId,
      input.data,
      listPendingComprobantesForClientAction,
    );
    if (res.ok) created++;
    else {
      logger.warn("receipts.echeq_listado.failed", {
        userId: ctx.userId,
        check: row.check_number,
        error: res.error,
      });
      failed.push(`${row.check_number}: ${res.error}`);
    }
  }
  return { ok: true, data: { created, failed } };
}
