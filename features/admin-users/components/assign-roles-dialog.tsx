"use client";

import { useEffect, useState, useTransition } from "react";
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
import { Label } from "@/components/ui/label";
import type { Role } from "@/lib/auth/permissions";

import { setUserRolesAction } from "../actions/users-actions";
import { RoleCheckboxGrid } from "./role-checkbox-grid";

export function AssignRolesDialog({
  open,
  onOpenChange,
  user,
  actorRoles,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  user: { id: string; email: string; roles: Role[] };
  actorRoles: Role[];
}) {
  const [selected, setSelected] = useState<Role[]>(user.roles);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) setSelected(user.roles);
  }, [open, user.roles]);

  function submit() {
    startTransition(async () => {
      const result = await setUserRolesAction({
        userId: user.id,
        roles: selected,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Roles actualizados.");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar roles</DialogTitle>
          <DialogDescription>
            {user.email}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label>Roles</Label>
          <RoleCheckboxGrid
            selected={selected}
            actorRoles={actorRoles}
            onChange={setSelected}
            idPrefix={`assign-${user.id}`}
            disabled={pending}
          />
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
