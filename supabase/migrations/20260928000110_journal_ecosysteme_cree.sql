-- ════════════════════════════════════════════════════════════════════════════
--  UN ÉCOSYSTÈME CRÉÉ S'ÉCRIT AU GRAND LIVRE — SOUS SON PROPRE NOM.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — `app/api/admin/ecosystemes` (POST)
--  écrit l'action dès ce commit. Ajoute seulement : une ligne à la liste fermée.
--  Rejouable.
--
--  LE MANQUE (audit de la phase B, 2.2) : la création d'un écosystème n'écrivait
--  qu'une ligne d'audit. Le mandat rangeait les routes des écosystèmes sous
--  `ecosysteme_modifie` ; l'audit a SÉPARÉ la création par la règle du nom — une
--  création filtrée sous « modifié » est un chiffre juste sous une étiquette
--  fausse (§E.24). Arbitré par Youssef (« le reste de ton audit est accepté, y
--  compris ecosysteme_cree »).
--
--  CE QUE LA LIGNE PORTE : sujet l'écosystème, et l'écosystème de la ligne est
--  LUI (la ligne appartient à ce qu'elle crée) ; le slug (le sous-domaine, un
--  identifiant — jamais le nom ni l'accroche) ; `configuration_creee` (la ligne
--  de configuration 1-1 est née avec lui, ou non — la route ne supprime pas
--  l'écosystème, elle le dit). Écrivain : lib/ecosystemes/journal-ecosysteme.ts.
--  Famille `administration`.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('ecosysteme_cree',            'administration', null,     'journal.actions.ecosysteme_cree')
on conflict (code) do nothing;

update public.grand_livre_actions
   set cles_detail = array['slug', 'configuration_creee']::text[]
 where code = 'ecosysteme_cree';


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_a record;
begin
  select a.famille, a.statut_impose, a.cles_detail into v_a
    from public.grand_livre_actions a where a.code = 'ecosysteme_cree';
  if not found then
    raise exception 'postcondition NON TENUE : ecosysteme_cree absente de la liste fermee';
  end if;
  if v_a.famille is distinct from 'administration' or v_a.statut_impose is not null
     or v_a.cles_detail is distinct from array['slug', 'configuration_creee']::text[] then
    raise exception 'postcondition NON TENUE : ecosysteme_cree [famille %, statut %, cles %]', v_a.famille, v_a.statut_impose, v_a.cles_detail;
  end if;
  raise notice 'postcondition tenue : ecosysteme_cree dans la liste fermee (famille administration, deux cles) ; la forme ecrite par la route est prouvee par tests/database/grand_livre/rattachements.test.sql';
end
$post$;
