# Reprise — le lot du grand livre

> **À lire en premier par une session qui repart.** Tenu à jour toutes les cinq actions.
> Ce fichier dit **où en est le lot** ; le **pourquoi** vit dans la mémoire — §D.26, §C.20, §C.21
> et §H.3 de [architecture.md](architecture.md). Rien ici ne remplace le code : en cas de doute,
> `node scripts/diag-grand-livre.mjs` compte ce qui est branché.

**Dernière mise à jour : 30/09/2026 (ARRÊT 19).** Branche `feat/sprint-archi-orga`. Aucun `git push`, aucune écriture en base.

## ✅ OÙ EN EST LE LOT — LE GRAND LIVRE EST TERMINÉ ET DÉPLOYÉ (28/09/2026)

**Terminé.** Les trois étapes du mandat sont faites : 71 actions, un écrivain chacune (contrôle strict) ; la pièce
dans les cinq sous-journaux ; l'écran `/admin/journal` (liste, pièce complète) et le nettoyage manuel.
**Déployé sur staging** (Youssef, 28/09/2026) : les 17 migrations de la phase B appliquées, le code en ligne.

**Au prochain push** — HUIT migrations de l'ARRÊT 19 (le parcours expert, ci-dessous), à pousser APRÈS
`analyse_cv_atomique` (ARRÊT 18) : la requête de staging suppose `analyse_cv_atomique` appliquée (⓪) ; si elle ne
l'est pas, ⓪ sort en ÉCART — on s'arrête et on me le dit. Avant l'ARRÊT 18, staging était à jour jusqu'à
`sous_domaine_reglable` (ARRÊT 15, déployé par Youssef le 29/09/2026). Le prochain push porte le code de l'ARRÊT 17 (le SMS dit sa cause ; les variables se disent au démarrage) — l'ARRÊT 16 est déployé (`2ace4ab`). **L'ARRÊT 14 remplace le correctif de l'ARRÊT 13** : staging lit l'écosystème dans
l'adresse, comme la production — `DEV_DOMAIN_SLUG` ne se pose sur AUCUN environnement Vercel ; il faut
`NEXT_PUBLIC_DOMAINE_RACINE` sur Production et Preview **avant** le déploiement, et l'adresse générique de staging
(étapes de Youssef, ARRÊT 14). La requête de staging est écrite pour cet état (⓪ `sous_domaine_reglable`,
listes vides). **Si `npx supabase db reset --local` échoue sur « EUNKNOWN … uv_spawn »** : c'est le Contrôle
intelligent des applications de Windows (§E.82) — Sécurité Windows → Contrôle des applications et du navigateur →
Paramètres du Contrôle intelligent des applications → Désactivé.

**Restent à faire, par Youssef :**
1. **L'essai d'inscription sur staging** — un expert freelance, un expert CDI, une organisation, une invitation
   acceptée ; et un lien de confirmation expiré. Chacun doit laisser sa ligne au grand livre (`compte_cree`, puis
   `expert_inscrit` / `organisation_preinscrite` / `invitation_acceptee`).
2. **La saisie des durées, quand il voudra nettoyer** — Administration → Grand livre → « Conservation et
   nettoyage » : la conservation et le plancher légal, famille par famille. Elles sont nées VIDES : **tant qu'une
   famille n'a pas ses deux valeurs, rien ne s'y efface**. Rien ne presse.

## Le mandat, en une phrase par étape

- **Étape 2** — chaque action de `grand_livre_actions` (55) a **exactement un** écrivain, prouvé par le contrôle.
- **Étape 3** — une colonne `piece` sur `audit_logs`, `ai_spend_events`, `stripe_events`, `cron_run_log`
  (pièce née en SQL, transmise dans le corps HTTP), `notifications`. Pas de reprise de l'historique.
- **Étape 4** — l'écran `/admin` du grand livre (filtres, pièce complète, lien vers l'objet, montants, nom
  rejoint à la lecture ou « compte supprimé », pagination réelle, troncature annoncée) et le batch de
  nettoyage (manuel, rétention réglable, plancher légal, annonce avant, confirmation, sa propre ligne).

## Fait

| Famille | Actions |
|---|---|
| (a) argent et réglages | `reglage_modifie` (6 familles), `paiement_recu`, `plafond_atteint`, `refus_plafond_atteint`, `ip_effacees` |
| (b) candidature et dévoilement | `candidature_deposee` (et la pièce du rejeu), `refus_depot_sans_jugement`, `refus_expert_inapte`, `refus_garde_eligibilite`, `refus_quota_cv`, `candidature_declinee`, `candidature_retenue`, `devoilement_ouvert`, `devoilement_ferme` |
| (c) le moteur, deux sens | `recherche_lancee`, `_filtree`, `_classee`, `_correspondances`, `_notifiee`, `_terminee`, `_echouee`, `_abandonnee` |
| (d) annonce, profil, CV, disponibilité | `annonce_publiee`, `annonce_modifiee`, `annonce_depubliee`, `annonce_expiree`, `cv_televerse`, `profil_publie`, `profil_modifie`, `disponibilite_basculee` |
| (e) comptes | `compte_suspendu`, `compte_reactive`, `compte_valide`, `compte_refuse`, `session_revoquee`, `suppression_programmee`, `suppression_annulee`, `email_change`, `mot_de_passe_change`, `telephone_verifie` |
| (e) gouvernance | `membre_invite`, `invitation_revoquee` (`bd77104`), `invitation_renvoyee`, `invitation_acceptee`, `role_membre_change`, `membre_retire`, `membre_parti` — **(e) fait** |
| (f) collaboration | `sous_traitance_publiee`, `sous_traitance_candidature` |
| (g) RGPD | `compte_purge_demande`, `compte_purge_inactivite`, `compte_purge_admin`, `inactivite_avertie` |
| messagerie | `message_envoye` |

**Compte : 71 / 71** (phase B, 28/09/2026) — chaque action a exactement un écrivain, contrôlé ; détail à l'ARRÊT 8.

## ⛔ ARRÊT 19 — LE PARCOURS EXPERT, DU CV À LA PREMIÈRE MISE EN RELATION, SANS UN MUR (30/09/2026)

Mandat : corriger TOUT l'audit rendu sur `aac5f79` (4 bloquants, 12 majeurs, les mineurs) dans un seul lot. Tag local
`sauvegarde-avant-parcours-expert` sur `aac5f79`, arbre propre (hormis `supabase/snippets/`, à Youssef).

**ÉCRIT AVANT LE CODE, comme demandé : les contradictions, puis les propositions des points 6 et 7.**

**Contradictions signalées.**
① **« Le profil se remplit uniquement par le CV » ↔ « B1, B4, M4, M11 à la source »** : ces quatre défauts vivent dans le
  FORMULAIRE de validation. Lecture retenue : les entrées du tableau de bord (bandeau, « Compléter mon profil », étapes de
  démarrage) mènent à l'IMPORT ; l'écran de validation n'est atteint qu'APRÈS une analyse, il montre ce que le document a
  donné et DEMANDE ce qu'un document ne peut pas donner. L'expert peut encore corriger une lecture fausse — sinon un CV
  mal lu le bloquerait sans issue. Réversible en retirant l'édition.
② **« Une erreur de notre côté ne consomme ni quota ni dépense » ↔ §D.24 « le compteur compte ce qu'on paie »** : l'argent
  réellement payé au fournisseur reste compté (c'est un fait), mais IMPUTÉ `non_imputable` avec sa raison — ni au quota ni
  au plafond du compte de l'expert. Le quota ne compte plus que les analyses ABOUTIES ; un plafond anti-abus par heure borne
  les dépôts (constante nommée, comme la relance, §D.7).
③ **« Sans cron Vercel »** : l'ordonnanceur est `pg_cron` ; il appelle une route (comme les cinq tâches existantes). La
  route a `maxDuration = 300`, comme `cron/expert-relance` : le plan Vercel doit l'accepter — À VÉRIFIER (ci-dessous).
④ **Republier un profil DÉJÀ approuvé** : la vérification tournait dans la requête et démotait à la seconde. Asynchrone,
  le profil reste approuvé pendant la vérification (quelques minutes au plus), puis le verdict démote s'il le faut. L'autre
  choix — repasser à « en cours » tout de suite — retire l'expert des mises en relation à chaque republication.
⑤ **« Enregistrer comme brouillon » sur un profil publié le dépublie** (audit, « à arbitrer ») : c'est le SEUL chemin qui
  fait repasser une modification par la vérification. Le retirer laisserait un profil vérifié changer sans contrôle. Il
  reste, mais il est DIT avant le clic (quatre langues). À trancher par Youssef s'il en veut un autre.
⑥ **`analyse_cv_atomique` est peut-être déjà appliquée** (Youssef déployait pendant l'audit) : la fonction nouvelle porte
  un AUTRE nom (`ecrire_analyse_cv`) — l'ancienne ne se supprime qu'au déploiement suivant (§E.72), dette nommée.
⑦ **« Chaque bloquant et majeur a son test qui échoue sans le correctif »** : ce qui est en base se prouve par pgTAP ; ce
  qui est dans un écran (bandeau, attente, bascule) se prouve par un CONTRÔLE statique ou par l'exécution d'un module pur —
  le dépôt n'a pas de navigateur de test. Dit ligne par ligne dans l'épreuve.

**PROPOSITION DU POINT 6 — les travaux d'IA longs ne dépendent plus d'une requête.**
- **Une file en base** : `travaux_ia` (nature `analyse_cv` ou `verification_expert`, profil, état `en_attente` →
  `en_cours` → `reussi` / `echoue` / `annule`, tentatives bornées, échéance de la prochaine, bail, pièce du geste,
  code d'échec nommé). Au plus UN travail actif par profil et par nature (index unique partiel) ; déposer à nouveau
  annule l'ancien.
- **Déposer est une transaction** : la route écrit l'état du profil (« analyse en cours », « vérification en cours ») ET
  le travail, puis répond tout de suite (202). La base réveille l'exécutant aussitôt par `pg_net`.
- **L'exécutant** : `POST /api/cron/travaux-ia` (secret de tâche, `maxDuration = 300`), prend les travaux dus sous bail
  (`for update skip locked`), les exécute, les termine. Un échec de NOTRE côté (panne, fournisseur, délai) est REJOUÉ avec
  un délai croissant, jusqu'au plafond.
- **Le pilote `pg_cron`, chaque minute, en SQL** : il réveille l'exécutant s'il y a du travail dû, et il CLÔT ce qui est
  perdu — un bail expiré après la dernière tentative, un travail que personne n'a pris depuis 30 minutes. Clore applique
  l'issue de repli EN BASE : analyse → « échouée, nommée » ; vérification → « à revoir par un humain ». **Aucun profil ne
  reste « en cours » pour toujours, même si l'hébergeur ne répond plus.**
- **L'expert** : l'écran attend l'issue réelle (sondage), et s'il part, le tableau de bord dit « en cours » tant que c'est
  vrai, puis l'issue. **L'admin** : un écran « Travaux d'IA » (en cours, en attente, échoués, avec le motif) et un bouton
  « Relancer » (journalisé) ; la supervision rougit sur un travail échoué ou en retard.

**PROPOSITION DU POINT 7 — ce qu'un CV ne peut pas donner, et comment le demander.**
Le prédicat de visibilité exige douze choses. Un CV (ou l'export PDF LinkedIn) donne : titre, résumé, compétences,
expériences, langues. Il ne donne PAS, ou pas avec certitude :
| Ce qui manque | Pourquoi un CV ne le dit pas | Comment le demander |
|---|---|---|
| **Disponibilité** (freelance : à l'écoute / pas à l'écoute ; CDI : en poste / ouvert) | un CV dit ce qu'on a fait, pas ce qu'on accepte | une question fermée, sans valeur cochée d'avance, en tête de l'écran de validation |
| **Zones de travail** | un CV dit où l'on a travaillé, pas où l'on accepte d'aller — l'analyseur a l'interdiction de les déduire | le sélecteur existant, même endroit |
| **Séniorités acceptées** | le CV établit un niveau ATTEINT ; accepter un niveau inférieur est un choix | pré-cochées depuis le CV, à confirmer |
| **Branche et spécialités** | un classement dans NOTRE référentiel, que le modèle propose sans certitude — et « Autre » ne s'y range pas | proposées depuis le CV, à confirmer ; « Autre » seul devient publiable |
| **Modes de travail, tarif / salaire, préavis** | rarement écrits | les champs existants (le salaire et le préavis restent exigés du CDI) |
| **Le résumé de 200 à 800 caractères** | un CV n'en a souvent pas, ou un trop court | l'analyseur l'ÉCRIT, dans ces bornes ; un résumé hors bornes est ramené ou signalé |
Le bandeau du tableau de bord ne liste plus de champs : il dit que le profil n'est pas visible et mène à l'import ; la page
d'import, si un CV est déjà analysé, propose « Reprendre la validation » à côté de « Importer un nouveau document ».

### Ce qui a été fait, item par item de l'audit (sur `aac5f79`)

« Contrôle » = `scripts/diag-parcours-expert.mjs` (nouveau, 99 vérifications, section entre crochets), sauf mention.
« Test » = pgTAP, `supabase/tests/database/…` — **écrits, JAMAIS exécutés ici** (ni Docker ni base) : c'est l'étape 3
de Youssef qui dit s'ils passent.

| Item | État | Ce qui a été fait | Prouvé par |
|---|---|---|---|
| **B1** Disponibilité exigée, jamais demandée | **corrigé** | L'écran freelance DEMANDE la disponibilité (deux réponses, aucune cochée d'avance), le surlignage a sa cible, le corps envoie `availability_status` ; le CDI envoyait déjà `cdi_status`. | Contrôle [B] |
| **B2** Fiche admin d'un expert en 500 | **corrigé** | `get-expert` : plus d'embed `specialities(…)` ; les spécialités se résolvent depuis `speciality_ids` ; une lecture en panne rend 503 `fiche_incomplete` au lieu d'une fiche amputée ; l'écran affiche les séniorités et les spécialités. | Contrôle [C] (aucun embed `specialities(` dans `app/`, `lib/`, `components/`) |
| **B3** Vérification coupée à 60 s, « en cours » pour toujours | **corrigé** | La vérification se DÉPOSE (`travaux_ia`) ; l'exécutant tourne sous 300 s ; le pilote pg_cron clôt ce qui est perdu avec un repli en base (revue humaine). | Contrôle [D] ; tests `profil/travaux_ia` (26), `grand_livre/travaux_ia` (4) |
| **B4** « Autre » seul impubliable | **corrigé** | Le prédicat (TS), la route et la contrainte (`specialite_autre_publiable`) acceptent une précision « Autre » non vide. | Contrôle [E] (prédicat exécuté) ; test `profil/specialite_autre` (3) |
| **M1** Toute déconnexion dit « un autre compte » (ma régression) | **corrigé** | Verdict `absent` quand il n'y a plus de session : l'écran oublie le compte affiché, n'éjecte pas ; `session_superseded` et la suspension gardent leur motif ; l'écran de connexion réinitialise le compte affiché. | Contrôle [G] (verdict exécuté) ; `diag-identite-cv` (cas 4 réécrit) |
| **M2** Une valeur fautive rejette toute l'analyse | **corrigé** | Normalisation pure (`normaliser-analyse.ts`) + `ecrire_analyse_cv` champ par champ, ligne par ligne, textes bornés ; écarts rendus, écrits dans `cv_televerse`, montrés à l'écran ; quota compté sur la réussite seulement ; une erreur de notre côté est `non_imputable`. | Contrôle [F] (normalisation exécutée sur 2020-01, 7,5, « mission », « natif », « France », résumé trop long, doublons) ; test `profil/analyse_cv_tolerante` (18) |
| **M3** Analyse du CV > 60 s | **corrigé** | Le dépôt dépose (202, `maxDuration = 30`) ; l'analyse tourne dans l'exécutant ; l'écran suit l'issue (`suivreAnalyse`, 10 min) et l'import dit l'état (`EtatAnalyseCv`). | Contrôle [D], [O] |
| **M4** Listes effacées en silence | **corrigé** | `remplacer_listes_profil` : tout ou rien, AVANT les champs simples ; une ligne refusée rend 400 `liste_refusee` avec la liste, le rang, la cause ; les longueurs et années de saisie sont celles des colonnes. | Contrôle [H], [N] ; test `profil/listes_profil` (7) |
| **M5** Première recherche ratée jamais rejouée | **corrigé** | `echouer_relance_expert` pose une échéance ; une fonction unique `lancerMiseEnRelationImmediate` (tentative, run, solde ou échec) pour l'approbation admin, la vérification approuvée et la ré-analyse ; les deux accueils disent l'échec. | Contrôle [I] ; test `matching/premiere_recherche` (5) |
| **M6** L'e-mail de l'approbation saute la recherche | **corrigé** | La recherche passe AVANT l'e-mail, qui vit dans sa propre fonction : ses `return` ne sautent plus rien. | Contrôle [I] |
| **M7** Notifications en 42P10 | **corrigé** | `poser_notifications_match` porte le prédicat de l'index partiel ; une correspondance ne passe « notifiée » que si sa notification existe ; le dispatcher n'attend que les canaux ouverts. `diag-moteur-echelle` gardait la forme fautive : réécrit (§E.88). | Contrôle [J], [N] ; test `matching/notifications_match` (5) |
| **M8** « Repasser à l'écoute » écrit `profiles` depuis le navigateur | **corrigé** | La bascule passe par `POST /api/profile/disponibilite` ; l'écriture navigateur est supprimée. | Contrôle [K] |
| **M9** `journal_error` affiché « échec » | **corrigé** | `lib/profil/refus-profil.ts` : chaque code de la route a son message (quatre langues), `journal_error` dit que la publication a abouti, un code inconnu est cité ; les deux écrans de validation et « Mon profil » l'utilisent. | Contrôle [L] (exécuté ; codes de la route relus un par un) |
| **M10** Auto-approbation absente du grand livre | **corrigé** | Action `verification_conclue`, seul écrivain `poser_verdict_verification` ; `users.status` passe de `in_review` à `active` à l'approbation. | Contrôle [M] ; test `grand_livre/verification_conclue` (8) ; `diag-grand-livre` |
| **M11** Panne du référentiel efface branche, spécialités, zones | **corrigé** | Un référentiel illisible BLOQUE l'enregistrement, avec son message ; rien n'est envoyé vide. | Contrôle [N] |
| **M12** « Vous serez notifié » faux | **corrigé** | Le flux porte `notificationsActives` et `horsDuMoteur` ; la phrase n'est dite que si c'est vrai. | Contrôle [N] |
| **m1** Refus au dépôt : statut `processing`, quota consommé | **corrigé** | Le quota se compte à l'écriture réussie, en base ; un refus clôt le travail avec son code. | Contrôle [F], [N] |
| **m2** `verification_attempts` échoue en silence | **corrigé** | Écriture supprimée (la table exige une organisation ; le grand livre porte le verdict). | Contrôle [N] |
| **m3** Motifs mensongers à l'admin | **corrigé** | Une panne de lecture se rejoue (plus « domaine introuvable ») ; un échec du modèle est déféré avec SA cause (configuration, document refusé, réponse illisible). | Contrôle [N] ; `cause-echec-modele` exécuté [F] |
| **m4** Dépense de la vérification sous-comptée | **corrigé** | Chaque tentative payée est comptée ; tour mis en pause repris ; plus de rejeu caché du SDK (`maxRetries: 0`). | Contrôle [N] ; `diag-depense-ia` |
| **m5** Résumé : un emoji compte 2 | **corrigé** | Longueur en points de code, comme `char_length`. | Contrôle [E] (exécuté) |
| **m6** Codes de refus non traduits | **corrigé** | Voir M9. | Contrôle [L] |
| **m7** Validation lit `getSession()` | **corrigé** | `sessionDuCompteAffiche()` sur les deux écrans. | Contrôle [N] |
| **m8** Annonces sans auteur écartées | **corrigé** | Filtre `created_by` fait en mémoire, une annonce sans auteur reste. | Contrôle [N] |
| **m9** Deux recherches sur une paire font échouer le lot | **corrigé** | `ignoreDuplicates` sur l'insertion des correspondances. | Contrôle [N] |
| **Point 4** Le test `analyse_cv` | **corrigé** | Valeur admise (`project`) ; une liste unique `types_experience()` lue par la contrainte, recopiée en TS, lue par les deux analyseurs. | Contrôle [A] ; test `profil/types_experience` (4) |
| **Point 7** Le profil par le CV ou LinkedIn | **fait** | Bandeau sans liste de champs, vers l'import ; « Compléter mon profil » et les étapes de démarrage vers l'import ; les analyseurs lisent l'export PDF LinkedIn ; l'import reprend une validation en cours. | Contrôle [O] |
| **Règle §G.10** | **écrite** | Une ligne dans CLAUDE.md (lire les contraintes avant d'écrire), et §E.88. | — |

**Les huit migrations nouvelles** (plage `0xxxxx`, §G.2 ; toutes AVANT le déploiement ; aucune ne retire de signature) :
`20260930000010_types_experience`, `…020_analyse_cv_tolerante`, `…030_verification_conclue`, `…040_travaux_ia`,
`…050_premiere_recherche_rejouee`, `…060_notifications_match`, `…070_specialite_autre_publiable`,
`…080_listes_profil_atomiques`. Détail : [architecture.md §B.2](architecture.md). Tests nouveaux : 80 assertions dans
9 fichiers (+ `profil/analyse_cv`, 13, corrigé).

**Les écrans nouveaux** : `/admin/travaux-ia` (menu Administration) ; sur l'import, l'état de l'analyse ; sur la
validation, les écarts de l'analyse et la question de disponibilité.

### Pour Youssef — dans l'ordre, chaque étape verte avant la suivante

1. **Le poste** : Docker lancé. Dans le dossier du projet : `npx supabase link --project-ref wnayuerhakekxccgimeg`,
   puis `node scripts/verifier-version-postgres.mjs` (il doit dire 17.6.1.121 ou plus).
2. **La base jetable** : `npx supabase db reset --local`. Si ça s'arrête sur une migration, copiez-moi le message.
3. `npx supabase db lint -s public --level error` — la sortie doit être **vide**.
4. `npx supabase test db --local` — **tous les tests doivent passer**. C'est la première fois que les 9 fichiers
   nouveaux tournent : s'il y a un rouge, copiez-moi le nom du fichier et le numéro du test, je corrige avant tout push.
5. **La requête de staging** : ouvrez `supabase/verifications/staging-avant-push.sql`, collez-la dans l'éditeur SQL de
   staging, exécutez. **Un seul `ÉCART`, on s'arrête.** Si c'est la ligne ⓪, c'est que l'ARRÊT 18
   (`analyse_cv_atomique`) n'est pas encore poussé : dites-le-moi.
6. `npx supabase db push`, puis **aussitôt** `git push`.

**Ce que le code ne peut pas trancher — à vérifier sur staging :**
- **Vercel** : la fonction `/api/cron/travaux-ia` demande 300 secondes. Dans Vercel → le projet → Settings →
  Functions, la durée maximale doit l'autoriser (c'est déjà le cas si `cron/expert-relance` tourne sans être coupée).
- **Le coffre-fort de la base** (Supabase → Project Settings → Vault) : `cron_secret` et `purge_cron_base_url` posés.
  Sans eux, aucun CV n'est analysé : les analyses partent en échec au bout de 30 minutes, et
  **/admin/travaux-ia** les liste.
- **Les tâches planifiées** : **/admin/taches-planifiees** doit montrer **douze** tâches, dont `travaux_ia_pilote`.
- **Le moteur** : `ENABLE_RERANKING` vaut exactement `true` et `COHERE_API_KEY` est posée (Preview comme Production) ;
  `ENABLE_AI_CV_PARSING` vaut `true`. **/admin/supervision** ne doit rien montrer en BLOQUANT.
- **La recherche web** du vérificateur : autorisée sur l'organisation Anthropic (sinon chaque vérification part en
  revue humaine, avec la cause « configuration » ou « document refusé » — visible dans /admin/travaux-ia ou sur la fiche).
- **Les notifications** : dans **/admin/matching**, « notifier » activé pour l'écosystème d'essai si vous voulez voir
  l'e-mail ; sinon l'écran « Missions » ne promet plus de notification, et c'est normal.

**Les données d'essai pour une première mise en relation :**
- Une **organisation d'essai approuvée**, dans l'écosystème d'essai, avec **au moins deux annonces publiées, actives et
  non expirées** (au 23/09, les six annonces de la recette étaient expirées : il faut en publier de nouvelles, ou
  prolonger leur durée de vie dans **/admin/durees**).
- Ces annonces dans **la même branche** que l'expert d'essai, et un **pays commun** avec ses zones de travail ; une
  annonce freelance pour l'expert freelance, une annonce CDI pour l'expert CDI.
- Un **expert d'essai** : inscription, téléphone vérifié, dépôt d'un CV (ou de l'export PDF LinkedIn) — attendre
  « analyse terminée » — valider en répondant à la disponibilité — attendre la vérification (quelques minutes). S'il
  part en revue humaine, l'approuver depuis **/admin/experts**. La première recherche part alors d'elle-même ; l'accueil
  de l'expert dit ce qu'elle a trouvé, ou pourquoi elle a échoué.

### Les arbitrages laissés à Youssef (rien n'est bloqué)
- ④ Republier un profil approuvé le laisse approuvé pendant sa re-vérification (§H.5).
- ⑤ « Enregistrer comme brouillon » dépublie un profil publié — c'est dit avant le clic.
- Une ré-analyse remplace les faits du document (titre, expériences, formations, langues) et garde les choix de
  l'expert (disponibilité, zones, séniorités acceptées, classement).
- `appliquer_analyse_cv` (ARRÊT 18) n'est plus appelée : elle partira au push suivant (§E.72).

### L'épreuve
(ci-dessous, au commit de l'épreuve)

## ⛔ ARRÊT 18 — DEUX COMPTES DANS LE MÊME NAVIGATEUR : LE MENU DE L'UN, LES REQUÊTES DE L'AUTRE (30/09/2026)

Constat de Youssef (`skilloria365.staging.skilloria.io`, `b7b5c68` déployé) : compte d'essai « Mehdi », puis l'admin
connecté dans le même navigateur ; revenu sur le compte d'essai : dépôt du CV → « Une erreur est survenue » ; accueil
→ « Bonjour Youssef » sous le menu « Mehdi Ben ayed » ; « Mon profil » → « réservée aux experts freelance ». Tag local
`sauvegarde-avant-identite` sur `b7b5c68`, arbre propre (hormis `supabase/snippets/`). Détail :
[pieges.md §E.87](pieges.md#e87), [architecture.md §D.29](architecture.md#d29).

**LA CAUSE, PISTE PAR PISTE (point 1), lue dans le code à `b7b5c68`.**
- **(a) VRAIE — c'est elle.** La session Supabase du navigateur est une par adresse et le cookie de session unique est
  posé sur le domaine parent : la connexion de l'admin a remplacé celle de Mehdi pour tous les onglets. Le menu
  (`components/shell/DashboardShell.tsx`, effet l. 81-136, lu UNE fois au montage) est resté sur Mehdi ; les pages ont
  relu la session à leur montage — l'admin : « Bonjour Youssef » est le prénom de l'admin
  (`app/[locale]/dashboard/freelance/page.tsx` l. 221) ; « Mon profil » refuse sur `user_type = admin`
  (`…/mon-profil/page.tsx` l. 305 et 324) ; le dépôt part avec le jeton de l'admin → `wrong_user_type`
  (`app/api/profile/upload-cv/route.ts` l. 77) → « une erreur est survenue » (`…/freelance/profil/page.tsx` l. 124).
- **(b) FAUSSE.** L'analyseur n'extrait aucun nom (`lib/cv-parser.ts`), la route du CV n'écrit pas `users` — et ici
  elle s'est arrêtée à la ligne 77, avant l'analyse. Le prénom affiché était celui du compte qui agissait.
- **(c) FAUSSE pour ce cas** : aucun profil à moitié écrit — la route n'a rien écrit. Mais le défaut EXISTAIT : la route
  écrivait l'analyse en sept appels séparés, erreurs seulement journalisées. Corrigé (point 3).

**Contradictions signalées :** ① le serveur ne peut pas savoir quel compte un écran affiche si l'écran ne le dit pas :
la garde est donc partagée — l'écran DÉCLARE (`x-compte-affiche`), le serveur TRANCHE (`compte_different`). Une requête
sans déclaration (premier chargement, routes publiques) n'a rien à comparer. ② « Déconnecté proprement » purge la
session locale du navigateur : l'AUTRE onglet (l'admin) est déconnecté aussi — un navigateur, un compte (§D.29). ③ La
diffusion de la session entre onglets par supabase-js n'est PAS MESURÉE : la garde écoute aussi le retour sur l'onglet.

| Point | État | Ce qui a été fait |
|---|---|---|
| 1. La cause | **prouvée par le code** | Ci-dessus, piste par piste. |
| 2. La sécurité | **fait** | `lib/identite/verdict.ts` (pur, client et serveur) ; `lib/identite/compte-affiche.ts` (le compte affiché, la garde de la coquille et de l'admin, l'éjection propre) ; `useSecureFetch` n'envoie pas sous un autre compte et déclare le sien ; `requireAuth` refuse `compte_different` (403) avant toute autre garde ; la salutation, « Mon profil » et l'admin lisent l'identité par le compte affiché ; l'écran de connexion dit le motif (quatre langues). |
| 3. Le nom, l'analyse | **fait** | Migration `analyse_cv_atomique` : `appliquer_analyse_cv` écrit profil + trois listes en UNE transaction, statut `done` en dernier, liste fermée de colonnes, jamais `users`. La route l'appelle ; un échec → `analyse_non_ecrite`, profil inchangé. |
| 4. Les messages | **fait** | `lib/profil/refus-depot-cv.ts` : chacun des codes de la route a son message (quatre langues), un code inconnu est CITÉ, plus de « une erreur est survenue » ; « Mon profil » : lecture du compte, compte absent, lecture du profil, inattendu, et « pas freelance » qui NOMME le type du compte connecté — panneaux en pleine largeur, alignés à gauche, 24 px. |
| 5. La preuve | **faite** | `diag-identite-cv` (la séquence des deux comptes exécutée sur le verdict ; le câblage ; le nom ; l'atomicité ; les messages) ; `supabase/tests/database/profil/analyse_cv.test.sql` (13 : analyse complète, CV AU NOM D'UNE AUTRE PERSONNE sans effet sur le compte, échec en cours de route qui n'écrit RIEN, liste vide qui n'efface rien, fermée au navigateur) — **jamais exécuté ici** (pas de base). |
| 6. Pour Youssef | **écrit** | Ci-dessous. |

**Checklist** : 0 (aucun nom, aucune valeur) · 5 (la garde tranche au serveur ; l'analyse s'écrit en base, en une
transaction ; l'écran ne fait que déclarer et prévenir) · 12 (`compte_different`, `analyse_non_ecrite` nouveaux ; aucun
code renommé) · 13-14 (messages actionnables, quatre langues) · 15 (V0 = la prod : même garde partout).

**Migration nouvelle : `20260930000000_analyse_cv_atomique`** (AVANT le déploiement). Requête de staging : ⓪
`sous_domaine_reglable` ; `prochain_push_cree` = la fonction `appliquer_analyse_cv`.

**Épreuve** (lot commité en `a00e686` AVANT de muter) :
- `tsc --noEmit` : aucune erreur hors `.next/` · `next build` : **exit 0** · lint : **65 / 24** · parité i18n :
  **4054 clés** · série complète `diag.mjs` : **118 verts, 0 rouge, 5 muets** (les mêmes : trois écartés parce
  qu'ils écrivent en base, deux arrêtés par libuv sous Windows) · `diag-memoire-a-jour --base=b7b5c68` : vert.
- Pendant la série, deux contrôles ont rougi à raison. `diag-ecritures-effectives` : les deux écritures du profil dans
  `appliquer_analyse_cv` exigent maintenant leur compte (EC001) ; les trois suppressions de listes sont au gel, raison
  écrite (un premier dépôt n'a rien à effacer). `diag-garde-et-action` : la voie freelance a quitté l'inventaire des
  suppressions TypeScript — la propriété (« la liste réinsérée est testée avant la suppression ») se vérifie sur ses
  deux moitiés : la route ne confie qu'une liste non vide après normalisation, et la FONCTION ne supprime que sur une
  liste non vide (règle posée en base, test E).
- **18 mutations, 16 rouges au premier passage** : un panneau de refus centré en `maxWidth: 560` et un motif
  `compte_different` reconnu mais affiché avec le texte d'un autre restaient verts — deux contrôles ancrés sur une
  forme (§E.34). Portés sur la propriété et commités (`f141f9e`) : **18 sur 18 rougissent** — l'envoi sous un autre
  compte, l'en-tête absent, le refus serveur retiré, la garde de la coquille puis de l'admin retirées, la salutation
  sur la session brute, une copie du compte dans le navigateur, **le prénom du CV écrit dans `users`**, le statut
  `done` avant les listes, une liste vide qui efface, un compte non exigé, la route qui supprime elle-même, un code
  sans message, un code inconnu non cité, « une erreur est survenue » revenu, le panneau centré, le motif sans texte
  en allemand, le motif affiché avec un autre texte. Arbre propre après chaque restauration.
- **Ce qui n'est PAS prouvé ici** : le test pgTAP (13) n'a jamais tourné — pas de base ; c'est l'étape C.1 de
  Youssef. Et aucun navigateur réel n'a été ouvert : la séquence des deux comptes est exécutée sur le verdict pur,
  le câblage est lu dans le code.

### Les étapes de Youssef — dans cet ordre
**A. Remettre le navigateur au propre**
1. Déconnecte-toi de l'admin et du compte d'essai, puis ferme tous les onglets de `*.staging.skilloria.io`.
2. (Si tu veux être sûr) outils de développement → **Application** → **Effacer les données du site**, sur
   `skilloria365.staging.skilloria.io` : session du navigateur et cookie de session partent.
3. Désormais : **un compte par navigateur**. Pour le second (l'admin), une **fenêtre privée** ou un autre navigateur.

**B. Vérifier le compte d'essai (lecture seule, éditeur SQL de staging)** — remplace l'adresse :
`select u.first_name, u.last_name, u.user_type, p.cv_parsing_status, p.cv_file_path is not null as cv_depose, p.title, (select count(*) from public.profile_experiences e where e.profile_id = p.id) as experiences from public.users u join public.profiles p on p.user_id = u.id where u.email = '<adresse du compte d essai>';`
Attendu : `first_name` = Mehdi, `user_type` = `expert_freelance`. **Rien à réparer à la main** : le dépôt n'a rien écrit, et
le prochain dépôt réécrit l'analyse en une fois. Si `first_name` n'est PAS Mehdi, arrête-toi et envoie-moi la ligne —
ce serait contraire à ce que le code dit.

**C. Le déploiement** (une migration : la séquence complète de §G.4 ter)
1. En local : `npx supabase db reset --local`, `npx supabase db lint -s public --level error` (sortie vide),
   `npx supabase test db --local` (un fichier neuf : `profil/analyse_cv.test.sql`).
2. La requête de staging : ⓪ `sous_domaine_reglable`, **aucun ÉCART** (la ligne ② vérifie que la fonction n'existe pas encore).
3. `npm run build`, `npx supabase db push`, puis `git push` aussitôt.

**D. Le nouvel essai du dépôt du CV** — **fenêtre privée**, seul le compte d'essai connecté :
1. `https://skilloria365.staging.skilloria.io/fr/connexion` → compte d'essai → « Bonjour Mehdi ».
2. « Créez votre profil » → coche l'autorisation → dépose un CV PDF → l'analyse aboutit (page de validation), ou le
   message dit maintenant la vraie raison.
3. (Facultatif, pour voir la garde) dans une fenêtre NORMALE avec le compte d'essai ouvert, connecte-toi à l'admin dans
   un autre onglet puis reviens : l'onglet du compte d'essai se déconnecte et dit « Un autre compte s'est connecté dans
   ce navigateur ».

## ⛔ ARRÊT 17 — L'INSCRIPTION EXPERT S'ARRÊTAIT À L'ENVOI DU SMS : SIX CAUSES, UN SEUL MESSAGE « TEMPORAIRE » (29/09/2026)

Constat de Youssef (`skilloria365.staging.skilloria.io`, `2ace4ab` déployé) : branches et spécialités s'affichent ;
« Envoyer SMS » → « Service SMS temporairement indisponible. Veuillez réessayer ». Tag local `sauvegarde-avant-sms` sur
`2ace4ab`, arbre propre (hormis `supabase/snippets/`). Détail : [pieges.md §E.86](pieges.md#e86).

**LES CAUSES POSSIBLES, CLASSÉES (point 1), lues dans le code à `2ace4ab`.** L'écran (`components/PhoneOtpField.tsx`,
`messagePour`) affiche ce message pour TOUT code non reconnu. Par ordre de vraisemblance sur un staging neuf :
1. **`VONAGE_API_KEY` ou `VONAGE_API_SECRET` absente de l'environnement Preview** — la route rend `missing_env`
   (`app/api/auth/public/send-phone-otp/route.ts`, l. 54-59), que l'écran ne connaissait pas.
2. **Identifiants refusés par Vonage (401)** — clés d'un autre compte, espace en trop.
3. **Crédit Vonage insuffisant** (402, ou 403 `out-of-credit`).
4. **Compte suspendu, ou opération interdite** (403 `account-suspended` / `forbidden`).
5. **Panne de Vonage (5xx), délai dépassé, réseau** — la seule vraie « indisponibilité temporaire ».
6. **Réponse sans `request_id`.**
Le code ne peut pas dire laquelle est vivante sur staging : **une ligne du journal Vercel le tranche** (étape A.1).

**Contradictions signalées :** ① « au démarrage » veut dire, sur Vercel, à chaque nouvelle instance serveur, dans
les journaux d'exécution — pas au build ; je journalise et j'affiche en supervision, je N'arrête PAS le serveur (une clé
Stripe absente, voulue au lancement, ne doit pas couper le site). Faire échouer le BUILD sur une variable exigée est une
décision à prendre. ② Les réglages qui ne sont pas des variables (SMTP de Supabase pour la confirmation et le mot de
passe oublié, compte Vonage, Vault) ne peuvent pas être vus au démarrage : la liste et la procédure les nomment.

| Point | État | Ce qui a été fait |
|---|---|---|
| 1. La cause | **classée, prouvée par le code** | Ci-dessus. |
| 2. La panne dit sa cause | **fait** | `lib/otp/vonage-refus.ts` lit le `type` publié par Vonage ; 17 causes nommées (`CauseOtp`), journalisées `[otp] <route> — <cause>` ; code d'écran `sms_non_configure` (« de notre côté », quatre langues, trois écrans) pour tout ce qui dépend de nous ; « temporairement » seulement pour `vonage_panne`, `vonage_injoignable`, `vonage_delai_depasse`, l'illisible. Les quatre routes OTP (inscription et paramètres, envoi et vérification). La vérification ne dit plus « code invalide » sur une panne, ni « trop d'essais » quand le limiteur n'a pas sa clé. La réponse publique ne porte que le code ; la cause reste au serveur. |
| 3. Le balayage | **fait** | `lib/configuration/variables.ts` : les 27 variables lues par le code, rôle et conséquence, exigence (16 exigées sur Production ET Preview). `instrumentation.ts` les nomme au démarrage (`variable_manquante`), `/admin/supervision` en BLOQUANT. `diag-variables-environnement` rougit si le code lit une variable hors liste (et réciproquement). Parcours balayés : inscription expert, organisation, invitation (Supabase, preuve signée, Vonage, Resend), confirmation par e-mail et mot de passe oublié (SMTP réglé DANS Supabase — hors variables, nommé). Relevé au passage : la route de changement de téléphone ne demandait pas un code à 6 chiffres — alignée sur sa jumelle (§E.20). |
| 4. Pour Youssef | **écrit** | Étapes ci-dessous ; procédure : mise-en-production, étape 5 (« Chez Vonage »). |
| 5. Le piège | **écrit** | §E.86 : la liste vivait dans la documentation, aucun démarrage ne vérifiait rien, et « temporairement » était le défaut. |

**Checklist** : 0 (aucune valeur dans le code, aucun nom) · 12 (codes stables : `vonage_error`, `sms_pays_non_pris_en_charge`,
`verification_en_cours` gardent leur nom ; `sms_non_configure` s'ajoute ; les causes sont nouvelles) · 13-14 (messages
actionnables, quatre langues, trois écrans) · 15 (V0 = la prod : la même liste, le même démarrage, partout).

**Migrations nouvelles : AUCUNE.** La requête de staging reste écrite pour ⓪ `sous_domaine_reglable`, listes vides.

**Épreuve** (lot commité en `3c87a36` AVANT de muter) :
- `tsc --noEmit` : aucune erreur hors `.next/` · `next build` : **exit 0** · lint : **65 / 24** · parité i18n :
  **4030 clés** · série complète `diag.mjs` : **117 verts, 0 rouge, 5 muets** (les mêmes).
- Pendant la série, `diag-lot7-securite` a rougi à raison : il exigeait que le limiteur absent se dise « trop
  d'essais » (`refus()`). Porté sur la forme nouvelle, avec la raison : le refus reste FAIL-CLOSED, il se nomme.
- **14 mutations, 14 rouges** : **l'écran qui retombe sur « temporairement » pour une configuration absente (le
  défaut d'origine)** ; la route qui rend `missing_env` à la main ; le classificateur qui ne lit plus le `type` ; un
  401 redevenu « temporaire » ; le limiteur redit « trop d'essais » ; une variable lue hors de l'inventaire ;
  l'inventaire qui perd `VONAGE_API_KEY` ; le démarrage qui journalise une valeur ; le démarrage qui parle sur le
  poste local ; la supervision privée des manques ; la route des paramètres sans ses 6 chiffres ; la vérification qui
  redit « code invalide » ; le journal sans cause ; la réponse publique qui expose la cause. Arbre restauré, contrôles
  reverts sur les fichiers restaurés.
- **Ce qui n'a pas tourné** : Vercel et Vonage réels — la lecture A.1 et l'essai C le disent ; les tests pgTAP (aucune
  migration).

### Les étapes de Youssef — dans cet ordre
**A. Les réglages Vercel et Vonage**
1. **La lecture qui tranche** (avant tout, sur le code DÉJÀ en ligne) : Vercel → le projet → **Logs** → filtre
   `send-phone-otp`, sur la période de ton essai. Tu liras UNE de ces lignes :
   - `VONAGE_API_KEY or VONAGE_API_SECRET missing` → les deux clés manquent sur **Preview** (étape A.2) ;
   - `Vonage refus` avec `status: 401` → les clés sont fausses (copiées d'un autre compte, espace en trop) ;
   - `Vonage refus` avec `status: 402`, ou un détail `low balance` / `out of credit` → le compte Vonage n'a plus de crédit ;
   - `Vonage refus` avec `status: 403` et un autre détail → droits ou compte suspendu : lis le détail, envoie-le-moi ;
   - `Vonage fetch threw` → réseau ou délai : réessaie dans quelques minutes.
2. **Vercel → Settings → Environment Variables → environnement Preview** : vérifie que chacune de ces variables est
   posée (nom et rôle — jamais de valeur à m'envoyer) :
   - `NEXT_PUBLIC_SUPABASE_URL` — adresse du projet Supabase de staging ;
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — clé publique de ce projet ;
   - `SUPABASE_SERVICE_ROLE_KEY` — clé de service de ce projet ;
   - `NEXT_PUBLIC_DOMAINE_RACINE` — `staging.skilloria.io` ;
   - `NEXT_PUBLIC_SITE_URL` — l'origine du site de staging ;
   - `CRON_SECRET` — égal au secret `cron_secret` du Vault de staging ;
   - `INSCRIPTION_HMAC_SECRET` — égal au secret `inscription_hmac_secret` du Vault de staging, 32 caractères au moins ;
   - `PHONE_OTP_HMAC_SECRET` — signature du jeton « téléphone vérifié », 16 caractères au moins ;
   - `REAUTH_HMAC_SECRET` — ré-authentification et désabonnement, 16 caractères au moins ;
   - `VONAGE_API_KEY` et `VONAGE_API_SECRET` — les clés API du compte Vonage ;
   - `RESEND_API_KEY` et `RESEND_FROM_EMAIL` — e-mails du produit ;
   - `ANTHROPIC_API_KEY` — vérifications, jugement des candidatures, analyse des CV ;
   - `COHERE_API_KEY` et `ENABLE_RERANKING` (= `true`) — la mise en relation ;
   - **absente sur Vercel** : `DEV_DOMAIN_SLUG` (poste local seulement).
   Optionnelles, à ton choix : `ENABLE_AI_CV_PARSING` et `ENABLE_AI_CANDIDATURE_ASSESSMENT` (= `true` pour essayer
   ces fonctions), `SIRENE_API_TOKEN` ; `ENABLE_BILLING` et les clés Stripe restent absentes (lancement gratuit).
3. **Chez Vonage** (tableau de bord) : les clés API sont bien celles posées sur Vercel ; le **solde** est positif ; le
   numéro d'essai est dans un pays desservi par Verify (pas la Tunisie, +216).

**B. Le déploiement** — pas de migration, donc pas de `db push` :
1. la requête de staging : ⓪ `sous_domaine_reglable`, aucun ÉCART ;
2. `npm run build`, puis `git push`.
3. Ouvre `https://skilloria365.staging.skilloria.io/fr/admin/supervision` : **aucune ligne « variable manquante »**. S'il y
   en a une, pose-la sur Preview et redéploie. (Le même nom se lit dans les journaux Vercel : `[configuration] <NOM> — absente`.)

**C. La reprise de l'essai de l'inscription expert** (fenêtre privée, `https://skilloria365.staging.skilloria.io/fr`) :
« Créer un profil Expert » → « Envoyer SMS ». Si le SMS arrive : saisis le code, termine l'inscription, vérifie
l'e-mail de confirmation et `/admin/journal`. Sinon, le message dit désormais la vraie nature du problème, et le
journal Vercel porte la ligne `[otp] public/send-phone-otp — <cause>` : envoie-moi la cause.

## ⛔ ARRÊT 16 — L'ADMIN SE FERMAIT EN TROIS SECONDES : UNE COPIE DU SOUS-DOMAINE DÉCIDAIT À LA PLACE DE L'ADRESSE (29/09/2026)

Constat de Youssef (staging à jour jusqu'à `sous_domaine_reglable`, `1233b15` déployé) : l'admin s'affiche trois
secondes puis renvoie vers `…/ecosysteme-indisponible?code=unknown_domain&slug=microsoft` — sur `skilloria365.staging`,
et sur l'adresse `…vercel.app` de la branche depuis `microsoft.staging`. Tag local `sauvegarde-avant-garde-admin` sur
`1233b15`, arbre propre (hormis `supabase/snippets/`). Détail : [pieges.md §E.85](pieges.md#e85).

**LA CAUSE EXACTE (point 1), lue dans le code à `1233b15`.**
1. `lib/get-domain-config.ts` l. 138 : une adresse sans écosystème ACTIF (`skilloria365`, pas encore renommé ;
   toute adresse `…vercel.app`) rend la configuration neutre, dont le sous-domaine est le pseudo-slug `'default'`
   (`lib/domain-config.ts` l. 100).
2. `lib/secure-fetch.ts` l. 94 : le navigateur RECOPIAIT ce sous-domaine dans chaque appel (`x-subdomain`).
3. `lib/auth-guard.ts` l. 349 : la garde jugeait la copie → `lib/ecosystem-guard.ts` l. 113 : `unknown_domain`.
4. `lib/secure-fetch.ts` l. 163 : le filet client renvoie vers l'écran, avec `slug` = `ownSlug`
   (`lib/ecosystem-guard.ts` l. 81) — **l'écosystème DU COMPTE**, pas celui de l'adresse : d'où `microsoft` sur une
   adresse `skilloria365`. Ni cookie, ni jeton, ni stockage : la valeur vient de `users.domain_id → domains.slug`.
   Les trois secondes : le premier appel `/api` de l'écran.

**POURQUOI `…vercel.app` (point 2).** Aucun renvoi du code ne sort de l'adresse : les deux renvois vers l'écran sont
RELATIFS (`lib/secure-fetch.ts`, `lib/dashboard-routing-guard.ts`) — contrôlé. Le chemin et la requête de l'adresse
d'arrivée ont donc été produits par la page, déjà sur `…vercel.app`. La documentation Vercel (lue le 29/09/2026) le
rend probable : la protection STANDARD couvre toutes les adresses sauf la production — `*.staging.skilloria.io`
compris — et, après la connexion Vercel, « *you will be redirected to the deployment URL* ». **HYPOTHÈSE, NON
MESURÉE** : c'est un réglage Vercel, pas du code ; la mesure est l'étape A.1 ci-dessous.

**Contradictions signalées :** ① le départ vers `…vercel.app` ne se corrige pas dans le code — il se règle dans
Vercel (exception de protection pour staging), à décider par Youssef ; ② le test ne rejoue ni un navigateur ni la
base : il exécute les VRAIES fonctions de garde contre une base en mémoire ; ③ une adresse sans écosystème reste un
refus pour TOUS, administrateur compris — l'admin travaille sur l'adresse d'un écosystème qui existe ; l'écran lui
donne désormais le chemin.

| Point | État | Ce qui a été fait |
|---|---|---|
| 1. La cause | **prouvée par le code** | Ci-dessus ; une requête en lecture seule pour Youssef (étape A.2). |
| 2. Le départ de staging | **expliqué, non mesuré** | Aucun renvoi absolu dans le code (contrôlé) ; la protection Vercel, documentée ; procédure : mise-en-production, étape 6 bis. |
| 3. Le correctif | **fait** | `sousDomaineDeLaRequete()` (lib/subdomain.ts) : l'écosystème lu dans l'ADRESSE, seul point d'entrée de `requireAuth`, de la garde du tableau de bord et de `getDomainConfig`. Le navigateur n'envoie plus `x-subdomain`, le proxy n'en pose plus, aucun code ne le lit. Adresse sans écosystème : `unknown_domain`. L'écran de refus propose l'écosystème du compte DANS L'ENVIRONNEMENT (`adresseEcosysteme`), pour `unknown_domain` aussi, textes dans les quatre langues. Renommer l'écosystème de sa propre adresse n'éjecte plus l'admin : l'écran donne la nouvelle adresse. Six commentaires qui décrivaient l'en-tête corrigés. |
| 4. La preuve | **faite** | `diag-garde-adresse` : la séquence exécutée (connexion sur alpha, renommage en beta, l'onglet sur l'ancienne adresse, le retour sur la nouvelle avec une copie périmée, l'adresse de Preview, l'écosystème désactivé) + une seule source + renvois relatifs + écran. `diag-cloisonnement-ecosysteme` et `diag-selecteur-ecosysteme` défendaient l'ANCIENNE source (l'en-tête, l'échange d'hôte) : portés sur la nouvelle, avec la raison. |
| 5. Le piège | **écrit** | §E.85 : pourquoi 447 tests et 114 contrôles ne l'ont pas vu (la base n'est pas la requête ; un contrôle statique défendait le défaut ; aucun test n'exécutait la garde avec un hôte ; un pseudo-slug recopié ; les sessions déclarées non mesurées). |

**Checklist** : 0 (aucun nom, aucun slug par défaut ne décide) · 2 (l'écosystème réellement résolu : l'adresse) ·
12 (codes stables : `unknown_domain` garde son nom ; une adresse sans écosystème le rend au lieu de
`domain_mismatch`, qui ne vaut plus que pour l'expert hors de son écosystème ; `ecosysteme_non_configure` à la
garde quand la racine manque) · 13-14 (sortie actionnable, quatre langues) · 15 (V0 = la prod : même garde partout).

**Migrations nouvelles : AUCUNE.** La requête de staging déclare le nouvel état (⓪ `sous_domaine_reglable`, listes
vides ; ⑭ devient l'invariant « contrainte de forme présente et validée »).

**Épreuve** (lot commité en `1cdec5c` AVANT de muter) :
- `tsc --noEmit` : aucune erreur hors `.next/` · `next build` : **exit 0** · lint : **65 / 24** — il a DESCENDU (un
  avertissement de moins), la base est abaissée dans le même commit (§G.5 ter) · parité i18n : **4026 clés** · série
  complète `diag.mjs` : **115 verts, 0 rouge, 5 muets** (les mêmes : trois écartés parce qu'ils écrivent en base, deux
  qui plantent sur une assertion libuv de Windows).
- Pendant le lot, **trois contrôles défendaient l'ancienne source** et ont rougi : `diag-cloisonnement-ecosysteme`
  (« l'arbitrage est appelé avec l'en-tête `x-subdomain` »), `diag-controle-acces-ecosysteme` (« un `x-subdomain`
  absent refuse »), `diag-selecteur-ecosysteme` (« la sortie échange l'hôte courant »). Portés sur l'adresse, chacun
  avec sa raison — ce qu'ils défendent (aucun slug par défaut, résolution en base, aucune redirection ouverte) tient.
- **12 mutations, 12 rouges** : **l'extracteur qui préfère la copie du navigateur (le défaut d'origine — il casse le
  retour sur la nouvelle adresse)** ; `requireAuth` qui rejuge l'en-tête ; le navigateur qui renvoie une copie ;
  l'adresse sans écosystème en `domain_mismatch` ; `getDomainConfig`, puis la garde du tableau de bord, qui relisent
  l'en-tête ; le proxy qui le repose ; le refus qui porte le sous-domaine de l'adresse au lieu du compte ; l'écran sans
  sortie pour `unknown_domain` ; un renvoi absolu vers l'adresse Vercel ; l'admin qui recharge après avoir renommé sa
  propre adresse ; un texte allemand manquant. Arbre restauré, contrôles reverts sur les fichiers restaurés en CRLF.
- **Ce qui n'a pas tourné** : un navigateur réel (la protection Vercel, la session par adresse) — c'est l'étape A.1 et
  l'essai de Youssef ; les tests pgTAP (aucune migration dans ce lot).

### Les étapes de Youssef — dans cet ordre
**A. Avant tout : mesurer, puis régler Vercel**
1. **La mesure** (deux minutes) : navigateur en fenêtre privée, outils de développement → onglet **Réseau**, case
   « Conserver le journal ». Ouvre `https://microsoft.staging.skilloria.io/fr/connexion`. Si une réponse renvoie vers
   `vercel.com` puis vers `…vercel.app`, c'est la protection Vercel (§E.85). Envoie-moi la ligne si c'est autre chose.
2. **La base, en lecture seule** (éditeur SQL de staging) :
   `select d.slug, d.active, d.name, (select count(*) from public.users u where u.domain_id = d.id and u.user_type = 'admin') as administrateurs from public.domains d order by d.slug;`
   Attendu : une ligne `microsoft`, `active = true`, au moins un administrateur. Si `active = false` : l'ancien code
   éjectait l'admin sur TOUTE adresse de cet écosystème (§E.85) — dis-le-moi.
3. **Vercel → le projet → Settings → Deployment Protection → Deployment Protection Exceptions → Add Domain** :
   `*.staging.skilloria.io`. Si l'écran refuse le générique : ajoute `microsoft.staging.skilloria.io` et
   `skilloria365.staging.skilloria.io`. (Ou, si tu préfères : Vercel Authentication désactivée pour Preview. Dans les
   deux cas, staging devient public, comme la production.)

**B. Le déploiement** — pas de migration, donc pas de `db push` :
1. la requête de staging : ⓪ `sous_domaine_reglable`, **aucun ÉCART** ;
2. `npm run build`, puis `git push`.

**C. Le sous-domaine passe à `skilloria365`**
1. Fenêtre privée → `https://microsoft.staging.skilloria.io/fr/connexion` → connecte-toi. **Vérifie que la barre
   d'adresse reste sur `microsoft.staging.skilloria.io`.**
2. Administration → **Écosystèmes** → Skilloria 365 → **Modifier** → section **Sous-domaine** → `skilloria365` →
   **Changer le sous-domaine** → lis les conséquences → **Oui, changer le sous-domaine**.
3. L'écran dit que cette adresse ne sert plus l'écosystème : clique **Continuer sur la nouvelle adresse** et
   reconnecte-toi sur `https://skilloria365.staging.skilloria.io`.

**D. Les réglages Auth de Supabase staging** — Authentication → URL Configuration :
Site URL `https://skilloria365.staging.skilloria.io` ; Redirect URLs `https://*.staging.skilloria.io/*/auth/callback`
et `https://*.staging.skilloria.io/*/nouveau-mot-de-passe`.

**E. L'essai de l'inscription expert sur `skilloria365.staging.skilloria.io`** : « Créer un profil Expert » → branches
et spécialités → inscription jusqu'au bout → le lien de l'e-mail commence par
`https://skilloria365.staging.skilloria.io/` → `/admin/journal` : `compte_cree`, `expert_inscrit`, et la ligne
`ecosysteme_modifie` (`microsoft` → `skilloria365`).

**S'il te reste un cookie ou une session périmés.** Plus aucun cookie ni stockage ne décide de l'écosystème : au pire,
une session d'avant te renvoie à la connexion. Pour repartir propre : déconnecte-toi, ou, dans les outils de
développement → **Application** → **Effacer les données du site**, sur l'adresse concernée (et sur l'adresse
`…vercel.app` si tu y es allé) ; ou fais l'essai en fenêtre privée.

## ⛔ ARRÊT 15 — LE SOUS-DOMAINE D'UN ÉCOSYSTÈME SE RÈGLE DANS L'ADMIN ET SE MODIFIE (29/09/2026)

Constat de Youssef (écran Écosystèmes) : le champ « Sous-domaine » n'apparaissait qu'à la création ; Skilloria 365
portait `microsoft`. Tag local `sauvegarde-avant-sous-domaine` sur `935ffdf`, arbre propre (hormis
`supabase/snippets/`, non touché). Détail : [architecture.md §D.28](architecture.md#d28), piège
[§E.84](pieges.md#e84), procédure : [mise-en-production.md](mise-en-production.md), étape 6.

**L'état constaté (point 1), par le code et les migrations.** `domains.slug` EST le sous-domaine : unique, lu **par sa
valeur, à chaque requête** (proxy, `getDomainConfig` et la garde d'écosystème sans cache, `inscription_refus` et
`handle_new_user`, les liens d'e-mail, le sélecteur). **Aucune référence ne le recopie comme clé** : tout passe par
`domains.id` (Stripe compris : `skilloria_domain_id`). Ce qui le recopie n'est jamais relu (métadonnée `domain_slug`
lue par le seul trigger, preuve signée de 5 min, détail historique de `ecosysteme_cree`). Le verrou n'était qu'une
décision d'écran, dont la raison (déclarer chaque sous-domaine chez l'hébergeur) a disparu avec l'adresse générique.

**Contradictions et limites, signalées :**
① **« Sépare la clé technique » : déjà fait** — `domains.id` l'est ; renommer la colonne `slug` coûterait tout le
code (§E.1) pour rien. Rien n'est séparé : c'est dit dans le schéma (commentaires de colonne).
② **L'ancienne adresse devient une impasse, sans redirection** — documenté et affiché avant de confirmer ; une table
des anciens sous-domaines (et leur réemploi) serait un lot à arbitrer.
③ **Les sessions sont tenues par adresse** (`supabase-js`, stockage de l'origine) : on se reconnecte à la nouvelle.
NON MESURÉ en navigateur — et le commentaire du sélecteur d'écosystème affirme qu'une session « traverse la bascule »
entre écosystèmes : c'est vrai du cookie `ss_token`, pas nécessairement de la session du navigateur. À mesurer.
④ **Aucun label réservé dans le code** : `staging` ou `www` en production seraient injoignables — la règle est écrite
dans la procédure, pas dans une liste en dur (« aucune valeur dans le code »).
⑤ **« Aucun nom d'écosystème dans le code »** : le contrôle connaît les noms que la GRAINE sème (et leur forme
tassée, `skilloria365`) ; un nom créé seulement dans une base lui échappe. Les commentaires, les tests, les scripts et
les migrations (la graine est une donnée) sont hors de son champ, et il le dit. Trois descriptions de pages légales
portaient « Skilloria 365 » en dur : elles lisent le nom servi.

| Point | État | Ce qui a été fait |
|---|---|---|
| 1. L'état | **prouvé** | Ci-dessus ; classement complet des lecteurs (résolution, affichage, recopies, caches, littéraux). |
| 2. Modifiable | **fait** | `PATCH /api/admin/ecosystemes/[id]` : le sous-domaine SEUL, refus nommés (`sous_domaine_seul`, `_invalide`, `_inchange`, `_pris`, `_concurrent`, `lecture_indisponible`, `journal_error`), écrit sous condition (`slug = <lu>`), tracé `ecosysteme_modifie` / `sous_domaine` avant-après, et `audit_logs`. Forme et unicité EN BASE (`domains_sous_domaine_forme`, `domains_slug_key`). Écran : saisie, validation en ligne, aperçu de l'adresse, confirmation qui fait lire les conséquences ; messages dans les quatre langues ; après création, plus d'étape « déclarer chez l'hébergeur ». |
| 3. Une seule source | **fait** | Résolution, liens d'e-mail et sélecteur lisent la valeur réglée (prouvé, point 1). `diag-sous-domaine` : le motif de forme identique en base, dans les deux modules et dans la requête de staging (exécuté sur 17 cas) ; aucun nom d'écosystème dans le code, les messages, les documents légaux. `DEV_DOMAIN_SLUG` désigne un sous-domaine réglé ; le journal de `getDomainConfig` le dit quand un sous-domaine ne résout plus. |
| 4. Changer un sous-domaine | **documenté** | Ancienne adresse neutre sans redirection ; liens envoyés : inscription d'expert ou d'organisation refusée, compte d'invité créé (il lit l'organisation) ; sessions à rouvrir ; inscription en cours échouée ; Site URL de Supabase à mettre à jour si elle nomme l'ancienne adresse ; rien chez Vercel. Écran, §D.28, procédure étape 6. |
| 5. La migration | **faite** | `20260929000000_sous_domaine_reglable` (§G.2 : tronc `0xxxxx`, après la plus récente de toutes les branches et de tous les worktrees). Test `grand_livre/sous_domaine.test.sql` (12). Requête de staging : ⓪ inchangée (`domaines_adresse_reglables`), `prochain_push_cree` = la contrainte, ligne ⑭ = les sous-domaines existants hors forme (attendu 0 : sinon la migration s'arrêterait au milieu du push). `diag-requete-staging` suit désormais les CONTRAINTES (il ne voyait que fonctions, tables, index — il mord). |

**Checklist** : 0 (aucun nom d'écosystème dans le code, contrôlé) · 2 (l'écosystème résolu par le sous-domaine réglé,
test : l'ancien refusé, le nouveau résout) · 5 (forme et unicité en base ; l'écran ne fait que prévenir) · 12 (codes
stables, nouveaux codes nommés, aucun renommé) · 13-14 (messages actionnables, quatre langues, contrôlés) · 15 (V0 = la
prod : même route, même base, même règle).

**Migration nouvelle : `sous_domaine_reglable`.** ORDRE : AVANT le déploiement.

**Épreuve** (lot commité en `3033ec8` AVANT de muter) :
- `tsc --noEmit` : aucune erreur hors `.next/` · `next build` : **exit 0** · lint : **65 / 25**, le cliquet ne monte
  pas · parité i18n : **4021 clés** dans les quatre langues · série complète `diag.mjs` : **114 verts, 0 rouge, 5 muets**
  — les mêmes qu'à l'ARRÊT 14 (trois écartés parce qu'ils ÉCRIVENT en base ; `diag-supabase` et
  `diag-readonly-expert-achwek`, qui lisent la base et plantent sur une assertion libuv de Windows).
- Pendant la série, **`diag-admin-ecosystemes` a rougi à raison** : il gardait l'ANCIENNE décision (slug en lecture
  seule, étapes « hébergeur » et « CNAME »). Mis à jour sur la décision de Youssef — il garde maintenant « jamais
  parmi les champs ordinaires » et « plus d'étape hébergeur », pas « jamais ». **`diag-requete-staging` ne voyait
  pas les contraintes** : il les suit, et il a rougi sur la requête avant qu'elle décrive ce lot.
- **15 mutations, 15 rouges** : la contrainte à 64 caractères ; le résolveur qui accepte les majuscules ; l'écriture
  sans condition ; le 23505 non nommé ; d'autres champs acceptés avec le sous-domaine ; le slug replacé parmi les
  champs ordinaires ; la trace sans avant/après ; le champ refigé en lecture seule ; un refus sans message allemand ;
  « Skilloria 365 » revenu dans un message ; `skilloria365` en placeholder ; `microsoft` en dur dans la résolution ;
  la requête de staging sans la contrainte ; la requête avec un autre motif ; la liste blanche TS amputée. Arbre
  restauré, contrôles **reverts sur les fichiers restaurés en CRLF** (§E.3).
- **Ce qui n'a pas tourné, et qui est à Youssef** : les tests pgTAP (`db reset` + `test db --local`) — Docker et la base
  ne sont pas lancés ici ; le test `grand_livre/sous_domaine.test.sql` n'a donc **jamais été exécuté**.

### Les étapes de Youssef — dans cet ordre
**A. Le déploiement** (une migration : la séquence complète de §G.4 ter)
1. En local : `npx supabase db reset --local` (160 migrations), `npx supabase db lint -s public --level error` (sortie
   vide), `npx supabase test db --local` (un fichier neuf : `grand_livre/sous_domaine.test.sql`). §E.82 si « EUNKNOWN … uv_spawn ».
2. La requête de staging, collée dans l'éditeur SQL de staging : ⓪ `domaines_adresse_reglables`, **aucun ÉCART** — la
   ligne ⑭ doit dire 0 (sinon un sous-domaine existant n'est pas une étiquette DNS : arrête-toi, envoie-moi la ligne).
3. `npm run build`, puis `npx supabase db push`, puis `git push` aussitôt.

**B. Le sous-domaine passe à `skilloria365`**
1. Ouvre l'admin sur staging, **à l'adresse actuelle** : `https://microsoft.staging.skilloria.io/fr/admin/ecosystemes`.
2. Skilloria 365 → **Modifier** → section **Sous-domaine** → nouveau sous-domaine `skilloria365` → l'aperçu dit
   `https://skilloria365.staging.skilloria.io` → **Changer le sous-domaine** → lis les quatre conséquences → **Oui,
   changer le sous-domaine**. Le message confirme la nouvelle adresse.
3. Ton adresse actuelle ne sert plus l'écosystème : ouvre `https://skilloria365.staging.skilloria.io/fr` (couleurs de
   Skilloria 365) et **reconnecte-toi** ; `https://microsoft.staging.skilloria.io/fr` s'affiche désormais neutre.
4. Si tu utilises `DEV_DOMAIN_SLUG` en local, passe-la à `skilloria365` (sur la base de staging, pas de la tienne).

**C. Les réglages Auth de Supabase staging** — Authentication → URL Configuration :
1. **Site URL** : `https://skilloria365.staging.skilloria.io`
2. **Redirect URLs** (si elles n'y sont pas déjà) : `https://*.staging.skilloria.io/*/auth/callback` et
   `https://*.staging.skilloria.io/*/nouveau-mot-de-passe`.

**D. L'essai de l'inscription expert, sur `skilloria365.staging.skilloria.io`**
1. `https://skilloria365.staging.skilloria.io/fr` → « Créer un profil Expert » : branches et spécialités s'affichent.
2. Inscris un expert jusqu'au bout : le lien de l'e-mail commence par `https://skilloria365.staging.skilloria.io/` ;
   clique-le : tu reviens connecté.
3. `/admin/journal` : `compte_cree` et `expert_inscrit` sous une pièce ; et, plus haut, la ligne `ecosysteme_modifie`
   de l'étape B (opération `sous_domaine`, `microsoft` → `skilloria365`).
4. Si quelque chose manque : `https://skilloria365.staging.skilloria.io/api/taxonomy?locale=fr` dit le code ; envoie-le-moi.

## ⛔ ARRÊT 14 — STAGING SE COMPORTE EXACTEMENT COMME LA PRODUCTION : L'ÉCOSYSTÈME SE LIT DANS L'ADRESSE (29/09/2026)

Décision de Youssef sur l'ARRÊT 13 : **la cause est acceptée, le correctif ne l'est pas** — pas de `DEV_DOMAIN_SLUG`
sur la Preview. Tag local `sauvegarde-avant-staging-comme-prod` sur `df6f687`, posé avant tout (git status propre,
hormis `supabase/snippets/`, à Youssef, non touché). Détail : [pieges.md §E.83](pieges.md#e83) ;
l'infrastructure : [mise-en-production.md](mise-en-production.md), étape 6.

**Contradictions et limites, signalées plutôt que tranchées en silence :**
① **Une variable par environnement, mais pas un nom d'écosystème** : `NEXT_PUBLIC_DOMAINE_RACINE` porte la racine
(`skilloria.io`, `staging.skilloria.io`) — c'est « ce qui diffère se limite au domaine racine », dit par une variable.
Publique, parce que le sélecteur, dans le navigateur, applique la même règle.
② **Le cookie de session** (`lib/session-token.ts`) connaît encore `staging.skilloria.io` et `.skilloria.io` en
toutes lettres : il ne résout pas d'écosystème, il empêche une session de staging d'écraser celle de la production. Il
fonctionne tel quel sur `<écosystème>.staging.skilloria.io` (il en avait été écrit pour ça). Le dériver de la racine
changerait le nom du cookie de production — hors du mandat, **laissé et déclaré**.
③ **Deux variables gardent les e-mails en production** : `NEXT_PUBLIC_SITE_URL` (la garde existante de
`lib/site-url.ts`, que ce lot ne rouvre pas) et la racine, qui construit désormais les liens. Documenté ensemble.
④ **Sans la racine, un environnement déployé ne sert AUCUNE page** (le proxy lève en la nommant) : l'ordre des étapes
de Youssef compte — la variable avant le déploiement.
⑤ **Les adresses `…vercel.app` ne servent plus d'essai** : elles s'affichent neutres et l'inscription le dit. C'est
la décision même (« une adresse qui ne porte aucun écosystème ne résout rien »).
⑥ **NON VÉRIFIÉ dans la documentation Vercel** : qu'un domaine GÉNÉRIQUE se rattache à une branche de Preview (les
deux gestes y sont décrits séparément). Si l'écran le refuse : s'arrêter, la voie de repli est l'environnement
personnalisé (plan Pro), pas le déménagement des serveurs de noms.

| Point | État | Ce qui a été fait |
|---|---|---|
| 1. Une règle, une définition | **fait** | `lib/subdomain.ts` : `<écosystème>.<racine>`, un label ; `domaineRacine()` lit `NEXT_PUBLIC_DOMAINE_RACINE` et elle seule ; `adresseEcosysteme()` en est la réciproque. `lib/ecosystem-url.ts` : le sélecteur n'accepte qu'un hôte `<écosystème>.<racine>` et reste dans son environnement. Schéma de staging : `<écosystème>.staging.skilloria.io`. Aucune adresse d'environnement dans le code de la règle (contrôlé). |
| 2. Plus de `DEV_DOMAIN_SLUG` hors du poste local | **fait** | Lue dans la seule branche `localhost` (contrôlé : une lecture, dans cette branche). `…vercel.app`, la racine seule, deux labels → `null`, code `ecosysteme_non_resolu` ; racine absente → lève, `ecosysteme_non_configure` / `missing_env`. L'écran d'inscription dit, en quatre langues, d'ouvrir l'adresse de l'écosystème (`taxonomy_adresse_sans_ecosysteme`) au lieu de « rechargez ». |
| 3. Le reste du lot gardé | **fait** | Sélecteur, `visiteur.test.sql`, codes nommés, §E.82, requête d'avant-push et ligne ③ : inchangés. §E.83 réécrit (le correctif refusé et pourquoi, la règle). `diag-hotes-ecosysteme` réécrit : production, staging (`<écosystème>.staging.skilloria.io`), poste local, `DEV_DOMAIN_SLUG` posée partout pour prouver que rien de déployé ne la lit. `diag-selecteur-ecosysteme` : chaque cas éprouvé dans son environnement. |
| 4. Les liens des e-mails | **fait** | `expertSiteOrigin` → `https://<écosystème du destinataire>.<racine>` ; `null` (et l'e-mail ne part pas, journalisé `lien_sans_ecosysteme` / `domaine_racine_absent`) quand l'adresse ne se construit pas. Neuf appelants : notifications, approbation et refus d'un expert, approbation et refus d'une organisation, invitation d'équipe et sa relance, avertissement d'inactivité (une SIXIÈME issue écrite au grand livre, cause `lien_sans_ecosysteme` — le contrôle de `diag-grand-livre` en attend désormais six), invitation d'administrateur. La confirmation d'inscription est construite au serveur (`redirectionConfirmation`) ; seule la langue vient du navigateur. |
| 5. L'infrastructure | **documenté, rien touché** | Cinq voies comparées sur la documentation Vercel lue le 29/09/2026 ; **retenue : A** — `*.staging.skilloria.io` rattachée à Preview + la branche de test, certificat délégué par `_acme-challenge.staging`, **serveurs de noms inchangés** : trois enregistrements ajoutés sous `staging.`, **Resend non touché**. Écartées : serveurs de noms chez Vercel (toute la zone, e-mails compris, à recopier), projet dédié (staging y tournerait en `VERCEL_ENV=production` → verrou Stripe live), environnement personnalisé (plan Pro, `VERCEL_ENV` non documenté), suffixe de Preview (100 $/mois, et le label est le nom du déploiement : la panne de §E.83). Supabase : deux Redirect URLs génériques par environnement (`*` ne traverse ni `.` ni `/`). Répétition pour la production écrite. |

**Checklist** : 0 (tag, état propre) · 2 (l'écosystème réellement résolu : par l'hôte, une fonction) · 12 (codes stables :
`ecosysteme_non_resolu`, `ecosysteme_non_configure`, `ecosysteme_inconnu`, `ecosysteme_indisponible`,
`lien_sans_ecosysteme`, `domaine_racine_absent` — aucun renommé) · 13-14 (messages : le nouveau en quatre langues,
contrôlé sans « rechargez ») · 15 (V0 = la production : staging prend le même chemin de code, seule la racine diffère).

**Migrations nouvelles : AUCUNE.** Rien en base.

**Épreuve** (lot commité en `eaacac6` AVANT de muter) :
- `tsc --noEmit` : aucune erreur hors `.next/` · `next build` : **exit 0**, deux fois (avant et après les mutations) ·
  lint : **65 / 25**, le cliquet ne monte pas · parité i18n : **3996 clés** dans les quatre langues ·
  série complète `diag.mjs` : **113 verts, 0 rouge, 5 muets** — trois écartés parce qu'ils ÉCRIVENT en base, deux
  (`diag-supabase`, `diag-readonly-expert-achwek`) qui lisent la base et plantent sur une assertion libuv de Windows ;
  aucun des deux n'importe un fichier du lot. Pendant la série, `diag-grand-livre` a rougi à raison : l'avertissement
  d'inactivité avait gagné une issue ; elle a reçu sa propre cause, et le contrôle en attend six.
- **9 mutations, 9 rouges** (`diag-hotes-ecosysteme`) : le « premier label » d'origine ; `DEV_DOMAIN_SLUG` lue sur
  `.vercel.app` ; la racine absente rendue `null` au lieu de lever ; le sélecteur renvoyé en production ; les liens
  d'e-mail sur l'origine brute ; la confirmation sur l'adresse du navigateur ; le formulaire qui confond adresse et
  indisponibilité ; le message allemand qui redit « neu laden » ; une route d'organisation sur l'origine brute.
  Arbre restauré, et les contrôles **reverts sur les fichiers restaurés en CRLF** (§E.3). Limite dite :
  `diag-selecteur-ecosysteme` ne pose pas `VERCEL_ENV` — la mutation « sélecteur vers la production » ne l'a pas fait
  rougir, `diag-hotes-ecosysteme` si.

### Les étapes de Youssef — dans cet ordre
**A. L'infrastructure (une fois)** — le détail, écran par écran, est à l'étape 6 de `mise-en-production.md` :
1. Vercel → le projet → Settings → Domains → **Add Domain** : `*.staging.skilloria.io`. Puis **Edit** → Connect to an
   environment : **Preview**, Git Branch = la branche de test (`feat/sprint-archi-orga`, ou une branche `staging`
   durable). Si l'écran refuse un domaine générique sur une branche : **arrête-toi et dis-le-moi**.
2. Vercel → Domains de l'équipe → `skilloria.io` → **Enable Vercel DNS**, sans toucher aux serveurs de noms.
3. Chez l'hébergeur DNS actuel de `skilloria.io` : `NS _acme-challenge.staging` → `ns1.vercel-dns.com.` et
   `ns2.vercel-dns.com.` ; `CNAME *.staging` → la valeur que Vercel affiche. Rien d'autre ne change.
4. Vercel → Environment Variables : `NEXT_PUBLIC_DOMAINE_RACINE` = `staging.skilloria.io` sur **Preview** ;
   `NEXT_PUBLIC_DOMAINE_RACINE` = `skilloria.io` sur **Production** (sinon, le jour où `main` reçoit ce code, la
   production ne sert plus aucune page) ; **retire `DEV_DOMAIN_SLUG`** de Preview si tu l'y as posée.
5. Supabase **staging** → Authentication → URL Configuration : Site URL `https://<ton écosystème d'essai>.staging.skilloria.io` ;
   Redirect URLs `https://*.staging.skilloria.io/*/auth/callback` et `https://*.staging.skilloria.io/*/nouveau-mot-de-passe`.
6. Attends que Settings → Domains dise la configuration valide.

**B. Le déploiement** — ce lot n'a **pas de migration**, donc **pas de `db push`** :
1. en local, si tu veux rejouer : `npx supabase db reset --local` puis `npx supabase test db --local` (rien de neuf en
   base ; §E.82 si « EUNKNOWN … uv_spawn ») ;
2. la requête de staging : ⓪ `domaines_adresse_reglables`, aucun ÉCART ;
3. `npm run build`, puis `git push` : la branche de test se redéploie, avec la racine.

**C. Le nouvel essai de l'inscription expert, sur une adresse de staging** :
1. ouvre `https://<ton écosystème d'essai>.staging.skilloria.io/fr` : cadenas valide, **couleurs de l'écosystème** ;
   ouvre aussi `https://nexistepas.staging.skilloria.io/fr` : **gris neutre** (l'adresse est lue, pas devinée) ;
2. « Créer un profil Expert » : les branches et spécialités s'affichent ;
3. inscris un expert jusqu'au bout (téléphone, CGU) : l'e-mail de confirmation arrive, **son lien commence par
   `https://<ton écosystème d'essai>.staging.skilloria.io/`** ; clique-le : tu reviens connecté, sur staging ;
4. `/admin/journal` : deux lignes sous une pièce (`compte_cree`, `expert_inscrit`) ;
5. si quelque chose manque : `https://<écosystème>.staging.skilloria.io/api/taxonomy?locale=fr` dit le code
   (`ecosysteme_non_configure` = racine absente ou pas redéployée ; `ecosysteme_inconnu` = pas un écosystème actif) ;
   une page qui ne s'affiche pas du tout = racine absente, nommée dans les journaux Vercel. Envoie-moi ce que tu lis.

## ⛔ ARRÊT 13 — LE FORMULAIRE EXPERT SANS BRANCHES SUR LA PREVIEW : L'HÔTE NE PORTAIT PAS D'ÉCOSYSTÈME (29/09/2026)

> ⚠️ **REMPLACÉ PAR L'ARRÊT 14** pour le correctif (point 2) et les étapes 2 et 4 : **ne pose pas `DEV_DOMAIN_SLUG`
> sur la Preview.** La cause (point 1) et le reste restent vrais.

Tag local `sauvegarde-avant-taxonomie-inscription` sur `1c518a9`. Détail : [pieges.md §E.83](pieges.md#e83).

**LA CAUSE, lue dans le code (aucune migration en cause).** Le formulaire `app/[locale]/inscription/[role]/page.tsx`
(l. 65-77) appelle `/api/taxonomy` sans `domain_id`. La route (`app/api/taxonomy/route.ts`, l. 54-81 à `1c518a9`)
résolvait l'écosystème par `resolveSubdomainFromHost()` (`lib/subdomain.ts`, l. 53-55 à `1c518a9` : « premier
label d'un hôte d'au moins trois labels »). Sur la Preview, l'hôte est `<déploiement>.vercel.app` : le « slug » était
le nom du déploiement, aucun écosystème ne le porte → **400 `missing_domain_id`** → le message de l'écran. La route
lit en clé de service : ni les droits (`portes_laterales_fermees`), ni la fermeture de `taxonomie_inscription_refus`
(`journal_compte_cree`), ni `porte_inscription` n'entrent en jeu. Même défaut sur l'hôte unique `staging.skilloria.io`.
Et depuis `porte_inscription`, register-expert résout aussi par l'hôte : l'envoi aurait échoué pareil.
**Contradiction signalée** : le balayage demandé « au vrai rôle (anon) » — un seul écran public lit la base en
`anon` (`/api/countries`) ; toutes les autres lectures d'un visiteur passent par la clé de service. Le test les prouve
chacune au rôle qui la fait VRAIMENT.

| Point | État | Ce qui a été fait |
|---|---|---|
| 1. La cause | **prouvée par le code** | Ci-dessus. Une seule vérification en lecture seule, pour Youssef (étape 1 ci-dessous). |
| 2. Le correctif | **fait** | `lib/subdomain.ts` : `hoteSansEcosysteme` (localhost, Preview `*.vercel.app` hors production, `staging.skilloria.io`) reçoit `DEV_DOMAIN_SLUG`, lève en la nommant sinon ; en production `.vercel.app` rend null. `lib/ecosystem-url.ts` ne bascule plus depuis ces hôtes. `/api/taxonomy` résout par l'hôte seul (`ecosystemeDeLaRequete`, plus `x-subdomain`). Rien n'est ouvert de plus en base. |
| 3. Le balayage | **fait** | Accueil et pages publiques (getDomainConfig, traductions), inscription expert (taxonomie, règle), organisation et téléphone (`/api/countries` en ANON), invitation (resolve, inscription). `vrai_appelant/visiteur.test.sql` (12) : chaque lecture au rôle réel, et la règle d'inscription fermée à anon et authenticated. |
| 4. La panne dit sa cause | **fait** | `/api/taxonomy` : `ecosysteme_non_configure`, `ecosysteme_non_resolu`, `ecosysteme_inconnu`, `ecosysteme_indisponible`, `db_error` — chacun journalisé au serveur avec son code ; l'écran reste traduit. La page d'invitation n'écrit plus à la console du navigateur. |
| 5. Le piège et son contrôle | **fait** | §E.83 ; `diag-hotes-ecosysteme` (nouveau) exécute le résolveur sur une matrice hôtes × environnements. **Éprouvé par 8 mutations** (le défaut d'origine, l'alias deviné, la bascule depuis staging, x-subdomain, deux pannes muettes, la console, la ligne ③) ; la première « panne muette » est PASSÉE au travers — un motif qui traversait le fichier (§E.8) — et le contrôle lit désormais chaque `console.error` seul. |
| 6. Requête d'avant-push | **fait** | ⓪ `domaines_adresse_reglables` ; ce lot n'a AUCUNE migration : les deux listes sont vides. |
| 7. Ligne ③ | **fait** | Comparaison par identifiant (`to_regprocedure`), plus par texte ; `diag-requete-staging` F bis mord (§E.80, le cas du push 3). |
| 8. Smart App Control | **fait** | §E.82 ; rappel dans la séquence ci-dessous. |
| 9. Vercel « Production » | **documenté** | `mise-en-production.md` : `main` = Production, la version du 29 avril sur `skilloria-chi.vercel.app` ; recommandation A (branche de production dédiée) + C (protéger la Production actuelle). Rien n'est touché. |

**Migrations nouvelles : AUCUNE.** Le correctif est dans le code ; la base n'a rien à changer.

### Les étapes de Youssef
1. **La vérification, en lecture seule, sur la Preview ACTUELLE (`1c518a9`), avant tout déploiement** : ouvre dans ton
   navigateur `https://<adresse-de-la-preview>/api/taxonomy?locale=fr`. Attendu : `{"error":"domain_id required","code":"missing_domain_id"}`
   — c'est la cause prouvée. Si tu lis autre chose, arrête-toi et envoie-moi la réponse.
2. **Vercel → Settings → Environment Variables** : ajoute `DEV_DOMAIN_SLUG` = le slug d'un écosystème ACTIF de staging
   (celui de tes essais, par exemple `microsoft`), **sur l'environnement Preview seulement**. Une variable ne vaut
   qu'au déploiement suivant.
3. **La séquence** — ce lot n'a pas de migration, donc **pas de `db push`** :
   - en local : `npx supabase db reset --local` puis `npx supabase test db --local` (un fichier neuf :
     `vrai_appelant/visiteur.test.sql`). **Si `db reset` échoue sur « EUNKNOWN … uv_spawn »** : Sécurité Windows →
     Contrôle des applications et du navigateur → Paramètres du Contrôle intelligent des applications → **Désactivé**
     (§E.82), puis recommence ;
   - la requête de staging : ⓪ doit dire `domaines_adresse_reglables`, aucun ÉCART (la ligne ③ ne peut plus en donner à tort) ;
   - `npm run build`, puis `git push` : la Preview se redéploie, avec la variable.
4. **Le nouvel essai** : sur la Preview, « Créer un profil Expert » — les branches et spécialités s'affichent. Inscris
   un expert jusqu'au bout (téléphone, CGU) : l'e-mail de confirmation arrive, et `/admin/journal` montre deux
   lignes sous une pièce. Si le formulaire affiche encore le message, rouvre `/api/taxonomy?locale=fr` : le code dit
   pourquoi (`ecosysteme_non_configure` = variable absente ou pas redéployée ; `ecosysteme_inconnu` = ce slug n'est
   pas un écosystème actif) — et les journaux Vercel portent la même ligne.
5. **Avant la vraie bascule** : lis la section « Avant la vraie bascule » de `mise-en-production.md` (Vercel met `main`
   en production) — la décision est la tienne.

## ⛔ ARRÊT 12 — LA PORTE D'INSCRIPTION EST FERMÉE EN BASE (28/09/2026)

Décision de Youssef sur l'audit de l'ARRÊT 11 : **option (b)**, l'invité par une route serveur, l'organisation dans
la transaction du compte. Tag local `sauvegarde-avant-porte` posé sur `7aeffa3` avant tout. Détail : §D.27
d'[architecture.md](architecture.md#d27), piège §E.81.

**Contradictions signalées avant d'écrire, et tranchées ainsi (Youssef peut revenir sur chacune)** :
① l'**échéance** de la preuve vit dans le signataire (5 min) — exception nommée à « aucune valeur dans le code »,
comme le TTL OTP et §D.7 (§D.11 : un réglage technique ne s'affiche pas) ; ② le **mot de passe** reste une règle de
route (GoTrue le hache, la base ne le voit pas) ; ③ un **administrateur créé par un autre** n'a pas de consentement
aux CGU écrit (il n'a rien accepté) ; ④ GoTrue **avale l'erreur du trigger** : la route DEMANDE la règle avant de
créer (§E.81) ; ⑤ entre `db push` et déploiement, **toute inscription est refusée** (minutes).

| Point | État | Ce qui a été fait |
|---|---|---|
| 1. La preuve signée, vérifiée en base | **fait** | Migration `porte_inscription` : `preuve_inscription_canonique`, `_signature` (seul lecteur du secret, fermée à tous), `_refus` ; `handle_new_user` vérifie AVANT toute écriture — IN007 absente, IN008 altérée/autre adresse, IN009 expirée, IN011 secret absent. Signataire `lib/inscription/preuve.mjs`. Rotation par `inscription_hmac_secret_precedent` (§D.27). |
| 2. Tous les appelants | **fait** | register-expert, register-org, invité (route neuve), create-admin, le script du premier administrateur — et la recette 3.3 (elle promouvait par une écriture directe). |
| 3. L'invité au serveur | **fait** | `POST /api/invitations/inscription` : adresse de l'invitation, `email_confirm: true`, rôle et écosystème dérivés ; le trigger accepte l'invitation dans la transaction. La page n'appelle plus `auth.signUp` ; elle affiche « compte créé » et mène à la connexion. |
| 4. L'organisation avec son compte | **fait** | Le trigger appelle `creer_organisation_avec_admin` ; l'administrateur est promu dans la transaction. `atomicCleanup` et `lib/comptes/journal-inscription.ts` retirés. |
| 5. CGU et téléphone dans la transaction | **fait** | Expert, organisation, invité ; pas l'administrateur (③). |
| 6. Une règle, une définition | **fait** | `inscription_refus()` porte toutes les règles, la route la demande avant (codes stables, 37, messages en quatre langues) ; `numero_identification_refus()` en base, aussi pour la finalisation. Écosystème résolu depuis l'HÔTE. **Les listes de domaines réglables** : migration `domaines_adresse_reglables`, `regler_domaine_adresse()` (8ᵉ famille, AD002, retirer sans effacer), `/admin/domaines-adresse` (quatre langues, menu « Validation »), test `grand_livre/domaines_adresse.test.sql` (14). |
| 7. Tests pgTAP | **fait** | `inscription/porte.test.sql` (43) ; `compte_cree`, `roles`, `grand_livre/inscriptions`, `administrateur_cree`, `ecritures_effectives` réécrits ; fabriques signées. |
| 8. Le commentaire de la confirmation | **fait** | `generateLink` → `auth.signUp` sur un client anonyme serveur. |
| Déploiement | **préparé** | Requête de staging pour ce push unique : les listes = les TROIS migrations en attente (2 signatures retirées, 7 fonctions créées), ⑬ le secret au Vault par son nom, ⑦ pgcrypto, ⑧ les deux listes de domaines parmi les tables journalisées, ⑪ les colonnes de `handle_new_user` (27). |

**Vu en chemin** : un commentaire écrit par `node -e "…"` a été mutilé par le shell (les backticks exécutés, §G.9) —
vu en relisant le fichier, corrigé à l'outil d'édition avant le commit. La règle tient : un texte passe par un fichier.

### Les étapes de Youssef — AVANT le push, le secret ; puis le push ; puis l'essai
1. **Fabrique le secret** (une valeur pour staging ; la production aura la SIENNE) :
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — copie la valeur affichée.
2. **Le Vault de staging** : Supabase, projet staging → Project Settings → **Vault** → **New secret**. Name :
   `inscription_hmac_secret` (exactement). Secret : la valeur. Vérifie dans l'éditeur SQL :
   `select name, length(decrypted_secret) from vault.decrypted_secrets where name = 'inscription_hmac_secret';`
   → une ligne, longueur 64. Ne colle jamais la valeur dans une requête.
3. **Vercel** : Settings → Environment Variables → `INSCRIPTION_HMAC_SECRET` = **la même valeur**, sur
   l'environnement qui sert staging. Sans elle, les formulaires répondent « inscription momentanément indisponible ».
4. **Ton `.env.local`** : ajoute `INSCRIPTION_HMAC_SECRET=` la même valeur si tu lances le script du premier
   administrateur ou la recette contre staging. Pour l'appli EN LOCAL, le Vault local doit avoir le sien
   (`select vault.create_secret('<valeur>', 'inscription_hmac_secret');` dans la base locale). Les tests pgTAP, eux,
   posent leur propre secret dans leur transaction : rien à faire.
5. **La séquence de §G.4 ter** : la version de Postgres ; `db reset --local` ; `db lint` ; `test db --local` (les tests
   d'inscription sont réécrits, `inscription/porte.test.sql` et `grand_livre/domaines_adresse.test.sql` sont neufs) ;
   **la requête de staging** — ⓪ doit dire `journal_nettoyage`, ⑦ = 3 (pgcrypto), ⑬ = 1 (le secret), aucun ÉCART ;
   `npm run build` ; `db push` (**trois** migrations : `retrait_anciennes_signatures`, `porte_inscription`,
   `domaines_adresse_reglables`) ; **`git push` aussitôt** — entre les deux, toute inscription est refusée.
6. **Juste après** : ⓪ passe à `domaines_adresse_reglables`, les deux listes du `with` se vident — à faire faire
   par la session suivante (`diag-requete-staging` dit quand c'est juste).
7. **L'essai sur staging** : un expert freelance, un CDI, une organisation (e-mail de confirmation), une invitation
   (le compte est créé tout de suite, **sans e-mail** : l'invité se connecte directement), un administrateur par
   « Créer un administrateur ». Dans `/admin/journal`, chaque inscription montre DEUX lignes sous une pièce.
   Et `/admin/domaines-adresse` : ajoute un domaine bloqué, essaie une préinscription dessus, retire-le.
8. **Les durées du journal**, quand tu voudras nettoyer (inchangé).
9. **Une décision possible** : l'échéance de la preuve (5 min) est une constante nommée ; si tu veux qu'elle soit un
   réglage, c'est un petit lot.

## ⛔ ARRÊT 11 — LE MÉNAGE DU DÉPLOIEMENT EST FAIT ; L'AUDIT DE LA PORTE D'INSCRIPTION EST RENDU (28/09/2026)

**Le grand livre est en ligne sur staging** : les 17 migrations de la phase B appliquées, le code déployé (Youssef).
Tag local `sauvegarde-avant-menage` posé sur `90366d3` avant tout.

| Point | État | Ce qui a été fait |
|---|---|---|
| 1.1 Retrait des anciennes signatures | **fait** | Migration `retrait_anciennes_signatures` : `stripe_event_claim(text, text, jsonb, boolean)` et `admin_cron_run_now(text, uuid)` supprimées (APRÈS le déploiement — il est fait). L'exception de `une_signature.test.sql` retirée. `ecritures_effectives.test.sql` appelait encore `stripe_event_claim` → `stripe_event_reclamer` (il aurait cassé). **Défaut trouvé dans l'outil** : le rejeu des migrations tient les fonctions par nom, et un `drop` de l'ancienne surcharge y effaçait la NOUVELLE `admin_cron_run_now` — corrigé (le `drop` ne retire que la signature de la dernière définition ; carte identique avant/après sur les 156 migrations). `diag-billing-fondations` : l'ancienne est retirée et personne ne l'appelle, la remplaçante est révoquée au navigateur. |
| 1.2 La requête de staging | **fait** | Réécrite : 28 lignes → 13. **⓪ état** (dernière migration appliquée, par son nom : `journal_nettoyage` ; périmée sinon), **①–② prochain push** (deux listes en tête : les 2 signatures que 1.1 retire, rien de créé), **③–⑩ invariants** (aucune surcharge hors ce que le push retire, index unique du grand livre, index partiel des transactions, secrets du Vault, extensions, aucune politique d'écriture client sur une table journalisée, aucune politique sur `grand_livre`, aucun droit d'écriture du navigateur sur `grand_livre`). **⑪–⑫** gardées de l'ancienne (16, 18 : les colonnes de `handle_new_user`, tenues ÉGALES à ses insertions ; `speciality_id` absente — §E.73). Sorties : les lignes d'avant les pushs faits (6, 7, 8, 9, 11, 13, 15, 17, 19, 21–28), les volumes « à lire » (14, 20) et ① (doublons : l'index unique les interdit, ④ le vérifie). ⑩ ancienne aurait rougi AVANT ce push (l'ancienne surcharge y est attendue) ; la liste des tables de ⑫ avait perdu `grand_livre_conservation`, `matches`, `stripe_events`. **Garde** : `diag-requete-staging` (nouveau) et `diag-portes-laterales` (couverture de la liste) ; §E.80. **Rouge trouvé par la série à l'arrêt, après le commit** : la garde G de `diag-tests-grand-livre` exigeait que la requête commence par `select` — elle admet maintenant `with` (les mots d'écriture restent refusés partout : un `with … delete` rougit, éprouvé). |
| 1.3 Ce fichier | **fait** | En tête : « terminé et déployé », le prochain push (une migration en attente, la ⓪ à redéclarer ensuite), et les deux choses qui restent à Youssef. La section « les migrations n'ont jamais tourné » marquée historique. |
| Étape 2 — l'audit de la porte d'inscription | **rendu** | lecture seule — ci-dessous ; recommandation (b) ; arrêt |

### Étape 2 — LA PORTE D'INSCRIPTION : L'AUDIT (lecture seule). Rien n'est corrigé ; trois décisions à Youssef.

**Lu pour cet audit** : `handle_new_user` et `handle_email_confirmed` (dernières définitions), `lib/auth-signup.ts`,
`app/api/auth/public/register-expert/route.ts`, `app/api/auth/register-org/route.ts`, `app/[locale]/invitation/[token]/page.tsx`,
`lib/invitation-accept.ts`, `lib/admin/admin-invitation.ts`, `app/api/admin/create-admin/route.ts`, `lib/phone-otp-token.ts`,
`lib/matching/eligibilite.ts`, `supabase/config.toml` ; balayage de `cgu_accepted_at`, `phone_verified`, `auth.signUp`,
`admin.createUser`, `signInWithOtp`/`OAuth`/`Anonymously` dans `app/`, `lib/`, `components/`, `scripts/`.

**Le constat, mesuré dans le dépôt.**
1. **Quatre chemins créent un compte, tous par `handle_new_user`** : l'expert et l'organisation (route serveur,
   `auth.signUp` sur un client à clé PUBLIQUE — le seul qui envoie l'e-mail de confirmation, piège P1 de
   `lib/auth-signup.ts`) ; l'invité (`auth.signUp` **dans le navigateur**) ; l'administrateur (`admin.createUser`,
   route et script). **La route serveur et l'appel direct frappent donc le même point d'entrée** : fermer
   l'inscription publique de Supabase fermerait aussi les deux routes.
2. **Ce que la base vérifie** (`handle_new_user`) : rôle connu (IN001), écosystème présent et actif (IN002, IN003),
   rôle « Gratuit » (IN004), branche et spécialité pour un expert (IN005), voie et pièce cohérentes **si elles sont
   données** (IN006). **Ce qu'elle ne vérifie pas** : téléphone vérifié et unique, CGU acceptées, formats (noms,
   longueur de `speciality_other`), domaines d'adresse refusés ou publics, unicité du domaine d'e-mail et du
   SIREN, création de l'organisation. Un appel direct avec `role: 'entreprise'` crée un client **sans organisation**.
3. **Après confirmation de l'adresse, le compte est actif** (`handle_email_confirmed` : `draft` → `active`), et
   **aucune garde** ne lit `cgu_accepted_at` ni `phone_verified` (écrits par les deux routes seulement).
4. **Ce qui borne le dommage** : être mis en relation et déposer une candidature exigent `verification_status =
   'approved'` (`lib/matching/eligibilite.ts`, §D.20/§D.21) — une vérification humaine. Reste possible sans elle :
   téléverser un CV (dépense IA, quota par compte — multiplié par le nombre de comptes), demander une
   vérification (bruit pour l'administration), faire partir des e-mails de confirmation vers n'importe quelle
   adresse, un compte par personne sans le téléphone qui les distingue.
5. **Trouvé en chemin, indépendant de la porte — point 10 de la checklist** : **le consentement aux CGU d'un
   invité n'est enregistré nulle part.** La case est vérifiée dans le navigateur seulement ; ni l'inscription de
   l'invité ni l'acceptation n'écrivent `cgu_accepted_at` / `cgu_version`.
6. **NON VÉRIFIÉ** : les réglages d'authentification de staging (confirmation d'adresse exigée, inscription
   ouverte, fournisseurs OAuth, connexion anonyme, limites de débit) vivent dans le tableau de bord ; `config.toml`
   n'a aucune section `[auth]`. Ils se lisent sans écrire, en public : `GET <url>/auth/v1/settings`.
7. Commentaire faux, sans effet : `inscription/organisation/confirmation/page.tsx` dit l'e-mail « déclenché par
   `generateLink` » — c'est `auth.signUp` (P1).

**LES OPTIONS**

| | (a) Fermer l'inscription publique, tout créer au serveur | (b) La règle dans la base : une PREUVE signée par le serveur | (c) Le crochet Supabase « avant création » |
|---|---|---|---|
| **Le mécanisme** | Réglage « Allow new users to sign up » coupé ; les routes créent par `admin.createUser` puis `admin.generateLink`, et envoient elles-mêmes la confirmation (Resend). L'invité passe par une route serveur. | Après TOUTES ses vérifications, la route signe un jeton (HMAC-SHA256 sur l'e-mail, le rôle, l'écosystème, la voie, la pièce, la taxonomie, le téléphone, la version des CGU, l'échéance) ; `handle_new_user` le vérifie (`pgcrypto`, secret au Vault comme `cron_secret`) et refuse sinon — même mécanisme que IN001–IN006, déjà prouvé : le compte n'est pas créé, aucun e-mail ne part. | La même vérification, dans une fonction branchée comme « Before User Created » dans le tableau de bord. |
| **Pour l'utilisateur** | Formulaires inchangés. **L'e-mail de confirmation devient le nôtre**, dans sa langue (quatre langues à écrire). Invité : sa route peut le confirmer d'office (le lien reçu prouve l'adresse) — un e-mail de moins, à décider. | **Rien ne change** pour l'expert et l'organisation ; l'e-mail de Supabase reste. Invité : l'inscription passe par une route serveur (qui enregistre enfin ses CGU). | Comme (b). |
| **Ce que ça ferme** | Toute la surface de création publique d'Auth (inscription, OTP qui crée, premier OAuth, anonyme). | **Toute création de `auth.users` sans preuve du serveur** — inscription publique, OTP, OAuth, anonyme, et même un `admin.createUser` d'un chemin serveur qui aurait oublié de signer. Et le jeton permet d'écrire téléphone, CGU (et, si on le veut, l'organisation) **dans la même transaction** que le compte — là où c'est aujourd'hui un second `update` rattrapé par `atomicCleanup`. | Comme (b). |
| **Ce que ça ne ferme pas** | Rien de ce qui passe par la clé de service. La règle reste dans la route seule. | L'appel direct reçoit toujours une réponse (refus « Database error saving new user ») : des tentatives, pas de compte. | Idem. |
| **Coût et risque** | Un réglage **posé à la main** par environnement, hors dépôt (§E.10) — à garder par un contrôle qui lit `/auth/v1/settings`. Réécriture de `lib/auth-signup.ts`, un modèle d'e-mail en quatre langues, la route de l'invité. **Non mesuré** : que `generateLink` accepte de créer un compte quand l'inscription est coupée. Aucun test pgTAP possible (c'est de la configuration GoTrue). | Une migration, `lib/jeton-inscription.ts`, cinq appelants (deux routes, la route de l'invité à créer, la création d'administrateur, le script), la fabrique des tests pgTAP (chaque test crée ses comptes par `handle_new_user` : elle signera avec un secret de test posé dans la transaction), des tests (jeton forgé, expiré, pour une autre adresse : refusés), les erreurs de l'invité en quatre langues. **Un secret en deux copies** (Vercel et Vault de chaque base) à changer ensemble, comme `cron_secret` ; la requête de staging le compte par son nom. L'échéance du jeton est un réglage (aucune valeur dans le code). **NON VÉRIFIÉ** : `pgcrypto` présent sur staging (Supabase l'installe dans `extensions` par défaut) — une ligne de la requête de staging le dira. | Réglage hors dépôt (§E.10), disponibilité **NON VÉRIFIÉE**, et rien qu'un trigger ne fasse déjà. |

**MA RECOMMANDATION : (b)**, avec la route serveur de l'invité **dans le même lot**. C'est la sécurité **en base**
(point 5) : versionnée, rejouée, testée, indépendante d'un réglage qu'on peut rebasculer d'un clic ; elle ferme
aussi les chemins serveur qui oublieraient une vérification ; elle ne touche ni aux formulaires ni à l'e-mail de
confirmation ; et elle ferme le trou des CGU de l'invité (point 10) en écrivant le consentement dans la même
transaction que le compte. **(a) pas maintenant** : elle remplace l'e-mail de Supabase par le nôtre sur la foi d'un
comportement de `generateLink` non mesuré, et repose sur un réglage hors dépôt ; son seul gain sur (b) — que les
tentatives refusées n'atteignent pas la base — ne vaut ce prix que si les tentatives deviennent un volume.
**(c) non** : (b) sans le versionnement.

**Les trois décisions de Youssef, avant tout code :**
1. **L'option** — (b) recommandée.
2. **L'invité** : son adresse est-elle confirmée d'office par sa route (le lien d'invitation prouve la boîte),
   ou reçoit-il encore l'e-mail de confirmation ?
3. **L'organisation** : sa création entre-t-elle dans la transaction du compte (plus d'organisation orpheline
   ni de nettoyage), ou reste-t-elle dans la route ?


### Les étapes de Youssef
1. **Au prochain push** (une seule migration : `retrait_anciennes_signatures`), la séquence de §G.4 ter : la version
   de Postgres, `db reset --local`, `db lint`, `test db --local` (`une_signature` n'a plus d'exception), **la requête
   de staging — sa ligne ⓪ doit dire `journal_nettoyage`, aucun ÉCART** —, `npm run build`, `db push`, puis le
   déploiement aussitôt.
2. **Juste après ce push** : la ligne ⓪ doit passer à `retrait_anciennes_signatures` et les deux listes se vider —
   à faire faire par la session suivante ; `diag-requete-staging` dit quand c'est juste.
3. **L'essai d'inscription sur staging** : un expert freelance, un expert CDI, une organisation, une invitation
   acceptée, et un lien de confirmation expiré — chacun avec sa ligne au grand livre.
4. **Les durées, quand tu voudras nettoyer** : Administration → Grand livre → « Conservation et nettoyage ».
5. **Trancher les trois décisions de la porte d'inscription** ci-dessus (l'option, l'invité, l'organisation).

## ⛔ ARRÊT 10 — LE REJEU LOCAL : 39 FICHIERS, 352 TESTS, 3 ÉCHECS — CORRIGÉS (28/09/2026)

On s'est arrêté AVANT le déploiement. Les trois échecs du rejeu de Youssef :

| Échec | Cause | Correction |
|---|---|---|
| `evenement_stripe_rouvert`, test 3 « le motif n'est PAS au grand livre » | **Le TEST avait tort — prouvé.** Il cherchait « sonde » dans tout le détail ; l'identifiant FABRIQUÉ de l'événement vaut `evt_sonde_…` et figure légitimement au détail (`stripe_event_id`). Le produit ne construit que quatre clés (`stripe_event_id`, `type_evenement`, `recu_le`, `organization_id` — `rouvrir_evenement_stripe`, migration `journal_evenement_stripe_rouvert`) ; la liste blanche n'a pas de `motif` ; le motif ne va qu'à `stripe_events.error` et à l'audit | Le test prouve désormais sans ambiguïté : un marqueur qui n'existe que dans le motif (`MOTIF-LIBRE-7Q3Z`), absent du détail ; le jeu EXACT des quatre clés ; et la base REFUSE une clé `motif` (GL004). Plan 7 → 8 |
| `tache_lancee_a_la_main` : « permission denied for table job » | Le test désactivait sa tâche par `update cron.job` : pas même `postgres` n'écrit `cron.job` | `cron.alter_job(jobid, active := false)`, comme le produit. **La classe balayée** (SQL et TypeScript) : AUCUNE écriture directe dans le produit — `admin_cron_set_active` et `admin_cron_set_schedule` passent par `cron.alter_job`, `admin_cron_run_now` rejoue sans écrire `cron.job`. **Chaque geste de l'écran est prouvé** : `supabase/tests/database/taches_planifiees/gestes.test.sql` (12 : voir, suspendre, réactiver, tâche inconnue, replanifier, horaire refusé sans effet, suggérer, lancer, historique, fermeture). **Garde** : `diag-cron-supervision` section C (migrations, tests, `app/`, `lib/`), éprouvée par mutation. **§E.79** |
| `une_signature` : `admin_cron_run_now` a deux signatures | Voulu (§E.72) mais l'exception n'était pas écrite | Exception écrite dans le test, avec sa raison : l'ancienne `(text, uuid)` est appelée par le code en ligne jusqu'au déploiement de la phase B, **retirée par la migration du déploiement suivant** — alors la ligne rougit (« plus une surcharge ») et se retire |

**Lu pour cet arrêt** : les trois tests ; `rouvrir_evenement_stripe` ; `journaliser` (pas de retrait des nulls) ;
`admin_cron_set_active`, `admin_cron_set_schedule`, `cron_build_schedule`, `admin_cron_chain_violations`,
`admin_cron_jobs_overview`, `admin_cron_job_runs` (dernières définitions) ; les routes `cron-jobs/*` (appels RPC) ;
`diag-cron-supervision` section C.

### Les étapes de Youssef
1. **Relancer les tests en local** : `npx supabase db reset --local` puis `npx supabase test db --local`. Les trois
   échecs doivent être partis ; un fichier de test de plus (`taches_planifiees/gestes.test.sql`).
2. **Si tout est vert** : la suite de l'ARRÊT 9 — la requête de staging (aucun ÉCART), `npm run build`,
   `npx supabase db push`, puis le déploiement aussitôt.
3. **Dans l'administration, Grand livre, en bas** : saisir le plancher légal et la conservation de chaque famille.
4. **Avant toute démonstration** : l'inscription d'un expert sur staging (freelance et CDI), et un lien de
   confirmation expiré.
5. **Au déploiement suivant** : la migration qui retire `stripe_event_claim` et l'ancienne `admin_cron_run_now` —
   et, dans le même commit, la ligne d'exception de `une_signature.test.sql`.

## ⛔ ARRÊT 9 — PLANCHERS : TOUT EST PARAMÉTRABLE ; LES TROIS POINTS DE LA RELECTURE (28/09/2026)

**La décision de Youssef** : « Tout est paramétrable. AUCUNE valeur dans le code ni dans une migration. » La
conservation ET le plancher légal se **saisissent dans l'administration**, famille par famille ; ils **naissent vides** ;
une valeur vide interdit le nettoyage de sa famille. Sous chaque famille, l'écran affiche **en aide** la référence
légale de la proposition de l'ARRÊT 8 — du texte, rien de pré-rempli. Tout changement s'écrit (`reglage_modifie`).

| Point | Ce qui est fait | Commit |
|---|---|---|
| Planchers saisis | `journal_nettoyage` corrigée EN PLACE (jamais appliquée) : `regler_conservation_journal(pièce, acteur, famille, conservation, plancher)` règle les deux en un geste ; refus `plancher_manquant` (une conservation sans plancher), `sous_le_plancher`, `journal_conserve`, `famille_inconnue` ; `reglage_modifie` porte `avant/apres.plancher_mois` (113 chemins) ; raisons de l'annonce `plancher_non_saisi`, `conservation_non_saisie`. Route `PATCH /api/admin/journal/conservation` { famille, conservation_mois, plancher_mois } ; écran : deux champs vides par famille, la référence en aide (FR/EN/ES/DE, 3927 clés). **Garde** : `diag-grand-livre` rougit si une migration pose une valeur (affectation non issue d'un paramètre, insertion, défaut) — éprouvée par deux mutations (UPDATE, INSERT). Test `nettoyage.test.sql` (19) : tout naît vide, les refus, le plancher seul, puis la conservation, chaque changement journalisé avec les deux valeurs | `f04edc9` |
| Pièce complète | **Déjà fait en 2.6, montré ici** : `lire_piece()` (`supabase/migrations/20260928000170_journal_lecture.sql`) rend toutes les lignes de la pièce ET les lignes des cinq sous-journaux qui la portent ; l'écran `app/[locale]/admin/journal/[piece]/page.tsx` les affiche (section « Journaux détaillés »). Le test n'en éprouvait qu'un (l'audit) : **étendu aux cinq** (`lecture.test.sql`, 13) | `d9b0aa1` |
| Rejeu d'un dépôt | **Le code existait, le test manquait.** `app/api/admin/depots-en-echec/route.ts` ligne 254 : `contexteDepuisAuth(auth, estPiece(ligne.piece) ? ligne.piece : null)` — pièce NEUVE, `piece_origine` vers la tentative rejouée, passée à `ouvrir_depot_candidature()` et `inserer_candidature_jugee()`. **Test nouveau** `grand_livre/rejeu_depot.test.sql` (6) : la ligne du rejeu porte la pièce neuve et `piece_origine`, la tentative d'origine garde sa ligne, `lire_piece` montre « reprise par » et la pièce d'origine | `d9b0aa1` |
| architecture.md | **§C.20 remis au présent** : pourquoi pas de trigger d'écriture ET l'exception `handle_new_user` ; pourquoi pas de partitionnement maintenant (index date en tête, l'écran s'y appuie, le nettoyage livré) ; comment la pièce traverse pg_cron (`trigger_purge_cron`, corps HTTP, guichet, réglage de transaction du lancement manuel — c'était écrit au futur) et `after()` ; où et comment le rejeu est prouvé | `d9b0aa1` |

**Validations** : `tsc` 0 ; `next build` **vert en entier** (le fichier généré périmé de l'ARRÊT 8 a disparu) ; lint
65/25 ; parité 3927 clés ; cliquet des migrations vert ; série `diag` **110 verts / 0 rouge / 5 muets** (les mêmes).
Aucun `git push`, aucune écriture en base. **Lu pour cet arrêt** : §C.20 d'architecture ; `depots-en-echec/route.ts` ;
`ouvrir_depot_candidature` ; les tests `candidature_deposee`, `refus_depot_sans_jugement`, `lecture`, `nettoyage` ; les
colonnes obligatoires des cinq sous-journaux (`supabase/.temp/schema.sql`).

### Les étapes de Youssef
1. **Rejouer en local** : `node scripts/verifier-version-postgres.mjs`, `npx supabase db reset --local`,
   `npx supabase db lint -s public --level error`, `npx supabase test db --local`. Rien de ce lot n'a encore tourné
   sur une base : les 17 migrations, les 12 fichiers de test nouveaux, les tests étendus.
2. **Staging** : coller `supabase/verifications/staging-avant-push.sql` — aucune ligne ÉCART.
3. `npm run build`, puis `npx supabase db push`, puis le déploiement **aussitôt**.
4. **Dans l'administration, Grand livre, en bas** : saisir, famille par famille, le plancher légal et la
   conservation. Tant que les deux ne sont pas saisis, la famille ne s'efface pas. La référence sous chaque famille
   est une aide, pas une valeur — à faire relire par un juriste.
5. **Avant toute démonstration** : l'essai d'inscription d'un expert sur staging, freelance et CDI, e-mail de
   confirmation compris ; et un lien de confirmation expiré, pour voir le message.
6. **Au déploiement suivant** : la migration qui supprime les deux anciennes signatures (`stripe_event_claim`,
   `admin_cron_run_now(text, uuid)`).

## ⛔ ARRÊT 8 — PHASE B, ÉTAPE 2 FAITE (28/09/2026). ARRÊT AUX PLANCHERS LÉGAUX.

**Les planchers légaux sont la décision de Youssef.** Tout le reste est construit ; tant qu'ils ne sont pas écrits
(par migration), **rien ne s'efface** : chaque famille reste « à arbitrer » et l'écran le dit.

**Le décompte (2.8).** **71 actions**, chacune **exactement un écrivain** — contrôlé (`diag-grand-livre` : « ni deux »
et, désormais STRICT, « ni zéro ») :
56 (au départ) + **7 gestes** (`expert_inscrit`, `organisation_preinscrite`, `administrateur_cree`, `annonce_creee`,
`mission_ecartee`, `evenement_stripe_rouvert`, `tache_lancee_a_la_main`) + **1 séparée par la règle du nom**
(`sous_traitance_creee`, comme la publication — non prévue au mandat, dite) + **1 de la décision A** (`compte_cree`) +
**6 rattachements** (`taxonomie_modifiee`, `ecosysteme_cree`, `ecosysteme_modifie`, `organisation_modifiee`,
`identite_modifiee`, `cv_reinitialise`). `journal_nettoye` a désormais son écrivain (`nettoyer_journal`).
**Routes** : 65 écrivent, **58 laissent une ligne**, **7 exclues nommément** avec leur raison (`diag-routes-tracees`).
**Tests** : 60 fonctions appelées par 32 tests de `grand_livre/` (276 assertions) + `inscription/compte_cree` (22) ;
49 actions testées en SQL, 22 au gel (écrites en TypeScript, forme tenue par C bis).

**Migrations nouvelles (17, toutes AVANT le déploiement, aucune appliquée n'est touchée)** : `journal_compte_cree`,
`journal_expert_inscrit`, `journal_organisation_preinscrite`, `journal_administrateur_cree`, `journal_annonce_creee`,
`journal_mission_ecartee`, `journal_evenement_stripe_rouvert`, `journal_tache_lancee_a_la_main`,
`journal_taxonomie_modifiee`, `journal_ecosysteme_cree`, `journal_ecosysteme_modifie`, `journal_organisation_modifiee`,
`journal_identite_modifiee`, `journal_cv_reinitialise`, `piece_sous_journaux`, `journal_lecture`, `journal_nettoyage`
(`20260928000020` → `…000180`). La décision B (la route supprimée) n'a pas de migration. Rien n'a tourné sur une base.

**Validations** : `tsc` 0 hors `.next/` ; `next build` : **compilé** (« Compiled successfully »), la vérification de
types bute sur UN fichier généré périmé, `.next/dev/types/validator.ts`, qui cite la route supprimée (décision B) —
filtré (`.next/`) ; sa suppression m'a été refusée, elle est l'étape 0 ci-dessous. Lint **65/25** (cliquet vert) ;
parité **3915 clés** ; cliquet des migrations vert ; série `diag` **110 verts / 0 rouge / 5 muets** (les mêmes cinq).

**Ce qui a été lu** : `handle_new_user` (`inscription_specialites`), `handle_email_confirmed` et `trigger_purge_cron`
(`ecritures_effectives`), `admin_cron_run_now` (`cron_manual_run`), `stripe_event_claim` (`stripe_fondations`),
`journaliser_reglage` (`journal_reglages`), `journaliser` et `exiger_ecriture` (`liste_blanche_par_action`) ; les routes
`register-expert`, `register-org`, `create-admin`, `publications` POST, `dismiss`, `facturation` POST,
`cron-jobs/[name]/run`, les six de la taxonomie, les trois des écosystèmes, `me/organisation` (+ logo), `me/identity`,
`profile/cv/reset`, `stripe/webhook`, les cinq tâches `cron/*` ; `lib/auth-signup`, `lib/audit`, `lib/ai-budget`,
`lib/cron/verdict-de-run`, `lib/matching/shared` ; `scripts/creer-premier-administrateur.mjs` ; l'écran
`/admin/consommation`, `/auth/callback`, les primitives `PageHeader`, `EmptyState`, `StatusPill`, `MasterDetail`,
`GlobalBackButton`, `lib/nav-config` ; les contrôles `diag-grand-livre`, `diag-tests-grand-livre`,
`diag-postconditions-structure`, `diag-ecritures-effectives`, `diag-admin-create`, `diag-billing-socle`,
`diag-billing-fondations`, `diag-cron-supervision` ; `docs/pieges.md` §E.77 ; le schéma (`supabase/.temp/schema.sql`).

**Ce que les routes d'inscription vérifient et que `handle_new_user` ne vérifie pas** — donc ce qu'un appel DIRECT à
l'API d'authentification (clé publique) contourne aujourd'hui : **le téléphone vérifié par OTP** (barrière anti-multicompte,
unicité) ; **l'acceptation des CGU** (horodatage, version) ; **la spécialité ou sa précision « Autre » OBLIGATOIRE**
(le trigger admet un expert sans aucune) ; le format du slug, de l'adresse, du nom, du mot de passe ; **les domaines
d'adresse bloqués ou publics** et l'unicité du domaine et de l'identifiant d'entreprise (organisation) ; **la naissance
de l'organisation** elle-même (un compte `client`/`cabinet` direct naît sans organisation). Ce que le trigger vérifie
désormais : rôle, écosystème actif, rôle Gratuit, taxonomie (règle UNIQUE), voie et pièce (IN006). **La trace, elle,
ne se contourne plus** : un compte né par appel direct a sa ligne `compte_cree` (origine système, voie nulle) et
AUCUNE ligne sœur sous sa pièce — c'est ce qui le signale.

**DETTES NOMMÉES (§E.72)** : `stripe_event_claim(text, text, jsonb, boolean)` et `admin_cron_run_now(text, uuid)` sont
appelées par le code EN LIGNE — gardées, à supprimer par une migration du déploiement SUIVANT (la requête de staging
㉘ les attend présentes). **Limites dites** : `expert-relance` et `match-retry` gardent une pièce par élément ; un audit
hors de tout contexte de journal reste sans pièce ; `diag-routes-tracees` juge le fichier, pas la méthode.

### Les planchers légaux — PROPOSITION (⚠️ REMPLACÉ par l'ARRÊT 9 : rien ne s'écrit par migration, tout se saisit dans l'administration ; ces références sont devenues l'aide de l'écran)

Un plancher porte sur l'**âge de la ligne** (date de l'écriture). Une obligation qui court « à compter de la fermeture
du compte » ne se traduit donc pas exactement : le plancher proposé la couvre largement.

| Famille | Plancher proposé | Source |
|---|---|---|
| `commerce` (paiements, plafonds, événement rouvert) | **120 mois** | Code de commerce, **art. L123-22** : documents comptables et pièces justificatives conservés **dix ans**. (Le LPF, art. L102 B, dit six ans : le plus long l'emporte.) |
| `compte` (création, inscription, validation, suspension, e-mail, mot de passe…) | **60 mois** (minimum légal strict : 12 mois) | Minimum : **décret n° 2021-1362** (LCEN, art. 6-II) — les données fournies à la création d'un compte sont conservées **un an** après sa fermeture. Proposé : **Code civil, art. 2224** — prescription de **cinq ans** des actions personnelles : la preuve de la relation (CGU acceptées, validations) doit survivre au délai d'action. |
| `organisation` (préinscription, membres, fiche) | **60 mois** | Code civil, art. 2224 (relation contractuelle avec l'organisation). |
| `rgpd` (purges, avertissements, IP effacées) | **60 mois** | RGPD, art. 5.2 (principe de responsabilité : prouver qu'on a effacé) + Code civil art. 2224 pour la durée — **aucun texte ne fixe ce chiffre** : c'est une prudence, dite comme telle. |
| `administration`, `refus` | **12 mois** | **CNIL, délibération n° 2021-122** (recommandation sur la journalisation) : **six mois à un an**, davantage si justifié. Les réglages d'argent (tarifs, offres) passent par `reglage_modifie` : si Youssef les veut sous la règle commerciale, 120 mois. |
| `annonce`, `profil`, `recherche`, `candidature`, `devoilement`, `messagerie` | **0** (aucun plancher légal) | Aucune obligation de conservation trouvée pour ces traces (identifiants seulement). À noter pour `candidature` : l'action en discrimination se prescrit par cinq ans (Code du travail, art. L1134-5) — si Youssef veut pouvoir répondre d'une sélection, 60 mois. |
| `journal` | **sans objet** | Jamais nettoyée (contrainte) : ce sont les traces des nettoyages. |

**Pour appliquer la décision** : une migration (tronc, `0xxxxx`, strictement après `20260928000180`) qui pose
`update public.grand_livre_conservation set plancher_mois = … where famille = …` — puis l'administrateur règle la
conservation de chaque famille depuis `/admin/journal` (journalisé `reglage_modifie`), au-dessus du plancher.

### Les étapes de Youssef, dans l'ordre

0. **Supprimer le fichier généré périmé** `.next/dev/types/validator.ts` (ou relancer `npm run dev` une fois, qui le
   régénère) — il cite la route `DELETE /api/profile/cv` supprimée ; `next build` s'arrête sinon à la vérification de types.
1. **Arbitrer les planchers** (tableau ci-dessus) : me dire les chiffres, j'écris la migration.
2. **Rejouer en local** : `node scripts/verifier-version-postgres.mjs`, puis `npx supabase db reset --local`,
   `npx supabase db lint -s public --level error`, `npx supabase test db --local` — les 17 migrations nouvelles,
   les 11 fichiers de test nouveaux et la fabrique `fab_admin` changée n'ont JAMAIS tourné (§E.70).
3. **Requête de staging** (`supabase/verifications/staging-avant-push.sql`) : aucune ligne ÉCART (㉔–㉘ ajoutées).
4. `npm run build`, puis `npx supabase db push` (il reprend à `journal_annonce_publiee`, les 29 du lot S puis les 17 de
   la phase B), **puis le déploiement dans la foulée** (§E.72).
5. **À faire avant toute démonstration** (reporté) : l'essai d'inscription d'un expert sur staging, freelance ET CDI, de
   bout en bout — e-mail de confirmation compris ; et, au passage, un lien de confirmation expiré pour voir le message.
6. **Au déploiement suivant** : la migration qui supprime les deux anciennes signatures (dettes nommées).

## ▶ PHASE B, ÉTAPE 2 — DÉCISIONS DE YOUSSEF SUR L'AUDIT (28/09/2026)

**A.** Le compte d'un membre invité se journalise — **pas** en déplaçant la page côté serveur (un appel direct à
l'API d'authentification avec la clé publique resterait sans trace) : le **seul passage obligé de toute création de
compte est `handle_new_user`**, c'est donc lui qui écrit la ligne, par `journaliser()`, dans la même transaction.
Pièce lue dans les métadonnées de l'inscription quand l'appelant l'y met, sinon née dans la fonction (l'origine le dit).
Exception écrite dans `docs/architecture.md`. Un test pgTAP par voie, appel direct sans pièce compris.
**B.** `DELETE /api/profile/cv` est **supprimée**. **SIGNUP** : `auth.signUp` gardé. Le reste de l'audit est accepté
(`ecosysteme_cree` séparée ; une fonction SQL unique pour la règle branche/spécialité).

| Point | État | Commit |
|---|---|---|
| B route morte supprimée — aucun appelant (`app/`, `lib/`, `components/`, `hooks/`, `context/`, `scripts/` : relu), aucun contrôle ne la réclame (`mesure-routes-sans-trace` la listait parmi les « sans trace » ; aucun inventaire ne la nomme) ; `docs/api.md` : section barrée, renvoi vers `cv/reset` | fait | `fe2d406` |
| A `compte_cree` — migration `journal_compte_cree` : `handle_new_user` recréée, écrit sa ligne par `journaliser()` ; **une action, la voie DÉCLARÉE en détail** (la règle du nom : le trigger ne sait pas par quelle voie un compte arrive, les métadonnées sont écrites par l'appelant) ; pièce des métadonnées (origine `utilisateur`, acteur le compte ; voie `administrateur` : `systeme`, sans acteur) ou née dans la fonction (`systeme`) ; **IN006** voie inconnue/incohérente ou pièce illisible ; **`taxonomie_inscription_refus`** : la règle branche/spécialité une fois, appelée par le trigger ET `register-expert` (la copie de la route est retirée). Pièce + voie posées par `register-expert`, `register-org`, `create-admin`, `creer-premier-administrateur.mjs`, `/invitation/[token]`. Test `inscription/compte_cree.test.sql` (22 : sept voies — freelance, CDI, client, cabinet, ESN, invité, administrateur —, deux appels directs, IN006 ×4, IN005 annule la ligne, taxonomie ×4). Exception écrite en `architecture.md` §D.26 | fait, non exécuté | `434ace8` |
| 2.1 `expert_inscrit` — la ligne de `register-expert` sous la pièce de `compte_cree` : réussie DANS le `try` (un journal qui refuse fait nettoyer le compte : pas de compte finalisé sans sa ligne), échouée APRÈS `atomicCleanup` (`cause` = code, `compte_nettoye`). Un échec AVANT la création (validation, OTP, adresse prise) n'écrit rien : rien n'a changé, la route rend son code. Écrivain `lib/comptes/journal-inscription.ts` ; preuves D ter (réussie, échouée) + SQL `handle_new_user` (compte_cree) ; test `grand_livre/inscriptions.test.sql` (freelance, CDI, échec, GL004, GL005) | fait, non exécuté | `c1470c3` |
| 2.1 `organisation_preinscrite` — la ligne de `register-org` sous la pièce de `compte_cree` : réussie DANS le `try` après la naissance de l'organisation (sujet l'organisation, `org_type`, `domaine_public`), échouée APRÈS `atomicCleanup` (sujet le compte, `cause`, `organisation_nettoyee`). Acteur : client ou cabinet (l'ESN s'inscrit cabinet). Même écrivain ; preuves D ter ; test : client, cabinet, ESN, échec, GL004 | fait, non exécuté | `db1c8c0` |
| 2.1 `administrateur_cree` — `promouvoir_administrateur()` : la bascule ET la ligne en une fonction (succès/échec, même pièce) ; AD002 (acteur non administrateur, levé, sans ligne), AD001 (compte non créé pour l'administration : ligne échouée). Deux appelants, un écrivain : `create-admin` et le script du jour zéro (qui n'écrivent plus `users` directement). `fab_admin` naît par ce chemin. `diag-admin-create` lit la bascule EN BASE ; `diag-ecritures-effectives` : l'`update` conditionnel au gel avec sa raison (AD001). Test `grand_livre/administrateur_cree.test.sql` (9) | fait, non exécuté | `8bd7395` |
| 2.1 annonce créée en brouillon — **deux actions** `annonce_creee` / `sous_traitance_creee` (la règle du nom et le précédent de la publication : un besoin d'expert n'est pas une annonce d'organisation — **+1 action au décompte**, dite ici). `POST /api/publications` : pièce à l'entrée, ligne APRÈS l'insertion, `journal_error` + identifiant. `sous_traitance_creee` dit si l'organisation personnelle est née avec le besoin. Test `grand_livre/annonce_creee.test.sql` (8 : client, cabinet, ESN, freelance, CDI, jamais sous l'autre nom, GL004 ×2) | fait, non exécuté | `ef148f5` |
| 2.1 `mission_ecartee` — `ecarter_mission()` : match du couple sous verrou, profil de l'ACTEUR vérifié en base, écart compté (EC001) puis journalisé ; idempotent sans ligne ; la route `dismiss` n'écrit plus `matches` (elle ne laissait aucune trace). Test `grand_livre/mission_ecartee.test.sql` (8 : freelance, CDI, sous-traitance, idempotence, profil d'autrui, annonce inconnue, fermée au navigateur) | fait, non exécuté | `3974f8c` |
| 2.1 `evenement_stripe_rouvert` — `rouvrir_evenement_stripe()` : garde dans le `WHERE`, réouverture + ligne en une transaction, `non_coince` sans ligne ; sujet dérivé de l'identifiant Stripe ; **le motif n'entre pas au grand livre** (texte libre). `diag-billing-socle` suit la garde en base ; gel des écritures : l'`update` conditionnel avec sa raison. Test `grand_livre/evenement_stripe_rouvert.test.sql` (7) | fait, non exécuté | `0bc7c07` |
| 2.1 `tache_lancee_a_la_main` — nouvelle signature d'`admin_cron_run_now` (contexte du journal) : AD002, commande dans un sous-bloc (échec écrit, cause SQLSTATE), ligne sur le sujet dérivé de la tâche, `etait_active`. **DETTE NOMMÉE : l'ancienne signature `(text, uuid)` est gardée (§E.72) — à supprimer par une migration du déploiement SUIVANT.** `diag-cron-supervision` E5 suit la dernière définition (§E.34). Test `grand_livre/tache_lancee_a_la_main.test.sql` (8 : tâches fabriquées par `cron.schedule` dans la transaction annulée) | fait, non exécuté | `fc1d29e` |
| 2.2 `taxonomie_modifiee` — les six routes (branche, spécialité × créée, modifiée, supprimée) par un écrivain `lib/taxonomie/journal-taxonomie.ts` ; détail objet, opération, branche, noms de champs, langues ; écosystème de l'objet (les lectures des deux suppressions et de la mise à jour de spécialité prennent `domain_id`). Six preuves D ter, une par route. Test `grand_livre/rattachements.test.sql` (6) | fait, non exécuté | `15c0306` |
| 2.2 `ecosysteme_cree` — `POST /api/admin/ecosystemes` : la ligne sur les deux issues de la configuration (`configuration_creee`), sujet et écosystème = le nouvel écosystème, slug seulement. Écrivain `lib/ecosystemes/journal-ecosysteme.ts`. Test : +3 dans `rattachements.test.sql` | fait, non exécuté | `b9fa385` |
| 2.2 `ecosysteme_modifie` — `[id]` PATCH, `[id]/visuel` POST et DELETE : l'opération en détail (`modification`, `activation`, `desactivation`, `visuel_depose`, `visuel_retire`) ; noms, clés, type — jamais une valeur. Trois preuves D ter. Test : +3 dans `rattachements.test.sql` | fait, non exécuté | `820b1e9` |
| 2.2 `organisation_modifiee` — PATCH `me/organisation`, logo POST et DELETE : l'opération, les noms de champs, pas d'écosystème. Populations au test : client, cabinet, ESN, organisation personnelle d'un expert. Trois preuves D ter ; test +3 | fait, non exécuté | `71a0fb6` |
| 2.2 `identite_modifiee` — PATCH `me/identity` : les noms des champs, jamais les valeurs ; `journal_error` si la ligne refuse. Test +2 (freelance, CDI, client, cabinet, administrateur ; la valeur refusée) | fait, non exécuté | `2fafe64` |
| 2.2 `cv_reinitialise` — POST `profile/cv/reset` : `visible` lu AVANT la remise à zéro → `retire_de_la_vitrine`, `avait_un_fichier` ; la ligne après toutes les écritures. Test +2. **2.2 complet : 71 actions** (56 + 7 gestes + `sous_traitance_creee` + `compte_cree` + 6 rattachements) ; la mesure des routes ne laisse plus que les SEPT exclusions de l'audit | fait, non exécuté | `b67ba62` |
| 2.3 `mesure-routes-sans-trace` → **`diag-routes-tracees`** (renommé, même périmètre) : A aucune route qui écrit sans trace hors exclusions ; B aucune exclusion périmée ; C une raison `LÉGITIME —` par exclusion. Les SEPT exclusions écrites : `auth/init-session`, `cron/stripe-reconcile`, `me/candidatures/[id]/view`, `me/locale`, `me/missions/[id]` GET, `me/notifications`, `me/notifications/[id]/read`. Vert : 63 routes qui écrivent, 56 tracées, 7 exclues. Limite dite : granularité FICHIER (les preuves D ter couvrent la méthode) | fait | `c7cd0e8` |
| 2.3 MUTATION (commitée avant) : M1 `dismiss` sans sa RPC → **NE MORDAIT PAS** (la classe `JournalError` avalait les génériques `journaliser<A>` : `contexteDepuisAuth` « traçante ») → corrigé `cb24e11` ; M4 `me/identity` sans l'appel → **NE MORDAIT PAS** (l'import suffisait) → un appel exigé `9502522` ; puis M1, M2 (exclusion périmée), M3 (sans raison), M4, M5 (`create-admin` sur une RPC inconnue) : **les cinq mordent**. Aucune route n'était tracée par ces seuls faux (56/63 avant et après). §E.78 écrit | fait | `0e3711c` |
| 2.5 `piece_sous_journaux` — la colonne sur les cinq, indexée, sans reprise ; la pièce du passage née dans `trigger_purge_cron` et portée par le corps HTTP (celle du geste quand l'administrateur lance à la main) ; `stripe_event_reclamer` (réclamation + pièce, une instruction) ; `logAudit` : 65 appels reçoivent la pièce (7 routes ont vu leur contexte HISSÉ à l'entrée du geste — l'écrivain et l'audit partagent la pièce ; 7 preuves D ter suivies) ; dépense IA ; notifications (8 écrivains). `diag-tests-grand-livre` : un `skip` tient la place de sa branche. **DETTES NOMMÉES** : `stripe_event_claim`, `admin_cron_run_now(text, uuid)` — à supprimer au déploiement suivant. Test `grand_livre/piece_sous_journaux.test.sql` (10) | fait, non exécuté | `632758d` |
| 2.6 l'écran — `lire_grand_livre` / `lire_piece` (SECURITY DEFINER, bornées, AD002, aucune politique) ; `GET /api/admin/journal` (vocabulaires fermés, curseur opaque, 503 sur panne) et `…/piece/[piece]` ; `/admin/journal` (menu, filtres famille · action · statut · origine · écosystème · compte · période, nettoyage toujours visible et DIT, pagination réelle, suite annoncée, lien vers l'objet, montants $ / devise du paiement, nom rejoint ou « compte supprimé », jamais le numéro de ligne) et `/admin/journal/[piece]` (détail : Retour global, `MasterDetail`, sélecteur d'écriture sur mobile, sous-journaux) ; entrée « Grand livre » (Exploitation, icône registre) ; libellés des 71 actions, familles, statuts, origines, types d'acteur et de l'écran en FR/EN/ES/DE (3871 clés, parité) ; `PageHeader flush`. Migration renommée `journal_lecture` (le suffixe `_grand_livre.sql` est celui du socle, résolu par suffixe : collision évitée). Test `grand_livre/lecture.test.sql` (12) | fait, non exécuté | `c76d48c` |
| 2.7 le nettoyage — `grand_livre_conservation` (planchers NULL = à arbitrer : rien ne s'efface avant la décision), `regler_conservation_journal` (7ᵉ famille de `reglage_modifie`), `annoncer_nettoyage_journal` / `nettoyage_journal_calcul` (un seul calcul pour l'annonce et l'acte), `nettoyer_journal` (le SEUL chemin : annonce comparée, réglage posé puis retiré, compte exigé, `journal_nettoye`) ; routes conservation (GET/PATCH) et nettoyage (POST, ré-authentification) ; section de l'écran, FR/EN/ES/DE (3910 clés). `diag-grand-livre` : « ni zéro » STRICT (71/71) et un seul poseur du réglage. Test `grand_livre/nettoyage.test.sql` (17 ; le passé fabriqué par insertion directe dans la transaction annulée — `journaliser()` écrit à `now()`) | fait, non exécuté | `ada120e` |
| 2.7 / 2.8 MUTATION (commitée avant) : M6 une action privée de son écrivain → « ni zéro » ROUGIT (et sa preuve D ter) ; M7 une seconde fonction pose le réglage de nettoyage → ROUGIT (« poseurs : nettoyer_journal, sonde_porte_derobee ») ; M8 le réglage n'est plus retiré → ROUGIT. Les trois mordent | fait | — |
| Au passage — `/auth/callback` lit `error` / `error_code` (fragment ET requête) : lien expiré (`otp_expired`), refus de notre côté (`unexpected_failure`/`server_error` — `handle_email_confirmed` lève EC001 depuis `ecritures_effectives`), lien invalide ; message traduit et actionnable, le code affiché pour le support ; la propriété « ne jamais se figer » intacte (la cause pose `hasError`). FR/EN/ES/DE (3915 clés). NON VÉRIFIÉ : la forme exacte du retour de GoTrue en cas d'erreur de base (fragment ou requête) — les deux sont lus | fait | `d0483f2` |
| Requête de staging (`supabase/verifications/staging-avant-push.sql`) : ㉔ colonne `piece` absente des cinq, ㉕ noms `*_piece_idx` libres (§E.60), ㉖ `grand_livre_conservation` absente, ㉗ les 12 fonctions nouvelles absentes, ㉘ les deux anciennes signatures gardées (`stripe_event_claim`, `admin_cron_run_now(text, uuid)`) PRÉSENTES | fait | ce commit |

## ⛔ ARRÊT 7 — PHASE B, AUDIT RENDU (29/09/2026). DEUX DÉCISIONS AVANT LE CODE.

**À FAIRE AVANT TOUTE DÉMONSTRATION (reporté par Youssef)** : l'essai d'inscription d'un expert **sur staging**
(freelance et CDI), de bout en bout — e-mail de confirmation compris.

**Étape 0.** `origin/feat/sprint-archi-orga` = HEAD = `15b50d5` (git fetch). `git status` : seul `supabase/snippets/`
non suivi (fichiers de Youssef, non touchés). Tag local `sauvegarde-avant-phase-b`. Départ : série `diag` 109 verts /
0 rouge / 5 muets (les mêmes) ; `tsc` 0 ; lint 65/25. Staging et local en Postgres 17.6.1.166 (lu).
**Contradictions relevées** :
① le prompt dit « l'inscription et la préinscription passent par `createUser` » — **le code passe par `auth.signUp`**
sur un client anonyme (`signUpWithConfirmation`, `lib/auth-signup.ts`), et c'est voulu : `admin.createUser`
n'envoie PAS l'e-mail de confirmation (piège P1 de ce fichier). Seul `create-admin` passe par `createUser` (adresse
confirmée d'office). Le nettoyage (`atomicCleanup` : public.users puis auth) existe déjà. **Je garde `signUp`**.
② « 55 + 7 » dans ce fichier, « 56 + 7 » dans le prompt : le prompt est juste (`refus_recherche_en_cours`, 56ᵉ).
③ ce fichier exemptait le nettoyage de « un appelant exactement » ; le prompt l'inclut — il est construit ici.
④ **UN FAIT QUI CONTREDIT LA LISTE DES SEPT** (décision A ci-dessous). ⑤ **Une route morte** (décision B).

**Étape 1 — l'audit (lecture seule).**

*2.1 — les sept gestes : qui écrit aujourd'hui, pour qui.*

| Geste | Fichier · ce qui écrit | Populations |
|---|---|---|
| inscription d'un expert | `app/api/auth/public/register-expert/route.ts` : `signUpWithConfirmation` (auth.users → `handle_new_user` → users + profiles), puis `users.update` (téléphone, CGU), `logAudit('expert_registered')` ; échec → `atomicCleanup` | expert freelance (`expert`), expert CDI (`cdi`) |
| préinscription d'une organisation | `app/api/auth/register-org/route.ts` : `signUpWithConfirmation`, `users.update`, RPC `creer_organisation_avec_admin`, `logAudit('org_pre_registered')` ; échec → `atomicCleanup` (organisation d'abord) | client (`entreprise`), cabinet, ESN (`cabinet` + `org_type = 'esn'`) |
| création d'un administrateur | `app/api/admin/create-admin/route.ts` : `auth.admin.createUser` (rôle de pont `entreprise`), relecture du miroir, `users.update` (user_type admin), `logAudit` ; **et** `scripts/creer-premier-administrateur.mjs` (jour zéro, même geste) | admin |
| annonce créée en brouillon | `app/api/publications/route.ts` POST : `publications.insert` (+ `ensurePersonalOrg` pour une sous-traitance : l'organisation personnelle naît à la volée), `logAudit` | client, cabinet, ESN (`mission`, `offre`) ; **collaboration entre experts** (`sous_traitance`, freelance ET CDI, organisation personnelle) |
| mission écartée | `app/api/me/missions/[id]/dismiss/route.ts` : `matches.update({status:'dismissed'})` — **aucune trace, pas même d'audit** | expert freelance, expert CDI |
| événement Stripe rouvert | `app/api/admin/facturation/route.ts` POST : `stripe_events.update({status:'failed'})`, `logAudit` | admin |
| tâche lancée à la main | `app/api/admin/cron-jobs/[name]/run/route.ts` : RPC `admin_cron_run_now` (requalifie ou insère la ligne `cron_run_log`), `logAudit` | admin |

*2.2 — les 14 rattachements, la règle appliquée (« filtrer sur l'action ne rend que ce que son nom annonce »).*

| Route | Action | Pourquoi |
|---|---|---|
| `create/update/delete-branch`, `create/update/delete-speciality` (6) | **`taxonomie_modifiee`** (imposée) — gardées ensemble | chacune modifie LA taxonomie ; le détail dit l'objet (`branche`/`specialite`) et l'opération (`creee`/`modifiee`/`supprimee`) |
| `admin/ecosystemes` POST | **`ecosysteme_cree` — SÉPARÉE** | une création filtrée sous « écosystème modifié » serait un chiffre juste sous une étiquette fausse (§E.24) |
| `admin/ecosystemes/[id]` PATCH, `[id]/visuel` POST/DELETE (2) | **`ecosysteme_modifie`** (imposée) — gardées | le visuel est une propriété de l'écosystème ; le détail dit `champs` et l'opération |
| `profile/cv/reset` | **`cv_reinitialise`** (imposée) | le détail dit `retire_de_la_vitrine` (vrai si le profil était visible) |
| `profile/cv` DELETE | **décision B** | route MORTE (aucun appelant, lu) qui ne vide que le fichier |
| `me/identity` | **`identite_modifiee`** (imposée) | prénom, nom |
| `me/organisation` PATCH, `me/organisation/logo` POST/DELETE (2) | **`organisation_modifiee`** (imposée) — gardées | le logo est une propriété de l'organisation ; le détail dit `champs` |
Gardées sous une action imposée : **8** ; séparée : **1** (`ecosysteme_cree`) ; en attente : **1** (décision B).

*2.3 — les sept exclusions*, chacune ÉCRITE avec sa raison dans le contrôle : `auth/init-session` (session, pas un
geste métier) ; `me/candidatures/[id]/view` (consultation) ; `me/missions/[id]` GET (marque de lecture) ;
`me/notifications` et `me/notifications/[id]/read` (lecture des notifications) ; `me/locale` (préférence
d'affichage) ; `cron/stripe-reconcile` (la vérification nocturne écrit son propre journal de tâche — sous-journal).

*2.5 — les cinq sous-journaux, lus dans `supabase/.temp/schema.sql`.* Aucun trigger sur aucun. **audit_logs** :
`id uuid`, `user_id` NOT NULL → users (RESTRICT), `domain_id` NOT NULL → domains, `action` varchar(50), `entity_type`,
`entity_id` NOT NULL, `detail`, `ip_address`, `user_agent`, `created_at` ; RLS active, aucune politique.
**ai_spend_events** : `provider` (CHECK rerank|claude), `domain_id`/`organization_id`/`profile_id` → SET NULL, `units`,
`cost_usd` (≥ 0), `action` (CHECK 7 valeurs), `context`, CHECK `ai_spend_un_seul_acteur` ; RLS, aucune politique.
**stripe_events** : `id text` PK, `type`, `payload` NOT NULL, `livemode`, `status` (CHECK 4), `attempts`, `error`,
`organization_id` → SET NULL, `received_at`, `processed_at` ; RLS, aucune politique. **cron_run_log** : `id bigint`
identité, `job_name`, `requested_at`, `request_id`, `http_status`, `timed_out`, `error_msg`, `response_body`,
`reconciled_at`, `trigger_source` (CHECK schedule|manual), `triggered_by`, `summary`, `verdict_source` (CHECK),
`attendu_de_la_tache` ; RLS, aucune politique. **notifications** : `user_id` → users (CASCADE), `domain_id` → domains,
`type`, `channel` (CHECK), `status` (CHECK), `entity_id`, horodatages d'envoi ; RLS **avec** `notifications_self_read`
et `notifications_self_update` (le navigateur marque ses notifications lues). → **`piece uuid` nullable** sur les
cinq, sans reprise ; pour `cron_run_log`, la pièce naît dans `trigger_purge_cron` et voyage dans le corps HTTP.

*Grand livre (lu).* Index date en tête : `(horodatage desc)`, `(horodatage desc, acteur_id)`, `(…, ecosysteme_id)`,
`(…, type_action)`, `(piece)`, `(sujet_id, horodatage desc)` ; RLS active, **aucune politique**, `SELECT` au seul
`service_role` → la lecture de l'écran passera par une fonction SECURITY DEFINER bornée à l'administrateur.

*2.6 — primitives.* `components/ui/PageHeader`, `EmptyState`, `StatusPill`, `MasterDetail`, la coquille
`components/shell/DashboardShell` (montée par le layout admin). Écrans admin voisins à imiter : `/admin/consommation`,
`/admin/taches-planifiees`.

*Au passage.* **Confirmation d'adresse en échec** : GoTrue renvoie sur `/auth/callback` sans session ; l'écran pose
`hasError` et affiche son message traduit (jamais la page brute) — mais générique : à rendre actionnable selon le
code reçu. **Branche/spécialité** : la règle vit dans `register-expert` ET `handle_new_user` → une seule définition,
une fonction SQL appelée par les deux.

**DÉCISIONS DEMANDÉES À YOUSSEF (le code ne commence qu'après)** :
**A.** Le compte d'un **membre invité** naît **dans le navigateur** (`supabase.auth.signUp` sur la page
`/invitation/[token]`) : aucun serveur, donc aucune ligne — seule l'acceptation, plus tard, s'écrit. C'est une
huitième population de « compte créé » que la liste des sept ne nomme pas. Proposition : passer cette inscription
par une route serveur (`signUpWithConfirmation`, nettoyage en cas d'échec) et une action **`membre_inscrit`**.
**B.** `DELETE /api/profile/cv` n'a **aucun appelant** et ne vide que le fichier (le profil reste marqué analysé à
moitié). Proposition : **la supprimer** plutôt que de la journaliser sous une action que rien n'emprunte.

## ⛔ ARRÊT 6 — LOT S FAIT (28/09/2026) : FINIR LE PUSH PROPREMENT.

**Validations** : `tsc` 0 ; `next build` vert ; lint 65/25 ; parité 3 712 clés ; cliquet vert ; série `diag` **109 verts
/ 0 rouge / 5 muets** (les mêmes). Rien n'a tourné sur une base. **Staging reste à moitié migré, ancien code en ligne** :
jusqu'au déploiement, l'offre par défaut et l'ouverture du dépôt de candidature y échouent (ligne ㉒).
**Prochaine action (Youssef)** : la séquence ci-dessous, de l'étape 0 — le `db push` reprend à `journal_annonce_publiee`.

## ▶ LOT S — LE PUSH S'EST ARRÊTÉ À MI-CHEMIN SUR STAGING (28/09/2026)

**L'état, lu dans `migration list` (Youssef)** : appliquées sur staging jusqu'à `20260925000190`
(journal_recherche_abandonnee) — **GELÉES**. Arrêt sur `20260925000200_journal_annonce_publiee` : sa sonde a pris un
VRAI brouillon sans zone et tenté de le publier (23514, `publications_publiee_requiert_zones_check`) — la base avait
raison, la sonde tort ; rien d'écrit. **29 migrations non appliquées** (`000200` → `20260928000010`), corrigibles en
place. Le code n'est PAS poussé : staging tourne l'ancien code sur une base à moitié migrée. Postgres de staging
passé à **17.6.1.166** ; cause racine du plantage de « vrai appelant » : supautils en 17.6.1.104 (corrigé ≥ 17.6.1.121).
**Décision de Youssef** : les sondes sur données réelles sortent des migrations ; les tests prouvent les gestes.

| Point | État | Commit |
|---|---|---|
| 1, 2, 4 **16 migrations non appliquées** perdent leur sonde sur données réelles (200, 220, 230, 280, 290, 300, 320, 360, 370, 380, 390, 400, 410, 420, 430, 440) ; reste dans chacune : signatures par types, listes blanches, colonnes/index, refus du texte libre, et — sur identifiants INVENTÉS — compte/invitation/membre/fil inconnu (320, 360, 380, 390, 400, 410, 430, 440), fin future refusée (280), motif inconnu et échec sans cause (430) ; la reprise voulue du passif des annonces (230) reste. Les 29 lignes de fin renvoient à leur preuve (le test, ou le module TS pour les 9 actions écrites en TypeScript). `diag-grand-livre` : 36 preuves de CONTENU de sonde retirées, planchers re-mesurés (131 appels, 9 migrations). Test `invitations` : rôle dans la ligne d'invitation, échéance dans la ligne de renvoi. Les 21 appliquées (≤ journal_recherche_abandonnee) : **gelées, intactes** | fait, non exécuté | ce commit |
| 7 la requête de staging relue contre l'état du push interrompu : **② mise à jour** (l'index d'unicité EXISTE, unique → attendu 1), **⑦ mise à jour** (seules les deux colonnes du reste du lot doivent être absentes), **⑨ mise à jour** (seules deux anciennes signatures restent → 2) ; **ajoutées** : ㉑ `cles_detail` et `candidature_depots.piece` présentes (2), ㉒ `set_default_package(uuid)` et l'ancien `ouvrir_depot_candidature` absents (0 — et donc ces deux gestes ÉCHOUENT sur staging jusqu'au déploiement), ㉓ `exiger_ecriture` présente (1). Inchangées : ①, ③–⑥, ⑧, ⑩–⑳ (⑪ attend toujours 13 : les portes se ferment dans une migration non appliquée) | fait | ce commit |
| 6 §E.76 : cause racine **VÉRIFIÉE** (supautils, 17.6.1.104, corrigé ≥ 17.6.1.121 — un appel à une RPC refusée au navigateur tuait le serveur) ; `scripts/verifier-version-postgres.mjs` (lit `supabase/.temp/postgres-version`, refuse sous 17.6.1.121 ; ici : 17.6.1.166 ✅) ; séquence de déploiement : étape 0 (CLAUDE.md §G.4 ter, ci-dessous) ; `docs/mise-en-production.md` : étape 0, la production naît sur une version corrigée, et la liste à cocher | fait | ce commit |
| 5 la règle : CLAUDE.md §G.4 ter, §E.77 ; `diag-postconditions-structure` (tables métier DÉRIVÉES — 23 référentiels, 48 métier —, héritage gelé par suffixe, 29 migrations soumises : aucune lecture métier, aucune écriture directe, chaque ligne de fin renvoie à un fichier qui existe ; 2 exceptions écrites, l'inscription qui relit le compte qu'elle fabrique) | fait | ce commit |
| 3 (d'abord) aucune preuve ne disparaît : les gestes que seules les sondes prouvaient passent aux tests — `invitations` +4 (renvoi : statut non admis, une autre pièce écrit une seconde ligne ; acceptation : statut non admis, invitation échue) et 2 renforcées (échéance du renvoi relue, adresse comparée sans casse) ; `annonce_publiee` (l'organisation dans la ligne) ; `compte_suspendu` (de/vers de la réactivation) | fait, non exécuté | ce commit |

## ⛔ ARRÊT 5 — 26 FICHIERS SUR 27 VERTS, 206 TESTS, AUCUN PLANTAGE (28/09/2026). LA CAUSE DU PLANTAGE RESTE À TRANCHER.

**Ce que Youssef a obtenu** : 26 fichiers verts. `vrai_appelant/appelant.test.sql` s'est arrêté ligne 62, après
une assertion : `could not determine polymorphic type because input has type unknown` — `is(:'accepte',
'acceptee', …)`, deux littéraux non typés passés à une fonction polymorphe. Les 10 autres assertions n'ont pas
tourné : **la question du plantage n'est pas tranchée**.
**Corrigé** : les deux arguments typés `::text`. Le fichier entier relu pour la même forme : c'était la **seule**
occurrence — le premier `is()` compare deux `text[]` typés, le dernier deux `bigint`, `coalesce(p.proconfig, '{}')`
prend son type de la colonne (et son assertion est passée), `format()` prend `variadic "any"`, qui n'est pas une
résolution polymorphe. Rien d'autre touché ; la propriété prouvée est la même.
**Prochaine action (Youssef)** : `db reset --local`, puis `test db --local` — ce passage tranche le plantage
(voir ARRÊT 4, ②/③).

## ⛔ ARRÊT 4 — LOT C : LE PLANTAGE DU TEST « APPELANT » (28/09/2026). CAUSE NON TRANCHÉE.

**Ce que Youssef a obtenu** : `db reset` vert (les deux migrations nouvelles « postcondition tenue », l'inscription
d'un expert exécutée pour de vrai) ; `db lint` vide ; `test db` : 4 fichiers verts, puis
`grand_livre/appelant.test.sql` → **signal 11**, « Failed process was running: select * from pg_temp.essai(); »,
récupération de la base, **22 fichiers non exécutés**.

| Point | Fait | Commit |
|---|---|---|
| C.1 le test réécrit : `vrai_appelant/appelant.test.sql` — même propriété (11 assertions), changements de rôle en **instructions** comme PostgREST, **un appel par instruction** (le journal nommera la RPC), passe **en dernier** ; garde J de `diag-tests-grand-livre` (aucun rôle changé dans un corps `$…$`, ces fichiers en dernier) ; `supabase/verifications/repro-segfault-appelant.sql` (local seulement) : six formes étiquetées, de la plus nue à celle de l'ancien test | fait, non exécuté | ce commit |
| C.2 / C.3 la cause | **NON TRANCHÉE** — aucun moyen de l'établir sans exécuter. Le prochain passage la tranche (voir ci-dessous) ; §E.76 écrit ce qui est établi et marque la cause NON VÉRIFIÉE | — |
| C.4 la requête de staging | inchangée | — |

**Ce que le prochain passage tranchera.** ① Les 22 fichiers bloqués donnent enfin leur verdict (le fichier qui
change de rôle passe après eux). ② Si `vrai_appelant/appelant.test.sql` passe : la forme de l'ancien test était en
cause — la reproduction dira laquelle (A à E), et §E.76 sera réécrit avec le coupable. ③ S'il plante : le journal
nomme l'appel, c'est un **défaut critique du produit** (un appel PostgREST tuerait la base) — on s'arrête, sans
contournement.

## ⛔ ARRÊT 3 — LE LOT T EST FAIT (28/09/2026). LA PHASE B N'EST TOUJOURS PAS COMMENCÉE.

**Validations à l'arrêt** : `tsc` 0 erreur (hors `.next/`) ; `next build` vert ; lint 65/25 (cliquet vert) ; parité
i18n **3 712** clés × 4 (+2 : les messages d'échec d'inscription de la page d'invitation) ; cliquet des plages vert ;
série `diag` **108 verts / 0 rouge / 5 muets** — les 5 mêmes (3 écartés parce qu'ils écrivent, 2 plantages
Windows). **Rien n'a tourné sur une base** : 27 fichiers de test, 2 migrations nouvelles, 15 du lot corrigées en place.

**Migrations nouvelles** : `20260928000000_inscription_specialites`, `20260928000010_ecritures_effectives`.
**Corrigées en place (lot, jamais poussées)** : liste_blanche_par_action, journal_reglages, journal_devoilement_ouvert,
journal_annonce_depubliee, journal_annonce_expiree, journal_devoilement_ferme, journal_compte_suspendu,
journal_compte_valide, journal_suppression_programmee, journal_invitation_revoquee, journal_invitation_renvoyee,
journal_invitation_acceptee, journal_membres, journal_message_envoye, portes_laterales_fermees.

**Prochaine action (Youssef)** : la séquence de CLAUDE.md §G.4 ter, étapes 1 à 4, puis retour des sorties.

## ▶ LOT T — LES TESTS ONT TOURNÉ CHEZ YOUSSEF (28/09/2026)

**Ce qu'il a obtenu** : `db reset --local` vert (47 migrations du lot, « PARTIELLE » où une sonde saute) ;
`db lint` vide ; `test db --local` **FAIL** — 23 fichiers, 59 tests ; 15 fichiers arrêtés avant leur premier test
sur `column "speciality_id" of relation "profiles" does not exist` (`handle_new_user`) ; échecs partiels :
`annonce_depubliee` (2), `invitations` (4, 13), `membres` (4, 5, 8). Requête de staging : 12 OK, 0 ÉCART, 3 À LIRE
(6 annonces déjà expirées, 3 lignes au grand livre, 55 actions). Sous-dossiers parcourus, `_fabriques.psql` ignoré,
`\ir` résout : les trois doutes sont levés.

| Point | État | Commit |
|---|---|---|
| T.1 l'inscription : `handle_new_user` recréé (migration `20260928000000_inscription_specialites`) — `speciality_ids`, taxonomie vérifiée en base, rôle inconnu **lève** (IN001, plus de compte fantôme), codes IN001–IN005 ; test `inscription/roles.test.sql` (5 rôles + « Autre » + 7 refus, 21 assertions) ; requête de staging +3 lignes (16–18) ; `diag-admin-create` réancré sur la dernière définition (§E.34) ; `diag-cron-supervision` ne confond plus `"trigger"` et `trigger` ; page d'invitation : plus de message GoTrue brut (2 libellés × 4 langues) | fait, non exécuté | ce commit |
| T.2 la classe : `db lint` appelle plpgsql_check **sans table** (vu dans la CLI ; filtre exact NON VÉRIFIÉ) → test `plpgsql_check.test.sql` (4 assertions : chaque couple fonction de trigger / table, puis les autres fonctions plpgsql) + garde H ; `diag-colonnes-supprimees` attribue **par instruction** (INSERT, ON CONFLICT, SET, tables supprimées, chaînes vidées ; défaut `into v_x` qui avalait `from` corrigé) — 5 témoins ; balayage : **130 fonctions et vues, 0 autre citation morte** ; §E.73 | fait | ce commit |
| T.3 les six échecs : **le test avait tort, pas le produit** — une sous-requête dans la même instruction que l'appel lit l'instantané d'avant l'écriture (preuve : les assertions séparées passaient) ; hypothèse RLS **écartée** (les 4 RPC sont DEFINER + search_path, lu dans le code) ; **12** assertions corrigées (les 6 + 6 de même forme jamais exécutées), garde I ; `appelant.test.sql` (9 : service_role écrit et journalise, authenticated refusé 42501, écriture directe sans effet) ; LA CLASSE : `exiger_ecriture()` EC001 — 18 écritures du lot en place, 8 fonctions appliquées recréées (`20260928000010_ecritures_effectives`), `diag-ecritures-effectives` (66 écritures, 27 exigent, 39 au gel à raisons) ; §E.74 | fait, non exécuté | ce commit |
| T.4 la bascule : `POST /api/profile/disponibilite` (un champ de la voie, comparer-puis-poser, une ligne exigée, `disponibilite_basculee` sous la pièce par l'écrivain unique) ; `lib/profil/bascule-disponibilite.ts` partagé par les deux tableaux (4 bascules : `availability_status`, `open_to_cdi`, `cdi_status`, `open_to_freelance`) — mêmes optimisme, retour en arrière et toasts ; `profiles_self_update` fermée en place + droit d'écrire `profiles` retiré au navigateur (un onglet périmé échoue au lieu de réussir à vide) ; `diag-portes-laterales` : **13 sur 13** (14 sur 14 dans l'histoire), 0 exception ; requête de staging ⑪ → 13 ; `ensure_rls` n'accorde aucun droit (CLAUDE.md marqué PÉRIMÉ, §M0) | fait, non exécuté | ce commit |
| T.5 une règle, une définition : **le TypeScript fait foi** (`deriveCandidatureLifecycle` : si ; `effectiveConversationExpiry` : quand) ; la base les lit. Elle portait `status = 'unlocked'` — seconde définition partielle → elle reçoit `p_statut_lu` et compare (migration du lot corrigée en place, signature `(uuid, uuid, timestamptz, text)`, l'ancienne retirée) ; issues `deja` · `change` · `introuvable` nommées ; route : `devoilements_changes` ; test +3 (10) ; `diag-grand-livre` refuse tout statut en dur dans la fonction | fait, non exécuté | ce commit |
| T.6 ce que le rapport ne prouvait pas — **mutations** (toutes après commit) : 2.3 **NE MORDAIT PAS** (une sonde privée de son annulation restait verte : un bloc imbriqué qui attend GL005 prêtait sa qualité au parent) → corrigée (`7dc823a`), re-mutée ×2 → rouge, §E.75 ; 2.5 clé hors liste dans un détail SQL → rouge ; 2.5 liste TS ≠ base (`message_envoye` amputé en TS) → rouge ; 2.8 écriture client rétablie → rouge, politique rouverte → rouge ; 2.9 clé retirée en espagnol → rouge. **Le défaut nommé du gel de 2.3** : `20260923000060_plafond_par_acteur`, sa postcondition MODIFIE l'alerte réelle de l'acteur `profile` puis la RESTAURE hors bloc annulé — sur staging, **rien n'en reste** (même transaction, aucun trigger sur la table, grand livre inexistant le 23/09), migration appliquée donc intouchée. **Les 3 lignes de staging** : les sondes du socle sont annulées ou attendent une erreur (lu) ; hypothèse : trois passages réels de `ip_retention_purge` (04:20 UTC, 25–27/09) — la requête de staging le tranche (lignes ⑲ attendu 0, ⑳ la ventilation) | fait | `47a5822`, `7dc823a`, ce commit |

**Si la ligne ⑲ de la requête n'est pas 0 — ce que la phase B fera des restes.** Le grand livre est en ajout seul
(GL001) : rien ne se supprime hors du nettoyage. Un reste ne sera **ni effacé ni masqué** : il se **contrepasse**
par une ligne nouvelle qui cite sa pièce en `piece_origine` (§D.26), et l'écran de l'étape 4 l'affichera avec sa
contrepassation. Le nettoyage (rétention) le traitera comme toute ligne — par l'âge, jamais par sa nature.

## ⛔ ARRÊT 2 — L'ÉTAPE 2 EST FAITE (26/09/2026). LA PHASE B N'EST PAS COMMENCÉE.

**Validations à l'arrêt** : `tsc` 0 erreur (hors `.next/`) ; `next build` vert ; lint 65/25 (cliquet vert) ;
parité i18n 3 710 clés × 4, 0 écart ; cliquet des plages vert ; série `diag` **107 verts / 0 rouge / 5 muets**
— les 5 mêmes qu'au départ (3 écartés parce qu'ils écrivent, 2 plantages Windows `UV_HANDLE_CLOSING`).
**Rien n'a tourné sur une base** : ni les migrations corrigées, ni les tests, ni la requête de staging.

**Migrations** : 2 nouvelles (`20260926000000_journal_refus_recherche_en_cours`,
`20260926000010_portes_laterales_fermees`) ; 24 des 45 corrigées EN PLACE ; aucune renommée, supprimée ou
réordonnée ; aucune migration déjà appliquée touchée.

**En attente d'arbitrage** : ① `profiles_self_update` (DÉFAUT NOMMÉ, 2.8) — les bascules de disponibilité des
tableaux de bord écrivent `profiles` depuis le navigateur sans `disponibilite_basculee` ; ② le passif des
dévoilements tient par une DATE de mise en service (`constats_mise_en_service`), pas par un marquage en
migration comme les annonces — la règle d'expiration de l'échange vit en TypeScript.

**Prochaine action (Youssef)** : la séquence de CLAUDE.md §G.4 ter, étapes 1 à 4 ; retour des sorties ;
puis 5 à 7 seulement si tout est vert et la requête sans `ÉCART`.

## ▶ ÉTAPE 2 — LE COMPLÉMENT (GO de Youssef le 26/09/2026)

Un commit par point ; ce tableau se met à jour **à chaque commit**. L'arrêt est à la fin de l'étape 2.
Décisions de Youssef sur l'audit : voir le prompt du GO (2.1 à 2.13) — rien d'autre n'est ouvert.

| Point | État | Commit |
|---|---|---|
| Règle de lecture (CLAUDE.md) | fait | `2e80de3` |
| 2.9 parité i18n — `diag-parite-i18n` (éprouvé : orpheline es, manquante de → rouge) | fait | voir `git log` |
| 2.10 lint 65/25 — `diag-lint-cliquet` (éprouvé : 66/26 → rouge) | fait | voir `git log` |
| 2.2 les 24 lignes « tenue » → PARTIELLE si une sonde saute (garde éprouvée) | fait | voir `git log` |
| 2.3 le bloc annulé gardé (172 appels, gel 3 dont 1 défaut nommé) ; trous de `grand_livre.id` documentés | fait | voir `git log` |
| 2.5 les clés : type par action (`lib/journal/detail.ts`, portes génériques, 6 routes `satisfies`) + contrôle SQL C bis (54 sites, relais suivis, 14 appels .rpc typés) | fait | `97fb107` + correctif `d89a621` (deux gardes de la porte cassées par le type générique, et le `satisfies` retiré non vu — trouvés par mutation) |
| 2.6 le siège plateforme : gardes de compte relues SOUS VERROU dans `changer_statut_compte`, refus nommé `target_is_admin` / `self_forbidden` (403) ; sonde `self_forbidden` exécutée | fait | voir `git log` |
| 2.11 passif SANS ligne : annonces marquées par la migration (`annonce_active()`) ; dévoilements par la date de mise en service (`constats_mise_en_service`, issue fermée `constate`/`passif`/`deja`) ; §E.72 la règle des signatures supprimées ; secrets du Vault → requête de staging (la tâche reste HTTP : la règle des dévoilements vit en TS) ; index unique, colonnes, index §E.69, surcharges → requête de staging | fait | ce commit |
| 2.7 le chevauchement s'écrit : `refus_recherche_en_cours` (migration `20260926000000`, écrivain unique, sur `occupe` seulement) ; la liste fermée compte 56 actions ; langue des codes reportée, écrite dans CLAUDE.md | fait | voir `git log` |
| 2.8 les portes latérales : 13 mesurées, 12 fermées (migration `20260926000010`), `profiles_self_update` reste ouverte — DÉFAUT NOMMÉ, arbitrage (les bascules de disponibilité des tableaux de bord écrivent `profiles` depuis le navigateur et n'écrivent pas `disponibilite_basculee`) ; `diag-portes-laterales` | fait, arbitrage demandé | ce commit |
| 2.1 les tests pgTAP : **22 fichiers, 157 assertions** (et non 24 fichiers : les gestes d'une même famille partagent un fichier — invitations, membres, purges, réglages ; plus `socle` et `refus_recherche_en_cours`) ; **38 fonctions créées depuis le socle, 38 appelées** (les 35 de l'inventaire, les 7 sans sonde comprises, plus les 3 du socle) ; 33/56 actions citées, 23 au gel à raisons (22 écrites par le TypeScript, `journal_nettoye` sans écrivain avant l'étape 4) ; `diag-tests-grand-livre` ; CLAUDE.md §G.4 ter. **AUCUN test n'a tourné** : pas de Docker ici — `test db --local` est à lancer par Youssef | fait, non exécuté | ce commit |
| 2.4 une fonction, une signature : `supabase/tests/database/une_signature.test.sql` (2 assertions, `pg_proc` du schéma public hors extensions, table d'exceptions à raison obligatoire — **0 exception**) ; garde F de `diag-tests-grand-livre` (éprouvée : comptage retiré, raison facultative → rouge) | fait, non exécuté | ce commit |
| 2.13 la requête unique de staging : `supabase/verifications/staging-avant-push.sql` — **un** SELECT, lecture seule, **15 lignes** (attendu / observé / verdict OK·ÉCART·À LIRE) : doublons de l'index unique, nom d'index libre (§E.60), index partiel §E.69, deux secrets du Vault par leur nom, pg_cron/pg_net, `constats_trigger` absente, 4 colonnes et 1 table du lot absentes, 4 anciennes signatures présentes, 0 surcharge, 12 politiques retirées présentes, 0 porte posée à la main, et trois volumes (passif des annonces, lignes du socle, actions) | fait, non exécutée | ce commit |
| 2.12 la séquence de déploiement : CLAUDE.md §G.4 ter (7 étapes) et ci-dessous | fait | ce commit |

### La séquence de déploiement (CLAUDE.md §G.4 ter) — ce que Youssef lance

0. après `npx supabase link` : `node scripts/verifier-version-postgres.mjs` — au moins 17.6.1.121, sinon mettre staging à jour d'abord (§E.76)
1. `npx supabase db reset --local`
2. `npx supabase db lint -s public --level error` — sortie vide = aucune erreur (pas de `--fail-on`)
3. `npx supabase test db --local`
4. la requête `supabase/verifications/staging-avant-push.sql` dans l'éditeur SQL de staging — un `ÉCART` → arrêt
5. `npm run build`
6. `npx supabase db push`
7. `git push`, aussitôt après

## ⛔ ARRÊT 1 — AUDIT DU COMPLÉMENT RENDU, OK REÇU (26/09/2026)

**Où on en est.** Phase A acceptée : le rejeu local passe les 45, `db lint` est vide. Mais **24 des 45 ont
sauté une sonde** faute de données. Le complément (étapes 1 et 2 du prompt du 26/09) : l'audit ci-dessous
est rendu, **aucun code n'est écrit**. Prochaine action : l'étape 2, **après l'OK de Youssef seulement**.
Tag de sauvegarde local : `sauvegarde-avant-complement` → `24f03b9`.

**État de départ des validations (26/09/2026, avant toute modification)** : `tsc` vert ; `next build` vert ;
lint 65 erreurs / 25 avertissements (base 66/28) ; parité i18n 3 710 clés × 4 langues, 0 écart — **mesurée à
la main, aucun diagnostic ne garde la parité globale** ; cliquet des plages vert (gel 4) ; série `diag`
103 verts / 0 rouge / 5 muets (3 écartés parce qu'ils écrivent, 2 plantages Windows) — les mêmes qu'avant.

### 0.2 — Contradictions entre le prompt et le dépôt

1. **Le prompt suppose des « refus d'une recherche » pour chevauchement et garde d'éligibilité. Il n'y en a
   pas.** Les cinq refus nommés visent le **dépôt** (`refus_garde_eligibilite` = les gardes de
   `deposerCandidature`). Une recherche **inéligible** s'écrit `recherche_terminee` (`issue: ineligible`, avec
   sa raison) — c'est la décision §C.21 (« un refus légitime est une recherche terminée »). Un run qui **ne
   prend pas le bail** n'écrit **rien** au grand livre : une ligne de console
   (`lib/matching/run-for-expert.ts:217-220`), rien n'est lancé (§D.22 : « rien n'a échoué »). À trancher :
   est-ce un geste (le second demandeur « attend ») qui mérite une ligne ?
2. **Politiques `FOR ALL`** : la règle 5 les interdit « dans ce lot » ; la baseline en porte au moins une
   (`organization_invitations_admin_all`, `TO authenticated`). Préexistante, hors des 45 — signalée, pas touchée.
3. **CLAUDE.md dit « There is no test framework »** : pgTAP le change ; la section sera réécrite avec l'étape 2.
4. **« La convention veut l'anglais » pour les codes** : aucune convention écrite dans le dépôt ne le dit
   (CLAUDE.md : commentaires en français). Sans conséquence — la décision de report s'écrira dans CLAUDE.md.

### 1.1 — Inventaire des fonctions créées ou remplacées par les 45

Périmètre : les 45 fichiers ; chaque `create [or replace] function`, DERNIÈRE définition ; « écrit » = INSERT,
UPDATE ou DELETE dans le corps, ou écrivain du grand livre (point fixe depuis `journaliser`) ; appels relevés
dans toutes les postconditions, hors littéraux ; « sauté » = dans la branche qui suit un `raise notice
'…SAUTEE…'`. Le premier passage du balayage comptait à tort les signatures citées en chaîne — corrigé.

**35 fonctions, dont 34 écrivent.**

| Au rejeu local | Nombre | Fonctions |
|---|---|---|
| a TOURNÉ, chemin d'écriture | 2 | `journaliser`, `journaliser_reglage` |
| a tourné, **lecture** | 1 | `grand_livre_chemins` |
| a tourné, **chemin de refus seulement** (lève avant d'écrire) | 1 | `constater_devoilement_ferme` (fin future → 22023) |
| sonde **SAUTÉE** | 24 | `accepter_invitation`, `anonymiser_compte`, `changer_statut_compte`, `cloturer_annonce`, `constater_annonces_expirees`, `constater_avertissement_inactivite`, `creer_invitation`, `decliner_candidature`, `devoiler_candidature`, `enregistrer_paiement`, `envoyer_message`, `inserer_candidature_jugee`, `maj_membre_organisation`, `ouvrir_depot_candidature`, `programmer_suppression_compte`, `publier_annonce`, `regler_durees_place`, `renvoyer_invitation`, `retenir_candidature`, `revoquer_invitation`, `solder_depot_en_echec`, `statuer_sur_expert`, `statuer_sur_organisation`, `verifier_telephone` |
| **AUCUNE sonde** | 7 | `regler_tarif_ia`, `regler_plafonds_ia`, `regler_quota_ia`, `regler_matching`, `regler_note_jugement`, `set_default_package` (citées seulement dans les signatures), `journaliser_verification` (appelée par `statuer_sur_*`, sautées) |

**Compte : sur les 34 fonctions qui écrivent, 2 ont exécuté leur écriture au rejeu local ; 32 jamais.**

### 1.2 — Les sondes sur données réelles : le bloc annulé, et ce qui pourrait en sortir

- **Structure** : 161 appels d'écrivains dans les postconditions ; **161** sont dans un bloc qui lève
  `SONDE_ANNULEE` et dont le gestionnaire relance toute autre erreur, **ou** dans un bloc qui attend une erreur
  nommée (`when sqlstate '…'`) et lève `NON TENUE` si elle ne vient pas. (Mon premier balayage en signalait 2 à
  tort — les sondes GL004 ① et ①bis, dont le gestionnaire vérifie le message au lieu de `null` : la garde de 2.3
  devra accepter cette forme.) L'annulation d'un sous-bloc n'est **ni** un UPDATE **ni** un DELETE : le verrou du
  grand livre ne la bloque pas, et aucune ligne n'en reste.
- **Sorties externes** : dans tout le dépôt, `net.http_post` n'apparaît que dans le pilote des tâches
  (`purges_rgpd_pg_cron`, `verdict_ecrit_par_la_tache`) ; **aucune** fonction sondée ne l'atteint. Aucun
  `http_*`, `dblink`, `pg_notify` ; aucune fonction du lot n'insère de notification ni n'envoie d'e-mail (ils
  partent du TypeScript). Version de pg_net : déclarée sans version — **NON VÉRIFIÉE** (pas de base) ; sans objet
  pour les sondes.
- **Séquences** : seule `grand_livre.id` est une identité (`bigint generated always as identity`) ; toutes les
  autres tables touchées sont en `uuid`. Chaque sonde annulée — comme chaque GL005 ou transaction avortée —
  **consomme des numéros** : les trous sont **structurels**. Rien dans le code ni la doc ne suppose la
  contiguïté ; à écrire pour l'étape 4 : l'écran et le batch ne lisent **jamais** un trou comme une ligne manquante.

### 1.3 — Le refus au plafond porte la pièce de la recherche

`lib/matching/rerank.ts:423-426` relit le budget **entre chaque lot** avec `args.journal` ; les deux sens le
passent (`lib/matching/index.ts:423,433`, `lib/matching/run-for-expert.ts:449`) ; `budgetDisponible()`
(`lib/ai-budget.ts:150-212`) écrit `refus_plafond_atteint` par `journaliserRefusPlafond()` (l. 230) sous ce
contexte, puis la notation s'arrête (`arret_code: 'plafond_atteint'`). **Même pièce : oui.** Pour le
chevauchement et l'éligibilité d'une recherche : voir 0.2 ①.

### 1.4 — Surcharges

Balayage de **toute** la chaîne (123 fonctions) : signatures créées moins signatures supprimées par `drop
function`. **0 surcharge.** Éprouvé : en ignorant les `drop`, il en retrouve 7 (dont les 4 que le lot a
supprimées : `maj_membre_organisation`, `programmer_suppression_compte`, `ouvrir_depot_candidature`,
`set_default_package`). Limite : une surcharge posée à la main sur staging hors migration lui échappe — d'où la
vérification **en base** de 2.4.

### 1.5 — Les clés contre la liste blanche

**Aucun contrôle ne compare aujourd'hui les clés écrites par un appelant à sa liste blanche** (les sondes
recopient la forme à la main). Mesuré : **62 sites** (28 TypeScript, 34 SQL), **0 écart** ; le balayage mord
(une clé retirée → 1 écart nommé). **Angle mort** : 4 détails dynamiques au premier niveau
(`effacer_adresses_ip`, `regler_durees_place`, `set_default_package`, `journaliser_verification`), et surtout
**7 RPC appelées depuis 11 sites** (`regler_tarif_ia`, `regler_plafonds_ia`, `regler_quota_ia`,
`regler_matching`, `regler_note_jugement`, `regler_durees_place`, `set_default_package`, plus `statuer_sur_*` via
le relais `journaliser_verification`) dont le détail est **construit dans le TypeScript** et passé en jsonb :
ces clés-là ne sont comparées nulle part. 2.5 doit les couvrir.

### 1.6 — Suspendre l'occupant du siège plateforme

**Refus nommé**, avant la RPC : `refuseAdminActionOnTarget()` rend `self_forbidden` (son propre compte) ou
`target_is_admin` (tout autre administrateur) — l'occupant du siège est l'un ou l'autre. Traduits dans les 4
langues, gérés par l'écran (`app/[locale]/admin/utilisateurs/[id]/page.tsx:270`). **Reste** : si la cible
**devient** administrateur entre la lecture et l'écriture, `changer_statut_compte` lève 23503 et la route
répond `db_error` (500) — un code générique. 2.6 : nommer ce cas dans la fonction.

### 1.7 — Ce que la base vide ne prouve pas

1. **`grand_livre_une_fois_idx` (UNIQUE)** posé sur un `grand_livre` **déjà rempli** par le socle
   (`ip_effacees`, `reglage_modifie`) : un doublon (pièce, action, sujet) ferait échouer la création.
2. **`grand_livre_actions.cles_detail NOT NULL DEFAULT '{}'`** : sans risque (le défaut remplit), vérifiable.
3. **Trois colonnes nullables** (`candidature_depots.piece`, `publications.expiration_constatee_at`,
   `candidatures.fermeture_constatee_at`) : les lignes existantes restent à NULL ; `piece` NULL est géré par le
   rejeu (`estPiece()`).
4. **Le passif des deux constats** : au premier passage, toute annonce publiée **déjà** expirée et toute
   candidature dévoilée dont l'échange est **déjà** fermé seront constatées — des lignes datées du constat, pas
   de l'expiration (voulu, §C.21). Le volume est à lire.
5. **La tâche `constats_trigger`** : planifiée par la migration, elle exige les deux secrets du Vault
   (`cron_secret`, `purge_cron_base_url`) — sans eux, elle lève à chaque passage.
6. **Quatre signatures SUPPRIMÉES** (`maj_membre_organisation` à 4 arguments, `programmer_suppression_compte(uuid,
   timestamptz)`, `ouvrir_depot_candidature` à 4 arguments, `set_default_package(uuid)`) : le code **en ligne** les
   appelle encore. Entre le `db push` et le déploiement, ces gestes échouent. Ordre imposé : push **puis**
   déploiement immédiat (déjà écrit dans les en-têtes).
7. **La sonde §E.69** (`journal_paiement`) exige que l'index de `transactions.stripe_invoice_id` soit **partiel** :
   à lire sur staging.
8. **Surcharges hors migration** (1.4) : le nombre de signatures par nom, pour les 35 fonctions.
Ces huit points font la requête unique de 2.8.

### 1.8 — Le plan de tests

- **Outil** : pgTAP par `npx supabase test db --local` (CLI 2.108.0 : `--local`, `--linked`, `--db-url` —
  **toujours `--local` explicite, jamais `--linked`** ; un contrôle le gardera dans la doc et les scripts).
  `db lint --help` m'a été refusé : la présence de `--fail-on` est **à vérifier par Youssef**.
- **Où** : `supabase/tests/database/grand_livre/*.test.sql` (dossier absent aujourd'hui). Chaque fichier :
  `begin; select plan(n); … select * from finish(); rollback;` — rien ne survit.
- **Fabriques par les chemins normaux** : un compte par `insert into auth.users` avec `raw_user_meta_data`
  (`role`, `domain_slug`) → `on_auth_user_created` → `handle_new_user`, **et le test vérifie que
  `public.users` existe** (le trigger avale ses erreurs) ; une organisation par `creer_organisation_avec_admin()`
  (elle naît avec son siège) ; un expert approuvé par `statuer_sur_expert()` ; une annonce publiée par
  `publier_annonce()` ; une candidature par `ouvrir_depot_candidature()` + `inserer_candidature_jugee()`. Aucun
  `session_replication_role`, aucun trigger désactivé. Les fabriques sont des fonctions `pg_temp` partagées par
  inclusion (`\ir _fabriques.sql`) — **à confirmer au premier lancement** (inclusion psql sous `test db`) ;
  repli : recopiées par fichier.
- **Combien** : **24 fichiers** — un par geste sauté (23) + un pour les six RPC de réglage sans sonde et
  `set_default_package` ; `journaliser_verification` est couverte par le fichier des arbitrages. Chaque geste :
  effet métier, **exactement une** ligne sous sa pièce, détail conforme, chemin de refus et rejeu quand la
  fonction en a. Estimation ~160 assertions. Critère : **35 fonctions, 35 éprouvées, 0 jamais exécutée.**

## PHASE B — APRÈS LE FEU VERT DU REJEU LOCAL (décisions de Youssef, 26/09/2026)

1. **Les 7 gestes deviennent des actions** : inscription d'un expert, préinscription d'une organisation,
   création d'un administrateur, annonce créée en brouillon, mission écartée par l'expert, événement Stripe
   rouvert à la main, tâche lancée à la main.
2. **La règle des rattachements** : le nom d'une action dit ce qui s'est passé — si filtrer sur une action
   rend des lignes qui ne sont pas ce que son nom annonce, c'est une action distincte. **Distinctes, imposées** :
   `taxonomie_modifiee`, `ecosysteme_modifie`, `organisation_modifiee`, `identite_modifiee`,
   `cv_reinitialise` (son détail dit que le profil sort de la vitrine). **Les neuf autres rattachements**
   de §H.3 ter : appliquer la règle, garder ceux qui la tiennent, rendre la liste gardé/séparé.
3. **Les 7 routes hors périmètre sont confirmées** — chacune ÉCRITE dans la liste d'exclusion du contrôle,
   avec sa raison (aucune exclusion silencieuse).
4. **Critère de fin** : 55 + 7 + les actions séparées. CHAQUE action a EXACTEMENT UN appelant, sauf le
   nettoyage (`journal_nettoye`), qui vient avec l'écran. Le rapport donne le compte exact. Le contrôle
   devient STRICT et la mesure des routes devient un contrôle (exceptions nommées, §G.8).
5. Puis l'**étape 3** (colonne `piece` sur les sous-journaux) et l'**étape 4** (l'écran et le batch).

## Validations à rejouer avant chaque commit

`npx tsc --noEmit` · `npx next build` (séparément, §E.2) · `npm run lint` (base 65/25, tenue par `diag-lint-cliquet`) · `node scripts/diag.mjs`
(série statique ; 5 muets attendus : 3 écartés parce qu'ils écrivent, 2 qui plantent sur l'environnement Windows) ·
mutation du nouveau contrôle, **après** le commit.

## ⚠️ Les migrations du lot n'ont JAMAIS tourné (§E.70) — HISTORIQUE

> **Ce n'est plus vrai** : depuis, rejouées en local par Youssef (ARRÊT 10), puis appliquées sur staging le
> 28/09/2026. La règle qui en sort reste : **le rejeu sur base jetable avant staging n'est pas une formalité.**

Mesuré le 26/09/2026 : 22 sondes ne demandant aucune donnée auraient levé sur une base vierge — donc
aucune migration de l'étape 2 n'avait été rejouée. Corrigées en place (non appliquées nulle part) et
gardées par un contrôle de classe. **Le rejeu sur base jetable avant staging n'est pas une formalité.**

## Migrations depuis `origin/feat/sprint-archi-orga`

`git diff --name-only origin/feat/sprint-archi-orga -- supabase/migrations` — à rejouer sur une base jetable
(`npx supabase db reset --local`) avant staging (§G.4 bis).
