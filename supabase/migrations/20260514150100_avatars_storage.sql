-- Bucket "avatars" público con cache agresivo. Las imágenes son visibles
-- entre todos los users de la app — un bucket público + CDN saca latencia
-- de cada render. Si en el futuro hace falta privacidad, se cambia a
-- signed URLs y se invalidan los caches.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  1048576,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Read: público (bucket marcado public, no hace falta policy).
-- Upload: solo al propio path "{user_id}/{filename}".
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
