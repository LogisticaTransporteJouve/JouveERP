import type { ChannelMember } from "../types";

// Utility to detect where the cursor is relative to the last "@" in the
// body, and whether the mention picker popover should open/close.

export type MentionCursor = {
  // position of the "@" in the body (inclusive).
  triggerStart: number;
  // query text between the "@" and the cursor.
  query: string;
};

export function findMentionAtCursor(
  body: string,
  cursorPos: number,
): MentionCursor | null {
  if (cursorPos <= 0 || cursorPos > body.length) return null;
  // Scan backwards from the cursor: the last "@" preceded by
  // whitespace or the start of the string, with no spaces between the "@"
  // and the cursor (while you're typing a name).
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
  // Only add a space if what follows isn't already whitespace — avoids
  // double spaces when you pick a mention in the middle of the text.
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
