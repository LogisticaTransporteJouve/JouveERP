import { z } from "zod";

import { formatMoney, round2 } from "@/lib/format";
import { IsoDateSchema } from "@/lib/validation/common";

/** Mirrors driver_settlements.status. */
export const DRIVER_SETTLEMENT_STATUSES = [
  "draft",
  "confirmed",
  "cancelled",
] as const;
export type DriverSettlementStatus =
  (typeof DRIVER_SETTLEMENT_STATUSES)[number];

export const DRIVER_SETTLEMENT_STATUS_LABELS: Record<
  DriverSettlementStatus,
  string
> = {
  draft: "Borrador",
  confirmed: "Confirmada",
  cancelled: "Cancelada",
};

export function isDriverSettlementStatus(
  v: unknown,
): v is DriverSettlementStatus {
  return (
    typeof v === "string" &&
    (DRIVER_SETTLEMENT_STATUSES as readonly string[]).includes(v)
  );
}

/** "N° 12", or "Borrador" before confirmation. */
export function formatDriverSettlementNumber(numero: number | null): string {
  return numero === null ? "Borrador" : `N° ${numero}`;
}

/** What the driver handed in against what they had to collect: positive =
 *  handed in more, negative = short. */
export function settlementDifference(
  expected: number,
  received: number,
): number {
  // `|| 0` turns a rounded -0 into 0.
  return round2(received - expected) || 0;
}

export interface DriverSettlement {
  id: string;
  numero: number | null;
  driver_id: string;
  driver_name: string;
  settlement_date: string;
  status: DriverSettlementStatus;
  notes: string | null;
  expected_total: number;
  received_total: number;
  difference: number;
  cargas: number;
  /** Receipts it posted (confirmed), with their status. `mismatch`: the
   *  receipt's total no longer equals what the rendición posted on it (it
   *  was edited in Recibos). */
  receipts: {
    id: string;
    label: string;
    canceled: boolean;
    mismatch: boolean;
  }[];
  /** A confirmed rendición whose receipts were cancelled or edited in
   *  Recibos: what it shows no longer matches the books. */
  receipts_out_of_sync: boolean;
  /** Who bears the difference: the driver (his employee account) or the
   *  client (it stays open in the client's account). Null = not resolved. */
  difference_charged_to: DifferenceChargedTo | null;
  /** The difference posted to the driver's employee account, if any. */
  difference_posted: {
    id: string;
    kind: DifferencePostedKind;
    amount: number;
  } | null;
  /** The driver's employee (the account the difference posts to). */
  driver_employee_id: string | null;
  created_at: string;
}

/** A page of rendiciones, newest first. */
export interface DriverSettlementsPage {
  settlements: DriverSettlement[];
  nextOffset: number | null;
}

export const DRIVER_SETTLEMENTS_PAGE_SIZE = 25;

export const DriverSettlementsPageSchema = z.object({
  offset: z.number().int().min(0).max(1_000_000),
  limit: z.number().int().min(1).max(100),
});

/** Out of sync: a receipt cancelled, or its total changed, in Recibos while
 *  the rendición stays confirmed. */
export function receiptsOutOfSync(
  status: DriverSettlementStatus,
  receipts: readonly { canceled: boolean; mismatch: boolean }[],
): boolean {
  return (
    status === "confirmed" && receipts.some((r) => r.canceled || r.mismatch)
  );
}

export interface DriverSettlementLine {
  id: string;
  account_id: string;
  account_name: string;
  account_type: string;
  amount: number;
  reference: string | null;
  check_number: string | null;
  bank_name: string | null;
  drawer_name: string | null;
  check_due_date: string | null;
}

export interface DriverSettlementItem {
  id: string;
  shipment_id: string;
  remito_number: string | null;
  client_name: string;
  delivery_date: string | null;
  origin: string | null;
  destination: string | null;
  expected_amount: number;
  note: string | null;
  lines: DriverSettlementLine[];
}

export interface DriverSettlementDetail extends DriverSettlement {
  items: DriverSettlementItem[];
}

/** A delivered cash-on-delivery carga not yet in a live rendición. */
export interface CodPendingShipment {
  shipment_id: string;
  driver_id: string | null;
  driver_name: string | null;
  remito_number: string | null;
  client_name: string;
  delivery_date: string | null;
  origin: string | null;
  destination: string | null;
  cod_amount: number;
}

/** Per driver: cargas still to hand in and draft rendiciones. */
export interface CodPendingByDriver {
  driver_id: string | null;
  driver_name: string;
  cargas: number;
  amount: number;
  drafts: number;
}

export interface CodPending {
  shipments: CodPendingShipment[];
  byDriver: CodPendingByDriver[];
}

/** Active ARS accounts a rendición can post to. */
export interface SettlementAccount {
  id: string;
  name: string;
  type: string;
}

/** Groups pending cargas and draft counts per driver (no driver last). */
export function groupPendingByDriver(
  shipments: readonly CodPendingShipment[],
  drafts: readonly { driver_id: string; driver_name: string }[],
): CodPendingByDriver[] {
  const map = new Map<string, CodPendingByDriver>();
  const keyOf = (id: string | null) => id ?? "";
  for (const s of shipments) {
    const key = keyOf(s.driver_id);
    const row = map.get(key) ?? {
      driver_id: s.driver_id,
      driver_name: s.driver_name ?? "Sin chofer",
      cargas: 0,
      amount: 0,
      drafts: 0,
    };
    row.cargas += 1;
    row.amount = round2(row.amount + s.cod_amount);
    map.set(key, row);
  }
  for (const d of drafts) {
    const row = map.get(d.driver_id) ?? {
      driver_id: d.driver_id,
      driver_name: d.driver_name,
      cargas: 0,
      amount: 0,
      drafts: 0,
    };
    row.drafts += 1;
    map.set(d.driver_id, row);
  }
  return [...map.values()].sort((a, b) => {
    if (a.driver_id === null) return 1;
    if (b.driver_id === null) return -1;
    return a.driver_name.localeCompare(b.driver_name, "es");
  });
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

const optionalDate = z
  .union([z.literal(""), IsoDateSchema])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const DriverSettlementLineSchema = z.object({
  account_id: z.string().uuid("Elegí una cuenta."),
  amount: z.coerce
    .number({ message: "Importe inválido." })
    .positive("El importe tiene que ser mayor a 0.")
    .max(999_999_999_999.99, "Importe demasiado alto."),
  reference: optionalText(120),
  check_number: optionalText(60),
  bank_name: optionalText(120),
  drawer_name: optionalText(160),
  drawer_cuit: optionalText(20),
  check_issue_date: optionalDate,
  check_due_date: optionalDate,
});

export const DriverSettlementItemSchema = z.object({
  shipment_id: z.string().uuid(),
  note: optionalText(500),
  /** Empty = the driver handed in nothing for this carga. */
  lines: z
    .array(DriverSettlementLineSchema)
    .max(10, "Hasta 10 pagos por carga."),
});
export type DriverSettlementItemInput = z.input<
  typeof DriverSettlementItemSchema
>;

export const DriverSettlementSaveSchema = z
  .object({
    id: z.string().uuid().nullable().optional(),
    driver_id: z.string().uuid("Elegí un chofer."),
    settlement_date: IsoDateSchema,
    notes: optionalText(1000),
    items: z
      .array(DriverSettlementItemSchema)
      .min(1, "Elegí al menos una carga.")
      .max(300, "Hasta 300 cargas por rendición."),
  })
  .superRefine((d, ctx) => {
    const seen = new Set<string>();
    for (const item of d.items) {
      if (seen.has(item.shipment_id)) {
        ctx.addIssue({
          code: "custom",
          message: "Una carga está dos veces en la rendición.",
          path: ["items"],
        });
        return;
      }
      seen.add(item.shipment_id);
    }
  });
export type DriverSettlementSaveInput = z.input<
  typeof DriverSettlementSaveSchema
>;

export const DriverSettlementIdSchema = z.object({ id: z.string().uuid() });

const settlementTotal = z.number().finite().min(0).max(999_999_999_999.99);

/** Confirming a draft at the totals it showed (an assistant proposal): the
 *  confirm is refused if what the driver had to collect or handed in is
 *  another amount by then. */
export const DriverSettlementConfirmSchema = DriverSettlementIdSchema.extend({
  expected_total: settlementTotal,
  received_total: settlementTotal,
});

/** Mirrors driver_settlements.difference_charged_to. */
export const DIFFERENCE_CHARGED_TO = ["driver", "client"] as const;
export type DifferenceChargedTo = (typeof DIFFERENCE_CHARGED_TO)[number];

export function isDifferenceChargedTo(v: unknown): v is DifferenceChargedTo {
  return (
    typeof v === "string" &&
    (DIFFERENCE_CHARGED_TO as readonly string[]).includes(v)
  );
}

/** The employee_account_movements kinds a rendición's difference posts:
 *  `advance` = a shortfall that also settled the client with a receipt;
 *  `charge` (shortfall) or `payment` (overage) = posted to the driver only,
 *  before 20261104095300. */
export const DIFFERENCE_POSTED_KINDS = [
  "advance",
  "charge",
  "payment",
] as const;
export type DifferencePostedKind = (typeof DIFFERENCE_POSTED_KINDS)[number];

export function isDifferencePostedKind(v: unknown): v is DifferencePostedKind {
  return (
    typeof v === "string" &&
    (DIFFERENCE_POSTED_KINDS as readonly string[]).includes(v)
  );
}

/** Who bears a resolved difference, in words (detail dialog and PDF). */
export function differenceNote(
  chargedTo: DifferenceChargedTo | null,
  posted: { kind: DifferencePostedKind; amount: number } | null,
): string | null {
  if (posted) {
    const what =
      posted.kind === "payment" ? "Sobrante acreditado" : "Faltante cargado";
    const tail =
      posted.kind === "advance" ? ", con un recibo que saldó al cliente." : ".";
    return `${what} en la cuenta corriente del chofer: ${formatMoney(posted.amount)}${tail}`;
  }
  if (chargedTo === "client") {
    return "Diferencia a cargo del cliente: queda en su cuenta corriente.";
  }
  return null;
}

export const DriverSettlementDifferenceSchema = z.object({
  id: z.string().uuid(),
  charged_to: z.enum(DIFFERENCE_CHARGED_TO),
});
export type DriverSettlementDifferenceInput = z.infer<
  typeof DriverSettlementDifferenceSchema
>;
