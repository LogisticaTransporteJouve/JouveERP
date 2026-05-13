"use client";

import { ArrowLeft, FileMinus2, FilePlus2, Loader2, Search } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

import {
  useInvoiceDetailOnDemand,
  useOriginSearch,
} from "../hooks/use-invoices";
import { toOriginInvoice } from "../lib/origin";
import {
  KIND_BLURB,
  KIND_LABEL,
  NcNdForm,
  type Kind,
} from "./issue-nc-nd-dialog";

function formatInvoiceNumero(letter: string | null, pos: number, numero: number) {
  const padPos = String(pos).padStart(5, "0");
  const padNum = String(numero).padStart(8, "0");
  return `${letter ?? "X"} ${padPos}-${padNum}`;
}

function formatARS(amount: number) {
  return amount.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * NewNcNdDialog — variante "elegir origen primero". Dos states: picker y
 * form. El picker reusa `listInvoicesAction(status=emitted)` y filtra
 * fiscal+factura. Una vez elegido el origen, fetchea el detalle (items +
 * concepto + doc_nro) y monta `<NcNdForm>`. El back vuelve al picker
 * preservando lo que el usuario haya tipeado.
 */
export function NewNcNdDialog() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("nc");
  const [originId, setOriginId] = useState<string | null>(null);

  function reset() {
    setOriginId(null);
    setKind("nc");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileMinus2 />
          NC / ND
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {originId
              ? KIND_LABEL[kind]
              : "Emitir nota de crédito / débito"}
          </DialogTitle>
          <DialogDescription>
            {originId
              ? KIND_BLURB[kind]
              : "Elegí la factura origen. La letra, el POS y el cliente se heredan."}
          </DialogDescription>
        </DialogHeader>
        {open && !originId && (
          <OriginPicker
            kind={kind}
            onKindChange={setKind}
            onPick={setOriginId}
          />
        )}
        {open && originId && (
          <PickedOriginForm
            invoiceId={originId}
            kind={kind}
            onBack={() => setOriginId(null)}
            onSuccess={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function OriginPicker({
  kind,
  onKindChange,
  onPick,
}: {
  kind: Kind;
  onKindChange: (next: Kind) => void;
  onPick: (id: string) => void;
}) {
  const [queryInput, setQueryInput] = useState("");
  const debounced = useDebouncedValue(queryInput, 250);
  const { data: items = [], isFetching } = useOriginSearch(debounced);

  return (
    <div className="space-y-4">
      {/* Kind toggle */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant={kind === "nc" ? "default" : "outline"}
          size="sm"
          onClick={() => onKindChange("nc")}
        >
          <FileMinus2 className="size-4" />
          Nota de Crédito
        </Button>
        <Button
          type="button"
          variant={kind === "nd" ? "default" : "outline"}
          size="sm"
          onClick={() => onKindChange("nd")}
        >
          <FilePlus2 className="size-4" />
          Nota de Débito
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          placeholder="Buscar por cliente o número de factura"
          value={queryInput}
          onChange={(e) => setQueryInput(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Results */}
      <div className="rounded-md border">
        {isFetching && items.length === 0 ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Buscando…
          </div>
        ) : items.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {debounced.trim().length === 0
              ? "Las facturas fiscales emitidas más recientes aparecen acá."
              : "No se encontraron facturas que coincidan."}
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => onPick(it.id)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm hover:bg-accent"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="font-mono text-xs">
                      {formatInvoiceNumero(it.letter, it.punto_venta, it.numero)}
                    </span>
                    <span className="truncate">{it.client_legal_name}</span>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 text-xs">
                    <span className="font-mono">${formatARS(it.imp_total)}</span>
                    <span className="text-muted-foreground">{it.fecha}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PickedOriginForm({
  invoiceId,
  kind,
  onBack,
  onSuccess,
}: {
  invoiceId: string;
  kind: Kind;
  onBack: () => void;
  onSuccess: () => void;
}) {
  const { data: detail, isPending, error } = useInvoiceDetailOnDemand(invoiceId);

  if (isPending) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Cargando factura origen…
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-3 p-4">
        <p className="text-sm text-destructive">
          {error instanceof Error
            ? error.message
            : "No se pudo cargar la factura origen."}
        </p>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Volver
        </Button>
      </div>
    );
  }

  const origin = toOriginInvoice(detail);

  return (
    <div className="space-y-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="-ml-2"
      >
        <ArrowLeft className="size-4" />
        Cambiar factura origen
      </Button>
      <NcNdForm
        origin={origin}
        kind={kind}
        onSuccess={onSuccess}
        onCancel={onBack}
        cancelLabel="Volver"
      />
    </div>
  );
}
