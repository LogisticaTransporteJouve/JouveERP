import { z } from "zod";

import { getClientAccountAction } from "@/features/clients/actions/account-actions";
import { listClientTariffsAction } from "@/features/client-tariffs/actions/client-tariffs-actions";
import { listFreightTariffsAction } from "@/features/freight-tariffs/actions/freight-tariffs-actions";
import { getSupplierAccountAction } from "@/features/suppliers/actions/account-actions";
import type { CurrencyBalances } from "@/lib/allocations";
import {
  IsoDateSchema,
  ScopeInputSchema,
  UuidSchema,
} from "@/lib/validation/common";

import { defineAiAction } from "../define";
import { type AiRunResult, errResult, money, okResult } from "../result";
import { readScope } from "../scope";

// The cuenta corriente of a client (/clients/[id]) and of a supplier
// (/suppliers/[id]): the feed of documents and payments with the running
// balance per currency, through the feature's own read (clients:read /
// suppliers:read) and its RLS.

const MOVEMENTS_DEFAULT = 50;
const MOVEMENTS_MAX = 300;

const statementShape = {
  scope: ScopeInputSchema,
  from: IsoDateSchema.nullish().describe(
    "Movimientos desde, YYYY-MM-DD (el saldo es siempre el de toda la cuenta).",
  ),
  to: IsoDateSchema.nullish().describe("Movimientos hasta, YYYY-MM-DD."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MOVEMENTS_MAX)
    .nullish()
    .describe(
      `Últimos N movimientos del rango (default ${MOVEMENTS_DEFAULT}, máx ${MOVEMENTS_MAX}).`,
    ),
};

type StatementInput = {
  from?: string | null;
  to?: string | null;
  limit?: number | null;
};

function balances(b: CurrencyBalances): string {
  return b.USD !== 0
    ? `${money(b.ARS)} + US$${Math.round(b.USD).toLocaleString("es-AR")}`
    : money(b.ARS);
}

/** The movements of the window, newest last, cut to the latest `limit`. */
export function statementWindow<T extends { movement_date: string }>(
  movements: readonly T[],
  input: StatementInput,
): { rows: T[]; inWindow: number } {
  const inWindow = movements.filter(
    (m) =>
      (!input.from || m.movement_date >= input.from) &&
      (!input.to || m.movement_date <= input.to),
  );
  const limit = input.limit ?? MOVEMENTS_DEFAULT;
  return { rows: inWindow.slice(-limit), inWindow: inWindow.length };
}

function statementResult(
  who: string,
  owes: string,
  label: string,
  data: {
    movements: readonly { movement_date: string }[];
    balances: CurrencyBalances;
    runningBalance: boolean;
  },
  input: StatementInput,
): AiRunResult {
  const { rows, inWindow } = statementWindow(data.movements, input);
  const cut = rows.length < inWindow;
  return okResult(
    `${label}: cuenta corriente de ${who} · saldo ${balances(data.balances)} (positivo = ${owes}) · ` +
      `${rows.length} de ${inWindow} movimientos del rango` +
      (cut ? " (los más recientes; pedí más con limit o acotá fechas)." : "."),
    {
      balances: data.balances,
      runningBalance: data.runningBalance,
      movements: rows,
    },
    {
      partial: cut,
      note: data.runningBalance
        ? "Saldo por moneda (pesos y dólares no se suman); balance de cada fila = saldo corrido de su moneda."
        : "Con un alcance no hay saldo corrido por fila: el saldo es lo abierto de ese alcance neto de lo pagado a cuenta.",
    },
  );
}

export const getClientAccount = defineAiAction({
  name: "getClientAccount",
  domain: "ventas",
  permission: "clients:read",
  sideEffect: "read",
  sources: [
    "v_client_account_movements",
    "receipt_allocations",
    "v_aging_documents",
  ],
  description:
    "Cuenta corriente de UN cliente por su UUID (de searchClients): facturas, NC, ND, recibos, cheques rechazados y saldo inicial en orden, con el saldo corrido por moneda, lo pendiente de cada documento y lo cobrado a cuenta; y el saldo actual por moneda. Filtrable por fechas (el saldo es siempre el total). Alcance opcional (fiscal/internal/all).",
  input: z.object({
    clientId: UuidSchema.describe("UUID del cliente."),
    ...statementShape,
  }),
  run: async (_ctx, input) => {
    const { isFiscal, label } = readScope(input.scope);
    const res = await getClientAccountAction(input.clientId, { isFiscal });
    if (!res.ok) return errResult(res.error);
    return statementResult("el cliente", "nos debe", label, res.data, input);
  },
});

export const getSupplierAccount = defineAiAction({
  name: "getSupplierAccount",
  domain: "compras",
  permission: "suppliers:read",
  sideEffect: "read",
  sources: [
    "v_supplier_account_movements",
    "payment_order_allocations",
    "v_purchase_invoice_open",
  ],
  description:
    "Cuenta corriente de UN proveedor por su UUID (de searchSuppliers): facturas de compra, NC, ND, órdenes de pago, cheques rechazados y saldo inicial en orden, con el saldo corrido por moneda, lo pendiente de cada documento y lo pagado a cuenta; y el saldo actual por moneda. Filtrable por fechas (el saldo es siempre el total). Alcance opcional (fiscal/internal/all).",
  input: z.object({
    supplierId: UuidSchema.describe("UUID del proveedor."),
    ...statementShape,
  }),
  run: async (_ctx, input) => {
    const { isFiscal, label } = readScope(input.scope);
    const res = await getSupplierAccountAction(input.supplierId, { isFiscal });
    if (!res.ok) return errResult(res.error);
    return statementResult(
      "el proveedor",
      "le debemos",
      label,
      res.data,
      input,
    );
  },
});

export const getClientTariffs = defineAiAction({
  name: "getClientTariffs",
  domain: "deposito",
  permission: "storage_billing:read",
  sideEffect: "read",
  sources: ["client_tariffs"],
  description:
    "Tarifario propio de UN cliente (de su ficha) por su UUID: concepto, precio, moneda y vigencia, la más nueva primero.",
  input: z.object({ clientId: UuidSchema.describe("UUID del cliente.") }),
  run: async (_ctx, input) => {
    const res = await listClientTariffsAction(input.clientId);
    if (!res.ok) return errResult(res.error);
    return okResult(`${res.data.length} tarifas del cliente.`, res.data);
  },
});

export const getFreightTariffs = defineAiAction({
  name: "getFreightTariffs",
  domain: "flota",
  permission: "freight_tariffs:read",
  sideEffect: "read",
  sources: [
    "freight_tariff_lists",
    "freight_tariff_versions",
    "freight_tariff_lines",
  ],
  description:
    "Tarifas de flete de Flota › Tarifas (referencia, no las usan las cargas): cada tarifario (general, consumidor final, muebles, clientes con tarifa propia) con sus períodos, el más nuevo primero, el aumento % de cada uno sobre el anterior y sus líneas (sección, concepto, precio en pesos o porcentaje, nota). Para '¿cuánto sale el flete de 2 pallets?' o '¿cuánto aumentamos en noviembre?'.",
  input: z.object({}),
  run: async () => {
    const res = await listFreightTariffsAction();
    if (!res.ok) return errResult(res.error);
    return okResult(`${res.data.length} tarifarios de flete.`, res.data);
  },
});
