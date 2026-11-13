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
 * «Se le imputa a» picker for a savings plan: each paid cuota shows on the
 * employee's planilla as already received (management only). Active
 * employees; renders nothing for a user without hr:write. `value` is an
 * employee id or "".
 */
export function EmployeeImputationSelect({
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
      <Label htmlFor={id}>Se le imputa a</Label>
      <Select
        value={value === "" ? NONE : value}
        onValueChange={(v) => onChange(v === NONE ? "" : v)}
        disabled={disabled || data === undefined}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Cargando…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Nadie (plan de la empresa)</SelectItem>
          {options.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.legal_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Figura en su planilla como pago recibido; contablemente sigue siendo un
        plan de ahorro de la empresa.
      </p>
    </div>
  );
}
