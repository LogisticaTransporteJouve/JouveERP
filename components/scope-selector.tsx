"use client";

import { SlidersHorizontal } from "lucide-react";

import { useScope } from "@/components/providers/scope-provider";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

const DIVISION_SHORT: Record<Division, string> = {
  dz: "DZ",
  jouve: "Jouve",
};

const FISCAL_LABEL: Record<FiscalFilter, string> = {
  all: "Todos los canales",
  fiscal: "Solo fiscal",
  internal: "Solo interno",
};

const FISCAL_SHORT: Record<FiscalFilter, string> = {
  all: "Todos",
  fiscal: "Fiscal",
  internal: "Interno",
};

function ScopeSelects({ stacked }: { stacked: boolean }) {
  const { division, fiscalFilter, channels, setDivision, setFiscalFilter } =
    useScope();

  const availableDivisions = Array.from(
    new Set(channels.filter((c) => c.is_active).map((c) => c.division)),
  );

  return (
    <>
      <Select
        value={division ?? ALL_DIVISIONS}
        onValueChange={(value) => {
          setDivision(value === ALL_DIVISIONS ? null : isDivision(value) ? value : null);
        }}
      >
        <SelectTrigger
          className={
            stacked
              ? "h-9 w-full text-sm"
              : "h-8 w-[180px] text-xs text-muted-foreground"
          }
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
          className={
            stacked
              ? "h-9 w-full text-sm"
              : "h-8 w-[160px] text-xs text-muted-foreground"
          }
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
    </>
  );
}

export function ScopeSelector() {
  const { division, fiscalFilter } = useScope();

  const summary = `${division ? DIVISION_SHORT[division] : "Todas"} · ${FISCAL_SHORT[fiscalFilter]}`;

  return (
    <>
      <div className="hidden items-center gap-2 md:flex">
        <ScopeSelects stacked={false} />
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 max-w-[9.5rem] gap-1.5 px-2 text-xs text-muted-foreground md:hidden"
            aria-label="Alcance"
          >
            <SlidersHorizontal className="size-3.5 shrink-0" />
            <span className="truncate">{summary}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="flex w-64 flex-col gap-2 md:hidden"
        >
          <ScopeSelects stacked />
        </PopoverContent>
      </Popover>
    </>
  );
}
