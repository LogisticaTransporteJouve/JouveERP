import "server-only";

import {
  getClientAccountAction,
  type AccountMovement,
} from "@/features/clients/actions/account-actions";
import {
  getSupplierAccountAction,
  type SupplierAccountMovement,
} from "@/features/suppliers/actions/account-actions";
import type { Permission } from "@/lib/auth/permissions";
import { formatArgentineDate, formatNumber2 } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";

const money = (n: number) => `$${formatNumber2(n)}`;

export type ExportRange = { from: string | null; to: string | null };

export type ExportOutput = {
  title: string;
  subtitle?: string;
  columns: TableReportColumn[];
  rows: string[][];
  totalsRow?: string[];
  orientation?: "portrait" | "landscape";
  /** Base file name (without extension). */
  fileName: string;
};

export type Exporter = {
  permission: Permission;
  load: (params: URLSearchParams, range: ExportRange) => Promise<ExportOutput>;
};

// Current-account statement columns (portrait A4 content ≈ 547pt).
const ACCOUNT_COLUMNS: TableReportColumn[] = [
  { header: "Fecha", width: 64, mono: true },
  { header: "Tipo", width: 100 },
  { header: "Documento", width: 115, mono: true },
  { header: "Debe", width: 90, align: "right", mono: true },
  { header: "Haber", width: 90, align: "right", mono: true },
  { header: "Saldo", width: 88, align: "right", mono: true },
];

function inRange(date: string, range: ExportRange): boolean {
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

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

const SUPPLIER_KIND_LABEL: Record<string, string> = {
  factura: "Factura",
  nc: "Nota de Crédito",
  nd: "Nota de Débito",
  payment_order: "Orden de Pago",
  opening_balance: "Ajuste de saldo",
};

function supplierDoc(m: SupplierAccountMovement): string {
  if (m.source_type === "opening_balance") return "—";
  if (!m.punto_venta || !m.numero) return "—";
  const pos = String(m.punto_venta).padStart(4, "0");
  const num = String(m.numero).padStart(8, "0");
  if (m.source_type === "payment_order") return `OP${pos}-${num}`;
  const prefix =
    m.kind === "factura"
      ? m.letter ?? ""
      : m.kind === "nc"
        ? "NC"
        : m.kind === "nd"
          ? "ND"
          : "";
  return `${prefix}${pos}-${num}`;
}

export const EXPORTERS: Record<string, Exporter> = {
  "client-account": {
    permission: "clients:read",
    load: async (params, range) => {
      const clientId = params.get("clientId");
      if (!clientId) throw new Error("Falta el cliente.");
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
          formatArgentineDate(m.movement_date),
          clientType(m),
          clientDoc(m),
          isDebit ? money(m.gross_amount) : "",
          isDebit ? "" : money(m.gross_amount),
          money(m.balance),
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
          money(totalDebe),
          money(totalHaber),
          money(finalBalance),
        ],
        fileName: "cuenta-corriente-cliente",
      };
    },
  },

  "supplier-account": {
    permission: "suppliers:read",
    load: async (params, range) => {
      const supplierId = params.get("supplierId");
      if (!supplierId) throw new Error("Falta el proveedor.");
      const res = await getSupplierAccountAction(supplierId);
      if (!res.ok) throw new Error(res.error);
      const movements = res.data.movements.filter((m) =>
        inRange(m.movement_date, range),
      );
      let totalDebe = 0;
      let totalHaber = 0;
      const rows = movements.map((m) => {
        const debe = m.signed_amount > 0 ? m.signed_amount : 0;
        const haber = m.signed_amount < 0 ? -m.signed_amount : 0;
        totalDebe += debe;
        totalHaber += haber;
        return [
          formatArgentineDate(m.movement_date),
          SUPPLIER_KIND_LABEL[m.kind] ?? m.kind,
          supplierDoc(m),
          debe ? money(debe) : "",
          haber ? money(haber) : "",
          money(m.balance),
        ];
      });
      const finalBalance = movements.length
        ? movements[movements.length - 1]!.balance
        : res.data.balance;
      return {
        title: "Cuenta corriente — Proveedor",
        subtitle: params.get("name") ?? undefined,
        columns: ACCOUNT_COLUMNS,
        rows,
        totalsRow: [
          "",
          "",
          "Totales",
          money(totalDebe),
          money(totalHaber),
          money(finalBalance),
        ],
        fileName: "cuenta-corriente-proveedor",
      };
    },
  },
};
