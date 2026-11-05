"use client";

import { Power } from "lucide-react";
import { toast } from "sonner";

import { IconButton } from "@/components/ui/icon-button";

import { useSetClientActive } from "../hooks/use-clients";
import type { Client } from "../schema";

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
    <IconButton
      label="Reactivar"
      variant="ghost"
      onClick={onReactivate}
      disabled={mut.isPending}
    >
      <Power className="size-4" />
    </IconButton>
  );
}
