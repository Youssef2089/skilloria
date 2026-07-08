-- Versionne le schema storage (absent du db dump --linked, schema public only).
-- cv = PRIVE (PII CV, acces service-role uniquement, jamais d'URL). avatars = PUBLIC (getPublicUrl cote app ; passage prive = lot M3).
-- Upsert autoritatif : le fichier definit l'etat cible et corrige toute derive Studio.
-- Policies nettoyees vs etat staging : suppression du FOR ALL redondant sur avatars, role authenticated au lieu de public sur cv, WITH CHECK ajoute sur les UPDATE (owner-scoping du nouvel etat).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cv', 'cv', false, 5242880, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_self_write on storage.objects;
drop policy if exists avatars_auth_upload on storage.objects;
drop policy if exists avatars_auth_update on storage.objects;
drop policy if exists avatars_auth_delete on storage.objects;
drop policy if exists avatars_public_read on storage.objects;

create policy avatars_auth_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);

create policy avatars_auth_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);

create policy avatars_auth_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);

create policy avatars_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists cv_self_upload on storage.objects;
drop policy if exists cv_self_read on storage.objects;
drop policy if exists cv_self_update on storage.objects;
drop policy if exists cv_self_delete on storage.objects;

create policy cv_self_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cv' and (storage.foldername(name))[1] = (auth.uid())::text);

create policy cv_self_read on storage.objects
  for select to authenticated
  using (bucket_id = 'cv' and (storage.foldername(name))[1] = (auth.uid())::text);

create policy cv_self_update on storage.objects
  for update to authenticated
  using (bucket_id = 'cv' and (storage.foldername(name))[1] = (auth.uid())::text)
  with check (bucket_id = 'cv' and (storage.foldername(name))[1] = (auth.uid())::text);

create policy cv_self_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'cv' and (storage.foldername(name))[1] = (auth.uid())::text);
