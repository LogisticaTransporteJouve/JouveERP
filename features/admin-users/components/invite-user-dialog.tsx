"use client";

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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Role, Access } from "@/lib/auth/permissions";

import { useInviteUser } from "../hooks/use-admin-users";
import { RoleCheckboxGrid } from "./role-checkbox-grid";

export function InviteUserDialog({ actorAccess }: { actorAccess: Access }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<Role[]>([]);
  const inviteMut = useInviteUser();
  const pending = inviteMut.isPending;

  function reset() {
    setEmail("");
    setRoles([]);
  }

  function submit() {
    if (!email || roles.length === 0) {
      toast.error("Email y al menos un rol son obligatorios.");
      return;
    }
    inviteMut.mutate(
      { email, roles },
      {
        onSuccess: () => {
          toast.success("Invitación enviada.");
          reset();
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
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
              actorAccess={actorAccess}
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
