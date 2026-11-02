import type { AuditEventRow } from "../schema";

const UNKNOWN_USER = "Usuario eliminado";

/** Who did it: the user, the assistant with the user it acted for (the one
 *  who asked or approved), or the system. */
export function auditActorLabel(
  row: Pick<AuditEventRow, "actor_id" | "actor_type">,
  names: ReadonlyMap<string, string>,
): string {
  const user = row.actor_id ? (names.get(row.actor_id) ?? UNKNOWN_USER) : null;
  switch (row.actor_type) {
    case "system":
      return "Sistema";
    case "ai-agent":
      return user ? `Asistente IA (por ${user})` : "Asistente IA";
    case "user":
      return user ?? "Sistema";
  }
}
