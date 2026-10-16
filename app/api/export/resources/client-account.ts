import "server-only";

import {
  getClientAccountAction,
  type AccountMovement,
} from "@/features/clients/actions/account-actions";

import {
  ACCOUNT_COLUMNS,
  dateCell,
  inRange,
  moneyCell,
  type Exporter,
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
  const pos = String(m.punto_venta).padStart(4, "0");
  const num = String(m.numero).padStart(8, "0");
  if (m.source_type === "receipt") return `R${pos}-${num}`;
  if (m.kind === "factura") return `${m.letter ?? ""}${pos}-${num}`;
  if (m.kind === "nc") return `NC${pos}-${num}`;
  if (m.kind === "nd") return `ND${pos}-${num}`;
  return `${pos}-${num}`;
}

export const clientAccount: Exporter = {
  permission: "clients:read",
  load: async (params, range) => {
    const clientId = params.get("clientId");
    if (!clientId) throw new Error("Missing client.");
    const res = await getClientAccountAction(clientId);
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
        moneyCell(m.balance),
      ];
    });
    const finalBalance = movements.length
      ? movements[movements.length - 1]!.balance
      : res.data.balance;
    return {
      title: "Cuenta corriente — Cliente",
      subtitle: params.get("name") ?? undefined,
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
      fileName: "cuenta-corriente-cliente",
    };
  },
};
