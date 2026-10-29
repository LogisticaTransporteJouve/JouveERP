"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  effectivePermissions,
  rolePermissions,
  roleGrants,
  type Permission,
  type Resource,
  type Role,
} from "@/lib/auth/permissions";

import {
  MODULE_RESOURCES,
  PERMISSION_GROUPS,
  permissionLabel,
  permissionsOf,
} from "../lib/permission-groups";
import { ROLE_LABELS } from "../lib/role-labels";

/**
 * The permissions the selected roles grant, grouped by module, with a deny
 * toggle per action and a "hide module" toggle where the module has a read
 * permission. What a toggle implies (hiding a module takes its actions, an
 * owner keeps everything) comes from lib/auth/permissions, the same rules the
 * server gates use.
 */
export function PermissionMatrix({
  roles,
  denied,
  onChange,
  idPrefix,
  disabled,
}: {
  roles: Role[];
  denied: Permission[];
  onChange: (denied: Permission[]) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  if (roles.includes("owner")) {
    return (
      <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        El owner tiene acceso total: no se le puede denegar nada.
      </p>
    );
  }

  const granted = rolePermissions(roles);
  if (granted.size === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin roles no tiene permisos que recortar.
      </p>
    );
  }

  const effective = effectivePermissions(roles, denied);
  const groups = (Object.keys(PERMISSION_GROUPS) as Resource[]).filter((r) =>
    permissionsOf(r).some((p) => granted.has(p)),
  );

  const set = (permission: Permission, deny: boolean) => {
    const rest = denied.filter((p) => p !== permission);
    onChange(deny ? [...rest, permission] : rest);
  };

  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">
        {effective.size} de {granted.size} permisos de sus roles activos.
      </p>
      {groups.map((resource) => {
        const readPermission = permissionsOf(resource).find((p) =>
          p.endsWith(":read"),
        );
        const canHide = MODULE_RESOURCES.includes(resource);
        const hidden =
          canHide &&
          readPermission !== undefined &&
          denied.includes(readPermission);
        const hideId = `${idPrefix}-${resource}-hide`;
        return (
          <div key={resource} className="rounded-md border bg-background p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">
                {PERMISSION_GROUPS[resource]}
              </p>
              {canHide ? (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={hideId}
                    checked={hidden}
                    disabled={disabled}
                    aria-label={`Ocultar el módulo ${PERMISSION_GROUPS[resource]}`}
                    onCheckedChange={(value) => {
                      if (readPermission) set(readPermission, value === true);
                    }}
                  />
                  <Label htmlFor={hideId} className="text-xs font-normal">
                    Ocultar módulo
                  </Label>
                </div>
              ) : null}
            </div>
            <ul className="mt-2 grid gap-1.5">
              {permissionsOf(resource)
                .filter((p) => granted.has(p))
                .map((permission) => {
                  const id = `${idPrefix}-${permission}`;
                  const implied = hidden && permission !== readPermission;
                  const viaRoles = roles
                    .filter((role) => roleGrants(role, permission))
                    .map((role) => ROLE_LABELS[role])
                    .join(", ");
                  return (
                    <li
                      key={permission}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span
                        className={
                          effective.has(permission)
                            ? ""
                            : "text-muted-foreground line-through"
                        }
                      >
                        {permissionLabel(permission)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {implied
                            ? "incluido por ocultar el módulo"
                            : `por ${viaRoles}`}
                        </span>
                      </span>
                      {permission === readPermission && canHide ? null : (
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={id}
                            checked={implied || denied.includes(permission)}
                            disabled={disabled || implied}
                            aria-label={`Denegar ${permissionLabel(permission)} en ${PERMISSION_GROUPS[resource]}`}
                            onCheckedChange={(value) =>
                              set(permission, value === true)
                            }
                          />
                          <Label htmlFor={id} className="text-xs font-normal">
                            Denegar
                          </Label>
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
