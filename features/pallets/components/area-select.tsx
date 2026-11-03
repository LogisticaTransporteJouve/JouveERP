"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE = "__none__";

export type AreaOption = {
  id: string;
  warehouse_id: string;
  name: string;
  is_active: boolean;
};

/** The active areas of one warehouse (and the current one, if inactive);
 *  "" = no area. Disabled until a warehouse is picked. */
export function AreaSelect({
  areaOptions,
  warehouseId,
  value,
  onChange,
}: {
  areaOptions: AreaOption[];
  warehouseId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = areaOptions.filter(
    (a) => a.warehouse_id === warehouseId && (a.is_active || a.id === value),
  );
  return (
    <Select
      value={value === "" ? NONE : value}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
      disabled={warehouseId === "" || options.length === 0}
    >
      <SelectTrigger aria-label="Área">
        <SelectValue placeholder="Sin área" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Sin área</SelectItem>
        {options.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
