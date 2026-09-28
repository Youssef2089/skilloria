-- ════════════════════════════════════════════════════════════════════════════
--  UNE ANNONCE CRÉÉE EN BROUILLON S'ÉCRIT AU GRAND LIVRE — ET UN BESOIN DE
--  SOUS-TRAITANCE SOUS SON PROPRE NOM.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — `app/api/publications` (POST) écrit
--  les deux actions dès ce commit. Ajoute seulement : deux lignes à la liste
--  fermée. Rejouable.
--
--  LE MANQUE (audit de la phase B, 2.1) : la création d'un brouillon n'écrivait
--  qu'une ligne d'audit (`publication_drafted`). Populations : client, cabinet,
--  ESN (mission, offre) ; collaboration entre experts, freelance ET CDI (besoin
--  de sous-traitance, dans l'organisation PERSONNELLE de l'expert — née à la
--  volée au premier besoin).
--
--  DEUX ACTIONS, PAS UNE — LA RÈGLE DU NOM, ET LE PRÉCÉDENT. La publication
--  s'écrit déjà sous deux noms (`annonce_publiee`, `sous_traitance_publiee`), la
--  candidature aussi (`candidature_deposee`, `sous_traitance_candidature`) :
--  filtrer « annonce » ne rend pas la collaboration entre experts, qui est un
--  autre parcours, pour une autre population. Le brouillon suit : filtrer
--  `annonce_creee` rendrait sinon des besoins d'experts sous une étiquette
--  d'organisation (§E.24). Un écrivain pour les deux : la route, qui choisit le
--  code selon le type — comme `publier_annonce()`.
--
--  CE QUE LA LIGNE PORTE : sujet l'annonce (brouillon). `annonce_creee` : le type
--  (mission | offre), l'organisation. `sous_traitance_creee` : l'organisation
--  personnelle, et si elle est NÉE avec ce besoin. Acteur : le compte qui crée.
--  Famille `annonce`, aucun statut imposé (seule l'issue réussie s'écrit : un
--  brouillon qui ne s'insère pas n'a rien changé).
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('annonce_creee',              'annonce',        null,     'journal.actions.annonce_creee'),
  ('sous_traitance_creee',       'annonce',        null,     'journal.actions.sous_traitance_creee')
on conflict (code) do nothing;

update public.grand_livre_actions
   set cles_detail = array['type', 'organization_id']::text[]
 where code = 'annonce_creee';

update public.grand_livre_actions
   set cles_detail = array['organization_id', 'organisation_personnelle_creee']::text[]
 where code = 'sous_traitance_creee';


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_n integer;
begin
  select count(*) into v_n from public.grand_livre_actions a
   where (a.code = 'annonce_creee' and a.famille = 'annonce' and a.statut_impose is null
          and a.cles_detail = array['type', 'organization_id']::text[])
      or (a.code = 'sous_traitance_creee' and a.famille = 'annonce' and a.statut_impose is null
          and a.cles_detail = array['organization_id', 'organisation_personnelle_creee']::text[]);
  if v_n <> 2 then
    raise exception 'postcondition NON TENUE : annonce_creee et sous_traitance_creee attendues dans la liste fermee avec leurs cles (% trouvee(s))', v_n;
  end if;
  raise notice 'postcondition tenue : annonce_creee et sous_traitance_creee dans la liste fermee (famille annonce, leurs cles) ; les formes ecrites par la route, pour le client, le cabinet, l ESN et la collaboration entre experts, sont prouvees par tests/database/grand_livre/annonce_creee.test.sql';
end
$post$;
