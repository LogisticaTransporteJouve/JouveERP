import "server-only";

import { listUserIdsWithPermission } from "@/lib/auth/users";

/** Why `ids` cannot be given a task, or null: each one must hold tasks:read
 *  (denies included), so a task only goes to who can open it. */
export async function assigneesError(
  ids: readonly string[],
): Promise<string | null> {
  if (ids.length === 0) return null;
  const holders = new Set(await listUserIdsWithPermission("tasks:read"));
  return ids.every((id) => holders.has(id))
    ? null
    : "Algún responsable no tiene acceso a Tareas.";
}
