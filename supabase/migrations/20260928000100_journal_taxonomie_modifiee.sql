-- ════════════════════════════════════════════════════════════════════════════
--  LA TAXONOMIE D'UN ÉCOSYSTÈME MODIFIÉE S'ÉCRIT AU GRAND LIVRE — SIX ROUTES,
--  UNE ACTION, L'OBJET ET L'OPÉRATION EN DÉTAIL.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — les six routes d'administration de
--  la taxonomie (create/update/delete-branch, create/update/delete-speciality)
--  écrivent l'action dès ce commit. Ajoute seulement : une ligne à la liste
--  fermée. Rejouable.
--
--  LE MANQUE (audit de la phase B, 2.2) : ces six routes n'écrivaient qu'une
--  ligne d'audit chacune. Or la taxonomie décide de ce qu'un expert peut
--  déclarer, de ce qu'une annonce peut demander, et donc de ce que le moteur
--  rapproche : la changer est un geste d'administration à part entière.
--
--  UNE ACTION, `taxonomie_modifiee` (imposée par le mandat) : filtrer sur elle
--  rend les six gestes, et c'est ce que son nom annonce. Le détail distingue :
--  `objet` (branche | specialite), `operation` (creee | modifiee | supprimee),
--  la branche d'une spécialité, les NOMS des champs touchés, les LANGUES des
--  traductions touchées — jamais un libellé (texte libre). Sujet : la branche ou
--  la spécialité. Écosystème : le sien. Écrivain : lib/taxonomie/journal-taxonomie.ts.
--  Famille `administration`.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('taxonomie_modifiee',         'administration', null,     'journal.actions.taxonomie_modifiee')
on conflict (code) do nothing;

update public.grand_livre_actions
   set cles_detail = array['objet', 'operation', 'branch_id', 'champs', 'champs[]', 'traductions', 'traductions[]']::text[]
 where code = 'taxonomie_modifiee';


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_a record;
begin
  select a.famille, a.statut_impose, a.cles_detail into v_a
    from public.grand_livre_actions a where a.code = 'taxonomie_modifiee';
  if not found then
    raise exception 'postcondition NON TENUE : taxonomie_modifiee absente de la liste fermee';
  end if;
  if v_a.famille is distinct from 'administration' or v_a.statut_impose is not null
     or v_a.cles_detail is distinct from array['objet', 'operation', 'branch_id', 'champs', 'champs[]', 'traductions', 'traductions[]']::text[] then
    raise exception 'postcondition NON TENUE : taxonomie_modifiee [famille %, statut %, cles %]', v_a.famille, v_a.statut_impose, v_a.cles_detail;
  end if;
  raise notice 'postcondition tenue : taxonomie_modifiee dans la liste fermee (famille administration, sept chemins) ; les six formes ecrites par les routes sont prouvees par tests/database/grand_livre/rattachements.test.sql';
end
$post$;
