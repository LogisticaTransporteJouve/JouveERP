"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  DisabledHint,
  NO_CHANGES_REASON,
  firstReason,
} from "@/components/disabled-hint";
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

import type { StrixStatus } from "../actions/strix-actions";
import { useSetStrixCredentials } from "../hooks/use-vehicle-km";

/** The Strix user the km robot signs in with (owner and admin). */
export function StrixAccountDialog({
  status,
  open,
  onOpenChange,
}: {
  status: StrixStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const save = useSetStrixCredentials();
  const [username, setUsername] = useState(status.username ?? "");
  const [password, setPassword] = useState("");
  const needsPassword =
    status.state === "missing" ||
    (status.state === "rejected" &&
      username.trim() === (status.username ?? ""));
  const dirty = password !== "" || username.trim() !== (status.username ?? "");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    save.mutate(
      { username, password },
      {
        onSuccess: () => {
          toast.success("Usuario de Strix guardado.");
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
          <DialogTitle>Usuario de Strix</DialogTitle>
          <DialogDescription>
            El usuario con el que JouveERP entra a Strix Flotas para traer los
            km. La clave se guarda cifrada y no se vuelve a mostrar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="strix-username">Usuario (email)</Label>
            <Input
              id="strix-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              inputMode="email"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="strix-password">Clave</Label>
            <Input
              id="strix-password"
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
            <DisabledHint
              reason={firstReason(
                [!dirty, NO_CHANGES_REASON],
                [username.trim() === "", "Ingresá el usuario."],
                [needsPassword && password === "", "Ingresá la contraseña."],
              )}
            >
              <Button
                type="submit"
                disabled={
                  save.isPending ||
                  !dirty ||
                  username.trim() === "" ||
                  (needsPassword && password === "")
                }
              >
                {save.isPending ? "Guardando…" : "Guardar"}
              </Button>
            </DisabledHint>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
