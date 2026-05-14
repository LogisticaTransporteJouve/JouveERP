# User avatars — Patrones

> Subsistema chiquito pero cross-cutting. Lo escribo aparte de chat porque
> el avatar aparece en sidebar, audit log, lista de assignees de tareas
> (Fase G), comments futuros, header — no es propiedad de una sola feature.
> Pensado para implementarse junto con chat (donde es indispensable) y
> reusarse en lo demás cuando aparezca.

---

## 1. Modelo de datos

Hoy `auth.users.raw_user_meta_data` está vacío excepto por lo que mete
Supabase. Podríamos guardar nombre + avatar ahí, pero conviene una tabla
propia en `public`:

- queryable con joins normales (no funciones JSON sobre auth schema),
- RLS limpia,
- migrable si después aparece "preferencias de usuario" como vecino,
- la columna `avatar_color` es derivable pero queremos que el usuario la
  pueda cambiar a mano si las default no le gustan.

```sql
-- supabase/migrations/<ts>_user_profiles.sql
create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  avatar_path text,                 -- key dentro del bucket "avatars", null si fallback
  avatar_color text not null default 'gray',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_profiles_avatar_color_valid
    check (avatar_color in ('gray','blue','sage','orange','purple'))
);

create trigger user_profiles_set_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- Auto-creación del profile cuando se crea un user en auth.
create or replace function public.handle_new_user_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_profiles (user_id, avatar_color)
  values (new.id, public.pick_default_avatar_color(new.id))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- Color determinístico por user_id (mismo hash del frontend).
create or replace function public.pick_default_avatar_color(p_user_id uuid)
returns text language sql immutable as $$
  select (array['gray','blue','sage','orange','purple'])[
    abs(hashtext(p_user_id::text)) % 5 + 1
  ];
$$;
```

**RLS:**

```sql
alter table public.user_profiles enable row level security;

-- Cualquier authenticated puede leer todos los profiles (avatar visible
-- en chat, audit, listados de assignees).
create policy "user_profiles_select_authenticated"
  on public.user_profiles for select to authenticated using (true);

-- Solo cada user puede editar el propio.
create policy "user_profiles_update_self"
  on public.user_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
```

---

## 2. Storage

Bucket `avatars` separado del bucket `files` del spec de archivos. Razones:

- **Visibilidad:** los avatares son visibles entre todos los users de la
  app — `files` no necesariamente. Usar un bucket público (con cache
  agresivo de CDN) simplifica la UI y mejora performance.
- **Tamaño:** 1 MB hard cap. PNG/JPG/WebP. No PDFs ni nada raro.
- **Lifecycle:** distinto. Si en el futuro se borran avatares viejos al
  cambiar foto, no afecta a `files`.

```sql
-- supabase/migrations/<ts>_avatars_storage.sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 1048576,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Read: público (bucket marcado public, no hace falta policy).
-- Upload: solo a tu propio path "{user_id}/{filename}".
create policy "avatars_upload_self"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1]::uuid = (select auth.uid())
  );

create policy "avatars_update_self"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1]::uuid = (select auth.uid())
  );

create policy "avatars_delete_self"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1]::uuid = (select auth.uid())
  );
```

**Path structure:** `{user_id}/{timestamp}.{ext}`. Timestamp en la key →
nuevos uploads no chocan con los viejos en CDN cache. El viejo se borra en
la server action de upload.

---

## 3. Componentes

### 3.1 Primitivo shadcn

Ya está agregado en `components/ui/avatar.tsx` desde la Fase A (es uno de
los componentes que pidió shadcn add). Wrapper de `@radix-ui/react-avatar`
con `<Avatar>`, `<AvatarImage>`, `<AvatarFallback>`.

### 3.2 `<UserAvatar>` — alto nivel

```tsx
// components/user-avatar.tsx
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { getInitials, getAvatarBgClass, type AvatarColor } from "@/lib/avatars";

type Size = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE_CLASSES: Record<Size, string> = {
  xs: "size-5 text-[8px]",
  sm: "size-7 text-[10px]",
  md: "size-8 text-xs",
  lg: "size-10 text-sm",
  xl: "size-16 text-lg",
};

type Props = {
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;   // public URL del bucket avatars
  color?: AvatarColor;
  size?: Size;
  className?: string;
  ring?: boolean;
};

export function UserAvatar({
  firstName,
  lastName,
  avatarUrl,
  color = "gray",
  size = "md",
  className,
  ring,
}: Props) {
  return (
    <Avatar
      className={cn(
        SIZE_CLASSES[size],
        ring && "ring-2 ring-background",
        className,
      )}
    >
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback
        className={cn(getAvatarBgClass(color), "text-white font-medium")}
      >
        {getInitials(firstName, lastName)}
      </AvatarFallback>
    </Avatar>
  );
}
```

### 3.3 Helpers

```ts
// lib/avatars.ts
export const AVATAR_COLORS = ["gray", "blue", "sage", "orange", "purple"] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

// Monocromo override: en JouveERP los "colores" del avatar son tonos de
// gris distintos (saturated only en escala neutra). Mantiene la decisión
// del design system de "sin colores de marca" pero permite distinguir
// usuarios entre sí.
const BG_BY_COLOR: Record<AvatarColor, string> = {
  gray:   "bg-neutral-500",
  blue:   "bg-neutral-600",
  sage:   "bg-neutral-400",
  orange: "bg-neutral-700",
  purple: "bg-neutral-800",
};

export function getAvatarBgClass(color: AvatarColor): string {
  return BG_BY_COLOR[color];
}

export function getInitials(
  first?: string | null,
  last?: string | null,
): string {
  const f = first?.trim().charAt(0) ?? "";
  const l = last?.trim().charAt(0) ?? "";
  return (f + l).toUpperCase() || "?";
}

// Para code paths que no tienen el color persistido (raro, hay default
// en BD). Determinístico por user_id.
export function pickDefaultColor(userId: string): AvatarColor {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h << 5) - h + userId.charCodeAt(i);
    h |= 0;
  }
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]!;
}
```

> **Nota sobre monocromo.** El paleta del proyecto es 100% neutral
> (oklch hue=0). Las 5 "AvatarColor" son tonos de gris distinguibles, no
> hues reales. Si más adelante el dueño dice "no distingo a quién es cada
> avatar", se pueden reemplazar los `bg-neutral-*` por hues discretos —
> es un cambio de 5 strings.

### 3.4 Donde se usa

| Lugar | Tamaño | Notas |
|---|---|---|
| Sidebar (footer, propio user) | `sm` | Reemplaza el email truncado del A.6. |
| Chat: lista de canales (DM/grupo) | `sm` | Stack de hasta 3 para grupos. |
| Chat: mensaje (al lado del bubble) | `sm` | Solo en el primer msg de un autor consecutivo. |
| Chat: header del canal | `md` | Solo en DM (avatar del otro user). |
| Admin/Users tabla | `sm` | Al lado del email. |
| Audit log (futuro) | `xs` | Inline con la acción. |
| Página de perfil del user | `xl` | Con botón "Cambiar foto". |

---

## 4. Server actions

### 4.1 Upload de avatar

```ts
// features/profile/actions/upload-avatar.ts
"use server";

import { requireUserContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

const MAX_BYTES = 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function uploadAvatarAction(formData: FormData) {
  const ctx = await requireUserContext();
  const supabase = await createClient();

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false as const, error: "Falta archivo." };
  if (file.size > MAX_BYTES) return { ok: false as const, error: "Máx 1 MB." };
  if (!ALLOWED.has(file.type)) return { ok: false as const, error: "Formato no permitido." };

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${ctx.userId}/${Date.now()}.${ext}`;

  // Borrar avatar previo si existía (best-effort).
  const { data: prev } = await supabase
    .from("user_profiles")
    .select("avatar_path")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (prev?.avatar_path) {
    await supabase.storage.from("avatars").remove([prev.avatar_path]);
  }

  const { error: upErr } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: false });
  if (upErr) return { ok: false as const, error: upErr.message };

  const { error: dbErr } = await supabase
    .from("user_profiles")
    .update({ avatar_path: path })
    .eq("user_id", ctx.userId);
  if (dbErr) {
    await supabase.storage.from("avatars").remove([path]);
    return { ok: false as const, error: dbErr.message };
  }

  return { ok: true as const, path };
}

export async function getPublicAvatarUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return data.publicUrl;
}
```

### 4.2 Update nombre + color

```ts
// features/profile/actions/update-profile.ts
"use server";

import { z } from "zod";
import { requireUserContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { AVATAR_COLORS } from "@/lib/avatars";

const Schema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  color: z.enum(AVATAR_COLORS),
});

export async function updateProfileAction(input: unknown) {
  const ctx = await requireUserContext();
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Datos inválidos." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_profiles")
    .update({
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      avatar_color: parsed.data.color,
    })
    .eq("user_id", ctx.userId);

  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}
```

---

## 5. Página de perfil

Una sola ruta `app/(dashboard)/profile/page.tsx`:

- Avatar grande (`xl`) con botón "Cambiar foto" (abre Dialog con dropzone).
- Inputs: nombre, apellido.
- Selector de color (5 swatches monocromos, el actual marcado).
- Botón "Guardar".

Sin Sheet derecho — Dialog centrado (convención del proyecto). No tocar
email ni password desde acá (Supabase Auth los maneja con su propio
flujo).

---

## 6. Plan de PRs

1. **`feat: user_profiles table + RLS + auto-create trigger`** — migración
   1, sin UI todavía. Backfill: para los users existentes (Fase B en
   adelante) un script o un seed.
2. **`feat: avatars bucket + storage policies`** — migración 2.
3. **`feat: UserAvatar component + helpers + sidebar swap`** — primer
   call site real, validamos el patrón.
4. **`feat: profile page (name + color + image)`** — server actions +
   page + dropzone.
5. (después, conforme aparecen call sites) — usar `UserAvatar` en chat,
   admin/users table, etc.

---

## 7. Decisiones cerradas

- **Tabla separada vs auth metadata:** tabla. Razón en §1.
- **Bucket dedicado:** sí. Razón en §2.
- **Avatar público vs signed:** público. Ya está adentro de la app
  (autenticación obliga llegar al `<img>`); el bucket público + CDN saca
  latencia de cada render.
- **Colores monocromos vs hues:** monocromos por consistencia con el
  design system. Reversible.
- **Foto auto-crop / aspect ratio:** no. El usuario sube cuadrada o se
  estira. Si molesta, sumar un cropper client-side (`react-easy-crop`) en
  un PR aparte.
