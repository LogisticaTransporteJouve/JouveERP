"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ScopeSide } from "@/lib/scope";

/** Fiscal or interno, for a form opened from a page shared by both sides
 *  (Tesorería): the form then reads that side's channels and counterparties. */
export function SideSelect({
  value,
  onChange,
}: {
  value: ScopeSide;
  onChange: (side: ScopeSide) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="side-select" className="text-xs text-muted-foreground">
        Lado
      </Label>
      <Select
        value={value}
        onValueChange={(v) =>
          onChange(v === "internal" ? "internal" : "fiscal")
        }
      >
        <SelectTrigger id="side-select" className="h-8 w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="fiscal">Fiscal</SelectItem>
          <SelectItem value="internal">Interno</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
