-- M3 : bucket avatars -> PRIVE. Les photos ne sont plus accessibles par URL publique devinable ;
-- elles sont servies via URLs signees courtes generees cote serveur, sous la gate de unlock.
-- Les policies d'ECRITURE owner-scoped (<uid>/...) posees en ...0004 restent en place (non touchees ici).

update storage.buckets set public = false where id = 'avatars';

-- Lecture : plus aucune lecture client directe. On retire la policy de lecture publique posee en ...0004.
-- (Le service-role bypass RLS -> les DTO/endpoints serveur signent ; aucune policy SELECT pour anon/authenticated.)
drop policy if exists avatars_public_read on storage.objects;

-- Normalisation des donnees existantes (tenant de test) : photo_url stockait une URL publique complete.
-- On la reecrit au format chemin '<uid>/avatar.jpg' (flag de presence), aligne sur le nouveau contrat d'upload.
-- Reconstruction deterministe depuis user_id (jamais d'autre chemin possible, 1 fichier/expert).
update public.profiles p
   set photo_url = p.user_id::text || '/avatar.jpg'
 where p.photo_url is not null
   and p.photo_url <> p.user_id::text || '/avatar.jpg';
