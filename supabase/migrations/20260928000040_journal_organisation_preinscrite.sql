-- ════════════════════════════════════════════════════════════════════════════
--  LA PRÉINSCRIPTION D'UNE ORGANISATION PAR SA ROUTE S'ÉCRIT AU GRAND LIVRE —
--  LA PREUVE QUE LA ROUTE EST PASSÉE, SOUS LA PIÈCE DE `compte_cree`.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — `app/api/auth/register-org` écrit
--  l'action dès ce commit. Ajoute seulement : une ligne à la liste fermée.
--  Rejouable.
--
--  LE MANQUE (audit de la phase B, 2.1) : la préinscription d'une organisation
--  (client, cabinet, ESN) n'écrivait qu'une ligne d'audit (`org_pre_registered`).
--  Le trigger écrit `compte_cree` pour le compte ; cette ligne-ci est écrite par
--  la ROUTE, sous la même pièce : l'organisation est née avec son administrateur
--  (`creer_organisation_avec_admin`), après ce que la route seule vérifie — le
--  téléphone par OTP, les CGU, le domaine d'adresse (bloqué, public, déjà pris),
--  l'unicité de l'identifiant d'entreprise.
--
--  CE QUE LA LIGNE PORTE : le type d'organisation (client | cabinet | esn).
--  Réussie : sujet l'ORGANISATION, `domaine_public` (adresse sur un domaine
--  public, sans rattachement automatique). Échouée : sujet le COMPTE, un CODE de
--  cause, `compte_nettoye`, `organisation_nettoyee` (vraie si l'organisation
--  était née et a été retirée avec lui). Acteur : le compte (origine utilisateur).
--  Famille `organisation`, aucun statut imposé : l'issue réelle décide.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('organisation_preinscrite',   'organisation',   null,     'journal.actions.organisation_preinscrite')
on conflict (code) do nothing;

update public.grand_livre_actions
   set cles_detail = array['org_type', 'domaine_public', 'cause', 'compte_nettoye', 'organisation_nettoyee']::text[]
 where code = 'organisation_preinscrite';


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_a record;
begin
  select a.famille, a.statut_impose, a.cles_detail into v_a
    from public.grand_livre_actions a where a.code = 'organisation_preinscrite';
  if not found then
    raise exception 'postcondition NON TENUE : organisation_preinscrite absente de la liste fermee';
  end if;
  if v_a.famille is distinct from 'organisation' or v_a.statut_impose is not null
     or v_a.cles_detail is distinct from array['org_type', 'domaine_public', 'cause', 'compte_nettoye', 'organisation_nettoyee']::text[] then
    raise exception 'postcondition NON TENUE : organisation_preinscrite [famille %, statut %, cles %]', v_a.famille, v_a.statut_impose, v_a.cles_detail;
  end if;
  raise notice 'postcondition tenue : organisation_preinscrite dans la liste fermee (famille organisation, cinq cles) ; les formes ecrites par la route, pour le client, le cabinet et l ESN, sont prouvees par tests/database/grand_livre/inscriptions.test.sql';
end
$post$;
