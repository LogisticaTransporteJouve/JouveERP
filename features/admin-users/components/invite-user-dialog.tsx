"use client";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Role } from "@/lib/auth/permissions";

import { inviteUserAction } from "../actions/users-actions";
import { RoleCheckboxGrid } from "./role-checkbox-grid";

export function InviteUserDialog({ actorRoles }: { actorRoles: Role[] }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const [pending, startTransition] = useTransition();

  function reset() {
    setEmail("");
    setRoles([]);
  }

  function submit() {
    if (!email || roles.length === 0) {
      toast.error("Email y al menos un rol son obligatorios.");
      return;
    }
    startTransition(async () => {
      const result = await inviteUserAction({ email, roles });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Invitación enviada.");
      reset();
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>Invitar usuario</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invitar usuario</DialogTitle>
          <DialogDescription>
            Se enviará un mail de activación. Los roles se asignan al
            confirmarse la cuenta.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={pending}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label>Roles iniciales</Label>
            <RoleCheckboxGrid
              selected={roles}
              actorRoles={actorRoles}
              onChange={setRoles}
              idPrefix="invite"
              disabled={pending}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Enviando…" : "Enviar invitación"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
