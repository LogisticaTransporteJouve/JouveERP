"use client";

import { useState } from "react";

import { Combobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  CARD_TREATMENTS,
  CARD_TREATMENT_LABEL,
  isCardTreatment,
  type CardTreatment,
} from "../schema";

export type Destination = {
  treatment: CardTreatment;
  chart_account_id: string | null;
  employee_id: string | null;
};

/** What a purchase (or a card's purchases) is: a company expense with its
 *  account or a salary advance with its employee. An advance is saved once
 *  its employee is picked. */
export function DestinationPicker({
  value,
  onChange,
  accounts,
  employees,
  allowAdvance = true,
  disabled,
  employeesHidden,
}: {
  value: Destination;
  onChange: (d: Destination) => void;
  accounts: { id: string; code: string; name: string }[];
  employees: { id: string; name: string }[];
  allowAdvance?: boolean;
  disabled?: boolean;
  /** Shown instead of the employees when the user may not see them. */
  employeesHidden?: boolean;
}) {
  const [draft, setDraft] = useState<CardTreatment | null>(null);
  const shown = draft ?? value.treatment;
  // The bank charged every line, so the payment books each somewhere.
  const treatments = CARD_TREATMENTS.filter(
    (t) =>
      (allowAdvance || t !== "advance" || value.treatment === "advance") &&
      // «No corresponde» stays readable on an old line but is not offered.
      (t !== "ignore" || value.treatment === "ignore"),
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={shown}
        disabled={disabled}
        onValueChange={(v) => {
          if (!isCardTreatment(v)) return;
          if (v === "advance" && value.treatment !== "advance") {
            setDraft(v);
            return;
          }
          setDraft(null);
          if (v !== value.treatment) {
            onChange({
              treatment: v,
              chart_account_id: null,
              employee_id: null,
            });
          }
        }}
      >
        <SelectTrigger className="h-8 w-44" aria-label="Qué es">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {treatments.map((t) => (
            <SelectItem key={t} value={t}>
              {CARD_TREATMENT_LABEL[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {shown === "expense" && (
        <Combobox
          className="h-8 w-64"
          disabled={disabled}
          value={value.chart_account_id ?? ""}
          onChange={(id) =>
            onChange({ ...value, chart_account_id: id || null })
          }
          placeholder="Elegí la cuenta"
          searchPlaceholder="Buscar cuenta…"
          options={accounts.map((a) => ({
            value: a.id,
            label: `${a.code} ${a.name}`,
          }))}
        />
      )}
      {shown === "advance" && employeesHidden && (
        <span className="text-xs text-muted-foreground">
          {value.employee_id
            ? "Adelanto a un empleado (sin permiso para ver Personal)"
            : "Sin permiso para ver empleados"}
        </span>
      )}
      {shown === "advance" && !employeesHidden && (
        <Combobox
          className="h-8 w-64"
          disabled={disabled || !allowAdvance}
          value={draft ? "" : (value.employee_id ?? "")}
          onChange={(id) => {
            if (!id) return;
            setDraft(null);
            onChange({
              treatment: "advance",
              chart_account_id: null,
              employee_id: id,
            });
          }}
          placeholder="Elegí el empleado"
          searchPlaceholder="Buscar empleado…"
          emptyText="No hay empleados: dalo de alta en Personal."
          options={employees.map((e) => ({ value: e.id, label: e.name }))}
        />
      )}
    </div>
  );
}
