"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import {
  useDeleteSupplier,
  useSetSupplierActive,
  useSupplierReferences,
} from "../hooks/use-suppliers";
import type { Supplier } from "../schema";

export function DeleteSupplierDialog({ supplier }: { supplier: Supplier }) {
  const [open, setOpen] = useState(false);
  const refsQuery = useSupplierReferences(supplier.id, { enabled: open });
  const deactivateMut = useSetSupplierActive();
  const deleteMut = useDeleteSupplier();
  const isPending = deactivateMut.isPending || deleteMut.isPending;

  function onDeactivate() {
    deactivateMut.mutate(
      { id: supplier.id, is_active: false },
      {
        onSuccess: () => {
          toast.success("Proveedor desactivado.");
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function onHardDelete() {
    deleteMut.mutate(supplier.id, {
      onSuccess: () => {
        toast.success("Proveedor eliminado.");
        setOpen(false);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  const refs = refsQuery.data;
  const stage: "loading" | "ready" =
    refsQuery.isLoading || !refs ? "loading" : "ready";
  const hasRefs = (refs?.total ?? 0) > 0;
  const isAlreadyInactive = !supplier.is_active;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Eliminar"
          className="text-destructive hover:text-destructive"
          disabled={isPending}
        >
          <Trash2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Eliminar proveedor</DialogTitle>
          <DialogDescription>
            {supplier.legal_name}
            {supplier.cuit ? ` · CUIT ${supplier.cuit}` : ""}
          </DialogDescription>
        </DialogHeader>

        {stage === "loading" && (
          <p className="text-sm text-muted-foreground">
            Verificando si tiene movimientos asociados…
          </p>
        )}

        {stage === "ready" && hasRefs && (
          <div className="space-y-3 text-sm">
            <p>
              El proveedor tiene movimientos asociados y{" "}
              <strong>no se puede eliminar</strong> para preservar el historial:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {Object.entries(refs?.details ?? {}).map(([table, count]) => (
                <li key={table}>
                  {count} en <code className="text-xs">{table}</code>
                </li>
              ))}
            </ul>
            {isAlreadyInactive ? (
              <p className="text-muted-foreground">Ya está desactivado.</p>
            ) : (
              <p>
                Lo desactivamos: queda guardado pero deja de aparecer en las
                listas activas.
              </p>
            )}
          </div>
        )}

        {stage === "ready" && !hasRefs && (
          <div className="space-y-3 text-sm">
            <p>
              No tiene movimientos asociados, así que se puede{" "}
              <strong>eliminar definitivamente</strong>.
            </p>
            <p className="text-muted-foreground">
              Esta acción no se puede deshacer. Si preferís conservarlo, elegí
              desactivar.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          {stage === "ready" && hasRefs && !isAlreadyInactive && (
            <Button
              type="button"
              variant="destructive"
              onClick={onDeactivate}
              disabled={isPending}
            >
              {isPending ? "Desactivando…" : "Desactivar"}
            </Button>
          )}
          {stage === "ready" && !hasRefs && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={onDeactivate}
                disabled={isPending || isAlreadyInactive}
              >
                Desactivar
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={onHardDelete}
                disabled={isPending}
              >
                {isPending ? "Eliminando…" : "Eliminar"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
