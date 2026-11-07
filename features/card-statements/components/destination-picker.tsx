"use client";

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
 *  account, a salary advance with its employee, or nothing. */
export function DestinationPicker({
  value,
  onChange,
  accounts,
  employees,
  allowAdvance = true,
  disabled,
}: {
  value: Destination;
  onChange: (d: Destination) => void;
  accounts: { id: string; code: string; name: string }[];
  employees: { id: string; name: string }[];
  allowAdvance?: boolean;
  disabled?: boolean;
}) {
  const treatments = CARD_TREATMENTS.filter(
    (t) => allowAdvance || t !== "advance",
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={value.treatment}
        disabled={disabled}
        onValueChange={(v) =>
          isCardTreatment(v) &&
          onChange({ treatment: v, chart_account_id: null, employee_id: null })
        }
      >
        <SelectTrigger className="h-8 w-44">
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
      {value.treatment === "expense" && (
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
      {value.treatment === "advance" && (
        <Combobox
          className="h-8 w-64"
          disabled={disabled}
          value={value.employee_id ?? ""}
          onChange={(id) => onChange({ ...value, employee_id: id || null })}
          placeholder="Elegí el empleado"
          searchPlaceholder="Buscar empleado…"
          emptyText="No hay empleados: dalo de alta en Personal."
          options={employees.map((e) => ({ value: e.id, label: e.name }))}
        />
      )}
    </div>
  );
}
