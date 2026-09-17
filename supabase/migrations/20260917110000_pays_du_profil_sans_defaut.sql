-- LE PAYS D'UN EXPERT N'A PLUS DE DEFAUT NON PLUS
--
-- ═══ LA QUATRIEME SOURCE ═══════════════════════════════════════════════════
--   Le lot precedent a ferme trois endroits ou le pays d'une ORGANISATION
--   naissait francais sans que personne ne l'ait choisi : le formulaire
--   d'inscription, le repli de la route de finalisation, et le
--   `default 'FR'` de `organizations.country`.
--
--   IL Y EN AVAIT UNE QUATRIEME, un cran plus loin : `profiles.country` porte
--   `DEFAULT 'FR'`. Et les deux ecrans de validation de profil ouvraient sur
--   `useState('FR')`, puis retombaient sur « FR » quand la colonne etait vide.
--   Un expert marocain qui ne touchait pas au champ ENREGISTRAIT « France ».
--
--   Ce n'est pas une nuance d'affichage depuis que l'organisation PERSONNELLE
--   d'un expert prend le pays de son profil : un defaut ici se propage a une
--   organisation, et une organisation a un registre.
--
-- ═══ CE QUE CETTE MIGRATION FAIT, ET CE QU'ELLE NE FAIT PAS ════════════════
--   ELLE RETIRE LE DEFAUT. La colonne reste NULLABLE — un expert peut tres
--   bien n'avoir pas encore renseigne son adresse, et NULL dit exactement ca.
--
--   ELLE NE TOUCHE AUCUNE LIGNE EXISTANTE. Les six profils de l'environnement
--   portent tous « FR », et rien ne permet de distinguer un « FR » DECLARE
--   d'un « FR » POSE PAR LE DEFAUT. Les passer a NULL effacerait des valeurs
--   peut-etre justes et forcerait six personnes a ressaisir ce qu'elles ont
--   peut-etre deja saisi ; les garder laisse en base des valeurs qu'on ne sait
--   pas attester.
--
--   AUCUNE DES DEUX N'EST UNE DECISION TECHNIQUE. Le defaut est ferme pour
--   tout ce qui vient ; ce qui existe releve d'un arbitrage produit, pas d'une
--   migration ecrite en silence.

alter table public.profiles
  alter column country drop default;

comment on column public.profiles.country is
'Pays de l''adresse DECLAREE par l''expert (ISO-3166 alpha-2).

SANS DEFAUT, ET C''EST LE POINT. La colonne portait `default ''FR''`, et les
ecrans de validation de profil ouvraient sur « FR » : un expert etranger
enregistrait « France » sans l''avoir choisi, puis se le voyait afficher comme
une saisie.

NULL = l''expert n''a pas encore renseigne son pays. Ce n''est pas une erreur,
c''est un etat. Ce qui en depend doit le DIRE plutot que de le remplacer :
`ensurePersonalOrg` refuse de creer l''organisation personnelle sans lui
(`expert_country_missing`) au lieu d''y ecrire un pays invente.';
