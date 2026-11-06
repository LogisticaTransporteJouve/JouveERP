import { z } from "zod";

import {
  findClientByCuitAction,
  getClientByIdAction,
} from "@/features/clients/actions/clients-actions";
import {
  IVA_CONDITION_LABEL,
  IVA_CONDITIONS,
  type Client,
} from "@/features/clients/schema";
import { isoDate } from "@/features/exchange-rates/schema";
import {
  getInvoiceDetailAction,
  listEnabledPosAction,
  listInvoicingChannelsAction,
} from "@/features/invoices/actions/invoices-actions";
import { getInvoiceEmailDefaultsAction } from "@/features/invoices/actions/send-invoice-email";
import {
  type ComprobanteItemInput,
  formatInvoiceNumero,
  suggestRevenueKind,
} from "@/features/invoices/schema";
import {
  CONCEPTO,
  isServiciosConcepto,
  ivaRateIdForPercent,
  letterFor,
  MONEDA,
  voucherReceptor,
} from "@/lib/afip/codes";
import { issueComprobante } from "@/lib/commands/issue-comprobante";
import {
  CLIENT_NOT_FOUND,
  createClientRecord,
  updateClientRecord,
} from "@/lib/commands/save-client";
import { sendInvoiceEmail } from "@/lib/commands/send-invoice-email";
import { formatArgentineDate, round2, todayInAR } from "@/lib/format";

import {
  CLIENT_SNAPSHOT_KEYS,
  COMPROBANTE_LABELS,
  clientCreateProposalSpec,
  clientUpdateProposalSpec,
  creditDebitNoteProposalSpec,
  invoiceEmailProposalSpec,
  invoiceProposalSpec,
  type ClientSnapshot,
} from "../../lib/proposal-specs";
import type { AiPrepareResult } from "../propose";
import { defineAiProposal } from "../propose";

import { MAX_CANDIDATES, norm, resolveClient } from "./resolve-client";

// Ventas: clients, comprobantes and their emails, proposed on a card and
// written on accept through the same lib/commands function the feature's
// server action runs. `prepare` resolves names with the features' read
// actions (their gate + RLS) and never writes.

const optionalText = (max: number) => z.string().trim().max(max).optional();

function issue(
  field: string,
  message: string,
  options?: { value: string; label: string }[],
): AiPrepareResult {
  return {
    kind: "issues",
    issues: [{ field, message }],
    candidates: options?.length ? [{ field, options }] : undefined,
  };
}

// ─── Clients ─────────────────────────────────────────────────────────────────

const IVA_OPTIONS = IVA_CONDITIONS.map((c) => ({
  value: c,
  label: IVA_CONDITION_LABEL[c],
}));

export const proposeClient = defineAiProposal({
  name: "proposeClient",
  domain: "ventas",
  permission: ["clients:write", "clients:read"],
  sources: ["clients"],
  description:
    "Propose creating a client (alta de cliente) for the user to accept on a " +
    "card. side 'ventas' bills with CAE and needs CUIT + IVA condition; " +
    "'otras_ventas' (remitos internos) has neither. A CUIT given means " +
    "ventas. Refuses a CUIT another client already has. Writes nothing by itself.",
  input: z.object({
    legal_name: z.string().trim().min(1).max(120),
    side: z.enum(["ventas", "otras_ventas"]).optional(),
    cuit: z.string().trim().max(20).optional(),
    iva_condition: z.enum(IVA_CONDITIONS).optional(),
    display_name: optionalText(120),
    email: optionalText(254),
    phone: optionalText(50),
    address: optionalText(2000).describe("Domicilio fiscal (ventas only)."),
    real_address: optionalText(2000),
    notes: optionalText(2000),
  }),
  spec: clientCreateProposalSpec,
  prepare: async (_ctx, input) => {
    const isFiscal =
      input.side !== undefined ? input.side === "ventas" : !!input.cuit;
    if (!isFiscal && input.side === undefined) {
      return issue(
        "side",
        "¿Es un cliente de Ventas (factura con CAE, necesita CUIT) o de Otras ventas (remito interno, sin CUIT)?",
        [
          { value: "ventas", label: "Ventas" },
          { value: "otras_ventas", label: "Otras ventas" },
        ],
      );
    }
    const contact = {
      legal_name: input.legal_name,
      display_name: input.display_name ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      real_address: input.real_address ?? null,
      notes: input.notes ?? null,
    };
    if (!isFiscal) {
      return { kind: "draft", draft: { ...contact, is_fiscal: false } };
    }
    if (!input.cuit) {
      return issue("cuit", "Falta el CUIT del cliente.");
    }
    if (!input.iva_condition) {
      return issue(
        "iva_condition",
        "Falta la condición de IVA del cliente.",
        IVA_OPTIONS,
      );
    }
    const existing = await findClientByCuitAction(input.cuit);
    if (!existing.ok) return { kind: "error", error: existing.error };
    if (existing.data) {
      return {
        kind: "error",
        error: `Ya existe un cliente con ese CUIT: ${existing.data.legal_name}.`,
      };
    }
    return {
      kind: "draft",
      draft: {
        ...contact,
        is_fiscal: true,
        cuit: input.cuit,
        iva_condition: input.iva_condition,
        address: input.address ?? null,
      },
    };
  },
  execute: async (ctx, draft) => createClientRecord(ctx.userId, draft),
});

function clientSnapshot(c: Client): ClientSnapshot {
  return {
    is_fiscal: c.is_fiscal,
    cuit: c.cuit,
    legal_name: c.legal_name,
    display_name: c.display_name,
    iva_condition: c.iva_condition,
    email: c.email,
    phone: c.phone,
    address: c.address,
    real_address: c.real_address,
    notes: c.notes,
  };
}

/** Fields only a Ventas client has. */
const FISCAL_ONLY_FIELDS = ["cuit", "iva_condition", "address"] as const;

export const proposeClientUpdate = defineAiProposal({
  name: "proposeClientUpdate",
  domain: "ventas",
  permission: ["clients:write", "clients:read"],
  sources: ["clients"],
  description:
    "Propose editing a client's ficha (razón social, nombre de fantasía, " +
    "email, teléfono, domicilios, notas; CUIT and IVA condition only for a " +
    "Ventas client) for the user to accept on a card. Pass only the fields " +
    "to change; an empty string clears one. Writes nothing by itself.",
  input: z.object({
    client: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .describe("Client name or CUIT, as the user said it."),
    legal_name: optionalText(120),
    display_name: optionalText(120),
    cuit: optionalText(20),
    iva_condition: z.enum(IVA_CONDITIONS).optional(),
    email: optionalText(254),
    phone: optionalText(50),
    address: optionalText(2000),
    real_address: optionalText(2000),
    notes: optionalText(2000),
  }),
  spec: clientUpdateProposalSpec,
  prepare: async (_ctx, input) => {
    const { client: query, ...changes } = input;
    const given = Object.entries(changes).filter(([, v]) => v !== undefined);
    if (given.length === 0) {
      return issue("client", "Falta qué cambiar del cliente.");
    }
    const found = await resolveClient(query, { onlyActive: false });
    if (!found.ok) return found.result;
    const before = clientSnapshot(found.client);
    if (!before.is_fiscal) {
      const fiscal = FISCAL_ONLY_FIELDS.filter((f) => changes[f] !== undefined);
      if (fiscal.length > 0) {
        return {
          kind: "error",
          error:
            "Un cliente de Otras ventas no tiene CUIT, condición de IVA ni domicilio fiscal.",
        };
      }
    }
    // The whole ficha, as the edit form saves it, with the changes on top.
    const contact = {
      legal_name: before.legal_name,
      display_name: before.display_name,
      email: before.email,
      phone: before.phone,
      real_address: before.real_address,
      notes: before.notes,
    };
    const draft = before.is_fiscal
      ? {
          ...contact,
          cuit: before.cuit,
          iva_condition: before.iva_condition,
          address: before.address,
        }
      : contact;
    return {
      kind: "draft",
      draft: {
        ...draft,
        ...Object.fromEntries(given),
        id: found.client.id,
        before,
      },
    };
  },
  execute: async (ctx, draft) => {
    const current = await getClientByIdAction(draft.id);
    if (!current.ok) return current;
    if (!current.data) return { ok: false, error: CLIENT_NOT_FOUND };
    const now = clientSnapshot(current.data);
    const moved = CLIENT_SNAPSHOT_KEYS.some(
      (key) => (now[key] ?? null) !== (draft.before[key] ?? null),
    );
    if (moved) {
      return {
        ok: false,
        error:
          "El cliente cambió desde la propuesta (alguien lo editó). Volvé a generarla para ver los datos actuales.",
      };
    }
    const { before, ...update } = draft;
    if (!before.is_fiscal) {
      for (const f of FISCAL_ONLY_FIELDS) delete update[f];
    }
    return updateClientRecord(ctx.userId, update);
  },
});

// ─── Comprobantes ────────────────────────────────────────────────────────────

const IVA_PERCENTS = [21, 10.5, 27, 5, 2.5, 0] as const;

const ItemInput = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive().max(1_000_000).optional(),
  unit_price: z
    .number()
    .finite()
    .min(0)
    .max(999_999_999_999.99)
    .describe("Net unit price (without IVA), as the user said it."),
  iva_percent: z
    .union(IVA_PERCENTS.map((p) => z.literal(p)))
    .optional()
    .describe("IVA alícuota in percent; default 21."),
});

/** The items the model gave, as the form's item rows (21 % by default; the
 *  revenue kind the form suggests). */
function draftItems(
  items: z.output<typeof ItemInput>[],
  isFiscal: boolean,
): ComprobanteItemInput[] {
  return items.map((it) => {
    const iva_rate_id = ivaRateIdForPercent(it.iva_percent ?? 21);
    return {
      description: it.description,
      quantity: it.quantity ?? 1,
      unit_price: it.unit_price,
      iva_rate_id,
      revenue_kind: suggestRevenueKind({
        description: it.description,
        iva_rate_id: isFiscal ? iva_rate_id : null,
      }),
    };
  });
}

/** The form's «El total tiene que ser mayor a cero»: IVA never makes a zero
 *  net positive, so the net decides. */
function positiveTotal(
  items: { quantity: number; unit_price: number }[],
): boolean {
  return (
    round2(items.reduce((s, it) => s + it.quantity * it.unit_price, 0)) > 0
  );
}

export const proposeInvoice = defineAiProposal({
  name: "proposeInvoice",
  domain: "ventas",
  permission: ["invoices:issue", "clients:read"],
  sources: ["clients", "invoicing_channels", "sales_points", "invoices"],
  description:
    "Propose issuing a factura (Ventas: with CAE from AFIP) or a remito " +
    "interno (Otras ventas client) for the user to accept on a card: the " +
    "client, the items as the user said them (net unit price, quantity, IVA " +
    "%), the date (default today) and the punto de venta when there is more " +
    "than one. The server computes letter, IVA and totals; nothing is " +
    "issued until the user accepts. For NC/ND use proposeCreditDebitNote.",
  input: z.object({
    client: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .describe("Client name or CUIT, as the user said it."),
    items: z.array(ItemInput).min(1).max(30),
    fecha: isoDate.optional(),
    punto_venta: z.number().int().min(1).max(99999).optional(),
    channel: z
      .string()
      .trim()
      .max(80)
      .optional()
      .describe("Channel name or id, only when the user named one."),
    notes: optionalText(1000).describe(
      "Internal observaciones: never printed nor sent to AFIP.",
    ),
  }),
  spec: invoiceProposalSpec,
  prepare: async (_ctx, input) => {
    const found = await resolveClient(input.client);
    if (!found.ok) return found.result;
    const client = found.client;

    const channels = await listInvoicingChannelsAction();
    if (!channels.ok) return { kind: "error", error: channels.error };
    const sideChannels = channels.data.filter(
      (c) => c.is_fiscal === client.is_fiscal,
    );
    const wanted = input.channel ? norm(input.channel) : null;
    const matching = wanted
      ? sideChannels.filter(
          (c) => c.id === input.channel || norm(c.name) === wanted,
        )
      : sideChannels;
    if (matching.length === 0) {
      return {
        kind: "error",
        error: client.is_fiscal
          ? "No hay un canal de Ventas activo para emitir."
          : "No hay un canal de Otras ventas activo para emitir.",
      };
    }
    if (matching.length > 1) {
      return issue(
        "channel",
        "Hay más de un canal: ¿por cuál emito?",
        matching
          .slice(0, MAX_CANDIDATES)
          .map((c) => ({ value: c.id, label: c.name })),
      );
    }
    const channel = matching[0]!;

    const pos = await listEnabledPosAction(channel.id);
    if (!pos.ok) return { kind: "error", error: pos.error };
    const posPick =
      input.punto_venta !== undefined
        ? pos.data.find((p) => p.numero === input.punto_venta)
        : pos.data.length === 1
          ? pos.data[0]
          : undefined;
    if (!posPick) {
      if (pos.data.length === 0) {
        return {
          kind: "error",
          error: `No hay puntos de venta habilitados para ${channel.name}.`,
        };
      }
      return issue(
        "punto_venta",
        input.punto_venta !== undefined
          ? `El punto de venta ${input.punto_venta} no está habilitado para ${channel.name}.`
          : "Hay más de un punto de venta: ¿cuál uso?",
        pos.data.slice(0, MAX_CANDIDATES).map((p) => ({
          value: String(p.numero),
          label: p.nickname ? `${p.numero} · ${p.nickname}` : String(p.numero),
        })),
      );
    }

    const isFiscal = channel.is_fiscal;
    if (isFiscal && !client.iva_condition) {
      return {
        kind: "error",
        error: "Falta la condición de IVA del cliente.",
      };
    }
    const items = draftItems(input.items, isFiscal);
    if (!positiveTotal(items)) {
      return { kind: "error", error: "El total tiene que ser mayor a cero." };
    }
    // Jouve sells transport: facturas are Servicios, with the service and
    // due dates on the issue date (as the Comprobantes form).
    const fecha = input.fecha ?? todayInAR();
    return {
      kind: "draft",
      draft: {
        channel_id: channel.id,
        client_id: client.id,
        kind: "factura",
        letter:
          isFiscal && client.iva_condition
            ? letterFor(client.iva_condition)
            : null,
        punto_venta: posPick.numero,
        fecha,
        fch_serv_desde: fecha,
        fch_serv_hasta: fecha,
        fch_vto_pago: fecha,
        concepto: CONCEPTO.SERVICIOS,
        ...voucherReceptor(client),
        moneda: MONEDA.PESOS,
        cotizacion: 1,
        invoice_origin_id: null,
        motivo_nc_nd: null,
        notes: input.notes ?? null,
        items,
        // One per proposal: accepting twice returns the first comprobante.
        idempotency_key: crypto.randomUUID(),
      },
      labels: {
        [COMPROBANTE_LABELS.client]: client.legal_name,
        [COMPROBANTE_LABELS.channel]: channel.name,
      },
    };
  },
  execute: async (ctx, draft) => {
    if (draft.kind !== "factura") {
      return { ok: false, error: "Esta propuesta solo emite facturas." };
    }
    // Refused if the client's CUIT or IVA condition changed since the card.
    const res = await issueComprobante(ctx.userId, draft, {
      letter: draft.letter,
      doc_tipo: draft.doc_tipo,
      doc_nro: draft.doc_nro,
      iva_condition_receptor: draft.iva_condition_receptor,
    });
    return res.ok ? { ok: true, data: { id: res.data.id } } : res;
  },
});

export const proposeCreditDebitNote = defineAiProposal({
  name: "proposeCreditDebitNote",
  domain: "ventas",
  permission: ["invoices:issue", "credit_debit_notes:issue", "invoices:read"],
  sources: ["invoices", "invoice_items"],
  description:
    "Propose a nota de crédito (nc) or débito (nd) against an emitted " +
    "comprobante (invoice_id from getInvoices / getInvoiceDetail) for the " +
    "user to accept on a card: the reason (motivo) and the items. An NC " +
    "without items credits the whole comprobante (its items); an ND needs " +
    "them. Same letter, punto de venta and currency as the origin; the " +
    "server refuses an NC above the open balance. Nothing is issued until " +
    "the user accepts.",
  input: z.object({
    invoice_id: z.string().uuid(),
    kind: z.enum(["nc", "nd"]),
    motivo: z.string().trim().min(1).max(500),
    items: z.array(ItemInput).min(1).max(30).optional(),
    fecha: isoDate.optional(),
    notes: optionalText(1000),
  }),
  spec: creditDebitNoteProposalSpec,
  prepare: async (_ctx, input) => {
    const res = await getInvoiceDetailAction(input.invoice_id);
    if (!res.ok) return { kind: "error", error: res.error };
    const origin = res.data;
    if (!origin) {
      return { kind: "error", error: "El comprobante de origen no existe." };
    }
    if (origin.status !== "emitted" || origin.numero === null) {
      return {
        kind: "error",
        error: "El comprobante de origen no está emitido.",
      };
    }
    if (input.kind === "nc" && origin.kind === "nc") {
      return {
        kind: "error",
        error:
          "Una nota de crédito no se puede emitir sobre otra nota de crédito.",
      };
    }
    const isFiscal = origin.channel.is_fiscal;
    let items;
    if (input.items) {
      items = draftItems(input.items, isFiscal);
    } else if (input.kind === "nc" && origin.items.length > 0) {
      items = origin.items.map((it) => ({
        description: it.description,
        quantity: it.quantity,
        unit_price: it.unit_price,
        iva_rate_id: it.iva_rate_id,
        // A note on an asset sale adjusts that sale, not services.
        revenue_kind: it.revenue_kind,
      }));
    } else {
      return issue(
        "items",
        "Falta el detalle de la nota: concepto e importe neto.",
      );
    }
    if (!positiveTotal(items)) {
      return { kind: "error", error: "El total tiene que ser mayor a cero." };
    }
    const fecha = input.fecha ?? todayInAR();
    const fchServ = isServiciosConcepto(origin.concepto) ? fecha : null;
    const foreign = origin.moneda !== MONEDA.PESOS;
    return {
      kind: "draft",
      draft: {
        channel_id: origin.channel.id,
        client_id: origin.client.id,
        kind: input.kind,
        // NC/ND keep the origin's letter and punto de venta (RG 1415).
        letter: origin.letter,
        punto_venta: origin.punto_venta,
        fecha,
        fch_serv_desde: fchServ,
        fch_serv_hasta: fchServ,
        fch_vto_pago: fchServ,
        concepto: origin.concepto,
        doc_tipo: origin.doc_tipo,
        doc_nro: origin.doc_nro,
        iva_condition_receptor: origin.iva_condition_receptor,
        moneda: foreign ? MONEDA.DOLARES : MONEDA.PESOS,
        cotizacion: foreign ? origin.cotizacion : 1,
        invoice_origin_id: origin.id,
        motivo_nc_nd: input.motivo,
        notes: input.notes ?? null,
        items,
        idempotency_key: crypto.randomUUID(),
      },
      labels: {
        [COMPROBANTE_LABELS.client]: origin.client.legal_name,
        [COMPROBANTE_LABELS.channel]: origin.channel.name,
        [COMPROBANTE_LABELS.origin]: `${formatInvoiceNumero(origin.kind, origin.letter, origin.punto_venta, origin.numero)} del ${formatArgentineDate(origin.fecha)}`,
      },
    };
  },
  execute: async (ctx, draft) => {
    if (draft.kind === "factura") {
      return { ok: false, error: "Esta propuesta solo emite notas." };
    }
    const res = await issueComprobante(ctx.userId, draft);
    return res.ok ? { ok: true, data: { id: res.data.id } } : res;
  },
});

// ─── Email ───────────────────────────────────────────────────────────────────

export const proposeInvoiceEmail = defineAiProposal({
  name: "proposeInvoiceEmail",
  domain: "ventas",
  permission: ["email:send", "invoices:read"],
  sources: ["invoices", "clients", "email_send_log"],
  description:
    "Propose emailing an emitted comprobante's PDF (invoice_id from " +
    "getInvoices / getInvoiceDetail) for the user to accept on a card. The " +
    "recipient defaults to the client's email; subject defaults to " +
    "'Comprobante <número>'. Writes and sends nothing by itself.",
  input: z.object({
    invoice_id: z.string().uuid(),
    recipient: z.string().trim().max(254).optional(),
    subject: z.string().trim().max(200).optional(),
    body: z.string().max(4000).optional(),
  }),
  spec: invoiceEmailProposalSpec,
  prepare: async (_ctx, input) => {
    const detail = await getInvoiceDetailAction(input.invoice_id);
    if (!detail.ok) return { kind: "error", error: detail.error };
    if (!detail.data) {
      return { kind: "error", error: "Comprobante no encontrado." };
    }
    if (detail.data.status !== "emitted") {
      return {
        kind: "error",
        error: "Solo se pueden enviar comprobantes en estado emitido.",
      };
    }
    const defaults = await getInvoiceEmailDefaultsAction(input.invoice_id);
    if (!defaults.ok) return { kind: "error", error: defaults.error };
    const recipient = input.recipient ?? defaults.data.recipient;
    if (!recipient) {
      return issue(
        "recipient",
        "El cliente no tiene email cargado: ¿a qué dirección lo mando?",
      );
    }
    return {
      kind: "draft",
      draft: {
        invoice_id: input.invoice_id,
        recipient,
        subject: input.subject ?? defaults.data.subject,
        body: input.body ?? null,
      },
      labels: {
        [COMPROBANTE_LABELS.invoice]: defaults.data.numero_label,
        [COMPROBANTE_LABELS.client]: defaults.data.client_legal_name,
      },
    };
  },
  execute: async (ctx, draft) => {
    const res = await sendInvoiceEmail(ctx, draft);
    return res.ok
      ? {
          ok: true,
          data: { id: draft.invoice_id, note: `Enviado a ${draft.recipient}.` },
        }
      : res;
  },
});
