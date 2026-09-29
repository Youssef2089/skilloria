-- LE VISITEUR NON CONNECTÉ — chaque lecture qu'un écran public fait en base, AU RÔLE QUI LA FAIT VRAIMENT.
--
-- LE BALAYAGE (29/09/2026, §E.83) — les écrans sans connexion et leur chemin jusqu'à la base :
--   · accueil, CGU, contact, mentions, confidentialité, qui-sommes-nous → getDomainConfig (domains +
--     domain_configs) et loadTranslations (translations) : CLÉ DE SERVICE, au serveur ;
--   · inscription expert → /api/taxonomy (domains, branches, specialities, work_zones, translations) et
--     register-expert (inscription_refus) : CLÉ DE SERVICE ;
--   · inscription organisation, saisie du téléphone → /api/countries : clé PUBLIQUE, donc rôle ANON —
--     la SEULE lecture qu'un visiteur fait sous son propre rôle ; send-phone-otp (users) : clé de service ;
--   · invitation → /api/invitations/resolve (organization_invitations, organization_domains, users) et
--     /api/invitations/inscription (inscription_refus) : CLÉ DE SERVICE.
--   (connexion, rappel d'authentification, nouveau mot de passe : leurs lectures ont lieu APRÈS la
--   connexion — rôle authenticated, hors de ce fichier ; mot de passe oublié : l'authentification seule.)
-- La propriété : chacune de ces lectures RÉUSSIT sous ce rôle — un droit retiré, une politique changée,
-- et l'écran public tombe en « impossible de charger » : ici, le fichier rougit. Et la règle d'inscription
-- reste fermée au navigateur (anon, authenticated).
--
-- La forme de vrai_appelant/ : chaque changement d'identité est une INSTRUCTION de premier niveau, jamais
-- dans une fonction ; chaque lecture est UNE instruction ; le verdict se lit APRÈS `reset role`.
-- ⚠️ Ce fichier ne voit PAS l'HÔTE de la requête : c'est la panne du 29/09/2026 (une Preview Vercel dont
--    l'hôte ne portait pas d'écosystème). Elle est gardée par scripts/diag-hotes-ecosysteme.mjs.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../grand_livre/_fabriques.psql
select plan(12);

-- ── Les données, en postgres, par les chemins normaux (fabriques) ──
select pg_temp.fab_domaine() as dom \gset
select d.slug as slug from public.domains d where d.id = :'dom' \gset
select pg_temp.fab_compte('entreprise') as admin \gset
select m.organization_id as org from public.organization_members m where m.user_id = :'admin' limit 1 \gset
select gen_random_uuid() as p1, gen_random_uuid() as visiteur \gset
select public.creer_invitation(:'p1', null, 'utilisateur', :'admin', 'client', :'dom',
         jsonb_build_object('organization_id', :'org'::uuid, 'email', 'visiteur+' || gen_random_uuid() || '@exemple.invalid',
                            'token', 'hash_visiteur_sonde', 'role_in_org', 'viewer', 'expires_at', now() + interval '7 days',
                            'status', 'pending', 'domain_validation_passed', false, 'email_already_exists', false)) ->> 'id' as inv \gset
select pg_temp.fab_meta('expert', :'visiteur') as meta_expert \gset

-- ── EN anon : /api/countries, la seule lecture du visiteur sous son propre rôle ──
set local role anon;
select count(*) as pays_actifs from public.countries c where c.active \gset
select count(*) as pays_servis from (
  select code, name_fr, name_en, name_es, name_de, flag_emoji, phone_code, sort_order,
         registre_numero_libelle, registre_numero_exemple, registre_numero_longueur_min,
         registre_numero_longueur_max, registre_numero_alphanumerique
    from public.countries where active = true order by sort_order) s \gset
select count(*) as pays_inactifs from public.countries c where not c.active \gset
reset role;
select ok(:pays_servis > 0 and :pays_servis = :pays_actifs,
          'anon : /api/countries lit le référentiel des pays ACTIFS, avec toutes les colonnes que la route sert');
select is(:pays_inactifs::bigint, 0::bigint, 'anon : un pays inactif ne se lit pas (la politique filtre)');

-- ── EN service_role : ce que lisent les routes et les pages publiques pour le visiteur ──
set local role service_role;
select count(*) as eco from public.domains d left join public.domain_configs c on c.domain_id = d.id
 where d.slug = :'slug' and d.active \gset
reset role;
select ok(:eco >= 1, 'service_role : getDomainConfig lit l''écosystème et sa configuration (accueil, pages publiques)');

set local role service_role;
select count(*) as branches from (select id, name, slug, sort_order from public.branches where domain_id = :'dom' and active) b \gset
select count(*) as specialites from (select id, name, slug, branch_id, sort_order from public.specialities where domain_id = :'dom' and active) s \gset
select count(*) as zones from (select id, parent_id, kind, code, country_code, name, slug, sort_order from public.work_zones where active) z \gset
select count(*) as traductions from (select table_name, row_id, field, locale, value from public.translations where locale in ('en', 'fr')) t \gset
reset role;
select ok(:branches > 0, 'service_role : /api/taxonomy lit les BRANCHES de l''écosystème (le formulaire expert)');
select ok(:specialites >= 0 and :zones >= 0 and :traductions >= 0,
          'service_role : /api/taxonomy lit les spécialités, les zones de travail et les traductions');

set local role service_role;
select count(*) as invitation from public.organization_invitations i join public.organizations o on o.id = i.organization_id
 where i.token = 'hash_visiteur_sonde' \gset
select count(*) as eco_org from public.organization_domains od join public.domains d on d.id = od.domain_id
 where od.organization_id = :'org' and od.active \gset
select count(*) as compte_existant from public.users u where u.email ilike 'visiteur+personne@exemple.invalid' \gset
reset role;
select ok(:invitation = 1 and :eco_org >= 1 and :compte_existant = 0,
          'service_role : /api/invitations/resolve lit l''invitation, son organisation, son écosystème, et cherche un compte existant');

set local role service_role;
select count(*) as telephone_pris from public.users u where u.phone = '+33600000001' and u.phone_verified \gset
select public.inscription_refus(pg_temp.fab_email(:'visiteur'), :'meta_expert'::jsonb) is null as regle_ouverte \gset
reset role;
select ok(:telephone_pris >= 0, 'service_role : send-phone-otp lit l''unicité du téléphone');
select ok(:'regle_ouverte'::boolean, 'service_role : les routes d''inscription posent la question à la base (inscription_refus)');

-- ── La règle d'inscription reste FERMÉE au navigateur (la sécurité en base) ──
set local role anon;
select throws_ok(format('select public.inscription_refus(%L, %L::jsonb)', 'x@exemple.invalid', '{}'),
                 '42501', null, 'anon : inscription_refus est refusée (42501)');
select throws_ok(format('select public.taxonomie_inscription_refus(%L, null, null)', :'dom'),
                 '42501', null, 'anon : taxonomie_inscription_refus est refusée (42501)');
reset role;
set local role authenticated;
select throws_ok(format('select public.inscription_refus(%L, %L::jsonb)', 'x@exemple.invalid', '{}'),
                 '42501', null, 'authenticated : inscription_refus est refusée (42501)');
reset role;

-- ── Et la preuve ne se lit par personne ──
select ok(not has_function_privilege('anon', 'public.preuve_inscription_signature(text, boolean)', 'execute')
          and not has_function_privilege('service_role', 'public.preuve_inscription_signature(text, boolean)', 'execute'),
          'la signature de la preuve n''est exécutable ni par anon ni par la clé de service');

select * from finish();
rollback;
