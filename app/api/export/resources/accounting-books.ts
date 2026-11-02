import "server-only";

import { ACCOUNT_TYPE_LABEL } from "@/features/balance/schema";
import { previousPeriod } from "@/lib/accounting-period";
import { formatPeriod } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { paginateRange } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";
import { PeriodSchema } from "@/lib/validation/common";

import {
  dateCell,
  ExportInputError,
  moneyCell,
  type ExportCell,
  type Exporter,
} from "../shared";

// The accounting books of one period (`period=YYYY-MM`) for the monthly
// package: libro diario, libro mayor and balance de sumas y saldos. They read
// with the user's client, so RLS leaves a fiscal_reader the fiscal entries
// only; the journal is fiscal by design (manual entries and auto-posting
// never take an internal channel).

function periodParam(params: URLSearchParams): string {
  const parsed = PeriodSchema.safeParse(params.get("period") ?? "");
  if (!parsed.success)
    throw new ExportInputError("Período inválido (YYYY-MM).");
  return parsed.data;
}

type BookLine = {
  entryNumber: number;
  entryDate: string;
  entryDescription: string;
  accountCode: string;
  accountName: string;
  description: string | null;
  debit: number;
  credit: number;
};

/** Every line of the period's entries, in journal order (date, then load
 *  order), each with its entry's running number. */
async function periodLines(period: string): Promise<BookLine[]> {
  const supabase = await createClient();
  const { data, error } = await paginateRange((from, to) =>
    supabase
      .from("journal_entries")
      .select(
        "id, entry_date, description, created_at, lines:journal_entry_lines(debit, credit, description, sort_order, account:chart_of_accounts(code, name))",
      )
      .eq("accrual_period", period)
      .order("entry_date", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (error) throw new Error("Could not load journal entries.");
  return (data ?? []).flatMap((entry, index) =>
    [...entry.lines]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((line) => {
        const account = Array.isArray(line.account)
          ? line.account[0]
          : line.account;
        return {
          entryNumber: index + 1,
          entryDate: entry.entry_date,
          entryDescription: entry.description,
          accountCode: account?.code ?? "—",
          accountName: account?.name ?? "—",
          description: line.description,
          debit: Number(line.debit),
          credit: Number(line.credit),
        };
      }),
  );
}

async function accountBalances(periodEnd: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_account_balances", {
    p_period_end: periodEnd,
  });
  if (error) throw new Error("Could not load account balances.");
  return (data ?? []).map((row) => ({
    code: row.account_code,
    name: row.account_name,
    type: row.account_type,
    debit: Number(row.total_debit),
    credit: Number(row.total_credit),
    balance: Number(row.balance),
  }));
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, n) => acc + n, 0);
}

// Landscape A4 ≈ 794pt.
const JOURNAL_COLUMNS: TableReportColumn[] = [
  { header: "N°", width: 36, align: "right", mono: true },
  { header: "Fecha", width: 60, mono: true },
  { header: "Asiento", width: 200 },
  { header: "Cuenta", width: 210 },
  { header: "Detalle", width: 128 },
  { header: "Debe", width: 80, align: "right", mono: true },
  { header: "Haber", width: 80, align: "right", mono: true },
];

export const libroDiario: Exporter = {
  permission: "accounting:read",
  load: async (params) => {
    const period = periodParam(params);
    const lines = await periodLines(period);
    const rows: ExportCell[][] = lines.map((l) => [
      String(l.entryNumber),
      dateCell(l.entryDate),
      l.entryDescription,
      `${l.accountCode} ${l.accountName}`,
      l.description ?? "",
      l.debit ? moneyCell(l.debit) : "",
      l.credit ? moneyCell(l.credit) : "",
    ]);
    return {
      title: "Libro diario",
      subtitle: formatPeriod(period),
      columns: JOURNAL_COLUMNS,
      rows,
      totalsRow: [
        "",
        "",
        "Totales",
        "",
        "",
        moneyCell(sum(lines.map((l) => l.debit))),
        moneyCell(sum(lines.map((l) => l.credit))),
      ],
      orientation: "landscape",
      fileName: `libro-diario-${period}`,
    };
  },
};

const LEDGER_COLUMNS: TableReportColumn[] = [
  { header: "Cuenta", width: 220 },
  { header: "Fecha", width: 60, mono: true },
  { header: "Asiento", width: 274 },
  { header: "Debe", width: 80, align: "right", mono: true },
  { header: "Haber", width: 80, align: "right", mono: true },
  { header: "Saldo", width: 80, align: "right", mono: true },
];

/** The general ledger of the period: each account with movements, from its
 *  balance at the end of the previous period, line by line. Saldo is debit
 *  minus credit, like the libro mayor screen. */
export const libroMayor: Exporter = {
  permission: "accounting:read",
  load: async (params) => {
    const period = periodParam(params);
    const [lines, openings] = await Promise.all([
      periodLines(period),
      accountBalances(previousPeriod(period)),
    ]);
    const openingByCode = new Map(openings.map((o) => [o.code, o.balance]));
    const byAccount = new Map<string, BookLine[]>();
    for (const line of lines) {
      const list = byAccount.get(line.accountCode) ?? [];
      list.push(line);
      byAccount.set(line.accountCode, list);
    }

    const rows: ExportCell[][] = [];
    for (const code of [...byAccount.keys()].sort()) {
      const accountLines = byAccount.get(code) ?? [];
      const label = `${code} ${accountLines[0]?.accountName ?? ""}`;
      let balance = openingByCode.get(code) ?? 0;
      rows.push([label, "", "Saldo anterior", "", "", moneyCell(balance)]);
      for (const l of accountLines) {
        balance += l.debit - l.credit;
        rows.push([
          label,
          dateCell(l.entryDate),
          `#${l.entryNumber} ${l.entryDescription}`,
          l.debit ? moneyCell(l.debit) : "",
          l.credit ? moneyCell(l.credit) : "",
          moneyCell(balance),
        ]);
      }
    }
    return {
      title: "Libro mayor",
      subtitle: formatPeriod(period),
      columns: LEDGER_COLUMNS,
      rows,
      orientation: "landscape",
      fileName: `libro-mayor-${period}`,
    };
  },
};

// Portrait A4 ≈ 547pt.
const TRIAL_BALANCE_COLUMNS: TableReportColumn[] = [
  { header: "Código", width: 60, mono: true },
  { header: "Cuenta", width: 165 },
  { header: "Tipo", width: 70 },
  { header: "Debe", width: 63, align: "right", mono: true },
  { header: "Haber", width: 63, align: "right", mono: true },
  { header: "Saldo deudor", width: 63, align: "right", mono: true },
  { header: "Saldo acreedor", width: 63, align: "right", mono: true },
];

/** Balance de sumas y saldos at the end of the period (every entry up to
 *  it), like the Balance screen. */
export const balanceSumasSaldos: Exporter = {
  permission: "accounting:read",
  load: async (params) => {
    const period = periodParam(params);
    const balances = await accountBalances(period);
    const rows: ExportCell[][] = balances.map((b) => [
      b.code,
      b.name,
      ACCOUNT_TYPE_LABEL[b.type],
      moneyCell(b.debit),
      moneyCell(b.credit),
      b.balance > 0 ? moneyCell(b.balance) : "",
      b.balance < 0 ? moneyCell(-b.balance) : "",
    ]);
    return {
      title: "Balance de sumas y saldos",
      subtitle: `Al cierre de ${formatPeriod(period)}`,
      columns: TRIAL_BALANCE_COLUMNS,
      rows,
      totalsRow: [
        "",
        "Totales",
        "",
        moneyCell(sum(balances.map((b) => b.debit))),
        moneyCell(sum(balances.map((b) => b.credit))),
        moneyCell(sum(balances.map((b) => Math.max(b.balance, 0)))),
        moneyCell(sum(balances.map((b) => Math.max(-b.balance, 0)))),
      ],
      fileName: `balance-sumas-y-saldos-${period}`,
    };
  },
};
