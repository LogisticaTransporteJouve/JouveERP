"use client";

import { useScope } from "@/components/providers/scope-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FISCAL_FILTERS, isFiscalFilter, SCOPE_LABEL } from "@/lib/scope";

export function ScopeSelector() {
  const { fiscalFilter, setFiscalFilter } = useScope();

  return (
    <Select
      value={fiscalFilter}
      onValueChange={(value) => {
        if (isFiscalFilter(value)) setFiscalFilter(value);
      }}
    >
      <SelectTrigger
        className="h-8 w-[130px] text-xs text-muted-foreground md:w-[160px]"
        aria-label="Tipo de canal"
      >
        <SelectValue placeholder="Tipo" />
      </SelectTrigger>
      <SelectContent position="popper" align="end" sideOffset={6}>
        {FISCAL_FILTERS.map((filter) => (
          <SelectItem key={filter} value={filter}>
            {SCOPE_LABEL[filter]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
