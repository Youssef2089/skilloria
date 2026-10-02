# Reprise — worktree S3 (`skilloria-s3`) — lot « validation des annonces »

> Le journal du worktree S3 pour ce lot. `docs/reprise.md` reste au principal. Les entrées proposées pour
> `docs/architecture.md` et `docs/pieges.md` sont **à numéroter par le principal** (dernière partie).

**Mise à jour : 02/10/2026** (lot daté du 03/10/2026 par sa plage de migrations). Branche `lot/validation-annonces`,
partie de `feat/sprint-archi-orga` à `e27fa56`. Aucun `git push`, aucune écriture en base, ni Docker ni base lancés.

## 0. La reprise — ce que la session précédente avait laissé

**Rien.** À la reprise, le dossier était sur `lot/validation-annonces`, tête `e27fa56` (le commit de départ),
**aucun commit** depuis, **aucun fichier modifié ni non suivi**, pas de `docs/reprise-s3.md`. La session interrompue
n'a rien écrit sur disque : le lot a été fait entièrement dans cette session.

## 1. Ce que Youssef a vu

Un besoin de sous-traitance noté 5/10 par la vérification automatique restait « En attente de validation » ; sous
« Validation », l'administration n'offrait qu'Organisations, Experts et Domaines d'adresse. Toute annonce notée sous la
note de publication automatique restait bloquée **pour toujours** — `publier_annonce()` le disait elle-même : « sa mise
en ligne ultérieure, si elle existe un jour, passera par ici ».

## 2. Ce qui est fait, point par point, et ce qui le prouve

### ① L'entrée « Annonces » sous « Validation »
- **Fait.** `/admin/annonces` ([page](../app/[locale]/admin/annonces/page.tsx)), sur le modèle exact d'`experts` : onglets
  **En attente · Validées · Refusées · Toutes**, compteurs exacts (`?counts=1`), plafond de 500 lignes **dit** à
  l'écran, badge d'écosystème. Une seule liste pour les annonces des organisations (client, cabinet, ESN) **et** les
  besoins de sous-traitance des experts — ce sont toutes des `publications`, la parité est par construction.
- Les onglets : En attente = `pending_review` ; Validées = toute annonce passée en ligne (`published_at` non nul), avec
  sa **voie** (automatique ou administrateur) ; Refusées = `rejected` ; Toutes = les trois (un brouillon jamais soumis
  n'y est pas).
- Route [GET /api/admin/annonces](../app/api/admin/annonces/route.ts), `requireAdmin`. Entrée de menu dans
  [lib/nav-config.ts](../lib/nav-config.ts) et son icône dans le cadre admin (rien d'autre n'y est touché).
- **Prouvé par** : `tsc`, `next build`, lint ; `diag-memoire-exacte` (l'écran est documenté, §P2.4) ;
  `diag-embeds-ambigus` (les deux clés étrangères vers `users` sont nommées, §E.18).

### ② La fiche
- **Fait.** `/admin/annonces/[id]` ([page](../app/[locale]/admin/annonces/[id]/page.tsx)),
  [GET /api/admin/annonces/[id]](../app/api/admin/annonces/[id]/route.ts) :
  - le **contenu** par les fonctions communes : `PUBLICATION_SYNTHESIS_SELECT`, `loadReferentielLabels`,
    `buildPublicationSynthesis` au serveur, `<PublicationSynthesisLine>` à l'écran — un champ que le principal
    ajoute à la synthèse apparaît ici sans retouche ; plus branche, spécialités (« Autre : … »), zones, compétences,
    description ;
  - la **vérification automatique en mots** ([lib/validation-annonces/raisons.ts](../lib/validation-annonces/raisons.ts)) :
    une phrase (« Note de 5/10, en dessous de la note de publication automatique », « Signalement qui empêche toute
    mise en ligne automatique… », ou « La vérification automatique n'a pas pu se prononcer »), les signalements
    traduits (`contact_info` → « Coordonnées personnelles en clair »), un signalement inconnu **compté**, jamais
    affiché ; le commentaire du modèle, où un code cité est **remplacé par son libellé** ; le message interne d'une
    vérification qui n'a pas jugé (français technique, nom de fournisseur) n'est **pas** montré ;
  - l'**auteur** (nom, e-mail) et son **organisation** (nom, type — dont « Expert indépendant (organisation
    personnelle) ») ;
  - la décision passée : validée par qui et quand, mise en ligne automatique, refusée par qui, quand et pourquoi — et
    un **refus antérieur** quand l'annonce revient en revue.
- **Prouvé par** : `tsc`, `next build`, `diag-parite-i18n`, `diag-variables-i18n` (aucune clé brute) ; relecture.
  **Non prouvé** : le rendu réel (aucun serveur lancé).

### ③ Valider
- **Fait.** [POST /api/admin/annonces/[id]/valider](../app/api/admin/annonces/[id]/valider/route.ts) — **le même mécanisme
  qu'une publication directe** : place active réservée en base (`reserver_place_annonce`, fail-closed ; plafond
  atteint : refus nommé), puis **`publier_annonce()` elle-même** depuis `pending_review`, puis l'audit, puis la mise en
  relation **dans `after()`** par `runMatchingForPublication` (la fonction de la publication directe). Le compteur
  mensuel n'est **pas** consommé une seconde fois : il l'a été à la soumission, et la publication ne le rend pas quand
  l'annonce part en revue.
- **Pourquoi `publier_annonce()` et pas une fonction nouvelle** : `annonce_publiee` a **un** écrivain (§D.26) ; une
  `valider_annonce()` en aurait fait deux. La signature ne change pas ; la fonction relit l'état d'avant **sous
  verrou** et en **dérive** la voie. Sur la voie administrateur : réservée à un administrateur (**42501** sinon), mise
  en ligne seulement, verdict de la machine **conservé** (ses trois paramètres doivent être nuls, 22023),
  `verified_by` / `verified_at` posés. La ligne porte `voie = 'administrateur'` (et `'automatique'` sur la publication
  directe). Phrase du journal : « Youssef Cherif a validé l'annonce « … » après examen et l'a mise en ligne (la
  vérification automatique de sa qualité lui avait donné 5/10). »
- **L'anti-relance est intacte, et désormais tenue EN BASE aussi** : la route de publication refuse toujours
  `pending_review` (`PUBLISHABLE_FROM = ['draft']`, non touchée) ; et un auteur qui appellerait la RPC depuis la revue
  reçoit 42501.
- **Prouvé par** : `supabase/tests/database/grand_livre/annonce_refusee.test.sql` (16 assertions, **à lancer**) ;
  `diag-grand-livre` (preuve SQL réécrite pour le nouveau corps, preuve de la route ajoutée — **éprouvées par
  mutation** : garde 42501 retirée → rouge ; écriture directe du statut ajoutée à la route de refus → rouge) ;
  `diag-ecritures-effectives` (l'écriture sous verrou exige désormais son compte, `exiger_ecriture`, EC001).

### ④ Refuser, avec un motif
- **Fait.** [POST /api/admin/annonces/[id]/refuser](../app/api/admin/annonces/[id]/refuser/route.ts) → `refuser_annonce()`
  (nouvelle) : garde administrateur, motif obligatoire (22023), `pending_review` → `rejected`, qui, quand, **motif sur
  la ligne métier** (`review_reason`), et la ligne **`annonce_refusee`** — action **nouvelle**, validée par Youssef,
  dans la liste fermée (SQL et TypeScript), liste blanche `type, organization_id, verification_score` (**jamais le
  motif**, texte libre), phrase en quatre langues, test. Motif borné à 2 000 caractères (borne technique, la même que
  le refus d'un expert), compteur à l'écran, erreur en ligne sous le champ.
- **Prouvé par** : le même test pgTAP (refus, motif rogné, ligne unique sans le motif, garde, motif vide, rejeu,
  annonce déjà validée) ; `diag-grand-livre` (un écrivain, sa preuve SQL et sa preuve de route) ;
  `diag-tests-grand-livre` ; `diag-journal-lisible` (la phrase **exécutée** dans les quatre langues, aucune clé ni code —
  **éprouvé par mutation** : la variante « validée » rendue inatteignable → rouge, « gabarit mort »).

### ⑤ L'auteur est prévenu — et la resoumission
- **Prévenu : fait.** [lib/validation-annonces/avis.ts](../lib/validation-annonces/avis.ts) : dans la **cloche** (une ligne
  `notifications`, sous la pièce du geste, lien vers l'annonce dans **son** espace — entreprise, ou section
  Sous-traitance de l'expert) et par **e-mail** (dans `after()`), **dans la langue de l'auteur**, motif compris pour un
  refus. Les liens d'e-mail passent par l'adresse de l'écosystème de l'annonce (`expertSiteOrigin`, §E.83) ; un
  e-mail qui ne peut pas partir juste ne part pas, et le journalise. La réponse dit à l'administrateur si la cloche a
  été écrite (« Son auteur n'a pas pu être prévenu… »), si l'auteur n'a plus de compte, ou s'il n'a pas pu être
  **lu** (alors ni la cloche ni l'e-mail ne partent — trois états distincts, aucun ne se fait passer pour un autre).
> **MISE AU VRAI (regroupement, ARRÊT 28, puis sa relecture, points 1 et 12)** — la resoumission ci-dessous est **FAITE**,
> avec deux écarts au changement proposé : une annonce refusée ne revient au brouillon que si un champ **QUE LE CONTRÔLE DE
> L'IA LIT** a changé (pas « au moins un champ » : changer la branche, les spécialités ou les zones aurait fait rejuger le
> même texte) ; et la nouvelle soumission **NE CONSOMME PAS** le compteur mensuel (décision de Youssef) — la phrase « le
> compteur mensuel sera consommé de nouveau » décrit la règle d'avant. Détail : architecture §D.50 ; contrôle
> `diag-resoumission`.

- **Resoumission : ⛔ ARRÊT — elle demande des fichiers d'un autre périmètre.** **Le chemin n'existe pas** (vérifié) :
  `PATCH /api/publications/[id]` n'édite que `draft`, `suspended`, `archived` ; la carte d'annonce et la fiche
  d'annonce côté organisation n'envoient vers « Modifier » que ces trois statuts ; la vue Sous-traitance de l'expert
  ne connaît pas `rejected`. Les trois fichiers relèvent des écrans et de l'édition de l'annonce (le lot du principal
  y ajoute ses champs). **Je ne les ai pas touchés.** Le changement proposé, minimal :
  1. `app/api/publications/[id]/route.ts` : ajouter `'rejected'` à `EDITABLE_STATUSES`, et — **seulement si au moins
     un champ change** (la route compare déjà, §D.33) — écrire `status: 'draft'` dans le même `update` quand le statut
     lu est `rejected`. Une annonce refusée ne revient au brouillon que **modifiée** : la publication qui suit fait
     juger **le texte modifié** par la vérification automatique, et l'anti-relance tient (un texte inchangé reste
     refusé, la RPC refuse toujours la revue à un non-administrateur).
  2. `components/dashboard/AnnonceCard.tsx` et `app/[locale]/dashboard/entreprise/annonces/[id]/page.tsx` : ajouter
     `'rejected'` à leur `EDITABLE_STATUSES` (et afficher `review_reason` sur la fiche) ; la vue Sous-traitance de
     l'expert : le même lien pour un besoin refusé.
  3. Ajouter alors à l'avis de refus la phrase « Vous pouvez modifier votre annonce et la soumettre à nouveau » — **pas
     écrite aujourd'hui** : elle promettrait un chemin qui n'existe pas.
  Le compteur mensuel sera consommé de nouveau à la nouvelle soumission (règle actuelle de la publication) : à
  arbitrer si l'on veut qu'une resoumission après refus soit gratuite.

## 3. La migration

| Fichier | Ordre | Ce qu'elle fait |
|---|---|---|
| `20261003030000_validation_annonces.sql` | **AVANT** le déploiement | action `annonce_refusee` (famille annonce, statut imposé `reussi`, liste blanche) ; clé `voie` **ajoutée** aux listes blanches de `annonce_publiee` et `sous_traitance_publiee` ; `publier_annonce()` **redéfinie, signature inchangée** (voie dérivée sous verrou, garde administrateur sur la sortie de revue, verdict conservé, `exiger_ecriture`) ; `refuser_annonce()` **nouvelle**, fermée au navigateur. Postcondition de **structure** seulement (§E.77), qui nomme le test. |

Pourquoi AVANT sans risque (§E.72, §E.91) : le code en ligne (`e27fa56`) appelle `publier_annonce()` avec
`['draft']` ; sur ce chemin le corps fait ce qu'il faisait (plus la clé `voie`). Les deux refus nouveaux ne visent que
la sortie de `pending_review`, que ce code ne demande jamais. Rien n'est retiré, aucune clé ôtée, aucun droit repris.
`diag-deux-temps` : vert. `supabase/verifications/staging-avant-push.sql` : `refuser_annonce` ajoutée à « ce que le
push crée » (`diag-requete-staging` vert).

## 4. Les tests de base attendus

**65 fichiers, 687 assertions planifiées** (au départ `e27fa56` : 64 fichiers, 671). Le nouveau fichier
`supabase/tests/database/grand_livre/annonce_refusee.test.sql` porte **16 assertions**. Aucun test existant n'a été
modifié ; ceux qui appellent `publier_annonce()` depuis un brouillon (`annonce_publiee`, `sous_traitance`, la fabrique
`fab_annonce_publiee`) restent valables tels quels. **Je ne les ai pas lancés** (ni Docker, ni base) : seul
`npx supabase test db --local` le dira.

## 5. Les validations exécutées (sur l'état final)

| Validation | Résultat |
|---|---|
| `tsc --noEmit` | **0 erreur dans le code.** Deux lignes, toutes deux dans `.next/` : un validateur **généré** par un ancien `next dev` cite `app/api/profile/cv/route.js`, route supprimée en `fe2d406` (le rapport S1 notait le même cas). |
| `next build` | **Compilation réussie** (Turbopack, 48 s) ; la vérification des types **s'arrête sur ce même fichier périmé** `.next/dev/types/validator.ts`. Je n'y ai pas touché (lecture de `.next/dev` refusée sur ce poste). **Étape de Youssef** : supprimer `.next/dev` (artefact ignoré par git), puis relancer `npm run build` — la suite du build (collecte des pages) n'a donc **pas** tourné ici. |
| lint | aucun avertissement ni erreur sur les fichiers du lot ; `diag-lint-cliquet` vert (le compte n'a pas monté — deux erreurs `set-state-in-effect` évitées en écrivant l'état à l'arrivée de la réponse, le passage à « chargement » se faisant au clic) |
| parité i18n | `diag-parite-i18n` vert, `diag-variables-i18n` vert, `diag-refus-actionnables` vert |
| cliquets | `diag-migration-donnees` (plage), `diag-echec-silencieux`, `diag-ecritures-effectives`, `diag-expert-name-masking` : verts |
| série complète `node scripts/diag.mjs` | **125 verts, 0 rouge, 0 n'a pas tourné**, 6 écartés par construction (ils touchent la vraie base) — le même compte qu'au départ |
| mutation (§G.5) | 4 mutations, 4 rouges : garde 42501 de `publier_annonce` retirée ; garde de transition de `refuser_annonce` retirée ; écriture directe du statut ajoutée à la route de refus ; phrase « validée » rendue inatteignable. Fichiers restaurés à l'identique. |
| tests pgTAP | **non lancés** (ni Docker ni base) |

> **MISE AU VRAI DE CE TABLEAU (relecture de l'ARRÊT 28, point 12)** — ce qui était vrai sur la branche S3 seule ne l'est
> plus tout à fait après le regroupement, et deux lignes ne se vérifiaient pas :
> · **tests pgTAP** : `annonce_refusee.test.sql` porte désormais **18** assertions (16 + la date de soumission, point 8) ;
>   le total de la première livraison est **748** (ARRÊT 28, relecture) — « 65 fichiers, 687 » valait pour S3 seule ;
> · **`next build`** : **vert** sur `lot/regroupement`, `.next/dev` absent — la suite du build (collecte des pages) a tourné ;
> · **lint des fichiers du lot** : vérifié à la relecture (`npx eslint` sur les trois dossiers de S3) — aucune erreur, aucun
>   avertissement : la ligne tient ;
> · **série complète** : « 125 verts, le même compte qu'au départ » ne se vérifie pas (S1 et S2 mesuraient 124 au départ,
>   un contrôle hors délai) ; la mesure qui fait foi est celle du regroupement (ARRÊT 28 de `docs/reprise.md`) ;
> · **ce que S3 ne voyait pas** et que la relecture a corrigé : la validation n'appliquait pas le prédicat entier de la
>   publication ni la garde de l'expert auteur (points 1 du regroupement, 3) ; une décision déjà prise ne rechargeait pas la
>   fiche (6) ; « 0/10 » pour une annonce non jugée (7) ; « soumise le » lisait `updated_at` (8) ; deux validations
>   simultanées rendaient la place de la première (9).

## 6. Fichiers partagés touchés (le moins possible)

- `messages/{fr,en,es,de}.json` : **ajouts seuls** (fusion qui refuse d'écraser) — l'espace `validation_annonces`, plus
  `admin_back_office.sidebar.nav_annonces`, `journal.actions.annonce_refusee`, et les phrases
  `journal.phrases.annonce_publiee.validee(_note)`, `sous_traitance_publiee.validee(_note)`, `annonce_refusee.*`.
  Conflits : par UNION.
- `lib/nav-config.ts` (mon entrée), `app/[locale]/admin/layout.tsx` (son icône seule).
- `lib/journal/actions.ts`, `lib/journal/phrase.ts` (l'action nouvelle, la clé `voie`, deux phrases).
- `CLAUDE.md` : **seulement** la ligne de ma plage en §G.2. (Le « rejoue les 187 migrations » de §G.4 bis n'est pas
  touché : il deviendra 188 + les migrations des trois autres lots — **au principal, à la fusion**.)
- `docs/produit.md` §P2.4 : la ligne de l'écran `annonces`.
- `docs/pieges.md` : la mesure datée de `diag-migration-donnees` (188 migrations, 80 insertions vues, 67 analysées,
  3 358 valeurs), la précédente gardée derrière — exigée par `diag-memoire-exacte`, qui lit ce compte. **Chaque lot
  reprendra cette même ligne : conflit certain à la fusion, à refaire sur le total.**
- `supabase/verifications/staging-avant-push.sql` : une ligne (`refuser_annonce`).
- Contrôles : `diag-grand-livre` (preuves de `publier_annonce` réécrites, preuves des deux routes et de
  `refuser_annonce` ajoutées), `diag-journal-lisible` (les valeurs de la clé `voie`), `diag-ecritures-effectives`
  (l'entrée de gel de `publier_annonce` retirée — elle exige désormais son compte — celle de `refuser_annonce`
  ajoutée, LÉGITIME), `diag-expert-name-masking` (gel : l'e-mail de l'auteur lu pour lui écrire, LÉGITIME).

## 7. Propositions pour la mémoire — à numéroter par le principal

**Décision (§D)** — *Une annonce en revue ne sort que par un administrateur, et par le mécanisme de la publication.*
Valider = `publier_annonce()` depuis `pending_review` (un écrivain par action, §D.26), place réservée, mise en relation
dans `after()`, compteur mensuel non reconsommé ; la voie (`automatique` | `administrateur`) est **dérivée** de l'état
d'avant, sous verrou, et écrite au journal ; le verdict de la machine est conservé. Refuser = `refuser_annonce()`,
motif obligatoire sur la ligne métier, jamais au journal ; action `annonce_refusee`. L'auteur est prévenu dans sa
langue (cloche + e-mail). La garde administrateur est **en base** (42501) : l'anti-relance ne dépend plus de la seule
route.

**Architecture (§B / tableau des écrivains, la ligne `annonce_publiee`)** — corriger « la transition (`draft` →
verdict) … rejoués dans l'UPDATE » : elle est désormais relue **sous verrou** (`select … for update`), l'écriture par
l'identifiant exige son compte (EC001), et la ligne porte `voie`. Ajouter la ligne `annonce_refusee` |
`refuser_annonce()` | `type`, `organization_id`, `verification_score` | transition dans l'UPDATE (le `WHERE` est la
garde), zéro ligne rend null.

**Piège (§E)** — *Une vérification qui n'a pas jugé écrit la même forme qu'un verdict, et un message interne.*
Fournisseur inactif, plafond de dépense, modèle indisponible : tous écrivent note 0, aucun signalement, et un texte
technique en français (avec le nom du fournisseur) dans `verification_data.notes`. Affiché tel quel, il montrait un
code à l'administrateur et une « note 0/10 » qui n'en est pas une. La forme est reconnue (`raisonsDuVerdict`,
`non_aboutie`) — **une heuristique**, dite comme telle ; la vraie parade serait un champ `result` écrit avec le
verdict (`ai.result` existe, il n'est pas gardé). *Contrôle* : aucun — relecture.

**Piège (§E)** — *`verified_by` survit à la décision suivante.* Une annonce refusée puis modifiée et republiée
automatiquement garde l'ancien `verified_by` : sa seule présence ne dit pas « validée par un administrateur ». La voie
se lit `verified_at >= published_at` (`voieDeMiseEnLigne`, même `now()` sur la voie administrateur) — ou, mieux, au
grand livre. *Contrôle* : aucun — relecture.

## 8. Les étapes de Youssef

1. Relire ce rapport ; **arbitrer l'ARRÊT du point ⑤** (resoumission) : qui touche les trois fichiers, et si une
   resoumission après refus consomme le compteur mensuel.
2. Supprimer `.next/dev` (artefact périmé, voir §5), puis `npm run build` — attendu vert.
3. Poste local, Docker en marche : `npx supabase db reset --local` → `npx supabase db lint -s public --level error`
   (sortie vide) → `npx supabase test db --local` (**65 fichiers, 687 assertions, toutes vertes** attendues).
4. Recette sur un poste local : une annonce notée sous la note de publication automatique apparaît dans « Annonces →
   En attente » ; la valider (en ligne, la recherche part, l'auteur voit la cloche, l'e-mail part si Resend est
   configuré) ; en refuser une autre avec un motif (cloche et e-mail, motif compris) ; vérifier les deux phrases au
   grand livre. Un besoin de sous-traitance d'expert, et une annonce d'organisation.
5. Puis la séquence de déploiement de §G.4 ter (requête de staging à jour de cette migration).

## Lu pour ce lot (règle de lecture)

CLAUDE.md ; AGENTS.md. Code : `app/api/publications/[id]/publish/route.ts`, `app/api/publications/[id]/route.ts`
(statuts éditables), `app/[locale]/admin/experts/page.tsx` et `[id]/page.tsx`, `app/api/admin/list-experts`,
`approve-expert`, `reject-expert` ; `app/[locale]/admin/layout.tsx`, `lib/nav-config.ts` ; `lib/journal/actions.ts`,
`contexte.ts`, `phrase.ts` (en-tête, dimensions, annonces) ; `lib/publication-synthesis.ts`,
`components/dashboard/PublicationSynthesisLine.tsx` (en-tête, props) ; `lib/verification/publication-verification.ts`,
`ai-publication-quality.ts` (forme du verdict) ; `lib/jugement/sujets.ts` ; `lib/notifications/catalog.ts`,
`dispatch.ts` (en-tête), `inapp-labels.ts` ; `lib/emails/locales.ts`, `templates.ts` (refus d'expert), `layout.ts`,
`brand.ts`, `domain-url.ts` ; `lib/collaboration-links.ts`, `lib/auth-routing.ts`, `lib/admin-guard.ts`,
`lib/publications/publishable.ts` ; `components/NotificationBell.tsx` ; `components/dashboard/AnnonceCard.tsx`
(statuts, lien). Migrations (contraintes réelles, §G.10) : baseline (`publications`, `notifications`,
`organizations`), `profil_annonce_multivalues`, `matching_trace_et_reprise`, `place_annonce_active`,
`journal_annonce_expiree`, `journal_annonce_publiee`, `journal_sous_traitance`, `grand_livre` (socle),
`grand_livre_refus_des_retirees` (signature de `journaliser`), `liste_blanche_par_action` (`exiger_ecriture`),
`journal_photo_et_cv`, `collaboration_experts`. Tests : `_fabriques.psql`, `annonce_publiee`, `sous_traitance`,
`compte_valide`. Contrôles : `diag.mjs`, `diag-grand-livre` (écrivains, preuves), `diag-tests-grand-livre`,
`diag-deux-temps`, `diag-requete-staging`, `diag-journal-lisible` (fabrication), `diag-routes-tracees`,
`diag-ecosystem-scope`, `diag-embeds-ambigus`, `diag-migration-donnees` (plages), `diag-memoire-exacte` (écrans),
`diag-echec-silencieux`, `diag-ecritures-effectives`, `diag-expert-name-masking`, `diag-hotes-ecosysteme`,
`diag-refus-actionnables`. Docs : `docs/produit.md` §P2.4 ; `docs/architecture.md` (recherche de la ligne
`annonce_publiee`) ; `docs/reprise-s1.md` (forme).
