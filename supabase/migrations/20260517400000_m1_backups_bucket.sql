-- M.1 — Bucket privado para backups diarios.
--
-- El workflow .github/workflows/backup-daily.yml corre pg_dump cada día
-- 03:00 UTC, sube el .dump comprimido acá, y borra los > 30 días.
-- Solo service role puede leer/escribir (RLS sin policy = deny).

set row_security = off;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'backups-daily',
  'backups-daily',
  false,
  2147483647,   -- ~2 GiB, máximo permitido por Supabase storage en plan free/pro
  array['application/octet-stream', 'application/x-postgres-dump']
)
on conflict (id) do nothing;

-- Policy de read: usuarios con accounting:read NO ven nada (es info muy
-- sensible). Lectura solo desde el server via service role + bucket
-- signed URL (que la action de /admin/backups crea con la service key
-- y entrega al cliente owner/admin).
--
-- Sin policies de INSERT/UPDATE/DELETE: service role bypassa RLS.

set row_security = on;
