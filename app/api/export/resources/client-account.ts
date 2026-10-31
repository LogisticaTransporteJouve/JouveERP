import "server-only";

import {
  getClientAccountAction,
  type AccountMovement,
} from "@/features/clients/actions/account-actions";
import { formatInvoiceNumero } from "@/features/invoices/schema";

import {
  ACCOUNT_COLUMNS,
  accountStatementTable,
  exportScope,
  ExportInputError,
  inRange,
  scopedSubtitle,
  type Exporter,
  withSlug,
} from "../shared";

function clientType(m: AccountMovement): string {
  if (m.source_type === "opening_balance") return "Ajuste de saldo";
  if (m.source_type === "receipt") return "Recibo";
  if (m.source_type === "rejected_check") return "Cheque rechazado";
  if (m.kind === "factura") return `Factura${m.letter ? " " + m.letter : ""}`;
  if (m.kind === "nc") return "Nota de Crédito";
  if (m.kind === "nd") return "Nota de Débito";
  return m.kind;
}

function clientDoc(m: AccountMovement): string {
  if (m.source_type === "opening_balance") return "—";
  if (m.punto_venta == null || m.numero == null) return "—";
  if (m.source_type === "receipt" || m.source_type === "rejected_check") {
    const pos = String(m.punto_venta).padStart(5, "0");
    return `R${pos}-${String(m.numero).padStart(8, "0")}`;
  }
  return formatInvoiceNumero(m.kind, m.letter, m.punto_venta, m.numero);
}

export const clientAccount: Exporter = {
  permission: "clients:read",
  load: async (params, range) => {
    const { scope, isFiscal } = exportScope(params);
    const clientId = params.get("clientId");
    if (!clientId) throw new ExportInputError("Missing client.");
    const res = await getClientAccountAction(clientId, { isFiscal });
    if (!res.ok) throw new Error(res.error);
    const movements = res.data.movements.filter((m) =>
      inRange(m.movement_date, range),
    );
    // Under a scope rows carry no running balance: the totals are the scope's.
    const table = accountStatementTable(
      movements.map((m) => ({
        date: m.movement_date,
        type: clientType(m),
        document: clientDoc(m),
        currency: m.currency,
        debe: m.signed_amount > 0 ? m.gross_amount : 0,
        haber: m.signed_amount > 0 ? 0 : m.gross_amount,
        balance: m.balance,
      })),
      res.data.balances,
    );
    return {
      title: "Cuenta corriente — Cliente",
      subtitle: scopedSubtitle(scope, params.get("name") ?? undefined),
      columns: ACCOUNT_COLUMNS,
      ...table,
      fileName: withSlug("cuenta-corriente-cliente", params.get("name")),
    };
  },
};
