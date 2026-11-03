"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useEmployeeOptions } from "../hooks/use-employees";

const NONE = "__none__";

/**
 * "A cargo de empleado" picker for a purchase: the total goes to the
 * employee's current account and the neto out of the operating cost. Renders
 * nothing for a user without hr:write. `value` is an employee id or "".
 */
export function EmployeeChargeSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { data, isError } = useEmployeeOptions();
  if (isError || data === null) return null;

  const options = (data ?? []).filter((e) => e.is_active || e.id === value);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>A cargo de empleado</Label>
      <Select
        value={value === "" ? NONE : value}
        onValueChange={(v) => onChange(v === NONE ? "" : v)}
        disabled={disabled || data === undefined}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder="Cargando…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No (gasto de la empresa)</SelectItem>
          {options.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.legal_name}
              {e.is_active ? "" : " (baja)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value !== "" && (
        <p className="text-xs text-muted-foreground">
          Sigue en el Libro IVA; el total va a la cuenta corriente del empleado
          y el neto no es costo en Gestión.
        </p>
      )}
    </div>
  );
}
