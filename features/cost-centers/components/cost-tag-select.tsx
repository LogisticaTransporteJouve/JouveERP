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
 * (an inactive center, an account that got subaccounts) stays selected; an
 * inactive center keeps its name, marked "(inactivo)".
 *
 * `id` and the aria props come from `FormControl`, so the trigger is the
 * element its `FormLabel` names.
 */
export function CostTagSelect({
  kind,
  value,
  onChange,
  noneLabel,
  disabled,
  side,
  avoidCollisions,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
}: {
  kind: "expenseAccount" | "costCenter";
  value: string;
  onChange: (id: string) => void;
  /** Copy for the empty choice, when "none" means something else here. */
  noneLabel?: string;
  disabled?: boolean;
  /** Where the list opens; by default below, flipping up when it does not fit. */
  side?: "top" | "bottom";
  avoidCollisions?: boolean;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
}) {
  const query = useCostTagOptions();
  const list: CostTagOption[] =
    (kind === "expenseAccount"
      ? query.data?.expenseAccounts
      : query.data?.costCenters) ?? [];
  const missing = value !== "" && !list.some((o) => o.id === value);
  const inactive =
    missing && kind === "costCenter"
      ? query.data?.inactiveCostCenters.find((o) => o.id === value)
      : undefined;

  return (
    <Select
      value={value || NONE}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
      disabled={disabled || query.isPending}
    >
      <SelectTrigger
        className="w-full min-w-0"
        id={id}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
      >
        <SelectValue
          placeholder={
            query.isError ? "No se pudieron cargar las opciones" : "Cargando…"
          }
        />
      </SelectTrigger>
      <SelectContent
        position="popper"
        side={side}
        avoidCollisions={avoidCollisions}
        align="start"
        className="max-h-[min(18rem,var(--radix-select-content-available-height))]"
      >
        <SelectItem value={NONE}>{noneLabel ?? COPY[kind].none}</SelectItem>
        {missing && query.isSuccess && (
          <SelectItem value={value}>
            {inactive ? (
              <OptionLabel option={inactive} suffix=" (inactivo)" />
            ) : (
              COPY[kind].missing
            )}
          </SelectItem>
        )}
        {list.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            <OptionLabel option={o} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function OptionLabel({
  option,
  suffix,
}: {
  option: CostTagOption;
  suffix?: string;
}) {
  return (
    <>
      <span className="font-mono text-xs text-muted-foreground">
        {option.code}
      </span>{" "}
      {option.name}
      {suffix}
    </>
  );
}
