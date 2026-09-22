-- 20260922000020_commentaire_offre_gratuite.sql
--
-- UNE OFFRE GRATUITE N'A RIEN A RELIER — Y COMPRIS A ZERO.
--
-- ORDRE DE PASSAGE : INDIFFERENT. Elle ne touche que des COMMENTAIRES de
-- colonne : aucune donnee, aucune contrainte, aucun index. Elle peut passer
-- avant ou apres le deploiement, et se rejouer sans effet.
--
-- ═══ POURQUOI UNE MIGRATION POUR UN COMMENTAIRE ═════════════════════════════
--
--   Le commentaire de `packages.price_monthly` disait :
--
--     « 0 = offre GRATUITE et vendable. »
--
--   Il est devenu FAUX le 22/09/2026 : une offre gratuite n'a rien a relier,
--   que son prix soit NULL ou 0 (decision de Youssef, §D.16). Le code applique
--   la nouvelle regle ; le schema, lui, continuait d'affirmer l'ancienne.
--
--   UN COMMENTAIRE DE SCHEMA FAUX EST PIRE QU'UN COMMENTAIRE ABSENT : il se
--   cite. C'est la famille de E.7 — on relit la documentation de la regle au
--   lieu de la regle — et c'est d'autant plus vrai ici que ce commentaire est
--   ce qu'on lit en premier quand on se demande ce que vaut un prix nul.
--
--   Une offre a 0,00 EUR poussee chez Stripe y creerait un abonnement recurrent
--   qui n'encaisse rien, qu'aucun parcours n'ouvre, et qui apparaitrait pourtant
--   dans le catalogue Stripe comme une offre reelle.

begin;

comment on column public.packages.price_monthly is
  'Prix mensuel TTC-neutre, en UNITE MAJEURE (euros), 2 decimales. '
  'NULL ou 0 = offre GRATUITE : rien a facturer, donc RIEN A RELIER chez Stripe '
  '(aucun Price n''en est derive, et l''ecran d''exploitation la classe '
  '« rien a relier », pas « manquante »). Une offre is_default est necessairement '
  'gratuite (contrainte packages_default_must_be_free) : le statut de defaut '
  'n''entre donc PAS dans la decision, le PRIX suffit. La regle vit a un seul '
  'endroit : lib/billing/vendabilite.ts. '
  'Stripe raisonne en centimes : la conversion x100 vit dans lib/billing, a un seul endroit.';

comment on column public.packages.price_yearly is
  'Cadence annuelle — DORMANTE en V0 (decision produit n°4) : la colonne existe, '
  'aucune offre ne la renseigne, aucun code ne l''expose. Memes regles que price_monthly.';

commit;
