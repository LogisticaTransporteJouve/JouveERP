"use client";

import { KeyRound } from "lucide-react";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatArgentineDateTime } from "@/lib/format";
import type { ArcaWebAccountStatus } from "@/lib/afip/arca-web-account";
import { formatCuitInput } from "@/lib/validation/cuit";

import {
  useArcaWebAccount,
  useSetArcaWebCredentials,
} from "../hooks/use-arca-web-account";

function statusText(s: ArcaWebAccountStatus): string {
  switch (s.state) {
    case "missing":
      return "Sin configurar";
    case "rejected":
      return "ARCA rechazó la clave: actualizala";
    case "disabled":
      return "Desactivado";
    case "ok":
      return s.lastSuccessAt
        ? `Funcionando · último acceso ${formatArgentineDateTime(s.lastSuccessAt)}`
        : "Configurado · todavía no se usó";
  }
}

function CredentialsDialog({
  status,
  open,
  onOpenChange,
}: {
  status: ArcaWebAccountStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const save = useSetArcaWebCredentials();
  const [cuit, setCuit] = useState(formatCuitInput(status.cuit ?? ""));
  const [password, setPassword] = useState("");
  const needsPassword = status.state === "missing";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    save.mutate(
      { cuit, password },
      {
        onSuccess: () => {
          toast.success("Usuario de ARCA guardado.");
          setPassword("");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Usuario de ARCA para Mis Comprobantes</DialogTitle>
          <DialogDescription>
            Usá un usuario al que DZ &amp; Sons le delegó solo el servicio Mis
            Comprobantes. La clave se guarda cifrada y no se vuelve a mostrar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="arca-web-cuit">CUIT del usuario</Label>
            <Input
              id="arca-web-cuit"
              value={cuit}
              onChange={(e) => setCuit(formatCuitInput(e.target.value))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="20-12345678-9"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="arca-web-password">Clave fiscal</Label>
            <Input
              id="arca-web-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={needsPassword ? "" : "Dejá vacío para no cambiarla"}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={save.isPending || (needsPassword && password === "")}
            >
              {save.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Admin → AFIP: the ARCA web user the robot downloads Recibidos with. */
export function ArcaWebAccountPanel() {
  const { data: status } = useArcaWebAccount();
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 font-medium">
            <KeyRound className="size-4" />
            Usuario de ARCA para Mis Comprobantes
          </h2>
          <p className="text-sm text-muted-foreground">
            {statusText(status)}
            {status.cuit ? ` · CUIT ${formatCuitInput(status.cuit)}` : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          {status.state === "missing" ? "Configurar" : "Cambiar"}
        </Button>
      </div>
      {open && (
        <CredentialsDialog status={status} open={open} onOpenChange={setOpen} />
      )}
    </section>
  );
}
