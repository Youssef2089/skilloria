-- ─────────────────────────────────────────────────────────────────────────────
-- PROFIL ET ANNONCE — SPÉCIALITÉS, SÉNIORITÉS ET ZONES DEVIENNENT MULTIPLES
--
-- ⚠️ ORDRE D'EXÉCUTION — CETTE MIGRATION PASSE **AVANT** LE DÉPLOIEMENT DU CODE,
--    et le code doit partir DANS LA FOULÉE. Elle SUPPRIME quatre colonnes que
--    le code en ligne lit encore (profiles.speciality_id, profiles.seniority,
--    publications.speciality_id, publications.seniority) et en renomme une
--    (publications.location). Entre le `db push` et le déploiement, les écrans
--    de profil, d'annonce et le matching sont cassés.
--
--    Séquence correcte, sans fenêtre d'indisponibilité possible autrement :
--      1. `supabase db push` (cette migration) ;
--      2. déploiement IMMÉDIAT du code du même lot.
--
--    La base étant une base de TEST, aucune reprise de données n'est prévue :
--    les colonnes supprimées le sont sèchement, sans recopie vers les nouvelles.
--    Sur une base de production, cette migration devrait être scindée en
--    trois (ajout, recopie + double écriture, suppression).
--
-- POURQUOI DES TABLEAUX PLUTÔT QUE DES TABLES DE LIAISON
--   Le filtre de matching est le chemin chaud : il doit répondre « ces deux
--   ensembles se recoupent-ils » sur des dizaines de milliers de lignes, et il
--   est construit avec PostgREST. Un `&&` sur un tableau indexé en GIN exprime
--   exactement cette question, en une clause, sans jointure et sans risque de
--   dupliquer la ligne parente. Une table de liaison imposerait un `EXISTS` que
--   PostgREST n'exprime qu'indirectement, et dont la forme embarquée produit
--   des doublons qu'il faudrait dédoublonner côté serveur.
--
--   Le projet a déjà ce précédent partout : skills, languages, work_modes,
--   cdi_sectors, cdi_contract_types sont des tableaux.
--
--   CONTREPARTIE, à traiter dans le même lot : un uuid[] ne porte pas de clé
--   étrangère. Supprimer une spécialité laisserait des identifiants fantômes.
--   Les routes admin `delete-speciality` et `delete-branch` DOIVENT donc
--   retirer l'identifiant des tableaux avant de supprimer la ligne. C'est le
--   prix de ce choix, et il est explicite.
--
-- SÉMANTIQUE D'UN ENSEMBLE VIDE — décision structurante
--   Un ensemble vide côté ANNONCE signifie « aucune contrainte sur cet axe »,
--   jamais « ne correspond à personne ». L'inverse ferait qu'une annonce
--   incomplètement remplie ne matcherait rien, en silence. Le filtre s'écrit
--   donc toujours :  annonce.axe = '{}'  OU  expert.axe && annonce.axe.
--   Côté EXPERT l'ensemble ne peut pas être vide : la contrainte de visibilité
--   ci-dessous l'interdit.
-- ─────────────────────────────────────────────────────────────────────────────

-- Séniorités admises. Liste reprise telle quelle du code existant
-- (SENIORITY_VALUES : junior, confirmed, senior, expert) — cette migration ne
-- change PAS le vocabulaire, seulement sa cardinalité.
-- Volontairement pas un ENUM : ajouter une valeur à un ENUM se fait hors
-- transaction sur certaines versions, un CHECK se remplace en une instruction.


-- ═══ PROFILS ════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists speciality_ids       uuid[]        not null default '{}',
  add column if not exists seniorities          text[]        not null default '{}',
  add column if not exists work_zone_ids        uuid[]        not null default '{}',
  -- DÉRIVÉE — jamais écrite à la main. Maintenue par le trigger plus bas à
  -- partir de work_zone_ids. C'est elle, et elle seule, que le filtre compare.
  add column if not exists work_zone_countries  varchar(2)[]  not null default '{}';

comment on column public.profiles.work_zone_countries is
  'DÉRIVÉE de work_zone_ids par trg_profiles_work_zones. Ne jamais écrire directement : '
  'toute écriture manuelle serait écrasée à la mise à jour suivante de work_zone_ids.';

alter table public.profiles
  drop constraint if exists profiles_seniorities_check;
alter table public.profiles
  add constraint profiles_seniorities_check
  check (seniorities <@ array['junior','confirmed','senior','expert']::text[]);


-- ═══ ANNONCES ═══════════════════════════════════════════════════════════════

alter table public.publications
  add column if not exists speciality_ids       uuid[]        not null default '{}',
  add column if not exists seniorities          text[]        not null default '{}',
  add column if not exists work_zone_ids        uuid[]        not null default '{}',
  add column if not exists work_zone_countries  varchar(2)[]  not null default '{}';

comment on column public.publications.work_zone_countries is
  'DÉRIVÉE de work_zone_ids par trg_publications_work_zones. Ne jamais écrire directement.';

alter table public.publications
  drop constraint if exists publications_seniorities_check;
alter table public.publications
  add constraint publications_seniorities_check
  check (seniorities <@ array['junior','confirmed','senior','expert']::text[]);

-- « Localisation » devient « Zones de travail » (structuré, filtrant) et le
-- champ texte libre survit UNIQUEMENT comme précision d'affichage
-- (« Paris ou Lyon »). Le renommage est délibérément cassant : il force chaque
-- lecteur à être revu, ce qu'un simple changement de libellé aurait laissé
-- passer en silence. `location_note` ne filtre rien et n'est PLUS envoyé à l'IA.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'publications'
                and column_name = 'location')
     and not exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'publications'
                and column_name = 'location_note')
  then
    alter table public.publications rename column location to location_note;
  end if;
end
$$;

comment on column public.publications.location_note is
  'Précision d''affichage uniquement (« Paris ou Lyon »). NE FILTRE RIEN et n''est jamais '
  'envoyé à l''IA. Le critère géographique opposable est work_zone_ids / work_zone_countries.';


-- ═══ MAINTIEN DE LA COLONNE DÉRIVÉE ═════════════════════════════════════════
-- Un trigger, et non un calcul dans la route : la règle 20 veut la garantie au
-- serveur. Une route oubliée, un script d'admin, une correction manuelle —
-- aucun chemin d'écriture ne peut produire une dérivée incohérente.
create or replace function public.sync_work_zone_countries()
  returns trigger
  language plpgsql
  set search_path to 'public'
as $fn$
begin
  new.work_zone_countries := public.work_zone_country_codes(new.work_zone_ids);
  return new;
end
$fn$;

create or replace trigger trg_profiles_work_zones
  before insert or update of work_zone_ids on public.profiles
  for each row execute function public.sync_work_zone_countries();

create or replace trigger trg_publications_work_zones
  before insert or update of work_zone_ids on public.publications
  for each row execute function public.sync_work_zone_countries();


-- ═══ SUPPRESSION DES COLONNES À VALEUR UNIQUE ═══════════════════════════════
-- Deux sources de vérité pour la même information sont une panne différée : le
-- jour où l'une des deux n'est plus écrite, personne ne le voit. Base de test,
-- donc suppression sèche.
--
-- ⚠️ EFFET DE BORD MAJEUR, à traiter dans le même lot de code : la suppression
--    de `speciality_id` retire la clé étrangère dont dépendent onze embeds
--    PostgREST `specialities(name)`. Ces lectures doivent passer par le cache de
--    taxonomie déjà chargé (loadTranslations / /api/taxonomy), qui résout
--    id -> libellé traduit sans jointure. C'est d'ailleurs préférable : cela
--    retire une jointure du chemin chaud du matching.
alter table public.profiles     drop column if exists speciality_id;
alter table public.profiles     drop column if exists seniority;
alter table public.publications drop column if exists speciality_id;
alter table public.publications drop column if exists seniority;


-- ═══ VISIBILITÉ : LES CRITÈRES DE MATCHING DEVIENNENT OBLIGATOIRES ══════════
-- La règle est déjà appliquée dans la route qui bascule `visible`. Elle est
-- REDITE ici en contrainte, parce qu'un profil visible sans critère est
-- exactement ce que le nouveau moteur ne sait pas traiter : il ne serait
-- retenu par aucun filtre et disparaîtrait sans que rien ne le signale.
-- Défense en profondeur, au sens de la règle 20.
--
-- La disponibilité est testée « au moins l'une des deux » : un freelance porte
-- availability_status, un salarié cdi_status, et une contrainte de table ne
-- peut pas joindre users.user_type. La route, elle, exige la bonne des deux.

-- Le défaut historique de `visible` est `true` : un profil neuf serait donc
-- visible sans avoir rien déclaré, ce que la règle interdit désormais.
alter table public.profiles alter column visible set default false;

-- LE RÉSUMÉ est un critère de visibilité au même titre que les autres, et il
-- l'est pour une raison mécanique : c'est le texte que le reranker lit pour
-- juger la pertinence. Un profil visible sans résumé serait soumis au moteur
-- avec presque rien à lire, donc mal classé — sans que ni l'expert ni personne
-- ne puisse dire pourquoi. La borne haute de 800 caractères est celle du
-- document envoyé au reranker ; la borne basse de 200 garantit qu'il y a
-- matière à juger.
--
-- La contrainte porte sur la VISIBILITÉ, jamais sur la ligne : un brouillon de
-- 2 000 caractères doit pouvoir être enregistré. C'est la route qui borne à la
-- saisie ; la base garantit seulement qu'aucun profil visible n'y échappe.

-- Mise en conformité préalable, sinon l'ajout de la contrainte échoue sur les
-- lignes existantes. Base de test : on rend invisible ce qui ne remplit pas les
-- critères, sans rien supprimer. L'expert n'a qu'à compléter son profil.
update public.profiles
   set visible = false
 where visible = true
   and (
        branch_id is null
     or coalesce(array_length(speciality_ids, 1), 0) = 0
     or coalesce(array_length(seniorities,    1), 0) = 0
     or coalesce(array_length(work_zone_ids,  1), 0) = 0
     or (availability_status is null and cdi_status is null)
     or summary is null
     or char_length(btrim(summary)) not between 200 and 800
   );

alter table public.profiles
  drop constraint if exists profiles_visible_requiert_criteres_check;
alter table public.profiles
  add constraint profiles_visible_requiert_criteres_check
  check (
    visible = false
    or (
          branch_id is not null
      and coalesce(array_length(speciality_ids, 1), 0) > 0
      and coalesce(array_length(seniorities,    1), 0) > 0
      and coalesce(array_length(work_zone_ids,  1), 0) > 0
      and (availability_status is not null or cdi_status is not null)
      and summary is not null
      and char_length(btrim(summary)) between 200 and 800
    )
  );

-- Côté annonce, l'obligation ne vaut qu'à la PUBLICATION : un brouillon
-- incomplet doit pouvoir être enregistré.
-- Spécialités et séniorités ne sont volontairement PAS exigées ici — un
-- ensemble vide y signifie « aucune contrainte sur cet axe » (cf. en-tête).
-- Si Youssef décide de les rendre obligatoires aussi, il suffit d'ajouter les
-- deux conditions à cette contrainte.
alter table public.publications
  drop constraint if exists publications_publiee_requiert_zones_check;
alter table public.publications
  add constraint publications_publiee_requiert_zones_check
  check (
    status <> 'published'
    or coalesce(array_length(work_zone_ids, 1), 0) > 0
  );


-- ═══ INDEX DU CHEMIN CHAUD ══════════════════════════════════════════════════
-- Les trois axes de recoupement, en GIN : c'est ce qui rend `&&` utilisable sur
-- des dizaines de milliers de lignes.
create index if not exists profiles_speciality_ids_gin
  on public.profiles using gin (speciality_ids);
create index if not exists profiles_seniorities_gin
  on public.profiles using gin (seniorities);
create index if not exists profiles_work_zone_countries_gin
  on public.profiles using gin (work_zone_countries);

create index if not exists publications_speciality_ids_gin
  on public.publications using gin (speciality_ids);
create index if not exists publications_seniorities_gin
  on public.publications using gin (seniorities);
create index if not exists publications_work_zone_countries_gin
  on public.publications using gin (work_zone_countries);

-- Index de PARCOURS du pool. C'est LUI qu'on interroge pour savoir combien
-- d'experts une annonce soumet au reranking, et c'est donc ici que se lit la
-- taille du pool. Partiel : seules les lignes éligibles y figurent.
--
-- ┌─ CONDITION DE RETOUR D'UNE PRÉSÉLECTION ─────────────────────────────────┐
-- │ Aujourd'hui, TOUT le pool filtré est soumis au reranking : aucun plafond,│
-- │ donc aucun expert écarté sans raison nommable. C'est tenable parce que le│
-- │ reranking coûte ~0,72 $ par annonce à 12 000 experts.                    │
-- │                                                                          │
-- │ Ce n'est plus vrai au-delà d'environ 50 000 experts dans UN pool filtré :│
-- │ le reranking y dépasse 3 $ par annonce, et un plafond redevient          │
-- │ économiquement nécessaire. C'est ALORS, et alors seulement, qu'une étape │
-- │ de présélection (recherche lexicale et/ou vectorielle, fusion RRF) reprend│
-- │ son sens : elle sert à protéger le rappel LÀ OÙ L'ON TRONQUE. Tant qu'on │
-- │ ne tronque pas, le rappel est de 100 % par construction et cette étape   │
-- │ n'apporte rien — c'est pourquoi elle a été retirée de cette conception.  │
-- │                                                                          │
-- │ COMMENT SAVOIR QU'ON Y EST :                                             │
-- │   select count(*) from public.profiles                                   │
-- │    where visible and verification_status = 'approved'                    │
-- │      and cv_parsing_status = 'done' and ai_consent_at is not null        │
-- │    group by domain_id, branch_id order by 1 desc limit 5;                │
-- │ Le jour où la première ligne approche 50 000, relire ce commentaire.     │
-- └──────────────────────────────────────────────────────────────────────────┘
create index if not exists profiles_pool_matching_idx
  on public.profiles (domain_id, branch_id, id)
  where visible = true
    and verification_status = 'approved'
    and cv_parsing_status = 'done'
    and ai_consent_at is not null;


-- ═══ RECALCUL DES DÉRIVÉES ══════════════════════════════════════════════════
-- Les colonnes viennent d'être créées à '{}' ; les triggers ne se déclenchent
-- qu'à l'écriture. Cette affectation apparemment inutile (`x = x`) FAIT tourner
-- le trigger sur chaque ligne et remplit work_zone_countries. C'est aussi la
-- commande à rejouer après tout ajout de pays au référentiel.
update public.profiles     set work_zone_ids = work_zone_ids;
update public.publications set work_zone_ids = work_zone_ids;
