"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ALLOCATION_MODES,
  ALLOCATION_MODE_LABEL,
  type AllocationMode,
} from "@/lib/allocations";

const HINT: Record<
  "receipt" | "payment_order",
  Record<AllocationMode, string>
> = {
  receipt: {
    fifo: "Cancela los comprobantes pendientes del canal, del más viejo al más nuevo. Lo que sobre queda a cuenta.",
    manual: "Elegí qué comprobantes cancela y cuánto de cada uno.",
    a_cuenta:
      "El cobro queda a cuenta del cliente y se imputa después desde Recibos (Imputar).",
  },
  payment_order: {
    fifo: "Cancela las facturas pendientes del canal, de la más vieja a la más nueva. Lo que sobre queda a cuenta.",
    manual: "Elegí qué facturas cancela y cuánto de cada una.",
    a_cuenta:
      "El pago queda a cuenta del proveedor y se imputa después desde Órdenes de pago (Imputar).",
  },
};

/** How a new receipt or payment order is applied (lib/allocations). */
export function AllocationModeSelect({
  value,
  onChange,
  payer,
}: {
  value: AllocationMode;
  onChange: (mode: AllocationMode) => void;
  payer: "receipt" | "payment_order";
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs" htmlFor={`allocation-mode-${payer}`}>
        Imputación
      </Label>
      <Select
        value={value}
        onValueChange={(v) =>
          onChange(ALLOCATION_MODES.find((m) => m === v) ?? "fifo")
        }
      >
        <SelectTrigger id={`allocation-mode-${payer}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {ALLOCATION_MODES.map((m) => (
            <SelectItem key={m} value={m}>
              {ALLOCATION_MODE_LABEL[m]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{HINT[payer][value]}</p>
    </div>
  );
}
