import "server-only";

import type { AccountsListNameJoin } from "@/features/accounts/schema";
import {
  ISSUED_CHECK_KIND_LABEL,
  ISSUED_CHECK_STATUS_LABEL,
  isIssuedCheckCurrency,
  isIssuedCheckKind,
  isIssuedCheckStatus,
} from "@/features/issued-checks/schema";
import type { SupplierListLegalJoin } from "@/features/suppliers/schema";
import { formatArgentineDate } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { createClient } from "@/lib/supabase/server";

import { money, type Exporter } from "../shared";

const COLUMNS =
  "kind, check_number, bank_name, beneficiary_name, due_date, amount, currency, status";

/** Landscape A4 content width ≈ 794pt. */
const ISSUED_CHECK_COLUMNS: TableReportColumn[] = [
  { header: "Banco", width: 150 },
  { header: "Número", width: 90, mono: true },
  { header: "Tipo", width: 70 },
  { header: "Beneficiario", width: 190 },
  { header: "Vence", width: 74, mono: true },
  { header: "Importe", width: 120, align: "right", mono: true },
  { header: "Estado", width: 100 },
];

function amountCell(amount: number, currency: string): string {
  const prefix = currency === "USD" ? "US" : "";
  return `${prefix}${money(amount)}`;
}

export const issuedChecks: Exporter = {
  permission: "issued_checks:read",
  load: async (params, range) => {
    const supabase = await createClient();
    let query = supabase
      .from("issued_checks")
      .select(
        `${COLUMNS}, suppliers ( legal_name ), accounts!issued_checks_bank_account_id_fkey ( name )`,
      )
      .order("due_date", { ascending: true });

    if (range.from) query = query.gte("due_date", range.from);
    if (range.to) query = query.lte("due_date", range.to);

    const { data, error } = await query;
    if (error) throw new Error("No se pudieron exportar los cheques propios.");

    let total = 0;
    const rows = (data ?? [])
      .map((row) => {
        if (!isIssuedCheckKind(row.kind)) return null;
        if (!isIssuedCheckStatus(row.status)) return null;
        if (!isIssuedCheckCurrency(row.currency)) return null;
        const supplier = (row as unknown as SupplierListLegalJoin).suppliers;
        const account = (row as unknown as AccountsListNameJoin).accounts;
        const beneficiary =
          supplier?.legal_name ?? row.beneficiary_name ?? "—";
        const bank = row.bank_name || account?.name || "—";
        const amount = Number(row.amount);
        total += amount;
        return [
          bank,
          `#${row.check_number}`,
          ISSUED_CHECK_KIND_LABEL[row.kind],
          beneficiary,
          formatArgentineDate(row.due_date),
          amountCell(amount, row.currency),
          ISSUED_CHECK_STATUS_LABEL[row.status],
        ];
      })
      .filter((r): r is string[] => r !== null);

    return {
      title: "Cheques propios",
      subtitle: "Cheques emitidos a proveedores",
      columns: ISSUED_CHECK_COLUMNS,
      rows,
      totalsRow: ["", "", "", "", "Total", money(total), ""],
      orientation: "landscape",
      fileName: "cheques-propios",
    };
  },
};
