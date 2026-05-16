# Files — Reference patterns (deep dive)

> Complemento de `docs/files-patterns.md`. Mientras el spec describe la
> arquitectura y el flujo end-to-end, este doc guarda los pedazos de código
> concretos que dan trabajo reconstruir desde cero: motor de quick-OCR,
> prompt de vision, fan-out de procesamiento, parsing de tabulares y edge
> cases sutiles. Pensado para abrir cuando estés implementando la fase y
> necesites el "cómo exactamente".

---

## 1. Motor de quick-OCR

El insight extraído tiene que servir para **matching** (¿este PDF de qué
proveedor es? ¿qué mes cubre? ¿qué cuenta menciona?), no para transcripción
completa. Tope duro de 500 chars. Discriminación por MIME — cada rama tiene
estrategia distinta.

### 1.1 Esqueleto del engine

```ts
// lib/files/quick-ocr.ts
import { parseCsvSample } from "./parsers/csv";
import { parseSpreadsheetSample } from "./parsers/spreadsheet";
import { extractVisionInsight } from "./parsers/vision";

const MAX_INSIGHT_CHARS = 500;

export async function extractQuickInsight(
  buffer: ArrayBuffer,
  mimeType: string,
  filename: string,
): Promise<string> {
  try {
    if (mimeType === "text/csv" || mimeType === "text/tab-separated-values") {
      return truncate(parseCsvSample(new TextDecoder().decode(buffer)));
    }

    if (
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === "application/vnd.ms-excel"
    ) {
      return truncate(parseSpreadsheetSample(buffer));
    }

    if (mimeType === "application/pdf" || mimeType.startsWith("image/")) {
      const text = await extractVisionInsight(buffer, mimeType, filename);
      return truncate(text);
    }

    return "";
  } catch (err) {
    // Falla silenciosa: el archivo se guarda igual; el OCR es best-effort.
    return "";
  }
}

function truncate(s: string): string {
  const cleaned = s.replace(/\s+/g, " ").trim();
  return cleaned.length > MAX_INSIGHT_CHARS
    ? cleaned.slice(0, MAX_INSIGHT_CHARS - 1) + "…"
    : cleaned;
}
```

### 1.2 CSV — detección de delimiter + sample

```ts
// lib/files/parsers/csv.ts
const DELIMITERS = [",", ";", "\t", "|"] as const;

export function parseCsvSample(text: string, sampleRows = 5): string {
  const firstLines = text.split(/\r?\n/).slice(0, 20).filter(Boolean);
  if (firstLines.length === 0) return "";

  // Elegir el delimiter que da MAYOR consistencia de columnas en las primeras filas.
  let bestDelim = ",";
  let bestScore = -1;
  for (const d of DELIMITERS) {
    const cols = firstLines.map((l) => l.split(d).length);
    const max = Math.max(...cols);
    const min = Math.min(...cols);
    // Premiar: muchas columnas + baja varianza
    const score = max > 1 ? max - (max - min) * 2 : -1;
    if (score > bestScore) {
      bestScore = score;
      bestDelim = d;
    }
  }

  const header = firstLines[0]?.split(bestDelim).map((c) => c.trim()) ?? [];
  const sample = firstLines.slice(1, 1 + sampleRows).map((line) =>
    line.split(bestDelim).map((c) => c.trim()).join(" | "),
  );

  return [
    `Header: ${header.join(" | ")}`,
    `Sample: ${sample.join(" / ")}`,
  ].join(". ");
}
```

### 1.3 Excel — detección de header row + sample

XLSX no siempre tiene el header en la fila 1 (hojas con título arriba,
filas vacías al inicio, etc.). La heurística: scorear cada fila por
"parece header" y elegir la de mayor score.

```ts
// lib/files/parsers/spreadsheet.ts
import * as XLSX from "xlsx";

type Row = Array<string | number | boolean | Date | null>;

export function parseSpreadsheetSample(buffer: ArrayBuffer): string {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return "";
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });
  if (rows.length === 0) return "";

  const headerIdx = pickHeaderRow(rows.slice(0, 10));
  const header = (rows[headerIdx] ?? []).map(stringify);
  const sample = rows
    .slice(headerIdx + 1, headerIdx + 6)
    .map((r) => r.map(stringify).join(" | "));

  return [
    `Sheet: ${sheetName}`,
    `Header: ${header.join(" | ")}`,
    `Sample: ${sample.join(" / ")}`,
  ].join(". ");
}

function pickHeaderRow(rows: Row[]): number {
  let bestIdx = 0;
  let bestScore = -Infinity;
  rows.forEach((row, i) => {
    const nonNull = row.filter((c) => c !== null && c !== "").length;
    const strings = row.filter((c) => typeof c === "string").length;
    // Header: muchas no-vacías, mayoría strings, pocas numéricas
    const numerics = row.filter((c) => typeof c === "number").length;
    const score = nonNull + strings * 2 - numerics;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  });
  return bestIdx;
}

function stringify(c: unknown): string {
  if (c === null || c === undefined) return "";
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  return String(c).trim();
}
```

### 1.4 PDF / imagen — Claude Haiku vision

> **Diferido a Fase I.2.** No entra en K.10 — depende de I.1 (Vercel AI
> SDK + Claude wired). Al implementar, evaluar si usar Anthropic SDK
> directo (este código de referencia) o `@ai-sdk/anthropic` +
> `generateText` (patrón usado en `sumary copy`, consistente con el resto
> de I.x). La decisión va junto con la del transporte (§6 más arriba).

Prompt corto, temperature 0, sin streaming. Se usa Anthropic SDK directo
(no `ai` SDK) para tener control fino sobre el formato del binario y poder
sumar `cache_control` cuando el prompt se estabilice (ver
`docs/ai-patterns.md` §6 para el patrón de prompt caching).

```ts
// lib/files/parsers/vision.ts
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `Extraés clues breves para hacer matching de archivos
en un ERP argentino. Reglas:
- Devolvé 1-3 oraciones cortas o keywords separadas por coma.
- Incluí: tipo de documento (factura, remito, recibo, etc.), razón social,
  CUIT si aparece, dirección, mes/año, número de comprobante, banco,
  nombre de cuenta.
- Si no se lee nada útil, devolvé exactamente "UNREADABLE".
- No transcribas el documento entero. No expliques tu razonamiento.
- Máximo 400 caracteres.`;

const MODEL = "claude-haiku-4-5";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function extractVisionInsight(
  buffer: ArrayBuffer,
  mimeType: string,
  filename: string,
): Promise<string> {
  const base64 = Buffer.from(buffer).toString("base64");
  const content = mimeType === "application/pdf"
    ? ({
        type: "document" as const,
        source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 },
      })
    : ({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: mimeType as "image/png" | "image/jpeg" | "image/webp",
          data: base64,
        },
      });

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          content,
          { type: "text", text: `Filename: ${filename}` },
        ],
      },
    ],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join(" ");

  return text.trim() === "UNREADABLE" ? "" : text;
}
```

**Por qué `claude-haiku-4-5` y no Sonnet:** el output es ≤400 chars y la
tarea es extracción factual, no razonamiento. Haiku es ~10x más barato y la
diferencia de calidad para clues breves es invisible. Para asistente AI
sobre el contenido (Fase I.4), Sonnet/Opus aparte.

**Caching candidate:** `SYSTEM_PROMPT` es estable y largo. Cuando se
estabilice, agregar `cache_control: { type: "ephemeral" }` al system message
(>1024 tokens necesarios — sumar few-shot examples si hace falta llegar al
threshold). Ver `docs/ai-patterns.md` §6.

---

## 2. Fan-out de procesamiento (bulk upload)

Cuando el usuario sube N archivos a la vez, no esperar el OCR de cada uno
en serie. Disparar el evento Inngest por cada `file_id` y devolver el
resultado del upload inmediatamente — el procesamiento corre en paralelo
en background.

```ts
// features/files/lib/trigger-processing.ts
import { inngest } from "@/lib/inngest/client";
import { FILE_UPLOADED } from "@/lib/inngest/events";
import { logger } from "@/lib/logger";

export async function triggerProcessingForFiles(
  fileIds: string[],
): Promise<void> {
  if (fileIds.length === 0) return;

  // Promise.allSettled: si uno falla, los demás siguen.
  // Inngest dedupea por idempotency, así que reenviar no es problema.
  const results = await Promise.allSettled(
    fileIds.map((file_id) =>
      inngest.send({ name: FILE_UPLOADED, data: { file_id } }),
    ),
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    logger.warn("files.trigger_processing_partial_failure", {
      total: fileIds.length,
      failed,
    });
  }
}
```

**Uso desde el bulk upload action:**

```ts
// features/files/actions/bulk-upload.ts (esqueleto)
"use server";

import { after } from "next/server";
import { triggerProcessingForFiles } from "../lib/trigger-processing";

export async function bulkUploadAction(formData: FormData) {
  // ... validate, upload cada archivo secuencial o en paralelo controlado ...
  const uploaded: string[] = []; // file_ids de los que sí terminaron

  // El after() corre DESPUÉS de devolver al cliente — el response del action
  // no espera a que Inngest reciba los eventos.
  after(() => triggerProcessingForFiles(uploaded));

  return { ok: true, uploaded: uploaded.length };
}
```

**Por qué `after()` y no `await`:** el cliente quiere ver "20 archivos
subidos" cuanto antes; los eventos a Inngest pueden tardar 50-200ms cada
uno y no son críticos para la respuesta. Si la llamada a `inngest.send`
falla después del `return`, el sweep diario de huérfanos NO los borra
(tienen attachment) — el costo es que se quedan sin `quick_ocr`. Mitigación:
endpoint admin `POST /admin/files/reprocess` que re-envía el evento para
los `quick_ocr is null`.

---

## 3. Bulk upload UX (page `/files`)

Pattern observado y validado: una sola página de gestión masiva por encima
de los flows feature-by-feature (adjuntar PDF desde el detail de una
factura). Cumple dos roles:

1. **Carga masiva**: subir 30 archivos al inicio del mes y dejar que el
   matcher los proponga después.
2. **Auditoría**: ver todos los archivos subidos en un período, filtrados
   por canal/proveedor/etc.

### 3.1 Estructura sugerida

```
app/(dashboard)/files/
  page.tsx              # listado + filtros + dropzone arriba
  loading.tsx
  [id]/page.tsx         # detail: preview + asociaciones + raw quick_ocr

features/files/
  actions/
    upload.ts            # single
    bulk-upload.ts       # múltiple, FormData con N "file" fields
    sign.ts
    detach.ts
    list.ts              # paginado, con filtros
  components/
    file-dropzone.tsx
    file-dropzone-multi.tsx   # multi=true, drag de N archivos
    files-table.tsx           # tabla con preview thumb + filename + size + estado OCR
    file-detail-card.tsx
    attachments-list.tsx      # reusado desde otras features
  hooks/
    use-upload-file.ts
    use-bulk-upload.ts        # progress por archivo
  keys.ts                     # files-keys.ts patrón sumary
```

### 3.2 Estado del upload por archivo

Para multi-upload con feedback granular:

```ts
type FileUploadItem = {
  localId: string;        // crypto.randomUUID en cliente
  file: File;
  status: "queued" | "uploading" | "succeeded" | "failed";
  progress: number;       // 0..100, si el SDK lo soporta
  serverId?: string;      // file.id post-upload
  error?: string;
};
```

Render: una fila por item, ícono + filename + size + barra de progreso +
estado. Cancel disponible solo en `queued` (el upload a Supabase Storage
no se cancela una vez en vuelo, pero la fila en BD sí se puede borrar
después).

---

## 4. Edge cases que ya están resueltos en el spec — referencia rápida

| Caso | Cómo se maneja | Dónde |
|---|---|---|
| Storage write OK, DB insert falla | `storage.remove` manual antes de devolver error | `uploadFileAction` (spec §4.1) |
| DB insert OK, attach falla | `files.delete` + `storage.remove` | idem |
| `inngest.send` falla post-upload | Archivo queda sin OCR; reproceso vía admin endpoint | §2 acá |
| Filename con `../../etc/passwd` | `getSafeExtension` solo permite `a-z0-9{1,8}` + check constraint en SQL | spec §2 |
| Filename con unicode/espacios | Nunca llega a storage; vive solo en `files.original_filename` | spec §2 |
| MIME spoofing (jpg con bytes PDF) | Storage bucket valida MIME en el upload; +revalidación server-side | spec §2 + §4.1 |
| Mismo archivo en N entidades | `file_attachments` n:1; orphan check solo borra si `count = 0` | spec §1.2 + §7.1 |
| Upload concurrente del mismo blob | UUID en el cliente; cero colisiones | implícito |
| OCR rerun accidental | Activity chequea `quick_ocr is not null` y retorna `skipped` | spec §6.2 |
| Sweep de huérfanos mata uploads en vuelo | `find_orphan_files` filtra `created_at < now() - 1 hour` | spec §7.2 |
| Cliente borra mientras otro lo está viendo | Realtime invalida `byTarget`; UI muestra "Archivo eliminado" | spec §8.4 |

---

## 5. Migración: shape de los archivos

Para mantener consistencia con las migraciones existentes
(`supabase/migrations/`), nombrar con timestamp UTC + scope claro:

```
YYYYMMDDHHMMSS_files_registry.sql           -- tabla files + RLS + indexes
YYYYMMDDHHMMSS_file_attachments.sql         -- tabla file_attachments + RLS + view
YYYYMMDDHHMMSS_files_storage_bucket.sql     -- bucket + storage policies
YYYYMMDDHHMMSS_files_orphan_rpc.sql         -- find_orphan_files RPC
YYYYMMDDHHMMSS_realtime_files_publication.sql -- add file_attachments a supabase_realtime
```

Para agregar una nueva entidad atachable (ej: drivers en Fase G), una
migración tipo:

```sql
-- YYYYMMDDHHMMSS_attachments_add_driver_fk.sql
alter table public.file_attachments
  add column driver_id uuid references public.drivers(id) on delete cascade;

create index idx_file_attachments_driver
  on public.file_attachments (driver_id)
  where driver_id is not null;

-- Rebuild el check de "exactly one target"
alter table public.file_attachments
  drop constraint file_attachments_exactly_one_target;

alter table public.file_attachments
  add constraint file_attachments_exactly_one_target check (
    (invoice_id is not null)::int +
    (receipt_id is not null)::int +
    (cheque_id is not null)::int +
    (retention_id is not null)::int +
    (driver_id is not null)::int = 1
  );
```

---

## 6. Cosas a NO hacer (lecciones)

1. **No usar el filename del usuario como key de storage.** Trae problemas
   de encoding, path traversal, longitud, colisiones, signed URLs raros.
   La key es siempre `{uuid}.{safe_ext}`.

2. **No mezclar PDF auto-generado (facturas, recibos) con uploads de
   usuario en la misma tabla.** Son ciclos de vida distintos
   (regenerable vs. inmutable), permisos distintos, naming distinto.
   Lo auto-generado vive en `lib/pdf/` y `invoices.pdf_url`, no en `files`.

3. **No hacer polymorphic `(target_type, target_id)`.** Perdés cascade
   real, los joins requieren `case`, el linter no ayuda, los tests RLS se
   complican. FK por entidad con check "exactly one" es más laburo de
   schema pero mejor en todo lo demás.

4. **No correr OCR sincrónicamente en el upload.** Un PDF de 8 MB tarda
   3-5s en Haiku. Bloquear el response del upload arruina la UX.
   Inngest + `quick_ocr is null` en UI hasta que termine.

5. **No exponer el bucket público.** Supabase tiene "public buckets" — para
   archivos de negocio nunca. Signed URLs de 1h con `Content-Disposition`.

6. **No omitir el cron de huérfanos.** Aun con rollback manual en el
   action, hay caminos de huérfanos (crash mid-action, `inngest.send`
   colgado, deletes en cascada que dejan el blob). Sin sweep, el bucket
   crece para siempre.

7. **No agregar antivirus scanning preventivamente.** Single-CUIT, usuarios
   internos, mime whitelist estricta. Si entra el portal cliente (J.5),
   reconsiderar.

8. **No versionar archivos en v1.** Reemplazar = nuevo upload + adjuntar
   + borrar viejo. Si compliance lo exige, sumar `parent_file_id` self-fk
   en una migración futura.

---

## 7. Checklist de "está listo para producción"

- [ ] Migraciones aplicadas, tipos regenerados (`pnpm db:types:generate`).
- [ ] `pnpm test` con cobertura de `buildStorageKey` (filenames raros),
      Zod del action, parsers CSV/Excel.
- [ ] Smoke E2E (Playwright): adjuntar PDF a una factura, ver, descargar,
      borrar.
- [ ] Test de RLS: usuario A no puede ver `files` que adjuntó usuario B
      hasta que también tenga acceso al attachment.
- [ ] Inngest dev runtime registra `files-quick-ocr` y `files-sweep-orphans`.
- [ ] CSP del proxy permite el host de Supabase Storage en `img-src` y
      `connect-src` (debería ya estar — chequear `lib/security/csp.ts`).
- [ ] Sentry recibe errores del action con `event.tags.feature = "files"`.
- [ ] Bucket creado en el proyecto de producción (no solo local).
- [ ] Rate-limit de `padron:lookup` se replica como `files:ocr` con
      bucket por usuario para capear costo de Anthropic.
