-- ════════════════════════════════════════════════════════════════════════════
--  REPRODUCTION DU PLANTAGE DU 28/09/2026 — BASE LOCALE UNIQUEMENT.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ⛔ JAMAIS sur staging ni en production : on cherche ce qui fait PLANTER le serveur.
--
--  LE FAIT. `grand_livre/appelant.test.sql` (version du 28/09) a tué le serveur local — signal 11,
--  « Failed process was running: select * from pg_temp.essai(); ». La fonction faisait, dans UN corps
--  plpgsql : `set local role service_role`, des `execute` de RPC SECURITY DEFINER, `reset role`, puis
--  `set local role authenticated` avec des blocs d'exception. Les mêmes RPC, appelées en postgres dans
--  les tests d'invitations et de membres, n'avaient rien fait planter.
--
--  CE QUE CE FICHIER TRANCHE. Six formes, de la plus nue à celle de l'ancien test, chacune UNE
--  instruction à étiquette propre (`$repro_a$` … `$repro_f$`, et les commentaires `REPRO-…`) : si le
--  serveur plante, sa ligne « Failed process was running: … » NOMME la forme. Les RPC y reçoivent des
--  identifiants inventés : elles s'exécutent (verrou, lecture, sortie), n'écrivent rien, et tout est
--  annulé (`rollback`).
--    A  changer de rôle dans un bloc anonyme, sans rien appeler
--    B  la même chose, en appelant une RPC SECURITY DEFINER en service_role (execute)
--    C  en authenticated, la RPC refusée, attrapée par un bloc d'exception
--    D  B puis C dans le même bloc — la séquence de l'ancien test
--    E  D, mais dans une fonction pg_temp qui rend `setof text` (la forme exacte de pg_temp.essai())
--    F  l'appel comme PostgREST le fait : `set local role` en INSTRUCTION, puis la RPC
--  Lecture : si A–E plantent et F non → la FORME du test (§E.76), le produit est hors de cause pour ce
--  chemin. Si F plante → un appel PostgREST suffit à tuer le serveur : DÉFAUT CRITIQUE DU PRODUIT.
--  Si rien ne plante → le plantage demande des DONNÉES réelles ; c'est `vrai_appelant/appelant.test.sql`
--  (qui en fabrique, et appelle chaque RPC en une instruction) qui nommera l'appel.
--
--  COMMENT LE LANCER (local) : l'éditeur SQL de Studio local (http://127.0.0.1:54323), coller ce fichier,
--  exécuter. Puis lire le journal de la base : `docker logs <conteneur supabase_db_…> 2>&1 | tail -40`.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- REPRO-A
do $repro_a$
begin
  set local role service_role;
  reset role;
end
$repro_a$;

-- REPRO-B
do $repro_b$
declare
  v boolean;
begin
  set local role service_role;
  execute 'select public.renvoyer_invitation(gen_random_uuid(), null, ''utilisateur'', gen_random_uuid(), ''client'', null, '
       || 'gen_random_uuid(), gen_random_uuid(), array[''pending''], ''jeton_repro'', now() + interval ''1 day'')' into v;
  reset role;
end
$repro_b$;

-- REPRO-C
do $repro_c$
begin
  set local role authenticated;
  begin
    execute 'select public.renvoyer_invitation(gen_random_uuid(), null, ''utilisateur'', gen_random_uuid(), ''client'', null, '
         || 'gen_random_uuid(), gen_random_uuid(), array[''pending''], ''jeton_repro'', now())';
  exception when insufficient_privilege then
    null;
  end;
  reset role;
end
$repro_c$;

-- REPRO-D
do $repro_d$
declare
  v boolean;
  t text;
begin
  set local role service_role;
  execute 'select public.renvoyer_invitation(gen_random_uuid(), null, ''utilisateur'', gen_random_uuid(), ''client'', null, '
       || 'gen_random_uuid(), gen_random_uuid(), array[''pending''], ''jeton_repro'', now() + interval ''1 day'')' into v;
  reset role;
  set local role service_role;
  execute 'select public.maj_membre_organisation(gen_random_uuid(), null, ''utilisateur'', gen_random_uuid(), ''client'', null, '
       || 'gen_random_uuid(), ''editor'', null, false)' into t;
  reset role;
  set local role authenticated;
  begin
    execute 'select public.renvoyer_invitation(gen_random_uuid(), null, ''utilisateur'', gen_random_uuid(), ''client'', null, '
         || 'gen_random_uuid(), gen_random_uuid(), array[''pending''], ''jeton_repro'', now())';
  exception when insufficient_privilege then
    null;
  end;
  reset role;
  set local role authenticated;
  begin
    execute 'update public.organization_invitations set token = ''repro'' where id = gen_random_uuid()';
  exception when insufficient_privilege then
    null;
  end;
  reset role;
end
$repro_d$;

-- REPRO-E : la forme exacte de l'ancien pg_temp.essai() — une fonction pg_temp qui rend setof text.
create or replace function pg_temp.repro_e() returns setof text language plpgsql as $repro_e$
declare
  v boolean;
begin
  set local role service_role;
  execute 'select public.renvoyer_invitation(gen_random_uuid(), null, ''utilisateur'', gen_random_uuid(), ''client'', null, '
       || 'gen_random_uuid(), gen_random_uuid(), array[''pending''], ''jeton_repro'', now() + interval ''1 day'')' into v;
  reset role;
  return next 'REPRO-E service_role passe';
  set local role authenticated;
  begin
    execute 'select public.renvoyer_invitation(gen_random_uuid(), null, ''utilisateur'', gen_random_uuid(), ''client'', null, '
         || 'gen_random_uuid(), gen_random_uuid(), array[''pending''], ''jeton_repro'', now())';
  exception when insufficient_privilege then
    null;
  end;
  reset role;
  return next 'REPRO-E authenticated passe';
end
$repro_e$;
select * from pg_temp.repro_e() /* REPRO-E */;

-- REPRO-F : comme PostgREST — le rôle en instruction, puis l'appel.
set local role service_role;
select public.renvoyer_invitation(gen_random_uuid(), null, 'utilisateur', gen_random_uuid(), 'client', null,
                                  gen_random_uuid(), gen_random_uuid(), array['pending'], 'jeton_repro', now() + interval '1 day') /* REPRO-F */;
reset role;

select 'REPRO : les six formes ont tourné sans planter' as verdict;
rollback;
