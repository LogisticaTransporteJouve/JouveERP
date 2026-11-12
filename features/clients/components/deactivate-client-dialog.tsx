"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  DeactivateRecordDialog,
  ReactivateRecordButton,
} from "@/components/deactivate-record-dialog";

import {
  useClientReferences,
  useSetClientActive,
  useDeleteClient,
} from "../hooks/use-clients";
import type { Client } from "../schema";

export function DeactivateClientDialog({ client }: { client: Client }) {
  const [open, setOpen] = useState(false);
  const references = useClientReferences(client.id, { enabled: open });
  const deactivateMut = useSetClientActive();
  const deleteMut = useDeleteClient();

  function onDeactivate() {
    deactivateMut.mutate(
      { id: client.id, is_active: false },
      {
        onSuccess: () => {
          toast.success("Cliente desactivado.");
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function onDelete() {
    deleteMut.mutate(client.id, {
      onSuccess: () => {
        toast.success("Cliente eliminado.");
        setOpen(false);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <DeactivateRecordDialog
      title="Desactivar cliente"
      name={client.legal_name}
      cuit={client.cuit}
      open={open}
      onOpenChange={setOpen}
      references={references}
      isPending={deactivateMut.isPending || deleteMut.isPending}
      onDeactivate={onDeactivate}
      onDelete={onDelete}
    />
  );
}

export function ReactivateClientButton({ client }: { client: Client }) {
  const mut = useSetClientActive();

  function onReactivate() {
    mut.mutate(
      { id: client.id, is_active: true },
      {
        onSuccess: () => toast.success("Cliente reactivado."),
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
