-- ════════════════════════════════════════════════════════════════════════════
--  LE CV RÉINITIALISÉ S'ÉCRIT AU GRAND LIVRE — ET LA LIGNE DIT SI LE PROFIL
--  QUITTE LA VITRINE.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — `app/api/profile/cv/reset` (POST)
--  écrit l'action dès ce commit. Ajoute seulement : une ligne à la liste fermée.
--  Rejouable.
--
--  LE MANQUE (audit de la phase B, 2.2) : la remise à zéro complète du CV —
--  fichier, champs analysés, expériences, formations, langues, consentement à
--  l'analyse — n'écrivait qu'une ligne d'audit. Or elle DÉPUBLIE le profil :
--  un expert visible des organisations cesse de l'être, et le moteur ne le
--  propose plus. `cv_reinitialise` est imposée par le mandat.
--
--  CE QUE LA LIGNE PORTE : `retire_de_la_vitrine` (le profil était visible, LU
--  avant la remise à zéro) et `avait_un_fichier` — deux faits, aucune valeur du
--  profil. Sujet : le profil. Populations : expert freelance, expert CDI (la
--  route ne les distingue pas). Écrivain : lib/profil/journal-profil.ts.
--  Famille `profil`.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('cv_reinitialise',            'profil',         null,     'journal.actions.cv_reinitialise')
on conflict (code) do nothing;

update public.grand_livre_actions
   set cles_detail = array['retire_de_la_vitrine', 'avait_un_fichier']::text[]
 where code = 'cv_reinitialise';


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_a record;
begin
  select a.famille, a.statut_impose, a.cles_detail into v_a
    from public.grand_livre_actions a where a.code = 'cv_reinitialise';
  if not found then
    raise exception 'postcondition NON TENUE : cv_reinitialise absente de la liste fermee';
  end if;
  if v_a.famille is distinct from 'profil' or v_a.statut_impose is not null
     or v_a.cles_detail is distinct from array['retire_de_la_vitrine', 'avait_un_fichier']::text[] then
    raise exception 'postcondition NON TENUE : cv_reinitialise [famille %, statut %, cles %]', v_a.famille, v_a.statut_impose, v_a.cles_detail;
  end if;
  raise notice 'postcondition tenue : cv_reinitialise dans la liste fermee (famille profil, deux cles) ; la forme ecrite par la route, pour le freelance et le CDI, est prouvee par tests/database/grand_livre/rattachements.test.sql';
end
$post$;
