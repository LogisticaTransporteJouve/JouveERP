"use client";

import { Building2, ChevronsUpDown, Search, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

import { useClientsSearch } from "../hooks/use-clients";

export interface ClientFilterValue {
  id: string;
  legal_name: string;
}

const RESULT_LIMIT = 8;

/**
 * Compact client filter for list toolbars: a button that opens a search over
 * every client (active or not, since old documents belong to inactive ones).
 * Unlike `ClientPicker`, it never offers to create a client.
 */
export function ClientFilter({
  value,
  onChange,
}: {
  value: ClientFilterValue | null;
  onChange: (next: ClientFilterValue | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 200);

  const search = useClientsSearch(
    { query: debouncedQuery, onlyActive: false, limit: RESULT_LIMIT },
    { enabled: open },
  );
  const results = search.data?.clients ?? [];

  if (value) {
    return (
      <div className="flex h-9 max-w-64 items-center gap-1 rounded-md border pl-3 text-sm">
        <span className="truncate" title={value.legal_name}>
          {value.legal_name}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Quitar filtro de cliente"
          onClick={() => onChange(null)}
        >
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="justify-between gap-2 font-normal">
          Todos los clientes
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="relative border-b p-2">
          <Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Razón social, nombre o CUIT"
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {search.isFetching && results.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">
            Buscando…
          </p>
        ) : search.isError ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">
            No se pudieron buscar clientes.
          </p>
        ) : results.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">
            {debouncedQuery ? "Sin resultados." : "Empezá a tipear."}
          </p>
        ) : (
          <ul className="max-h-72 overflow-y-auto py-1">
            {results.map((client) => (
              <li key={client.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onChange({ id: client.id, legal_name: client.legal_name });
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Building2 className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {client.legal_name}
                    </span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      CUIT {client.cuit}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
