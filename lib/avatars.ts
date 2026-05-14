// Helpers para el subsistema de avatares. Compartidos entre componente,
// server actions y RPCs (`pick_default_avatar_color` en SQL espeja la
// misma lógica que `pickDefaultColor` en TS — si una cambia, cambiar la
// otra). Cobertura en `lib/avatars.test.ts`.

export const AVATAR_COLORS = [
  "gray",
  "blue",
  "sage",
  "orange",
  "purple",
] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

// Tonos neutrales por consistencia con el design system del proyecto
// (hue=0 en oklch). Si más adelante el dueño dice que no distingue los
// avatares, se cambian los `bg-neutral-*` por hues discretos.
const BG_BY_COLOR: Record<AvatarColor, string> = {
  gray: "bg-neutral-500",
  blue: "bg-neutral-600",
  sage: "bg-neutral-400",
  orange: "bg-neutral-700",
  purple: "bg-neutral-800",
};

export function getAvatarBgClass(color: string | null | undefined): string {
  if (color && isAvatarColor(color)) return BG_BY_COLOR[color];
  return BG_BY_COLOR.gray;
}

export function getInitials(
  first?: string | null,
  last?: string | null,
  fallback?: string | null,
): string {
  const f = first?.trim().charAt(0) ?? "";
  const l = last?.trim().charAt(0) ?? "";
  const combined = (f + l).toUpperCase();
  if (combined) return combined;
  // Fallback al email si no hay nombre todavía.
  if (fallback) {
    const c = fallback.trim().charAt(0).toUpperCase();
    if (c) return c;
  }
  return "?";
}

export function isAvatarColor(value: unknown): value is AvatarColor {
  return (
    typeof value === "string"
    && (AVATAR_COLORS as readonly string[]).includes(value)
  );
}

// Espejo del RPC `pick_default_avatar_color`. Si las dos divergen, los
// nuevos users tendrían un color distinto en BD que el que la UI
// asumiría — los tests verifican que ambas implementaciones produzcan
// el mismo resultado contra una muestra fija.
export function pickDefaultColor(userId: string): AvatarColor {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    const code = userId.charCodeAt(i);
    h = (h << 5) - h + code;
    h |= 0;
  }
  const index = Math.abs(h) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index]!;
}

export function getDisplayName(
  first?: string | null,
  last?: string | null,
  fallback?: string | null,
): string {
  const full = `${first?.trim() ?? ""} ${last?.trim() ?? ""}`.trim();
  if (full) return full;
  return fallback?.trim() || "Usuario";
}
