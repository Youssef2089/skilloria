-- ─────────────────────────────────────────────────────────────────────────────
-- UNICITÉ DU TÉLÉPHONE VÉRIFIÉ — « 1 numéro vérifié = 1 compte ».
--
-- CONTEXTE
--   La règle projet « 1 expert = 1 téléphone vérifié à vie » n'était pas tenue :
--   aucun UNIQUE sur users.phone nulle part. Un individu pouvait créer autant de
--   comptes que d'emails. Le téléphone vérifié par OTP est la seule barrière
--   réelle contre la multiplication de comptes (la vérification IA d'expertise
--   est franchissable — un recruteur recycle un CV authentique).
--
-- CE QUE FAIT CETTE MIGRATION
--   Pose un index UNIQUE PARTIEL sur public.users(phone) WHERE phone_verified.
--   PARTIEL car :
--     - les numéros NON vérifiés (profils cosmétiques) ne doivent pas bloquer ;
--     - les NULL (immense majorité des comptes) ne doivent pas collisionner.
--   Portée : TOUS types confondus (expert + org). Décision produit D2 : un
--   numéro vérifié n'appartient qu'à UN compte, quel que soit son user_type.
--
-- PRÉREQUIS DE FIABILITÉ — la normalisation E.164
--   L'unicité ne vaut que si tous les numéros vérifiés sont stockés sous forme
--   canonique. lib/phone.normalizeE164 est branché (même sprint) sur les 3
--   chemins OTP + register-org + register-expert AVANT tout stockage. Sans ça,
--   « +33612345678 » et « +330612345678 » échapperaient à l'index.
--
-- GARDE — refus propre si des doublons existent déjà
--   CREATE UNIQUE INDEX échouerait de toute façon sur un doublon, mais avec un
--   message Postgres opaque. On échoue AVANT, avec un message actionnable qui
--   liste les numéros en cause (pattern identique à 20260709000004). Les rares
--   double-casquettes (un dirigeant aussi expert avec le même numéro) sont
--   traitées À LA MAIN avant de rejouer — décision produit assumée.
--
-- IDEMPOTENCE
--   L'index est posé via IF NOT EXISTS. Rejouée, la migration ne fait rien.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ── 1. GARDE : aucun doublon de téléphone vérifié ne doit préexister ────────
do $$
declare
  v_dupes integer;
  v_sample text;
begin
  select count(*), string_agg(phone, ', ')
    into v_dupes, v_sample
  from (
    select phone
    from public.users
    where phone_verified = true
      and phone is not null
    group by phone
    having count(*) > 1
    limit 20
  ) d;

  if coalesce(v_dupes, 0) > 0 then
    raise exception
      'Migration interrompue : % numero(s) de telephone verifie(s) sont partages par plusieurs comptes. '
      'Regle « 1 numero verifie = 1 compte » impossible a poser en l''etat. '
      'Traitez ces doublons a la main (fusion / choix du compte legitime / dé-verification) puis rejouez. '
      'Numeros concernes (max 20) : %', v_dupes, coalesce(v_sample, '(indisponible)');
  end if;

  raise notice 'Garde OK — aucun doublon de telephone verifie.';
end $$;

-- ── 2. Index UNIQUE PARTIEL sur les téléphones VÉRIFIÉS (tous types) ────────
create unique index if not exists users_phone_verified_unique_idx
  on public.users (phone)
  where phone_verified = true;

comment on index public.users_phone_verified_unique_idx is
  '1 numero verifie = 1 compte, tous types confondus (decision produit ; les rares double-casquettes sont traitees a la main).';

commit;
