"use client";

import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { nextMoneyInputText } from "@/lib/format";

type Props = Omit<
  ComponentProps<"input">,
  "type" | "inputMode" | "value" | "onChange"
> & {
  value: string;
  onChange: (value: string) => void;
  /** Keep a leading "-" (an account balance); otherwise a minus is dropped. */
  allowNegative?: boolean;
  /** Decimal digits kept while typing (default 2). */
  decimals?: number;
};

/** es-AR amount field that formats on every keystroke ("1500,5" shows as
 *  "1.500,5"), so what it shows is what `parseArAmount` reads. It groups
 *  thousands itself, so a typed "." is the decimal mark like "," (numpad
 *  keys send "."); a paste follows `normalizeAmountText`. */
export function MoneyInput({
  value,
  onChange,
  allowNegative = false,
  decimals = 2,
  ...props
}: Props) {
  return (
    <Input
      autoComplete="off"
      {...props}
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(e) =>
        onChange(
          nextMoneyInputText(value, e.target.value, {
            decimals,
            allowNegative,
          }),
        )
      }
    />
  );
}
