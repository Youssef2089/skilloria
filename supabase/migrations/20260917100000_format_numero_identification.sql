-- LE FORMAT DU NUMERO D'IDENTIFICATION VIT SUR LE REFERENTIEL PAYS
--
-- ═══ LE DEFAUT ════════════════════════════════════════════════════════════
--   Le numero d'identification d'une entreprise etait valide par
--   `/^\d{9}$/` — NEUF CHIFFRES — aux DEUX bouts : dans le composant client
--   (components/OrgSetupModal.tsx) et dans la route serveur
--   (app/api/auth/register-org/route.ts). Le libelle disait « SIREN », le
--   placeholder « 123456789 », et le refus « 9 chiffres attendus ».
--
--   C'est le format FRANCAIS, code en dur. Un numero britannique (8
--   alphanumeriques) ou un ICE marocain (15 chiffres) etait donc REFUSE A LA
--   SAISIE, avant meme d'atteindre la moindre verification.
--
--   C'est exactement le meme defaut que le pays fige a « FR », un champ plus
--   loin — et que le badge « FR » du telephone, un ecran plus loin encore.
--
-- ═══ POURQUOI EN BASE, ET PAS DANS UN `switch` ════════════════════════════
--   Un `switch (pays)` en TypeScript ferait d'un pays de plus un DEPLOIEMENT.
--   Le referentiel `countries` porte deja 64 pays actifs, leurs noms en quatre
--   langues, leur indicatif et leur drapeau : le format de leur numero
--   d'identification appartient au meme endroit (§D.7 — rien en dur).
--
-- ═══ PAS DE REGEX EN BASE, ET C'EST DELIBERE ══════════════════════════════
--   La forme evidente serait une colonne `regex`. Elle a ete ECARTEE :
--     · une expression reguliere lue en base et executee cote serveur ouvre un
--       risque de deni de service par retour arriere catastrophique, sur une
--       valeur que le code ne controle plus ;
--     · et elle inviterait a encoder une VALIDITE (cle de controle, damier)
--       qu'on ne sait pas verifier, alors qu'on ne cherche qu'une FORME.
--
--   On decrit donc la forme de facon declarative : une longueur, et le droit
--   ou non aux lettres. C'est un controle de SAISIE, pas une validation
--   d'existence — l'existence, c'est le registre ou la revue humaine qui la
--   tranche.
--
-- ═══ NULL VEUT DIRE « ACCEPTE », JAMAIS « REFUSE » ════════════════════════
--   Un pays dont on ne connait pas la regle laisse ces colonnes a NULL, et le
--   champ accepte ce qui est saisi. ON NE REFUSE JAMAIS SUR UNE REGLE QU'ON
--   N'A PAS : un refus invente fermerait la porte a une organisation legitime
--   pour une raison interne, ce qui est precisement le defaut qu'on corrige.
--
-- ═══ CE QUI EST SEEDE, ET POURQUOI SI PEU ═════════════════════════════════
--   UNIQUEMENT LA FRANCE. Sa regle est la seule que le DEPOT PROUVE : le
--   `/^\d{9}$/` et le libelle « SIREN » y sont ecrits noir sur blanc, aux deux
--   bouts, depuis l'origine.
--
--   Les 63 autres pays restent a NULL. Ce n'est pas un travail laisse en
--   plan : c'est le refus d'inscrire dans une table de reglages des formats
--   nationaux que rien ici ne permet de verifier. Les ajouter est desormais une
--   ECRITURE DE DONNEES, pas un deploiement — c'est tout l'objet de cette
--   migration.

alter table public.countries
  add column if not exists registre_numero_libelle       varchar(60),
  add column if not exists registre_numero_exemple       varchar(60),
  add column if not exists registre_numero_longueur_min  smallint,
  add column if not exists registre_numero_longueur_max  smallint,
  add column if not exists registre_numero_alphanumerique boolean not null default false;

comment on column public.countries.registre_numero_libelle is
'Nom du numero d''identification dans CE pays (« SIREN », « Company number »,
« ICE »).

Ce n''est PAS une chaine traduisible : c''est un nom propre du systeme
administratif du pays, identique quelle que soit la langue de lecture. Un
Marocain lisant l''espagnol doit voir « ICE », pas une traduction de « SIREN ».

NULL = on ne connait pas le nom : l''ecran affiche alors un libelle generique.';

comment on column public.countries.registre_numero_exemple is
'Exemple a afficher en placeholder. Vient du PAYS, jamais de la langue — les
messages du depot prescrivaient « 123456789 » a tout le monde.';

comment on column public.countries.registre_numero_longueur_min is
'Longueur minimale acceptee a la saisie. NULL = aucune regle connue.';

comment on column public.countries.registre_numero_longueur_max is
'Longueur maximale acceptee a la saisie. NULL = aucune regle connue.';

comment on column public.countries.registre_numero_alphanumerique is
'Le numero peut-il contenir des LETTRES ?

`false` (defaut) = chiffres uniquement. `true` = lettres et chiffres.

Ce drapeau n''a d''effet que si une longueur est renseignee : sans longueur,
aucune regle ne s''applique et la saisie est acceptee telle quelle. Le defaut
`false` est donc INERTE tant que les colonnes de longueur sont NULL — il ne
peut rien refuser tout seul.';

-- ═══════════════════════════════════════════════════════════════════════════
-- LA SEULE REGLE QUE LE DEPOT PROUVE
-- ═══════════════════════════════════════════════════════════════════════════
-- SIREN : 9 chiffres. Etabli par `/^\d{9}$/` present dans la route serveur ET
-- dans le composant de saisie, et par le libelle « SIREN » de l'ecran.
-- `on conflict do nothing` est inutile ici : c'est une mise a jour ciblee, et
-- elle ne touche que la ligne FR.
update public.countries
   set registre_numero_libelle        = 'SIREN',
       registre_numero_exemple        = '123456789',
       registre_numero_longueur_min   = 9,
       registre_numero_longueur_max   = 9,
       registre_numero_alphanumerique = false
 where code = 'FR';

-- ═══════════════════════════════════════════════════════════════════════════
-- LE PAYS D'UNE ORGANISATION N'A PLUS DE DEFAUT
-- ═══════════════════════════════════════════════════════════════════════════
-- `organizations.country` portait `default 'FR'` : une insertion qui omettait
-- le pays en obtenait un, sans que personne ne l'ait choisi. Le formulaire le
-- DEMANDE desormais, et la route l'EXIGE — un defaut en base serait le
-- troisieme endroit ou « FR » reapparaitrait tout seul.
--
-- La colonne reste NOT NULL : une organisation sans pays n'aurait pas de sens.
-- C'est le DEFAUT qui disparait, pas la contrainte.
alter table public.organizations
  alter column country drop default;
