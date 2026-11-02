"use client";

import { ChevronsUpDown, Users } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { useTaskUsers } from "../hooks/use-tasks";

/** Label of a user for the task screens; one who lost tasks:read keeps a
 *  generic name. */
export function useUserLabels(): (id: string) => string {
  const { data: users } = useTaskUsers();
  const labels = useMemo(
    () => new Map(users.map((u) => [u.id, u.label])),
    [users],
  );
  return useCallback(
    (id: string) => labels.get(id) ?? "Usuario sin acceso a Tareas",
    [labels],
  );
}

export function assigneesSummary(
  ids: readonly string[],
  label: (id: string) => string,
): string {
  if (ids.length === 0) return "Sin responsables";
  if (ids.length <= 2) return ids.map(label).join(", ");
  return `${label(ids[0]!)} y ${ids.length - 1} más`;
}

/** Multi-select of the users who can be given a task. */
export function AssigneePicker({
  value,
  onChange,
  disabled,
  id,
}: {
  value: readonly string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  id?: string;
}) {
  const { data: users } = useTaskUsers();
  const label = useUserLabels();
  const [open, setOpen] = useState(false);
  const selected = new Set(value);
  // Someone assigned before losing access stays listed so they can be removed.
  const orphans = value.filter((v) => !users.some((u) => u.id === v));

  function toggle(userId: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(userId);
    else next.delete(userId);
    onChange([...next]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Users className="text-muted-foreground size-4 shrink-0" />
            <span className="truncate">{assigneesSummary(value, label)}</span>
          </span>
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <ul className="max-h-64 overflow-y-auto p-1">
          {[
            ...users.map((u) => ({ id: u.id, label: u.label })),
            ...orphans.map((o) => ({ id: o, label: label(o) })),
          ].map((u) => (
            <li key={u.id}>
              <label className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm">
                <Checkbox
                  checked={selected.has(u.id)}
                  onCheckedChange={(c) => toggle(u.id, c === true)}
                />
                <span className="truncate">{u.label}</span>
              </label>
            </li>
          ))}
          {users.length === 0 && orphans.length === 0 && (
            <li className="text-muted-foreground px-2 py-1.5 text-sm">
              No hay usuarios con acceso a Tareas.
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
