-- ════════════════════════════════════════════════════════════════════════════
--  DEUX ACTIONS DU GRAND LIVRE APPORTÉES PAR LA RECETTE S1 (fusion du 01/10/2026, décisions de Youssef, §D.33, §D.44).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement (§G.4) — deux actions NOUVELLES dans la liste fermée ; rien n'est retiré ni
--  restreint, et seul le code nouveau les écrit (aucun geste en ligne ne peut échouer, §E.72).
--  Horodatage : postérieur à toutes les migrations de la recette S1 (plage `1xxxxx` du 01/10/2026), suffixe du tronc.
--
--  ① `photo_deposee` (famille profil) — l'expert dépose ou REMPLACE sa photo (POST /api/profile/photo). Le chemin du
--    fichier est dérivé du compte et ne change jamais : depuis l'ARRÊT 22, « Profil modifié » ne s'écrit que si une
--    valeur change, et un remplacement n'en laissait AUCUNE. Or une photo remplacée change ce qu'une organisation voit
--    après dévoilement (§D.4, §D.5). Une ligne à chaque dépôt ; le détail dit seulement si c'est un remplacement.
--  ② `cv_consulte` (famille rgpd) — un administrateur ouvre le CV d'un expert (POST /api/admin/lien-cv/[id]). LA SEULE
--    EXCEPTION à « une consultation ne s'écrit pas » : un accès du personnel à une donnée personnelle. Écrite à la
--    signature du lien ; aucun lien n'est rendu sans sa ligne. Détail VIDE : ni chemin, ni nom de fichier.
--  Colonnes lues dans les migrations (§G.10) : grand_livre_actions (code ^[a-z][a-z0-9_]{2,60}$, famille dans la liste
--  fermée, statut_impose, libelle_key NOT NULL, cles_detail, retiree_le).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('photo_deposee', 'profil', 'reussi', 'journal.actions.photo_deposee'),
  ('cv_consulte',   'rgpd',   'reussi', 'journal.actions.cv_consulte')
on conflict (code) do nothing;

update public.grand_livre_actions set cles_detail = array['remplacement']::text[] where code = 'photo_deposee';
update public.grand_livre_actions set cles_detail = array[]::text[] where code = 'cv_consulte';


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if not exists (select 1 from public.grand_livre_actions where code = 'photo_deposee' and famille = 'profil'
                    and statut_impose = 'reussi' and cles_detail = array['remplacement']::text[] and retiree_le is null) then
    raise exception 'postcondition NON TENUE : photo_deposee absente ou mal declaree';
  end if;
  if not exists (select 1 from public.grand_livre_actions where code = 'cv_consulte' and famille = 'rgpd'
                    and statut_impose = 'reussi' and cles_detail = array[]::text[] and retiree_le is null) then
    raise exception 'postcondition NON TENUE : cv_consulte absente ou mal declaree';
  end if;
  raise notice 'postcondition tenue : photo_deposee et cv_consulte declarees ; leur ecriture est prouvee par tests/database/grand_livre/photo_et_cv.test.sql';
end
$post$;
