"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cn } from "@/lib/utils";

import { useGlobalSearch } from "../hooks/use-search";
import { ENTITY_LABEL } from "../schema";

export function GlobalSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  // Debounced so typing "transporte" issues one search, not ten.
  const debouncedQuery = useDebouncedValue(query, 250);
  const { data, isFetching } = useGlobalSearch(debouncedQuery);
  const results = data ?? [];

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIdx(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  function navigate(url: string) {
    router.push(url);
    onOpenChange(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[activeIdx]) {
      e.preventDefault();
      navigate(results[activeIdx].url);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
        <DialogTitle className="sr-only">Búsqueda global</DialogTitle>
        <div className="border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Buscar clientes, proveedores, comprobantes, recibos…"
              className="border-0 px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              autoFocus
            />
          </div>
        </div>

        <div className="max-h-[400px] overflow-y-auto py-2">
          {query.trim().length < 2 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Empezá a tipear para buscar (mínimo 2 caracteres).
            </p>
          ) : (isFetching || query !== debouncedQuery) &&
            results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Buscando…
            </p>
          ) : results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Sin resultados.
            </p>
          ) : (
            <ul>
              {results.map((r, i) => (
                <li key={`${r.entity_type}-${r.entity_id}`}>
                  <button
                    type="button"
                    onClick={() => navigate(r.url)}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm",
                      i === activeIdx && "bg-muted",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.title}</p>
                      {r.subtitle && (
                        <p className="truncate text-xs text-muted-foreground">
                          {r.subtitle}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs font-normal">
                      {ENTITY_LABEL[r.entity_type] ?? r.entity_type}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          ↑↓ navegar · ↵ abrir · esc cerrar
        </div>
      </DialogContent>
    </Dialog>
  );
}
