"use client";

import type { Control, FieldPath, FieldValues } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

/** Cotización input of a USD receipt or payment order. `noLoadedRate`: the
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
            <Input
              {...field}
              type="number"
              inputMode="decimal"
              step="0.0001"
              min={0}
            />
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
