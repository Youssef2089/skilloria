-- ════════════════════════════════════════════════════════════════════════════
--  LA PHOTO DE PROFIL S'ÉCRIT PAR LE SERVEUR — le navigateur n'écrit plus dans le bucket `avatars`
--  (recette staging du 01/10/2026, point 8 ; relecture indépendante du 01/10/2026, point 2).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : APRÈS le déploiement du lot A (§E.72, §E.91). Renumérotée et sortie du lot A par la relecture :
--  son en-tête d'origine la disait INDIFFÉRENTE (« tout remplacement échoue déjà ») — mais un PREMIER dépôt, lui,
--  passait, et le code d'AVANT le lot A (13d1524) dépose la photo DEPUIS le navigateur : entre le `db push` et le
--  `git push`, chaque premier dépôt aurait échoué. Aucun déploiement ne fait échouer un geste en ligne, même une minute
--  (décision de Youssef). Le code du lot A dépose par POST /api/profile/photo (clé de service, qui ne dépend d'aucune
--  politique) : c'est lui qui est en ligne quand ce lot se pousse. Rejouable.
--
--  LA CAUSE DE « ERREUR LORS DE L'ENREGISTREMENT » (§E.101) : `storage_buckets_policies` avait ouvert au navigateur
--  l'insertion, la mise à jour et la suppression dans son dossier `<uid>/` du bucket `avatars`, plus une LECTURE
--  publique. `avatars_private` a rendu le bucket privé et retiré la lecture — en laissant l'écriture. Or la fenêtre de
--  la photo déposait en `upsert`, et un `upsert` de Storage exige la LECTURE en plus de l'écriture : le premier dépôt
--  passait (une insertion), chaque REMPLACEMENT échouait.
--
--  LA RÈGLE : comme « Repasser à l'écoute » (POST /api/profile/disponibilite) et le logo d'organisation, l'écriture passe
--  par le serveur, qui vérifie le CONTENU du fichier et dépose au chemin dérivé du compte. Les trois politiques
--  d'écriture du navigateur n'ont plus d'usage : une porte laissée ouverte sans usage est une porte latérale — elles
--  sont retirées. La lecture reste fermée (URL signée par le serveur, lib/avatar.ts).
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
