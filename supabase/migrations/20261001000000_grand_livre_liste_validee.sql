-- ════════════════════════════════════════════════════════════════════════════
--  LE GRAND LIVRE, LA LISTE VALIDÉE PAR YOUSSEF (ARRÊT 21 → ARRÊT 22, 01/10/2026, §D.26, §D.33).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement (§G.4). RIEN ICI NE REFUSE CE QUE LE CODE EN LIGNE ÉCRIT (§E.72) : entre le
--  `db push` et le `git push`, le code en ligne écrit encore les onze actions retirées, et la base les ACCEPTE —
--  aucun geste n'échoue, même une minute. Les listes blanches ne font que S'ÉLARGIR (aucune clé retirée), un réglage
--  inchangé rend NULL sans erreur. LE REFUS (GL006) PART DANS UN LOT SÉPARÉ, déployé APRÈS celui-ci
--  (`grand_livre_refus_des_retirees`, branche `lot/grand-livre-refus-retirees`), quand plus aucun code en ligne ne
--  les écrit.
--
--  CE QUE LA DÉCISION FAIT ICI
--   ① ONZE ACTIONS CESSENT D'ÉCRIRE — six retirées (le message envoyé, la recherche déjà en cours, les refus de dépôt
--     « expert inapte » et « conditions non remplies », le refus pour plafond atteint, le refus de quota de CV) et cinq
--     FONDUES dans la ligne de fin d'une recherche (lancée, vivier filtré, profils notés, correspondances,
--     notifications). Elles RESTENT dans la liste fermée — leurs lignes passées la citent —, marquées `retiree_le` ;
--     le CODE cesse de les écrire dans ce lot ; la base les refusera (GL006) au lot suivant, pas avant.
--   ② LA LIGNE DE FIN D'UNE RECHERCHE PORTE TOUT : combien d'annonces ou de profils examinés, notés, retenus, forts,
--     nouveaux, combien de personnes prévenues, et le coût. Le détail lot par lot reste dans le journal des dépenses.
--   ③ UN RÉGLAGE RÉENREGISTRÉ À L'IDENTIQUE NE S'ÉCRIT PLUS — un seul endroit : `journaliser_reglage()`.
--   ④ LA VÉRIFICATION CONCLUE PORTE SA NOTE — « note 6/10 » se lit dans la phrase.
--   ⑤ UNE ACTION NOUVELLE : `desabonnement_email` — le lien de désabonnement d'un e-mail est un changement de
--     consentement (famille rgpd) ; son écrivain est `se_desabonner_email()` (migration suivante).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.grand_livre_actions
  add column if not exists retiree_le timestamptz;
comment on column public.grand_livre_actions.retiree_le is
  'Date a laquelle l action a cesse d etre ecrite (decision de Youssef). Ses lignes passees restent ; le refus en base (GL006) arrive au deploiement suivant.';

update public.grand_livre_actions
   set retiree_le = coalesce(retiree_le, now())
 where code in ('message_envoye', 'refus_recherche_en_cours', 'refus_expert_inapte', 'refus_garde_eligibilite', 'refus_plafond_atteint', 'refus_quota_cv', 'recherche_lancee', 'recherche_filtree', 'recherche_classee', 'recherche_correspondances', 'recherche_notifiee');

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('desabonnement_email', 'rgpd', 'reussi', 'journal.actions.desabonnement_email')
on conflict (code) do nothing;
update public.grand_livre_actions set cles_detail = array['evenement', 'canal']::text[] where code = 'desabonnement_email';

update public.grand_livre_actions set cles_detail = array['issue', 'raison', 'tentative', 'tache', 'eligibles', 'examinees', 'notees', 'reprises', 'lots_en_echec', 'retenues', 'fortes', 'nouvelles', 'notifiees', 'notifications_manquees', 'recherches', 'unites_source']::text[] where code = 'recherche_terminee';
update public.grand_livre_actions set cles_detail = array['etape', 'cause', 'tentative', 'arret', 'tache', 'eligibles', 'examinees', 'notees', 'reprises', 'retenues', 'fortes', 'nouvelles', 'notifiees', 'notifications_manquees', 'lots_en_echec', 'recherches', 'unites_source']::text[] where code = 'recherche_echouee';
update public.grand_livre_actions set cles_detail = array['tentatives', 'plafond', 'cause', 'etape', 'arret', 'tache', 'eligibles', 'examinees', 'notees', 'reprises', 'lots_en_echec', 'retenues', 'fortes', 'nouvelles', 'notifiees', 'notifications_manquees', 'recherches', 'unites_source']::text[] where code = 'recherche_abandonnee';
update public.grand_livre_actions set cles_detail = array['approuve', 'motif', 'de', 'note']::text[] where code = 'verification_conclue';


-- ── journaliser_reglage() : rien n'a changé, rien ne s'écrit ──
create or replace function public.journaliser_reglage(
  p_piece         uuid,
  p_acteur_id     uuid,
  p_ecosysteme_id uuid,
  p_sujet_type    text,
  p_sujet_id      uuid,
  p_avant         jsonb,
  p_apres         jsonb,
  p_complement    jsonb default '{}'::jsonb,
  p_statut        text  default 'reussi'
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if p_acteur_id is null then
    raise exception 'journaliser_reglage : un reglage a toujours un auteur' using errcode = 'GL002';
  end if;
  -- Un réglage aboutit ou échoue ; il n'est jamais « refusé » par ici — un
  -- refus de garde a ses propres actions, nommées.
  if p_statut not in ('reussi', 'echoue') then
    raise exception 'journaliser_reglage : statut « % » — un reglage est reussi ou echoue', p_statut using errcode = 'GL003';
  end if;
  -- RIEN N'A CHANGÉ, RIEN NE S'ÉCRIT (décision de Youssef, 01/10/2026) : un écran de réglage réenregistré à
  -- l'identique écrivait une ligne à chaque clic. Une écriture RÉUSSIE dont l'avant et l'après sont égaux, et dont
  -- le complément ne porte aucun changement (des fonctionnalités, des champs d'offre, un catalogue relié — synchronisées,
  -- refusées, en échec —, des organisations comptées, une offre par défaut appliquée ; chaque clé est une clé d'une liste
  -- blanche, et chacune est prouvée par tests/database/grand_livre/reglages.test.sql), n'est pas un changement d'état : on rend NULL, sans ligne.
  -- Un ÉCHEC s'écrit toujours. Un seul endroit, pour les douze écrans qui passent par ici.
  if p_statut = 'reussi'
     and coalesce(p_avant, '{}'::jsonb) = coalesce(p_apres, '{}'::jsonb)
     and not exists (
       select 1 from jsonb_each(coalesce(p_complement, '{}'::jsonb)) e
        where (e.key in ('features', 'package_fields', 'synchronisees', 'refusees', 'en_echec')
               and jsonb_typeof(e.value) = 'array' and jsonb_array_length(e.value) > 0)
           or (e.key = 'count' and jsonb_typeof(e.value) = 'number' and (e.value)::text::numeric > 0)
           or (e.key = 'default_applied' and e.value = 'true'::jsonb)) then
    return null;
  end if;
  return public.journaliser(
    p_piece, 'reglage_modifie', p_statut, 'administrateur',
    p_acteur_id, 'admin', p_ecosysteme_id,
    p_sujet_type, p_sujet_id,
    jsonb_build_object('avant', coalesce(p_avant, '{}'::jsonb), 'apres', coalesce(p_apres, '{}'::jsonb))
      || coalesce(p_complement, '{}'::jsonb));
end;
$fn$;


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_n integer;
begin
  select count(*) into v_n from public.grand_livre_actions where retiree_le is not null
     and code in ('message_envoye', 'refus_recherche_en_cours', 'refus_expert_inapte', 'refus_garde_eligibilite', 'refus_plafond_atteint', 'refus_quota_cv', 'recherche_lancee', 'recherche_filtree', 'recherche_classee', 'recherche_correspondances', 'recherche_notifiee');
  if v_n <> 11 then
    raise exception 'postcondition NON TENUE : % actions retirees sur 11', v_n;
  end if;
  if not exists (select 1 from public.grand_livre_actions where code = 'desabonnement_email' and famille = 'rgpd'
                    and cles_detail = array['evenement', 'canal']::text[] and retiree_le is null) then
    raise exception 'postcondition NON TENUE : desabonnement_email absente ou mal declaree';
  end if;
  if (select cles_detail from public.grand_livre_actions where code = 'verification_conclue') is distinct from array['approuve', 'motif', 'de', 'note']::text[] then
    raise exception 'postcondition NON TENUE : verification_conclue ne porte pas sa note';
  end if;
  raise notice 'postcondition tenue : onze actions retirees, desabonnement_email declaree, la ligne de fin d une recherche et la verification elargies ; l acceptation des retirees pendant la fenetre et la ligne de fin d une recherche sont prouvees par tests/database/grand_livre/liste_validee.test.sql, le reglage inchange et ses exceptions par tests/database/grand_livre/reglages.test.sql';
end
$post$;
