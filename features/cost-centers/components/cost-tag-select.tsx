"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useCostTagOptions } from "../hooks/use-cost-centers";
import type { CostTagOption } from "../schema";

const NONE = "__none";

const COPY = {
  expenseAccount: {
    none: "Sin cuenta",
    missing: "Cuenta actual (no imputable)",
  },
  costCenter: {
    none: "Sin centro de costo",
    missing: "Centro actual (inactivo)",
  },
} as const;

/**
 * Expense account (a postable leaf of the chart) or cost center of a cost.
 * `value` is the id, "" for none. A saved value the options no longer list
 * (an inactive center, an account that got subaccounts) stays selected.
 */
export function CostTagSelect({
  kind,
  value,
  onChange,
  noneLabel,
  disabled,
}: {
  kind: "expenseAccount" | "costCenter";
  value: string;
  onChange: (id: string) => void;
  /** Copy for the empty choice, when "none" means something else here. */
  noneLabel?: string;
  disabled?: boolean;
}) {
  const query = useCostTagOptions();
  const list: CostTagOption[] =
    (kind === "expenseAccount"
      ? query.data?.expenseAccounts
      : query.data?.costCenters) ?? [];
  const missing = value !== "" && !list.some((o) => o.id === value);

  return (
    <Select
      value={value || NONE}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
      disabled={disabled || query.isPending}
    >
      <SelectTrigger className="w-full min-w-0">
        <SelectValue
          placeholder={
            query.isError ? "No se pudieron cargar las opciones" : "Cargando…"
          }
        />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-72">
        <SelectItem value={NONE}>{noneLabel ?? COPY[kind].none}</SelectItem>
        {missing && query.isSuccess && (
          <SelectItem value={value}>{COPY[kind].missing}</SelectItem>
        )}
        {list.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            <span className="font-mono text-xs text-muted-foreground">
              {o.code}
            </span>{" "}
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
