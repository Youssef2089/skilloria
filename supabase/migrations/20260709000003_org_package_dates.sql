-- Lot 1 moteur commerce — DATES de package sur organization_domains.
--
-- Decision d'archi figee : l'etat d'abonnement vit sur organization_domains
-- (package_id existant + ces deux colonnes), PAS dans une table
-- organization_subscriptions. Permet l'attribution manuelle d'un package pilote
-- temporaire a un grand compte (org -> package -> date de fin) au back-office.
--
-- AUCUNE logique DB ici : l'interpretation de ces dates (package expire =>
-- retomber sur le package is_default du domaine) vit dans la couche Droits
-- (Lot 2). Les colonnes ne font que porter l'information.

alter table public.organization_domains
  add column if not exists package_started_at   timestamptz,
  add column if not exists package_valid_until  timestamptz;

comment on column public.organization_domains.package_started_at is
  'Debut d''effet du package courant (info/audit). NULL = non renseigne.';

comment on column public.organization_domains.package_valid_until is
  'Echeance du package courant. NULL = abonnement sans echeance (permanent). '
  'Date passee = package expire : la couche Droits (Lot 2) retombe alors sur le '
  'package is_default du domaine. Sert notamment aux packages pilotes temporaires '
  'attribues manuellement aux grands comptes depuis le back-office.';
