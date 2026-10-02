# Reprise — worktree S2 (`skilloria-s2`)

> Le journal de reprise du worktree S2. `docs/reprise.md` reste au principal. Les entrées de `docs/architecture.md` et
> `docs/pieges.md` que ce lot appelle sont **proposées** en fin de fichier, sans numéro : le principal les intègre.

**Dernière mise à jour : 02/10/2026.** Branche `lot/alertes-recommandations`, partie de `feat/sprint-archi-orga` à
**`e27fa56`** (en ligne sur staging), arbre propre au départ, `npm install` fait. **Aucun `git push`, aucune écriture en
base, ni Docker ni base lancés.**

## ⛔ ARRÊT S2-1 — ALERTES, RECOMMANDATIONS ET CANDIDATURES (02/10/2026)

Constat de Youssef sur staging (compte d'essai Mehdi, freelance) : une mission affichée « Correspondance forte » sans
alerte ; une spécialité désactivée sans avis ni bouton ; une mission postulée restée recommandée ; « Correspondance forte »
deux fois avec une info-bulle interne ; « Échange ouvert jusqu'au 17 octob… » coupé, « Candidaté », « par l'entreprise » ;
plus le mineur du relecteur (message brut de Postgres).

**Lu avant d'écrire** (règle de lecture) : CLAUDE.md ; produit §P4.3 et le passage de §P1.3 sur la notification ;
architecture §D.36 ; pièges §E.33, §E.34, §E.38 (et l'index) ; les migrations des tables touchées — `matching_settings`
(`reglages_matching_et_depense`, `echelle_des_notes`, `filtre_notification_utilisable`), `matches` et `candidatures`
(baseline : CHECK de statut, unique `candidatures_publication_profile_unique`), `notifications` (baseline : CHECK canal et
statut ; `piece_sous_journaux`, `notifications_match`), `specialities` (baseline, `specialite_ecriture_et_avis_une_fois`),
`grand_livre` (`grand_livre`, `journal_devoilement_ouvert`) ; les tests pgTAP `matching/notifications_match`,
`grand_livre/mission_ecartee`, `grand_livre/candidature_deposee` et `_fabriques.psql` ; les contrôles qui touchent le lot
(`diag-deux-temps`, `diag-requete-staging`, `diag-lot-zones` §6, `diag-parcours-expert` §N, `diag-grand-livre`,
`diag-cles-i18n`, `diag-memoire-exacte` §D, `diag-lint-cliquet`).

### Le compte exact, point par point

| Point | Cause trouvée (dans le code) | Ce qui est fait | Prouvé par |
|---|---|---|---|
| **1. Alerte d'une mission recommandée** | Les deux sens du moteur (`lib/matching/index.ts`, `run-for-expert.ts`) ne posaient l'avis que si **`notify_enabled`** était vrai **ET** si le match était au palier **« fort »** (filtre de notification, 8/10). `notify_enabled` vaut **faux par défaut** et aucune migration ne l'ouvre (§P4.3 : « volontairement inactif »). Or le palier « Correspondance forte » ne dépend QUE de `notify_threshold`, et la pastille rouge de « Missions » ne lit que le statut du match : l'écran montrait une annonce forte et nouvelle, et rien ne partait — ni cloche (la ligne `notifications` n'est jamais créée), ni e-mail (le dispatcher n'est jamais appelé). *La valeur de `notify_enabled` sur staging n'est pas lue d'ici (aucune base) : requête ① ci-dessous.* | **La règle de Youssef, sans réglage qui la contredise** : chaque correspondance **FRAÎCHE** — donc chaque annonce qui vient d'entrer dans le flux — pose son avis dans la cloche et appelle le dispatcher (e-mail si l'expert l'a activé). `notify_enabled` n'est plus lu nulle part (colonne inerte, commentaire réécrit) ; `notify_threshold` ne règle plus que le **palier affiché**. `/admin/matching` : la case et le « filtre de notification » disparaissent, le champ devient « Note à partir de laquelle une annonce est une « Correspondance forte » », et la règle de l'alerte est **dite** (4 langues). La route n'accepte plus `notify_enabled`. « Vous serez notifié » (Missions, freelance et CDI) est désormais vrai sans condition. Un ré-run ne re-prévient personne (inserts frais seulement ; `notifyAndFlip` saute une paire déjà notifiée). | `diag-alertes-recommandations` §1 (classe : aucun lecteur de `notify_enabled` dans 574 fichiers ; l'envoi gardé par l'insertion fraîche seule, ancré sur le bloc, dans les deux sens) |
| **2. Avis de spécialité désactivée** | La route sait prévenir (`prevenir_retrait_specialite`, un avis par expert et par désactivation), mais **l'écran se taisait sur un succès** (le nombre d'avis posés n'était lu par personne), et **« Prévenir les experts » n'existait qu'après un code d'échec**, dans l'état local de la page. Une spécialité **déjà inactive** — désactivée avant que l'avis existe (le code en ligne déclaré dans `diag-deux-temps` était `1182e02`, antérieur à l'avis) ou simplement rechargée — n'avait **aucun chemin** pour prévenir ses experts. *NON VÉRIFIÉ en base : quand la spécialité de Mehdi a été désactivée, et sous quel code — requête ② ci-dessous.* | **L'état se relit à chaque affichage** (`lib/taxonomie/etat-des-avis.ts`, servi par `get-branch`) : sous chaque spécialité inactive, les experts qui l'ont encore, ceux qui ont reçu l'avis de **cette** désactivation, ceux qui restent — et **« Prévenir les experts » sur la ligne tant qu'il en reste** (la base ne prévient personne deux fois). Un succès se dit : « Spécialité désactivée. N experts ont été prévenus dans l'application » ; au rejeu « N experts de plus… » ; une lecture en panne le dit (jamais « tous prévenus »). Lectures par pages, incomplète = panne. | `diag-alertes-recommandations` §2 (**exécuté** sur une base simulée : 3 concernés / 1 prévenu / 2 à prévenir ; un avis d'une autre désactivation ne compte pas ; panne et lecture incomplète rendent un échec) |
| **3. Mission postulée** | La réconciliation **garde** le match d'une candidature (acte engagé, `preserved_with_candidature`), et le flux (`expertMissionsQuery`, `lib/missions/feed.ts`) ne filtrait que sur le statut du match. | Le flux **et son compteur** excluent la mission postulée par un **champ calculé en base**, `mission_postulee(matches)` (migration `mission_postulee`) : `.eq('mission_postulee', false)` dans la requête UNIQUE, lue par `/api/me/missions` (accueil « Missions recommandées » et page « Missions », freelance et CDI) et `/api/me/badges`. Pourquoi pas une liste : un `not in` grandit avec chaque candidature et **ne se découpe pas** (`lib/matching/tranches.ts`), et filtrer en mémoire fausserait le compte du badge. Le détail d'une mission postulée reste ouvert (suivi). | `diag-alertes-recommandations` §3 ; test pgTAP `matching/mission_postulee.test.sql` (7) |
| **4. Carte recommandée** | `MissionCastingCard` rendait le palier dans le bandeau **et**, une fois la mission vue, dans la pastille du corps (repli `tBadge('strong')`) ; le bandeau portait `title={tBadge('tooltip')}` — une phrase interne sur le moteur. | La pastille du corps ne dit plus que « Nouveau » ; l'info-bulle est retirée — et celles du même palier sur la liste « Missions » et le détail aussi (« Pourquoi cette annonce vous est proposée », qui n'expliquait rien). La clé `matching_badge.tooltip` reste (exigée par `diag-score-de-pertinence`), rendue nulle part. | `diag-alertes-recommandations` §4 (classe : la phrase interne n'est rendue par aucun fichier ; une occurrence du palier par carte) |
| **5. Candidature** | ① `StatusPill` est en `white-space: nowrap` dans des cartes en `overflow: hidden` (accueil « Mes candidatures », liste du suivi) : la date de « Échange ouvert jusqu'au … » était coupée. ② `candidatures_tracking.candidated_ago` disait « Candidaté ». ③ **Ce qui a ouvert l'échange une minute après la candidature : le dévoilement INCLUS** — au dépôt, la candidature la mieux notée est dévoilée automatiquement (`performUnlock(…, { auto: true })`, `lib/candidatures/depot.ts`) ; la frise disait « Échange ouvert par l'entreprise » pour tout dévoilement, et la cloche « L'entreprise souhaite échanger avec vous ». | ① `StatusPill` gagne `wrap` (passe à la ligne), posé sur les deux pastilles d'état de vie expert ; la ligne se replie. ② « Envoyée il y a … » / « Sent … ago » / « Enviada hace … » / « Gesendet vor … » (la clé côté organisation n'est pas touchée). ③ L'origine est **lue au grand livre** (`devoilement_ouvert`, clé `auto`, écrite dans la même transaction que la bascule) par `lib/candidatures/origine-devoilement.ts`, servie par `/api/me/candidatures` (`devoilement`) : « Échange ouvert automatiquement : votre candidature était la mieux notée à son arrivée » ; « par l'entreprise » seulement si c'est elle ; **inconnue (journal nettoyé, lecture en panne) : « Échange ouvert », sans nommer personne**. La cloche du dévoilement inclus dit la même chose. | `diag-alertes-recommandations` §5 (**exécuté** : `auto` vrai / faux / absent / autre action / panne ; 450 candidatures lues en 3 tranches) |
| **6. Mineur du relecteur** | `update-speciality`, branche `ecriture_refusee` : `cause: ecrErr.message` partait à l'écran, entre guillemets. | Un **motif nommé**, lu dans le code SQLSTATE (`lib/taxonomie/motif-refus-ecriture.ts`) : texte trop long, champ obligatoire vide, valeur invalide, règle du référentiel, référence absente, refus non classé — une phrase chacun, quatre langues ; le message brut reste au journal du serveur ; `db_error` ne le renvoie plus non plus. L'ordre d'affichage est borné au type `integer` (le seul dépassement possible). Au passage, sur cet écran : `db_error`, `lecture_indisponible`, `not_found` et une coupure réseau ont leur phrase (plus « Une erreur est survenue »). | `diag-alertes-recommandations` §6 (**exécuté** : chaque code a son motif) ; `diag-lot-zones` §6 réancré |

**Mutation (§G.5)** : 13 mutations, une par règle (l'envoi regardé par le palier, le sens expert filtré sur « strong », un
lecteur de `notify_enabled` qui revient, le filtre « postulée » retiré, l'info-bulle qui revient, la pastille sans `wrap`,
un code SQL mal classé, le message brut qui revient, l'avis d'une autre désactivation compté, l'origine inconnue
attribuée à l'entreprise, la frise « par l'entreprise » par défaut, le bouton renvoyé à l'erreur, le succès muet) :
**13/13 font rougir** `diag-alertes-recommandations`, chaque fichier restauré (empreinte de `git diff` identique avant et
après le banc).

### La migration

| Migration (par suffixe) | Ordre de passage | Ce qu'elle fait | Prouvée par |
|---|---|---|---|
| `…_mission_postulee` (plage S2, `20261003020000`) | **AVANT** le déploiement | crée `mission_postulee(matches)` (SQL, `stable`, fermée au navigateur, `service_role` seul) ; réécrit les commentaires de `matching_settings.notify_threshold` (le palier) et `notify_enabled` (inerte). **Ne restreint rien** — `diag-deux-temps` vert. Ne sème rien. | `matching/mission_postulee.test.sql` (7 assertions) ; postcondition de structure |

`supabase/verifications/staging-avant-push.sql` : la fonction ajoutée à `prochain_push_cree` (`diag-requete-staging` vert).
La colonne `notify_enabled` **n'est pas supprimée** : une suppression restreint (le code en ligne la lit), elle part dans un
lot APRÈS, si Youssef le décide.

### Les tests de base attendus

**678 assertions dans 65 fichiers** (`e27fa56` : 671 dans 64 ; +7, `matching/mission_postulee.test.sql`).
`diag-tests-grand-livre` : toute fonction créée depuis le socle est appelée par un test. **Aucun test n'a tourné ici** :
`npx supabase test db --local` est à Youssef.

### Les validations

| Validation | Résultat |
|---|---|
| `npx tsc --noEmit` | **0 erreur dans le code.** Deux lignes, toutes deux dans des types GÉNÉRÉS périmés (`.next/types` et `.next/dev/types/validator.ts`, qui citent `app/api/profile/cv/route.ts`, supprimée par le principal) — le cas ⑦ du rapport S1. |
| `npm run build` | **Compilation réussie** (« Compiled successfully »), puis la vérification des types bute sur **le même fichier généré** `.next/dev/types/validator.ts`. Sa suppression (`.next/dev`, non versionné, recréé par `next dev`) **m'a été refusée** : je ne l'ai pas retentée. Étape ③ de Youssef ci-dessous. |
| Cliquet du lint | **50/23**, base inchangée (mesurée seule : dans la série, ESLint plante sous la charge — déjà le cas sur `e27fa56`). |
| Parité i18n, clés, variables | `diag-parite-i18n`, `diag-cles-i18n`, `diag-variables-i18n` : verts. |
| Série `diag-*` | Départ (`e27fa56`) : **124 verts, 0 rouge**, 1 qui n'a pas tourné (`diag-lint-cliquet`, ESLint sous charge), 6 écartés. Lot : voir « La série du lot » ci-dessous. |

### Contradictions et fichiers partagés — signalés

① **Le point 1 renverse une décision écrite** : §P4.3 (produit) faisait de `notify_enabled = false` un état
  **volontairement inactif** (« un moteur qui notifie 12 000 personnes sur un seuil deviné… »). La consigne de ce lot est
  explicite (« aucun réglage de l'admin ne doit pouvoir contredire cette règle ») : je l'ai suivie. **§P4.3, la ligne
  « Notifications actives » de §P3.2 et la description de `/admin/matching` en §P2.4 sont désormais fausses** — je ne les
  ai pas réécrites (fichier du principal) : propositions plus bas. La volumétrie redevient un sujet : le filtre du flux
  (0 par défaut) décide désormais AUSSI de qui est prévenu.
② **Deux contrôles d'autres lots figeaient l'ancien comportement**, je les ai réancrés dans ce lot parce que c'est
  exactement ce que la consigne change : `diag-lot-zones` §6 (le message brut → le motif) et `diag-parcours-expert` §N
  (M12 : « vous serez notifié » conditionnel → inconditionnel).
③ **Fichiers partagés touchés** (au plus juste) : `messages/*.json` (espaces `admin_matching`, `admin_taxonomie`,
  `candidatures_tracking` ; clés nouvelles + trois valeurs réécrites — `blocked_order`, `candidated_ago` côté expert,
  `err_ecriture_refusee` —, cinq clés `admin_matching.notify_*`/`field_notify*`
  **retirées** car leur texte devenait faux) ; `CLAUDE.md` (une ligne en §D, sans numéro) ; `docs/pieges.md` (le compte
  « Sur les **188** migrations », exigé par `diag-memoire-exacte` — chaque lot qui ajoute une migration le modifiera :
  conflit trivial) ; `supabase/verifications/staging-avant-push.sql` (une ligne) ; `components/ui/StatusPill.tsx` (une
  option facultative, `wrap`) ; les deux pages `dashboard/{freelance,cdi}/missions/page.tsx` (S1 retire des flèches et
  touche les en-têtes : conflit possible, de quelques lignes).
④ **Les nouveaux champs d'annonce** (principal) ne sont pas recodés dans les cartes : aucune carte de ce lot ne lit un
  champ d'annonce nouveau.
⑤ **Un avis posé AVANT que la pièce de désactivation existe** (sous une autre pièce) n'est pas compté comme reçu : un
  rejeu le reposerait. Seul cas : une spécialité désactivée pendant que `fbba63f` était en ligne, s'il l'a été — requête ③.

### Les étapes de Youssef

1. **Avant tout** (lecture seule, éditeur SQL de staging) — pour confirmer les causes que le code établit :
   ```sql
   -- ① le point 1 : l'interrupteur était-il fermé ? (attendu : false)
   select d.slug, m.notify_enabled, m.notify_threshold, m.feed_threshold
     from matching_settings m join domains d on d.id = m.domain_id order by d.slug;
   -- ② le point 2 : la spécialité de Mehdi — désactivée quand, avec quelle pièce, combien d'avis
   select s.name, s.active, s.updated_at, s.desactivation_piece,
          (select count(*) from profiles p where s.id = any (p.speciality_ids)) as experts,
          (select count(*) from notifications n where n.type = 'specialite_retiree' and n.entity_id = s.id) as avis
     from specialities s where not s.active order by s.updated_at desc;
   -- ③ des avis posés sous une autre pièce que la désactivation en cours (attendu : aucune ligne)
   select s.name, count(*) from notifications n join specialities s on s.id = n.entity_id
    where n.type = 'specialite_retiree' and n.piece is distinct from s.desactivation_piece group by s.name;
   ```
2. **Sur ce worktree** : `npx supabase db reset --local`, `npx supabase db lint -s public --level error` (sortie vide),
   `npx supabase test db --local` — **678 assertions attendues, 65 fichiers**.
3. **Le build** : supprimer `.next/dev` (généré, non versionné) puis `npm run build` — attendu vert.
4. **Sur staging, après déploiement** (migration AVANT, puis le code) :
   - un client publie une mission qui correspond à Mehdi → « Missions recommandées » ET **une ligne dans la cloche** ;
     un e-mail si Mehdi a l'e-mail à « Oui » ;
   - `/admin/matching` : plus de case, un champ « Note à partir de laquelle une annonce est une « Correspondance forte » »,
     et la règle de l'alerte écrite dessous ;
   - `/admin/taxonomie/<branche>` : la spécialité déjà désactivée de Mehdi affiche « Experts prévenus : 0 sur 1… » et le
     bouton **« Prévenir les experts »** → Mehdi reçoit l'avis ; recliquer ne le prévient pas deux fois (« Personne de plus
     à prévenir ») ; désactiver une autre spécialité affiche « N experts ont été prévenus » ;
   - Mehdi postule : la mission **quitte** « Missions recommandées » et « Missions », la pastille rouge baisse ;
   - la carte recommandée : « Correspondance forte » **une fois**, aucune info-bulle au survol ;
   - le suivi : « Envoyée il y a … », la pastille « Échange ouvert jusqu'au … » **entière** (passe à la ligne) ; si
     l'échange s'est ouvert seul : « Échange ouvert automatiquement : votre candidature était la mieux notée à son
     arrivée » ;
   - un refus de la base sur une spécialité : une phrase, plus de texte de Postgres.
5. Le rejeu des contrôles : `node scripts/diag-alertes-recommandations.mjs`, puis `node scripts/diag.mjs`.

### Ce qui n'est pas vérifié — dit

- Toute affirmation sur l'**état de staging** (valeur de `notify_enabled`, date de désactivation de la spécialité) : requêtes
  ①–③.
- Que PostgREST lise `mission_postulee` comme une colonne dans un filtre avec `count`/`head` : c'est son comportement
  documenté pour une fonction `stable` qui prend la ligne ; **non exécuté ici** (aucune base). L'étape 4 le montre.
- L'affichage : la coupure de la pastille et le libellé unique se constatent à l'écran (aucune automatisation de
  navigateur, à la demande de Youssef).

### Proposé au principal (sans numéro)

**Décision** (ligne en §D posée, détail à écrire en architecture §D) : *une annonce qui s'affiche prévient ; aucun réglage
ne le contredit* — le cas (les deux verrous, l'écran qui disait « fort » et « nouveau »), la règle (insert frais ⇒ avis),
ce qui reste réglable (le filtre du flux, qui décide désormais aussi de qui est prévenu ; le palier, qui ne décide plus que
d'un libellé), et ce qui est inerte (`notify_enabled`, à supprimer dans un lot APRÈS si décidé).

**Architecture** : §B.2 — la migration `mission_postulee` (le premier champ calculé PostgREST du dépôt : une fonction
`stable` qui prend la ligne, lue comme une colonne ; et pourquoi un filtre négatif qui grandit se pose en base) ; §C.3 — la
notification, réécrite ; §C.5 — l'origine du dévoilement, lue au grand livre (clé `auto`) ; §D.36 — l'état des avis relu,
le bouton permanent ; produit §P1.3, §P2.4 (`/admin/matching`, `/admin/taxonomie`), §P3.2 (« Notifications actives » et
« Seuil de notification » → « Palier Correspondance forte »), **§P4.3 à retirer de « volontairement inactif »**.

**Pièges** :
- *Une étiquette affichée et une alerte gouvernées par DEUX réglages différents se contredisent à l'écran* — le palier
  « fort » ne lisait que `notify_threshold`, l'alerte lisait aussi `notify_enabled` : l'expert voyait « Correspondance
  forte » et une pastille rouge, et rien ne partait. Ce qui est montré et ce qui prévient doivent lire la même règle.
- *Un bouton de rattrapage qui ne vit que dans l'état d'un échec disparaît au rechargement* — « Prévenir les experts »
  n'existait qu'après un code d'erreur, en mémoire de la page : le cas qu'il devait rattraper (une spécialité déjà
  inactive) n'y avait jamais accès. Un rattrapage se dérive de l'état PERSISTÉ, relu à l'affichage.
- *Un succès muet cache ce qui n'a pas été fait* — la réponse portait le nombre d'avis, l'écran ne le lisait pas : zéro
  avis et dix avis avaient le même visage.
