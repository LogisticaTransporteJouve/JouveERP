"use client";

import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  value: number;
  onCommit: (value: number) => Promise<void> | void;
  disabled?: boolean;
  className?: string;
};

// Cell-style inline edit. Right-aligned, monospace, transparent border in
// rest state; visible border + ring on focus. onBlur commits if the value
// changed; ESC reverts.
export function InlineMoneyInput({
  value,
  onCommit,
  disabled,
  className,
}: Props) {
  const [text, setText] = useState<string>(String(value ?? 0));
  const initialRef = useRef<string>(String(value ?? 0));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next = String(value ?? 0);
    setText(next);
    initialRef.current = next;
  }, [value]);

  async function commitIfChanged() {
    if (saving) return;
    const parsed = Number(text.replace(/,/g, "."));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setText(initialRef.current);
      return;
    }
    if (Number(initialRef.current) === parsed) return;
    setSaving(true);
    try {
      await onCommit(parsed);
      initialRef.current = String(parsed);
    } catch {
      setText(initialRef.current);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={text}
      disabled={disabled || saving}
      onChange={(e) => setText(e.target.value)}
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
