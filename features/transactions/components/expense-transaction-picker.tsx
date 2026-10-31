"use client";

import { useQuery } from "@tanstack/react-query";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/format";
import { runAction } from "@/lib/query/run-action";

import { listTransactionsAction } from "../actions/transactions-actions";
import { transactionsKeys } from "../lib/transactions-keys";
import type { TransactionFilters } from "../schema";

const NONE = "__none__";
const WINDOW_DAYS = 45;
const LIMIT = 100;

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Links a record to an expense movement of treasury, picked among the
 * expenses within 45 days of `aroundDate`. Used by fleet costs (fuel loads,
 * maintenance) to point at the movement that paid them.
 */
export function ExpenseTransactionPicker({
  value,
  onChange,
  aroundDate,
  disabled,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  aroundDate: string;
  disabled?: boolean;
}) {
  const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(aroundDate);
  const filters: TransactionFilters = {
    kind: "expense",
    date_from: hasDate ? shiftDate(aroundDate, -WINDOW_DAYS) : null,
    date_to: hasDate ? shiftDate(aroundDate, WINDOW_DAYS) : null,
    limit: LIMIT,
  };
  const query = useQuery({
    queryKey: transactionsKeys.picker(filters),
    queryFn: () => runAction(() => listTransactionsAction(filters)),
    enabled: hasDate,
  });
  const items = query.data?.items ?? [];
  const linkedMissing = value !== null && !items.some((t) => t.id === value);

  return (
    <Select
      value={value ?? NONE}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
      disabled={disabled || !hasDate}
    >
      <SelectTrigger className="w-full">
        <SelectValue
          placeholder={hasDate ? "Ninguno" : "Elegí una fecha primero"}
        />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>
          {query.isError ? "Ninguno (no se pudieron cargar)" : "Ninguno"}
        </SelectItem>
        {linkedMissing && (
          <SelectItem value={value}>Movimiento vinculado</SelectItem>
        )}
        {items.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {`${t.transaction_date} · ${formatMoney(t.amount, t.currency)} · ${
              t.description ?? t.account_name
            }`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
