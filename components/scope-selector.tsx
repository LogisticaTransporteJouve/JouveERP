"use client";

import { useScope } from "@/components/providers/scope-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isDivision, type Division, type FiscalFilter } from "@/lib/scope";

const ALL_DIVISIONS = "__all__";

const DIVISION_LABEL: Record<Division, string> = {
  dz: "DZ Instalaciones",
  jouve: "Logística Jouve",
};

const FISCAL_LABEL: Record<FiscalFilter, string> = {
  all: "Todos los canales",
  fiscal: "Solo fiscal",
  internal: "Solo interno",
};

export function ScopeSelector() {
  const { division, fiscalFilter, channels, setDivision, setFiscalFilter } =
    useScope();

  const availableDivisions = Array.from(
    new Set(channels.filter((c) => c.is_active).map((c) => c.division)),
  );

  return (
    <div className="flex items-center gap-2">
      <Select
        value={division ?? ALL_DIVISIONS}
        onValueChange={(value) => {
          setDivision(value === ALL_DIVISIONS ? null : isDivision(value) ? value : null);
        }}
      >
        <SelectTrigger
          className="h-8 w-[180px] text-xs text-muted-foreground"
          aria-label="División"
        >
          <SelectValue placeholder="División" />
        </SelectTrigger>
        <SelectContent position="popper" align="end" sideOffset={6}>
          <SelectItem value={ALL_DIVISIONS}>Todas las divisiones</SelectItem>
          {availableDivisions.map((div) => (
            <SelectItem key={div} value={div}>
              {DIVISION_LABEL[div]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={fiscalFilter}
        onValueChange={(value) => {
          if (value === "all" || value === "fiscal" || value === "internal") {
            setFiscalFilter(value);
          }
        }}
      >
        <SelectTrigger
          className="h-8 w-[160px] text-xs text-muted-foreground"
          aria-label="Tipo de canal"
        >
          <SelectValue placeholder="Tipo" />
        </SelectTrigger>
        <SelectContent position="popper" align="end" sideOffset={6}>
          <SelectItem value="all">{FISCAL_LABEL.all}</SelectItem>
          <SelectItem value="fiscal">{FISCAL_LABEL.fiscal}</SelectItem>
          <SelectItem value="internal">{FISCAL_LABEL.internal}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
