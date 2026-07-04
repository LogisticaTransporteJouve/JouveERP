# Files — Patrones de implementación

> Spec ejecutable para construir el subsistema de archivos del ERP. Mismo
> formato que `docs/ai-patterns.md`: pensado para tener todas las decisiones
> tomadas antes de abrir el primer PR de la fase. Las elecciones surgen de
> aplicar al stack actual (Next.js + Supabase Storage + Inngest + RLS) el
> patrón validado de "blob registry + n:1 attachments + async OCR".

> **Estado 2026-05-16.** K.10 implementa §1–§5 y §7–§10 (registry,
> attachments, bucket, RLS, upload/sign/detach, dropzone, lista, cron de
> huérfanos, permisos, tests) cableado solo a `purchase_invoices`. **§6
> (Quick OCR) queda diferido a Fase I.2** — la columna `quick_ocr` se crea
> en K.10a pero el worker se suma con la pata de IA, no antes. Spec de
> M.4 = extender entidades atachables sobre esta misma infra (sumar FKs a
> `file_attachments` + wire por feature).

---

## 0. Alcance

**Lo que cubre:**

- Subida de archivos por el usuario desde el frontend (comprobante recibido,
  remito escaneado, documentación de chofer/vehículo, comprobante de
  retención, ticket de gasto, foto de cheque físico, extracto bancario).
- **Soporte mobile nativo:** captura directa desde cámara con
  `capture="environment"` cuando la app se usa en celular (escanear un
  remito desde el camión, fotear el comprobante de retención que te
  acaban de dar, etc.). Sin user-agent sniffing — `pointer-coarse:`
  media query.
- Persistencia con metadata + asociación a entidades del negocio.
- Procesamiento asíncrono opcional (OCR rápido, embeddings, sugerencias).
- Lectura (signed URLs + preview en UI).
- Borrado con limpieza de huérfanos.
- RLS + storage policies.

**Lo que NO cubre (otros caminos, no este spec):**

- PDFs auto-generados por el sistema (facturas, recibos) — esos viven en
  `lib/pdf/` y se suben con service role; no pasan por este flow.
- Certificados/keys de AFIP — son env vars, no archivos de usuario.
- Avatares de usuario — Supabase Auth los maneja aparte.

**Casos de uso concretos que habilita** (no todos en la primera entrega):

| Caso | Fase | Entidad asociada |
|---|---|---|
| Comprobante recibido (factura proveedor) | I.2 | `invoices_received` (futura) |
| Documentación de chofer (licencia, ART) | G.6 | `drivers.id` |
| Documentación de vehículo (cédula, VTV, póliza) | G.6 | `vehicles.id` |
| Foto/PDF de cheque físico | F.2 (mejora) | `cheques.id` |
| Comprobante de retención escaneado | F.5 (mejora) | `receipt_retentions.id` |
| Extracto bancario para conciliación | J (futura) | `accounts.id` |
| Adjunto en mensaje del asistente AI | I.4 | `chat_messages.id` |

---

## 1. Modelo de datos

Dos tablas. El registry (`files`) guarda el blob y su metadata; la
asociación (`file_attachments`) liga ese blob a una entidad del negocio.
Un mismo archivo puede atarse a N entidades sin duplicar bytes.

### 1.1 Tabla `files`

```sql
create table public.files (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references auth.users(id),
  original_filename text not null,
  mime_type text,
  file_size bigint,
  bucket text not null default 'files',
  bucket_path text not null,
  source text not null,         -- "manual_upload" | "chat_attachment" | …
  quick_ocr text,               -- texto extraído (≤500 chars, lazy)
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  -- El path en storage nunca contiene el filename del usuario.
  constraint files_bucket_whitelist
    check (bucket in ('files')),  -- ampliar si hay buckets dedicados
  constraint files_bucket_path_no_traversal
    check (bucket_path !~ '(^|/)\.\.(/|$)'),
  constraint files_bucket_path_not_absolute
    check (bucket_path not like '/%')
);

create index idx_files_uploaded_by on public.files (uploaded_by);
-- Índice parcial para que Inngest pueda barrer pendientes de OCR sin escanear todo.
create index idx_files_quick_ocr_null on public.files (id) where quick_ocr is null;
```

**Por qué `bucket` como columna y no constant**: si más adelante aparece un
caso con políticas distintas (ej. `chat-attachments` con borrado a 30 días)
se agrega un bucket nuevo + se permite en el check. Hoy un solo bucket
`files` alcanza.

**Por qué `source` y no enum**: enums en Postgres son rígidos para migrar.
Texto + check constraint que se actualice en cada feature es suficiente.

### 1.2 Tabla `file_attachments`

```sql
create table public.file_attachments (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.files(id) on delete cascade,

  -- Una FK opcional por entidad atachable. Se agregan más en migraciones
  -- posteriores cuando aparezca el caso. Constraint asegura exactamente una.
  invoice_id uuid references public.invoices(id) on delete cascade,
  receipt_id uuid references public.receipts(id) on delete cascade,
  cheque_id uuid references public.cheques(id) on delete cascade,
  retention_id uuid references public.receipt_retentions(id) on delete cascade,
  -- futuras: driver_id, vehicle_id, trip_id, chat_message_id…

  kind text not null,           -- "comprobante" | "remito" | "doc_chofer" | …
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),

  constraint file_attachments_exactly_one_target
    check (
      (invoice_id is not null)::int +
      (receipt_id is not null)::int +
      (cheque_id is not null)::int +
      (retention_id is not null)::int = 1
    )
);

create index idx_file_attachments_file on public.file_attachments (file_id);
create index idx_file_attachments_invoice on public.file_attachments (invoice_id) where invoice_id is not null;
create index idx_file_attachments_receipt on public.file_attachments (receipt_id) where receipt_id is not null;
-- … uno por FK opcional
```

**Decisión "una FK por entidad" vs "polymorphic con (entity_type, entity_id)"**:
elegir FKs reales. Permite `on delete cascade` honesto, integridad referencial
real, y los joins se escriben sin trucos. El costo (una columna por entidad) es
chico — el set de entidades atachables crece despacio (5–8 en total al cierre
de Fase H).

**Por qué `kind` además del target**: una factura puede tener varias clases de
adjunto (PDF original del proveedor, foto del remito firmado, comprobante de
pago de retención). `kind` distingue sin acoplarlo a la tabla destino.

### 1.3 Vista de conveniencia (opcional, agregar cuando duela)

```sql
create view public.v_file_attachments_resolved as
select
  fa.id            as attachment_id,
  fa.kind,
  fa.created_at    as attached_at,
  f.id             as file_id,
  f.original_filename,
  f.mime_type,
  f.file_size,
  f.bucket,
  f.bucket_path,
  f.quick_ocr,
  coalesce(fa.invoice_id, fa.receipt_id, fa.cheque_id, fa.retention_id) as target_id,
  case
    when fa.invoice_id is not null then 'invoice'
    when fa.receipt_id is not null then 'receipt'
    when fa.cheque_id is not null then 'cheque'
    when fa.retention_id is not null then 'retention'
  end as target_type
from public.file_attachments fa
join public.files f on f.id = fa.file_id;
```

---

## 2. Storage layout

**Bucket:** `files` (privado, no público).

**Limites del bucket:**

- `file_size_limit`: 10 MB.
- `allowed_mime_types`: `application/pdf`, `image/png`, `image/jpeg`,
  `image/webp`, `text/csv`,
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
  `application/vnd.ms-excel`.

**Path structure:**

```
{file_id}.{ext}
```

Sin prefijo de tenant — la app es single-CUIT. Si en el futuro hace falta
particionar por canal o por año/mes (para lifecycle policies), se agrega un
prefijo y se migra con un script + columna `bucket_path` que ya admite
cualquier shape.

**Por qué no usar el filename original como key**: nombres con espacios,
unicode, caracteres no ASCII, longitudes >255, ataques con `../`. El
filename original vive solo en `files.original_filename`. La key de storage
es derivada y predecible:

```ts
// lib/files/storage-path.ts
function getSafeExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === filename.length - 1) return "";
  const ext = filename.slice(lastDot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "";
}

export function buildStorageKey(fileId: string, filename: string): string {
  const ext = getSafeExtension(filename);
  return ext ? `${fileId}.${ext}` : fileId;
}
```

---

## 3. RLS

### 3.1 Tabla `files`

Lectura: cualquier authenticated. Escritura: rol `finance` u `operations`
para subir; `owner|finance|operations` para borrar el propio o si tiene
`files:admin`. Ajustar a los permisos finales de la matriz cuando se cierre
la feature.

```sql
alter table public.files enable row level security;

create policy "files_select_authenticated"
  on public.files for select to authenticated using (true);

create policy "files_insert_self"
  on public.files for insert to authenticated
  with check (uploaded_by = (select auth.uid()));

create policy "files_delete_uploader_or_admin"
  on public.files for delete to authenticated
  using (
    uploaded_by = (select auth.uid())
    or public.user_has_role(array['owner', 'admin'])
  );
```

### 3.2 Tabla `file_attachments`

Mismo predicate: leer es libre dentro de la app, atachar requiere que el
usuario tenga permiso de escritura sobre la entidad destino. La validación
fina se hace en la server action (ya hay `userCan`); RLS es defense in depth.

```sql
alter table public.file_attachments enable row level security;

create policy "attachments_select_authenticated"
  on public.file_attachments for select to authenticated using (true);

create policy "attachments_insert_finance_or_ops"
  on public.file_attachments for insert to authenticated
  with check (public.user_has_role(array['owner','admin','finance','operations']));

create policy "attachments_delete_creator_or_admin"
  on public.file_attachments for delete to authenticated
  using (
    created_by = (select auth.uid())
    or public.user_has_role(array['owner','admin'])
  );
```

### 3.3 Storage bucket

Las policies del bucket validan **contra la fila en `public.files`**, no contra
el path crudo. Esto asegura que un usuario que adivine un UUID no pueda leer
nada que no esté registrado.

```sql
-- SELECT: solo si existe la fila en files y el caller pasa la RLS de files.
create policy "files_storage_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'files'
    and exists (
      select 1 from public.files f
      where f.bucket = 'files' and f.bucket_path = storage.objects.name
    )
  );

-- INSERT: el caller arma la key con un UUID que él generó. La fila en files
-- todavía no existe en el momento del INSERT (storage va primero). Lo que
-- chequeamos acá es que el path tenga el shape esperado.
create policy "files_storage_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'files'
    and name ~ '^[0-9a-f-]{36}(\.[a-z0-9]{1,8})?$'
  );

-- DELETE: solo si la fila en files admite delete por RLS.
create policy "files_storage_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'files'
    and exists (
      select 1 from public.files f
      where f.bucket = 'files' and f.bucket_path = storage.objects.name
    )
  );
```

---

## 4. Flujo de upload

**Orden:** storage write **primero**, DB insert **después**, attach al final.
No es ACID (Supabase no expone transacciones cross-storage/DB); el rollback
es manual. Aceptable porque RLS bloquea acceso a huérfanos y un sweep
periódico los limpia.

```
┌────────────────────────────────────────────────────────────────┐
│ 1. Cliente: validar (mime, size) y POSTear FormData            │
│ 2. Server action:                                              │
│    a. Re-validar (defense in depth)                            │
│    b. Generar fileId (crypto.randomUUID)                       │
│    c. buildStorageKey(fileId, filename)                        │
│    d. supabase.storage.from('files').upload(key, blob)         │
│       └─► en error: return                                     │
│    e. supabase.from('files').insert({ id: fileId, … })         │
│       └─► en error: storage.remove([key]); return              │
│    f. supabase.from('file_attachments').insert({               │
│         file_id: fileId, <target_id>, kind                     │
│       })                                                       │
│       └─► en error: files.delete + storage.remove; return      │
│    g. inngest.send('files/uploaded', { file_id }) [opcional]  │
└────────────────────────────────────────────────────────────────┘
```

### 4.1 Server action

```ts
// features/files/actions/upload.ts
"use server";

import { z } from "zod";
import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { buildStorageKey } from "@/lib/files/storage-path";
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

const AttachTargetSchema = z.discriminatedUnion("targetType", [
  z.object({ targetType: z.literal("invoice"), targetId: z.string().uuid() }),
  z.object({ targetType: z.literal("receipt"), targetId: z.string().uuid() }),
  z.object({ targetType: z.literal("cheque"),  targetId: z.string().uuid() }),
  z.object({ targetType: z.literal("retention"), targetId: z.string().uuid() }),
]);

const KIND_BY_TARGET: Record<string, string[]> = {
  invoice:   ["comprobante", "remito"],
  receipt:   ["comprobante_pago"],
  cheque:    ["foto_cheque"],
  retention: ["certificado_retencion"],
};

export type UploadResult =
  | { ok: true; file_id: string; attachment_id: string }
  | { ok: false; error: string };

export async function uploadFileAction(formData: FormData): Promise<UploadResult> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "files:write")) {
    return { ok: false, error: "Sin permisos para subir archivos." };
  }

  const file = formData.get("file");
  const target = AttachTargetSchema.safeParse({
    targetType: formData.get("targetType"),
    targetId: formData.get("targetId"),
  });
  const kind = String(formData.get("kind") ?? "");
  if (!(file instanceof File)) return { ok: false, error: "Archivo faltante." };
  if (!target.success) return { ok: false, error: "Destino inválido." };
  if (!KIND_BY_TARGET[target.data.targetType]?.includes(kind)) {
    return { ok: false, error: `kind "${kind}" no permitido para ${target.data.targetType}.` };
  }
  if (file.size > MAX_BYTES) return { ok: false, error: "El archivo supera 10 MB." };
  if (!ALLOWED_MIME.has(file.type)) return { ok: false, error: `Tipo no permitido (${file.type}).` };

  const supabase = await createClient();
  const fileId = crypto.randomUUID();
  const bucketPath = buildStorageKey(fileId, file.name);

  // (d) storage
  const { error: upErr } = await supabase.storage
    .from("files")
    .upload(bucketPath, file, { cacheControl: "3600", upsert: false });
  if (upErr) {
    logger.warn("files.upload_storage_failed", { err: upErr.message });
    return { ok: false, error: "No se pudo subir el archivo." };
  }

  // (e) registry
  const { error: dbErr } = await supabase.from("files").insert({
    id: fileId,
    uploaded_by: ctx.userId,
    original_filename: file.name,
    mime_type: file.type,
    file_size: file.size,
    bucket: "files",
    bucket_path: bucketPath,
    source: "manual_upload",
  });
  if (dbErr) {
    await supabase.storage.from("files").remove([bucketPath]);
    logger.warn("files.upload_db_failed", { err: dbErr.message });
    return { ok: false, error: "No se pudo registrar el archivo." };
  }

  // (f) attach
  const attachRow: Record<string, unknown> = {
    file_id: fileId,
    kind,
    created_by: ctx.userId,
    [`${target.data.targetType}_id`]: target.data.targetId,
  };
  const { data: att, error: attErr } = await supabase
    .from("file_attachments")
    .insert(attachRow)
    .select("id")
    .single();
  if (attErr || !att) {
    await supabase.from("files").delete().eq("id", fileId);
    await supabase.storage.from("files").remove([bucketPath]);
    logger.warn("files.attach_failed", { err: attErr?.message });
    return { ok: false, error: "No se pudo asociar el archivo." };
  }

  // (g) trigger async OCR si aplica
  if (file.type === "application/pdf" || file.type.startsWith("image/")) {
    await inngest.send({
      name: "files/uploaded",
      data: { file_id: fileId },
    });
  }

  return { ok: true, file_id: fileId, attachment_id: att.id };
}
```

### 4.2 Validación cliente

Mismo whitelist en el dropzone. La validación cliente es UX (feedback
instantáneo, accept del `<input>`); la server action revalida porque el
cliente miente.

---

## 5. Lectura

### 5.1 Signed URLs

Una hora de validez. La server action lee la metadata (RLS gate) y devuelve
un signed URL que el cliente consume directo de Supabase Storage. No hay
proxy intermedio — escalaría mal y no agrega seguridad real.

```ts
// features/files/actions/sign.ts
"use server";

import { requireUserContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export async function getSignedFileUrlAction(
  fileId: string,
): Promise<{ ok: true; url: string; filename: string; mime: string | null }
        | { ok: false; error: string }> {
  await requireUserContext();
  const supabase = await createClient();

  const { data: file, error } = await supabase
    .from("files")
    .select("bucket, bucket_path, original_filename, mime_type")
    .eq("id", fileId)
    .maybeSingle();
  if (error || !file) return { ok: false, error: "Archivo no encontrado." };

  const { data, error: sigErr } = await supabase.storage
    .from(file.bucket)
    .createSignedUrl(file.bucket_path, 3600, {
      download: file.original_filename,
    });
  if (sigErr) return { ok: false, error: sigErr.message };

  return {
    ok: true,
    url: data.signedUrl,
    filename: file.original_filename,
    mime: file.mime_type,
  };
}
```

`createSignedUrl(path, ttl, { download })` agrega `Content-Disposition:
attachment` con el filename original — así el navegador descarga "Factura
1234.pdf" y no "uuid.pdf".

### 5.2 Preview

Componentes en `components/file-preview/`:

- `FilePreviewImage` → `<img src={signedUrl} />`.
- `FilePreviewPdf` → `react-pdf` (ya está en `dependencies`, lo usa el viewer
  de comprobantes).
- `FilePreviewSpreadsheet` → opcional, parsea client-side con SheetJS si se
  necesita. No incluir en el primer PR.

Type guards:

```ts
// lib/files/preview.ts
export const isImage       = (m?: string | null) => !!m?.startsWith("image/");
export const isPdf         = (m?: string | null) => m === "application/pdf";
export const isSpreadsheet = (m?: string | null) =>
  m === "text/csv" ||
  m === "application/vnd.ms-excel" ||
  m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
```

---

## 6. Procesamiento asíncrono (Inngest)

> **Diferido a Fase I.2 (2026-05-16).** El subsistema files de K.10 NO
> implementa OCR — solo crea la columna `quick_ocr` para que I.2 la llene
> sin migración. Las secciones §6.1–§6.4 son la referencia para cuando
> llegue I.2; al momento de codearlas, revisar si Inngest sigue siendo el
> mejor transporte vs. `after()` + pool en server action (patrón usado en
> `sumary copy`). La decisión se cierra cuando arranque I.1 (Vercel AI
> SDK), no antes.

### 6.1 Evento

```ts
// lib/inngest/events.ts (sumar al archivo existente)
export const FILE_UPLOADED = "files/uploaded";

export const FileUploadedSchema = z.object({
  file_id: z.string().uuid(),
});
```

### 6.2 Función — Quick OCR

```ts
// lib/inngest/functions/files-quick-ocr.ts
import { inngest } from "../client";
import { FILE_UPLOADED, FileUploadedSchema } from "../events";
import { getServiceClient } from "@/lib/supabase/service";
import { extractQuickInsight } from "@/lib/files/quick-ocr";
import { logger } from "@/lib/logger";

export const filesQuickOcr = inngest.createFunction(
  {
    id: "files-quick-ocr",
    name: "Files — Quick OCR",
    triggers: [{ event: FILE_UPLOADED }],
    retries: 2,
    idempotency: "event.data.file_id",
  },
  async ({ event, step }) => {
    const { file_id } = FileUploadedSchema.parse(event.data);

    const file = await step.run("load-metadata", async () => {
      const supabase = getServiceClient();
      const { data, error } = await supabase
        .from("files")
        .select("id, bucket, bucket_path, mime_type, original_filename, quick_ocr")
        .eq("id", file_id)
        .maybeSingle();
      if (error) throw new Error(`load: ${error.message}`);
      return data;
    });

    if (!file) return { status: "skipped", reason: "not_found" };
    if (file.quick_ocr !== null) return { status: "skipped", reason: "already_ocrd" };

    const text = await step.run("extract", async () => {
      const supabase = getServiceClient();
      const { data: blob, error } = await supabase.storage
        .from(file.bucket)
        .download(file.bucket_path);
      if (error || !blob) throw new Error(`download: ${error?.message}`);
      return extractQuickInsight(
        await blob.arrayBuffer(),
        file.mime_type ?? "",
        file.original_filename,
      );
    });

    await step.run("persist", async () => {
      const supabase = getServiceClient();
      const { error } = await supabase
        .from("files")
        .update({ quick_ocr: text.slice(0, 500) })
        .eq("id", file_id);
      if (error) throw new Error(`persist: ${error.message}`);
    });

    logger.info("files.quick_ocr.done", { file_id, chars: text.length });
    return { status: "completed", chars: text.length };
  },
);
```

Registrar en `app/api/inngest/route.ts` agregándola al array de
`functions`.

### 6.3 Engine de OCR

`lib/files/quick-ocr.ts` discrimina por MIME:

| MIME | Estrategia |
|---|---|
| `text/csv`, `application/vnd.ms-excel`, `…spreadsheetml.sheet` | Parse local (no LLM): primera fila + 5 sample rows. |
| `application/pdf`, `image/*` | Llamada a Claude Haiku con el binario como `file`/`image`. Prompt corto (ver `docs/ai-patterns.md` para el patrón de prompt caching). |
| otros | Devuelve `""`. |

Tope de salida: 500 chars (cabe en una columna `text` indexable a futuro,
suficiente para fuzzy matching). Temperature 0. La idea es **clues for
matching**, no transcripción completa.

### 6.4 Embeddings — descartado

Decisión 2026-07-04: no se agrega pgvector ni embeddings de archivos (infra
paga nueva sin caso de uso). La búsqueda de archivos queda por metadatos +
`quick_ocr` + FTS.

---

## 7. Borrado y huérfanos

### 7.1 Caso normal — desadjuntar de una entidad

```ts
// features/files/actions/detach.ts
"use server";

import { requireUserContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export async function detachFileAction(attachmentId: string) {
  await requireUserContext();
  const supabase = await createClient();

  // Cargar el file_id antes de borrar la attachment para chequear huérfanos.
  const { data: att, error } = await supabase
    .from("file_attachments")
    .select("file_id, files(bucket, bucket_path)")
    .eq("id", attachmentId)
    .single();
  if (error || !att) return { ok: false as const, error: "No encontrado." };

  const { error: delErr } = await supabase
    .from("file_attachments")
    .delete()
    .eq("id", attachmentId);
  if (delErr) return { ok: false as const, error: delErr.message };

  // Si era la última asociación → borrar el blob también.
  const { count } = await supabase
    .from("file_attachments")
    .select("id", { count: "exact", head: true })
    .eq("file_id", att.file_id);

  if (count === 0) {
    const file = att.files as { bucket: string; bucket_path: string } | null;
    if (file) {
      await supabase.storage.from(file.bucket).remove([file.bucket_path]);
      await supabase.from("files").delete().eq("id", att.file_id);
    }
  }

  return { ok: true as const };
}
```

### 7.2 Cron de huérfanos (defensivo)

Para barrer huérfanos producto de inserts fallidos a mitad del flow o
attachments borradas en cascade. Una vez por día alcanza.

```ts
// lib/inngest/functions/files-sweep-orphans.ts
export const filesSweepOrphans = inngest.createFunction(
  { id: "files-sweep-orphans", name: "Files — sweep orphans" },
  { cron: "TZ=America/Argentina/Buenos_Aires 0 3 * * *" },
  async ({ step }) => {
    const orphans = await step.run("find-orphans", async () => {
      const supabase = getServiceClient();
      // Files sin attachments AND con más de 1 hora de antigüedad
      // (evita matar uploads en vuelo).
      const { data } = await supabase.rpc("find_orphan_files", { p_max_age: "1 hour" });
      return data ?? [];
    });

    for (const f of orphans) {
      await step.run(`delete-${f.id}`, async () => {
        const supabase = getServiceClient();
        await supabase.storage.from(f.bucket).remove([f.bucket_path]);
        await supabase.from("files").delete().eq("id", f.id);
      });
    }

    return { swept: orphans.length };
  },
);
```

RPC asociada:

```sql
create or replace function public.find_orphan_files(p_max_age interval default '1 hour')
returns table (id uuid, bucket text, bucket_path text)
language sql stable security definer set search_path = public as $$
  select f.id, f.bucket, f.bucket_path
  from public.files f
  left join public.file_attachments fa on fa.file_id = f.id
  where fa.id is null
    and f.created_at < now() - p_max_age;
$$;
revoke all on function public.find_orphan_files(interval) from public;
grant execute on function public.find_orphan_files(interval) to service_role;
```

---

## 8. Frontend

### 8.1 Dropzone (desktop + mobile aware)

Una sola implementación que se comporta distinto según el dispositivo:

- **Desktop:** drag & drop área grande + botón "Elegir archivo" (file
  picker del OS).
- **Mobile:** drag & drop se oculta (no aplica) y aparecen **dos botones**
  visibles: **"Tomar foto"** (abre cámara directo gracias a
  `capture="environment"`) y **"Elegir archivo"** (file picker del OS, que
  en iOS/Android ya muestra "Cámara / Fotos / Archivos" como opciones).

La detección no requiere user-agent sniffing: usamos un media query
(`pointer: coarse`) que ya viene calibrado por el browser para distinguir
touch-first de mouse-first. Tailwind expone `pointer-coarse:` /
`pointer-fine:` variants.

```tsx
// components/files/file-dropzone.tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Upload } from "lucide-react";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.csv,.xls,.xlsx";
const ACCEPT_CAMERA = "image/*"; // la cámara solo emite imágenes
const MAX_BYTES = 10 * 1024 * 1024;

type Props = {
  onFile: (file: File) => void;
  disabled?: boolean;
  // Si el caller solo acepta imágenes (ej. foto de cheque), pasa true para
  // que el botón "Elegir archivo" también restrinja accept.
  imagesOnly?: boolean;
};

export function FileDropzone({ onFile, disabled, imagesOnly }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const validateAndEmit = useCallback(
    (file: File) => {
      if (file.size > MAX_BYTES) return alert("Máx 10 MB.");
      onFile(file);
    },
    [onFile],
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) validateAndEmit(f);
      }}
      className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 ${
        dragOver ? "bg-accent" : ""
      }`}
    >
      <Upload className="size-5 text-muted-foreground pointer-coarse:hidden" />
      <p className="text-sm text-muted-foreground pointer-coarse:hidden">
        Arrastrá un archivo o
      </p>

      <div className="flex flex-col gap-2 pointer-coarse:w-full sm:flex-row">
        {/* Botón cámara: solo aparece en dispositivos touch (mobile/tablet). */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => cameraRef.current?.click()}
          className="hidden pointer-coarse:inline-flex"
        >
          <Camera className="size-4" />
          Tomar foto
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => pickerRef.current?.click()}
        >
          Elegir archivo
        </Button>
      </div>

      {/* Input para foto desde cámara — capture="environment" = cámara trasera. */}
      <input
        ref={cameraRef}
        type="file"
        accept={ACCEPT_CAMERA}
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) validateAndEmit(f);
          e.target.value = ""; // permite re-tomar la misma foto
        }}
      />

      {/* Input genérico — en mobile el OS muestra Cámara/Galería/Archivos. */}
      <input
        ref={pickerRef}
        type="file"
        accept={imagesOnly ? ACCEPT_CAMERA : ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) validateAndEmit(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
```

**Detalles sutiles:**

- `capture="environment"` → cámara trasera (mejor para escanear). Para
  fotos de perfil/selfie usar `capture="user"`.
- En **desktop**, el atributo `capture` se ignora silenciosamente — el
  botón "Tomar foto" igual queda oculto por `pointer-coarse:hidden` así
  no aparece confuso.
- En **iOS Safari**, sin `capture` y con `accept="image/*"` el sheet
  ofrece *Take Photo / Photo Library / Choose File*. **Con** `capture`
  va directo a la cámara (sin opción de galería).
- En **Android Chrome**, comportamiento equivalente.
- `e.target.value = ""` al final permite que el `onChange` dispare si el
  user selecciona el mismo archivo dos veces seguidas (ej. retomar foto
  porque salió movida).
- Para `multiple` (subir varias fotos juntas), agregar `multiple` al
  input genérico — NO al de cámara (la cámara nativa solo emite una
  foto por vez).

**Compresión client-side (opcional, recomendado para fotos):**

Las fotos de un smartphone moderno pesan 3-8 MB cada una. Para no
toparse con el límite de 10 MB y bajar el costo de OCR, comprimir antes
de upload con `browser-image-compression`:

```ts
// lib/files/compress-image.ts
import imageCompression from "browser-image-compression";

export async function compressImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const compressed = await imageCompression(file, {
    maxSizeMB: 2,
    maxWidthOrHeight: 2400,   // suficiente para OCR de un comprobante A4
    useWebWorker: true,
    fileType: "image/jpeg",   // unificamos a JPEG para consistencia
  });
  return compressed;
}
```

Llamar antes de pasar el `File` al `useUploadFile`. Diferir a un PR
aparte si la latencia perceptible del compress molesta (no debería —
mide ~200ms para una foto típica en celular medio).

### 8.2 Hook de upload

Encima de `useActionQuery` (patrón ya rodando en la app):

```ts
// features/files/hooks/use-upload-file.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { uploadFileAction } from "../actions/upload";
import { fileAttachmentsKeys } from "../keys";

type Vars = {
  file: File;
  targetType: "invoice" | "receipt" | "cheque" | "retention";
  targetId: string;
  kind: string;
};

export function useUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, targetType, targetId, kind }: Vars) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("targetType", targetType);
      fd.append("targetId", targetId);
      fd.append("kind", kind);
      const res = await uploadFileAction(fd);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSuccess: (_data, { targetType, targetId }) => {
      qc.invalidateQueries({ queryKey: fileAttachmentsKeys.byTarget(targetType, targetId) });
    },
  });
}
```

### 8.3 Lista de adjuntos

`features/files/components/attachments-list.tsx` — render simple con thumb
por tipo, filename, fecha, acción "Ver" (abre signed URL en tab nuevo) y
"Eliminar" (Dialog de confirmación → `detachFileAction`).

### 8.4 Realtime

Sumar `file_attachments` a la publication (`alter publication
supabase_realtime add table public.file_attachments;`) y wire del hook
`use-realtime-invalidate.ts` existente para invalidar
`fileAttachmentsKeys.byTarget` cuando otro usuario adjunte/elimine.

---

## 9. Permisos a sumar a la matriz

En `lib/auth/permissions.ts`:

```ts
"files:read",   // ver adjuntos y descargar
"files:write",  // subir y atachar
"files:admin",  // borrar adjuntos de otros
```

Asignación inicial:

| Permiso | owner | admin | finance | operations | warehouse | driver |
|---|---|---|---|---|---|---|
| `files:read`  | ✓ | ✓ | ✓ | ✓ | ✓ | (limitado en G.3) |
| `files:write` | ✓ | ✓ | ✓ | ✓ | ✓ | (limitado en G.3) |
| `files:admin` | ✓ | ✓ |   |   |   |   |

`driver` sigue la regla `:own` que ya quedó diferida a Fase G.3 — su
acceso queda gated por el target (solo archivos de sus propios viajes).

---

## 10. Tests

| Tipo | Qué cubre |
|---|---|
| Unit (Vitest) | `buildStorageKey` con filenames raros (unicode, espacios, sin ext, ext de 9+ chars, `..`). |
| Unit | `extractQuickInsight` con CSV mock, XLSX mock, mock de fetch a Anthropic. |
| Schema (Vitest) | Zod de `uploadFileAction` (`AttachTargetSchema`, kind validation). |
| Integration (Vitest + Supabase local) | Upload feliz, rollback en DB error, rollback en attach error, signed URL devuelve `Content-Disposition`. |
| RLS (pgTAP o Vitest hitting RPC) | Insert con `uploaded_by` falso falla; delete por otro user falla salvo admin. |
| E2E (Playwright) | Adjuntar PDF a una factura, ver el listado, descargar, borrar. |

---

## 11. Plan de PRs sugerido (≤500 LOC c/u)

**K.10 — Subsistema files unificado (purchases-only wiring):**

1. **K.10a `feat: files registry + file_attachments + bucket + RLS + orphan sweep`**
   — migraciones 1-4 (`files`, `file_attachments` con FK única a
   `purchase_invoices`, bucket `files`, RPC `find_orphan_files`),
   publication realtime, `lib/auth/permissions.ts`
   (`files:read|write|admin`), función Inngest `files-sweep-orphans` con
   cron diario, tests RLS + matriz. ~280 LOC.
2. **K.10b `feat: files lib + dropzone + preview`** — helpers
   `lib/files/{storage-path,file-association-utils,preview,mime-type-icons,format-file-size}.ts`,
   `components/file-upload/{FileDropzone,file-upload-utils}.tsx`
   (port desde `sumary copy` + `capture="environment"` para mobile),
   `components/file-preview/FilePreviewDialog.tsx`, tests Vitest.
   ~380 LOC.
3. **K.10c `feat: attach files to purchases`** — server actions
   (`upload`, `sign`, `detach`, `list`), hooks (`use-upload-file`,
   `use-attachments`), `<AttachmentsZone>` en
   `features/files/components/`, wire en `/purchases/[id]`, realtime,
   Playwright E2E. ~250 LOC.

**Diferido:**

- **Quick OCR** → Fase I.2 (depende de I.1 — Vercel AI SDK).
- **Bulk upload + página `/files` global** → cuando llegue I.2 (sirve
  para cargar masivamente y dejar que el matcher proponga
  asociaciones).
- **Extender entidades atachables** (comprobantes, OPs, recibos,
  clientes, suppliers, transactions, cheques) → **M.4**: una migración
  que suma las FKs + check rebuild, más wire del `<AttachmentsZone>` en
  cada detail page.

---

## 12. Decisiones cerradas (2026-05-16)

| # | Decisión | Resolución |
|---|---|---|
| 1 | Bucket único vs uno por dominio | **Único `files`.** Lifecycle distinto justifica bucket nuevo en el futuro, no ahora. |
| 2 | Polimorfismo: FK por target vs `(target_type, target_id)` | **FK por target + check "exactly one".** Cascade real, joins normales, set chico y bien definido (5-8 entidades a Fase M). |
| 3 | OCR síncrono vs asíncrono | **Diferido a Fase I.2.** La columna se crea en K.10a, el worker lo agrega I.2. Transporte (Inngest vs `after()` + pool) se decide ahí. |
| 4 | Quién paga el LLM | Cuenta del proyecto. Cap por usuario via rate-limit existente, key `ocr:{userId}`. Aplica cuando se implemente §6. |
| 5 | Versionado de archivos | No en v1. Reemplazar = nuevo upload + atachar + borrar viejo. Si compliance lo exige, `parent_file_id` self-fk en migración futura. |
| 6 | Antivirus scanning | No en v1. Reconsiderar si llega portal cliente (M.6). |
| D1 | Scope de cableado en K.10 | **Solo `purchase_invoices`.** Otras entidades en M.4. |
| D2 | Bulk multi-upload | **Single-upload.** Bulk + página `/files` global cuando llegue I.2. |
| D3 | Compresión client-side de imágenes | **No.** Las facturas son PDF; se suma cuando aparezca el caso (fotos desde celular). |
| D4 | Captura mobile (`capture="environment"`) | **Sí desde día 1.** `pointer-coarse:` Tailwind variants ocultan el botón en desktop. |
| D5 | PDFs auto-generados (comprobantes) | **Refactor a on-demand en M.0** (drop bucket `invoices`). El QR es función pura del dato + CAE; regenerar es seguro. Hash SHA256 opcional para auditoría. |

---

## 13. Métricas de éxito

| Métrica | Objetivo |
|---|---|
| p95 latencia de `uploadFileAction` (PDF 2 MB) | < 1.5 s |
| p95 latencia de `getSignedFileUrlAction` | < 200 ms |
| OCR completado en background | < 30 s p95 |
| Huérfanos detectados por el sweep diario | tendiendo a 0 |
| Errores 500 en upload | < 0.5% |
