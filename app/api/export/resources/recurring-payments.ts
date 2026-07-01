import "server-only";

import {
  RECURRING_CATEGORY_LABELS,
  RECURRING_FREQUENCY_LABELS,
  isRecurringCategory,
  isRecurringCurrency,
  isRecurringFrequency,
} from "@/features/recurring-payments/schema";
import { formatArgentineDate } from "@/lib/format";
import type { TableReportColumn } from "@/lib/pdf/table-report-template";
import { createClient } from "@/lib/supabase/server";

import { money, type Exporter } from "../shared";

// Portrait A4 ≈ 547pt of usable width.
const COLUMNS: TableReportColumn[] = [
  { header: "Descripción", width: 167 },
  { header: "Categoría", width: 80 },
  { header: "Monto", width: 90, align: "right", mono: true },
  { header: "Moneda", width: 60 },
  { header: "Frecuencia", width: 80 },
  { header: "Próx. venc.", width: 70, mono: true },
];

export const recurringPayments: Exporter = {
  permission: "recurring_payments:read",
  load: async (_params, range) => {
    const supabase = await createClient();

    let query = supabase
      .from("recurring_payments")
      .select(
        "description, category, amount, currency, frequency, next_due_date",
      )
      .order("next_due_date", { ascending: true });

    if (range.from) query = query.gte("next_due_date", range.from);
    if (range.to) query = query.lte("next_due_date", range.to);

    const { data, error } = await query;
    if (error) throw new Error("Could not load recurring payments.");

    const rows = (data ?? []).map((row) => {
      const category = isRecurringCategory(row.category)
        ? RECURRING_CATEGORY_LABELS[row.category]
        : row.category;
      const frequency = isRecurringFrequency(row.frequency)
        ? RECURRING_FREQUENCY_LABELS[row.frequency]
        : row.frequency;
      const currency = isRecurringCurrency(row.currency) ? row.currency : "—";
      return [
        row.description,
        category,
        money(Number(row.amount)),
        currency,
        frequency,
        formatArgentineDate(row.next_due_date),
      ];
    });

    return {
      title: "Pagos recurrentes",
      columns: COLUMNS,
      rows,
      fileName: "pagos-recurrentes",
    };
  },
};
