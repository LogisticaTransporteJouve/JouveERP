"use client";

import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { moneyInputBlurText, nextMoneyInputText } from "@/lib/format";

type Props = Omit<
  ComponentProps<"input">,
  "type" | "inputMode" | "value" | "onChange"
> & {
  value: string;
  onChange: (value: string) => void;
  /** Keep a leading "-" (an account balance); otherwise a minus is dropped. */
  allowNegative?: boolean;
  /** Decimal digits kept (default 2). */
  decimals?: number;
};

/** es-AR amount field. While typing it keeps the text as typed, read with
 *  the rules of `normalizeAmountText`: a lone "." with exactly 3 digits after
 *  it groups thousands ("15.000" is 15000), with 1–2 it is the decimal mark
 *  ("1500.50"), so neither habit multiplies the amount. A paste is read as a
 *  whole value; on blur the text becomes canonical es-AR ("1.500,5"). */
export function MoneyInput({
  value,
  onChange,
  onBlur,
  allowNegative = false,
  decimals = 2,
  ...props
}: Props) {
  const options = { decimals, allowNegative };
  return (
    <Input
      autoComplete="off"
      {...props}
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(e) =>
        onChange(nextMoneyInputText(value, e.target.value, options))
      }
      onBlur={(e) => {
        const canonical = moneyInputBlurText(value, options);
        if (canonical !== value) onChange(canonical);
        onBlur?.(e);
      }}
    />
  );
}
