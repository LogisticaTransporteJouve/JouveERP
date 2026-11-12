"use client";

import { Archive, Power } from "lucide-react";

import { ReadError } from "@/components/read-error";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatCuit } from "@/lib/validation/cuit";

type ReferencesRead = {
  data: { total: number } | undefined;
  isError: boolean;
  isLoading: boolean;
  refetch: () => unknown;
};

/**
 * Row action for a party (client, supplier): deactivating is the default,
 * because a party with movements can never be deleted. Deleting for good is
 * offered only once the references read says the party has none.
 */
export function DeactivateRecordDialog({
  title,
  name,
  cuit,
  open,
  onOpenChange,
  references,
  isPending,
  onDeactivate,
  onDelete,
}: {
  /** e.g. «Desactivar cliente». */
  title: string;
  name: string;
  cuit: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  references: ReferencesRead;
  isPending: boolean;
  onDeactivate: () => void;
  onDelete: () => void;
}) {
  const refs = references.data;
  const canDelete = refs !== undefined && refs.total === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <IconButton label="Desactivar" variant="ghost" disabled={isPending}>
          <Archive className="size-4" />
        </IconButton>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {name}
            {cuit ? ` · CUIT ${formatCuit(cuit)}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p>
            Queda guardado con todo su historial, pero deja de aparecer en la
            lista y al cargar comprobantes. Lo podés reactivar cuando quieras
            destildando «Solo activos».
          </p>

          {references.isError && !refs && (
            <ReadError
              message="No se pudo verificar si tiene movimientos asociados."
              onRetry={() => void references.refetch()}
            />
          )}

          {canDelete && (
            <p className="text-muted-foreground">
              No tiene movimientos asociados, así que también lo podés eliminar
              definitivamente. Eso no se puede deshacer.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          {canDelete && (
            <Button
              type="button"
              variant="outline"
              onClick={onDelete}
              disabled={isPending}
            >
              Eliminar definitivamente
            </Button>
          )}
          <Button type="button" onClick={onDeactivate} disabled={isPending}>
            {isPending ? "Desactivando…" : "Desactivar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReactivateRecordButton({
  isPending,
  onReactivate,
}: {
  isPending: boolean;
  onReactivate: () => void;
}) {
  return (
    <IconButton
      label="Reactivar"
      variant="ghost"
      onClick={onReactivate}
      disabled={isPending}
    >
      <Power className="size-4" />
    </IconButton>
  );
}
