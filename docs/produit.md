# Le produit — Skilloria

> **Troisième des trois fichiers de la mémoire du projet.** Les deux autres :
> [CLAUDE.md](../CLAUDE.md) (règle de maintenance, décisions figées §D, worktrees §G, index des pièges), [pieges.md](pieges.md) (les pièges §E) et
> [docs/architecture.md](architecture.md) (modèle de données, chaînes, dette ouverte).
>
> Ce que Skilloria **fait**, écran par écran et règle par règle. §A à §H décrivent *où vivent les
> choses* ; ce fichier-ci décrit *ce que fait le produit*. Chaque chapitre de §P1 doit se lire
> **seul, sans avoir lu le code**.
>
> Tout y est vérifié dans le dépôt ; ce qui ne l'est pas est marqué **NON VÉRIFIÉ**.
> **Relu contre le code le 16 septembre 2026** (§M1 dans [CLAUDE.md](../CLAUDE.md)).

---

> Ce que Skilloria **fait**, écran par écran et règle par règle. Les sections A–H au-dessus sont un
> guide de repérage — où vivent les choses, quels pièges les entourent. Celle-ci est le produit
> lui-même : c'est elle qu'on lit quand on reprend le projet, ou qu'on y revient dans six mois.
>
> Chaque chapitre de §P1 doit se lire **seul**, sans avoir lu le code.
> Tout y est vérifié dans le dépôt ; ce qui ne l'est pas est marqué **NON VÉRIFIÉ**.

## P1. Les six parcours, de bout en bout

### P1.1 — L'expert dépose son CV et devient visible

**Qui.** `expert_freelance` ou `expert_cdi`. Un expert appartient à **un** écosystème, à vie (§D.3).

**1. Il s'inscrit.** `/inscription/[role]` → `POST /api/auth/public/register-expert`.
La route est **publique** (bare `fetch`, pas `useSecureFetch`) et résout l'écosystème elle-même via
`resolveSubdomainFromHost()` : le proxy n'injecte pas `x-subdomain` sur `/api`.
L'inscription exige une **branche et une spécialité choisies dans le référentiel**, pas du texte
libre — avant la migration `taxonomie_specialite_autre_et_inscription`, la spécialité était stockée
dans `profiles.title`, `branch_id`/`speciality_id` restaient NULL, et **le profil n'alimentait pas le
matching**. Si la spécialité n'est pas au référentiel, l'expert saisit « Autre » et le texte part en
modération.
L'acceptation des CGU est **horodatée et versionnée** en base (migration
`legal_consent_and_inactivity`) : une case cochée non tracée n'a aucune valeur juridique.
Le rattachement à l'écosystème vient des métadonnées d'inscription — `handle_new_user` **refuse**
un `domain_slug` absent ou inconnu depuis la migration `fix_handle_new_user_domain_slug`, là où la
baseline retombait silencieusement sur `microsoft`.

**2. Il vérifie son téléphone.** OTP par SMS (Vonage **Verify v2**, `api.nexmo.com/v2/verify` — un
chemin entièrement distinct du canal SMS de notification, qui est fermé, cf. §D.2).
Limites : **1 envoi / 60 s** et **3 / heure** par numéro, plus **10 / heure par IP** sur la route
publique (`rate_limit_check`, atomique en base). La vérification du code est **fail-closed** et
clée par IP.
Un index **UNIQUE PARTIEL** sur `users(phone) WHERE phone_verified` tient la règle « 1 numéro
vérifié = 1 compte » : c'est la seule barrière réelle contre la multiplication de comptes — la
vérification IA d'expertise est franchissable, un recruteur recycle un CV authentique.

**Il CHOISIT SON PAYS, il ne compose pas d'indicatif.** L'écran affichait un badge **« 🇫🇷 » figé** et
un placeholder `+33` : un expert marocain, tunisien ou canadien ne pouvait pas saisir son numéro, et
rien ne lui annonçait que le champ exigeait un `+`. Il y a désormais un sélecteur de pays
([components/phone/SaisieTelephone.tsx](../components/phone/SaisieTelephone.tsx)), et **le E.164 est
composé par le code**, jamais par l'utilisateur.
- Le référentiel vient de **la base** (`countries`, via `/api/countries`) — aucune liste en dur, et
  **aucune liste de pays autorisés**.
- Le **pays par défaut** vient du `sort_order` du référentiel, pas d'une constante de code.
- On stocke le **code ISO**, jamais l'indicatif seul : `+1` est partagé par les États-Unis et le Canada.
- Changer de pays **ne vide jamais** le numéro déjà tapé ; le **placeholder vient du pays choisi**, pas
  de la langue ; un numéro **collé avec son indicatif** (`+216…`, `00216…`) bascule le sélecteur ; les
  **chiffres arabes-indiens et persans** sont acceptés.

**Ce qu'il voit quand l'envoi échoue.** Le motif réel de Vonage est traduit en codes stables
([lib/otp/vonage-refus.ts](../lib/otp/vonage-refus.ts)) puis en messages dans les quatre langues. Deux
refus sont **distincts parce que leurs issues le sont** : « les SMS ne sont pas disponibles vers ce
pays » (réessayer est inutile, l'issue est de nous écrire) et « service momentanément indisponible »
(réessayer a du sens). Avant, tout tombait dans le second, y compris un numéro mal saisi.

**L'écran n'affirme pas que le SMS est parti** (§E.13) : il dit « **demande transmise** », et quand le
compte à rebours expire, il ouvre une **sortie** — un lien vers le formulaire de contact existant,
prérempli avec le numéro et le pays. Aucun canal nouveau, et le sujet transite par un **jeton**
(`probleme=otp`), jamais du texte libre.

⚠️ Les **trois** parcours — inscription expert, inscription organisation, paramètres du compte —
utilisent le **même** composant (§E.14).

**3. Il dépose son CV.** `/dashboard/{freelance,cdi}/profil` → `POST /api/profile/upload-cv`
(freelance) ou `/api/profile/cdi-upload-cv` (CDI). **Deux routes distinctes, gardées par
`user_type`** : un `expert_cdi` sur la route freelance reçoit **403 `wrong_user_type`**.
- PDF, **5 Mo** maximum, bucket `cv` **privé** (service-role seul, jamais d'URL).
- Consentement RGPD requis (`profiles.ai_consent_at`).
- Interrupteur `ENABLE_AI_CV_PARSING` → **503 `ai_disabled`** s'il n'est pas exactement `'true'`.
- Quota **3 analyses / 24 h**, lu en base (`ai_quotas`), **pas dans le code** : ligne absente ⇒ la
  route **refuse** (`quota_config_missing`), elle ne devine pas.
- Parsing par `claude-haiku-4-5-20251001`, résultat **caché par SHA-256** du fichier : redéposer le
  même PDF ne repaie pas.
- `maxDuration = 60`. Le matching qui suit part dans un `after()` (§E.5).

**4. Il devient visible — ou il apprend pourquoi il ne l'est pas.**
Le prédicat de visibilité vit **une seule fois**, dans
[lib/profile-visibility.ts](../lib/profile-visibility.ts), et il a **trois** lecteurs : la route (qui
refuse), le formulaire (qui prévient avant l'envoi), et la bannière (qui dit **quels champs
manquent**). Le même prédicat existe en contrainte base
(`profiles_visible_requiert_criteres_check`) — trois copies dérivent, et c'est déjà ce qui a fait
échouer une migration.
Exigé : titre, résumé **200–800 caractères**, compétences, branche, spécialités, séniorités, zones
de travail, disponibilité, expériences, langues, CV analysé, consentement IA.
Les bornes du résumé ne sont pas une préférence de rédaction : **en dessous de 200 il n'y a pas
matière à juger, au-delà de 800 le texte sort du document envoyé au moteur** et n'est plus lu.
Ce qu'il voit quand ça refuse : la liste **nommée** des champs manquants, traduite dans les quatre
langues (`profile_validation.field_errors`) — jamais « votre profil est incomplet ».

**5. Il est vérifié.** `/dashboard/{freelance,cdi}/profil/valider` →
[lib/verification/expert-verification.ts](../lib/verification/expert-verification.ts).
`verification_status` passe à `pending` **avant** l'appel (l'écran ne ment pas sur ce qui se passe),
puis Claude croise trois axes avec recherche web native.
- score ≥ `auto_approve_threshold` **et** aucun drapeau disqualifiant → **`approved`**,
  `verified_at` posé, `verified_by` NULL (automatique), `users.is_verified` basculé ;
- sinon → **`pending_admin_review`** : un humain tranche depuis `/admin/experts/[id]` ;
- **erreur** (timeout, rate-limit, JSON invalide) → `pending_admin_review`. **Jamais**
  d'auto-approbation sur une panne.
- Consentement IA absent → le statut **reste** `pending`, rien n'est appelé.
Idempotent : rejouable, le dernier verdict écrase le précédent.

**Où ça bloque, et pourquoi.** Tant que le profil n'est pas `approved`, **visible**, CV analysé et
consentement donné, il n'entre pas dans le vivier (§P1.3). Les écrans « Missions » affichent alors
un état vide **explicite** (« profil pas encore validé »), jamais un cache périmé.

---

### P1.2 — L'organisation publie une annonce

**Qui.** Un membre d'une `organization` (`org_type` ∈ `client` \| `cabinet` \| `esn`), ou un expert
via son **organisation personnelle** (`org_type = 'freelance'`, §P1.2 bis).

**1. L'organisation s'inscrit.** `/inscription/organisation` → `POST /api/auth/register-org`.
C'est la seule instruction `insert into organization_domains` de tout le dépôt — une ligne, une
fois, et cette table n'est plus qu'une **trace historique** (§B.2 ①).

Le formulaire **DEMANDE le pays du siège** — sélecteur alimenté par le référentiel `countries`
(64 pays actifs), **aucun préselectionné**. Il ne le demandait pas : il postait `country_code: 'FR'`
en dur, et la finalisation retombait sur le même `?? 'FR'`. Ce n'était pas cosmétique — le pays
**choisit le registre officiel interrogé** (§P3.3) : une société marocaine était cherchée dans
Sirene, absente, et renvoyée en revue humaine. Le pays reste **modifiable tant que la vérification
n'est pas approuvée** (`PATCH /api/me/organisation`, condition imposée **au serveur**) ; après, seul
le back-office tranche.

Le **numéro d'identification suit le pays** : libellé, exemple et longueurs viennent du référentiel
(`countries.registre_numero_*`), pas d'un `switch` — **un pays de plus n'est pas un déploiement**.
Seule la France est renseignée, parce que c'est la seule règle que le dépôt prouve (« SIREN »,
9 chiffres). **Sans règle connue, la saisie est ACCEPTÉE** : on ne refuse jamais sur une règle qu'on
n'a pas, et c'est la revue humaine qui juge.

**2. Elle est vérifiée.** [lib/verification/](../lib/verification/) — **l'IA est le décideur
systématique, pas un repli**. Sirene fournit les données pour la France ; Claude compare **champ par
champ** et produit un score de confiance, comparé au `confidence_threshold` de la ligne
**`provider_type = 'ai_web_search'`** du pays — **7 sur 10** (vérifié en base le 16/09/2026).

> **Companies House n'a jamais existé autrement que sur le papier.** Ce document écrivait
> « Sirene (FR) ou Companies House (UK) ». Le module était un **stub sans aucun appelant**, et
> `verification_providers` ne portait **aucune ligne GB** — il n'y avait donc pas un second pays,
> il y en avait un seul. Le stub a été supprimé (règle 0).

**Un pays sans décideur configuré tombe en revue humaine, et c'est le repli CONÇU** — pas un
cul-de-sac. Le dispatcher refuse **avant toute dépense IA**, avec un motif nommé, et la règle
métier « jamais de rejet automatique » est préservée : un refus de configuration n'est pas un refus
d'organisation. Les 64 pays sont ouverts au sélecteur **sans qu'aucune ligne `verification_providers`
ne soit créée pour eux** : inventer des seuils qu'on n'a pas décidés serait le défaut d'à côté.

> ⚠️ **Ce document a longtemps écrit « défaut 9 sur 10 » ici. C'était FAUX, et de la MÊME façon que
> le seuil expert (§E.10).** Le 9 est le `confidence_threshold` de la ligne `sirene_insee`
> (`provider_type = 'official_api'`). Or cette ligne n'est sélectionnée que comme **source de
> données** ([lib/verification/index.ts](../lib/verification/index.ts), `pickOfficialApiProvider`) : son
> seuil n'est **lu nulle part**. C'est la **deuxième colonne inerte** du projet, après celle du
> chemin expert — et elle n'était pas documentée.
**Règle métier : jamais d'auto-rejet.** En dessous du seuil → `pending_admin_review`, un humain
tranche depuis `/admin/organisations/[id]`.
`requireOrgApproved(ctx)` garde ensuite les routes réservées.

**Le refus ne ment pas, et il n'explique rien — mais la distinction existe pour l'admin.**
L'organisation lit **« En cours de revue »**, et rien d'autre : ni le pays, ni le registre, ni le
fonctionnement interne. Sur le **bureau de l'admin**, en revanche, une organisation étrangère sans
décideur configuré et un **faux négatif** d'un registre ne s'instruisent pas de la même façon — et
elles se ressemblaient trait pour trait : « Méthode — », « Score 0 » en rouge, et le motif affiché
sous le libellé **« Note IA »** alors qu'aucune IA n'avait tourné. La fiche back-office porte
désormais un bloc **Motif de la mise en revue** distinct, alimenté par `verification_data.motif_revue`
(un **code** que l'écran traduit, un **détail** qu'il affiche), et **le score vaut `null` quand rien
n'a été noté** — un score inventé a l'air d'avoir été décidé.

**2 bis. Elle soigne sa fiche.** `/dashboard/entreprise/organisation` →
`PATCH /api/me/organisation` (whitelist stricte : les champs qui engagent la vérification légale —
`siren`, `vat_number`, `org_type`, `email_domain` — restent hors d'atteinte).
**Le logo se TÉLÉVERSE, il ne se saisit plus** : `POST /api/me/organisation/logo`, bucket **privé**
`org-logos`, chemin dérivé de l'identifiant de l'organisation, lecture par **URL signée** (300 s).
Garde **admin actif** au serveur *et* en base ; `editor` est traité comme `viewer` (§D.8 pour le cas
de l'organisation personnelle, §E.17 pour la raison du changement).
Un fichier est accepté sur sa **signature binaire**, pas sur ce qu'il déclare — 2 Mo, JPEG/PNG/WebP,
SVG refusé. Un refus dit **lequel** des quatre motifs s'applique, en quatre langues.
La saisie d'URL a disparu des **deux** côtés : organisation *et* `/admin/ecosystemes`.

**3. Elle rédige.** `/dashboard/entreprise/annonces/nouvelle` → `POST /api/publications`.
Champs structurants : branche, spécialités (multiples), séniorités (multiples), compétences requises,
**zones de travail** (multiples), `location_note` (texte libre, ex-`location`).

**4. Elle publie.** `POST /api/publications/[id]/publish`. Trois portes, dans cet ordre :

- **Complétude** — prédicat unique [lib/publications/publishable.ts](../lib/publications/publishable.ts),
  doublé d'une contrainte base `publications_publiee_requiert_zones_check`.
  Exigés : titre, description, branche, **zones de travail**.
  La sémantique de l'ensemble vide est **asymétrique, et c'est voulu** :
  · **zones obligatoires** — `&&` sur un ensemble vide est toujours faux, une annonce sans zone
    serait publiée et **silencieusement invisible** ;
  · **spécialités et séniorités facultatives** — vide signifie « aucune contrainte sur cet axe »,
    jamais « ne correspond à personne ». Une annonce incomplète doit matcher **large**, pas rien.

- **Qualité (IA)** — [lib/verification/ai-publication-quality.ts](../lib/verification/ai-publication-quality.ts),
  provider `opportunity_quality_check`, **seuil 7/10**. Le prompt refuse explicitement qu'un champ
  optionnel vide fasse descendre sous 7, et traque les coordonnées en clair (téléphone, e-mail) —
  une annonce qui contourne la messagerie contourne le dévoilement payant.

- **Commerce** — deux quotas, deux refus **402** :
  `quota_publications_reached` (publications du mois) et `quota_active_publications_reached`
  (annonces actives simultanées). Cf. §P1.6.

**5. Elle vit 30 jours.** **L'expiration est calculée À LA LECTURE.** Aucun job, aucun cron, aucun
statut basculé : `publications.expires_at` n'est **jamais écrit**. La règle se réduit à
`status = 'published' AND published_at > now() - 30 jours`, et vit une seule fois dans
[lib/publications/expiry.ts](../lib/publications/expiry.ts).
L'organisation peut aussi clôturer à la main (`POST /api/publications/[id]/close`).

**Ce que voit l'utilisateur quand ça refuse.** Un refus nomme **ce qui bloque et ce qu'on peut
faire** (`diag-refus-actionnables.mjs` le garde) : les champs manquants pour la complétude, le motif
pour la qualité, et pour le quota — la limite atteinte **et** l'issue. Les murs de conversion ne
portent **aucun bouton désactivé** (§D.1).

#### P1.2 bis — La sous-traitance entre experts
Un expert publie un **besoin** et est mis en relation avec d'autres **experts**.
Blocage structurel : `publications.organization_id` est NOT NULL. D'où une **organisation
personnelle** (`org_type = 'freelance'`, `owner_user_id` renseigné), créée **paresseusement**.
Elle hérite de 100 % du moteur commerce — quotas, masquage, dévoilement, messagerie 15 j — sans
aucune logique dupliquée.
**Elle naît au moment de PUBLIER, pas à l'ouverture de l'écran** : avant la correction, tout expert
vérifié qui ouvrait « Sous-traitance » par curiosité repartait avec une organisation, et
`/admin/collaboration` mesurait la curiosité. Un index unique partiel
(`organizations_personal_owner_unique_idx`) tranche les courses ; la migration
`nettoyage_organisations_fantomes` a supprimé les fantômes — **après** le déploiement du code, sinon
les écrans les auraient recréés dans la minute.

### P1.3 — La mise en relation et la notification

**Ce que c'est.** Le moteur rapproche une annonce et des experts. Il tourne dans **les deux sens** :
`runMatchingForPublication` (une annonce vient d'être publiée) et `runMatchingForExpert` (un expert
vient de modifier son profil).

**Claude n'est plus là.** Il notait cent profils **dans un seul prompt**, en les comparant les uns
aux autres — et « ne les compare pas entre eux » n'était qu'une phrase dans ce prompt, que rien ne
garantissait. Le vivier était plafonné à cent **sans `ORDER BY`** : une liste d'autorisés stable et
invisible, où le 101ᵉ n'existait pas.
Le **reranking** (Cohere) note chaque couple (annonce, profil) **indépendamment**. Il n'y a donc plus
rien à couper, plus de plafond, et **l'absence de compétition devient une propriété du moteur au lieu
d'une consigne**.

**Quatre temps, et chacun sait se taire ou parler.**

1. **Les réglages** — `matching_settings`, **une ligne par écosystème**, créée par un déclencheur
   pour tout domaine nouveau. **Aucune valeur de repli dans le code** : ligne absente ⇒ le moteur
   **refuse et le dit**. Un repli codé en dur serait un second réglage, invisible, qui prendrait la
   main le jour où l'on comprend le moins ce qui se passe.

2. **Le vivier** ([lib/matching/pool.ts](../lib/matching/pool.ts)) — la règle est explicite :
   > *Aucun profil n'est écarté sans une raison **nommable et contestable**. Le backend filtre sur
   > des critères **déclarés par l'expert lui-même**. Il n'exclut jamais sur un jugement de
   > pertinence.*

   Filtres : même écosystème, `user_type` compatible avec le type d'annonce (ou **ouverture
   croisée** cochée : `open_to_cdi` / `open_to_freelance`, défaut **fermé**), branche, spécialités,
   séniorités, zones (`&&`), disponibilité (`availability_status` / `cdi_status`), vérification
   `approved`, `visible`, CV analysé, consentement IA — **et ses décisions** : avoir décliné
   l'annonce, ou y avoir déjà postulé. Un refus et une candidature sont des **actes de l'expert**,
   pas des jugements portés sur lui.
   Chaque filtre rend **son propre décompte** : sans cela « 3 candidats » ne dit pas si le vivier est
   petit ou si un filtre est trop serré, et personne ne sait quoi corriger.
   Lecture paginée par tranches de 1000, identifiants par paquets de 200.

3. **La notation** — Cohere (`rerank-v4.0-fast` par défaut), par lots de 200, 4 lots en parallèle,
   **budget relu entre chaque lot** ([lib/ai-budget.ts](../lib/ai-budget.ts)). Interrupteur
   `ENABLE_RERANKING`, qui doit valoir exactement `'true'`.
   Au plafond, **la fonctionnalité se dégrade et le DIT** : elle ne disparaît pas en silence et ne
   continue pas à dépenser. Le module rend toujours une **raison nommable**, écrite dans la trace du
   run. Fail-safe **fermé** ici, à l'inverse du reste du projet : *ne pas savoir combien on a dépensé
   n'autorise pas à dépenser plus.*
   Le score produit vit dans **[0,1]**, il est **propre à une annonce**, et il n'est **jamais
   normalisé sur le vivier** — normaliser reviendrait à classer les experts les uns par rapport aux
   autres, c'est-à-dire à réintroduire la compétition que le produit interdit.

4. **La réconciliation puis les notifications** ([lib/matching/reconcile.ts](../lib/matching/reconcile.ts))
   — upsert **idempotent** qui préserve les `dismissed` et les candidatures engagées, et ne notifie
   que sur les **inserts FRAIS** au-dessus du seuil. Un ré-run ne re-notifie personne.

**La trace n'est pas un détail.** Chaque run écrit `publications.matching_stats` : périmètre, notés,
lots en échec, distribution des scores, seuil appliqué. C'est ce qui distingue « noté, personne ne
correspond » de « jamais noté ». Un run interrompu reste **INACHEVÉ**, donc visible et rejouable, et
la reprise s'appuie sur `matching_notes_partielles` : **ce qui est noté ne se renote pas** — avant,
un run tué à 60 s repartait de zéro et **repayait les lots déjà payés**, jusqu'à l'abandon silencieux
au bout de cinq tentatives.
La trace est construite par **un seul** constructeur pour les deux chemins de sortie : tant que
chacun écrivait son objet, l'un pouvait oublier une clé — et une clé absente se lit `null`, qu'une
somme SQL affiche **zéro**. La supervision aurait dit « tout va bien » sur un moteur muet.

**Ce que l'expert VOIT quand il bascule sa disponibilité, et en combien de temps.** Ce paragraphe
existe parce que, mesuré le 21/09/2026, l'écran disait **deux choses fausses** — et que la seconde
était la plus coûteuse.

| Ce qu'il fait | Ce qu'il voit | Quand |
|---|---|---|
| Il passe en **« ne pas déranger »** | l'état bascule, le bandeau rouge apparaît | **instantanément** — aucune recherche n'est lancée, il n'y a rien à attendre |
| Il repasse **« à l'écoute »**, profil complet | une recherche annoncée, puis **ses missions** ou **« aucune mission ne correspond »** | à la **fin du moteur**, quelques secondes |
| Il repasse **« à l'écoute »**, profil **non visible** | *« Votre profil n'est pas visible : aucune mission ne peut vous être proposée tant qu'il n'est pas complété »*, **avec le bouton pour le compléter** | **au clic** — aucune roue, aucune attente : la réponse était connue avant de lancer quoi que ce soit |
| Idem, **CV non analysé** / **consentement absent** / **profil en cours de validation** | la phrase correspondante, et le bouton quand elle se corrige depuis le profil | **au clic** |
| Il bascule, mais **le moteur est éteint** | *« La recherche n'a pas pu aboutir : le moteur de mise en relation est indisponible »* | **au clic** — et **jamais** « aucune mission ne correspond » : une panne de configuration n'est pas un verdict sur son profil |
| Il bascule **dix fois en une heure** | *« Trop de recherches lancées coup sur coup »* | au onzième au-delà du plafond — un refus **dit**, jamais un silence |
| La recherche dépasse **45 secondes** | *« La recherche prend plus de temps que prévu. Elle se poursuit : vos missions apparaîtront ici dès qu'elle aura abouti »* | à 45 s — **le run n'est pas interrompu**, seule l'attente l'est |

> **CE QUE L'ÉCRAN DISAIT AVANT, ET POURQUOI C'ÉTAIT PIRE QU'UN RETARD.**
> *« Analyse de votre profil en cours… vos missions arrivent dans quelques instants »*, pendant que
> la route posait une échéance à **soixante minutes** et rendait la main. Puis, **cent vingt
> secondes** plus tard : *« Aucune mission ne correspond à votre profil pour le moment. »*
>
> La première phrase annonçait un travail qui n'avait pas commencé. La seconde annonçait un
> **résultat** — « on a cherché, il n'y a rien » — qu'on n'avait pas. Et le moteur était **éteint** :
> même après soixante minutes, rien ne serait sorti.
>
> La fin de « l'analyse » était décidée par **deux chronomètres** (75 s et 120 s) qui ne savaient
> rien du moteur : ils mesuraient le **temps**. Ils sont supprimés, pas désactivés.
> Détail complet : **§E.51** et **§D.13**.

**Les mêmes phrases des deux côtés, par construction.** Les tableaux de bord freelance et CDI
montent **le même composant**, qui lit **le même espace de traduction** — les douze raisons sont
écrites une fois, dans les quatre langues. Deux blocs jumeaux dans deux espaces séparés auraient
dérivé : une phrase corrigée d'un côté serait restée fausse de l'autre, et le second se lirait comme
corrigé (§E.20).

**La relance : reporter n'est pas annuler.** Un expert modifie son profil, le moteur tourne ; il le
modifie à nouveau dans l'heure, et l'ancien garde-fou de débit **refusait** — le déclenchement était
**perdu**, ses dernières modifications jamais notées, et rien ne le signalait. Désormais on
**reporte** : `programmer_relance_expert()` écrit l'échéance **en une seule instruction en base**
(§F), `prochaine_relance_expert()` la réclame, `solder_relance_expert()` ne solde **que ce qui était
dû** — un déclenchement arrivé pendant le run n'est pas effacé.
Délai **60 minutes**, attente totale bornée à **6 heures**, tâche `expert_relance_trigger` toutes les
5 minutes.

> ⚠️ **LE REPORT NE VAUT QUE LÀ OÙ LA RAFALE EXISTE — mesuré, et corrigé le 21/09/2026.**
> Il avait deux appelants : l'**enregistrement d'un profil** (un expert reprend son profil en dix
> passes : dix runs coûtent dix fois — la rafale est là) et la **bascule de disponibilité** (un
> interrupteur à deux positions : **aucune rafale**, et une heure d'attente qui n'absorbait rien).
> Il reste sur le premier, il est **retiré** du second.
> Il ne s'applique pas non plus à l'**approbation** : la règle « immédiat à l'approbation » était
> écrite dans le module depuis le lot 6, et le code ne l'appliquait pas — un expert fraîchement
> approuvé lisait « aucune mission ne correspond à votre profil ».
> **Le plafond horaire, lui, s'applique à tous ces chemins**, et c'est le même code. L'inventaire
> complet des déclencheurs est en **§C.14** ([architecture](architecture.md)).
Un plafond anti-abus de **20 programmations / heure / expert** protège l'**écriture** (pas le coût :
la temporisation borne déjà le coût). Il vit en **constante nommée dans le code**, et n'a
**volontairement aucun champ** dans `/admin/matching` — *un seuil anti-abus n'est pas un réglage
commercial, et le rendre réglable invite à le désactiver le jour où il gêne.* En échange, les
dépassements sont **comptés** (`relance_overruns`) et affichés.

**La notification.** Trois événements (`new_match_opportunity`, `new_candidature_received`,
`new_message`), déclarés **une seule fois** dans [lib/notifications/catalog.ts](../lib/notifications/catalog.ts)
— lu à la fois par l'écran de réglages et par le dispatcher, pour qu'un interrupteur affiché soit
toujours un interrupteur honoré.
Le public est **un fait, pas un type** : « a un profil expert », « est membre actif d'une org »,
« tout le monde ». Un expert qui publie via son organisation personnelle reçoit donc légitimement les
trois — un découpage par `user_type` l'aurait privé du réglage correspondant.
Regroupement : **digest** pour les opportunités (anti-rafale : un run peut produire 20 matches d'un
coup), **un envoi par élément** pour les messages.
**Seul le canal e-mail est ouvert** (§D.2). Et **`notify_enabled` vaut `false` par défaut sur chaque
écosystème** (§P4) : aujourd'hui, personne n'est notifié.

**Ce que l'expert voit.** Son flux est **ordonné** par le score, mais le score **ne sort pas de
l'API** : `/api/me/missions` le passe en **chaîne** à `.order()` et ne lit jamais sa valeur. L'expert
reçoit un **palier** — « Correspondance forte » ou « Correspondance » — **figé au moment de la
notation**. Jamais recalculé à l'affichage : le seuil est réglable et les scores ne sont pas
comparables entre deux runs, un recalcul rebaptiserait des matches anciens en silence.
Deux paliers et pas trois : une troisième valeur réintroduirait une graduation, donc un classement,
donc la comparaison entre experts.

---

### P1.4 — L'expert postule

**1. Il ouvre une mission.** `/dashboard/{freelance,cdi}/missions/[id]`. Il peut la **décliner**
(`POST /api/me/missions/[id]/dismiss`) — le match passe `dismissed`, et le vivier ne le reproposera
plus : c'est **sa décision**, pas un jugement.

**2. Il postule.** `POST /api/candidatures`, `maxDuration = 60`.
La candidature porte `publication_id`, `profile_id`, `match_id`, `domain_id`, un `cover_message`
facultatif, et `status = 'received'`.

**3. Claude juge — au dépôt, et seulement là.**
[lib/candidatures/ai-assessment.ts](../lib/candidatures/ai-assessment.ts), `claude-sonnet-5`, lancé dans
un **`after()`** (sinon la plateforme le tuerait sans trace, §E.5), sous l'interrupteur
`ENABLE_AI_CANDIDATURE_ASSESSMENT`.
Il note **un seul couple** profil × annonce, sur **10**, et produit `ai_assessment` :
- `reason` — adressé à l'**expert** ;
- `pitch_org` — adressé à l'**organisation**, et **affiché AVANT le déverrouillage payant**. D'où
  l'interdiction, dans le prompt, de nommer un employeur ou un client : **ce texte doit rester
  compatible avec le masquage**.

Cette note (`candidatures.ai_match_score`, bornée **[0,10]**) est une **autre grandeur** que le score
de pertinence du matching (`matches.relevance_score`, borné [0,1]). Les deux ne doivent **jamais**
être affichés côte à côte : ils répondent à deux questions différentes — *pourquoi ce profil
apparaît* / *que vaut ce dossier* — à deux moments différents.

**Quand le résumé n'est pas écrit, on sait pourquoi.** `ai_redaction_failures` distingue trois
causes — **plafond** de dépense atteint (un choix, pas une panne), **interrupteur** coupé, **erreur**.
`candidature_ai_health()` les confondait toutes en « sans jugement IA », et elles n'appellent pas la
même action.

**4. Il suit ses candidatures.** `/dashboard/{freelance,cdi}/candidatures`.
L'**état de vie est dérivé à la lecture**, côté serveur
([lib/candidatures/lifecycle.ts](../lib/candidatures/lifecycle.ts)) : `status` est la **mécanique**,
l'état de vie est le **fait**. Une candidature `unlocked` dont la fenêtre de 15 j est passée
affichait « Échange ouvert » — un libellé menteur.
Deux buckets, **et toujours une raison nommée** : jamais un « Archivée » nu.
· actif — `selected`, `exchange_open`, `awaiting_review` ;
· archivé — `exchange_expired`, `publication_expired`, `publication_closed`, `rejected`, plus les
  vestiges `withdrawn` / `archived` (jamais écrits par le produit, couverts en lecture pour que
  d'éventuelles lignes historiques tombent dans un bucket honnête).
`until` porte la fin de la fenêtre encore ouverte — c'est le **seul** endroit où l'utilisateur
apprend qu'il a 15 j ou 30 j, **avant** que la fenêtre se ferme.
Le client **rend** la raison, il ne la calcule pas : il ne peut pas afficher actif ce que le serveur
dit archivé.
Le **point de vue diffère, pas l'état** : l'expert voit ses candidatures déposées, l'organisation ses
candidats reçus — le même module sert les deux côtés, sinon l'entreprise lirait « Échange ouvert »
sur ce que l'expert voit archivé.

> ⚠️ **ÉCART CONNU (§D.6).** L'expert **voit** `ai_match_score` sous la forme **`N/10`** sur
> `/dashboard/{freelance,cdi}/candidatures`
> ([CandidaturesTrackingView.tsx:291](../components/dashboard/CandidaturesTrackingView.tsx#L291)) et
> dans le panneau de détail. Ce qu'il ne voit jamais, c'est le score de **pertinence**. La règle
> « l'expert ne voit jamais de note chiffrée » est donc **plus large que le code**.

---

### P1.5 — L'organisation lit, dévoile, échange

**1. Elle reçoit.** `/dashboard/entreprise/candidatures` et
`/dashboard/entreprise/annonces/[id]/candidatures`. Tri **serveur** par `ai_match_score` décroissant.

**2. Elle voit un CODE, pas un nom.** L'expert est affiché **`YCH`** — première lettre du prénom,
deux premières du nom, majuscules, sans espace ni point. Le calcul est **au serveur** : le navigateur
de l'entreprise ne reçoit **jamais** le nom complet.
Le format « trois majuscules » est un **signal de pseudonymisation** : il ne peut pas être confondu
avec un vrai nom, contrairement à l'ancienne forme « Prénom + lettre » qui ressemblait à une identité
tronquée. (Détail des cas limites : §D.4.)
Avant déverrouillage, elle dispose du `preview`, du `pitch_org` rédigé par Claude, et de la note sur
10 — de quoi décider, **sans identité**.

**3. Elle dévoile.** Deux chemins, **une seule mécanique** ([lib/unlock.ts](../lib/unlock.ts),
idempotente) :
· **auto-dévoilement** du meilleur candidat à la création de la candidature — **sans quota** ;
· **dévoilement manuel** `POST /api/candidatures/[id]/unlock` — **sous quota**, refus **402
  `unlock_limit_reached`**.
Statuts acceptés en entrée : `received`, `in_review`, `shortlisted`.
Le dévoilement pose `unlocked_at`, ouvre une `conversation` avec
`expires_at = unlock + 15 jours`, et notifie l'expert (`candidature_unlocked`).

**Ce que le dévoilement donne — et ce qu'il ne donne jamais.**
[lib/expert-disclosure.ts](../lib/expert-disclosure.ts) est la **seule** fonction de divulgation, et les
**cinq** surfaces qui projettent un profil expert vers une organisation la traversent : candidatures
agrégées, candidatures d'une annonce, sous-traitance, inbox, fil de messages. *Si une surface décide
encore seule, la faille reste ouverte.*
· dévoilé et **actif** → photo + nom complet ;
· **jamais** → `email`, `phone`, `linkedin_url`, `cv_url`. `reveal_contact` vaut `false` partout,
  toujours, même après paiement. Aucun chemin serveur ne les projette.

**4. Le dévoilement se REFERME.** Dès que la candidature bascule en **archivé**, le profil redevient
masqué au niveau strict d'avant déverrouillage. **L'état de vie prime sur le statut** : un
`status = 'unlocked'` figé en base ne rouvre rien.
Sans cette règle, une organisation pourrait publier, déverrouiller, laisser expirer, et **se
constituer une base de profils identifiés** — un détournement de la finalité du traitement.
Le **motif** de l'archivage est indifférent : expiration 30 j, clôture manuelle, retrait, fenêtre
d'échange close, refus. **Clôturer ses annonces plutôt que les laisser expirer ne contourne rien.**
**Exception : `selected`.** Un candidat **retenu** est actif **sans limite de durée** et ne se
re-masque jamais — la relation commerciale existe, le fait est acquis.
Ce qui se ferme est le **chemin d'accès permanent**, pas la trace : le corps des messages n'est pas
réécrit. On n'efface aucun historique, et on ne prétend pas l'avoir anonymisé. L'en-tête d'un fil
archivé, lui, re-masque.

**5. Elles échangent.** `/dashboard/entreprise/messages/[id]` ↔ `/dashboard/{freelance,cdi}/messages/[id]`.
Fenêtre **15 jours** à compter du déverrouillage
([lib/conversations/expiry.ts](../lib/conversations/expiry.ts), source unique). Contrairement aux
annonces, `conversations.expires_at` **est réellement écrit** en base.
Fenêtre close → l'envoi est refusé **409**. La lecture reste possible : on ferme un chemin, on
n'efface pas.
Message : **5000 caractères** maximum (refus 400 `invalid_content`). Notification `new_message` par **e-mail uniquement** — décision
produit explicite : *une conversation compte 5 à 10 allers-retours ; un SMS par message sature le
destinataire pour ~0,08 € pièce.* Le canal SMS **n'existe pas** pour cet événement, l'écran de
réglages ne peut donc pas l'afficher.
L'aperçu de chaque fil et son compteur de non-lus sont calculés **en SQL, par conversation**. L'ancienne
version lisait les **500 derniers messages toutes conversations confondues** puis gardait le premier
vu par fil : au-delà de 500 messages cumulés, les conversations les moins récentes n'apparaissaient
dans **aucune** ligne lue. Ce n'était pas une troncature, c'était un résultat **faux** — un fil sans
aperçu se lit « personne n'a rien écrit », l'inverse de la vérité.

**6. Elle tranche.** `POST /api/candidatures/[id]/select` (→ `selected`, `selected_at`) ou
`/reject` (→ `rejected`, avec motif). Le refus **re-masque** immédiatement (bucket archivé).

### P1.6 — Le commerce, les offres, les quotas

**Rien n'encaisse aujourd'hui.** Le chemin de paiement est **construit, câblé et testable**, et il
est fermé par **deux verrous** (§D.1, §P4). Ce chapitre décrit ce qui existe, pas ce qui tourne.

**1. Le catalogue.** `packages` + `package_features`, édités dans `/admin/packages`.
Seed initial — **modifiable au back-office**, `ON CONFLICT DO NOTHING` et jamais `DO UPDATE` pour
qu'un redéploiement n'écrase pas une valeur ajustée :

| Offre | Prix/mois | Annonces/mois | Annonces actives | Candidats dévoilés/annonce | Dévoilements manuels/mois |
|---|---|---|---|---|---|
| **Free** (défaut, cible `all`) | — | 2 | 2 | 1 | 2 |
| **Collaboration** (défaut, cible `collaboration`) | — | **1** | **1** | 1 | **0** |
| **Business** | 349 € | illimité | 5 | illimité | illimité |
| **Elite** | 899 € | illimité | illimité | illimité | illimité |

> ⚠️ **L'offre `Collaboration` manquait à ce tableau, et ce n'est pas un détail d'inventaire.**
> C'est elle — et non `Free` — que reçoit l'**organisation personnelle** d'un expert
> (`org_type = 'freelance'` → `target_role = 'collaboration'`,
> [lib/org-target-role.ts](../lib/org-target-role.ts)). Un expert qui publie un besoin de
> sous-traitance a donc **UNE** annonce par mois, **UNE** active, et **ZÉRO dévoilement manuel** :
> il ne dispose que du dévoilement automatique du meilleur candidat. Le tableau laissait lire
> 2 / 2 / 2.
> Et `fallbackTargetsFor()` refuse explicitement qu'une offre `all` couvre `collaboration` : un
> expert dont le rattachement saute **ne peut pas** hériter d'une offre entreprise.

Une offre applicable aux clients **et** aux cabinets est **une seule ligne** (`target_role = 'all'`) :
le seed initial les dupliquait, l'admin voyait chaque offre en double et devait éditer deux fois le
même prix.
Invariant **gardé en base** : l'offre par défaut est **gratuite**
(`packages_default_must_be_free`). La désigner se fait par la RPC `set_default_package()`, atomique
(§F).

**2. L'abonnement.** Il vit sur **`organizations`** — `package_id`, `package_started_at`,
`package_valid_until`, `stripe_subscription_id`, `stripe_subscription_status`,
`package_source_event_at` — et **plus** sur `organization_domains` (§B.2 ①).
**Un seul abonnement, un seul quota, partagés entre TOUS les écosystèmes.** Une organisation accède
à tous les écosystèmes actifs ; seules les **données** sont cloisonnées.
`usage_counters` n'a **délibérément pas** de `domain_id` dans sa clé : le quota partagé est **voulu**.

**3. Les droits, lus à la lecture.** [lib/entitlements.ts](../lib/entitlements.ts) :
- `package_id` non nul **et** (`package_valid_until` nul **ou** futur) → cette offre ;
- sinon → l'offre `is_default` active couvrant le `target_role` de l'organisation (mapping
  `esn` → `cabinet`), la ligne spécifique primant sur la ligne `'all'`.

**L'expiration est décidée À LA LECTURE. Aucun batch, aucun cron.**
**Fail-open assumé** sur toute la couche Droits : un moteur commercial en panne ne bloque **jamais**
l'usage produit (limite `null` = illimité, `console.warn`). ⚠️ **Ne pas « corriger » en fail-closed :
c'est un choix délibéré, pas un oubli.**

**4. La consommation.** `usage_increment()` — un seul `INSERT … ON CONFLICT DO UPDATE` sous garde de
limite (§F). Période = mois civil pour les compteurs mensuels, epoch (`1970-01-01`) pour les
compteurs `never`.

**5. Le parcours d'achat** (fermé, cf. §P4).
`/dashboard/entreprise/offre` → `/api/billing/offers` → `/api/billing/checkout` → Stripe →
`/api/billing/return`. Ensuite `/api/billing/portal` (portail client) et `/api/billing/change-plan`.
**Checkout HÉBERGÉ, jamais de formulaire intégré** : aucune donnée de carte ne touche ce serveur ni
notre DOM. Le périmètre PCI-DSS reste le plus léger, et le SDK navigateur a été **retiré des
dépendances**.
Cette route **n'accorde aucun droit** : elle rend une URL. **Les droits viennent du webhook, et de
lui seul.**

**6. Le webhook.** `/api/stripe/webhook` — **la seule route de l'application sans `requireAuth`**, et
ce n'est ni un oubli ni à corriger : l'appelant est Stripe, il n'a ni session, ni jeton, ni domaine.
L'authentification est la **signature cryptographique** du corps.
- Corps lu **brut** (`await request.text()`, **jamais** `.json()`) : la signature est un HMAC des
  **octets exacts**. Un JSON désérialisé puis re-sérialisé est un autre texte — c'est le piège n°1
  des webhooks Stripe, et il échoue de façon intermittente et incompréhensible.
- **Idempotence par contrainte de base** : `stripe_event_claim()` est un `INSERT … ON CONFLICT` dont
  la clé primaire **est** l'identifiant Stripe. Deux livraisons simultanées sont sérialisées par le
  verrou de ligne PostgreSQL.
- Un événement `livemode` arrivé sur un environnement hors production est **ignoré** (journalisé,
  **200**) : on ne fait pas échouer l'endpoint, Stripe le désactiverait.
- **Ce n'est pas un batch** : c'est une requête HTTP entrante déclenchée par un fait. C'est même ce
  qui **évite** de balayer périodiquement les abonnements pour savoir qui a payé. La règle « zéro
  batch, zéro cron d'hébergeur » est tenue.

**7. Ce que l'organisation voit.** Le montant **PRÉLEVÉ**, lu dans `transactions` — **jamais** le
prix du catalogue. Les `Price` Stripe sont **immuables** : une organisation abonnée à 349 € y reste
quand le catalogue passe à 399 €, et lui montrer 399 € serait un litige commercial en puissance.

**8. L'attribution manuelle.** `/admin/organisations/[id]` → `POST /api/admin/assign-org-package`,
pour les comptes **pilotes**. Elle **refuse** (409 `org_has_stripe_subscription`) de passer par-dessus
un abonnement Stripe vivant : sinon l'offre changerait sans facturation ni remboursement, puis le
prochain événement Stripe la réécrirait — l'admin verrait son geste s'annuler seul, sans explication.
Le refus est **au serveur** : griser un bouton ne garderait rien.

**9. La synchronisation du catalogue.** La synchro vers Stripe **précède** l'écriture locale : son
échec la **refuse**, avec un message explicite. Sinon Skilloria afficherait 399 € pendant que Stripe
prélève 349 €, et personne ne le verrait — les deux côtés fonctionnent parfaitement, séparément.
Les clés d'idempotence sont **dérivées et stables** (§F) : deux synchros concurrentes ne créent plus
deux produits.

---

## P2. Les écrans qui existent

### P2.1 — Public (hors session)
| Écran | À quoi il sert |
|---|---|
| `/` | Accueil de l'écosystème servi par le sous-domaine (branding, couleurs, libellés, produits mis en avant). **C'est la RÉFÉRENCE VISUELLE du produit** : depuis le 21/09/2026, tout le site porte sa palette, aux mêmes valeurs — §P3.8. |
| `/qui-sommes-nous` · `/contact` | Présentation ; formulaire de contact. |
| `/inscription` · `/inscription/[role]` · `/inscription/confirmation` | Inscription expert (branche + spécialité **structurées**, CGU horodatées, OTP téléphone). |
| `/inscription/organisation` (+ `/confirmation`) | Inscription organisation (SIREN/numéro, vérification à suivre). |
| `/connexion` · `/mot-de-passe-oublie` · `/nouveau-mot-de-passe` · `/auth/callback` | Session. |
| `/invitation/[token]` | Acceptation d'une invitation à rejoindre une organisation. |
| `/reactivation` | Réactivation d'un compte pendant la grâce de 90 j. |
| `/ecosysteme-indisponible` | **Un écran par motif de refus d'écosystème** — et non un « accès refusé » nu : un expert égaré lit *votre écosystème est celui-ci, voici l'adresse*. |
| `/cgu` · `/mentions-legales` · `/politique-de-confidentialite` | Documents légaux, servis depuis `docs/legal/*.md`. |

### P2.2 — Expert freelance et expert CDI
> **LES 66 ÉCRANS DE L'ESPACE CONNECTÉ PORTENT LE MÊME CADRE — depuis le 21/09/2026 seulement.**
> Barre latérale, en-tête, bouton Retour : c'est `DashboardShell`, monté par les sub-layouts. Avant
> ce lot, ils étaient **cinq cadres différents**, et deux pages n'en avaient aucun.
>
> **`cdi/mon-profil` était une impasse.** Ni barre latérale, ni navigation, ni bouton Retour : un
> expert qui ouvrait son profil n'avait plus aucun lien vers le reste du produit. L'exclusion qui
> l'y condamnait était justifiée par un commentaire **faux** (§E.53).
>
> **L'en-tête est BEIGE**, comme la barre latérale. Il était blanc — la couleur des cartes — sur le
> cadre que Youssef avait choisi en beige. C'est ce qu'il a vu en premier en testant.
>
> **Les numéros de section ne sont plus verts, ambre ou rouges.** Ces trois couleurs disent un
> **état** ; un numéro de section n'en est pas un, et un formulaire dont la section 5 est rouge dit
> à celui qui le remplit qu'il s'y est trompé (§E.54). Ce qui reste coloré parce que c'est
> vraiment un état : le statut de marché d'un expert CDI, « en poste » / « en recherche ».

**Parité vérifiée : 14 écrans de chaque côté, aucun manquant ni d'un côté ni de l'autre.**

| Écran (× 2 : `/dashboard/freelance/…` et `/dashboard/cdi/…`) | À quoi il sert |
|---|---|
| *(index)* | Tableau de bord : missions recommandées, candidatures, badges, état du profil. |
| `missions` · `missions/[id]` | Le flux des opportunités, ordonné par pertinence, **sans aucun nombre affiché** — deux paliers. Décliner s'y fait. |
| `candidatures` · `candidatures/[id]` | Suivi des candidatures, par **état de vie dérivé** avec sa raison. ⚠️ **Affiche `N/10`** (§D.6). |
| `messages` · `messages/[id]` | Messagerie, fenêtre 15 j. |
| `profil` · `profil/valider` | Saisie du profil et dépôt du CV ; lancement de la vérification. |
| `mon-profil` | Le profil **tel que l'organisation le verra**. |
| `sous-traitance` · `sous-traitance/nouveau` · `sous-traitance/[id]` | Publier un besoin et recevoir des experts (via l'organisation personnelle, §P1.2 bis). |
| `parametres` | Compte, langue, notifications, sessions, suppression. |

> **Dette de parité SIGNALÉE DANS LE CODE, pas dans les écrans.** La parité de *surface* est
> complète, mais quatre fichiers portent un `TODO post-merge V1+V3 : factoriser` —
> [lib/cv-parser-cdi.ts](../lib/cv-parser-cdi.ts),
> [app/api/profile/cdi-upload-cv/route.ts](../app/api/profile/cdi-upload-cv/route.ts),
> `app/[locale]/dashboard/cdi/profil/page.tsx`, `…/profil/valider/page.tsx`.
> **Deux copies dérivent** : c'est le risque de parité réel de ce projet, et il est dans le code, pas
> dans la liste des écrans.

### P2.3 — Organisation (client, cabinet, ESN — un seul dashboard)
`client`, `cabinet` et `esn` partagent **`/dashboard/entreprise`**. `/dashboard/cabinet` est une
**redirection** conservée pour les anciens signets — pas un écran.

| Écran | À quoi il sert |
|---|---|
| `/dashboard/entreprise` | Tableau de bord : annonces, candidatures reçues, compteurs. |
| `annonces` · `annonces/nouvelle` · `annonces/[id]` · `annonces/[id]/modifier` | Cycle de vie d'une annonce. |
| `annonces/[id]/candidatures` | Les candidats d'une annonce, triés serveur, **masqués** avant dévoilement. |
| `candidatures` | Toutes les candidatures reçues, toutes annonces confondues. |
| `messages` · `messages/[id]` | Messagerie avec les experts dévoilés. |
| `membres` | Membres, rôles (`admin`/`editor`/`viewer`), invitations. |
| `organisation` | Fiche et statut de vérification. **Téléversement du logo** (admin seul ; un non-admin voit le logo et lit pourquoi il ne peut pas). La **saisie d'URL a disparu** — §E.17. |
| `offre` | Offre en cours, consommation, parcours d'achat (**mur fermé**, §P4). |
| `parametres` | Compte et préférences du membre. |

> **Asymétrie d'écrans, VÉRIFIÉE et VOULUE** : l'expert a `mon-profil` (se voir comme l'autre le
> voit) ; l'organisation n'a **pas** d'équivalent. Ce n'est pas un oubli de parité — l'organisation
> n'est pas *regardée* par les experts de la même façon.

### P2.4 — Administration
| Écran | À quoi il sert |
|---|---|
| `/admin` | Tableau de bord plateforme. |
| `utilisateurs` · `utilisateurs/[id]` | Comptes : statut, rôle d'organisation, sessions, purge, ré-invitation. |
| `experts` · `experts/[id]` | Modération des vérifications d'experts (approuver / refuser avec motif). **Le numéro de téléphone de l'expert y est visible, et c'est une finalité** (arbitré le 21/09/2026) : l'administrateur peut **appeler** l'expert en cas de doute avant de trancher — la donnée sert à la décision. C'est la seule surface d'administration qui le montre ; les écrans de gestion de **compte** (`utilisateurs`) n'en ont pas besoin pour suspendre ou révoquer, et ne le servent pas (`diag-admin-users`, famille A). |
| `organisations` · `organisations/[id]` | Modération des organisations ; attribution manuelle d'offre ; consommation. |
| `packages` · `packages/new` · `packages/[id]` | Catalogue commerce : offres, limites, offre par défaut, synchro Stripe. |
| `matching` | Les **deux seuils** par écosystème, le modèle de reranking, la taille de lot, `notify_enabled` ; pannes de rédaction et dépassements de relance. Et les **deux réglages d'argent** — plafond de dépense (**il bloque**) et seuil d'alerte par acteur (**il alerte**) — chacun dans le bloc qui affiche déjà sa valeur. |
| `quotas-ia` | Les quotas anti-abus IA (analyses de CV). |
| `supervision` · `supervision/[sujet]` | **Ce qui s'observe, séparé de ce qui se décide.** Les problèmes **en premier et déjà triés par le serveur** ([lib/supervision/problemes.ts](../lib/supervision/problemes.ts)) — le rouge ne sert plus à expliquer un fonctionnement normal. Répartition des notes, consommation **par mois et par type d'opération**, opérations les plus coûteuses. Chaque problème s'**ouvre** : `inacheves`, `operations`, `resumes`, `relances` — un total ne permet d'agir sur rien. Aucun contenu utilisateur n'y est affiché, et **jamais l'identité d'un expert** (§D.4). |
| `tarifs-ia` | **La grille tarifaire des modèles**, réglable sans déploiement. Dit en une ligne que le compteur de dépense est une **estimation reconstituée**, pas la facture ; affiche **depuis quand** chaque prix n'a pas été modifié, et **rougit au-delà de 90 jours** ; renvoie à la grille du fournisseur pour comparer sans chercher. Les dépenses restent en **dollars** — les fournisseurs facturent en dollars, et aucune conversion n'est faite. |
| `taxonomie` · `taxonomie/[id]` | Branches et spécialités, et leurs traductions. |
| `ecosystemes` | Créer un écosystème, le traduire, l'ouvrir, **CHOISIR SES COULEURS** — et dire ce qui manque. Le panneau « Les couleurs de cet écosystème » porte **un sélecteur par rôle**, un **aperçu en direct**, et une garde qui **REFUSE d'enregistrer** une combinaison illisible en nommant la paire fautive, son ratio et le minimum (§P3.8). Logo et favicon **téléversés** (bucket public `ecosysteme`, chemin dérivé de `domain_id`) ; la saisie d'URL a disparu — §E.17. Le détail est un **panneau dans la page de liste**, pas un écran : `/admin/ecosystemes/[id]` n'existe pas (seule la **route API** porte ce chemin). Ce tableau l'annonçait comme un écran. |
| `durees` | Les **deux durées du contrat de la place** — vie d'une annonce (**rétroactive**) et fenêtre d'échange (**non rétroactive**), §P3.7. |
| `taches-planifiees` · `taches-planifiees/[job_name]` | Supervision pg_cron : activer/désactiver, reprogrammer, déclencher, historique. |
| `collaboration` | Les organisations personnelles d'experts. |
| `facturation` | **Ce que Stripe ne peut pas savoir**, et rien d'autre. Ni paiement, ni facture, ni remboursement, ni litige — ils vivent dans le tableau de bord Stripe, vers lequel l'écran porte **un lien** ; les recopier ferait diverger une copie de sa source. Quatre blocs : la **santé du raccordement** (secret, mode, point de réception, et « aucun événement depuis N jours » écrit en toutes lettres plutôt que déductible), les **écarts** entre les droits en base et l'abonnement Stripe, la **dernière vérification nocturne**, et le **journal des événements reçus** — où un événement réclamé et jamais clôturé est une ligne **rouge**, parce qu'il ne se rejouera jamais seul. **LECTURE SEULE : aucun champ de saisie, aucun bouton qui écrit.** Corriger automatiquement un écart qu'on ne comprend pas encore est irréversible dans les deux sens. Détail complet en [architecture §C.10](architecture.md). |

| `seuils` | **Les seuils de jugement** : auto-approbation d'expert, vérification d'entreprise, qualité d'annonce — par pays et par type. Dit **ce que chaque seuil produit**, montre la colonne inerte **comme inerte**, et **journalise** chaque modification. |

> **§P2.4 a longtemps dit « il n'existe aucun écran pour `verification_providers` ». C'est désormais
> FAUX** : [/admin/seuils](../app/[locale]/admin/seuils/page.tsx) existe, et §P3.3 le reflète.
> Ce qui reste vrai : **`ai_spend_caps` n'a toujours aucun écran** — seule la *dépense* du mois est
> affichée, sur `/admin/matching`, sans son plafond à côté.

---

> **Toute liste servie avec un plafond DIT sa troncature, et l’écran la montre** (21/09/2026). Le
> serveur lit une ligne de plus que son plafond (`lib/plafonds-liste`) ; chaque écran qui reçoit le
> drapeau affiche le même bandeau ambre ([components/ui/BandeauTroncature.tsx](../components/ui/BandeauTroncature.tsx)),
> avec la phrase qui dit **ce qui est coupé et quel bout tombe** : annonces (les plus anciennement
> modifiées), candidatures d’organisation (les moins bien notées — et les compteurs sont alors
> partiels), suivi expert et boîte de réception (les plus anciennes), fil de messages (les plus
> anciens), journal de sessions et fiche d’approbation (les entrées les plus anciennes). Un plafond
> qui ne se dit pas est un mensonge différé ; `diag-plafonds-listes` rougit sur un écran qui le tait.

## P3. Les règles métier, rassemblées

Pour chacune : **sa valeur**, **d'où elle vient**, **qui peut la changer**.
« Back-office » = un écran `/admin` l'expose. « Base » = la valeur est en base mais **aucun écran ne
l'expose**. « Code » = un déploiement est nécessaire.

### P3.0 ter — CE QUE PAIE CHAQUE BUDGET, USAGE PAR USAGE

Les deux budgets étaient nommés **par fournisseur** — « Classement des experts », « Rédaction et
analyse ». C'est un découpage de **facturation**, pas d'usage : celui qui cherche « analyse de CV »
ou « candidature » ne les trouve **nulle part**. Chaque budget dit désormais **ce qu'il paie**, et le
fournisseur passe en second.

| Budget | Ce qu'il paie | `action` en base | Fournisseur |
|---|---|---|---|
| **Matching — classement des experts** | notation des experts face à une annonce publiée | `matching_pool` | Cohere |
| **Rédaction et vérifications** | résumé de candidature · analyse de CV · vérification d'un expert · vérification d'une entreprise · contrôle d'une annonce | `candidature_assessment`, `pitch`, `cv_parsing`, `expert_verification`, `org_verification`, `publication_quality` | Anthropic |

**Les sept points de dépense sont exactement ceux qui appellent `budgetDisponible` puis
`enregistrerDepenseIA`** — vérifiable par balayage, pas de mémoire. Le second budget en couvre six ;
le premier, un seul.

**Les montants restent en dollars**, sur les deux écrans qui les portent : les fournisseurs facturent
en dollars, et convertir demanderait un taux de change — un réglage de plus, qui vieillirait en
silence et ferait dériver l'estimation (§E.13). Le reste du produit est en euros.

### P3.0 bis — LE VOCABULAIRE DES RÉGLAGES : QUATRE MOTS, UN PAR COMPORTEMENT

**Le mot « seuil » ne s'écrit plus dans ce produit.** Il désignait **quatre comportements
incompatibles** à la fois, et c'est lui qui a rendu `/admin/matching` illisible — au point que le
propriétaire du produit l'a ouvert sans savoir quoi faire.

| Mot | Ce qu'il fait | Où il vit |
|---|---|---|
| **PLAFOND** | il **BLOQUE** : atteint, la fonctionnalité s'arrête | `ai_spend_caps`, `ai_quotas`, `package_features` |
| **ALERTE** | elle **SIGNALE** : elle marque à l'écran, elle n'empêche rien | `ai_spend_seuils_acteur` |
| **FILTRE** | il **TRIE** : il décide ce qui est montré | `matching_settings.feed_threshold` / `notify_threshold` |
| **NOTE** | elle **JUGE** : elle qualifie un dossier | `verification_providers` (auto-approbation, vérification, qualité) |

**Un réglage qui ne rentre dans aucun des quatre se DIT** plutôt que de se faire appeler « seuil »
par défaut : une **durée** (`duree_reglages`), un **référentiel** (`ai_model_tarifs`), un
**interrupteur** (`notify_enabled`, `is_active`), un **choix de modèle** (`rerank_model`), un
**paramètre technique** (`rerank_batch_size`).

> ⚠️ **L'EXCEPTION, DANS LE MÊME PARAGRAPHE — sinon la règle ment au premier `grep`.**
> **Les colonnes existantes gardent leur nom pour l'instant** : `feed_threshold`, `notify_threshold`,
> `confidence_threshold`, `auto_approve_threshold`, `seuil_mensuel_usd`. Les clients Supabase ne sont
> pas typés : une colonne est lue **par son nom, dans une chaîne**, et un renommage **casse au
> runtime, en silence**. Leur renommage est un **lot à lui seul**, avec son propre contrôle — une
> décision, pas un oubli. Écrans, documentation, messages et **noms de contraintes** prennent le
> vocabulaire **dès maintenant**.

### P3.0 — L'ÉCHELLE UNIQUE : TOUT SE NOTE DE 0 À 10

**Toute note du produit est sur 0-10. Il n'y a pas de seconde échelle.**

Avant le 19/09/2026, les filtres de pertinence vivaient en **0-1** et les notes de jugement en
**0-10**, et rien ne le disait à l'écran : **« 1 » signifiait *parfait* d'un côté et *médiocre* de
l'autre**, sur la même page. Le propriétaire du produit a ouvert `/admin/matching` et n'a pas su quoi
faire — c'est le seul verdict qui compte.

**Le reranker, lui, produit du 0-1 : c'est sa nature, et on n'y touche pas.** Sa sortie est
multipliée par 10 **au seul point où un score entre dans le système** — la frontière avec le
fournisseur, [lib/matching/rerank.ts](../lib/matching/rerank.ts). Au-delà, tout est en 0-10 : la
colonne, les réglages, la comparaison, la trace, l'écran.

> **Il n'existe AUCUNE autre conversion dans le produit, et c'est gardé** par
> [scripts/diag-echelle-des-notes.mjs](../scripts/diag-echelle-des-notes.mjs). Convertir à
> l'affichage laisserait deux représentations ; convertir à la comparaison mettrait la conversion sur
> **quatre** sites, et en oublier un transformerait `score < 7` en `score < 0.7` — tout passe, ou
> rien ne passe, **en silence**.

**Ce qui a changé de valeur sans changer de sens** : un filtre à `0` reste `0` (« tout passe ») ; un
filtre à `1` devient `10` (« seul le parfait passe »). La multiplication préserve le sens par
construction — un `1` ne peut pas devenir « presque tout passe ».

**L'historique n'est pas réécrit, il est daté.** Les runs d'avant la bascule ont enregistré leurs
statistiques en 0-1. Les nouveaux portent une estampille `echelle: 10`, et la lecture ne prend
**que** les runs estampillés : moyenner les deux produirait un nombre juste sous une étiquette
fausse. La répartition observée **repart** au déploiement, et l'écran le dit comme un état.

### P3.1 — Commerce et quotas
| Règle | Valeur | Origine | Qui peut la changer |
|---|---|---|---|
| Annonces par mois | Free 2 · Business ∞ · Elite ∞ | `package_features` | **Back-office** `/admin/packages` |
| Annonces actives simultanées | Free 2 · Business 5 · Elite ∞ | `package_features` | **Back-office** |
| Candidats dévoilés par annonce | Free 1 · Business ∞ · Elite ∞ | `package_features` | **Back-office** |
| Dévoilements manuels / mois | Free 2 · Business ∞ · Elite ∞ | `package_features` | **Back-office** |
| Prix | 0 / 349 € / 899 € | `packages.price_monthly` | **Back-office** (+ synchro Stripe) |
| Offre par défaut | **DEUX** : `Free` (cible `all`) et `Collaboration` (cible `collaboration`) | `packages.is_default`, RPC `set_default_package()` | **Back-office** |
| Invariant « l'offre par défaut est gratuite » | — | contrainte `packages_default_must_be_free` | **Personne** — migration |
| Sièges maximum | **inactif** | `packages.max_seats` | **Personne** (§P4) |

### P3.2 — Moteur de mise en relation
| Règle | Valeur | Origine | Qui peut la changer |
|---|---|---|---|
| **Filtre** du flux | **0 / 10** (tout profil éligible entre) | `matching_settings.feed_threshold` | **Back-office** `/admin/matching` — **il TRIE** |
| **Filtre** de notification | **10 / 10** | `matching_settings.notify_threshold` | **Back-office** — **il TRIE** |
| Notifications actives | **`false`** | `matching_settings.notify_enabled` | **Back-office** (§P4) |
| Modèle de reranking | `rerank-v4.0-fast` | `matching_settings.rerank_model` | **Back-office** |
| Taille de lot | 200 (borne 1–1000) | `matching_settings.rerank_batch_size` | **Back-office** |
| Contrainte `notify_threshold ≥ feed_threshold` | — | CHECK en base | **Personne** — migration |
| **Budget** mensuel — *Matching, classement des experts* | **200 $** | `ai_spend_caps` (`rerank`) | **Back-office** `/admin/matching` — **il BLOQUE** |
| **Budget** mensuel — *Rédaction et vérifications* | **100 $** | `ai_spend_caps` (`claude`) | **Back-office** `/admin/matching` — **il BLOQUE** |
| **Alerte** par acteur | organisation **10 $** · expert **2 $** | `ai_spend_seuils_acteur` | **Back-office** `/admin/matching` — **elle SIGNALE, elle ne bloque JAMAIS** |
| Grille tarifaire par modèle | Sonnet 5 **2/10** · Sonnet 4.6 **3/15** · Haiku 4.5 **1/5** · rerank **0,000002 $/doc** | `ai_model_tarifs` | **Back-office** `/admin/tarifs-ia` — change quand le fournisseur change ses prix, pas quand on déploie |
| Lots en parallèle | 4 | **Code** | Déploiement |
| Délai fournisseur | 10 s | **Code** | Déploiement |
| Délai de relance | **60 min** | **Code** `DELAI_RELANCE_MINUTES` | Déploiement |
| Attente totale bornée | **6 h** | **Code** `ATTENTE_MAX_HEURES` | Déploiement |
| Plafond de programmation de relance | **20 / h / expert** | **Code** `RELANCE_MAX_PAR_HEURE` | Déploiement — **volontairement non réglable** (§D.7) |
| Pagination du vivier | 1000 lignes · 200 identifiants | **Code** | Déploiement |

### P3.3 — IA et contenus
| Règle | Valeur | Origine | Qui peut la changer |
|---|---|---|---|
| Analyses de CV | **3 / 24 h** | `ai_quotas` | **Back-office** `/admin/quotas-ia` |
| Taille de CV | 5 Mo, PDF | **Code** | Déploiement |
| Taille de logo (organisation **et** écosystème) | **2 Mo**, `image/jpeg` · `png` · `webp` — **SVG refusé** | **Code** [lib/org-logo.ts](../lib/org-logo.ts) | Déploiement |
| Vérification d'un logo | **signature binaire** lue dans les octets, type déclaré confronté au type reniflé, et c'est le **reniflé** qui est servi | **Code** `verifierFichierLogo` | Déploiement |
| **Note** de qualité d'annonce | **7 / 10** | `verification_providers` (`opportunity_quality_check`) | **Back-office** `/admin/seuils` — **elle JUGE** |
| Seuil d'auto-approbation d'expert | **8 / 10** | `verification_providers.config->>'auto_approve_threshold'` — **le jsonb, PAS la colonne** | **Back-office** `/admin/seuils` |
| Drapeaux disqualifiants d'expert | `CV_PROFILE_INCOHERENT`, `SUSPICIOUS_CONTENT`, `DOMAIN_MISMATCH` | `verification_providers.config->>'blocking_flags'` | **Back-office** `/admin/seuils` — liste vide **refusée** |
| `verification_providers.confidence_threshold` sur la ligne expert | 7 — **lue puis JAMAIS utilisée** par le chemin expert | colonne | — |
| Seuil de vérification d'entreprise | **7 / 10** (`ai_coherence_check`) | `verification_providers.confidence_threshold` | **Back-office** `/admin/seuils` |
| Ligne absente pour un pays | **refus explicite**, revue manuelle, aucun appel IA | **Code** — plus aucun repli (§E.11) | — |
| Pays ayant un décideur configuré | **la France seule** (`ai_web_search` + `official_api`) | `verification_providers` | **Écriture de données** — plus un déploiement |
| Format du numéro d'identification | **FR seule renseignée** (« SIREN », 9 chiffres) ; ailleurs **aucune règle ⇒ saisie acceptée** | `countries.registre_numero_*` | **Écriture de données** |
| Motif de mise en revue | **INTERNE** — `verification_data.motif_revue` (code + détail), lisible **sur la fiche back-office UNIQUEMENT** | **Code** | — |
| « Jamais d'auto-rejet » | — | **Code** — règle métier | Arbitrage |
| Résumé de profil | **200–800 caractères** | **Code** `lib/profile-visibility.ts` | Déploiement |
| Document envoyé au moteur | 25 compétences · 6 expériences · 300 car. chacune | **Code** | Déploiement |
| Message de conversation | **5000 caractères** | **Code** `MAX_CONTENT_LEN` | Déploiement |
| Texte rendu par Claude (reason, pitch_org) | **400 caractères** | **Code** `MAX_CARACTERES_TEXTE` | Déploiement |

### P3.4 — Délais et cycles de vie
| Règle | Valeur | Origine | Qui peut la changer |
|---|---|---|---|
| Durée de vie d'une annonce | **30 j**, calculés **à la lecture** | `duree_reglages.vie_annonce_jours` | **Back-office** `/admin/durees` — **changement RÉTROACTIF** |
| Fenêtre d'échange | **15 j** depuis le dévoilement, **écrits** en base | `duree_reglages.fenetre_echange_jours` | **Back-office** `/admin/durees` — changement **NON** rétroactif |
| Validité d'une invitation d'organisation | **7 j** | `duree_reglages.invitation_jours` | **Back-office** `/admin/durees` — changement **NON** rétroactif |
| Grâce avant suppression définitive | **90 j** | **Code** `GRACE_DAYS` | Déploiement |
| Avertissement d'inactivité | **23 mois** | **Code** `WARNING_MONTHS` | Déploiement |
| Purge d'inactivité (CNIL) | **24 mois** | **Code** `PURGE_MONTHS` | Déploiement |
| Rétention du détail d'exécution cron | 90 j (`response_body`) | migration `cron_run_log_retention` | Migration |
| Horaires des tâches planifiées | cf. §P3.6 | `cron.job` | **Back-office** `/admin/taches-planifiees` |

### P3.5 — Sécurité et abus
| Règle | Valeur | Origine | Qui peut la changer |
|---|---|---|---|
| Session unique par utilisateur | — | `users.last_session_token` (sha256) | Arbitrage |
| OTP : envois par numéro | **1 / 60 s** et **3 / h** (public) · **5 / h** (connecté) | **Code** | Déploiement |
| OTP : envois par IP | **10 / h** (public) | **Code** | Déploiement |
| « 1 numéro vérifié = 1 compte » | — | index UNIQUE PARTIEL sur `users(phone)` | Migration |
| Le dernier administrateur d'une organisation | ne peut pas se retirer | **trigger** `organizations_cliquet_siege_admin` + RPC `maj_membre_organisation` (migration `siege_administrateur`) — **et non des policies RLS**, comme ce tableau l'a longtemps écrit | Migration |
| Le dernier administrateur de la PLATEFORME | ne peut pas programmer sa suppression | table `plateforme` + `cliquet_siege_admin()` (migration `siege_admin_plateforme`) | Migration |
| Contact expert (`email`/`phone`) | **jamais exposé**, même après paiement | **Code** `reveal_contact: false` | Arbitrage |
| Changer le logo d'une organisation | **admin actif SEULEMENT** — `editor` traité comme `viewer` | **Serveur** (403 `not_org_admin`) **ET base** (policies `org_logos_admin_*`) | Arbitrage |
| Une URL externe dans `logo_url` / `favicon_url` | **impossible à écrire** | **Base** — 3 CHECK de chemin (§E.17) | Migration |

**Les quatre buckets de stockage, et leur confidentialité ATTENDUE** (table figée dans
`diag-logo-organisation` : un bucket qui change d'état, ou un bucket inconnu, rougit).

| Bucket | Public ? | Contenu | Écriture | Lecture |
|---|---|---|---|---|
| `cv` | **non** | CV PDF, 5 Mo | serveur, service-role | serveur |
| `avatars` | **non** | photo d'expert, 2 Mo | **client-direct** sous policy `auth.uid()` | serveur, URL signée 300 s |
| `org-logos` | **non** | logo d'organisation, 2 Mo | **serveur** ; policies scopées **`organization_id`**, jamais `auth.uid()` | serveur, URL signée 300 s |
| `ecosysteme` | **OUI, assumé** | logo + favicon d'écosystème | serveur (admin plateforme), aucune policy | **publique, dérivée** |

> **Pourquoi l'écriture du logo passe par le SERVEUR alors que `avatars` écrit en client-direct** :
> en client-direct, les octets ne passent jamais par nous, et la vérification du **contenu** du
> fichier serait impossible — Storage ne sait filtrer que sur le `Content-Type` **déclaré**, donc sur
> une affirmation du client. Le modèle retenu emprunte l'**écriture** à `cv` et la **lecture** à
> `avatars`.
>
> **Pourquoi `ecosysteme` est public** : ces images vivent sur des pages **publiques et cachées**
> (Navbar, Footer, pages légales, contact), vues par des visiteurs anonymes ; une URL signée y
> expirerait en 300 s et laisserait une image cassée. Ce qui ferme le mouchard n'est pas la
> confidentialité du bucket, c'est que **l'adresse est dérivée de `domain_id`** au lieu d'être saisie.
>
> **Aucun cycle RLS possible** (§E.6) : les policies `org-logos` appellent `is_active_admin_of_org` /
> `is_active_member_of_org`, déjà `SECURITY DEFINER` à `search_path` verrouillé — elles bypassent la
> RLS et cassent la boucle par construction, et aucune policy de `organization_members` ne lit
> `storage.objects`.


### P3.6 — Les neuf tâches planifiées (pg_cron, plus aucun cron d'hébergeur)
| Tâche | Horaire | Ce qu'elle fait |
|---|---|---|
| `purge_deletions_trigger` | 03:00 | Efface les comptes dont la grâce de 90 j est échue (RGPD art. 17). |
| `purge_inactive_trigger` | 03:30 | Avertit à 23 mois, purge à 24 (CNIL recrutement). |
| `cron_run_reconcile` | 03:15 et 03:45 | Recoupe le journal applicatif et `cron.job_run_details`. |
| `cron_run_log_purge` | 04:10 | Applique la rétention dissociée du journal. |
| `rate_limit_hits_purge` | 04:00 | Purge les compteurs de débit. |
| `matching_retry_trigger` | toutes les 5 min | Reprend les runs de matching inachevés. |
| `expert_relance_trigger` | toutes les 5 min | Exécute les relances arrivées à échéance. |
| `matching_notes_partielles_purge` | 04:30 | Purge les brouillons de notation soldés. |
| `stripe_reconcile_trigger` | 02:40 | Compare les événements produits par Stripe aux dernières 24 h avec ceux que le journal a reçus. **Elle signale, elle ne retraite rien.** L'horaire n'est pas esthétique : il est **contraint** par `cron_run_reconcile` (03:15) et le TTL d'environ 6 h de pg_net — posée après 03:45, sa réponse HTTP aurait expiré avant d'être recopiée, et l'écran l'afficherait éternellement « aucune réponse observée ». |

> Une tâche **invisible** a déjà tourné des mois sans que personne sache ce qu'elle faisait :
> planifiée en SQL inline, absente du journal applicatif et de la liste codée en dur. D'où
> `cron_job_catalog`.
>
> Il n'en nommait longtemps que **cinq sur huit** : les trois tâches du moteur, ajoutées après,
> paraissaient à l'écran **sans libellé ni description** — visibles, et muettes. C'était exactement
> le défaut que ce catalogue prétend fermer. **CLOS** : les neuf sont nommées et traduites en quatre
> langues (migration `duree_invitation`), les trois nouvelles classées `technical` — aucune n'est
> portée par une obligation légale, et les confondre ferait passer une purge RGPD et une reprise de
> run pour la même chose.
> Et `/admin/taches-planifiees` **ne reçoit jamais d'expression cron** : pg_cron valide la **forme**
> (cinq champs), pas la **satisfaisabilité** — `0 3 30 2 *` (30 février) est acceptée et ne se
> déclenchera **jamais**, sans erreur ni ligne d'exécution. La purge CNIL s'arrêterait en silence.
> L'écran reçoit donc des **composants typés et bornés**.
>
> **ET DEUX RUNS DU MÊME CRON NE SE CHEVAUCHENT PLUS** — mécanisme absent de ce document jusqu'au
> 16/09/2026. `expert_relance_trigger` tourne **toutes les 5 minutes** pour un run qui peut durer
> **300 secondes** : le chevauchement n'était pas hypothétique, il était **arithmétique**. Deux
> runs simultanés recevaient **le même profil** (`prochaine_relance_expert` est `stable`, sans
> `skip locked`) et **repayaient le même travail d'IA**.
> Le **bail** (`cron_run_leases`, RPC `prendre_bail_run` / `rendre_bail_run`,
> [lib/cron/bail-de-run.ts](../lib/cron/bail-de-run.ts)) est **générique** et non trois correctifs :
> il couvre aussi le bouton « exécuter maintenant » du back-office et tout appel porteur de
> `CRON_SECRET` — que le `pg_try_advisory_xact_lock` de `cron_manual_run` ne protégeait pas, ce
> verrou mourant avec la transaction alors que le run vit dans une requête HTTP qui commence
> après.

### P3.7 — Les règles EN DUR qui devraient être réglables
Nommées, comme demandé. Chacune exige aujourd'hui un **déploiement** :

1. ~~**Durée de vie d'une annonce (30 j)** et **fenêtre d'échange (15 j)**~~ — **CLOS.**
   `/admin/durees` les règle, borne **au serveur** (entier, 1–365), et **trace** chaque changement.
   Les deux valeurs sont **identiques pour toutes les offres** : la différenciation par offre reste
   possible, elle n'est pas faite, et rien ne la prépare en douce.

   **L'asymétrie est le vrai sujet, et l'écran l'écrit en toutes lettres :**
   · la vie d'une annonce est **RÉTROACTIVE** — `publications.expires_at` n'est jamais écrit,
     l'activité se recalcule à chaque lecture ; la baisser retire de la place, tout de suite, des
     annonces déjà en ligne ;
   · la fenêtre d'échange **ne l'est pas** — `conversations.expires_at` est écrit au déblocage, les
     échanges ouverts gardent leur date.

   Une baisse est **comptée avant d'être écrite** (`annonces_basculant_par_duree`, qui compte ce qui
   **bascule** et non le total : « 14 seraient expirées » n'alarme personne si 12 le sont déjà), et
   le nombre d'annonces concernées — **dont celles portant des candidatures dévoilées, donc payées** —
   est montré avant validation. **On demande confirmation, on ne bloque pas** : un refus définitif
   aurait obligé à modifier la base à la main, le défaut même qu'on ferme (§E.10).

   Côté code : **argument obligatoire, aucun défaut**, la lecture faite par les routes. Un appel qui
   oublie la durée **ne compile pas**. Piège découvert en chemin : §E.15.
2. **Grâce de suppression (90 j)**, **avertissement (23 mois)**, **purge (24 mois)** — contraintes
   légales, donc stables ; mais les rendre lisibles depuis un écran servirait le registre RGPD.
3. ~~Seuils de `verification_providers`~~ — **CLOS.** `/admin/seuils` les règle, borne **au serveur**
   (entier, 0–10), **refuse** d'écrire une clé que le chemin ne lit pas, refuse une liste de drapeaux
   vide, et **journalise** qui a changé quoi, depuis quelle valeur et depuis quelle adresse. La
   valeur réelle du seuil expert est **8**, dans le jsonb — ni 9, ni la colonne.
4. ~~**Plafonds de dépense IA** et **seuils d'alerte par acteur**~~ — **CLOS.** Les deux se règlent
   sur `/admin/matching`, **dans le bloc qui affiche déjà leur valeur** — et non dans une section
   « réglages » séparée : voir « 47 $ dépensés » et « plafond 200 $ » côte à côte est ce qui permet
   de décider. Bornes **au serveur** (0 à 100 000 $), refus d'un fournisseur ou d'un acteur hors
   catalogue, validation **du corps entier avant la moindre écriture** (un état à moitié appliqué
   s'afficherait sans qu'on sache lequel des champs a pris), et **trace** sous **deux actions
   distinctes** — `ai_spend_cap_updated` et `ai_spend_alert_threshold_updated`.

   **L'écran écrit lequel arrête et lequel prévient**, à côté de chaque champ : le plafond **BLOQUE**
   (le baisser sous la dépense engagée arrête le moteur à la seconde), le seuil **n'arrête rien** (il
   pose un drapeau recalculé à chaque affichage). Deux champs voisins qui se ressemblent sans agir
   pareil sont un piège — le même que celui des durées.
5. **Limites de l'OTP** (1/60 s, 3/h, 10/h par IP) — anti-abus, donc légitimement en code, selon le
   même raisonnement que le plafond de relance (§D.7).
6. **Taille de CV (5 Mo)**, **longueur de message (5000)**, **bornes du résumé (200–800)** — bornes de
   produit, en code. Les deux dernières sont **liées au moteur** (au-delà de 800, le texte n'est plus
   lu) : les rendre réglables sans rappeler ce lien serait un piège.

### P3.8 — LES COULEURS : L'ACCUEIL EST LA RÉFÉRENCE, ET ELLE SE RÈGLE PAR ÉCOSYSTÈME

**Ce qui a changé le 21/09/2026, et pourquoi.** Un audit a mesuré ce que le produit utilisait
vraiment : **184 teintes distinctes, 3180 couleurs écrites à la main dans 125 fichiers sur 479**, et
**aucune classe Tailwind**. L'accueil, lui, tenait en **quinze couleurs** déclarées dans un seul
fichier, avec une règle écrite qui disait laquelle avait le droit d'y entrer. Les deux moitiés du
produit ne partageaient **aucune couleur**, le blanc mis à part.

Décision : **c'est la palette de l'accueil qui gagne**, aux mêmes valeurs, pour tout le produit.

**Les huit rôles, nommés par ce qu'ils colorent.** Chacun se règle, par écosystème, dans
`/admin/ecosystemes` :

| Rôle | Ce qu'il colore | Valeur de référence |
|---|---|---|
| Fond de page | le fond de toutes les pages, derrière les cartes | `#FDFBF7` |
| Bandeau et barre latérale | l'en-tête et le menu de gauche des tableaux de bord | `#F6F2EA` |
| Cartes | la surface des cartes, **et le libellé posé sur un bouton plein** | `#FFFFFF` |
| Traits | le contour des cartes et la séparation des sections | `#E7E2D8` |
| Texte principal | tout le texte qui porte, **et le fond du pied de page** | `#1A1815` |
| Texte secondaire | sous-titres, textes de carte, **et tout message d'état vide** | `#6B655C` |
| Couleur de marque | **le logo, et rien d'autre** | `#0EA5E9` |
| Boutons et éléments actifs | boutons, liens, onglet et menu actifs | **calculée** → `#085A7F` |

**« Calculée » est le mot qui compte.** La couleur des boutons est dérivée de la marque en abaissant
sa luminance — teinte et saturation conservées — jusqu'à franchir **7 pour 1** contre le fond de page
de cet écosystème. Sur la marque de référence, `#0EA5E9` vaut **2,68** contre la crème : illisible.
La dérivation rend `#085A7F`, à **7,31**. Un administrateur peut la choisir lui-même ; par défaut,
elle se calcule, et c'est ce qui garantit qu'**aucun écosystème futur ne produit une page illisible**.

**Ce qui NE se règle pas, et ce n'est pas un oubli :**
· le **vert**, l'**ambre** et le **rouge**. Ils disent *vérifié*, *attention*, *en échec* — un ÉTAT,
  pas une marque. Les rendre réglables inviterait à peindre une erreur en vert ;
· le **texte tenu** et la **bordure douce**, mesurés sur l'accueil et non dérivables des autres.

> ⚠️ **LE ROUGE D'ERREUR EST LA SEULE COULEUR DU PRODUIT QUI N'A PAS ÉTÉ MESURÉE.** L'accueil n'a
> aucun état d'erreur. `#C32116` a été **construit** par la même méthode que le vert et l'ambre —
> même bande de contraste sur le fond de page, même saturation — puis **choisi par Youssef parmi
> trois candidats** le 21/09/2026. Il vaut 5,72 sur le fond de page et 5,92 sur une carte.

**LA GARDE : l'écran REFUSE d'enregistrer une combinaison illisible.** Sept paires sont vérifiées —
le texte principal et le texte secondaire sur chacune des trois surfaces, plus le libellé d'un bouton
sur son bouton. Sous **4,5 pour 1**, rien n'est écrit, et le refus **nomme** la paire fautive, son
ratio et le minimum. L'écran affiche le verdict de chaque paire pendant qu'on choisit ; **c'est le
serveur qui refuse**.

> **Les bordures ne sont PAS gardées, à dessein.** La bordure de référence vaut **1,25** contre le
> fond de page. Exiger 3 pour 1 ferait rougir la palette de l'accueil elle-même dès le premier jour,
> et un contrôle qui refuse la référence qu'il défend est désactivé le jour même.

> ⚠️ **UNE COULEUR NE PORTE PAS TOUJOURS UNE INFORMATION, ET LA DISTINCTION EST UNE DÉCISION.**
> Le **texte tenu** (`#8A8377`) vaut **3,63** — sous le minimum. Il est réservé aux **libellés de
> structure** : titres de groupes, survols, séparateurs ; des repères qu'on balaie. Un **état vide**
> dit quelque chose, et quelqu'un vient le lire : il prend le **texte secondaire**, à 5,58.
> Arbitrage de Youssef du 21/09/2026.

**Ajouter un écosystème ne demande AUCUN déploiement.** Sa ligne naît aux couleurs de la référence,
il est lisible dès la première seconde, et l'écran montre ses couleurs le premier jour. Détail du
chemin technique : [architecture §C.13](architecture.md).

---

## P4. Ce qui est volontairement inactif

**Lisez cette section avant de « réparer » quoi que ce soit ici.** Chacun de ces quatre points
ressemble à un oubli et n'en est pas. Les retirer coûterait le travail déjà fait ; les activer sans
arbitrage coûterait de l'argent ou de la crédibilité.

### P4.1 — Le mur payant, derrière ses deux verrous
**Pourquoi c'est là.** Le lancement est **gratuit** et la date d'ouverture des abonnements **n'est
pas fixée**. Le chemin de paiement est entièrement construit pour être relu et éprouvé **avant**
d'être ouvert, pas écrit dans l'urgence le jour de l'ouverture.

**Comment c'est fermé** ([lib/billing/config.ts](../lib/billing/config.ts)) :
① la **clé Stripe scopée par environnement** — absente ⇒ 503 ; et le contrôle va **dans les deux
sens** : une clé de **test en production** ferait croire aux clients qu'ils paient, une clé **live
hors production** débiterait de **vraies cartes** pendant les tests. Les deux sont refusées durement.
② l'**interrupteur `ENABLE_BILLING`**, qui doit valoir exactement `'true'`.
**Aucune variable `NEXT_PUBLIC_`** : le verrou serait lisible dans le bundle, et surtout l'UI pourrait
diverger du serveur. L'UI apprend l'état du mur par une **réponse serveur**.

**Ce qu'il faudra décider le jour de l'activation :**
- poser les **deux** variables, sur le **bon** environnement (deux gestes distincts et délibérés :
  c'est le but) ;
- créer l'endpoint webhook côté Stripe et récupérer **son** `STRIPE_WEBHOOK_SECRET` — il y en a un
  **par endpoint**, celui de test et celui de production sont **différents** ;
- synchroniser le catalogue **avant** d'ouvrir, pour qu'aucune offre ne soit sans `price` Stripe ;
- décider du sort des organisations déjà en **attribution manuelle** : le garde-fou refuse d'écraser
  un abonnement Stripe, l'inverse n'est pas gardé ;
- surveiller les `stripe_events` **bloqués en `received`** — un crash avant marquage bloque tous les
  réessais. C'est **délibéré** (mieux vaut un événement non appliqué et visible qu'un double crédit),
  mais **rien ne l'automatise** : `idx_stripe_events_status` est le seul moyen de les voir.
- La marche à suivre pour le premier paiement est écrite dans
  [docs/stripe-premier-paiement.md](stripe-premier-paiement.md).

### P4.2 — Le canal SMS de notification, coupé au dispatcher
**Pourquoi c'est là.** Il n'a **jamais** été coupé, et ça a coûté : en production, **chaque
candidature déposée envoyait un SMS Vonage payant à tous les membres de l'organisation au téléphone
vérifié** — le filtre était une préférence en **opt-out** dont l'absence valait « activé », et les
interrupteurs avaient été retirés des écrans : personne ne pouvait s'en désinscrire.

**Comment c'est fermé.** `CANAUX_OUVERTS = ['email']`, **un seul point**, fermé par défaut. Couper
événement par événement laisserait le **prochain** événement ajouté repartir tout seul, par recopie
de `channels: ['email','sms']`.
**Les OTP ne passent pas par là** : autre API Vonage (Verify v2), appelée directement par les routes
d'auth. Les deux chemins n'ont **aucun point commun** — fermer celui-ci ne peut pas casser
l'inscription.
Le code V2 est **conservé délibérément** : `runChannel`, le gabarit SMS, `lib/sms/vonage.ts` et les
branches `channel === 'sms'` sont **inatteignables à l'exécution**. Ce n'est pas du code mort oublié.

**Ce qu'il faudra décider :**
- basculer le défaut de préférence en **opt-in** — aujourd'hui l'**absence de ligne** dans
  `notification_preferences` vaut **activé** ;
- **rendre les interrupteurs aux écrans** avant de rouvrir, pas après ;
- accepter le coût : ajouter `'sms'` à cette constante **réactive une dépense sortante
  immédiatement**, sur tous les événements qui le déclarent, sans autre changement.

### P4.3 — Les notifications de mise en relation, éteintes sur chaque écosystème
**Pourquoi c'est là.** `notify_enabled` vaut **`false` par défaut**, et `feed_threshold` vaut **0**.
Ce n'est pas une panne : c'est un refus de deviner.
Le score d'un reranker **n'est pas calibré** — le fournisseur écrit noir sur blanc qu'on ne peut ni
lire 0,91 comme « deux fois 0,44 », ni comparer les scores de deux requêtes. **7/10 sur l'échelle de
Claude ne vaut donc pas 0,7 ici : il n'existe aucune traduction.**
Les valeurs de départ sont choisies pour ne **rien casser** : `feed_threshold = 0` n'écarte **aucun**
expert par un nombre choisi au hasard (ce que la règle figée interdit), et `notify_enabled = false`
ne notifie personne. *Un moteur qui notifie 12 000 personnes sur un seuil deviné est pire qu'un
moteur qui ne notifie pas encore.*

**Ce qu'il faudra décider :** lire la **distribution réelle** des scores (`matching_stats`,
`matching_threshold_health()`), régler les deux seuils **sur les faits**, puis basculer
`notify_enabled` — **par écosystème**, depuis `/admin/matching`. Le levier est « montrer plus,
notifier moins ».

> **La comptabilité IA change ce que « les faits » veulent dire ici.** Jusqu'à ce lot, la dépense
> n'était comptée que sur **deux** des sept points, et au tarif de Sonnet 4.6 pour **tous** les
> modèles. Régler les seuils « sur les faits » se faisait donc sur un coût faux dans les deux sens :
> **incomplet** (cinq points muets) et **surévalué** (mauvaise grille, §E.13). Les sept points
> comptent désormais, au tarif du modèle réellement appelé — le calibrage repose enfin sur une
> dépense **mesurée**.

### P4.4 — `packages.max_seats` : affiché, et sans effet
**Pourquoi c'est là.** La colonne existe en base et **n'est lue par aucune garde** : la poser à 5 ne
limite rien. Un réglage qui ne règle rien est exactement le défaut corrigé ailleurs.
On ne retire pas la colonne — **la facturation au siège est prévue à l'ouverture des abonnements**,
c'est une fondation, pas un vestige.

**Comment c'est neutralisé.** Le champ est **visible et inactif** dans `/admin/packages/[id]`, avec
un libellé qui le dit. **Caché, il aurait été renseigné depuis la base par quelqu'un qui aurait cru
poser une limite.** Et c'est **en lecture seule au SERVEUR aussi** : `update-package` ne le lit pas —
désactiver l'`input` ne garde rien à lui seul.

**Ce qu'il faudra décider :** ce que « siège » signifie (membre actif ? invité compris ?), ce qui se
passe au dépassement (refus d'invitation ? facturation au prorata ?), et **quelle garde** le lit —
côté invitation **et** côté acceptation, sinon la limite se contourne par le second chemin.

### P4.5 — Et ce qui n'est PAS volontairement inactif, pour lever le doute
- `reveal_contact` est un **point d'extension conçu mais non branché** — pas un interrupteur. Le
  packaging commerce qui l'ouvrirait **n'existe pas**, et §D.4 dit qu'il reste `false` **toujours**.
- `lib/database.types.ts` **n'est pas un choix** : c'est un filet périmé et débranché (§E.1, §H).
- `scripts/diag.mjs` **n'est pas désactivé** : il est **cassé et inachevé**, et retiré de
  `package.json` pour cesser de piéger.
