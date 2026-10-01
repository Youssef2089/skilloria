# Reprise — worktree S1 (`skilloria-s1`)

> Le journal de reprise du worktree S1. `docs/reprise.md` reste au principal. Le **pourquoi** vit dans la mémoire :
> architecture §D.40 à §D.44, pièges §E.100 à §E.105.

**Dernière mise à jour : 01/10/2026.** Branche `s1/corrections-recette`, partie de `feat/sprint-archi-orga` à
`13d1524` (déployée sur staging). Tag local `sauvegarde-avant-s1-recette` sur `7a2fd1f` (l'ancienne tête de
`feat/s1-ux-profil`, déjà contenue dans le tronc). Aucun `git push`, aucune écriture en base.

## ⛔ ARRÊT S1-1 — RECETTE STAGING DU PARCOURS EXPERT : LES CORRECTIONS D'ÉCRANS (01/10/2026)

Constat de Youssef sur staging (01/10/2026, compte d'essai freelance), quatorze points.

**Lu avant d'écrire** (règle de lecture) : CLAUDE.md ; docs/reprise.md, ARRÊTS 14 à 20 ter ; docs/pieges.md §E.82 à
§E.89 ; architecture §B.1, §B.2 (⑨ et les migrations de l'ARRÊT 19 et de la recette staging), §D.31, §D.32 ; produit
§P2.2 à §P2.4 ; les migrations des tables touchées (`specialities`, `profiles`, `publications`, `profile_languages`,
`notifications`, buckets `cv` et `avatars`, `listes_profil_atomiques`, `analyse_cv_tolerante`,
`specialite_autre_publiable`, `travaux_ia`) ; les tests pgTAP qui écrivent des langues. **À la reprise** : le diff
du principal de `13d1524` à `7f5ce13` sur les fichiers communs (`app/api/profile/route.ts`,
`app/api/admin/update-speciality/route.ts`, `scripts/diag-tests-grand-livre.mjs`) ; `scripts/diag-routes-tracees.mjs`
(les exclusions) ; `scripts/diag-signature-de-fonction.mjs` (la forme du filet).

### La session interrompue — ce qui s'est passé, et ce qui a été rejoué

La première session s'est fermée pendant l'écriture de ce fichier (l'écriture n'a pas abouti : le fichier n'existait
pas à la reprise), avec deux validations inachevées. **Rien n'était commité** ; l'arbre de travail portait tout le lot.
Le texte de ce journal a été repris de la transcription, puis relu et corrigé contre l'arbre.

| Validation | Première session | À la reprise |
|---|---|---|
| `tsc` | une erreur, dans `.next/` seulement | **0 erreur dans le code** ; une seule ligne, dans `.next/dev/types/validator.ts` (filtrée : voir ⑦) |
| `next build` | tué par manque de mémoire (code 134) pendant la vérification des types | voir **L'épreuve** |
| cliquet du lint | 50/25 — un avertissement nouveau | cause : deux avertissements dans `diag-recette-s1.mjs` (neuf), corrigés ; **50/23**, base abaissée dans le même lot (§G.5 ter) |
| série `diag-*` | 7 rouges, dont 5 corrigés avant la coupure | 2 rouges trouvés : `diag-signature-de-fonction` (corrigé) et `diag-routes-tracees` (**laissé rouge, nommé** — voir ⑧) |

### Contradictions et pistes corrigées — signalées

① **Plage des migrations** : le mandat donne à S1 `20261001100000–…199999` (suffixe `1xxxxx`) ; §G.2 et le cliquet de
  `diag-migration-donnees` attribuaient `2xxxxx` à S1 et déclaraient `1xxxxx` fausse. **Suivi : le mandat** (attribution
  la plus récente et explicite), inscrit en §G.2 et dans le cliquet **avec sa date** — avant le 01/10/2026, `1xxxxx`
  reste la plage fausse des quatre migrations gelées. *Signalé après l'écriture des migrations, pas avant : je l'ai vu
  au premier passage du cliquet.*
② **Point 4 contre §D.31** : « toutes les étapes de démarrage mènent à l'import » (décision du 30/09). La décision du
  01/10 fait mener l'ÉTAPE 3 à la validation ; §D.31 est amendé, les étapes 1 et 2 ne changent pas.
③ **Point 8, la piste « le navigateur écrit encore dans le profil »** : fausse. `photo_url` passait déjà par
  `PATCH /api/profile`. Le navigateur écrivait dans le **stockage** (bucket `avatars`, `upsert`) ; le bucket rendu privé
  avait perdu sa politique de lecture, qu'un `upsert` exige (§E.101).
④ **Point 14 contre l'en-tête de `storage_buckets_policies`** (« cv = PRIVÉ, jamais d'URL ») : suivi le mandat — le
  bucket reste privé et fermé au navigateur ; la seule URL est signée par le serveur, pour un administrateur, au clic,
  valable une minute (§D.44). L'en-tête est dans une migration appliquée : il n'est pas touché, la décision est écrite
  dans la mémoire.
⑤ **Point 7** : la redirection après « Publier » existait déjà sur succès ; manquait le cas où la publication est
  ÉCRITE mais la ligne du grand livre refusée (`journal_error`), qui laissait l'expert sur l'écran. La notification
  « en cours de validation » n'était créée qu'au verdict de l'IA, et seulement si elle déférait à un humain.
⑥ **Point 12** : l'analyse du CV ne confond PAS employeur et client — elle range le client d'une mission dans
  `client_name`. C'était la LECTURE qui était fausse : le vérificateur et la fiche admin ne lisaient que `employer`.
⑦ **`next build` et `tsc`** butent sur des types générés PÉRIMÉS : `.next/dev/types/validator.ts`, laissé par un
  `next dev`, cite `app/api/profile/cv/route.ts`, que le principal a supprimée (`fe2d406`) ; `tsconfig.json` inclut
  `.next/dev/types/**`. Ce n'est pas le code du lot. Leur suppression m'a été refusée à la première session ;
  `npx next typegen` a régénéré `.next/types`, pas `.next/dev/types`. Ce fichier n'est pas versionné : le supprimer
  (`.next/dev`) sur le poste suffit, et un `next dev` le régénère juste.
⑧ **La route de la photo et le grand livre — la note de la première session était FAUSSE.** Elle disait « le dépôt
  n'écrit pas, `PATCH /api/profile` porte déjà sa ligne, rien à ajouter ». Deux faits la contredisent :
  · `POST /api/profile/photo` **écrit** (le stockage) sans ligne ni exclusion : `diag-routes-tracees` rougit (A) ;
  · la fenêtre renvoie TOUJOURS le même `photo_url` (`<compte>/avatar.jpg`, chemin dérivé du compte). Sur ma branche,
    `PATCH` écrit `profil_modifie` à chaque fois ; **après fusion avec l'ARRÊT 22 du principal** (une ligne seulement
    quand la valeur change vraiment), un **remplacement** de photo ne laissera **aucune** ligne — seule la première
    photo en laisse une.
  Trancher est un arbitrage du grand livre (une action, ou une exclusion nommée) : **au principal**. Je ne l'ai pas
  écrit ; le rouge reste, nommé.

### Le compte exact, point par point

| Point | État | Ce qui a été fait | Prouvé par |
|---|---|---|---|
| **1. Deux « Autre »** | **corrigé** | Cause : une SPÉCIALITÉ « Autre » semée dans le référentiel (`parametrage_de_production`), en plus de l'option d'écran. Migration `specialite_autre_hors_referentiel` : reprise des profils et annonces (la précision garde « Autre »), ligne désactivée, contrainte qui refuse toute spécialité active « Autre » ; l'admin rend `specialite_autre_reservee` (quatre langues). Une seule sentinelle (`lib/taxonomie/specialite-autre.ts`) importée par les quatre écrans. | `diag-recette-s1` 1 ; `taxonomie/autre_hors_referentiel.test.sql` (14) |
| **2. Zones de travail** | **refait** | Cause : « Monde entier » était un bouton parmi les continents et le dédoublonnage gardait le plus large : un clic sur Europe était absorbé. Nouvelle saisie en deux temps (ci-dessous). | `diag-recette-s1` 2 (la saisie exécutée) |
| **3. Langues** | **corrigé** | Liste fermée en base (`langues`, 92 codes ISO ; `langues_noms`, 467 noms) et déclencheur `LG001` ; noms dans la langue de l'écran (`Intl.DisplayNames`) ; composant partagé `ChoixLangue` (freelance et CDI) ; aucun niveau d'office ; une ligne héritée montrée et à choisir, jamais effacée ; le CV écrit des codes (« French » → `fr`), ce qu'il ne reconnaît pas est dit (`langue_inconnue`) ; `remplacer_listes_profil` nomme `langue_hors_liste`. | `diag-recette-s1` 3 ; `profil/langues_liste_fermee.test.sql` (12) |
| **4. Étape 3** | **corrigé** | « Continuer » de l'étape 3 mène à `…/profil/valider`. | `diag-recette-s1` 4 |
| **5. Le statut** | **corrigé** | Une source (`lib/verification-state.ts` + espace `statut_profil`) : « Statut de votre profil : <état> » et la phrase qui dit la suite, par voie (missions / offres) ; un libellé et une couleur par état (brouillon, vérification par l'IA en cours, en attente d'un administrateur, validé, validé mais masqué, refusé) ; lue par la pastille, l'étape 3, le chip de « Mon profil » et les notifications (plus de texte en dur). | `diag-recette-s1` 5 ; `diag-ecran-qui-se-contredit` ② |
| **6. Icônes « i »** | **fait** | `components/ui/InfoBulle.tsx` (survol à la souris, toucher sur téléphone, focus clavier, Échap, `aria-describedby`) ; posée sur chaque case et chaque bloc des tableaux de bord freelance, CDI et organisation (clients, cabinets, ESN partagent un écran), hors des liens ; 30 textes (espace `infobulles`) dans les quatre langues. « Mon TJM » dit « Modifier » quand le TJM est renseigné. Le tableau de bord CDI n'a pas de case TJM. | `diag-recette-s1` 6 |
| **7. Publier** | **corrigé** | La notification « l'IA vérifie » est posée dans la requête de publication, après un dépôt réussi (pas pour un profil déjà validé qui republie) ; une publication écrite ramène au tableau de bord même sur `journal_error`. | `diag-recette-s1` 7 |
| **8. Photo** | **corrigé** (trace : voir ⑧) | Cause : §E.101. `POST /api/profile/photo` (contenu vérifié, chemin dérivé du compte, clé de service) ; la fenêtre ne touche plus au stockage ; chaque refus a son message (dix messages, quatre langues) ; migration `photo_par_le_serveur` retire les trois politiques d'écriture du navigateur. | `diag-recette-s1` 8 |
| **9. Paramètres > Notifications** | **fait** | La phrase proposée, dans les quatre langues. | `diag-recette-s1` 9 |
| **10. LinkedIn** | **corrigé** | Aucune adresse transmise, aucun outil offert (plus aucune recherche web payée), drapeau `LINKEDIN_UNVERIFIABLE` retiré (ni posable, ni réglable comme bloquant), l'échelle ne le cite plus ; `web_search_max_uses` n'est plus lu ni exigé — déclaré inerte (§B.2 ⑨). | `diag-recette-s1` 10 |
| **11. Missions qui se chevauchent** | **corrigé** | Dit au modèle : normales, ni signalées, ni pénalisées, jamais additionnées. | `diag-recette-s1` 11 |
| **12. Employeurs non nommés** | **corrigé (lecture)** | Le vérificateur et la fiche admin lisent `experience_type` et `client_name` : « MISSION — rôle pour le client X ». | `diag-recette-s1` 12 |
| **13. 12 ans dans deux tranches** | **corrigé** | `lib/profil/seniorites.ts`, intervalles semi-ouverts (12 ans = expert) ; les consignes du vérificateur et des deux analyseurs en sont tirées. | `diag-recette-s1` 13 (exécuté) |
| **14. CV dans la fiche admin** | **corrigé** | Cause : la fiche lisait `cv_url`, jamais écrite. `POST /api/admin/lien-cv/[id]` signe au clic un lien d'une minute vers `cv_file_path` ; la fiche ne reçoit que `cv_depose` ; trois issues nommées. | `diag-recette-s1` 14 (exécuté avec un stockage simulé) |

### Le choix pour les zones de travail, et sa raison

**Le choix** : deux temps. ① Une question fermée, rien de coché d'avance : **« Partout dans le monde »** OU **« Dans
certaines zones seulement »**. ② Seulement dans le second cas : les **continents en un clic** (avec leur nombre de
pays), une **recherche de pays** (on tape « Maroc », on choisit — au clavier aussi), et la **sélection en étiquettes**
qu'une croix retire. Un pays déjà couvert par un continent choisi le dit (« Déjà couvert par Europe ») au lieu de
s'ajouter ; un continent ajouté absorbe ses pays ; quitter « partout » vide la sélection.

**La raison.** Le défaut venait de ce que « tout » était présenté comme un choix parmi les parties : la règle de
dédoublonnage, juste, absorbait le clic suivant. Les plateformes comparables séparent les deux : Upwork fait choisir
au client entre une annonce mondiale et des pays ou régions préférés
([support Upwork](https://support.upwork.com/hc/en-us/articles/115005777188-US-Location-Selection),
[publier une annonce](https://support.upwork.com/hc/en-us/articles/211063408-How-to-post-a-job)) ; LinkedIn fait
ajouter des lieux un par un dans un champ « Ajouter un lieu », chacun posé en étiquette
([guide « Open to Work »](https://blog.theinterviewguys.com/linkedin-open-to-work-guide/)). La recherche remplace
les listes de pays dépliables par continent — illisibles sur téléphone. Le même composant sert l'expert et
l'annonce : la question est la même des deux côtés du marché.

### Ce que le grand livre devrait porter — NON ÉCRIT (lot du principal)

1. **La consultation d'un CV par un administrateur** (`POST /api/admin/lien-cv/[id]`) : une donnée personnelle lue par
   un humain. Proposition : action `cv_consulte` (famille compte), sujet = le profil, acteur = l'administrateur, détail
   vide ; écrite à la signature du lien, et un refus nommé si l'écriture échoue (pas de lien sans trace).
   *(`diag-routes-tracees` ne la voit pas : la route ne fait qu'une lecture signée.)*
2. **Le dépôt de la photo** (`POST /api/profile/photo`) — **c'est ce qui rougit `diag-routes-tracees`** (⑧). Deux
   issues, à trancher : (a) une action `photo_deposee` (sujet = le profil, détail vide), écrite après le dépôt — elle
   trace aussi les remplacements que l'ARRÊT 22 rend muets ; ou (b) une exclusion `'profile/photo'` avec sa raison
   (« LÉGITIME — des octets au chemin dérivé du compte ; le geste est le `photo_url` de `PATCH /api/profile` »), en
   acceptant qu'un remplacement de photo ne laisse aucune ligne. **Ma recommandation : (a)** — un remplacement de
   photo change ce qu'une organisation voit après dévoilement (§D.4, §D.5).
3. **La reprise « Autre »** (`retirer_specialites_autre`, migration) : modifie des profils et des annonces sans ligne.
   Proposition : aucune — c'est une reprise de données, comme les autres ; si le principal en veut une, une ligne
   `taxonomie_modifiee` (opération `autre_retire`) par spécialité désactivée.
4. **La reprise des langues** (`rattacher_langues_heritees`) : même remarque.

### Les migrations nouvelles (plage S1)

| Migration | Ordre | Ce qu'elle fait | Test |
|---|---|---|---|
| `…_specialite_autre_hors_referentiel` | AVANT | fonction `est_specialite_autre`, reprise `retirer_specialites_autre`, contrainte `specialities_autre_hors_referentiel` | `taxonomie/autre_hors_referentiel.test.sql` (14) |
| `…_langues_liste_fermee` | AVANT | tables `langues`, `langues_noms` ; `code_de_langue` ; déclencheur `LG001` ; reprise `rattacher_langues_heritees` ; `remplacer_listes_profil` (+ une cause) | `profil/langues_liste_fermee.test.sql` (12) ; `listes_profil` et `analyse_cv_tolerante` passés aux codes (plans inchangés : 7 et 21) |
| `…_photo_par_le_serveur` | INDIFFÉRENT (raison dans l'en-tête) | retire les trois politiques d'écriture du navigateur sur `avatars` | `diag-recette-s1` 8 |

Les trois portent l'horodatage du 01/10/2026 dans la plage S1, dans cet ordre. Aucune n'a été appliquée nulle part.
La requête d'avant-push de staging déclare leurs créations (⓪ inchangé : `listes_profil_atomiques`).

**Tests pgTAP** : 26 neufs (14 + 12). Sur ma branche : 543 + 26 = **569** à rejouer. Après fusion avec le lot du
principal (567 annoncés par son ARRÊT 22, mesurés par lui) : **593** attendus.

### L'épreuve (01/10/2026, à la reprise — lot commité en `27c666e`)

- **tsc** (filtre `.next/`) : **0 erreur dans le code**. Une ligne, dans `.next/dev/types/validator.ts` (périmé, ⑦).
- **next build** (`NODE_OPTIONS=--max-old-space-size=8192`, plus de manque de mémoire) : **compilé en 74 s**, puis
  arrêté à la vérification des types sur la MÊME ligne de `.next/dev/types/validator.ts`. Les étapes suivantes
  (données des pages, génération) **n'ont pas tourné : le build n'est PAS prouvé ici.** Étape 1 de Youssef.
- **Cliquet du lint** (seul) : **50/23**, vert ; base abaissée de 50/24 dans le lot (§G.5 ter, CLAUDE.md suivi).
- **Parité i18n** : 4 328 clés dans les quatre langues. **`diag-memoire-exacte`**, **`diag-memoire-a-jour`**,
  **`diag-migration-donnees`** (cliquet des plages), **`diag-requete-staging`** : verts.
- **`diag-recette-s1`** : 94 contrôles, verts.
- **Série complète** (`node scripts/diag.mjs`) : **115 verts, 2 rouges, 2 n'ont pas tourné, 6 écartés.** Puis :
  · `diag-signature-de-fonction` — rouge **corrigé** (le filet `coalesce` de la postcondition des langues, §E.37) ;
  · `diag-lint-cliquet` — délai du lanceur ; **vert seul** ;
  · `diag-controles-a-rejouer` — délai du lanceur ; **seul : 100 verts, 1 rouge** ;
  · `diag-routes-tracees` — **ROUGE, laissé nommé** : `POST /api/profile/photo`, l'arbitrage du grand livre ⑧.
  **Au total : un seul rouge, nommé, dont la décision n'est pas à S1.**
- **Mutations : 10 sur 10 rougissent**, arbre restauré à l'identique du commit : étape 3 vers l'import, 12 ans en
  « senior », lien du CV d'une heure, « Monde entier » qui absorbe le clic, contrainte « Autre » sans `not active`,
  chevauchements à signaler, ancienne phrase des notifications, mauvaise route de la photo, deux états sous un
  libellé, filet `coalesce` retiré.
- **Fusion à blanc** (`git merge-tree`, rien d'écrit) avec `feat/sprint-archi-orga` à `7f5ce13` (ARRÊT 22) :
  **4 conflits** — `CLAUDE.md`, `app/api/admin/update-speciality/route.ts`, `docs/architecture.md`, `docs/pieges.md` ;
  `app/api/profile/route.ts`, `docs/produit.md`, `scripts/diag-tests-grand-livre.mjs` et les quatre
  `messages/*.json` fusionnent seuls — les quatre JSON fusionnés sont **valides** (4 927 chaînes chacun).

### Pour Youssef — dans l'ordre, chaque étape verte avant la suivante

1. **Sur ce poste, avant tout** : supprimez le dossier `.next/dev` dans `skilloria-s1` (fichiers générés, ignorés par
   git — on ne perd rien). Puis `npm run build` dans `skilloria-s1` : il doit aller au bout. S'il échoue ailleurs que dans
   `.next/`, envoyez-moi la sortie.
2. **Fusionner ma branche** : `git switch feat/sprint-archi-orga`, puis `git merge s1/corrections-recette`. Quatre
   conflits, tous « garder les deux côtés » :
   - **`app/api/admin/update-speciality/route.ts`** — garder les DEUX imports :
     `import { changementsTaxonomie, taxonomieModifiee } from '@/lib/taxonomie/journal-taxonomie'` et
     `import { estRefusAutre } from '@/lib/taxonomie/specialite-autre'`.
   - **`CLAUDE.md`**, trois endroits : (a) les décisions — garder MA ligne D.31 (elle porte l'amendement du 01/10), la
     **D.32 du principal** (il l'a réécrite : « l'écran les rend en PHRASES » ; je n'y ai pas touché), la **D.33 du principal**, puis remplacer ma ligne « D.33 à D.39 : réservées » par
     « D.34 à D.39 : réservées au principal », puis mes D.40 à D.44 ; (b) l'index des pièges — la ligne E.90 du principal
     PUIS mes E.100 à E.105 ; (c) « rejoue les 176 / 175 migrations » → **179**.
   - **`docs/architecture.md`**, deux endroits : le bloc des quatre migrations du grand livre lisible PUIS celui de mes
     trois migrations ; la section D.33 du principal PUIS mes D.40 à D.44.
   - **`docs/pieges.md`**, deux endroits : la section E.90 du principal PUIS ma note de numérotation et mes E.100 à
     E.105 ; et la phrase « Sur les 176 / 175 migrations » — lancez `node scripts/diag-migration-donnees.mjs` et
     recopiez les trois nombres qu'il mesure sur **179** migrations (attendus, NON MESURÉS : 78 insertions vues,
     65 analysées, 3 346 valeurs).
   - `messages/*.json` : ils fusionnent seuls ; s'il y avait un conflit, UNION (jamais l'un des deux côtés).
3. **La requête d'avant-push** (`supabase/verifications/staging-avant-push.sql`) — c'est au lot fusionné en second, le
   mien, de la mettre à jour ; elle ne peut l'être qu'une fois les deux lots réunis. Après la fusion :
   - dans `prochain_push_cree`, AJOUTER les huit objets du principal à mes neuf lignes :
     `('fonction', 'se_desabonner_email')`, `('fonction', 'appliquer_proposition_conservation')`,
     `('fonction', 'libelles_journal')`, `('table', 'grand_livre_conservation_proposee')`,
     `('contrainte', 'gl_conservation_proposee_plancher')`, `('contrainte', 'gl_conservation_proposee_duree')`,
     `('contrainte', 'gl_conservation_proposee_au_dessus')`, `('contrainte', 'gl_conservation_proposee_journal')` ;
   - dans l'invariant ⑧, ajouter `'notification_preferences'` à la liste des tables (entre `'messages'` et
     `'organization_invitations'`) ;
   - ⓪ ne change pas (`listes_profil_atomiques`).
   Puis : `node scripts/diag-requete-staging.mjs` et `node scripts/diag-portes-laterales.mjs` **verts** — ce sont les
   deux rouges que l'ARRÊT 22 a laissés à cette étape. Si vous préférez, renvoyez-moi la branche fusionnée : je l'écris.
4. **Sur la branche fusionnée** : `npx tsc --noEmit` (filtre `.next/`), `npm run build`, `node scripts/diag-parite-i18n.mjs`,
   `node scripts/diag-memoire-exacte.mjs`, `node scripts/diag-lint-cliquet.mjs` (attendu 50/23 ; s'il mesure 24, c'est
   une interaction des deux lots : envoyez-moi la sortie), puis `node scripts/diag.mjs`. Le seul rouge attendu est
   `diag-routes-tracees` (⑧), tant que l'étape 8 n'est pas tranchée.
5. **Docker lancé** : `npx supabase link --project-ref wnayuerhakekxccgimeg`, `node scripts/verifier-version-postgres.mjs`,
   `npx supabase db reset --local`, `npx supabase db lint -s public --level error` (sortie vide),
   `npx supabase test db --local` — **593 tests attendus** (567 du principal + mes 26), tous verts. Un rouge : envoyez-moi
   le fichier et le numéro du test.
6. **La requête de staging** (éditeur SQL de staging, lecture seule) : aucun ÉCART. Un seul → on s'arrête.
7. `npx supabase db push`, puis **aussitôt** `git push` — selon les étapes de l'ARRÊT 22 bis pour le refus GL006, qui
   reste un lot séparé, après.
8. **À décider** (lot du principal) : la trace du dépôt de photo — action `photo_deposee` (ma recommandation) ou
   exclusion nommée (⑧ et « Ce que le grand livre devrait porter », 2) ; la ligne `cv_consulte` ; la liste des 92
   langues (elle se règle en base : une ligne dans `langues`, ses noms dans `langues_noms`).
9. **Sur staging, fenêtre privée, le compte d'essai freelance** :
   - validation : une seule « Autre (préciser) » ; zones : « Dans certaines zones » → Europe en un clic, « Maroc »
     par la recherche, une croix le retire ; langues : « Ajouter une langue » montre « Choisir une langue » et
     « Choisir le niveau », et les langues lues du CV s'affichent en français ;
   - publier : retour immédiat au tableau de bord, notification « Statut de votre profil : vérification par l'IA en
     cours » dans la cloche ; la pastille dit la même chose, l'étape 3 aussi ; au rafraîchissement, le TEXTE change
     avec la couleur ;
   - les icônes « i » au survol (ordinateur) et au toucher (téléphone) ;
   - « Mon profil » : changer la photo DEUX fois de suite (le second enregistrement était celui qui échouait) ;
   - admin, fiche du compte d'essai : « Ouvrir le CV (lecture seule) » ouvre le PDF ; après une nouvelle vérification,
     plus de remarque LinkedIn, plus d'« employeurs non nommés », 12 ans dans une seule tranche.

### Ce qui n'est pas prouvé ici

- Les tests pgTAP n'ont pas tourné (ni Docker ni base) : c'est l'étape 2.
- La reprise des lignes HÉRITÉES de `profile_languages` n'est prouvée par aucun test (§E.103).
- Aucun navigateur réel n'a été ouvert : la saisie des zones, l'info-bulle et l'ouverture du CV se lisent dans le code.
- Le comportement du modèle de vérification avec ses nouvelles consignes : seule une nouvelle vérification le dira.
