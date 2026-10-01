-- ════════════════════════════════════════════════════════════════════════════
--  LA PHOTO DE PROFIL S'ÉCRIT PAR LE SERVEUR — le navigateur n'écrit plus dans
--  le bucket `avatars` (recette staging du 01/10/2026, point 8).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : INDIFFÉRENT, et voici pourquoi. Le code EN LIGNE dépose encore la
--  photo depuis le navigateur : entre `db push` et `git push` (quelques minutes, §G.4 ter),
--  un PREMIER dépôt échouerait aussi — or tout REMPLACEMENT échoue déjà, avec le même
--  message. Dès le nouveau code servi, le dépôt passe par POST /api/profile/photo (clé de
--  service, qui ne dépend d'aucune politique). Scinder le déploiement pour ces minutes-là
--  coûterait plus qu'il ne protège. Rejouable.
--
--  LA CAUSE DE « ERREUR LORS DE L'ENREGISTREMENT » : `storage_buckets_policies` avait
--  ouvert au navigateur l'insertion, la mise à jour et la suppression dans son dossier
--  `<uid>/` du bucket `avatars`, plus une LECTURE publique. `avatars_private` a rendu le
--  bucket privé et retiré la lecture — en laissant l'écriture (« restent en place, non
--  touchées ici »). Or la fenêtre de la photo déposait en `upsert`, et un `upsert` de
--  Storage exige la LECTURE en plus de l'écriture : le premier dépôt passait (une
--  insertion), chaque REMPLACEMENT échouait. Ce n'était pas le profil : `photo_url`
--  passait déjà par le serveur.
--
--  LA RÈGLE : comme « Repasser à l'écoute » (POST /api/profile/disponibilite) et le logo
--  d'organisation, l'écriture passe par le serveur, qui vérifie le CONTENU du fichier
--  (lib/org-logo.ts) et dépose au chemin dérivé du compte. Les trois politiques
--  d'écriture du navigateur n'ont plus d'usage : une porte laissée ouverte sans usage
--  est une porte latérale — elles sont retirées. La lecture reste fermée (URL signée
--  par le serveur, lib/avatar.ts).
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists avatars_auth_upload on storage.objects;
drop policy if exists avatars_auth_update on storage.objects;
drop policy if exists avatars_auth_delete on storage.objects;

-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if exists (
    select 1 from pg_policies p
     where p.schemaname = 'storage' and p.tablename = 'objects'
       and p.policyname in ('avatars_auth_upload', 'avatars_auth_update', 'avatars_auth_delete', 'avatars_public_read')
  ) then
    raise exception 'postcondition NON TENUE : une politique du navigateur sur avatars subsiste';
  end if;
  raise notice 'postcondition tenue : plus aucune écriture du navigateur dans le bucket avatars ; le dépôt passe par POST /api/profile/photo, contrôlé par scripts/diag-recette-s1.mjs';
end
$post$;
