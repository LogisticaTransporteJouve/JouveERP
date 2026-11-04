"use client";

import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { formatAmountInput, formatSignedAmountInput } from "@/lib/format";

type Props = Omit<
  ComponentProps<"input">,
  "type" | "inputMode" | "value" | "onChange"
> & {
  value: string;
  onChange: (value: string) => void;
  /** Keep a leading "-" (an account balance); otherwise a minus is dropped. */
  allowNegative?: boolean;
};

/** es-AR amount field that formats on every keystroke ("1500,5" shows as
 *  "1.500,5"), so what it shows is what `parseArAmount` reads: a typed dot
 *  is dropped in sight instead of silently multiplying the amount. */
export function MoneyInput({
  value,
  onChange,
  allowNegative = false,
  ...props
}: Props) {
  const format = allowNegative ? formatSignedAmountInput : formatAmountInput;
  return (
    <Input
      autoComplete="off"
      {...props}
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(format(e.target.value))}
    />
  );
}
