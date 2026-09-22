-- 20260922000000_empreinte_des_notes.sql
--
-- UNE NOTE APPARTIENT AUX TEXTES QUI L'ONT PRODUITE.
--
-- ORDRE DE PASSAGE : AVANT le deploiement. La migration n'ajoute qu'une
-- colonne et vide une table EPHEMERE ; le code en ligne (qui ne connait pas la
-- colonne) continue de fonctionner, il repaiera simplement les notes du
-- brouillon vide. Le code doit partir dans la foulee : tant qu'il n'est pas
-- deploye, l'ancien code INSERE sans empreinte et se fait refuser par le
-- NOT NULL -- ce qui est sans consequence (la memorisation est best-effort et
-- journalisee, cf. lib/matching/reprise.ts), mais fait repayer les lots d'un
-- run interrompu.
--
-- ═══ LE DEFAUT FERME ════════════════════════════════════════════════════════
--
--   `matching_notes_partielles` etait indexee par (publication_id, profile_id)
--   avec le modele en colonne. Trois identites, AUCUN CONTENU.
--
--   Un expert modifiait son profil, le moteur repartait, et retrouvait « sa »
--   note : celle calculee sur le profil d'AVANT. Rien ne levait. La note servie
--   etait fausse jusqu'a la purge -- vingt-quatre heures.
--
--   Le report de soixante minutes ne fermait pas cette fenetre, il la
--   RETRECISSAIT : une modification a T+61 min relancait un run qui reutilisait
--   la note ecrite a T+60.
--
--   MEME TROU DU COTE ANNONCE, par un chemin plus court qu'il n'y parait : le
--   brouillon sert LES DEUX SENS (c'est ecrit et voulu -- une note acquise par
--   le run d'un expert epargne le run de l'annonce). Une note perimee ecrite
--   par un sens est donc servie a l'autre.
--
-- ═══ LA DECISION ════════════════════════════════════════════════════════════
--
--   Arbitre par Youssef le 22/09/2026 : la cle porte LE CONTENU.
--
--   L'autre sortie -- solder le brouillon en fin de run -- est une DISCIPLINE :
--   elle depend de la fin du run, et un run qui meurt a mi-chemin laisse des
--   notes perimees. Une garde qui est une CLE ne depend d'aucune discipline
--   (E.31).
--
-- ═══ POURQUOI ON VIDE LA TABLE, ET POURQUOI IL N'Y A PAS DE DEFAUT ══════════
--
--   Les lignes existantes ont ete calculees sur des textes qu'on ne peut plus
--   reconstituer : leur empreinte est INCONNUE, pas vide. Leur donner '' par
--   defaut creerait une valeur sentinelle qu'il faudrait ensuite penser a
--   exclure a chaque lecture -- une discipline, exactement ce qu'on remplace.
--
--   La table est EPHEMERE par construction (soldee en fin de run, purgee a
--   24 h) : la vider ne perd rien d'autre que des notes qu'un run rejouera.
--   C'est d'ailleurs ce que `20260919000000_echelle_des_notes` a deja fait,
--   pour une raison voisine (l'echelle des notes avait change).
--
--   Table vide => la colonne peut etre NOT NULL SANS DEFAUT. Une ligne sans
--   empreinte devient IMPOSSIBLE, et non « deconseillee ».

begin;

-- ① On vide : les empreintes des lignes existantes sont inconnues (cf. plus haut).
delete from public.matching_notes_partielles;

-- ② La colonne, NOT NULL et sans defaut : aucune ligne ne peut naitre sans elle.
alter table public.matching_notes_partielles
  add column empreinte text not null;

comment on column public.matching_notes_partielles.empreinte is
  'sha256 du couple (texte annonce, texte profil) passe au reranker, dans CET '
  'ordre quel que soit le sens du run -- sinon les deux sens cesseraient de '
  'partager leurs notes. Calcule par lib/matching/empreinte.ts. Une note n''est '
  'reutilisee que si l''empreinte recalculee est identique : un profil ou une '
  'annonce modifie a une autre empreinte, donc d''autres notes.';

-- ③ L'index de lecture porte l'empreinte.
--
--    La lecture filtre sur (publication_id, profile_id, model) PUIS compare
--    l'empreinte. La cle primaire (publication_id, profile_id) sert deja les
--    deux premiers ; l'empreinte est comparee en memoire par le code, qui doit
--    de toute facon distinguer « ligne absente » de « ligne perimee » pour
--    journaliser la seconde. Aucun index supplementaire n'est donc cree : un
--    index qui ne sert aucune requete est une ecriture payee a chaque note.

commit;
