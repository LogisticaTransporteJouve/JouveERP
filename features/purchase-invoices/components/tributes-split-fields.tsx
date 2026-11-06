"use client";

import { useWatch, type Control } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { MoneyInput } from "@/components/money-input";
import { formatMoney, parseArAmount } from "@/lib/format";

import { PURCHASE_TRIBUTE_FIELDS, PURCHASE_TRIBUTE_LABEL } from "../schema";
import type { PurchaseInvoiceFormValues } from "./purchase-invoice-form";

/** What is left to split of `total`; negative when the parts exceed it. */
export function tributesRemaining(
  total: number,
  parts: readonly (string | undefined)[],
): number {
  const sum = parts.reduce((acc, v) => acc + (parseArAmount(v ?? "") ?? 0), 0);
  return Math.round((total - sum) * 100) / 100;
}

export function tributesRemainingMessage(remaining: number): string | null {
  if (remaining > 0) return `Falta repartir ${formatMoney(remaining)}.`;
  if (remaining < 0) return `Te pasaste por ${formatMoney(-remaining)}.`;
  return null;
}

/** The "otros tributos" total split into the five kinds a supplier charges. */
export function TributesSplitFields({
  control,
  total,
  disabled,
}: {
  control: Control<PurchaseInvoiceFormValues>;
  total: number;
  disabled: boolean;
}) {
  const parts = useWatch({ control, name: [...PURCHASE_TRIBUTE_FIELDS] });
  const message = tributesRemainingMessage(tributesRemaining(total, parts));

  return (
    <fieldset className="space-y-2 rounded-md border px-3 py-3">
      <legend className="px-1 text-sm font-medium">
        Otros tributos: cómo se reparten
      </legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PURCHASE_TRIBUTE_FIELDS.map((name) => (
          <FormField
            key={name}
            control={control}
            name={name}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{PURCHASE_TRIBUTE_LABEL[name]}</FormLabel>
                <FormControl>
                  <MoneyInput {...field} disabled={disabled} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}
    </fieldset>
  );
}
