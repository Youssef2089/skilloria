-- ════════════════════════════════════════════════════════════════════════════
--  L'IDENTITÉ D'UN COMPTE MODIFIÉE S'ÉCRIT AU GRAND LIVRE — LES NOMS DES
--  CHAMPS, JAMAIS LES VALEURS.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — `app/api/me/identity` (PATCH) écrit
--  l'action dès ce commit. Ajoute seulement : une ligne à la liste fermée.
--  Rejouable.
--
--  LE MANQUE (audit de la phase B, 2.2) : changer son prénom et son nom (après
--  ré-authentification) n'écrivait qu'une ligne d'audit. Le nom n'entre pas dans
--  la vérification d'un expert : la modification est permise sans nouvelle
--  revue — raison de plus pour qu'elle laisse une écriture.
--
--  CE QUE LA LIGNE PORTE : les NOMS des champs (`first_name`, `last_name`) —
--  jamais leurs valeurs : un nom au grand livre survivrait à la purge du compte,
--  et la liste blanche le refuse. Sujet et acteur : le compte. Toutes les
--  populations (expert freelance, CDI, client, cabinet, administrateur).
--  Écrivain : lib/comptes/journal-compte.ts. Famille `compte`.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('identite_modifiee',          'compte',         null,     'journal.actions.identite_modifiee')
on conflict (code) do nothing;

update public.grand_livre_actions
   set cles_detail = array['champs', 'champs[]']::text[]
 where code = 'identite_modifiee';


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_a record;
begin
  select a.famille, a.statut_impose, a.cles_detail into v_a
    from public.grand_livre_actions a where a.code = 'identite_modifiee';
  if not found then
    raise exception 'postcondition NON TENUE : identite_modifiee absente de la liste fermee';
  end if;
  if v_a.famille is distinct from 'compte' or v_a.statut_impose is not null
     or v_a.cles_detail is distinct from array['champs', 'champs[]']::text[] then
    raise exception 'postcondition NON TENUE : identite_modifiee [famille %, statut %, cles %]', v_a.famille, v_a.statut_impose, v_a.cles_detail;
  end if;
  raise notice 'postcondition tenue : identite_modifiee dans la liste fermee (famille compte, deux chemins) ; la forme ecrite par la route, pour chaque population, est prouvee par tests/database/grand_livre/rattachements.test.sql';
end
$post$;
