"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { useJournalEntries } from "../hooks/use-journal-entries";
import { type JournalFilters } from "../schema";

import { JournalEntryRow } from "./journal-entry-row";
import { JournalFiltersBar } from "./journal-filters";
import { ManualEntryDialog } from "./manual-entry-dialog";

type Props = {
  channels: ReadonlyArray<{ id: string; name: string }>;
  initialFilters: JournalFilters;
};

export function JournalList({ channels, initialFilters }: Props) {
  const [filters, setFilters] = useState<JournalFilters>(initialFilters);
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const {
    items: entries,
    isFetching,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useJournalEntries(filters);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Libro diario</h1>
          <p className="text-sm text-muted-foreground">
            Asientos contables generados desde comprobantes, recibos,
            órdenes de pago y movimientos de caja.
          </p>
        </div>
        <Button onClick={() => setNewEntryOpen(true)}>
          <Plus />
          Nuevo asiento
        </Button>
      </div>

      <ManualEntryDialog open={newEntryOpen} onOpenChange={setNewEntryOpen} />

      <div className="rounded-lg border bg-card p-4">
        <JournalFiltersBar
          filters={filters}
          onChange={setFilters}
          channels={channels}
        />
      </div>

      <div className="rounded-lg border bg-card">
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">
          {entries.length} asientos cargados
          {isFetching && !isFetchingNextPage ? " · actualizando…" : ""}
        </div>
        {entries.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            Sin asientos para los filtros actuales.
          </div>
        ) : (
          <ul className="divide-y">
            {entries.map((e) => (
              <JournalEntryRow key={e.id} entry={e} />
            ))}
          </ul>
        )}
        {hasNextPage && (
          <div className="border-t p-3 text-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? "Cargando…" : "Cargar más"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
