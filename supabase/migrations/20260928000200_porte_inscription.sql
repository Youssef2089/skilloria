-- ════════════════════════════════════════════════════════════════════════════
--  LA PORTE D'INSCRIPTION SE FERME EN BASE — une preuve signée par le serveur,
--  vérifiée par `handle_new_user`, et chaque règle d'inscription écrite UNE fois.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement, ET LE DÉPLOIEMENT AUSSITÔT (§G.4 ter, étape 7).
--  Entre les deux, le code en ligne crée ses comptes SANS preuve : TOUTE inscription est
--  refusée (IN007), en base, avec un code — aucun compte n'entre par la porte qu'on ferme.
--  La fenêtre se compte en minutes. PRÉREQUIS : le secret `inscription_hmac_secret` existe
--  dans le Vault (la requête de staging le vérifie, par son nom) ; sans lui, IN011.
--
--  LE DÉFAUT (audit du 28/09/2026, §H.4) : un compte créé en appelant directement le
--  service d'authentification, avec la clé PUBLIQUE, passait `handle_new_user` (rôle,
--  écosystème, taxonomie) mais échappait à tout ce que vérifiaient les routes : téléphone,
--  CGU, formats, domaines d'adresse, unicité du domaine et du SIREN, organisation.
--
--  DÉCISION DE YOUSSEF (option b, 28/09/2026) :
--   ① UNE PREUVE SIGNÉE PAR LE SERVEUR. La route, après ce qu'elle seule peut vérifier
--     (le téléphone par OTP, la case des CGU), signe en HMAC-SHA256 l'adresse, le rôle,
--     l'écosystème, la voie, la pièce, une ÉCHÉANCE, la version des CGU, le téléphone,
--     l'invitation et son acteur. `handle_new_user` la recalcule avec le secret du Vault :
--     sans preuve IN007, altérée ou pour une autre adresse IN008, expirée IN009, secret
--     absent IN011. Elle ne se forge pas sans le secret. Le secret vit en deux copies
--     (Vault et Vercel, comme `cron_secret`) ; pour sa ROTATION, un second secret
--     `inscription_hmac_secret_precedent` est accepté tant qu'il existe (docs §D.27).
--   ② UNE RÈGLE, UNE DÉFINITION : `inscription_refus()` porte TOUTES les règles
--     d'inscription (formats, spécialité obligatoire, domaines bloqués ou publics, unicité
--     du domaine et du SIREN, invitation). La route l'appelle AVANT de créer le compte
--     (GoTrue avale l'erreur du trigger : « Database error saving new user » — la route ne
--     pourrait pas lire le refus) ; le trigger la rejoue en garde finale. Refus : IN010,
--     message « inscription refusee : <code> » — les codes anciens gardent leur SQLSTATE
--     (IN001 rôle, IN003 écosystème, IN004 rôle Gratuit, IN005 taxonomie, IN006 voie).
--   ③ CE QUE LA PREUVE ATTESTE S'ÉCRIT DANS LA MÊME TRANSACTION : le téléphone vérifié, le
--     consentement aux CGU (version et date — expert, organisation, invité ; PAS un
--     administrateur créé par un autre : il n'a rien accepté, et on n'écrit pas un
--     consentement qui n'a pas eu lieu).
--   ④ CE QUE LA VOIE CRÉE NAÎT DANS LA MÊME TRANSACTION, avec sa ligne SŒUR sous la pièce de
--     `compte_cree` : l'expert (`expert_inscrit`), l'organisation et son administrateur
--     (`creer_organisation_avec_admin`, `organisation_preinscrite`), l'invité et son
--     appartenance (`accepter_invitation`, `invitation_acceptee`), l'administrateur
--     (`promouvoir_administrateur`, `administrateur_cree`). Jamais un compte d'organisation
--     sans son organisation, ni l'inverse : le nettoyage d'après-coup n'a plus d'objet.
--
--  L'ÉCHÉANCE N'EST PAS ICI : le signataire la pose (5 minutes, `lib/inscription/preuve.mjs`),
--  la base la lit dans la preuve signée. Exception nommée à « aucune valeur dans le code »
--  (§D.27, comme §D.7) : la preuve est signée puis vérifiée dans la MÊME requête.
--
--  RIEN N'EST SUPPRIMÉ : `handle_new_user` garde sa signature (trigger), les autres
--  fonctions sont nouvelles. Les listes blanches de `expert_inscrit` et
--  `organisation_preinscrite` perdent leurs clés d'échec : la forme échouée n'existe plus
--  (une inscription refusée n'écrit rien — rien n'a changé).
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto with schema extensions;


-- ── ① LA CHAÎNE SIGNÉE — l'ordre des champs est un CONTRAT avec lib/inscription/preuve.mjs ──
--  Douze lignes, séparées par un saut de ligne ; un champ absent vaut ''. Un champ qui
--  contiendrait un saut de ligne déplacerait les suivants : `preuve_inscription_refus` compte
--  les onze séparateurs. `diag-porte-inscription` compare cet ordre à CHAMPS_SIGNES.
create or replace function public.preuve_inscription_canonique(p_email text, p_meta jsonb)
  returns text
  language sql
  immutable
  set search_path to 'public'
as $fn$
  select concat_ws(E'\n',
    'v1',
    lower(btrim(coalesce(p_email, ''))),
    coalesce(p_meta ->> 'role', ''),
    coalesce(p_meta ->> 'domain_slug', ''),
    coalesce(p_meta ->> 'voie', ''),
    coalesce(p_meta ->> 'piece', ''),
    coalesce(p_meta ->> 'preuve_expire_a', ''),
    coalesce(p_meta ->> 'cgu_version', ''),
    coalesce(p_meta ->> 'telephone', ''),
    coalesce(p_meta ->> 'invitation_id', ''),
    coalesce(p_meta ->> 'invitation_statuts', ''),
    coalesce(p_meta ->> 'acteur_id', ''))
$fn$;
revoke all on function public.preuve_inscription_canonique(text, jsonb) from public, anon, authenticated, service_role;


-- ── ② LA SIGNATURE — le seul endroit qui lit le secret ────────────────────────
--  Deux secrets seulement, par un booléen : jamais un nom de secret reçu en paramètre (la
--  fonction servirait alors d'oracle sur n'importe quel secret du Vault). NULL si absent.
create or replace function public.preuve_inscription_signature(p_canonique text, p_precedent boolean)
  returns text
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $fn$
declare
  v_secret text;
begin
  -- Deux lectures, chacune sous un nom LITTÉRAL : un nom construit ne se documente pas (diag-parametrage-manuel).
  if p_precedent then
    select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'inscription_hmac_secret_precedent';
  else
    select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'inscription_hmac_secret';
  end if;
  if v_secret is null or btrim(v_secret) = '' then
    return null;
  end if;
  return encode(extensions.hmac(p_canonique, v_secret, 'sha256'), 'hex');
end;
$fn$;
revoke all on function public.preuve_inscription_signature(text, boolean) from public, anon, authenticated, service_role;


-- ── ③ LE VERDICT SUR LA PREUVE — null si elle tient, sinon un code ────────────
create or replace function public.preuve_inscription_refus(p_email text, p_meta jsonb)
  returns text
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $fn$
declare
  v_preuve    text := lower(btrim(coalesce(p_meta ->> 'preuve', '')));
  v_canonique text := public.preuve_inscription_canonique(p_email, coalesce(p_meta, '{}'::jsonb));
  v_attendue  text;
  v_precedent text;
  v_expire    text := coalesce(p_meta ->> 'preuve_expire_a', '');
begin
  if v_preuve = '' then
    return 'preuve_absente';
  end if;
  v_attendue := public.preuve_inscription_signature(v_canonique, false);
  if v_attendue is null then
    return 'secret_absent';
  end if;
  -- Onze séparateurs, pas un de plus : un champ ne déborde pas sur son voisin.
  if length(v_canonique) - length(replace(v_canonique, E'\n', '')) <> 11 or strpos(v_canonique, E'\r') > 0 then
    return 'preuve_invalide';
  end if;
  if v_preuve <> v_attendue then
    v_precedent := public.preuve_inscription_signature(v_canonique, true);
    if v_precedent is null or v_preuve <> v_precedent then
      return 'preuve_invalide';
    end if;
  end if;
  -- L'échéance est SIGNÉE : on ne la lit qu'une fois la signature tenue.
  if v_expire !~ '^[0-9]{1,12}$' then
    return 'preuve_invalide';
  end if;
  if to_timestamp(v_expire::bigint) < now() then
    return 'preuve_expiree';
  end if;
  return null;
end;
$fn$;
revoke all on function public.preuve_inscription_refus(text, jsonb) from public, anon, authenticated, service_role;


-- ── ④ LE NUMÉRO D'IDENTIFICATION SUIT LE PAYS — la règle de lib/pays, écrite ici UNE fois ──
--  Normaliser : retirer espaces, points, tirets, barres (la forme imprimée par les registres).
create or replace function public.numero_identification_normalise(p_numero text)
  returns text
  language sql
  immutable
  set search_path to 'public'
as $fn$
  select regexp_replace(coalesce(p_numero, ''), '[[:space:]./-]', '', 'g')
$fn$;
revoke all on function public.numero_identification_normalise(text) from public, anon, authenticated;
grant execute on function public.numero_identification_normalise(text) to service_role;

--  ON NE REFUSE JAMAIS SUR UNE RÈGLE QU'ON N'A PAS : un pays sans longueurs connues accepte
--  (borne absurde de 40 seulement). Pas d'expression régulière lue en base (retour arrière).
create or replace function public.numero_identification_refus(p_pays text, p_numero text)
  returns text
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $fn$
declare
  v_n text := public.numero_identification_normalise(p_numero);
  v_c record;
begin
  if v_n = '' then
    return null;
  end if;
  select c.registre_numero_longueur_min as mini, c.registre_numero_longueur_max as maxi,
         c.registre_numero_alphanumerique as alpha
    into v_c
    from public.countries c where c.code = p_pays;
  if not found or v_c.mini is null or v_c.maxi is null then
    return case when length(v_n) <= 40 then null else 'invalid_siren' end;
  end if;
  if length(v_n) < v_c.mini or length(v_n) > v_c.maxi then
    return 'invalid_siren';
  end if;
  if (v_c.alpha is true and v_n !~ '^[A-Za-z0-9]+$') or (v_c.alpha is not true and v_n !~ '^[0-9]+$') then
    return 'invalid_siren';
  end if;
  return null;
end;
$fn$;
revoke all on function public.numero_identification_refus(text, text) from public, anon, authenticated;
grant execute on function public.numero_identification_refus(text, text) to service_role;


-- ── ⑤ LES RÈGLES D'INSCRIPTION — UNE définition, appelée par la route ET par le trigger ──
--  Rend le PREMIER refus (un code stable), ou null. Lit ; n'écrit rien.
create or replace function public.inscription_refus(p_email text, p_meta jsonb)
  returns text
  language plpgsql
  stable
  security definer
  set search_path to 'public'
as $fn$
declare
  v_meta     jsonb := coalesce(p_meta, '{}'::jsonb);
  v_role     text := coalesce(v_meta ->> 'role', '');
  v_voie     text := btrim(coalesce(v_meta ->> 'voie', ''));
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_prenom   text := btrim(coalesce(v_meta ->> 'firstname', ''));
  v_nom      text := btrim(coalesce(v_meta ->> 'lastname', ''));
  v_tel      text := btrim(coalesce(v_meta ->> 'telephone', ''));
  v_cgu      text := btrim(coalesce(v_meta ->> 'cgu_version', ''));
  v_uuid     text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_expert   boolean;
  v_dom      uuid;
  v_branche  text;
  v_spec     text;
  v_autre    text;
  v_tax      text;
  v_type_org text;
  v_societe  text;
  v_pays     text;
  v_numero   text;
  v_tva      text;
  v_dom_mail text;
  v_inv      record;
  v_acteur   text;
begin
  -- Le rôle, puis la voie qui lui correspond.
  if v_role in ('expert', 'cdi') then
    v_expert := true;
  elsif v_role in ('entreprise', 'cabinet') then
    v_expert := false;
  else
    return 'invalid_role';
  end if;
  if not ((v_voie = 'inscription_expert' and v_expert)
       or (v_voie in ('preinscription_organisation', 'invitation') and not v_expert)
       or (v_voie = 'administrateur' and v_role = 'entreprise')) then
    return 'invalid_voie';
  end if;
  if coalesce(v_meta ->> 'piece', '') !~ v_uuid then
    return 'invalid_piece';
  end if;

  -- L'écosystème : actif. Et le rôle commercial de départ existe.
  select d.id into v_dom from public.domains d
   where d.slug = btrim(coalesce(v_meta ->> 'domain_slug', '')) and d.active
   limit 1;
  if v_dom is null then
    return 'invalid_domain';
  end if;
  if not exists (select 1 from public.roles r where r.name = 'Gratuit' and r.active) then
    return 'role_gratuit_absent';
  end if;

  -- L'adresse, les noms.
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(v_email) > 200 then
    return 'invalid_email';
  end if;
  if exists (select 1 from public.users u where lower(u.email) = v_email) then
    return 'email_taken';
  end if;
  if v_prenom = '' or length(v_prenom) > 100 then
    return 'invalid_first_name';
  end if;
  if v_nom = '' or length(v_nom) > 100 then
    return 'invalid_last_name';
  end if;

  -- Les CGU : toute personne qui s'inscrit elle-même les accepte (un administrateur créé
  -- par un autre n'a rien accepté — on n'écrit pas un consentement qui n'a pas eu lieu).
  if v_voie <> 'administrateur' and v_cgu = '' then
    return 'cgu_required';
  end if;

  -- Le téléphone vérifié : la barrière anti-multicompte de l'expert et de l'organisation.
  if v_voie in ('inscription_expert', 'preinscription_organisation') then
    if v_tel !~ '^\+[1-9][0-9]{6,14}$' then
      return 'invalid_phone';
    end if;
    if exists (select 1 from public.users u where u.phone = v_tel and u.phone_verified) then
      return 'phone_already_used';
    end if;
  end if;

  if v_voie = 'inscription_expert' then
    if length(btrim(coalesce(v_meta ->> 'specialty', ''))) > 200 then
      return 'invalid_specialty';
    end if;
    v_branche := btrim(coalesce(v_meta ->> 'branch_id', ''));
    v_spec    := btrim(coalesce(v_meta ->> 'speciality_id', ''));
    v_autre   := btrim(coalesce(v_meta ->> 'speciality_other', ''));
    if v_branche <> '' and v_branche !~ v_uuid then
      return 'invalid_branch';
    end if;
    if v_branche = '' then
      return 'branch_required';
    end if;
    if (v_spec <> '' and v_spec !~ v_uuid) or length(v_autre) > 100 then
      return 'invalid_speciality';
    end if;
    if v_spec = '' and v_autre = '' then
      return 'speciality_required';
    end if;
    v_tax := public.taxonomie_inscription_refus(v_dom, v_branche::uuid, nullif(v_spec, '')::uuid);
    if v_tax is not null then
      return v_tax;
    end if;

  elsif v_voie = 'preinscription_organisation' then
    v_type_org := coalesce(v_meta ->> 'org_type', '');
    if not ((v_role = 'entreprise' and v_type_org = 'client')
         or (v_role = 'cabinet' and v_type_org in ('cabinet', 'esn'))) then
      return 'invalid_org_type';
    end if;
    v_societe := btrim(coalesce(v_meta ->> 'company_name', ''));
    if length(v_societe) < 2 or length(v_societe) > 200 then
      return 'invalid_company_name';
    end if;
    v_pays := btrim(coalesce(v_meta ->> 'country_code', ''));
    if v_pays !~ '^[A-Z]{2}$' or not exists (select 1 from public.countries c where c.code = v_pays and c.active) then
      return 'invalid_country_code';
    end if;
    v_numero := public.numero_identification_normalise(v_meta ->> 'siren');
    if length(v_numero) > 40 or public.numero_identification_refus(v_pays, v_numero) is not null then
      return 'invalid_siren';
    end if;
    if v_numero <> '' and exists (select 1 from public.organizations o where o.siren = v_numero) then
      return 'siren_taken';
    end if;
    v_tva := btrim(coalesce(v_meta ->> 'vat_number', ''));
    if length(v_tva) > 30 then
      return 'invalid_vat_number';
    end if;
    v_dom_mail := split_part(v_email, '@', 2);
    if exists (select 1 from public.blocked_email_domains b where lower(b.email_domain) = v_dom_mail and b.active) then
      return 'email_domain_blocked';
    end if;
    -- Un domaine PUBLIC (gmail.com…) ne se réserve pas : plusieurs organisations le partagent.
    if not exists (select 1 from public.public_email_domains p where lower(p.email_domain) = v_dom_mail and p.active)
       and exists (select 1 from public.organizations o where lower(o.email_domain) = v_dom_mail) then
      return 'email_domain_taken';
    end if;

  elsif v_voie = 'invitation' then
    if coalesce(v_meta ->> 'invitation_id', '') !~ v_uuid then
      return 'invitation_invalide';
    end if;
    select i.status, i.expires_at, i.email, i.organization_id, o.org_type
      into v_inv
      from public.organization_invitations i
      join public.organizations o on o.id = i.organization_id
     where i.id = (v_meta ->> 'invitation_id')::uuid;
    if not found
       or not (v_inv.status = any (string_to_array(nullif(v_meta ->> 'invitation_statuts', ''), ','))) then
      return 'invitation_invalide';
    end if;
    if v_inv.expires_at <= now() then
      return 'invitation_expiree';
    end if;
    -- L'adresse du compte EST celle de l'invitation, comparée sans casse.
    if lower(btrim(v_inv.email)) <> v_email then
      return 'invitation_email_mismatch';
    end if;
    if (v_inv.org_type in ('cabinet', 'esn')) <> (v_role = 'cabinet') then
      return 'invalid_role';
    end if;
    if not exists (select 1 from public.organization_domains od
                    where od.organization_id = v_inv.organization_id and od.domain_id = v_dom and od.active) then
      return 'invalid_domain';
    end if;

  elsif v_voie = 'administrateur' then
    if not exists (select 1 from public.roles r where r.name = 'Admin' and r.active) then
      return 'admin_role_missing';
    end if;
    v_acteur := btrim(coalesce(v_meta ->> 'acteur_id', ''));
    if v_acteur <> '' and (v_acteur !~ v_uuid or not exists (
         select 1 from public.users a where a.id = v_acteur::uuid and a.user_type = 'admin' and a.status = 'active')) then
      return 'acteur_non_admin';
    end if;
  end if;

  return null;
end;
$fn$;
revoke all on function public.inscription_refus(text, jsonb) from public, anon, authenticated;
grant execute on function public.inscription_refus(text, jsonb) to service_role;


-- ── ⑥ LE TRIGGER : la preuve, les règles, puis le compte ET ce que sa voie crée ──
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_meta        jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_refus       text;
  v_role        text;
  v_user_type   text;
  v_expert_type text;
  v_voie        text;
  v_piece       uuid;
  v_domain_id   uuid;
  v_role_id     uuid;
  v_confirme    boolean := new.email_confirmed_at is not null;
  v_tel         text;
  v_cgu         text;
  v_spec        text;
  v_miroir      uuid;
  v_contrainte  text;
  v_dom_mail    text;
  v_public      boolean;
  v_org         uuid;
  v_numero      text;
  v_inv         jsonb;
  v_acteur      text;
  v_admin_role  uuid;
  v_promotion   text;
begin
  -- ① LA PREUVE, D'ABORD : sans elle, rien d'autre n'est lu.
  v_refus := public.preuve_inscription_refus(new.email, v_meta);
  if v_refus is not null then
    raise exception 'inscription refusee : %', v_refus
      using errcode = case v_refus when 'preuve_absente' then 'IN007'
                                   when 'preuve_expiree' then 'IN009'
                                   when 'secret_absent'  then 'IN011'
                                   else 'IN008' end;
  end if;

  -- ② LES RÈGLES — la même fonction que la route appelle avant de créer le compte.
  v_refus := public.inscription_refus(new.email, v_meta);
  if v_refus is not null then
    raise exception 'inscription refusee : %', v_refus
      using errcode = case v_refus when 'invalid_role'        then 'IN001'
                                   when 'invalid_domain'      then 'IN003'
                                   when 'role_gratuit_absent' then 'IN004'
                                   when 'invalid_branch'      then 'IN005'
                                   when 'invalid_speciality'  then 'IN005'
                                   when 'invalid_voie'        then 'IN006'
                                   when 'invalid_piece'       then 'IN006'
                                   else 'IN010' end;
  end if;

  -- ③ CE QUE LES RÈGLES ONT VALIDÉ, lu une fois.
  v_role  := v_meta ->> 'role';
  v_voie  := btrim(v_meta ->> 'voie');
  v_piece := (v_meta ->> 'piece')::uuid;
  v_tel   := nullif(btrim(coalesce(v_meta ->> 'telephone', '')), '');
  v_cgu   := nullif(btrim(coalesce(v_meta ->> 'cgu_version', '')), '');
  case v_role
    when 'expert'     then v_user_type := 'expert_freelance'; v_expert_type := 'freelance';
    when 'cdi'        then v_user_type := 'expert_cdi';       v_expert_type := 'cdi';
    when 'entreprise' then v_user_type := 'client';           v_expert_type := null;
    else                   v_user_type := 'cabinet';          v_expert_type := null;
  end case;
  select d.id into v_domain_id from public.domains d where d.slug = btrim(v_meta ->> 'domain_slug') and d.active limit 1;
  select r.id into v_role_id from public.roles r where r.name = 'Gratuit' and r.active limit 1;

  -- ④ LE COMPTE — avec ce que la preuve atteste : le téléphone vérifié, le consentement aux CGU.
  --    Confirmé à la création (l'invité, l'administrateur), il est actif tout de suite.
  begin
    insert into public.users (
      id, email, role_id, domain_id, user_type,
      status, email_verified, is_verified,
      first_name, last_name, locale,
      phone, phone_verified, cgu_accepted_at, cgu_version
    ) values (
      new.id, new.email, v_role_id, v_domain_id, v_user_type,
      case when v_confirme then 'active' else 'draft' end, v_confirme, false,
      btrim(v_meta ->> 'firstname'), btrim(v_meta ->> 'lastname'), 'fr',
      v_tel, v_tel is not null, case when v_cgu is not null then now() end, v_cgu
    )
    on conflict (id) do nothing
    returning id into v_miroir;
  exception when unique_violation then
    -- La course perdue contre un autre inscrit : le refus a un NOM (§E.22).
    get stacked diagnostics v_contrainte = constraint_name;
    raise exception 'inscription refusee : %', case when v_contrainte like '%phone%' then 'phone_already_used' else 'email_taken' end
      using errcode = 'IN010';
  end;
  if v_miroir is null then
    return new;
  end if;

  if v_expert_type is not null then
    v_spec := nullif(btrim(coalesce(v_meta ->> 'speciality_id', '')), '');
    insert into public.profiles (
      user_id, domain_id, expert_type, title, visible,
      profile_score, languages, skills, certifications,
      branch_id, speciality_ids, speciality_other
    ) values (
      new.id, v_domain_id, v_expert_type, nullif(btrim(coalesce(v_meta ->> 'specialty', '')), ''), false,
      0, array['fr']::text[], '{}'::text[], '[]'::jsonb,
      (v_meta ->> 'branch_id')::uuid,
      case when v_spec is null then '{}'::uuid[] else array[v_spec::uuid] end,
      nullif(btrim(coalesce(v_meta ->> 'speciality_other', '')), '')
    )
    on conflict (user_id) do nothing;
  end if;

  -- ⑤ LA LIGNE DU COMPTE — pour toute création, la voie en détail.
  perform public.journaliser(
    v_piece, 'compte_cree', 'reussi',
    case when v_voie = 'administrateur' then 'systeme' else 'utilisateur' end,
    case when v_voie = 'administrateur' then null else new.id end,
    case when v_voie = 'administrateur' then null else v_user_type end,
    v_domain_id, 'users', new.id,
    jsonb_build_object('type_de_compte', v_user_type, 'voie_declaree', v_voie),
    null::uuid, null::numeric, null::text);

  -- ⑥ CE QUE LA VOIE CRÉE, ET SA LIGNE SŒUR SOUS LA MÊME PIÈCE — tout, ou rien.
  if v_voie = 'inscription_expert' then
    perform public.journaliser(
      v_piece, 'expert_inscrit', 'reussi', 'utilisateur',
      new.id, v_user_type, v_domain_id, 'users', new.id,
      jsonb_build_object('type_de_compte', v_user_type, 'cgu_version', v_cgu),
      null::uuid, null::numeric, null::text);

  elsif v_voie = 'preinscription_organisation' then
    v_dom_mail := split_part(lower(btrim(new.email)), '@', 2);
    v_public := exists (select 1 from public.public_email_domains p where lower(p.email_domain) = v_dom_mail and p.active);
    v_numero := nullif(public.numero_identification_normalise(v_meta ->> 'siren'), '');
    begin
      v_org := public.creer_organisation_avec_admin(
        new.id, v_domain_id, v_meta ->> 'org_type', btrim(v_meta ->> 'company_name'), btrim(v_meta ->> 'country_code'),
        v_numero, nullif(btrim(coalesce(v_meta ->> 'vat_number', '')), ''),
        case when v_public then null else v_dom_mail end,
        'pending_provider_check');
    exception when unique_violation then
      get stacked diagnostics v_contrainte = constraint_name;
      raise exception 'inscription refusee : %',
        case when v_contrainte like '%siren%' then 'siren_taken'
             when v_contrainte like '%email_domain%' then 'email_domain_taken'
             else 'organisation_deja_inscrite' end
        using errcode = 'IN010';
    end;
    perform public.journaliser(
      v_piece, 'organisation_preinscrite', 'reussi', 'utilisateur',
      new.id, v_user_type, v_domain_id, 'organizations', v_org,
      jsonb_build_object('org_type', v_meta ->> 'org_type', 'domaine_public', v_public),
      null::uuid, null::numeric, null::text);

  elsif v_voie = 'invitation' then
    -- L'adresse d'un invité est confirmée d'office par sa route (le lien reçu prouve la boîte).
    -- Non confirmée, l'acceptation répondrait « email_mismatch » : un motif FAUX (§E.22).
    if not v_confirme then
      raise exception 'inscription refusee : invitation_non_confirmee' using errcode = 'IN010';
    end if;
    -- L'acceptation rejoue ses gardes sous verrou et écrit `invitation_acceptee` (§D.26) ;
    -- les statuts admis sont ceux que la route a signés (aucun littéral de statut ici).
    v_inv := public.accepter_invitation(
      v_piece, null, 'utilisateur', new.id, v_user_type, v_domain_id,
      (v_meta ->> 'invitation_id')::uuid, string_to_array(v_meta ->> 'invitation_statuts', ','));
    if v_inv ->> 'issue' is distinct from 'acceptee' then
      raise exception 'inscription refusee : %',
        case v_inv ->> 'issue' when 'expired' then 'invitation_expiree'
                               when 'email_mismatch' then 'invitation_email_mismatch'
                               else 'invitation_invalide' end
        using errcode = 'IN010';
    end if;

  elsif v_voie = 'administrateur' then
    v_acteur := nullif(btrim(coalesce(v_meta ->> 'acteur_id', '')), '');
    select r.id into v_admin_role from public.roles r where r.name = 'Admin' and r.active limit 1;
    v_promotion := public.promouvoir_administrateur(
      v_piece, null,
      case when v_acteur is null then 'systeme' else 'administrateur' end,
      v_acteur::uuid,
      case when v_acteur is null then null else 'admin' end,
      new.id, v_admin_role);
    if v_promotion is distinct from 'reussi' then
      raise exception 'inscription refusee : administrateur_non_promu' using errcode = 'AD001';
    end if;
  end if;

  return new;
end;
$fn$;


-- ── ⑦ LES LISTES BLANCHES DES LIGNES SŒURS : la forme échouée n'existe plus ──
update public.grand_livre_actions
   set cles_detail = array['type_de_compte', 'cgu_version']::text[]
 where code = 'expert_inscrit';
update public.grand_livre_actions
   set cles_detail = array['org_type', 'domaine_public']::text[]
 where code = 'organisation_preinscrite';


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_fn   text;
  v_corps text;
begin
  if not exists (select 1 from pg_extension e where e.extname = 'pgcrypto') then
    raise exception 'postcondition NON TENUE : pgcrypto absente';
  end if;
  foreach v_fn in array array[
      'public.preuve_inscription_canonique(text, jsonb)', 'public.preuve_inscription_signature(text, boolean)',
      'public.preuve_inscription_refus(text, jsonb)', 'public.numero_identification_normalise(text)',
      'public.numero_identification_refus(text, text)', 'public.inscription_refus(text, jsonb)'] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'postcondition NON TENUE : % absente', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'postcondition NON TENUE : % executable depuis le navigateur', v_fn;
    end if;
  end loop;
  -- Le secret ne se lit pas, même par la clé de service : seul le trigger (postgres) signe.
  if has_function_privilege('service_role', 'public.preuve_inscription_signature(text, boolean)', 'execute')
     or has_function_privilege('service_role', 'public.preuve_inscription_refus(text, jsonb)', 'execute') then
    raise exception 'postcondition NON TENUE : la signature est accessible a la cle de service';
  end if;
  if not has_function_privilege('service_role', 'public.inscription_refus(text, jsonb)', 'execute') then
    raise exception 'postcondition NON TENUE : la route ne peut pas lire le refus (inscription_refus fermee a service_role)';
  end if;
  -- L'ordre dans le trigger : la preuve, puis les règles, AVANT toute écriture (la première : le miroir, « into v_miroir »).
  select p.prosrc into v_corps from pg_proc p where p.oid = to_regprocedure('public.handle_new_user()');
  if v_corps is null
     or strpos(v_corps, 'preuve_inscription_refus(') = 0
     or strpos(v_corps, 'inscription_refus(new.email') = 0
     or strpos(v_corps, 'preuve_inscription_refus(') > strpos(v_corps, 'into v_miroir')
     or strpos(v_corps, 'public.inscription_refus(new.email') > strpos(v_corps, 'into v_miroir') then
    raise exception 'postcondition NON TENUE : handle_new_user ne verifie pas la preuve et les regles avant d ecrire';
  end if;
  if (select a.cles_detail from public.grand_livre_actions a where a.code = 'expert_inscrit')
       is distinct from array['type_de_compte', 'cgu_version']::text[]
     or (select a.cles_detail from public.grand_livre_actions a where a.code = 'organisation_preinscrite')
       is distinct from array['org_type', 'domaine_public']::text[] then
    raise exception 'postcondition NON TENUE : listes blanches des lignes soeurs';
  end if;
  raise notice 'postcondition tenue : preuve (canonique, signature fermee a tous, verdict), regles d inscription (ouvertes a la seule cle de service), numero d identification, handle_new_user verifie avant d ecrire ; chaque voie, la preuve absente, expiree, alteree, pour une autre adresse, les CGU, le telephone et l organisation sont prouves par tests/database/inscription/porte.test.sql';
end
$post$;
