-- ════════════════════════════════════════════════════════════════════════════
--  UNE RECHERCHE ÉCARTÉE PARCE QU'UNE AUTRE TIENT LE BAIL S'ÉCRIT AU GRAND
--  LIVRE — UN REFUS NOMMÉ, SOUS LA PIÈCE DU GESTE QUI L'A DÉCLENCHÉE.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement — `lib/matching/run-for-expert.ts`
--  écrit l'action dès ce commit. Ajoute seulement : une ligne à la liste fermée.
--  Rejouable.
--
--  LE MANQUE (audit du 26/09/2026) : un run expert qui ne prend pas le bail
--  — une autre recherche tient déjà le même expert (§D.22) — n'écrivait qu'une
--  ligne de CONSOLE. Décision de Youssef : l'historique des passages du moteur
--  est COMPLET, et une recherche écartée en fait partie. Ce n'est ni un échec
--  (rien n'a échoué, §D.22) ni une fin de recherche (aucune n'a commencé) : c'est
--  un REFUS nommé — famille `refus`, statut imposé `refuse`, comme les cinq autres.
--
--  CE QUE LA LIGNE PORTE : la tâche planifiée qui a déclenché le passage (null
--  pour un geste humain — l'origine et l'acteur sont déjà sur la ligne). Sujet :
--  le profil de l'expert. La pièce est celle du GESTE (clic ou tâche) : elle relie
--  ce refus à ce qui l'a provoqué. Un bail qui ne peut pas être LU (panne) n'est
--  pas un refus et ne s'écrit pas ici (§E.22).
--
--  LA LANGUE DU CODE : celle du grand livre existant (français) — le report de
--  la convention anglaise est une décision de Youssef (CLAUDE.md, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('refus_recherche_en_cours',   'refus',          'refuse', 'journal.actions.refus_recherche_en_cours')
on conflict (code) do nothing;

update public.grand_livre_actions
   set cles_detail = array['tache']::text[]
 where code = 'refus_recherche_en_cours';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_a  record;
  v_id bigint;
begin
  select a.famille, a.statut_impose, a.cles_detail into v_a
    from public.grand_livre_actions a where a.code = 'refus_recherche_en_cours';
  if not found then
    raise exception 'postcondition NON TENUE : refus_recherche_en_cours absente de la liste fermee';
  end if;
  if v_a.famille is distinct from 'refus' or v_a.statut_impose is distinct from 'refuse'
     or v_a.cles_detail is distinct from array['tache']::text[] then
    raise exception 'postcondition NON TENUE : refus_recherche_en_cours [famille %, statut %, cles %]', v_a.famille, v_a.statut_impose, v_a.cles_detail;
  end if;
  -- SONDE — la forme exacte que le module écrit est ACCEPTÉE (tâche, puis geste humain), puis annulée.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'refus_recherche_en_cours', 'refuse', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                               jsonb_build_object('tache', 'expert_relance'),
                               null::uuid, null::numeric, null::text);
    if v_id is null then
      raise exception 'postcondition NON TENUE : refus_recherche_en_cours n a pas ete ecrit';
    end if;
    v_id := public.journaliser(gen_random_uuid(), 'refus_recherche_en_cours', 'refuse', 'utilisateur',
                               gen_random_uuid(), 'expert_freelance', null::uuid, 'profiles', gen_random_uuid(),
                               jsonb_build_object('tache', null),
                               null::uuid, null::numeric, null::text);
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — un refus n'est jamais « réussi » (GL003).
  begin
    perform public.journaliser(gen_random_uuid(), 'refus_recherche_en_cours', 'reussi', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                               '{"tache":"expert_relance"}'::jsonb, null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : refus_recherche_en_cours accepte le statut reussi';
  exception when sqlstate 'GL003' then
    null;
  end;
  -- SONDE — une clé hors liste est REFUSÉE (GL004).
  begin
    perform public.journaliser(gen_random_uuid(), 'refus_recherche_en_cours', 'refuse', 'tache_planifiee',
                               null::uuid, null::text, null::uuid, 'profiles', gen_random_uuid(),
                               '{"tache":"expert_relance","bail_detenu_par":"x"}'::jsonb, null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : une cle hors liste est entree dans refus_recherche_en_cours';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : refus_recherche_en_cours — dans la liste fermee, famille refus, statut refuse impose, forme du module acceptee, reussi et cle hors liste refuses ; le refus est prouve par tests/database/grand_livre/refus_recherche_en_cours.test.sql';
end
$post$;
