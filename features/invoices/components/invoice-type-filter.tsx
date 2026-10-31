"use client";

import { ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  INVOICE_LIST_TYPES,
  INVOICE_LIST_TYPE_LABEL,
  INVOICE_LIST_TYPE_SHORT,
  normalizeInvoiceListTypes,
  type InvoiceListType,
} from "../lib/invoice-list-filters";

/** Multi-select "Tipo" filter of the comprobantes list (e.g. Factura A + NC).
 *  Nothing checked means every type. */
export function InvoiceTypeFilter({
  value,
  onChange,
}: {
  value: InvoiceListType[];
  onChange: (next: InvoiceListType[]) => void;
}) {
  function toggle(type: InvoiceListType, checked: boolean) {
    onChange(
      normalizeInvoiceListTypes(
        checked ? [...value, type] : value.filter((t) => t !== type),
      ),
    );
  }

  const label =
    value.length === 0
      ? "Todos los tipos"
      : value.map((t) => INVOICE_LIST_TYPE_SHORT[t]).join(" + ");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label="Tipo"
          className="max-w-64 justify-between gap-2 font-normal"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        {INVOICE_LIST_TYPES.map((type) => {
          const id = `invoice-type-${type}`;
          return (
            <label
              key={type}
              htmlFor={id}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Checkbox
                id={id}
                checked={value.includes(type)}
                onCheckedChange={(checked) => toggle(type, checked === true)}
              />
              {INVOICE_LIST_TYPE_LABEL[type]}
            </label>
          );
        })}
        {value.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 w-full"
            onClick={() => onChange([])}
          >
            Todos los tipos
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
