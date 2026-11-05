"use client";

import { Building2, Plus, Search, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ReadError } from "@/components/read-error";

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

import { getClientByIdAction } from "@/features/clients/actions/clients-actions";
import { ClientForm } from "@/features/clients/components/client-form";
import {
  useClientPickerAccess,
  useClientsSearch,
} from "@/features/clients/hooks/use-clients";
import {
  counterpartyIdentityLabel,
  IVA_CONDITION_LABEL,
  type Client,
  type IvaCondition,
} from "@/features/clients/schema";

export interface PickedClient {
  id: string;
  legal_name: string;
  display_name: string | null;
  cuit: string | null;
  iva_condition: IvaCondition | null;
  is_fiscal: boolean;
}

const RESULT_LIMIT = 8;

export function ClientPicker({
  value,
  onChange,
  isFiscal,
  autoFocus,
  disabled = false,
}: {
  value: PickedClient | null;
  onChange: (client: PickedClient | null) => void;
  /** The document's side: lists only Ventas (true) or Otras ventas clients;
   *  null lists both and offers no "Nuevo" (the side would be a guess). */
  isFiscal: boolean | null;
  autoFocus?: boolean;
  /** Shows the picked one read-only: an edit that cannot change it. */
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const debouncedQuery = useDebouncedValue(query.trim(), 200);

  const access = useClientPickerAccess();
  const readDenied = access?.canRead === false;
  const canCreate = isFiscal !== null && access?.canCreate === true;

  const searchQuery = useClientsSearch(
    { query: debouncedQuery, onlyActive: true, limit: RESULT_LIMIT, isFiscal },
    { enabled: open && !readDenied },
  );
  const results = searchQuery.data?.clients ?? [];
  const isSearching = searchQuery.isFetching;

  function pick(client: Client) {
    onChange({
      id: client.id,
      legal_name: client.legal_name,
      display_name: client.display_name,
      cuit: client.cuit,
      iva_condition: client.iva_condition,
      is_fiscal: client.is_fiscal,
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
    // A one-shot read of the client just created; a query cache entry would
    // buy nothing here.
    const res = await getClientByIdAction(id).catch(() => null);
    if (!res?.ok || !res.data) {
      toast.error(
        "El cliente se creó, pero no se pudo elegir: buscalo y elegilo.",
      );
      return;
    }
    const c = res.data;
    onChange({
      id: c.id,
      legal_name: c.legal_name,
      display_name: c.display_name,
      cuit: c.cuit,
      iva_condition: c.iva_condition,
      is_fiscal: c.is_fiscal,
    });
  }

  if (readDenied && !value) {
    return (
      <p className="text-sm text-muted-foreground">
        No tenés permiso para ver clientes.
      </p>
    );
  }
  if (disabled && !value) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
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
          {!disabled && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Cambiar cliente"
              onClick={clear}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={
                    isFiscal === false
                      ? "Buscar por nombre o nombre fantasía"
                      : "Buscar por razón social, nombre fantasía o CUIT"
                  }
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
                failed={searchQuery.isError}
                onRetry={() => void searchQuery.refetch()}
                canCreate={canCreate}
              />
            </PopoverContent>
          </Popover>
          {canCreate && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowCreate(true)}
              aria-label="Nuevo cliente"
            >
              <Plus />
              Nuevo
            </Button>
          )}
        </div>
      )}

      {canCreate && (
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Nuevo cliente</DialogTitle>
              <DialogDescription>
                {isFiscal
                  ? "Ingresá el CUIT y verificá AFIP para autocompletar los datos."
                  : "Cliente de Otras ventas: sin CUIT ni AFIP."}
              </DialogDescription>
            </DialogHeader>
            <ClientForm
              isFiscal={isFiscal}
              mode="create"
              onSuccess={onCreateSuccess}
              onCancel={() => setShowCreate(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function ResultsList({
  results,
  isSearching,
  onPick,
  hasQuery,
  failed,
  onRetry,
  canCreate,
}: {
  results: Client[];
  isSearching: boolean;
  onPick: (client: Client) => void;
  hasQuery: boolean;
  failed: boolean;
  onRetry: () => void;
  canCreate: boolean;
}) {
  if (isSearching) {
    return (
      <div className="px-3 py-4 text-center text-sm text-muted-foreground">
        Buscando…
      </div>
    );
  }
  // A failed search is not "no match": it would invite creating the party
  // again.
  if (failed) {
    return (
      <ReadError
        message="No se pudieron buscar los clientes."
        onRetry={onRetry}
        className="justify-center px-3 py-4"
      />
    );
  }
  if (results.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-sm text-muted-foreground">
        {hasQuery
          ? canCreate
            ? "Sin resultados. Probá creando un nuevo cliente."
            : "Sin resultados."
          : canCreate
            ? "Empezá a tipear o creá un nuevo cliente."
            : "Empezá a tipear para buscar."}
      </div>
    );
  }
  return (
    <ul className="max-h-[320px] overflow-y-auto py-1">
      {results.map((client) => (
        <li key={client.id}>
          <button
            type="button"
            onClick={() => onPick(client)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <Building2 className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{client.legal_name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {client.display_name && (
                  <span className="mr-2">{client.display_name}</span>
                )}
                {client.cuit && (
                  <span className="font-mono">CUIT {client.cuit}</span>
                )}
              </p>
            </div>
            {client.iva_condition && (
              <Badge
                variant="secondary"
                className="shrink-0 text-[10px] uppercase tracking-wide"
              >
                {IVA_CONDITION_LABEL[client.iva_condition]}
              </Badge>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
