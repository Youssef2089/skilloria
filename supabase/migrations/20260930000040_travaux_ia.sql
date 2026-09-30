-- ════════════════════════════════════════════════════════════════════════════
--  LES TRAVAUX D'IA LONGS NE DÉPENDENT PLUS D'UNE REQUÊTE : une file en base,
--  un exécutant, un pilote pg_cron — et AUCUN profil « en cours » pour
--  toujours (§D.30, 30/09/2026).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. Ajoute une table, des fonctions, deux
--  actions et une tâche pg_cron ; le code de ce commit dépose et exécute les
--  travaux. Rejouable. Exige les secrets Vault `cron_secret` et
--  `purge_cron_base_url` (déjà exigés par les cinq tâches existantes) : sans eux,
--  l'exécutant n'est pas réveillé, et le pilote CLÔT les travaux en retard au
--  bout de 30 minutes — rien ne reste « en cours ».
--
--  LE DÉFAUT (audit du 30/09/2026 sur aac5f79, B3 et M3) : l'analyse d'un CV
--  (jusqu'à deux appels de 30 s) et la vérification d'un expert (jusqu'à trois
--  appels de 45 s, rejoués par le SDK) tournaient DANS la requête de l'expert,
--  plafonnée à 60 s. Coupée, elle laissait le profil « analyse en cours » ou
--  « vérification en cours » POUR TOUJOURS : rien ne reprenait, aucun écran
--  d'administration ne le montrait, et l'expert lisait « Erreur lors de la
--  sauvegarde » alors que son profil était publié.
--
--  LA FORME :
--   · DÉPOSER est une transaction : l'état du profil (« en cours ») ET le travail.
--     Au plus UN travail actif par profil et par nature ; en redéposer un annule
--     l'ancien — son résultat, s'il arrive, n'est plus appliqué.
--   · L'EXÉCUTANT (`/api/cron/travaux-ia`) prend un travail sous BAIL
--     (`for update skip locked`), l'exécute, puis le TERMINE dans la transaction
--     qui écrit son résultat — un travail annulé entre-temps ne s'écrit pas.
--   · Un échec de NOTRE côté est REJOUÉ, avec un délai croissant, jusqu'au
--     plafond. Au-delà, le travail est ÉCHOUÉ et le profil reçoit son issue de
--     REPLI, en base : l'analyse est « échouée, nommée » ; la vérification part
--     en revue humaine.
--   · LE PILOTE (pg_cron, chaque minute, en SQL) clôt ce qui est perdu — un bail
--     expiré, un travail que personne n'a pris depuis 30 minutes — et réveille
--     l'exécutant s'il y a du travail dû. Il ne dépend pas de l'hébergeur : si
--     l'exécutant ne répond plus, les profils sortent quand même de « en cours ».
--
--  LE GRAND LIVRE : `travail_ia_echoue` (le travail est abandonné, avec son code)
--  et `travail_ia_relance` (un administrateur le relance), un écrivain :
--  `journaliser_travail_ia()`. La réussite n'a pas de ligne à elle : elle est
--  celle du geste (`cv_televerse`, `verification_conclue`), sous la MÊME pièce.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── ① LA FILE ───────────────────────────────────────────────────────────────
create table if not exists public.travaux_ia (
  id                     uuid primary key default gen_random_uuid(),
  nature                 text not null,
  profile_id             uuid not null references public.profiles(id) on delete cascade,
  domain_id              uuid references public.domains(id),
  statut                 text not null default 'en_attente',
  tentatives             integer not null default 0,
  max_tentatives         integer not null default 3,
  prochaine_tentative_at timestamptz not null default now(),
  bail_jusqu_a           timestamptz,
  -- La pièce du GESTE qui a déposé le travail : ses lignes s'écrivent sous elle.
  piece                  uuid not null,
  acteur_id              uuid,
  acteur_type            text,
  charge                 jsonb not null default '{}'::jsonb,
  resultat               jsonb,
  -- Le dernier motif d'échec, NOMMÉ ; conservé pendant les reprises (il dit pourquoi on rejoue).
  erreur_code            text,
  -- `clock_timestamp()`, pas `now()` : « remplacé par un travail plus récent » compare ces dates, et `now()`
  -- est FIGÉ pour toute une transaction — deux dépôts d'une même transaction seraient « du même instant ».
  cree_at                timestamptz not null default clock_timestamp(),
  debut_at               timestamptz,
  fin_at                 timestamptz,
  constraint travaux_ia_nature_check     check (nature in ('analyse_cv', 'verification_expert')),
  constraint travaux_ia_statut_check     check (statut in ('en_attente', 'en_cours', 'reussi', 'echoue', 'annule')),
  constraint travaux_ia_tentatives_check check (tentatives >= 0 and max_tentatives between 1 and 10 and tentatives <= max_tentatives),
  constraint travaux_ia_bail_si_en_cours check ((statut = 'en_cours') = (bail_jusqu_a is not null)),
  constraint travaux_ia_fin_si_clos      check ((statut in ('reussi', 'echoue', 'annule')) = (fin_at is not null)),
  constraint travaux_ia_code_si_echec    check (statut <> 'echoue' or erreur_code is not null),
  constraint travaux_ia_code_forme       check (erreur_code is null or erreur_code ~ '^[a-z][a-z0-9_]{2,60}$'),
  constraint travaux_ia_charge_objet     check (jsonb_typeof(charge) = 'object'),
  constraint travaux_ia_acteur_coherent  check ((acteur_id is null) = (acteur_type is null)),
  constraint travaux_ia_acteur_type_check check (acteur_type is null or acteur_type in ('expert_freelance', 'expert_cdi', 'client', 'cabinet', 'admin'))
);
alter table public.travaux_ia enable row level security;
revoke all on table public.travaux_ia from anon, authenticated;

-- Au plus UN travail actif par profil et par nature : la garde est une clé (§E.31).
create unique index if not exists travaux_ia_un_actif
  on public.travaux_ia (profile_id, nature) where statut in ('en_attente', 'en_cours');
create index if not exists travaux_ia_dus   on public.travaux_ia (prochaine_tentative_at) where statut = 'en_attente';
create index if not exists travaux_ia_baux  on public.travaux_ia (bail_jusqu_a) where statut = 'en_cours';
create index if not exists travaux_ia_profil on public.travaux_ia (profile_id, cree_at desc);
create index if not exists travaux_ia_echecs on public.travaux_ia (fin_at desc) where statut = 'echoue';

comment on table public.travaux_ia is
$$Les travaux d'IA longs (analyse d'un CV, vérification d'un expert), exécutés hors de la requête de
l'expert par /api/cron/travaux-ia. Déposés par deposer_analyse_cv / deposer_verification_expert, pris
par prendre_travail_ia, terminés par terminer_analyse_cv / conclure_verification_expert, échoués par
echouer_travail_ia, clos par le pilote pg_cron (travaux_ia_pilote). §D.30.$$;


-- ── ② LE GRAND LIVRE : deux actions, un écrivain ────────────────────────────
insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('travail_ia_echoue',  'profil',         null, 'journal.actions.travail_ia_echoue'),
  ('travail_ia_relance', 'administration', null, 'journal.actions.travail_ia_relance')
on conflict (code) do nothing;
-- UNE forme pour les deux faces du même écrivain (`journaliser_travail_ia`, le code dérivé du geste) — comme
-- `maj_membre_organisation()` pour ses trois codes : le contrôle suit le détail jusqu'aux littéraux de CHAQUE
-- appelant, et un seul écrivain qui porte deux formes doit les déclarer toutes les deux.
update public.grand_livre_actions set cles_detail = array['nature', 'code', 'tentatives', 'travail_origine', 'code_origine']::text[]
 where code = 'travail_ia_echoue';
update public.grand_livre_actions set cles_detail = array['nature', 'code', 'tentatives', 'travail_origine', 'code_origine']::text[]
 where code = 'travail_ia_relance';
-- `cv_televerse` est désormais écrite par l'exécutant, quand l'analyse ABOUTIT, avec le nombre d'ÉCARTS (§E.88).
update public.grand_livre_actions
   set cles_detail = array['octets', 'analyse', 'premier_consentement', 'experiences', 'formations', 'langues', 'ecarts']::text[]
 where code = 'cv_televerse';

create or replace function public.journaliser_travail_ia(
  p_piece         uuid,
  p_piece_origine uuid,
  p_origine       text,
  p_acteur_id     uuid,
  p_acteur_type   text,
  p_ecosysteme_id uuid,
  p_profile_id    uuid,
  p_relance       boolean,
  p_detail        jsonb
) returns bigint
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
begin
  return public.journaliser(
    p_piece,
    case when p_relance then 'travail_ia_relance' else 'travail_ia_echoue' end,
    case when p_relance then 'reussi' else 'echoue' end,
    p_origine, p_acteur_id, p_acteur_type, p_ecosysteme_id,
    'profiles', p_profile_id,
    coalesce(p_detail, '{}'::jsonb),
    p_piece_origine, null::numeric, null::text);
end;
$fn$;
revoke all on function public.journaliser_travail_ia(uuid, uuid, text, uuid, text, uuid, uuid, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.journaliser_travail_ia(uuid, uuid, text, uuid, text, uuid, uuid, boolean, jsonb)
  to service_role;


-- ── ③ RÉVEILLER L'EXÉCUTANT — sans jamais faire échouer le dépôt ────────────
--  Un secret Vault absent n'annule pas le travail : il attend, le pilote le voit,
--  et au-delà de 30 minutes il le clôt avec un motif nommé (`non_execute`).
create or replace function public.reveiller_travaux_ia()
  returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
begin
  perform public.trigger_purge_cron('travaux_ia', '/api/cron/travaux-ia');
  return true;
exception when others then
  raise warning 'reveiller_travaux_ia : exécutant non réveillé (%) — le pilote reprendra ou clôra', sqlerrm;
  return false;
end;
$fn$;
revoke all on function public.reveiller_travaux_ia() from public, anon, authenticated, service_role;


-- ── ④ DÉPOSER — l'état du profil et le travail, ensemble ────────────────────
create or replace function public.deposer_travail_ia(
  p_nature      text,
  p_profile_id  uuid,
  p_charge      jsonb,
  p_piece       uuid,
  p_acteur_id   uuid,
  p_acteur_type text
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_id      uuid;
  v_domaine uuid;
begin
  if p_piece is null then
    raise exception 'deposer_travail_ia : la piece est obligatoire' using errcode = 'GL002';
  end if;
  select p.domain_id into v_domaine from public.profiles p where p.id = p_profile_id;
  -- L'ANCIEN travail de même nature est ANNULÉ : un document plus récent, une
  -- publication plus récente le rendent sans objet. Conditionnel : il n'y en a
  -- souvent aucun.
  update public.travaux_ia t
     set statut = 'annule', fin_at = now(), bail_jusqu_a = null
   where t.profile_id = p_profile_id and t.nature = p_nature and t.statut in ('en_attente', 'en_cours');
  insert into public.travaux_ia (nature, profile_id, domain_id, piece, acteur_id, acteur_type, charge)
  values (p_nature, p_profile_id, v_domaine, p_piece, p_acteur_id, p_acteur_type, coalesce(p_charge, '{}'::jsonb))
  returning id into v_id;
  perform public.reveiller_travaux_ia();
  return v_id;
end;
$fn$;
revoke all on function public.deposer_travail_ia(text, uuid, jsonb, uuid, uuid, text) from public, anon, authenticated, service_role;

create or replace function public.deposer_analyse_cv(
  p_profile_id  uuid,
  p_chemin      text,
  p_hash        text,
  p_octets      integer,
  p_piece       uuid,
  p_acteur_id   uuid,
  p_acteur_type text
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_premier boolean;
  v_n       integer;
  v_id      uuid;
begin
  select p.ai_consent_at is null into v_premier from public.profiles p where p.id = p_profile_id for update;
  if v_premier is null then
    raise exception 'deposer_analyse_cv : profil % inconnu', p_profile_id using errcode = 'P0002';
  end if;
  -- Le consentement est horodaté au PREMIER dépôt et jamais réécrit (la route ne
  -- dépose qu'après la case cochée : sans elle, 400 consent_missing).
  update public.profiles p
     set cv_file_path      = p_chemin,
         cv_hash           = p_hash,
         cv_uploaded_at    = now(),
         cv_parsing_status = 'processing',
         cv_parsed_at      = null,
         cv_parsing_error  = null,
         ai_consent_at     = coalesce(p.ai_consent_at, now())
   where p.id = p_profile_id;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'deposer_analyse_cv : profiles');
  v_id := public.deposer_travail_ia('analyse_cv', p_profile_id,
            jsonb_build_object('chemin', p_chemin, 'hash', p_hash, 'octets', p_octets, 'premier_consentement', v_premier),
            p_piece, p_acteur_id, p_acteur_type);
  return jsonb_build_object('travail', v_id, 'premier_consentement', v_premier);
end;
$fn$;
revoke all on function public.deposer_analyse_cv(uuid, text, text, integer, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.deposer_analyse_cv(uuid, text, text, integer, uuid, uuid, text) to service_role;

create or replace function public.deposer_verification_expert(
  p_profile_id  uuid,
  p_piece       uuid,
  p_acteur_id   uuid,
  p_acteur_type text
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_statut text;
begin
  select p.verification_status into v_statut from public.profiles p where p.id = p_profile_id for update;
  if not found then
    raise exception 'deposer_verification_expert : profil % inconnu', p_profile_id using errcode = 'P0002';
  end if;
  -- Un profil DÉJÀ approuvé le reste pendant la vérification (le verdict démote
  -- s'il le faut) ; tout autre passe « en cours », et l'écran le dit.
  -- Conditionnel : un approuvé n'a rien à écrire ici.
  update public.profiles p
     set verification_status = 'pending'
   where p.id = p_profile_id and p.verification_status is distinct from 'approved';
  return public.deposer_travail_ia('verification_expert', p_profile_id, '{}'::jsonb, p_piece, p_acteur_id, p_acteur_type);
end;
$fn$;
revoke all on function public.deposer_verification_expert(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.deposer_verification_expert(uuid, uuid, uuid, text) to service_role;


-- ── ⑤ PRENDRE — un travail dû, sous bail ─────────────────────────────────────
create or replace function public.prendre_travail_ia(p_duree_bail interval)
  returns setof public.travaux_ia
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_t public.travaux_ia;
  v_n integer;
begin
  select * into v_t
    from public.travaux_ia t
   where t.statut = 'en_attente' and t.prochaine_tentative_at <= now()
   order by t.prochaine_tentative_at
   limit 1
     for update skip locked;
  if not found then
    return;
  end if;
  update public.travaux_ia t
     set statut       = 'en_cours',
         tentatives   = t.tentatives + 1,
         debut_at     = now(),
         bail_jusqu_a = now() + p_duree_bail
   where t.id = v_t.id
  returning * into v_t;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'prendre_travail_ia : travaux_ia');
  return next v_t;
end;
$fn$;
revoke all on function public.prendre_travail_ia(interval) from public, anon, authenticated;
grant execute on function public.prendre_travail_ia(interval) to service_role;


-- ── ⑥ LE REPLI D'UN TRAVAIL ABANDONNÉ, et sa ligne ──────────────────────────
create or replace function public.clore_travail_ia_en_echec(p_travail uuid, p_code text)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_t public.travaux_ia;
  v_n integer;
  v_statut text;
begin
  update public.travaux_ia t
     set statut = 'echoue', erreur_code = p_code, fin_at = now(), bail_jusqu_a = null
   where t.id = p_travail and t.statut in ('en_attente', 'en_cours')
  returning * into v_t;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'clore_travail_ia_en_echec : travaux_ia');

  if v_t.nature = 'analyse_cv' then
    -- L'analyse est ÉCHOUÉE, NOMMÉE : l'écran dit la cause, l'expert redépose.
    -- Conditionnel sur « en cours » : un profil déjà sorti de cet état n'a rien à recevoir.
    update public.profiles p
       set cv_parsing_status = 'failed', cv_parsing_error = p_code
     where p.id = v_t.profile_id and p.cv_parsing_status = 'processing';
  else
    select p.verification_status into v_statut from public.profiles p where p.id = v_t.profile_id;
    -- La vérification part en revue HUMAINE — jamais une approbation sur une panne.
    -- Un profil déjà approuvé le reste : sa re-vérification a échoué, pas lui.
    if v_statut = 'pending' then
      -- La note lue par l'administrateur : écrite ICI, jamais confiée à l'écrivain du grand livre.
      update public.profiles p
         set verification_data = jsonb_build_object('notes', 'La vérification automatique n''a pas abouti (' || p_code || ') — vérification manuelle requise.', 'code', p_code)
       where p.id = v_t.profile_id;
      get diagnostics v_n = row_count;
      perform public.exiger_ecriture(v_n, 'clore_travail_ia_en_echec : note du profil');
      perform public.poser_verdict_verification(v_t.piece, v_t.profile_id, false, 'manual_only', null, 'travail_echoue');
    end if;
  end if;

  perform public.journaliser_travail_ia(
    v_t.piece, null,
    case when v_t.acteur_type = 'admin' then 'administrateur' when v_t.acteur_id is not null then 'utilisateur' else 'systeme' end,
    v_t.acteur_id, v_t.acteur_type, v_t.domain_id, v_t.profile_id, false,
    jsonb_build_object('nature', v_t.nature, 'code', p_code, 'tentatives', v_t.tentatives));
end;
$fn$;
revoke all on function public.clore_travail_ia_en_echec(uuid, text) from public, anon, authenticated, service_role;


-- ── ⑦ ÉCHOUER — rejouer ce qui se rejoue, clore le reste ────────────────────
create or replace function public.echouer_travail_ia(p_travail uuid, p_code text, p_rejouable boolean)
  returns text
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_t public.travaux_ia;
  v_n integer;
begin
  select * into v_t from public.travaux_ia t where t.id = p_travail for update;
  if not found then
    raise exception 'echouer_travail_ia : travail % inconnu', p_travail using errcode = 'P0002';
  end if;
  -- Annulé entre-temps (un dépôt plus récent) : rien à écrire, et c'est une issue.
  if v_t.statut <> 'en_cours' then
    return v_t.statut;
  end if;
  if p_rejouable and v_t.tentatives < v_t.max_tentatives then
    update public.travaux_ia t
       set statut = 'en_attente',
           erreur_code = p_code,
           bail_jusqu_a = null,
           -- Délai croissant : 1, 2, 4… minutes, au plus 30.
           prochaine_tentative_at = now() + least(interval '30 minutes', interval '1 minute' * power(2, greatest(v_t.tentatives - 1, 0)))
     where t.id = p_travail;
    get diagnostics v_n = row_count;
    perform public.exiger_ecriture(v_n, 'echouer_travail_ia : reprise');
    return 'en_attente';
  end if;
  perform public.clore_travail_ia_en_echec(p_travail, p_code);
  return 'echoue';
end;
$fn$;
revoke all on function public.echouer_travail_ia(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.echouer_travail_ia(uuid, text, boolean) to service_role;


-- ── ⑧ TERMINER — le résultat s'écrit dans la transaction qui clôt le travail ─
create or replace function public.terminer_analyse_cv(
  p_travail       uuid,
  p_profil        jsonb,
  p_experiences   jsonb,
  p_formations    jsonb,
  p_langues       jsonb,
  p_fenetre_quota interval,
  p_ecarts_amont  jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_t   public.travaux_ia;
  v_res jsonb;
  v_n   integer;
begin
  select * into v_t from public.travaux_ia t where t.id = p_travail for update;
  if not found then
    raise exception 'terminer_analyse_cv : travail % inconnu', p_travail using errcode = 'P0002';
  end if;
  -- Un travail ANNULÉ (un CV plus récent a été déposé) n'écrit pas son analyse :
  -- elle décrirait un document qui n'est plus celui du profil.
  if v_t.statut <> 'en_cours' or v_t.nature <> 'analyse_cv' then
    return jsonb_build_object('ecrit', false, 'statut', v_t.statut);
  end if;
  v_res := public.ecrire_analyse_cv(v_t.profile_id, p_profil, p_experiences, p_formations, p_langues, p_fenetre_quota);
  v_res := jsonb_set(v_res, '{ecarts}', coalesce(p_ecarts_amont, '[]'::jsonb) || coalesce(v_res -> 'ecarts', '[]'::jsonb));
  update public.travaux_ia t
     set statut = 'reussi', resultat = v_res, fin_at = now(), bail_jusqu_a = null, erreur_code = null
   where t.id = p_travail;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'terminer_analyse_cv : travaux_ia');
  return v_res || jsonb_build_object('ecrit', true);
end;
$fn$;
revoke all on function public.terminer_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb, interval, jsonb) from public, anon, authenticated;
grant execute on function public.terminer_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb, interval, jsonb) to service_role;

create or replace function public.conclure_verification_expert(
  p_travail  uuid,
  p_approuve boolean,
  p_methode  text,
  p_score    numeric,
  p_donnees  jsonb,
  p_motif    text
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_t   public.travaux_ia;
  v_res jsonb;
  v_n   integer;
begin
  select * into v_t from public.travaux_ia t where t.id = p_travail for update;
  if not found then
    raise exception 'conclure_verification_expert : travail % inconnu', p_travail using errcode = 'P0002';
  end if;
  if v_t.statut <> 'en_cours' or v_t.nature <> 'verification_expert' then
    return jsonb_build_object('conclu', false, 'statut', v_t.statut);
  end if;
  -- Les DONNÉES du verdict (notes, écarts relevés par l'IA) s'écrivent ICI : l'écrivain du grand livre ne les reçoit pas.
  update public.profiles p set verification_data = p_donnees where p.id = v_t.profile_id;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'conclure_verification_expert : données du verdict');
  v_res := public.poser_verdict_verification(v_t.piece, v_t.profile_id, p_approuve, p_methode, p_score, p_motif);
  update public.travaux_ia t
     set statut = 'reussi', fin_at = now(), bail_jusqu_a = null, erreur_code = null,
         resultat = jsonb_build_object('approuve', p_approuve, 'motif', p_motif, 'score', p_score)
   where t.id = p_travail;
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'conclure_verification_expert : travaux_ia');
  return v_res || jsonb_build_object('conclu', true);
end;
$fn$;
revoke all on function public.conclure_verification_expert(uuid, boolean, text, numeric, jsonb, text) from public, anon, authenticated;
grant execute on function public.conclure_verification_expert(uuid, boolean, text, numeric, jsonb, text) to service_role;


-- ── ⑨ CLORE CE QUI EST PERDU — le pilote, sans l'hébergeur ─────────────────
create or replace function public.clore_travaux_ia_perdus(p_attente_max interval default interval '30 minutes')
  returns integer
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_t public.travaux_ia;
  v_k integer := 0;
  v_n integer;
begin
  -- Un bail EXPIRÉ : l'exécutant a été coupé. On rejoue s'il reste une tentative.
  for v_t in
    select * from public.travaux_ia t
     where t.statut = 'en_cours' and t.bail_jusqu_a < now()
     for update skip locked
  loop
    if v_t.tentatives < v_t.max_tentatives then
      -- La ligne est VERROUILLÉE par la boucle : elle est encore « en cours », l'écriture touche une ligne.
      update public.travaux_ia t
         set statut = 'en_attente', bail_jusqu_a = null, erreur_code = 'delai_depasse', prochaine_tentative_at = now()
       where t.id = v_t.id;
      get diagnostics v_n = row_count;
      perform public.exiger_ecriture(v_n, 'clore_travaux_ia_perdus : reprise');
    else
      perform public.clore_travail_ia_en_echec(v_t.id, 'delai_depasse');
    end if;
    v_k := v_k + 1;
  end loop;
  -- Un travail que PERSONNE n'a pris : l'exécutant ne répond pas (secret absent,
  -- hébergeur injoignable). On ne le laisse pas attendre pour toujours.
  for v_t in
    select * from public.travaux_ia t
     where t.statut = 'en_attente' and t.prochaine_tentative_at < now() - p_attente_max
     for update skip locked
  loop
    perform public.clore_travail_ia_en_echec(v_t.id, 'non_execute');
    v_k := v_k + 1;
  end loop;
  return v_k;
end;
$fn$;
revoke all on function public.clore_travaux_ia_perdus(interval) from public, anon, authenticated, service_role;

create or replace function public.piloter_travaux_ia()
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
begin
  perform public.clore_travaux_ia_perdus();
  if exists (select 1 from public.travaux_ia t where t.statut = 'en_attente' and t.prochaine_tentative_at <= now()) then
    perform public.reveiller_travaux_ia();
  end if;
end;
$fn$;
revoke all on function public.piloter_travaux_ia() from public, anon, authenticated, service_role;


-- ── ⑩ RELANCER — un administrateur, un travail échoué, une ligne ────────────
create or replace function public.relancer_travail_ia(
  p_piece         uuid,
  p_piece_origine uuid,
  p_origine       text,
  p_acteur_id     uuid,
  p_acteur_type   text,
  p_travail       uuid
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_t  public.travaux_ia;
  v_id uuid;
begin
  if p_acteur_id is null then
    raise exception 'relancer_travail_ia : un administrateur est obligatoire' using errcode = 'GL002';
  end if;
  select * into v_t from public.travaux_ia t where t.id = p_travail for update;
  if not found or v_t.statut <> 'echoue' then
    return null;
  end if;
  if v_t.nature = 'analyse_cv' then
    v_id := (public.deposer_analyse_cv(v_t.profile_id, v_t.charge ->> 'chemin', v_t.charge ->> 'hash',
                                       (v_t.charge ->> 'octets')::integer, p_piece, p_acteur_id, p_acteur_type) ->> 'travail')::uuid;
  else
    v_id := public.deposer_verification_expert(v_t.profile_id, p_piece, p_acteur_id, p_acteur_type);
  end if;
  perform public.journaliser_travail_ia(
    p_piece, p_piece_origine, p_origine, p_acteur_id, p_acteur_type, v_t.domain_id, v_t.profile_id, true,
    jsonb_build_object('nature', v_t.nature, 'travail_origine', v_t.id, 'code_origine', v_t.erreur_code));
  return v_id;
end;
$fn$;
revoke all on function public.relancer_travail_ia(uuid, uuid, text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.relancer_travail_ia(uuid, uuid, text, uuid, text, uuid) to service_role;


-- ── ⑪ bis CE QUI ATTEND UN HUMAIN — une expression, lue par l'écran ET par la supervision (§E.36) ──
--  · un travail ÉCHOUÉ que rien n'a remplacé (ni un nouveau dépôt, ni une relance) ;
--  · un travail EN RETARD : dû depuis 5 minutes sans être pris (l'exécutant ne répond pas) ;
--  · un travail dont le BAIL a expiré (l'exécutant est mort ; le pilote le reprend à la minute).
--  La supervision rougit tant que cette liste n'est pas vide ; le bouton « Relancer » la fait descendre.
create or replace function public.travaux_ia_en_souffrance(p_depuis interval default interval '30 days')
  returns setof public.travaux_ia
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select t.*
    from public.travaux_ia t
   where (t.statut = 'echoue'
          and t.fin_at > now() - p_depuis
          and not exists (select 1 from public.travaux_ia n
                           where n.profile_id = t.profile_id and n.nature = t.nature and n.cree_at > t.cree_at))
      or (t.statut = 'en_attente' and t.prochaine_tentative_at < now() - interval '5 minutes')
      or (t.statut = 'en_cours' and t.bail_jusqu_a < now())
   order by coalesce(t.fin_at, t.prochaine_tentative_at, t.cree_at) desc
$fn$;
revoke all on function public.travaux_ia_en_souffrance(interval) from public, anon, authenticated;
grant execute on function public.travaux_ia_en_souffrance(interval) to service_role;


-- ── ⑪ LE PILOTE : pg_cron, chaque minute, en SQL ────────────────────────────
do $$
begin
  perform cron.unschedule('travaux_ia_pilote');
exception when others then
  null;
end
$$;

select cron.schedule(
  'travaux_ia_pilote',
  '* * * * *',
  $job$select public.piloter_travaux_ia()$job$
);


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_nom text;
begin
  if to_regclass('public.travaux_ia') is null then
    raise exception 'postcondition NON TENUE : la table travaux_ia manque';
  end if;
  for v_nom in select unnest(array[
      'public.deposer_analyse_cv(uuid, text, text, integer, uuid, uuid, text)',
      'public.deposer_verification_expert(uuid, uuid, uuid, text)',
      'public.prendre_travail_ia(interval)',
      'public.echouer_travail_ia(uuid, text, boolean)',
      'public.terminer_analyse_cv(uuid, jsonb, jsonb, jsonb, jsonb, interval, jsonb)',
      'public.conclure_verification_expert(uuid, boolean, text, numeric, jsonb, text)',
      'public.relancer_travail_ia(uuid, uuid, text, uuid, text, uuid)'])
  loop
    if to_regprocedure(v_nom) is null then
      raise exception 'postcondition NON TENUE : % manque', v_nom;
    end if;
    if has_function_privilege('authenticated', v_nom, 'execute') or has_function_privilege('anon', v_nom, 'execute') then
      raise exception 'postcondition NON TENUE : % ouverte au navigateur', v_nom;
    end if;
    if not has_function_privilege('service_role', v_nom, 'execute') then
      raise exception 'postcondition NON TENUE : % fermee a la cle de service', v_nom;
    end if;
  end loop;
  if not exists (select 1 from cron.job where jobname = 'travaux_ia_pilote') then
    raise exception 'postcondition NON TENUE : la tache pg_cron travaux_ia_pilote manque';
  end if;
  if (select count(*) from public.grand_livre_actions where code in ('travail_ia_echoue', 'travail_ia_relance')) <> 2 then
    raise exception 'postcondition NON TENUE : les deux actions des travaux d IA ne sont pas declarees';
  end if;
  raise notice 'postcondition tenue : travaux_ia, sept fonctions fermees au navigateur, le pilote pg_cron et deux actions ; le cycle (deposer, prendre, rejouer, clore, relancer) est prouve par tests/database/profil/travaux_ia.test.sql';
end
$post$;
