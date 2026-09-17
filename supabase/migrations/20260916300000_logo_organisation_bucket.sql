-- ─────────────────────────────────────────────────────────────────────────────
-- LE LOGO CESSE D'ETRE UNE ADRESSE SAISIE, IL DEVIENT UN FICHIER QU'ON HEBERGE
--
-- ━━━ LE DEFAUT QU'ON FERME, ET IL EST EXPLOITABLE ━━━━━━━━━━━━━━━━━━━━━━━━━━━
--
--   `organizations.logo_url` etait une SAISIE LIBRE de 500 caracteres. La route
--   PATCH /api/me/organisation ne validait que : c'est une chaine, trim, <= 500.
--   Ni schema d'URL, ni liste d'hotes, ni verification que la ressource est une
--   image.
--
--   Et cette valeur partait TELLE QUELLE dans un `<img src>` sur NEUF surfaces
--   — barre laterale d'organisation, cartes de casting cote expert, messagerie,
--   ET les deux ecrans d'administration plateforme. Aucune CSP nulle part dans
--   le depot (verifie : zero occurrence de `Content-Security-Policy` et de
--   `img-src`, et next.config.ts ne declare aucun `headers()`).
--
--   Consequence, qui n'est pas une hypothese : un administrateur d'organisation
--   posait, par une saisie de formulaire, une adresse que le navigateur de
--   CHAQUE personne voyant sa fiche allait reellement interroger. Adresse IP,
--   agent utilisateur, horodatage, et le `Referer` qui revele l'ecran admin.
--   Un mouchard pose par un utilisateur dans notre produit, et un transfert de
--   donnees personnelles vers un tiers qu'on ne maitrise pas.
--
--   ⚠️ CE N'EST PAS LE CAS DE `profiles.photo_url`, ET LA DIFFERENCE EST TOUT.
--      `photo_url` est un DRAPEAU INERTE : `lib/avatar.ts` REDERIVE le chemin
--      depuis l'identifiant du compte (`avatarStoragePath(userId)`) et ne lit
--      jamais la colonne comme une adresse. Une valeur falsifiee n'y donne
--      acces a rien. `logo_url`, elle, ETAIT l'adresse. La ressemblance des
--      deux colonnes est un piege : cette migration donne a `logo_url` la
--      propriete que `photo_url` avait deja.
--
-- ━━━ CE QUE FAIT CETTE MIGRATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--
--   1. Un helper de portee, qui casse d'avance tout cycle RLS (§E.6).
--   2. Un bucket `org-logos` PRIVE, policies scopees `organization_id` — jamais
--      `auth.uid()`, puisque plusieurs membres d'une meme organisation gerent le
--      meme objet.
--   3. Un bucket `ecosysteme` PUBLIC pour le logo et le favicon d'ecosysteme :
--      meme defaut, meme correctif, portee PLUS LARGE (Navbar, Footer, pages
--      legales, contact — donc tout visiteur non connecte).
--   4. NORMALISATION des valeurs existantes (migration de DONNEES).
--   5. Des contraintes CHECK qui rendent une URL externe IMPOSSIBLE A ECRIRE.
--
--   L'ordre 4 → 5 n'est pas negociable : une contrainte posee avant la
--   normalisation echouerait sur la premiere ligne non conforme.
--
-- ━━━ POURQUOI LA GARANTIE EST EN BASE ET PAS SEULEMENT EN CODE ━━━━━━━━━━━━━━
--
--   Une validation de route ne protege que les ecritures qui passent par cette
--   route. Le CHECK protege TOUTES les ecritures — route oubliee, script de
--   reprise, correction a la main dans Studio, ou la prochaine route que
--   quelqu'un ecrira sans connaitre cette histoire. La regle de securite est
--   imposee en BASE, conformement a la checklist du projet.
--
-- Additif. Migration de DONNEES en section 4 (passee par diag-migration-donnees).
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ 1. LA PORTEE D'UN CHEMIN DE STOCKAGE ════════════════════════════════════
--
-- Les policies de `storage.objects` doivent decider « ce fichier appartient-il
-- a une organisation dont je suis membre/admin ? ». Le premier segment du
-- chemin porte l'identifiant de l'organisation.
--
-- ⚠️ POURQUOI UNE FONCTION PLUTOT QU'UN CAST DANS LA POLICY.
--    `(storage.foldername(name))[1]::uuid` LEVE `22P02` des qu'un client depose
--    un chemin qui n'est pas un UUID. Une erreur n'est pas un refus : elle
--    remonte en 500 et se lit comme une panne. Ici, un chemin non conforme rend
--    NULL, `is_active_*_of_org(NULL)` rend `false`, et le refus est PROPRE.
--
-- ⚠️ `split_part` plutot que `storage.foldername` : meme resultat sur nos
--    chemins, sans dependre du schema `storage` dans le `search_path` verrouille.
create or replace function public.org_id_du_chemin_logo(p_chemin text)
  returns uuid
  language sql
  immutable
  set search_path to 'public'
as $fn$
  select case
    when split_part(coalesce(p_chemin, ''), '/', 1)
         ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then split_part(p_chemin, '/', 1)::uuid
  end
$fn$;

comment on function public.org_id_du_chemin_logo(text) is
  'Extrait l''identifiant d''organisation du premier segment d''un chemin de stockage. '
  'Rend NULL si le segment n''est pas un UUID — un refus propre plutot qu''un 22P02 en 500.';


-- ═══ 2. LE BUCKET DES LOGOS D'ORGANISATION — PRIVE ═══════════════════════════
--
-- PRIVE, et c'est cette confidentialite qui ferme le mouchard : le navigateur
-- ne recoit plus jamais qu'une URL SIGNEE COURTE vers NOTRE stockage, jamais
-- une adresse choisie par un utilisateur.
--
-- 2 Mo / jpeg+png+webp : valeurs REPRISES du bucket `avatars`, qui est deja le
-- bucket d'images de ce produit. On aligne au lieu d'inventer un troisieme jeu
-- de bornes qui divergerait.
--
-- ⚠️ `allowed_mime_types` est une SECONDE ligne, jamais la premiere : Storage
--    ne lit que le Content-Type DECLARE par le client, donc falsifiable. La
--    premiere ligne est la signature binaire verifiee cote serveur
--    (lib/org-logo.ts), sur les octets recus.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('org-logos', 'org-logos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Upsert autoritatif : ce fichier definit l'etat cible et corrige toute derive
-- posee depuis Studio. Meme posture que 20260708000004.

drop policy if exists org_logos_member_read on storage.objects;
drop policy if exists org_logos_admin_insert on storage.objects;
drop policy if exists org_logos_admin_update on storage.objects;
drop policy if exists org_logos_admin_delete on storage.objects;

-- LECTURE : tout membre ACTIF de l'organisation, quel que soit son role.
--
-- L'application, elle, ne lit jamais par ce chemin : elle sert des URL signees
-- generees en service-role. Cette policy est une DEFENSE EN PROFONDEUR — si le
-- bucket etait un jour lu en client-direct, la portee serait deja la bonne.
create policy org_logos_member_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'org-logos'
    and public.is_active_member_of_org(public.org_id_du_chemin_logo(name))
  );

-- ECRITURE : ADMIN ACTIF de l'organisation, et personne d'autre.
--
-- `is_active_admin_of_org` est la fonction DEJA utilisee par la policy
-- `organizations_admin_update` de la baseline. On ETEND la garde existante, on
-- ne la reconstruit pas — une seconde definition du meme predicat finirait par
-- diverger de la premiere.
--
-- `editor` est traite comme `viewer` : le logo est l'identite visuelle de
-- l'entreprise, pas un contenu editorial. Decision figee (§D).
--
-- ⚠️ AUCUN CYCLE RLS POSSIBLE (§E.6) : `is_active_admin_of_org` est
--    SECURITY DEFINER a `search_path` verrouille — elle BYPASSE la RLS et lit
--    `organization_members` sans re-declencher de policy. Aucune policy de
--    `organization_members` ne lit `storage.objects`. La boucle est cassee des
--    la conception, pas rattrapee apres un 42P17.
create policy org_logos_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'org-logos'
    and public.is_active_admin_of_org(public.org_id_du_chemin_logo(name))
  );

create policy org_logos_admin_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'org-logos'
    and public.is_active_admin_of_org(public.org_id_du_chemin_logo(name))
  )
  with check (
    bucket_id = 'org-logos'
    and public.is_active_admin_of_org(public.org_id_du_chemin_logo(name))
  );

create policy org_logos_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'org-logos'
    and public.is_active_admin_of_org(public.org_id_du_chemin_logo(name))
  );


-- ═══ 3. LE BUCKET DE L'ECOSYSTEME — PUBLIC, ET C'EST VOULU ═══════════════════
--
-- `domain_configs.logo_url` / `favicon_url` portaient EXACTEMENT le meme defaut,
-- avec une portee PLUS LARGE : Navbar, Footer, pages legales et contact, donc
-- tout visiteur NON CONNECTE. Le modele de menace differe (seul un admin
-- plateforme ecrit), le resultat pour le visiteur est le meme.
--
-- ⚠️ POURQUOI PUBLIC ALORS QUE LES TROIS AUTRES SONT PRIVES — a lire avant de
--    « corriger » cette ligne :
--    Ces images s'affichent sur des pages PUBLIQUES et CACHEES, pour des
--    visiteurs anonymes. Une URL signee expire (300 s) : elle serait morte dans
--    toute page servie depuis un cache, et l'ecran afficherait une image
--    cassee. Le mouchard n'est PAS ferme par la confidentialite du bucket — il
--    est ferme parce que l'adresse est DERIVEE de `domain_id` au lieu d'etre
--    saisie. Un bucket public dont le chemin est derive ne fuit rien : il sert
--    notre propre fichier, depuis notre propre stockage.
--    Cet etat « public » est ATTENDU et verifie par diag-logo-organisation.
--
-- ECRITURE : aucune policy. Seul le service-role ecrit ici (route admin
-- plateforme), et le service-role bypasse la RLS. Pas de policy = aucun client
-- authentifie ne peut ecrire. Le silence est ici la garde la plus stricte.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ecosysteme', 'ecosysteme', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ═══ 4. NORMALISATION DES VALEURS EXISTANTES — MIGRATION DE DONNEES ══════════
--
-- ETAT MESURE AVANT ECRITURE (staging wnayuerhakekxccgimeg, lecture seule) :
--   organizations   : 4 lignes, 0 avec un logo_url non vide.
--   domain_configs  : 1 ligne (microsoft), logo_url NULL, favicon_url NULL.
-- Ces trois `update` ne toucheront donc AUCUNE ligne sur staging.
--
-- Ils sont ecrits quand meme, et ce n'est pas de la ceremonie : la production
-- sera batie A NEUF depuis ces fichiers, et toute base ou quelqu'un aurait
-- saisi une URL entre-temps doit converger vers l'etat cible au lieu de faire
-- echouer la contrainte de la section 5.
--
-- CE QUE CELA COUTE A UN UTILISATEUR : son logo disparait de l'ecran et il doit
-- le redeposer. Sur staging, personne. Ailleurs, l'ecran le DIT — etat vide
-- delibere avec un appel a l'action, jamais une image cassee.
update public.organizations
   set logo_url = null
 where logo_url is not null
   and logo_url <> '';

update public.domain_configs
   set logo_url = null
 where logo_url is not null
   and logo_url <> '';

update public.domain_configs
   set favicon_url = null
 where favicon_url is not null
   and favicon_url <> '';


-- ═══ 5. LA COLONNE CESSE D'ETRE UNE ADRESSE ══════════════════════════════════
--
-- Desormais elle porte un CHEMIN DE STOCKAGE DERIVE, de forme imposee :
--     <uuid>/logo      pour une organisation (bucket org-logos)
--     <uuid>/logo      pour un ecosysteme     (bucket ecosysteme)
--     <uuid>/favicon   pour un favicon        (bucket ecosysteme)
--
-- Le motif exige l'UUID en tete : aucune chaine contenant `://`, `javascript:`,
-- `data:`, `//hote` ou un chemin relatif ne peut plus entrer, par CONSTRUCTION
-- plutot que par enumeration d'interdits — une liste noire s'oublie, un motif
-- positif ne s'oublie pas.
--
-- ⚠️ LE SERVEUR NE LIT JAMAIS CETTE COLONNE COMME UN CHEMIN. Il RECALCULE le
--    chemin depuis l'identifiant (lib/org-logo.ts), exactement comme
--    `avatarStoragePath`. La colonne n'est qu'un DRAPEAU DE PRESENCE. Une
--    valeur falsifiee — y compris le chemin d'une AUTRE organisation — ne donne
--    donc acces a rien : elle n'est jamais suivie.
--    Les deux gardes sont volontairement redondantes : le CHECK empeche
--    d'ECRIRE une adresse, la rederivation empeche d'en SUIVRE une.


alter table public.organizations
  drop constraint if exists organizations_logo_url_chemin_check;

alter table public.organizations
  add constraint organizations_logo_url_chemin_check
  check (
    logo_url is null
    or logo_url ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/logo$'
  );

alter table public.domain_configs
  drop constraint if exists domain_configs_logo_url_chemin_check;

alter table public.domain_configs
  add constraint domain_configs_logo_url_chemin_check
  check (
    logo_url is null
    or logo_url ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/logo$'
  );

alter table public.domain_configs
  drop constraint if exists domain_configs_favicon_url_chemin_check;

alter table public.domain_configs
  add constraint domain_configs_favicon_url_chemin_check
  check (
    favicon_url is null
    or favicon_url ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/favicon$'
  );

comment on column public.organizations.logo_url is
  'CHEMIN de stockage dans le bucket prive `org-logos`, PAS une URL. Drapeau de '
  'presence : le serveur RECALCULE toujours le chemin depuis organizations.id '
  '(lib/org-logo.ts), il ne suit jamais cette valeur. Le CHECK interdit toute '
  'adresse — une URL saisie servie a <img src> est un mouchard (cf. E.16 de CLAUDE.md).';

comment on column public.domain_configs.logo_url is
  'CHEMIN de stockage dans le bucket public `ecosysteme`, PAS une URL. Meme '
  'regle que organizations.logo_url : derive de domain_id, jamais suivi.';

comment on column public.domain_configs.favicon_url is
  'CHEMIN de stockage dans le bucket public `ecosysteme`, PAS une URL. Meme '
  'regle que domain_configs.logo_url.';
