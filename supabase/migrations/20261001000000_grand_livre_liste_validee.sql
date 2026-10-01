-- ════════════════════════════════════════════════════════════════════════════
--  LE GRAND LIVRE, LA LISTE VALIDÉE PAR YOUSSEF (ARRÊT 21 → ARRÊT 22, 01/10/2026, §D.26, §D.33).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement (§G.4), ET LE DÉPLOIEMENT AUSSITÔT (étape 7 de §G.4 ter). Entre les deux,
--  le code en ligne écrit encore les onze actions retirées : elles sont REFUSÉES (GL006) — un geste dont la trace
--  est refusée le dit (§E.68), rien n'est perdu d'autre que des lignes que la décision retire. La fenêtre se compte
--  en minutes.
--
--  CE QUE LA DÉCISION FAIT ICI
--   ① ONZE ACTIONS CESSENT D'ÉCRIRE — six retirées (le message envoyé, la recherche déjà en cours, les refus de dépôt
--     « expert inapte » et « conditions non remplies », le refus pour plafond atteint, le refus de quota de CV) et cinq
--     FONDUES dans la ligne de fin d'une recherche (lancée, vivier filtré, profils notés, correspondances,
--     notifications). Elles RESTENT dans la liste fermée — leurs lignes passées la citent —, marquées `retiree_le` ;
--     `journaliser()` refuse de les écrire (GL006).
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
  'Date a laquelle l action a cesse d etre ecrite (decision de Youssef). Ses lignes passees restent ; journaliser() refuse de l ecrire (GL006).';

update public.grand_livre_actions
   set retiree_le = coalesce(retiree_le, now())
 where code in ('message_envoye', 'refus_recherche_en_cours', 'refus_expert_inapte', 'refus_garde_eligibilite', 'refus_plafond_atteint', 'refus_quota_cv', 'recherche_lancee', 'recherche_filtree', 'recherche_classee', 'recherche_correspondances', 'recherche_notifiee');

insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('desabonnement_email', 'rgpd', 'reussi', 'journal.actions.desabonnement_email')
on conflict (code) do nothing;
update public.grand_livre_actions set cles_detail = array['evenement', 'canal']::text[] where code = 'desabonnement_email';

update public.grand_livre_actions set cles_detail = array['issue', 'raison', 'tentative', 'tache', 'eligibles', 'examinees', 'notees', 'reprises', 'lots_en_echec', 'retenues', 'fortes', 'nouvelles', 'notifiees', 'notifications_manquees']::text[] where code = 'recherche_terminee';
update public.grand_livre_actions set cles_detail = array['etape', 'cause', 'tentative', 'arret', 'tache', 'eligibles', 'examinees', 'notees', 'reprises', 'retenues', 'fortes', 'nouvelles', 'notifiees', 'notifications_manquees', 'lots_en_echec']::text[] where code = 'recherche_echouee';
update public.grand_livre_actions set cles_detail = array['tentatives', 'plafond', 'cause', 'etape', 'arret', 'tache', 'eligibles', 'examinees', 'notees', 'reprises', 'lots_en_echec', 'retenues', 'fortes', 'nouvelles', 'notifiees', 'notifications_manquees']::text[] where code = 'recherche_abandonnee';
update public.grand_livre_actions set cles_detail = array['approuve', 'motif', 'de', 'note']::text[] where code = 'verification_conclue';


-- ── journaliser() : une action retirée est refusée, nommée (GL006) ──
create or replace function public.journaliser(
  p_piece          uuid,
  p_type_action    text,
  p_statut         text,
  p_origine        text,
  p_acteur_id      uuid    default null,
  p_acteur_type    text    default null,
  p_ecosysteme_id  uuid    default null,
  p_sujet_type     text    default null,
  p_sujet_id       uuid    default null,
  p_detail         jsonb   default '{}'::jsonb,
  p_piece_origine  uuid    default null,
  p_cout_usd       numeric default null,
  p_unite_facturee text    default null
) returns bigint
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_impose text;
  v_retiree timestamptz;
  v_cles   text[];
  v_hors   text[];
  v_detail jsonb;
  v_id     bigint;
begin
  if p_piece is null then
    raise exception 'journaliser : la piece est obligatoire — une ecriture sans piece ne se relie a rien'
      using errcode = 'GL002';
  end if;
  if p_type_action is null then
    raise exception 'journaliser : le type d action est obligatoire'
      using errcode = 'GL002';
  end if;

  select statut_impose, cles_detail, retiree_le into v_impose, v_cles, v_retiree
    from public.grand_livre_actions
   where code = p_type_action;
  if not found then
    raise exception 'journaliser : type d action inconnu « % » — la liste est FERMEE (grand_livre_actions) et s etend par migration', p_type_action
      using errcode = 'GL003';
  end if;
  -- UNE ACTION RETIRÉE NE S'ÉCRIT PLUS (décision de Youssef, 01/10/2026) : ses lignes passées restent, la liste
  -- fermée la garde comme clé, mais plus aucun geste ne l'écrit — un appelant oublié lève, nommé.
  if v_retiree is not null then
    raise exception 'journaliser : « % » est RETIREE du grand livre depuis le % — elle ne s ecrit plus', p_type_action, v_retiree
      using errcode = 'GL006';
  end if;
  if v_impose is not null and p_statut is distinct from v_impose then
    raise exception 'journaliser : « % » impose le statut « % », recu « % »', p_type_action, v_impose, p_statut
      using errcode = 'GL003';
  end if;

  -- PREMIÈRE BARRIÈRE — la liste blanche de l'action. Toute clé hors liste
  -- est refusée et NOMMÉE ; une clé personnelle nouvelle n'a aucune chance
  -- d'y figurer.
  v_detail := coalesce(p_detail, '{}'::jsonb);
  select array_agg(c order by c) into v_hors
    from public.grand_livre_chemins(v_detail) as c
   where c <> all (v_cles);
  if v_hors is not null then
    raise exception 'journaliser : « % » n accepte pas les cles % — liste blanche : %', p_type_action, v_hors, v_cles
      using errcode = 'GL004';
  end if;
  -- SECONDE BARRIÈRE — la liste noire commune au journal d'audit. Elle ne
  -- décide plus de rien ici (une clé personnelle n'est jamais dans une liste
  -- blanche) ; elle reste, parce qu'une barrière qui coûte zéro se garde.
  v_detail := public.audit_logs_detail_sans_pii(v_detail);

  begin
    insert into public.grand_livre
      (piece, piece_origine, type_action, statut, origine,
       acteur_id, acteur_type, ecosysteme_id, sujet_type, sujet_id,
       detail, cout_usd, unite_facturee)
    values
      (p_piece, p_piece_origine, p_type_action, p_statut, p_origine,
       p_acteur_id, p_acteur_type, p_ecosysteme_id, p_sujet_type, p_sujet_id,
       v_detail, p_cout_usd, p_unite_facturee)
    returning id into v_id;
  exception when unique_violation then
    -- UNE FOIS. La seconde écriture du même geste pour la même action sur le
    -- même sujet est un défaut de l'appelant, jamais une ligne de plus.
    raise exception 'journaliser : « % » deja ecrite pour la piece % (sujet %) — une action s ecrit UNE fois par geste', p_type_action, p_piece, p_sujet_id
      using errcode = 'GL005';
  end;

  return v_id;
end;
$fn$;


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
  -- le complément ne porte aucun changement (des fonctionnalités, des champs d'offre, des offres migrées, un
  -- catalogue relié, une offre par défaut appliquée), n'est pas un changement d'état : on rend NULL, sans ligne.
  -- Un ÉCHEC s'écrit toujours. Un seul endroit, pour les douze écrans qui passent par ici.
  if p_statut = 'reussi'
     and coalesce(p_avant, '{}'::jsonb) = coalesce(p_apres, '{}'::jsonb)
     and not exists (
       select 1 from jsonb_each(coalesce(p_complement, '{}'::jsonb)) e
        where (e.key in ('features', 'package_fields', 'offres', 'synchronisees', 'refusees', 'en_echec')
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
  if strpos((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.journaliser(uuid, text, text, text, uuid, text, uuid, text, uuid, jsonb, uuid, numeric, text)')), 'GL006') = 0 then
    raise exception 'postcondition NON TENUE : journaliser ne refuse pas une action retiree';
  end if;
  raise notice 'postcondition tenue : onze actions retirees, desabonnement_email declaree, la ligne de fin d une recherche et la verification elargies ; le refus GL006 et le reglage inchange sont prouves par tests/database/grand_livre/liste_validee.test.sql';
end
$post$;
