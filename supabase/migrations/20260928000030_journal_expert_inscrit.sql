-- ════════════════════════════════════════════════════════════════════════════
--  L'INSCRIPTION D'UN EXPERT PAR SA ROUTE S'ÉCRIT AU GRAND LIVRE — LA PREUVE
--  QUE LA ROUTE EST PASSÉE, SOUS LA PIÈCE DE `compte_cree`.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — `app/api/auth/public/register-expert`
--  écrit l'action dès ce commit. Ajoute seulement : une ligne à la liste fermée.
--  Rejouable.
--
--  LE MANQUE (audit de la phase B, 2.1) : l'inscription d'un expert n'écrivait
--  qu'une ligne d'audit (`expert_registered`). Depuis la décision A, le trigger
--  écrit `compte_cree` pour toute création de compte ; il ne sait pas par quelle
--  voie le compte arrive. Cette ligne-ci est écrite par la ROUTE, sous la même
--  pièce : elle prouve le passage et dit ce que la route seule vérifie — le
--  téléphone par OTP, l'acceptation des CGU (sa version).
--
--  CE QUE LA LIGNE PORTE : le type de compte (expert_freelance | expert_cdi) ;
--  réussie, la version des CGU acceptées ; échouée, un CODE de cause et
--  `compte_nettoye` (la route a retiré le compte : public.users puis auth.users).
--  Sujet : le compte. Acteur : le compte lui-même (origine utilisateur).
--  Famille `compte`, aucun statut imposé : l'issue réelle décide.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('expert_inscrit',             'compte',         null,     'journal.actions.expert_inscrit')
on conflict (code) do nothing;

update public.grand_livre_actions
   set cles_detail = array['type_de_compte', 'cgu_version', 'cause', 'compte_nettoye']::text[]
 where code = 'expert_inscrit';


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_a record;
begin
  select a.famille, a.statut_impose, a.cles_detail into v_a
    from public.grand_livre_actions a where a.code = 'expert_inscrit';
  if not found then
    raise exception 'postcondition NON TENUE : expert_inscrit absente de la liste fermee';
  end if;
  if v_a.famille is distinct from 'compte' or v_a.statut_impose is not null
     or v_a.cles_detail is distinct from array['type_de_compte', 'cgu_version', 'cause', 'compte_nettoye']::text[] then
    raise exception 'postcondition NON TENUE : expert_inscrit [famille %, statut %, cles %]', v_a.famille, v_a.statut_impose, v_a.cles_detail;
  end if;
  raise notice 'postcondition tenue : expert_inscrit dans la liste fermee (famille compte, quatre cles) ; les formes ecrites par la route, pour le freelance et le CDI, sont prouvees par tests/database/grand_livre/inscriptions.test.sql';
end
$post$;
