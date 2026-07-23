-- ─────────────────────────────────────────────────────────────────────────────
-- FENÊTRE DU JETON APRÈS SUPPRESSION — verrou RLS de LECTURE (C4).
--
-- CONTEXTE
--   À la demande de suppression, la session est révoquée côté serveur ET client
--   (lot précédent : admin.signOut global + last_session_token vidé + cookie
--   effacé + signOut client). MAIS un JWT d'accès déjà émis reste STATELESS :
--   PostgREST ne vérifie que sa signature + expiration, pas la révocation de
--   session → un compte en grâce pouvait encore LIRE ses données personnelles
--   en tapant directement l'API REST (~1 h, jusqu'à l'expiration du JWT).
--
--   RLS est le SEUL endroit qui ferme cette fenêtre immédiatement (PostgREST
--   évalue les policies à chaque requête). On ajoute donc la condition
--   « compte NON en cours de suppression » aux policies de LECTURE des données
--   personnelles de l'expert : profiles, users, et les tables enfant
--   (expériences, formations, langues).
--
-- ANTI-RÉCURSION (règle projet)
--   La policy de users doit tester users.deletion_scheduled_at — lire la MÊME
--   table dans sa propre policy provoquerait une récursion RLS. On passe donc
--   par une fonction SECURITY DEFINER `account_in_grace(uid)` : son corps
--   s'exécute avec les droits du propriétaire → BYPASS RLS → aucune
--   ré-évaluation de policy → pas de récursion. Bornée à l'uid passé.
--
-- ⚠ PIÈGE RÉACTIVATION — À TRANCHER EN REVUE AVANT DE POUSSER
--   Le parcours de réactivation LIT `users` côté CLIENT via RLS :
--     - app/[locale]/connexion/page.tsx (re-login → route vers /reactivation
--       en lisant user_type + deletion_scheduled_at) ;
--     - app/[locale]/reactivation/page.tsx (lit user_type).
--   Restreindre `users_self_read` CASSE ces deux lectures pour un compte en
--   grâce → la réactivation deviendrait impossible.
--   SOLUTION fournie ici : la fonction SECURITY DEFINER `my_account_routing()`
--   expose UNIQUEMENT les champs de routage/statut (user_type, domain_slug,
--   deletion_scheduled_at, anonymized_at) pour auth.uid(), quel que soit l'état
--   de grâce. La finalisation de C4 (après OK) rebranchera connexion +
--   /reactivation sur cette fonction (et sur la route allowlistée
--   /api/me/account/status) AU LIEU du SELECT direct sur `users`.
--   → NE PAS pousser cette migration seule : elle doit partir AVEC ce
--     rebranchement, sinon la réactivation casse.
--
--   Les routes serveur allowlistées (reactivate, status, logout) utilisent le
--   service_role → BYPASS RLS → elles continuent de fonctionner sans changement.
--
-- IDEMPOTENCE : CREATE OR REPLACE FUNCTION + ALTER POLICY (ré-exécutables).
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. Helper anti-récursion : le compte {uid} est-il en grâce (suppression
--       programmée, non purgé) ? SECURITY DEFINER → bypass RLS sur users.
create or replace function public.account_in_grace(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = p_uid
      and u.deletion_scheduled_at is not null
      and u.anonymized_at is null
  );
$$;

comment on function public.account_in_grace(uuid) is
  'true si le compte est en grâce (deletion_scheduled_at non nul, anonymized_at nul). '
  'SECURITY DEFINER pour éviter la récursion RLS quand une policy de users/profiles '
  'doit tester l''état de suppression. Bornée à l''uid passé.';

revoke all on function public.account_in_grace(uuid) from public;
grant execute on function public.account_in_grace(uuid) to authenticated, service_role;

-- ── 2. Lecture MINIMALE de routage/statut, accessible MÊME en grâce — c'est la
--       lecture « gardée accessible » exigée pour ne pas casser la réactivation.
--       N'expose QUE des champs non sensibles (type + domaine + dates de statut).
create or replace function public.my_account_routing()
returns table (
  user_type text,
  domain_slug text,
  deletion_scheduled_at timestamptz,
  anonymized_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.user_type::text,
    d.slug::text,
    u.deletion_scheduled_at,
    u.anonymized_at
  from public.users u
  left join public.domains d on d.id = u.domain_id
  where u.id = auth.uid();
$$;

comment on function public.my_account_routing() is
  'Lecture MINIMALE de routage pour l''utilisateur courant (auth.uid()) : '
  'user_type, domain_slug, deletion_scheduled_at, anonymized_at. Reste accessible '
  'en état de grâce (utilisée par le login et /reactivation) alors que le SELECT '
  'direct sur users/profiles est verrouillé. N''expose aucune donnée personnelle.';

revoke all on function public.my_account_routing() from public;
grant execute on function public.my_account_routing() to authenticated, service_role;

-- ── 3. Verrou des policies de LECTURE des données personnelles ───────────────
--       Un compte en grâce ne peut plus lire directement ses données via REST.

alter policy "profiles_self_read" on public.profiles
  using ((auth.uid() = user_id) and (not public.account_in_grace(auth.uid())));

alter policy "users_self_read" on public.users
  using ((auth.uid() = id) and (not public.account_in_grace(auth.uid())));

alter policy "pedu_self_read" on public.profile_educations
  using (
    (exists (
      select 1 from public.profiles p
      where p.id = profile_educations.profile_id and p.user_id = auth.uid()
    ))
    and (not public.account_in_grace(auth.uid()))
  );

alter policy "pexp_self_read" on public.profile_experiences
  using (
    (exists (
      select 1 from public.profiles p
      where p.id = profile_experiences.profile_id and p.user_id = auth.uid()
    ))
    and (not public.account_in_grace(auth.uid()))
  );

alter policy "plang_self_read" on public.profile_languages
  using (
    (exists (
      select 1 from public.profiles p
      where p.id = profile_languages.profile_id and p.user_id = auth.uid()
    ))
    and (not public.account_in_grace(auth.uid()))
  );

commit;
