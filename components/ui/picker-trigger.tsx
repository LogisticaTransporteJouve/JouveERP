"use client";

import { X, type LucideIcon } from "lucide-react";
import type * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The props a picker takes besides its value: what a native input took, plus
 *  what react-hook-form's `field` and shadcn's `FormControl` hand it, so
 *  `<DatePicker {...field} />` works inside a `FormItem`. */
export type PickerFieldProps = {
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Offer a way to empty the field; only where an empty value is valid. */
  clearable?: boolean;
  onBlur?: () => void;
  ref?: React.Ref<HTMLButtonElement>;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

/**
 * The trigger button shared by `DatePicker` and `MonthPicker`: the icon, the
 * formatted value (or the placeholder) and, when `onClear` is given, an X
 * that empties the field (Supr / Retroceso do the same from the keyboard).
 * Radix's `PopoverTrigger asChild` adds the open/close handlers and the ref.
 */
export function PickerTrigger({
  icon: Icon,
  display,
  placeholder,
  clearLabel,
  onClear,
  className,
  disabled,
  onKeyDown,
  "aria-label": ariaLabel,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "children"> & {
  icon: LucideIcon;
  display: string;
  placeholder: string;
  clearLabel: string;
  onClear?: () => void;
}) {
  const canClear = Boolean(onClear && display && !disabled);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      // An aria-label replaces the button text: keep the value audible.
      aria-label={ariaLabel && display ? `${ariaLabel}: ${display}` : ariaLabel}
      className={cn(
        "h-9 w-full justify-between font-normal",
        !display && "text-muted-foreground",
        className,
      )}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (canClear && (e.key === "Delete" || e.key === "Backspace")) {
          e.preventDefault();
          onClear?.();
        }
      }}
      {...props}
    >
      <span className="flex items-center gap-2 truncate">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        {display || placeholder}
      </span>
      {canClear && (
        <span
          role="button"
          tabIndex={-1}
          aria-label={clearLabel}
          onClick={(e) => {
            e.stopPropagation();
            onClear?.();
          }}
          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </span>
      )}
    </Button>
  );
}
