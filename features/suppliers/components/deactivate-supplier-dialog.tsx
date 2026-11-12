"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  DeactivateRecordDialog,
  ReactivateRecordButton,
} from "@/components/deactivate-record-dialog";

import {
  useSupplierReferences,
  useSetSupplierActive,
  useDeleteSupplier,
} from "../hooks/use-suppliers";
import type { Supplier } from "../schema";

export function DeactivateSupplierDialog({ supplier }: { supplier: Supplier }) {
  const [open, setOpen] = useState(false);
  const references = useSupplierReferences(supplier.id, { enabled: open });
  const deactivateMut = useSetSupplierActive();
  const deleteMut = useDeleteSupplier();

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

  function onDelete() {
    deleteMut.mutate(supplier.id, {
      onSuccess: () => {
        toast.success("Proveedor eliminado.");
        setOpen(false);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <DeactivateRecordDialog
      title="Desactivar proveedor"
      name={supplier.legal_name}
      cuit={supplier.cuit}
      open={open}
      onOpenChange={setOpen}
      references={references}
      isPending={deactivateMut.isPending || deleteMut.isPending}
      onDeactivate={onDeactivate}
      onDelete={onDelete}
    />
  );
}

export function ReactivateSupplierButton({ supplier }: { supplier: Supplier }) {
  const mut = useSetSupplierActive();

  function onReactivate() {
    mut.mutate(
      { id: supplier.id, is_active: true },
      {
        onSuccess: () => toast.success("Proveedor reactivado."),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <ReactivateRecordButton
      isPending={mut.isPending}
      onReactivate={onReactivate}
    />
  );
}
