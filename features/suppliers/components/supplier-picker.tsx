"use client";

import { Building2, Plus, Search, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

import { getSupplierByIdAction } from "../actions/suppliers-actions";
import { useSuppliersSearch } from "../hooks/use-suppliers";
import { counterpartyIdentityLabel } from "@/features/clients/schema";

import {
  IVA_CONDITION_LABEL,
  type Supplier,
  type IvaCondition,
} from "../schema";
import { SupplierForm } from "./supplier-form";

export interface PickedSupplier {
  id: string;
  legal_name: string;
  display_name: string | null;
  cuit: string | null;
  iva_condition: IvaCondition | null;
  is_fiscal: boolean;
}

const RESULT_LIMIT = 8;

export type SuggestedNewSupplier = {
  legal_name: string | null;
  cuit: string | null;
};

export function SupplierPicker({
  value,
  onChange,
  isFiscal,
  autoFocus,
  suggestedNew,
}: {
  value: PickedSupplier | null;
  onChange: (supplier: PickedSupplier | null) => void;
  /** The document's side: Compras (true), Otras compras (false), or both
   *  (null, for treasury documents such as issued cheques). */
  isFiscal: boolean | null;
  autoFocus?: boolean;
  /** A counterparty that is not loaded yet: offers creating it prefilled. */
  suggestedNew?: SuggestedNewSupplier | null;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const debouncedQuery = useDebouncedValue(query.trim(), 200);

  const searchQuery = useSuppliersSearch(
    { query: debouncedQuery, onlyActive: true, limit: RESULT_LIMIT, isFiscal },
    { enabled: open },
  );
  const results = searchQuery.data?.suppliers ?? [];
  const isSearching = searchQuery.isFetching;

  function pick(supplier: Supplier) {
    onChange({
      id: supplier.id,
      legal_name: supplier.legal_name,
      display_name: supplier.display_name,
      cuit: supplier.cuit,
      iva_condition: supplier.iva_condition,
      is_fiscal: supplier.is_fiscal,
    });
    setOpen(false);
    setQuery("");
  }

  function clear() {
    onChange(null);
    setQuery("");
  }

  async function onCreateSuccess(id: string) {
    setShowCreate(false);
    const res = await getSupplierByIdAction(id);
    if (!res.ok || !res.data) return;
    const s = res.data;
    onChange({
      id: s.id,
      legal_name: s.legal_name,
      display_name: s.display_name,
      cuit: s.cuit,
      iva_condition: s.iva_condition,
      is_fiscal: s.is_fiscal,
    });
  }

  return (
    <>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">{value.legal_name}</p>
            <p className="text-xs text-muted-foreground font-mono">
              {counterpartyIdentityLabel(value)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Cambiar proveedor"
            onClick={clear}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por razón social, nombre fantasía o CUIT"
                  className="pl-8"
                  value={query}
                  autoFocus={autoFocus}
                  onFocus={() => setOpen(true)}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    if (!open) setOpen(true);
                  }}
                />
              </div>
            </PopoverTrigger>
            <PopoverContent
              className="w-[var(--radix-popover-trigger-width)] p-0"
              align="start"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <ResultsList
                results={results}
                isSearching={isSearching}
                onPick={pick}
                hasQuery={debouncedQuery.length > 0}
              />
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowCreate(true)}
            aria-label="Nuevo proveedor"
          >
            <Plus />
            Nuevo
          </Button>
        </div>
      )}

      {!value && suggestedNew && (
        <div className="mt-2 flex flex-col gap-2 rounded-md border border-dashed px-3 py-2 text-xs sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1">
            <span className="text-muted-foreground">
              El proveedor del comprobante no está cargado:{" "}
            </span>
            <span className="font-medium">
              {suggestedNew.legal_name ?? "sin razón social"}
            </span>
            {suggestedNew.cuit && (
              <span className="font-mono"> · CUIT {suggestedNew.cuit}</span>
            )}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowCreate(true)}
          >
            <Plus />
            Crear proveedor
          </Button>
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nuevo proveedor</DialogTitle>
            <DialogDescription>
              {isFiscal === false
                ? "Proveedor de Otras compras: sin CUIT ni AFIP."
                : "Ingresá el CUIT y verificá AFIP para autocompletar los datos."}
            </DialogDescription>
          </DialogHeader>
          <SupplierForm
            isFiscal={isFiscal ?? undefined}
            mode="create"
            initialValues={suggestedNew ?? undefined}
            onSuccess={onCreateSuccess}
            onCancel={() => setShowCreate(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function ResultsList({
  results,
  isSearching,
  onPick,
  hasQuery,
}: {
  results: Supplier[];
  isSearching: boolean;
  onPick: (supplier: Supplier) => void;
  hasQuery: boolean;
}) {
  if (isSearching) {
    return (
      <div className="px-3 py-4 text-center text-sm text-muted-foreground">
        Buscando…
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-sm text-muted-foreground">
        {hasQuery
          ? "Sin resultados. Probá creando un nuevo proveedor."
          : "Empezá a tipear o creá un nuevo proveedor."}
      </div>
    );
  }
  return (
    <ul className="max-h-[320px] overflow-y-auto py-1">
      {results.map((supplier) => (
        <li key={supplier.id}>
          <button
            type="button"
            onClick={() => onPick(supplier)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <Building2 className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{supplier.legal_name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {supplier.display_name && (
                  <span className="mr-2">{supplier.display_name}</span>
                )}
                {supplier.cuit && (
                  <span className="font-mono">CUIT {supplier.cuit}</span>
                )}
              </p>
            </div>
            {supplier.iva_condition && (
              <Badge
                variant="secondary"
                className="shrink-0 text-[10px] uppercase tracking-wide"
              >
                {IVA_CONDITION_LABEL[supplier.iva_condition]}
              </Badge>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
