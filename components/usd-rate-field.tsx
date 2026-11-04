"use client";

import type { Control, FieldPath, FieldValues } from "react-hook-form";

import { MoneyInput } from "@/components/money-input";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { COTIZACION_DECIMALS, parseArAmount } from "@/lib/format";

/** The rate a `UsdRateField` holds ("1.180,50" → 1180.5); 0 when empty or
 *  not a number, so the form's `> 1` check refuses it. */
export function parseUsdRate(value: string): number {
  return parseArAmount(value) ?? 0;
}

/** Cotización input of a USD receipt or payment order, in es-AR
 *  ("1.180,50"): the form reads it with `parseArAmount`. `noLoadedRate`: the
 *  lookup found no rate for the date, so the user has to type it. */
export function UsdRateField<T extends FieldValues>({
  control,
  name,
  noLoadedRate,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  noLoadedRate: boolean;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="space-y-1 sm:max-w-[220px]">
          <FormLabel className="text-xs">Cotización (ARS por USD)</FormLabel>
          <FormControl>
            <MoneyInput {...field} decimals={COTIZACION_DECIMALS} />
          </FormControl>
          {noLoadedRate && (
            <p className="text-xs text-muted-foreground">
              No hay cotización cargada para esa fecha: escribila.
            </p>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
