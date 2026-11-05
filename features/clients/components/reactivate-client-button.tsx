"use client";

import { Power } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

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
    <Button
      variant="ghost"
      size="icon"
      onClick={onReactivate}
      disabled={mut.isPending}
      aria-label="Reactivar"
      title="Reactivar"
    >
      <Power className="size-4" />
    </Button>
  );
}
