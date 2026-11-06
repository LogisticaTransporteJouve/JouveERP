"use client";

import { useEffect } from "react";

import { ReadError } from "@/components/read-error";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useEnabledPos } from "../hooks/use-invoices";
import { posLabel } from "../lib/pos-label";

/**
 * The enabled points of sale of a channel. Picks the only one by itself and
 * clears a value that is not in the list (e.g. after the channel changed).
 */
export function PosSelect({
  channelId,
  value,
  onChange,
  id,
}: {
  channelId: string | null;
  value: string;
  onChange: (numero: string) => void;
  id?: string;
}) {
  const pos = useEnabledPos(channelId);
  const options = pos.data;

  useEffect(() => {
    if (!options) return;
    if (options.length === 1) {
      const only = String(options[0]!.numero);
      if (value !== only) onChange(only);
    } else if (value && !options.some((p) => String(p.numero) === value)) {
      onChange("");
    }
  }, [options, value, onChange]);

  if (!channelId) {
    return <p className="text-sm text-muted-foreground">Elegí un canal.</p>;
  }
  if (pos.isError) {
    return (
      <ReadError
        message="No se pudieron cargar los puntos de venta."
        onRetry={() => void pos.refetch()}
      />
    );
  }
  if (options && options.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Este canal no tiene puntos de venta habilitados.
      </p>
    );
  }
  return (
    <Select
      value={value}
      onValueChange={onChange}
      disabled={!options || options.length === 1}
    >
      <SelectTrigger id={id}>
        <SelectValue
          placeholder={options ? "Elegí un punto de venta" : "Cargando…"}
        />
      </SelectTrigger>
      <SelectContent position="popper">
        {(options ?? []).map((p) => (
          <SelectItem key={p.numero} value={String(p.numero)}>
            {posLabel(p)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
