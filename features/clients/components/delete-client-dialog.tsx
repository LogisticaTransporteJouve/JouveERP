"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
  deleteClientAction,
  getClientReferencesAction,
  setClientActiveAction,
  type ClientReferences,
} from "../actions/clients-actions";
import type { Client } from "../schema";

type Stage = "loading" | "ready" | "done";

export function DeleteClientDialog({ client }: { client: Client }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("loading");
  const [refs, setRefs] = useState<ClientReferences | null>(null);
  const [isPending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setStage("loading");
    setRefs(null);
    void (async () => {
      const res = await getClientReferencesAction(client.id);
      if (!res.ok) {
        toast.error(res.error);
        setOpen(false);
        return;
      }
      setRefs(res.data);
      setStage("ready");
    })();
  }

  function onDeactivate() {
    startTransition(async () => {
      const res = await setClientActiveAction({
        id: client.id,
        is_active: false,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Cliente desactivado.");
      setOpen(false);
      router.refresh();
    });
  }

  function onHardDelete() {
    startTransition(async () => {
      const res = await deleteClientAction(client.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Cliente eliminado.");
      setOpen(false);
      router.refresh();
    });
  }

  const hasRefs = (refs?.total ?? 0) > 0;
  const isAlreadyInactive = !client.is_active;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <DialogTitle>Eliminar cliente</DialogTitle>
          <DialogDescription>
            {client.legal_name} · CUIT {client.cuit}
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
              El cliente tiene movimientos asociados y{" "}
              <strong>no se puede eliminar</strong> para preservar el historial:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {Object.entries(refs!.details).map(([table, count]) => (
                <li key={table}>
                  {count} en <code className="text-xs">{table}</code>
                </li>
              ))}
            </ul>
            {isAlreadyInactive ? (
              <p className="text-muted-foreground">
                Ya está desactivado.
              </p>
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
