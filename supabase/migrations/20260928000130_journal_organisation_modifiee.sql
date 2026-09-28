-- ════════════════════════════════════════════════════════════════════════════
--  LA FICHE D'UNE ORGANISATION MODIFIÉE S'ÉCRIT AU GRAND LIVRE — LES CHAMPS,
--  LE LOGO DÉPOSÉ, LE LOGO RETIRÉ : TROIS ROUTES, UNE ACTION.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — `app/api/me/organisation` (PATCH) et
--  `…/organisation/logo` (POST, DELETE) écrivent l'action dès ce commit. Ajoute
--  seulement : une ligne à la liste fermée. Rejouable.
--
--  LE MANQUE (audit de la phase B, 2.2) : ces trois gestes de l'administrateur
--  d'une organisation n'écrivaient qu'une ligne d'audit. `organisation_modifiee`
--  est imposée par le mandat ; le logo est une propriété de l'organisation.
--  Populations : client, cabinet, ESN — et l'organisation PERSONNELLE d'un expert
--  pour les champs (elle n'a jamais de logo, §D.8).
--
--  CE QUE LA LIGNE PORTE : l'OPÉRATION (modification | logo_depose | logo_retire)
--  et les NOMS des champs touchés — jamais une valeur (raison sociale, site,
--  adresse en sont). Sujet : l'organisation. Écosystème : AUCUN — une organisation
--  en rejoint plusieurs (§D.3), comme la ligne d'organisation de `compte_valide`.
--  Acteur : l'administrateur de l'organisation. Écrivain :
--  lib/organisations/journal-organisation.ts. Famille `organisation`.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('organisation_modifiee',      'organisation',   null,     'journal.actions.organisation_modifiee')
on conflict (code) do nothing;

update public.grand_livre_actions
   set cles_detail = array['operation', 'champs', 'champs[]']::text[]
 where code = 'organisation_modifiee';


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_a record;
begin
  select a.famille, a.statut_impose, a.cles_detail into v_a
    from public.grand_livre_actions a where a.code = 'organisation_modifiee';
  if not found then
    raise exception 'postcondition NON TENUE : organisation_modifiee absente de la liste fermee';
  end if;
  if v_a.famille is distinct from 'organisation' or v_a.statut_impose is not null
     or v_a.cles_detail is distinct from array['operation', 'champs', 'champs[]']::text[] then
    raise exception 'postcondition NON TENUE : organisation_modifiee [famille %, statut %, cles %]', v_a.famille, v_a.statut_impose, v_a.cles_detail;
  end if;
  raise notice 'postcondition tenue : organisation_modifiee dans la liste fermee (famille organisation, trois chemins) ; les formes des trois routes, pour le client, le cabinet, l ESN et l organisation personnelle d un expert, sont prouvees par tests/database/grand_livre/rattachements.test.sql';
end
$post$;
