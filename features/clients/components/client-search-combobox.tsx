"use client";

import { Check, ChevronsUpDown, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { useClientsSearch } from "../hooks/use-clients";

/**
 * Client picker that searches server-side as you type (nothing preloaded).
 * Clearable. Use when the client list is large. `value` is the selected id
 * (empty = none); `label` is its name for the trigger.
 */
export function ClientSearchCombobox({
  value,
  label,
  onChange,
  id,
  placeholder = "Buscar cliente…",
}: {
  value: string;
  label: string;
  onChange: (client: { id: string; name: string } | null) => void;
  id?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const enabled = query.trim().length >= 2;
  const { data, isFetching } = useClientsSearch(
    { query, onlyActive: true, limit: 25 },
    { enabled },
  );
  const results = data?.clients ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground",
          )}
        >
          <span className="truncate">{value ? label : placeholder}</span>
          {value ? (
            <span
              role="button"
              aria-label="Quitar endosante"
              className="shrink-0 rounded opacity-60 hover:opacity-100"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange(null);
              }}
            >
              <X className="size-4" />
            </span>
          ) : (
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={placeholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {!enabled ? (
              <p className="text-muted-foreground py-4 text-center text-xs">
                Escribí al menos 2 letras…
              </p>
            ) : isFetching ? (
              <p className="text-muted-foreground py-4 text-center text-xs">
                Buscando…
              </p>
            ) : results.length === 0 ? (
              <p className="text-muted-foreground py-4 text-center text-xs">
                Sin resultados.
              </p>
            ) : (
              results.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => {
                    onChange({ id: c.id, name: c.legal_name });
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-4",
                      c.id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{c.legal_name}</span>
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
