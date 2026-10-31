import "server-only";

import {
  getClientAccountAction,
  type AccountMovement,
} from "@/features/clients/actions/account-actions";
import { formatInvoiceNumero } from "@/features/invoices/schema";

import {
  ACCOUNT_COLUMNS,
  dateCell,
  exportScope,
  ExportInputError,
  inRange,
  moneyCell,
  scopedSubtitle,
  type Exporter,
  withSlug,
} from "../shared";

function clientType(m: AccountMovement): string {
  if (m.source_type === "opening_balance") return "Ajuste de saldo";
  if (m.source_type === "receipt") return "Recibo";
  if (m.kind === "factura") return `Factura${m.letter ? " " + m.letter : ""}`;
  if (m.kind === "nc") return "Nota de Crédito";
  if (m.kind === "nd") return "Nota de Débito";
  return m.kind;
}

function clientDoc(m: AccountMovement): string {
  if (m.source_type === "opening_balance") return "—";
  if (m.punto_venta == null || m.numero == null) return "—";
  if (m.source_type === "receipt") {
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
    let totalDebe = 0;
    let totalHaber = 0;
    const rows = movements.map((m) => {
      const isDebit = m.signed_amount > 0;
      if (isDebit) totalDebe += m.gross_amount;
      else totalHaber += m.gross_amount;
      return [
        dateCell(m.movement_date),
        clientType(m),
        clientDoc(m),
        isDebit ? moneyCell(m.gross_amount) : "",
        isDebit ? "" : moneyCell(m.gross_amount),
        m.balance === null ? "" : moneyCell(m.balance),
      ];
    });
    // Under a scope rows carry no running balance: the total is the scope's.
    const finalBalance = movements.at(-1)?.balance ?? res.data.balance;
    return {
      title: "Cuenta corriente — Cliente",
      subtitle: scopedSubtitle(scope, params.get("name") ?? undefined),
      columns: ACCOUNT_COLUMNS,
      rows,
      totalsRow: [
        "",
        "",
        "Totales",
        moneyCell(totalDebe),
        moneyCell(totalHaber),
        moneyCell(finalBalance),
      ],
      fileName: withSlug("cuenta-corriente-cliente", params.get("name")),
    };
  },
};
