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
import {
  isPermission,
  userCan,
  type Access,
  type Permission,
  type Role,
} from "@/lib/auth/permissions";

import type { UserAccess } from "../actions/users-actions";
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
  // What the edits started from: sent as the stale-write check and compared
  // against to tell an edit from a no-op. Seeded once per open, from a settled
  // read, so a refetch never replaces edits in progress.
  const [base, setBase] = useState<UserAccess | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [denied, setDenied] = useState<Permission[]>([]);

  const canEditRoles = userCan(actorAccess, "users:assign_role");
  const canEditDenies = userCan(actorAccess, "users:manage_access");

  const seed = (from: UserAccess) => {
    setBase(from);
    setRoles(from.roles);
    setDenied(from.denied.filter(isPermission));
  };

  useEffect(() => {
    if (base === null && loaded.data && !loaded.isFetching) seed(loaded.data);
  }, [base, loaded.data, loaded.isFetching]);

  const pending = save.isPending;
  const ready = base !== null;
  const rolesChanged =
    base !== null && canEditRoles && !sameSet(roles, base.roles);
  const deniedChanged =
    base !== null &&
    canEditDenies &&
    !sameSet(denied, base.denied.filter(isPermission));
  // Someone else saved since this dialog loaded: the save would be refused.
  const outdated =
    base !== null &&
    loaded.data !== undefined &&
    (!sameSet(loaded.data.roles, base.roles) ||
      !sameSet(loaded.data.denied, base.denied));

  const close = (next: boolean) => {
    // Closing mid-save would unmount before the result toast.
    if (!next && pending) return;
    onOpenChange(next);
  };

  function submit() {
    if (base === null || (!rolesChanged && !deniedChanged)) return;
    save.mutate(
      {
        userId: user.id,
        roles: rolesChanged ? roles : null,
        denied: deniedChanged ? denied : null,
        expectedRoles: base.roles,
        expectedDenied: base.denied,
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
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl">
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
          <div className="max-h-[65vh] overflow-y-auto pr-3">
            <div className="grid gap-5">
              {outdated ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                  <span>
                    Otro cambio se guardó mientras editabas. Recargá para ver
                    los accesos actuales; se pierden tus cambios.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => loaded.data && seed(loaded.data)}
                  >
                    Recargar
                  </Button>
                </div>
              ) : null}
              <section className="grid gap-2">
                <h3 className="text-sm font-medium">Roles</h3>
                {canEditDenies ? (
                  <p className="text-xs text-muted-foreground">
                    Para dar acceso, sumá un rol; para recortarlo, denegá
                    módulos o acciones abajo.
                  </p>
                ) : null}
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
                  <h3 className="text-sm font-medium">Módulos y acciones</h3>
                  <PermissionMatrix
                    roles={roles}
                    denied={denied}
                    onChange={setDenied}
                    idPrefix={`deny-${user.id}`}
                    disabled={pending}
                  />
                  <p className="text-xs text-muted-foreground">
                    Ocultar un módulo quita todas sus acciones; denegar quita
                    solo esa acción. Rige en la aplicación: datos relacionados
                    pueden verse en otros módulos, y la base de datos sigue
                    limitando por rol.
                  </p>
                </section>
              ) : null}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => close(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={
              pending || !ready || outdated || (!rolesChanged && !deniedChanged)
            }
          >
            {pending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
