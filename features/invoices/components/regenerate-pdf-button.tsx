"use client";

import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { useRegeneratePdf } from "../hooks/use-invoices";

export function RegeneratePdfButton({ id }: { id: string }) {
  const mut = useRegeneratePdf();

  function onClick() {
    mut.mutate(id, {
      onSuccess: () => toast.success("PDF regenerado."),
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={mut.isPending}
    >
      <RefreshCw className={mut.isPending ? "animate-spin" : undefined} />
      Regenerar PDF
    </Button>
  );
}
