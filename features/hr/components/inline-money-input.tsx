"use client";

import { useEffect, useRef, useState } from "react";

import { MoneyInput } from "@/components/money-input";
import { amountToInput, parseArAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

type Common = { disabled?: boolean; className?: string; placeholder?: string };

// `nullable`: an empty cell stands for "not loaded" and commits null.
type Props = Common &
  (
    | {
        nullable?: false;
        value: number;
        onCommit: (value: number) => Promise<void> | void;
      }
    | {
        nullable: true;
        value: number | null;
        onCommit: (value: number | null) => Promise<void> | void;
      }
  );

function toText(value: number | null): string {
  return value === null ? "" : amountToInput(value);
}

// Cell-style inline edit. Right-aligned, monospace, transparent border in
// rest state; visible border + ring on focus. onBlur commits if the value
// changed; ESC reverts.
export function InlineMoneyInput(props: Props) {
  const { value, disabled, className, placeholder } = props;
  const [text, setText] = useState<string>(toText(value));
  const initialRef = useRef<string>(toText(value));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next = toText(value);
    setText(next);
    initialRef.current = next;
  }, [value]);

  async function commit(next: number | null) {
    if (props.nullable) await props.onCommit(next);
    else if (next !== null) await props.onCommit(next);
  }

  async function commitIfChanged() {
    if (saving) return;
    const trimmed = text.trim();
    if (trimmed === "" && props.nullable) {
      if (initialRef.current === "") return;
      setSaving(true);
      try {
        await commit(null);
        initialRef.current = "";
      } catch {
        setText(initialRef.current);
      } finally {
        setSaving(false);
      }
      return;
    }
    const parsed = parseArAmount(trimmed);
    if (parsed === null || parsed < 0) {
      setText(initialRef.current);
      return;
    }
    if (
      initialRef.current !== "" &&
      parseArAmount(initialRef.current) === parsed
    ) {
      return;
    }
    setSaving(true);
    try {
      await commit(parsed);
      initialRef.current = amountToInput(parsed);
      setText(initialRef.current);
    } catch {
      setText(initialRef.current);
    } finally {
      setSaving(false);
    }
  }

  return (
    <MoneyInput
      value={text}
      placeholder={placeholder}
      disabled={disabled || saving}
      onChange={setText}
      onBlur={() => void commitIfChanged()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          setText(initialRef.current);
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "h-8 w-full text-right font-mono text-sm",
        saving && "opacity-60",
        className,
      )}
    />
  );
}
