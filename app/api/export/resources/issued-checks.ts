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
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { applyFiscalFilter } from "@/lib/supabase/fiscal-filter";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";

import {
  channelCell,
  dateCell,
  exportScope,
  money,
  moneyCell,
  scopedSubtitle,
  totalCell,
  type Exporter,
  type TypedCell,
} from "../shared";

const COLUMNS =
  "kind, check_number, bank_name, beneficiary_name, due_date, amount, currency, status";

/** Landscape A4 content width ≈ 794pt. */
const ISSUED_CHECK_COLUMNS: TableReportColumn[] = [
  { header: "Banco", width: 120 },
  { header: "Número", width: 80, mono: true },
  { header: "Tipo", width: 60 },
  { header: "Beneficiario", width: 150 },
  { header: "Canal", width: 90 },
  { header: "Vence", width: 74, mono: true },
  { header: "Importe", width: 120, align: "right", mono: true },
  { header: "Estado", width: 100 },
];

function amountCell(amount: number, currency: string): TypedCell {
  const prefix = currency === "USD" ? "US" : "";
  return moneyCell(amount, { currency, text: `${prefix}${money(amount)}` });
}

export const issuedChecks: Exporter = {
  permission: "issued_checks:read",
  load: async (params, range) => {
    const { scope, isFiscal } = exportScope(params);
    const supabase = await createClient();
    // Drained page by page: PostgREST caps responses at max_rows (1000);
    // `id` closes the order so OFFSET pages never repeat or skip rows.
    const build = () => {
      let query = applyFiscalFilter(
        supabase
          .from("issued_checks")
          .select(
            `${COLUMNS}, suppliers ( legal_name ), accounts!issued_checks_bank_account_id_fkey ( name ), channel:invoicing_channels ( name, is_fiscal )`,
          ),
        isFiscal,
        "channel",
      )
        .order("due_date", { ascending: true })
        .order("id", { ascending: true });

      if (range.from) query = query.gte("due_date", range.from);
      if (range.to) query = query.lte("due_date", range.to);
      return query;
    };
    const { data, error } = await paginateRange((from, to) =>
      build().range(from, to),
    );
    if (error) throw new Error("Could not export issued checks.");

    let total = 0;
    const currencies = new Set<string>();
    const rows = (data ?? [])
      .map((row) => {
        if (!isIssuedCheckKind(row.kind)) return null;
        if (!isIssuedCheckStatus(row.status)) return null;
        if (!isIssuedCheckCurrency(row.currency)) return null;
        const supplier = (row as unknown as SupplierListLegalJoin).suppliers;
        const account = (row as unknown as AccountsListNameJoin).accounts;
        const beneficiary = supplier?.legal_name ?? row.beneficiary_name ?? "—";
        const bank = row.bank_name || account?.name || "—";
        const amount = Number(row.amount);
        total += amount;
        currencies.add(row.currency);
        return [
          bank,
          `#${row.check_number}`,
          ISSUED_CHECK_KIND_LABEL[row.kind],
          beneficiary,
          channelCell(row.channel),
          dateCell(row.due_date),
          amountCell(amount, row.currency),
          ISSUED_CHECK_STATUS_LABEL[row.status],
        ];
      })
      .filter((r) => r !== null);

    return {
      title: "Cheques propios",
      subtitle: scopedSubtitle(scope, "Cheques emitidos a proveedores"),
      columns: ISSUED_CHECK_COLUMNS,
      rows,
      totalsRow: [
        "",
        "",
        "",
        "",
        "",
        "Total",
        totalCell(total, currencies),
        "",
      ],
      orientation: "landscape",
      fileName: "cheques-propios",
    };
  },
};
