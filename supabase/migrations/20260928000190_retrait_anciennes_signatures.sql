-- ════════════════════════════════════════════════════════════════════════════
--  LE RETRAIT DES DEUX ANCIENNES SIGNATURES — l'étape 3 de §E.72.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : APRÈS le déploiement de la phase B. C'est le cas : les dix-sept
--  migrations de la phase B sont appliquées sur staging et le code est en ligne
--  (Youssef, 28/09/2026). Le code en ligne n'appelle plus ni l'une ni l'autre :
--    · le webhook Stripe réclame par `stripe_event_reclamer` (app/api/stripe/webhook/route.ts) ;
--    · le lancement à la main passe par la NOUVELLE `admin_cron_run_now`
--      (uuid, uuid, text, uuid, text, text) — app/api/admin/cron-jobs/[name]/run/route.ts.
--  Passée AVANT le déploiement, elle aurait cassé les deux routes jusqu'au déploiement :
--  c'est pourquoi elle arrive seule, au push suivant (§E.72 : ajout, déploiement, suppression).
--
--  CE QUI PART :
--    · `stripe_event_claim(text, text, jsonb, boolean)` — remplacée par
--      `stripe_event_reclamer(…, uuid)`, qui pose la pièce de la livraison dans la même
--      instruction (migration piece_sous_journaux). Un AUTRE nom, pas une surcharge.
--    · `admin_cron_run_now(text, uuid)` — la surcharge d'avant le grand livre, sans pièce
--      ni ligne `tache_lancee_a_la_main`. La nouvelle signature reste, seule.
--  Rien n'est recréé : aucune donnée n'est touchée, aucune ligne n'est lue.
--
--  `if exists` : rejouable, et sans effet sur une base où elles seraient déjà parties.
-- ─────────────────────────────────────────────────────────────────────────────

drop function if exists public.stripe_event_claim(text, text, jsonb, boolean);
drop function if exists public.admin_cron_run_now(text, uuid);

do $post$
begin
  if to_regprocedure('public.stripe_event_claim(text, text, jsonb, boolean)') is not null then
    raise exception 'postcondition NON TENUE : stripe_event_claim est encore là';
  end if;
  if to_regprocedure('public.admin_cron_run_now(text, uuid)') is not null then
    raise exception 'postcondition NON TENUE : l''ancienne admin_cron_run_now(text, uuid) est encore là';
  end if;
  -- Les remplaçantes RESTENT — une suppression qui emporterait la mauvaise signature se voit ici.
  if to_regprocedure('public.stripe_event_reclamer(text, text, jsonb, boolean, uuid)') is null then
    raise exception 'postcondition NON TENUE : stripe_event_reclamer a disparu';
  end if;
  if to_regprocedure('public.admin_cron_run_now(uuid, uuid, text, uuid, text, text)') is null then
    raise exception 'postcondition NON TENUE : la nouvelle admin_cron_run_now a disparu';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'admin_cron_run_now') <> 1 then
    raise exception 'postcondition NON TENUE : admin_cron_run_now n''a pas exactement une signature';
  end if;
  raise notice 'postcondition tenue : stripe_event_claim et admin_cron_run_now(text, uuid) retirées, les remplaçantes restent, une signature chacune ; prouve par tests/database/une_signature.test.sql';
end
$post$;
