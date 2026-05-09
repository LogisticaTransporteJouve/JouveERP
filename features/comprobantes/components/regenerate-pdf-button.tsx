"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { regeneratePdfAction } from "../actions/comprobantes-actions";

export function RegeneratePdfButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startPending] = useTransition();

  function onClick() {
    startPending(async () => {
      const res = await regeneratePdfAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("PDF regenerado.");
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={isPending}
    >
      <RefreshCw className={isPending ? "animate-spin" : undefined} />
      Regenerar PDF
    </Button>
  );
}
