"use client";

import { useEffect, useState } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  isPermission,
  userCan,
  type Access,
  type Permission,
  type Role,
} from "@/lib/auth/permissions";

import { useSetUserAccess, useUserAccess } from "../hooks/use-admin-users";
import { PermissionMatrix } from "./permission-matrix";
import { RoleCheckboxGrid } from "./role-checkbox-grid";

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

export function AccessDialog({
  open,
  onOpenChange,
  user,
  actorAccess,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  user: { id: string; email: string };
  actorAccess: Access;
}) {
  const loaded = useUserAccess(user.id, open);
  const save = useSetUserAccess();
  const [roles, setRoles] = useState<Role[]>([]);
  const [denied, setDenied] = useState<Permission[]>([]);

  const canEditRoles = userCan(actorAccess, "users:assign_role");
  const canEditDenies = userCan(actorAccess, "users:manage_access");

  useEffect(() => {
    if (!loaded.data) return;
    setRoles(loaded.data.roles);
    setDenied(loaded.data.denied.filter(isPermission));
  }, [loaded.data]);

  const pending = save.isPending;
  const ready = loaded.data !== undefined;

  function submit() {
    if (!loaded.data) return;
    const rolesChanged = !sameSet(roles, loaded.data.roles);
    const deniedChanged = !sameSet(denied, loaded.data.denied);
    save.mutate(
      {
        userId: user.id,
        roles: canEditRoles && rolesChanged ? roles : null,
        denied: canEditDenies && deniedChanged ? denied : null,
        expectedRoles: loaded.data.roles,
        expectedDenied: loaded.data.denied,
      },
      {
        onSuccess: () => {
          toast.success("Accesos actualizados.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Accesos</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        {loaded.isError ? (
          <p className="text-sm text-muted-foreground">
            {loaded.error.message}
          </p>
        ) : !ready ? (
          <p className="text-sm text-muted-foreground">Cargando accesos…</p>
        ) : (
          <ScrollArea className="max-h-[65vh] pr-3">
            <div className="grid gap-5">
              <section className="grid gap-2">
                <Label>Roles</Label>
                <p className="text-xs text-muted-foreground">
                  Para dar acceso, sumá un rol; para recortarlo, denegá módulos
                  o acciones abajo.
                </p>
                <RoleCheckboxGrid
                  selected={roles}
                  actorAccess={actorAccess}
                  onChange={setRoles}
                  idPrefix={`access-${user.id}`}
                  disabled={pending || !canEditRoles}
                />
              </section>
              {canEditDenies ? (
                <section className="grid gap-2">
                  <Label>Módulos y acciones</Label>
                  <PermissionMatrix
                    roles={roles}
                    denied={denied}
                    onChange={setDenied}
                    idPrefix={`deny-${user.id}`}
                    disabled={pending}
                  />
                  <p className="text-xs text-muted-foreground">
                    Ocultar o denegar quita el módulo y sus acciones en la
                    aplicación. Datos relacionados pueden verse en otros
                    módulos, y la base de datos sigue limitando por rol.
                  </p>
                </section>
              ) : null}
            </div>
          </ScrollArea>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button onClick={submit} disabled={pending || !ready}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
