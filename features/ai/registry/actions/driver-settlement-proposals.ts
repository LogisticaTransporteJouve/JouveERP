import { z } from "zod";

import { isAccountType, isCheckAccount } from "@/features/accounts/schema";
import {
  getDriverSettlementAction,
  listCodPendingAction,
  listDriverSettlementAccountsAction,
} from "@/features/driver-settlements/actions/driver-settlements-actions";
import {
  CHARGE_DRIVER_DENIED,
  CHARGE_DRIVER_PERMISSIONS,
} from "@/features/driver-settlements/lib/charge-driver";
import {
  DIFFERENCE_CHARGED_TO,
  formatDriverSettlementNumber,
  type CodPendingShipment,
  type SettlementAccount,
} from "@/features/driver-settlements/schema";
import { userCanAll } from "@/lib/auth/permissions";
import {
  confirmDriverSettlement,
  postDriverSettlementDifference,
  saveDriverSettlement,
} from "@/lib/commands/driver-settlements";
import {
  formatArgentineDate,
  formatMoney,
  round2,
  todayInAR,
} from "@/lib/format";
import { IsoDateSchema, UuidSchema } from "@/lib/validation/common";

import {
  DRIVER_SETTLEMENT_LABELS,
  driverSettlementConfirmProposalSpec,
  driverSettlementDifferenceProposalSpec,
  driverSettlementProposalSpec,
} from "../../lib/proposal-specs";
import { defineAiProposal, type AiPrepareResult } from "../propose";

import { refKey } from "./fleet-refs";
import { MAX_CANDIDATES } from "./resolve-client";
import { ask, pick } from "./treasury-refs";

// Tesorería: rendiciones de chofer (cobranza contra entrega), proposed on a
// card and written on accept through lib/commands/driver-settlements, the
// commands the Rendiciones dialogs run. What the driver had to collect is
// always the server's (each carga's contra-entrega amount); what he handed
// in, and where, is asked when the user did not say it.

const MONEY_MAX = 999_999_999_999.99;

function cargaLabel(s: CodPendingShipment): string {
  return [
    s.remito_number ? `Remito ${s.remito_number}` : "Sin remito",
    s.client_name,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The pending carga a reference names: its id or its remito number. */
function findCarga(
  pending: readonly CodPendingShipment[],
  said: string,
): CodPendingShipment | undefined {
  const byId = pending.find((s) => s.shipment_id === said.trim());
  if (byId) return byId;
  const key = refKey(said);
  const matches = pending.filter(
    (s) => s.remito_number !== null && refKey(s.remito_number) === key,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function cargaOptions(pending: readonly CodPendingShipment[]) {
  return pending.slice(0, MAX_CANDIDATES).map((s) => ({
    value: s.remito_number ?? s.shipment_id,
    label: `${cargaLabel(s)} · ${formatMoney(s.cod_amount)}`,
  }));
}

/** The account the cash went to: the one named, or the only cash account.
 *  A check account needs number, bank and due date: that is the form's. */
function resolveSettlementAccount(
  accounts: readonly SettlementAccount[],
  said: string | undefined,
):
  | { ok: true; account: SettlementAccount }
  | { ok: false; result: AiPrepareResult } {
  const isCheck = (a: SettlementAccount) =>
    isAccountType(a.type) && isCheckAccount(a.type);
  const usable = accounts.filter((a) => !isCheck(a));
  const options = (list: readonly SettlementAccount[]) =>
    list.map((a) => ({ value: a.name, label: a.name }));
  if (said?.trim()) {
    const found = pick(said, accounts, (a) => [a.name]);
    if ("one" in found) {
      if (isCheck(found.one)) {
        return {
          ok: false,
          result: {
            kind: "error",
            error:
              "Los cheques se cargan desde la rendición: llevan número, banco y fecha de pago.",
          },
        };
      }
      return { ok: true, account: found.one };
    }
    return {
      ok: false,
      result: ask(
        "account",
        found.many.length === 0
          ? `No hay una cuenta en pesos activa que coincida con "${said}".`
          : `"${said}" coincide con varias cuentas.`,
        options(found.many.length ? found.many : usable),
      ),
    };
  }
  const cash = usable.filter((a) => a.type === "cash");
  if (cash.length === 1 && cash[0]) return { ok: true, account: cash[0] };
  return {
    ok: false,
    result: ask(
      "account",
      usable.length === 0
        ? "No hay una cuenta en pesos activa donde asentar lo cobrado."
        : "¿En qué cuenta entró lo que entregó el chofer?",
      options(usable),
    ),
  };
}

// ─── Save a draft ────────────────────────────────────────────────────────────

export const proposeDriverSettlement = defineAiProposal({
  name: "proposeDriverSettlement",
  domain: "tesoreria",
  permission: ["receipts:write", "receipts:read"],
  sources: [
    "driver_settlements",
    "driver_settlement_items",
    "driver_settlement_lines",
    "shipments",
    "accounts",
  ],
  description:
    "Propose a rendición de chofer draft (what a driver handed in for the " +
    "cash-on-delivery cargas he delivered) for the user to accept on a " +
    "card: the driver, the date (default today), which pending cargas " +
    "(remito numbers; default all of his) and what he handed in — " +
    "all_collected when he handed in everything, received_total for a " +
    "total, or items per carga — and the ARS account it went to. The " +
    "amounts he had to collect come from the server; whatever the user did " +
    "not say is asked, never assumed. Checks are loaded on the rendición " +
    "itself. It stays a draft; proposeDriverSettlementConfirm confirms it.",
  input: z.object({
    driver: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Driver name or driver_id, as the user said it."),
    settlement_date: IsoDateSchema.optional(),
    shipments: z
      .array(z.string().trim().min(1).max(80))
      .min(1)
      .max(300)
      .optional()
      .describe("Remito numbers (or shipment ids) to include; omit for all."),
    all_collected: z
      .boolean()
      .optional()
      .describe("True when the user said he handed in everything."),
    received_total: z
      .number()
      .finite()
      .min(0)
      .max(MONEY_MAX)
      .optional()
      .describe("What he handed in, in total, when the user said an amount."),
    items: z
      .array(
        z.object({
          shipment: z.string().trim().min(1).max(80),
          amount: z.number().finite().min(0).max(MONEY_MAX),
        }),
      )
      .min(1)
      .max(300)
      .optional()
      .describe("What he handed in per carga (0 = nothing), when given."),
    account: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe("ARS account it went to (e.g. Caja), when the user named one."),
    notes: z.string().trim().min(1).max(1000).optional(),
  }),
  spec: driverSettlementProposalSpec,
  prepare: async (_ctx, input) => {
    const pendingRes = await listCodPendingAction();
    if (!pendingRes.ok) return { kind: "error", error: pendingRes.error };
    const drivers = pendingRes.data.byDriver.filter(
      (d): d is typeof d & { driver_id: string } =>
        d.driver_id !== null && d.cargas > 0,
    );
    const said = input.driver.trim();
    const byId = drivers.find((d) => d.driver_id === said);
    const found = byId
      ? { one: byId }
      : pick(said, drivers, (d) => [d.driver_name]);
    if (!("one" in found)) {
      return ask(
        "driver",
        found.many.length === 0
          ? `"${said}" no tiene cargas contra entrega pendientes de rendir.`
          : `"${said}" coincide con varios choferes.`,
        (found.many.length ? found.many : drivers)
          .slice(0, MAX_CANDIDATES)
          .map((d) => ({
            value: d.driver_name,
            label: `${d.driver_name} · ${d.cargas} cargas · ${formatMoney(d.amount)}`,
          })),
      );
    }
    const driver = found.one;
    const pending = pendingRes.data.shipments.filter(
      (s) => s.driver_id === driver.driver_id,
    );

    // Which cargas: the ones named (per carga amounts name them too), or all.
    const named = input.items?.map((i) => i.shipment) ?? input.shipments;
    const selected: CodPendingShipment[] = [];
    for (const ref of named ?? []) {
      const carga = findCarga(pending, ref);
      if (!carga) {
        return ask(
          "shipments",
          `"${ref}" no es una carga contra entrega pendiente de ${driver.driver_name}.`,
          cargaOptions(pending),
        );
      }
      if (!selected.includes(carga)) selected.push(carga);
    }
    const cargas = named ? selected : pending;
    const expected = round2(cargas.reduce((t, s) => t + s.cod_amount, 0));

    // What he handed in per carga.
    let received: Map<string, number>;
    if (input.items) {
      received = new Map();
      for (const item of input.items) {
        const carga = findCarga(pending, item.shipment);
        if (carga) received.set(carga.shipment_id, round2(item.amount));
      }
    } else if (
      input.all_collected ||
      (input.received_total !== undefined &&
        round2(input.received_total) === expected)
    ) {
      received = new Map(cargas.map((s) => [s.shipment_id, s.cod_amount]));
    } else if (input.received_total !== undefined && cargas.length === 1) {
      received = new Map(
        cargas.map((s) => [s.shipment_id, round2(input.received_total ?? 0)]),
      );
    } else {
      return {
        kind: "issues",
        issues: [
          {
            field: "items",
            message:
              input.received_total !== undefined
                ? `Entregó ${formatMoney(input.received_total)} y tenía que cobrar ${formatMoney(expected)} en ${cargas.length} cargas: ¿cuánto por cada carga?`
                : `¿Cuánto entregó? Tenía que cobrar ${formatMoney(expected)} en ${cargas.length === 1 ? "1 carga" : `${cargas.length} cargas`}.`,
          },
        ],
        candidates: [{ field: "items", options: cargaOptions(cargas) }],
      };
    }

    const anyIn = [...received.values()].some((v) => v > 0);
    let account: SettlementAccount | null = null;
    if (anyIn) {
      const accounts = await listDriverSettlementAccountsAction();
      if (!accounts.ok) return { kind: "error", error: accounts.error };
      const picked = resolveSettlementAccount(accounts.data, input.account);
      if (!picked.ok) return picked.result;
      account = picked.account;
    }

    return {
      kind: "draft",
      draft: {
        id: null,
        driver_id: driver.driver_id,
        settlement_date: input.settlement_date ?? todayInAR(),
        notes: input.notes ?? null,
        items: cargas.map((s) => {
          const amount = received.get(s.shipment_id) ?? 0;
          return {
            shipment_id: s.shipment_id,
            note: null,
            lines:
              account && amount > 0 ? [{ account_id: account.id, amount }] : [],
          };
        }),
      },
      labels: {
        [driver.driver_id]: driver.driver_name,
        ...Object.fromEntries(
          cargas.map((s) => [
            s.shipment_id,
            `${cargaLabel(s)} (cobra ${formatMoney(s.cod_amount)})`,
          ]),
        ),
        ...(account ? { [account.id]: account.name } : {}),
        [DRIVER_SETTLEMENT_LABELS.expected]: String(expected),
        ...(driver.drafts > 0
          ? { [DRIVER_SETTLEMENT_LABELS.drafts]: String(driver.drafts) }
          : {}),
      },
    };
  },
  execute: (ctx, draft) => saveDriverSettlement(ctx.userId, draft),
});

// ─── Confirm ─────────────────────────────────────────────────────────────────

export const proposeDriverSettlementConfirm = defineAiProposal({
  name: "proposeDriverSettlementConfirm",
  domain: "tesoreria",
  permission: ["receipts:write", "receipts:read"],
  sources: [
    "driver_settlements",
    "driver_settlement_items",
    "driver_settlement_lines",
    "receipts",
  ],
  description:
    "Propose confirming a rendición de chofer draft (settlement_id from " +
    "getDriverSettlements) for the user to accept on a card: it shows what " +
    "the driver had to collect and handed in, and confirming posts one " +
    "receipt per client and channel applied to each carga's invoice. A " +
    "difference is resolved afterwards with " +
    "proposeDriverSettlementDifference. Writes nothing by itself.",
  input: z.object({ settlement_id: UuidSchema }),
  spec: driverSettlementConfirmProposalSpec,
  prepare: async (_ctx, input) => {
    const res = await getDriverSettlementAction(input.settlement_id);
    if (!res.ok) return { kind: "error", error: res.error };
    const s = res.data;
    if (s.status !== "draft") {
      return {
        kind: "error",
        error:
          s.status === "confirmed"
            ? "La rendición ya está confirmada."
            : "La rendición está cancelada.",
      };
    }
    if (s.items.length === 0) {
      return { kind: "error", error: "La rendición no tiene cargas." };
    }
    return {
      kind: "draft",
      draft: {
        id: s.id,
        expected_total: s.expected_total,
        received_total: s.received_total,
      },
      labels: {
        [DRIVER_SETTLEMENT_LABELS.driver]: s.driver_name,
        [DRIVER_SETTLEMENT_LABELS.date]: formatArgentineDate(s.settlement_date),
        [DRIVER_SETTLEMENT_LABELS.cargas]: String(s.items.length),
      },
    };
  },
  execute: async (ctx, draft) => {
    const res = await confirmDriverSettlement(ctx.userId, draft.id, draft);
    if (!res.ok) return res;
    const n = res.data.receiptIds.length;
    return {
      ok: true,
      data: { id: draft.id, note: n === 1 ? "1 recibo" : `${n} recibos` },
    };
  },
});

// ─── Difference ──────────────────────────────────────────────────────────────

export const proposeDriverSettlementDifference = defineAiProposal({
  name: "proposeDriverSettlementDifference",
  domain: "tesoreria",
  permission: ["receipts:write", "receipts:read"],
  sources: ["driver_settlements", "employee_account_movements", "receipts"],
  description:
    "Propose resolving a confirmed rendición's difference (settlement_id " +
    "from getDriverSettlements) for the user to accept on a card: " +
    "charged_to driver (a faltante settles the client with a receipt and " +
    "goes to the driver's employee account as an advance) or client (it " +
    "stays in the client's account). Omit charged_to unless the user said " +
    "who bears it: the proposal asks. Writes nothing by itself.",
  input: z.object({
    settlement_id: UuidSchema,
    charged_to: z.enum(DIFFERENCE_CHARGED_TO).optional(),
  }),
  spec: driverSettlementDifferenceProposalSpec,
  prepare: async (ctx, input) => {
    const res = await getDriverSettlementAction(input.settlement_id);
    if (!res.ok) return { kind: "error", error: res.error };
    const s = res.data;
    if (s.status !== "confirmed") {
      return {
        kind: "error",
        error: "Solo se resuelve la diferencia de una rendición confirmada.",
      };
    }
    if (s.difference === 0) {
      return {
        kind: "error",
        error: "La rendición no tiene diferencia: no hay nada que asentar.",
      };
    }
    if (s.difference_charged_to || s.difference_posted) {
      const who =
        (s.difference_charged_to ?? "driver") === "driver"
          ? "del chofer"
          : "del cliente";
      return {
        kind: "error",
        error: `La diferencia ya quedó a cargo ${who}.`,
      };
    }
    if (s.receipts_out_of_sync) {
      return {
        kind: "error",
        error:
          "Un recibo de la rendición se anuló o se editó en Recibos: revisala antes de asentar la diferencia.",
      };
    }

    // Why the driver cannot bear it, if he cannot.
    const notDriver =
      s.difference > 0
        ? "El sobrante ya quedó a cuenta del cliente en su recibo: solo puede quedar a cargo del cliente."
        : s.driver_employee_id === null
          ? `${s.driver_name} es un chofer contratado, sin legajo: no tiene cuenta corriente. Solo puede quedar a cargo del cliente.`
          : !userCanAll(ctx.access, CHARGE_DRIVER_PERMISSIONS)
            ? CHARGE_DRIVER_DENIED
            : null;
    let chargedTo = input.charged_to;
    if (chargedTo === "driver" && notDriver) {
      return { kind: "error", error: notDriver };
    }
    if (!chargedTo) {
      if (notDriver) {
        chargedTo = "client";
      } else {
        return ask(
          "charged_to",
          `${s.driver_name} entregó de menos ${formatMoney(-s.difference)}: ¿queda a cargo del chofer o del cliente?`,
          [
            {
              value: "driver",
              label: "Del chofer: adelanto en su cuenta corriente",
            },
            { value: "client", label: "Del cliente: queda en su cuenta" },
          ],
        );
      }
    }
    return {
      kind: "draft",
      draft: { id: s.id, charged_to: chargedTo },
      labels: {
        [DRIVER_SETTLEMENT_LABELS.settlement]: `${formatDriverSettlementNumber(s.numero)} · ${s.driver_name} · ${formatArgentineDate(s.settlement_date)}`,
        [DRIVER_SETTLEMENT_LABELS.difference]: String(s.difference),
        [DRIVER_SETTLEMENT_LABELS.driver]: s.driver_name,
      },
    };
  },
  execute: async (ctx, draft) => {
    if (
      draft.charged_to === "driver" &&
      !userCanAll(ctx.access, CHARGE_DRIVER_PERMISSIONS)
    ) {
      return { ok: false, error: CHARGE_DRIVER_DENIED };
    }
    const res = await postDriverSettlementDifference(ctx.userId, draft);
    return res.ok ? { ok: true, data: { id: draft.id } } : res;
  },
});
