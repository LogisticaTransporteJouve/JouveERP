import type { ChannelMember } from "../types";

// Util para detectar dónde va el cursor respecto al último "@" del
// body, y si corresponde abrir/cerrar el popover de mention picker.

export type MentionCursor = {
  // posición del "@" en el body (inclusive).
  triggerStart: number;
  // texto del query entre el "@" y el cursor.
  query: string;
};

export function findMentionAtCursor(
  body: string,
  cursorPos: number,
): MentionCursor | null {
  if (cursorPos <= 0 || cursorPos > body.length) return null;
  // Buscamos atrás desde el cursor: el último "@" precedido por
  // whitespace o inicio de string, sin espacios entre el "@" y el
  // cursor (mientras escribís un nombre).
  let i = cursorPos - 1;
  while (i >= 0) {
    const ch = body[i];
    if (ch === "@") {
      const before = i > 0 ? body[i - 1] : null;
      if (before === null || (before !== undefined && /\s/.test(before))) {
        const query = body.slice(i + 1, cursorPos);
        if (/\s/.test(query)) return null;
        return { triggerStart: i, query };
      }
      return null;
    }
    if (ch && /\s/.test(ch)) return null;
    i--;
  }
  return null;
}

export function applyMention(
  body: string,
  cursor: MentionCursor,
  member: ChannelMember,
): { body: string; cursorPos: number } {
  const display = `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim()
    || (member.email?.split("@")[0] ?? "user");
  const before = body.slice(0, cursor.triggerStart);
  const after = body.slice(cursor.triggerStart + 1 + cursor.query.length);
  // Solo agregamos espacio si lo que sigue no es ya whitespace — evita
  // dobles espacios cuando picás un mention en medio del texto.
  const needsSpace = after.length === 0 || !/^\s/.test(after);
  const token = needsSpace ? `@${display} ` : `@${display}`;
  const next = `${before}${token}${after}`;
  return { body: next, cursorPos: before.length + token.length };
}

export function filterMembersByQuery(
  members: ChannelMember[],
  query: string,
  excludeUserId: string,
): ChannelMember[] {
  const q = query.trim().toLowerCase();
  const candidates = members.filter((m) => m.user_id !== excludeUserId);
  if (!q) return candidates.slice(0, 8);
  return candidates
    .filter((m) => {
      const fullName = `${m.first_name ?? ""} ${m.last_name ?? ""}`.toLowerCase();
      return fullName.includes(q) || (m.email ?? "").toLowerCase().includes(q);
    })
    .slice(0, 8);
}
