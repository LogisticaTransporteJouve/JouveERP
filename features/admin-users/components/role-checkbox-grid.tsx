"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ROLES,
  canAssignRole,
  type Role,
} from "@/lib/auth/permissions";

const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  finance: "Finanzas",
  operations: "Operaciones",
  warehouse: "Depósito",
  driver: "Chofer",
};

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Acceso total. Puede asignar cualquier rol.",
  admin: "Acceso total excepto modificar el rol owner.",
  finance: "Clientes, caja, comprobantes y cobranzas.",
  operations: "Flota, viajes, combustible, mantenimientos.",
  warehouse: "Pallets, productos, movimientos de stock.",
  driver: "Acceso de chofer (próximamente).",
};

export function RoleCheckboxGrid({
  selected,
  actorRoles,
  onChange,
  idPrefix,
  disabled,
}: {
  selected: Role[];
  actorRoles: Role[];
  onChange: (roles: Role[]) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const toggle = (role: Role, next: boolean) => {
    onChange(next ? [...selected, role] : selected.filter((r) => r !== role));
  };

  return (
    <div className="grid gap-3">
      {ROLES.map((role) => {
        const id = `${idPrefix}-${role}`;
        const allowed = canAssignRole(actorRoles, role);
        const isChecked = selected.includes(role);
        const isDisabled = disabled || !allowed;
        return (
          <div
            key={role}
            className="flex items-start gap-3 rounded-md border bg-background p-3"
          >
            <Checkbox
              id={id}
              checked={isChecked}
              disabled={isDisabled}
              onCheckedChange={(value) => toggle(role, value === true)}
            />
            <div className="grid gap-0.5 leading-tight">
              <Label
                htmlFor={id}
                className="text-sm font-medium leading-none"
              >
                {ROLE_LABELS[role]}
              </Label>
              <p className="text-xs text-muted-foreground">
                {ROLE_DESCRIPTIONS[role]}
                {!allowed ? " · Tu rol no puede asignarlo." : ""}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
