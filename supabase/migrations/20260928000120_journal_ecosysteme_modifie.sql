-- ════════════════════════════════════════════════════════════════════════════
--  UN ÉCOSYSTÈME MODIFIÉ S'ÉCRIT AU GRAND LIVRE — LES CHAMPS, L'ACTIVATION, LE
--  VISUEL : TROIS ROUTES, UNE ACTION, L'OPÉRATION EN DÉTAIL.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — `app/api/admin/ecosystemes/[id]`
--  (PATCH) et `…/[id]/visuel` (POST, DELETE) écrivent l'action dès ce commit.
--  Ajoute seulement : une ligne à la liste fermée. Rejouable.
--
--  LE MANQUE (audit de la phase B, 2.2) : ces trois gestes n'écrivaient qu'une
--  ligne d'audit. `ecosysteme_modifie` est imposée par le mandat ; filtrer sur
--  elle rend les trois — le visuel est une propriété de l'écosystème.
--
--  L'ACTIVATION N'EST PAS UNE MODIFICATION PARMI D'AUTRES : elle ouvre ou ferme
--  l'écosystème aux organisations. L'audit la nomme déjà à part
--  (`ecosystem_activated`) ; ici, c'est l'OPÉRATION du détail qui la distingue
--  (modification | activation | desactivation | visuel_depose | visuel_retire).
--  Le détail porte les NOMS des champs, les CLÉS des traductions touchées
--  (`table.champ.langue`), le TYPE de visuel — jamais une valeur (nom, accroche,
--  description, couleur). Sujet et écosystème : l'écosystème modifié.
--  Écrivain : lib/ecosystemes/journal-ecosysteme.ts. Famille `administration`.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('ecosysteme_modifie',         'administration', null,     'journal.actions.ecosysteme_modifie')
on conflict (code) do nothing;

update public.grand_livre_actions
   set cles_detail = array['operation', 'champs', 'champs[]', 'traductions', 'traductions[]', 'visuel']::text[]
 where code = 'ecosysteme_modifie';


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_a record;
begin
  select a.famille, a.statut_impose, a.cles_detail into v_a
    from public.grand_livre_actions a where a.code = 'ecosysteme_modifie';
  if not found then
    raise exception 'postcondition NON TENUE : ecosysteme_modifie absente de la liste fermee';
  end if;
  if v_a.famille is distinct from 'administration' or v_a.statut_impose is not null
     or v_a.cles_detail is distinct from array['operation', 'champs', 'champs[]', 'traductions', 'traductions[]', 'visuel']::text[] then
    raise exception 'postcondition NON TENUE : ecosysteme_modifie [famille %, statut %, cles %]', v_a.famille, v_a.statut_impose, v_a.cles_detail;
  end if;
  raise notice 'postcondition tenue : ecosysteme_modifie dans la liste fermee (famille administration, six chemins) ; les formes des trois routes sont prouvees par tests/database/grand_livre/rattachements.test.sql';
end
$post$;
