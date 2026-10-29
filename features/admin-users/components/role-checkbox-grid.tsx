"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ROLES,
  assignableRoles,
  removableRoles,
  type Access,
  type Role,
} from "@/lib/auth/permissions";

import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "../lib/role-labels";

export function RoleCheckboxGrid({
  selected,
  actorAccess,
  onChange,
  idPrefix,
  disabled,
}: {
  selected: Role[];
  actorAccess: Access;
  onChange: (roles: Role[]) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const addable = assignableRoles(actorAccess);
  const removable = removableRoles(actorAccess);
  const toggle = (role: Role, next: boolean) => {
    onChange(next ? [...selected, role] : selected.filter((r) => r !== role));
  };

  return (
    <div className="grid gap-3">
      {ROLES.map((role) => {
        const id = `${idPrefix}-${role}`;
        const isChecked = selected.includes(role);
        const allowed = isChecked
          ? removable.includes(role)
          : addable.includes(role);
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
              <Label htmlFor={id} className="text-sm font-medium leading-none">
                {ROLE_LABELS[role]}
              </Label>
              <p className="text-xs text-muted-foreground">
                {ROLE_DESCRIPTIONS[role]}
                {!allowed ? " · No podés cambiarlo." : ""}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
