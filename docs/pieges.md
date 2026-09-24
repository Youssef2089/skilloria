# Les pièges vérifiés — §E

> **CE FICHIER EST LA SECTION §E DE LA MÉMOIRE DU PROJET.** Il vivait dans
> [CLAUDE.md](../CLAUDE.md), qui est chargé à chaque session — et il l'avait fait grossir à
> **190k caractères**, au-delà de la limite de **150k** que Claude Code charge : **la mémoire était
> tronquée sans que personne sache quelle section manquait**. C'est le piège exact que le découpage
> en trois fichiers avait fermé (1929 → 756 lignes), et il s'était reformé en dix jours, par les §E.
>
> **Ce que CLAUDE.md garde** : un **index d'une ligne par piège**, avec le renvoi ici. §D (décisions
> figées), §G (règles de travail), §M0/§M1 (les relectures et les fusions) y restent. Un contrôle
> rougit désormais quand CLAUDE.md dépasse son **budget de 100k** — on ne découvre plus ça par un
> avertissement de terminal ([diag-memoire-exacte](../scripts/diag-memoire-exacte.mjs)).
>
> **Les renvois d'un fichier à l'autre** : §D, §G, §M → [CLAUDE.md](../CLAUDE.md) · §A, §B, §C, §F,
> §H → [architecture.md](architecture.md) · §P → [produit.md](produit.md). Les `§E.n` cités dans
> le code et les scripts désignent les sections **de ce fichier**.
>
> **La règle de maintenance vaut ici comme dans les trois autres** : un piège coûteux s'écrit dans
> le **même commit** que son correctif, avec son cas mesuré, son contrôle, et ce que le contrôle ne
> vérifie pas. Une affirmation non vérifiable dans le dépôt ne s'écrit pas, ou se marque
> **NON VÉRIFIÉ**. L'ordre des sections n'est **pas** numérique — il est celui de leur écriture,
> et trois collisions de numéros ont été résolues par renumérotation (§M1 bis, ter, quater).

---


<a id="e1"></a>
### E.1 — Les clients Supabase ne sont pas typés. Une colonne supprimée casse au runtime, en silence.
`lib/database.types.ts` existe (3911 lignes) mais **aucun** `createClient<Database>` n'en fait usage
dans tout le dépôt : les clients sont instanciés nus. Le fichier est en outre **périmé** (il déclare
encore `organization_domains.package_id`, supprimée ; son propre en-tête signale qu'il a été généré
avant les migrations de vérification).
Conséquence : les colonnes vivent dans des **chaînes** — `.select('id, seniority, …')`,
`.eq('speciality_id', x)`. Ni `npx tsc` ni `next build` n'en voient rien.
Le filet est un **cliquet** : [scripts/diag-colonnes-supprimees.mjs](../scripts/diag-colonnes-supprimees.mjs),
qui fige la dette fichier par fichier et refuse toute **nouvelle** occurrence. La dette est aujourd'hui
**vide** — le cliquet est donc un simple refus.

<a id="e2"></a>
### E.2 — `tsc` et `next build` ne sont pas interchangeables.
`tsconfig.json` inclut `**/*.ts`, `**/*.tsx`, `**/*.mts`, plus `.next/types/**` et `.next/dev/types/**`.
- `npx tsc` type-vérifie **tout le dépôt**, y compris des fichiers que `next build` ne compile jamais
  (p. ex. `scripts/backfill-matching-experts.mts`).
- Les types de routes générés par Next (`.next/types/**`) **n'existent qu'après un build** : sur un
  clone frais, `tsc` n'a rien à y vérifier.
Lancer l'un ne dispense donc pas de l'autre. Et **aucun des deux** ne voit E.1.

> ⚠️ **ET CES FICHIERS GÉNÉRÉS PEUVENT FAIRE ROUGIR `tsc` SANS QU'UNE LIGNE DU DÉPÔT AIT BOUGÉ.**
> Constaté le 18/09/2026 : `npx tsc --noEmit` a rendu **137 erreurs**, *toutes* dans
> `.next/dev/types/validator.ts` et `.next/dev/types/routes.d.ts` — des fichiers **écrits à moitié**
> par un serveur de dev (une déclaration coupée en plein milieu, suivie d'un fragment d'une autre
> écriture). **Zéro erreur hors de `.next/`.** Le réflexe dangereux est de chercher la régression
> dans le lot en cours ; le bon réflexe est de **séparer les erreurs par dossier d'abord** :
> `npx tsc --noEmit 2>&1 | grep -v '^\.next/'`. Ces fichiers sont **gitignorés et régénérés** : les
> supprimer suffit, et `tsc` repasse à 0. Un rouge qui ne vient pas du dépôt est un rouge qu'on
> apprend à ignorer si on ne sait pas le nommer.

<a id="e3"></a>
### E.3 — Les fins de ligne CRLF cassent tout motif qui traverse un saut de ligne.
Le dépôt n'a **pas de `.gitattributes`** ; les fichiers sortent en CRLF. Un diagnostic dont la regex
franchit un `\n` était **vert chez son auteur et rouge partout ailleurs** — quinze diagnostics étaient
concernés (commit `23fbb82`). La parade, en tête de **51** des **67** scripts qui lisent un fichier
(compté le 16/09/2026 — ce document disait 32) :

```js
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
```

> ⚠️ **ET CE COMPTE NE PROUVE RIEN.** Les **16** scripts qui ne portent pas cette ligne exacte ne
> sont pas pour autant exposés : ils tolèrent CRLF autrement — `/\r?\n/` en séparateur, `[\s\S]`
> ou simplement `\s`, qui matche déjà `\r`. Mesuré : **aucun des 16 n'est réellement vulnérable**.
> C'est pour cela qu'aucun contrôle ne garde ce chiffre — il aurait dénoncé **treize** scripts
> sains dès le premier jour, et il aurait été désactivé le jour même (§E.7, §E.16).
> **NON VÉRIFIÉ** : personne n'a relu les 16 un par un ; seule la forme de leurs motifs a été
> examinée.

Corollaire de la même famille : **un diagnostic doit tourner depuis n'importe quel worktree, sans
préparation** — ni chargeur d'alias, ni variable d'environnement, ni réseau. Une version de
`diag-cloisonnement-ecosysteme.mjs` importait le code par l'alias `@/` et mourait en
`ERR_MODULE_NOT_FOUND` : ni verte ni rouge, elle **ne vérifiait plus rien**, et personne ne pouvait dire
depuis quand. Convention retenue : import **relatif avec extension explicite**.

<a id="e4"></a>
### E.4 — Des scripts de diagnostic ÉCRIVENT en base.
Sur la famille `diag-*.mjs`, l'inoffensif et le destructeur ont le même visage. Un worktree s'est fait
prendre. Parade : [scripts/garde-ecriture.mjs](../scripts/garde-ecriture.mjs) — sans `--db` (ou `--live`),
le script **refuse**, annonce table par table ce qu'il écrirait, et sort en **code 2**
(`0` vert · `1` rouge · **`2` n'a pas tourné**) : sortir en `1` se lirait comme un contrôle en échec et
pousserait quelqu'un à « réparer » en passant le drapeau.
Sous garde aujourd'hui : `diag-lot-expert-verification`, `diag-lot2b-expert`, `diag-lot2c-org`,
`diag-lot3-messagerie`, `diag-suspension`. Le balayage
[scripts/diag-scripts-destructeurs.mjs](../scripts/diag-scripts-destructeurs.mjs) **découvre** les
écrivains au lieu de tenir une liste.
⚠️ **Angle mort vérifié** : ce balayage ne couvre que `scripts/diag-*.mjs`. **Cinq** scripts écrivent en
base **hors** de son périmètre : trois **sans garde** — `scripts/cleanup-test-data.mjs` (suppression
irréversible), `scripts/verify-test-profile-once.mjs`, `scripts/backfill-matching-experts.mts` — et
deux **sous garde**, dits dans le commit qui les a livrés :
`scripts/creer-premier-administrateur.mjs` (le jour zéro) et `scripts/recette-3-3.mjs` (la recette,
§C.12 — elle crée six comptes, deux organisations, un écosystème de passage, et les supprime).

<a id="e5"></a>
### E.5 — Le couperet de Vercel tue tout travail d'après-réponse hors d'un `after()`.
Un `void promise` lancé après la réponse est tué : ni effet, ni erreur visible. Toute route qui poursuit
après avoir répondu utilise `import { after } from 'next/server'` **et** déclare un `maxDuration`
explicite. En place sur : `/api/candidatures`, `/api/conversations/[id]/messages`, `/api/profile`,
`/api/profile/cdi-upload-cv`, `/api/me/sync-matching`, `/api/admin/approve-expert`,
`/api/admin/reject-expert`, `/api/me/organisation/invitations(/[id])`, `/api/cron/purge-inactive`.
Le piège est nommé sur place : [app/api/candidatures/route.ts:454](../app/api/candidatures/route.ts#L454)
et [app/api/conversations/[id]/messages/route.ts:533](../app/api/conversations/[id]/messages/route.ts#L533).
`maxDuration = 60` est le plafond Hobby ; les crons longs montent à `300`.

<a id="e6"></a>
### E.6 — Les cycles RLS produisent une récursion `42P17`.
Deux policies qui se lisent l'une l'autre (`profiles.profiles_org_unlocked_read` → `candidatures`,
`candidatures.candidatures_expert_read` → `profiles`) font que **toute** requête
`SELECT … FROM public.profiles` d'un utilisateur authentifié répond
`42P17 infinite recursion detected in policy` — que PostgREST rend en **500 silencieux** côté client.
Parade, appliquée systématiquement : encapsuler le corps de la policy dans une fonction
**`SECURITY DEFINER` + `search_path` verrouillé**, qui bypasse RLS et **casse la boucle**, tout en
restant bornée à `auth.uid()`.
Traces : `supabase/_archive/20260603120000_fix_profiles_rls_recursion.sql` (le cas fondateur),
`rls_deletion_read_lock` (helper anti-récursion), `org_members_write_hardening`
(`is_active_admin_of_org`).
À savoir aussi : un event trigger `ensure_rls` **active RLS sur toute nouvelle table** du schéma
`public` — la sécurité est donc **dans le code de garde**, pas dans un REVOKE qui tiendrait.

<a id="e7"></a>
### E.7 — Un contrôle qui lit un COMMENTAIRE reste vert quand la règle disparaît.
Trois occurrences vérifiées :
- **`diag-billing-socle`** cherchait le simple nom `organization_domains` et se déclenchait sur le
  **commentaire de colonne qui énonce la règle qu'il défend** — « un contrôle qui punit la
  documentation de sa propre règle finit par être désactivé ». Corrigé : le motif exige une
  manipulation DDL/DML, pas une mention.
- **`diag-abonnement-organisation`** matchait le commentaire de migration qui cite, mot pour mot, la
  décision remplacée. Corrigé : SQL **exécutable uniquement**, commentaires retirés.
- **`diag-controle-acces-ecosysteme`** : les fragments de garde (`!target.active`, …) s'écrivent aussi
  dans un commentaire, et « un commentaire n'a jamais refusé personne ».

Parade généralisée : un helper `sansCommentaires()` / `strip()` / `stripSql()` en tête de la plupart des
diagnostics — *« un anti-pattern doit pouvoir être DOCUMENTÉ »*. Symétriquement,
`diag-expert-name-masking` vérifie qu'un **commentaire ne ment pas** sur une règle de sécurité.
Cas réel de commentaire menteur encore en place : l'en-tête de
[app/api/admin/assign-org-package/route.ts:14-20](../app/api/admin/assign-org-package/route.ts#L14) décrit
toujours `organization_domains` comme cible et annonce deux refus (`no_active_domain` 404,
`multiple_active_domains` 409) que **le corps du même fichier** (lignes 124-125) déclare disparus — le
code écrit sur `organizations`.

<a id="e8"></a>
### E.8 — Un contrôle qui teste une présence ET une absence séparément passe sur une écriture qui satisfait les deux.
`applyPackageState` contient **aussi** une lecture de diagnostic sur `organizations` : un contrôle à la
maille de la **fonction** (« `organizations` est cité » ET « `package_id` est cité ») restait vert alors
que l'**écriture**, elle, était partie sur la table de trace. Corrigé en exigeant
`.from('organizations')` **immédiatement suivi** de `.update(` —
[scripts/diag-billing-socle.mjs:235](../scripts/diag-billing-socle.mjs#L235).
Même famille : une assertion non ancrée dans `diag-zones-de-travail` attrapait le bloc **voisin** qui
portait le même motif et passait en vert alors que la condition avait été retirée
([scripts/diag-zones-de-travail.mjs:374](../scripts/diag-zones-de-travail.mjs#L374)) — **trouvée par
mutation**. Règle : **ancrer** l'assertion sur le bloc qu'elle vise, jamais lâcher une regex sur tout le
fichier.

<a id="e13"></a>
### E.13 — Un tarif écrit à côté d'un modèle diverge du modèle, et personne ne le voit.
Le code appliquait `3 $ / 15 $` par million de jetons à **tous** les appels Claude. Ce sont les prix
de **Sonnet 4.6**. Or :
· `claude-sonnet-5` (jugement de candidature, pitch) coûte **2 $ / 10 $** → la dépense était
**surévaluée de 50 %**, sur le seul point que le plafond comptait ;
· `claude-haiku-4-5-*` (analyse de CV, vérifications) coûte **1 $ / 5 $** → le brancher sur cette
grille l'aurait surévalué d'un **facteur 3**.
Chaque module portait **sa propre** constante, et chacune se croyait « le seul endroit à corriger ».
Un tarif unique pour plusieurs modèles n'est pas une approximation : **c'est un chiffre faux, qu'on
croit vrai parce qu'il est affiché.**
**La parade** : `ai_model_tarifs`, en base — un tarif change quand le **fournisseur** change ses prix,
jamais quand on déploie (même raisonnement que `ai_spend_caps` et `ai_quotas`). `enregistrerDepenseIA`
lit celui du modèle **réellement appelé** — y compris quand un **repli** a répondu à la place du
principal, ce que l'ancien code ne distinguait pas. Les **unités brutes** restent journalisées : le
coût reste recalculable quand la grille change. Tarif absent ⇒ coût **0**, drapeau `tarif_manquant`,
journal bruyant — **jamais un refus** : l'appel a déjà eu lieu, et casser le dépôt d'un CV pour une
ligne de configuration manquante serait pire que le défaut corrigé.
Gardé par [scripts/diag-depense-ia.mjs](../scripts/diag-depense-ia.mjs), qui vérifie aussi que **tout
modèle cité dans le code a un tarif seedé**.

<a id="e10"></a>
### E.10 — UNE VALEUR POSÉE À LA MAIN EN BASE NE SURVIT PAS À UNE RECONSTRUCTION, ET PERSONNE NE LE SAIT.
C'est le piège le plus coûteux établi à ce jour, parce qu'il ne laisse **aucune trace exploitable**.

Le seuil d'auto-approbation des experts vaut **8**. Le seed l'avait posé à **9**. **Le chiffre 8
n'existait nulle part dans le dépôt** : ni migration, ni constante, ni commentaire. Il a été posé à
la main dans l'éditeur SQL le **16 juin 2026** — le commit du jour (`0371a40`, *« seuil sain —
corrige l'auto-approbation de profils incohérents »*) touche **deux fichiers TypeScript et zéro
migration**, et seule la colonne `updated_at` de la ligne en portait la marque.
**Il a fallu croiser un message de commit et un horodatage de base pour le reconstituer.**
Idem pour `config.blocking_flags`, absent du seed et présent en base.

**Ce que ça produit.** Toutes les écritures sur `verification_providers` vivent dans
`supabase/_archive/`, dont l'en-tête dit *« À EXÉCUTER MANUELLEMENT — NE PAS APPLIQUER VIA
`db push` »*. Conséquence en deux temps :
· **rassurant** — `db push` ne peut pas écraser un réglage ajusté : la table n'est touchée par
  aucune migration rejouée ;
· **et c'est le piège** — sur une base reconstruite (`db reset`, nouvelle production), la table est
  **VIDE**. Aucune erreur, aucun signal. La recette se terminait sur un succès **vert** en
  produisant une base structurellement parfaite et **fonctionnellement morte**.

**La parade, posée dans la migration `parametrage_de_production`** : le paramétrage de référence est
**extrait de la base réelle et versionné** — écosystèmes, configurations, branches, spécialités,
pays, fournisseurs de vérification (seuil **8** compris) et 167 traductions. `ON CONFLICT DO NOTHING`
partout : il reconstruit, il n'écrase jamais.
**La règle qui en découle : un réglage qui n'est pas dans le dépôt n'existe pas.** Une valeur posée
à la main est perdue d'avance — ce n'est pas une question de discipline, c'est une question de
mécanisme.

<a id="e11"></a>
### E.11 — Trois replis différents pour une même absence de configuration, dont un qui invente.
Les trois chemins de vérification lisent leur seuil en base. Ils se comportaient différemment quand
la ligne manque :

| Chemin | Configuration absente ⇒ | Verdict |
|---|---|---|
| `verification/index` (organisation) | `pending_admin_review`, motif nommé, **aucun appel IA** | ✔ |
| `expert-verification` | ~~`request_timeout_ms: 45000`, `web_search_max_uses: 4`, `domain_mismatch_cap: 5`~~ | ✘ **inventait trois valeurs** |
| `publication-verification` | ~~`{ threshold: 0, active: false }`~~ | ✘ **inventait un seuil** |

⚠️ **CE TABLEAU A LONGTEMPS DIT L'INVERSE.** Il donnait les deux chemins expert et publication pour
alignés, et le chemin organisation pour le seul fautif. C'était vrai **une fois le chemin
organisation corrigé**, et faux pour les deux autres, que personne n'avait relus depuis. Le chemin
organisation tranchait sur un `FALLBACK_DECISION_THRESHOLD = 7` **que personne n'avait choisi et
qu'aucun écran ne montrait** — et son propre en-tête annonçait « fallback threshold = **9** »
pendant que la constante valait **7**. Il fallait lire les deux pour le voir.

**La forme est le piège.** `{ threshold: 0, active: false }` a l'air prudent : `active: false`
semble tout désamorcer. Mais le zéro est un **seuil valide** ; il suffit qu'un appelant lise
`threshold` sans regarder `active` pour que **tout passe**. Un réglage inventé est pire qu'un
réglage absent : **il a l'air d'avoir été décidé.**

**Les trois sont alignés** : plus aucun repli, refus explicite avec motif nommé, **avant** toute
dépense — on ne paie pas une décision qu'on ne saura pas trancher. Et `expert-verification` a perdu
son `limit(1)` : **zéro ligne** rend `null`, **plusieurs** rend un refus nommé (configuration
ambiguë) au lieu d'en élire une silencieusement.
La même famille frappait **l'origine du site** : huit endroits construisaient leurs liens d'e-mail
sur `NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'`. En production, une variable oubliée envoyait
à de **vrais destinataires** des liens vers `localhost` — approbation d'expert, refus d'organisation,
invitation, **toutes** les notifications, et l'avertissement d'inactivité à 23 mois qui est une
**obligation légale**. L'envoi réussissait, le lien était mort, rien n'alertait.
Source unique désormais : [lib/site-url.ts](../lib/site-url.ts) — repli explicite **hors** production,
`null` **en** production, et chaque appelant **n'envoie pas** plutôt que d'expédier un lien mort.
Gardé par [scripts/diag-configuration-absente.mjs](../scripts/diag-configuration-absente.mjs), qui
balaie **`app/`, `lib/` ET `components/`** — **457** fichiers `.ts`/`.tsx` au 18/09/2026 — et
vérifie que chacun des 8 appelants garde.

> ✅ **LE « NON VÉRIFIÉ » EST LEVÉ — ET CE QU'IL CACHAIT VAUT PLUS QUE LA RÉPONSE.**
> Ce paragraphe disait « il ne balaie **pas** `components/` » et laissait un **NON VÉRIFIÉ** sur
> l'existence d'un repli `localhost` dans ce dossier. **Les deux moitiés étaient fausses, et la
> seconde l'était à cause de la première.**
>
> **Mesuré le 18/09/2026, deux fois :** `RACINES = ['app', 'lib', 'components']`
> ([scripts/diag-configuration-absente.mjs:299](../scripts/diag-configuration-absente.mjs#L299)) — et
> `git log -L` sur cette ligne montre qu'elle est **dans le fichier depuis sa création** (`a5ccfb9`).
> Le dossier n'a **jamais** été hors du balayage. Et le comptage indépendant confirme le chiffre du
> script : `app` + `lib` + `components` = **457** fichiers ; `app` + `lib` seuls = **361**.
> Occurrences de `localhost` dans `components/` : **zéro**, pas même en commentaire.
>
> **Le chiffre était juste, l'étiquette était fausse.** 438 puis 445 étaient les comptes des
> **trois** racines aux dates dites (vérifié : `a5ccfb9` → 438, `1337324` → 445), pendant que la
> prose les présentait comme le compte de **deux**. Le `NON VÉRIFIÉ` a donc été écrit **contre un
> chiffre qui le contredisait déjà**, dans la même phrase.
>
> **La famille, et elle est neuve.** §E.16 recense le chiffre qui vieillit ; celle-ci est un chiffre
> **juste** sous une étiquette **fausse** — plus dangereux, parce que le chiffre rend la phrase
> crédible et qu'un relecteur vérifie le nombre, pas le nom de ce qu'on a compté. Un avertissement
> bâti là-dessus fait chercher un défaut **là où il ne peut pas être**, et détourne du vrai
> (§E.22 ⑨ en `components/` — cf. le sondage du lot 2).

<a id="e12"></a>
### E.12 — Une migration de DONNÉES n'est validée par rien, et son seul usage est une base que personne n'a sous la main.
Même famille que **E.1** (« les clients Supabase ne sont pas typés »), et pour la même raison de fond :
**aucun outil de compilation ne peut l'attraper.**

Le cas réel : la migration `parametrage_de_production` a été livrée **sans avoir jamais été jouée**.
Elle a échoué au **deuxième statement** :

```
ERROR: column "tags" is of type text[] but expression is of type jsonb (SQLSTATE 42804)
```

Les valeurs avaient été extraites de la base **via PostgREST — qui rend du JSON** — puis sérialisées
en `::jsonb` sans jamais confronter chaque valeur au **type réel** de sa colonne.
`domain_configs.tags` est un `text[]`.

**Pourquoi rien ne l'a vu :**
· `npx tsc` ne voit rien — c'est du SQL dans un `.sql` ;
· `next build` non plus, pour la même raison ;
· `diag-sql-litteraux` valide la **lexique** des chaînes, pas la **grammaire** ni les types ;
· et surtout : **ce fichier n'a qu'un seul usage, une base NEUVE.** Personne ne l'exerce au
quotidien. Le premier à le découvrir aurait été celui qui met en production.

**Un deuxième effet, aussi grave :** une erreur au statement 2 **masque tout ce qui suit**. Rien ne
dit si le reste est bon — et on est tenté de corriger la ligne fautive puis de repousser, au cas par
cas, jusqu'à ce que ça passe. **C'est la mauvaise méthode** : il faut établir la liste **complète**
des écarts avant de toucher au fichier.

**La parade : [scripts/diag-migration-donnees.mjs](../scripts/diag-migration-donnees.mjs).**
Il **reconstruit le schéma depuis les migrations** (CREATE / ALTER / DROP / RENAME, dans l'ordre) et
confronte chaque valeur écrite au type de sa colonne. La bonne référence est bien les migrations, pas
la base actuelle : sur une base neuve, le schéma vient de là. Il tourne **sans base, sans réseau,
sans identifiants**, donc depuis n'importe quel worktree.
Il couvre : familles de types (tableau / jsonb / booléen / entier / décimal / uuid / temps / texte),
**colonnes inexistantes**, **`NOT NULL` sans défaut omises**, **arité**, **ordre des clés
étrangères**, et l'ordre de `translations` — qui n'a **aucune** clé étrangère (`row_id` est un uuid
libre), donc une dépendance que PostgreSQL ne voit pas et qu'il faut lire **dans les données**.
Sur les **86** migrations : **52 insertions vues, 40 analysées, 1968 valeurs confrontées** (mesuré le
24/09/2026, à l'exécution — les 71ᵉ à 86ᵉ laissent les trois autres compteurs **inchangés**, et
c'est le point. `palette_par_ecosysteme` ajoute six colonnes avec un `DEFAULT`, qui remplit les
lignes existantes ; `inacheves_hors_annonces_expirees` ne fait que remplacer le corps d'une fonction
de lecture ; `empreinte_des_notes` **vide** une table éphémère et lui ajoute une colonne ;
`catalogue_stripe_par_mode` crée une table **vide** et supprime trois colonnes dont elle a d'abord
**vérifié** qu'elles étaient nulles. La cinquième, `commentaire_offre_gratuite`, ne touche que des **commentaires de colonne**.
La sixième, `offre_gratuite_explicite`, ajoute une colonne et durcit deux contraintes : son `update` REMPLIT une colonne neuve, il n'insère aucune ligne.
La septième, `index_packages_stripe`, ne crée que des index.
La huitième, `index_depense_par_mois`, ne fait qu'échanger deux index.
La neuvième, `tarif_par_recherche`, ajoute deux colonnes et **corrige** deux lignes : ses `update`
remplissent des colonnes neuves et en vident une, ils n'insèrent aucune ligne.
La dixième, `plafond_par_acteur`, ajoute une colonne, deux contraintes et trois fonctions de
lecture : son `update` remplit la colonne neuve, il n'insère aucune ligne.
La onzième, `depense_par_acteur_et_action`, n'ajoute qu'une fonction de LECTURE.
**Aucune des onze n'insère quoi que ce soit**, donc elles
échappent par construction à la classe que cette section décrit. Au 20/09/2026, la 70ᵉ, `verification_nocturne_stripe`, apportait l'insertion et la ligne
de plus : son entrée au catalogue des tâches planifiées, six valeurs. Les chiffres précédents,
**69 / 51 / 39 / 1962**, dataient du 17/09/2026, après la fusion de `feat/s1-ux-profil` — les trois
dernières d'alors,
`logo_organisation_bucket`, `format_numero_identification` et `pays_du_profil_sans_defaut`,
**n'insèrent rien** : elles créent un bucket, ajoutent des colonnes, retirent deux `DEFAULT 'FR'` et
mettent à jour la seule ligne `FR`, d'où trois compteurs inchangés — et `echelle_des_notes`
(19/09/2026) n'insère rien non plus : elle CONVERTIT et remplace une fonction, ce que ce contrôle
**ne sait pas lire**, d'où le contrôle dédié [diag-echelle-des-notes.mjs](../scripts/diag-echelle-des-notes.mjs).
Ce document disait 51 / 35 / 1913 ;
les chiffres avaient vieilli sans que rien ne le signale, et c'est précisément pour ça qu'ils sont
désormais **relus par un contrôle**, §E.16).

> ⚠️ **ET IL DIT CE QU'IL NE SAIT PAS LIRE.** Les 12 `insert … select … from (values …) cross join`
> sont déclarées **non analysables**, nommément, plutôt que jugées. Un contrôle qui invente un verdict
> sur ce qu'il ne comprend pas fait croire à une couverture qui n'existe pas — et c'est exactement
> comme ça qu'une migration non éprouvée a été livrée.
> **Seul un rejeu réel les couvre** : `supabase db reset` sur une base locale, ou `begin; … rollback;`
> sur un distant. Les deux exigent une base ; celui-ci n'exige rien, et c'est pour ça qu'il tournera.

**Deux faux positifs, corrigés en l'exécutant** — et ils valent d'être nommés, parce qu'un contrôle
qui crie à tort est désactivé le jour même : la liste de valeurs s'arrêtait au `;`, si bien que
`on conflict (name) do nothing` était lu comme **un tuple de plus** (six migrations saines
dénoncées) ; et la règle « `translations` doit être la **dernière** insertion » dénonçait
`public_email_domains`, que **aucune** traduction ne référence.

<a id="e14"></a>
### E.14 — Rien ne dit QUELS diagnostics un lot doit rejouer, alors on les choisit de mémoire.
Il y a **~70** scripts `diag-*.mjs` et **aucun test runner**. Le dépôt ne dit nulle part lesquels
lisent les fichiers qu'on vient de modifier : on en lance donc quatre ou cinq, ceux qu'on a en tête.

**Le cas réel, et il est récent.** Le lot « les sept points de dépense » a été livré (`246c592`) avec
[scripts/diag-moteur-reranking.mjs](../scripts/diag-moteur-reranking.mjs) **au rouge**. Il ancrait
`enregistrerDepense(` ; le lot avait renommé l'appel en `enregistrerDepenseIA(`. **Aucun défaut
réel** — mais un contrôle rouge livré, c'est-à-dire un contrôle qu'on apprend à ignorer, et c'est
ainsi qu'ils meurent tous. Il n'a été vu qu'au lot **suivant**, par hasard.

**La parade : [scripts/diag-controles-a-rejouer.mjs](../scripts/diag-controles-a-rejouer.mjs).**
Il lit les fichiers du lot (`git diff --name-only <base>` + non suivis), cherche lesquels des ~70
diagnostics les **citent**, et — c'est le point qui compte — considère aussi comme concernés les
contrôles **de classe**, ceux qui ne citent personne parce qu'ils *balaient* un dossier
(`readdirSync` sur `app/`, `lib/`, `supabase/migrations/`, `messages/`, `scripts/`). Sans cette
règle, les contrôles qui attrapent justement le cas non prévu ne seraient jamais proposés.
Puis **il les rejoue** : un diagnostic qu'on se contente de *nommer* n'est pas joué. Il sort en `1`
si l'un d'eux est rouge.

Sur le lot « dépense par acteur » : **36 diagnostics concernés**. J'en aurais lancé quatre.

> Deux limites, dites plutôt que tues : il ne remplace pas le jugement (un lot peut mériter un
> contrôle qui ne cite aucun de ses fichiers), et il ne connaît que les liens **textuels** — un
> diagnostic qui atteindrait un fichier par une chaîne construite lui échapperait.

<a id="e15"></a>
### E.15 — Un composant CLIENT qui applique une règle serveur la fige dans le bundle.
Rendre une règle réglable ne suffit pas : il faut savoir QUI l'applique. Le balayage des
consommateurs, fait sur `app/` et `lib/`, en avait trouvé **treize**, tous serveur — et concluait
que « la lecture faite par les routes » tenait partout. **Il manquait `components/`.**

C'est le compilateur qui l'a dit : [components/dashboard/PublicationForm.tsx](../components/dashboard/PublicationForm.tsx)
importait `PUBLICATION_TTL_DAYS` pour annoncer, dans la fenêtre de confirmation,
« votre annonce sera visible jusqu'au … ». Un composant `'use client'`, rendu par deux pages
`'use client'` : **aucun composant serveur dans la chaîne** pour lui passer la valeur. La constante
aurait donc annoncé **30 jours pendant que le serveur en appliquait 20** — un chiffre faux dit à
l'utilisateur à la seconde exacte où il s'engage.

**Ce qui a été fait, et ce qui a été refusé.** Refusé : garder la constante « juste pour le
libellé ». Fait : [app/api/durees/route.ts](../app/api/durees/route.ts) rend la valeur, le composant la
lit, et **s'il ne l'a pas il n'écrit pas la phrase** — mieux vaut ne rien promettre que promettre
une date que le serveur ne tiendra pas. La règle du lot tient donc : la lecture reste faite par une
route, le client ne fait qu'afficher.

**La parade** : `diag-durees-reglables` balaie `app/`, `lib/` **et `components/`**, et rougit sur
tout fichier `'use client'` qui importe une règle de durée — un client ne lit pas la base, la valeur
qu'il applique vient forcément d'ailleurs.

<a id="e16"></a>
### E.16 — Une mémoire fausse ne se voit pas : rien ne dit depuis quand une ligne n'a pas été vérifiée.
Ce fichier a été écrit depuis ce qu'on croyait savoir. Relu ligne à ligne contre le code le
16/09/2026, il portait **dix-huit** affirmations fausses ou périmées (§M1). Aucune n'était un
mensonge : chacune était vraie à sa date. C'est ce qui les rend coûteuses — **elles se citent**.

**Les quatre familles, et ce qu'elles révèlent :**
· **un défaut ou une colonne qui ne gouverne rien** — le seuil « 9 » de la vérification d'entreprise
  appartenait à `sirene_insee`, dont le `confidence_threshold` n'est lu nulle part. C'est la
  **troisième occurrence** de cette famille, après la colonne inerte du chemin expert et le
  `packages.max_seats` affiché sans effet (§P4.4) — et la mémoire ne la signalait pas.
  **Traitée** : `/admin/seuils` déclare désormais `official_api` avec `cle_decisive: null`, et
  l'écran affiche « aucune valeur décisive » **au lieu d'un champ éditable** qui aurait présenté le
  9 inerte comme réglable — et dont l'enregistrement aurait été refusé par la garde de colonne
  inerte. §D.7 : **un réglage règle quelque chose, ou il le dit** ;
· **une règle énoncée plus largement qu'elle ne l'est** — « la seule route sans `requireAuth` » :
  elles sont **18 sur 128** ;
· **un inventaire incomplet, qui se lit comme exhaustif** — 18 tables sur 64 manquaient, dont
  `branches` et `specialities` ; §F oubliait **six** garanties de sa propre classe ;
· **un chiffre juste à sa date** — 32 scripts, 438 fichiers, 51 migrations.

**La parade : [scripts/diag-memoire-exacte.mjs](../scripts/diag-memoire-exacte.mjs).**
Il vérifie ce qu'une machine peut vérifier, et **dit ce qu'il ne vérifie pas** :
· chaque **lien** interne mène quelque part ;
· les **écrans**, dans les **deux sens** — un écran documenté qui n'existe pas
  (`/admin/ecosystemes/[id]`) comme un écran livré que rien ne documente (`/admin/durees`) ;
· les **tables**, dans les deux sens — le schéma est reconstruit **depuis les migrations**, sans
  base, pour la raison de §E.12 ;
· le nombre de **migrations**.
Il tourne **sans base, sans réseau, sans identifiants**.

> **Ce qu'il refuse de contrôler est aussi instructif que ce qu'il contrôle.** Le compte de scripts
> portant la parade CRLF ressemble à un invariant ; ce n'en est pas un, et un contrôle posé dessus
> aurait dénoncé **treize scripts sains** dès le premier jour. Il a été mesuré, puis **jeté** — un
> contrôle qui crie à tort est désactivé le jour même.

> **Et le piège §E.7 s'est refermé DEUX FOIS sur le relecteur pendant l'audit** : un `grep` a trouvé
> `disclosurePolicyForCandidatureLifecycle` dans un **commentaire**, faisant croire à un sixième
> consommateur ; et `requireAuth` dans le commentaire de `stripe/webhook` qui énonce précisément la
> règle contestée. **La vigilance ne se promet pas, elle s'outille.**

> **Collision de numéros, résolue par RENUMÉROTATION.** Le tronc et `feat/s2` ont écrit un §E.16
> chacun, le même jour, sans se voir. Celui du tronc garde son numéro — il est déjà cité cinq fois
> dans ce fichier ; les deux de S2 deviennent **§E.17** et **§E.18**. Aucune ligne n'a été arbitrée :
> les trois pièges sont là, en entier.

<a id="e17"></a>
### E.17 — Une URL saisie par un utilisateur et servie telle quelle à `<img src>` est un mouchard offert.

`organizations.logo_url` était une **saisie d'URL libre**. La seule validation de
`PATCH /api/me/organisation` était : c'est une chaîne, `.trim()`, ≤ 500 caractères. Ni schéma, ni
liste d'hôtes, ni vérification que la ressource est une image. Et cette valeur partait **telle
quelle** dans un `<img src>` sur **neuf** surfaces — barre latérale d'organisation, cartes de casting
côté expert, messagerie, **et les deux écrans d'administration plateforme**.

Conséquence, qui n'est pas une hypothèse : un administrateur d'organisation posait, **par une saisie
de formulaire**, une adresse que le navigateur de chaque personne voyant sa fiche allait réellement
interroger — adresse IP, agent utilisateur, horodatage, et un `Referer` qui révèle l'écran admin.
Un pixel espion posé par un utilisateur dans notre produit, et un transfert de données personnelles
vers un tiers qu'on ne maîtrise pas.

**CE QUI REND LE DÉFAUT EXPLOITABLE, ET QUI EST TOUJOURS VRAI : il n'y a AUCUNE CSP dans le dépôt.**
Zéro occurrence de `Content-Security-Policy` et de `img-src` ; [next.config.ts](../next.config.ts) ne
déclare aucun `headers()`. Rien ne borne donc l'hôte que le navigateur ira interroger. Poser une CSP
est un autre lot ; `diag-logo-organisation` **constate** cette absence à chaque exécution pour que sa
disparition ne soit jamais une surprise.

> **LA DISTINCTION QUI PIÈGE, ET ELLE A DÉJÀ TROMPÉ UNE FOIS.**
> `profiles.photo_url` **ressemble** au même problème et n'en est pas un. C'est un **DRAPEAU INERTE** :
> [lib/avatar.ts](../lib/avatar.ts) **redérive** le chemin depuis l'identifiant du compte
> (`avatarStoragePath(userId)`) et ne lit **jamais** la colonne comme une adresse — une valeur
> falsifiée n'y donne accès à rien. `logo_url`, elle, **ÉTAIT l'adresse**.
> **Une colonne qui porte un drapeau et une colonne qui porte une adresse ne se ressemblent que de
> loin. La question à poser n'est pas « d'où vient la valeur ? » mais « le navigateur va-t-il
> réellement l'interroger ? ».**

**La parade, en deux verrous volontairement redondants** (migration `20260916300000`) :
- le **CHECK en base** (`organizations_logo_url_chemin_check` et ses deux jumeaux sur
  `domain_configs`) refuse d'**ÉCRIRE** toute valeur qui n'est pas le chemin dérivé
  `<uuid>/logo` — motif **positif**, jamais une liste noire d'interdits, qui s'oublie ;
- la **redérivation côté serveur** ([lib/org-logo.ts](../lib/org-logo.ts)) empêche d'en **SUIVRE** une :
  le chemin est toujours recalculé depuis l'identifiant, la colonne n'est qu'un drapeau.

**Deux leçons de méthode, payées pendant ce lot :**
1. **Le contrôle a d'abord rougi sur un NOM, pas sur un danger.** Il refusait tout
   `<img src={X.photo_url}>` ; or `/admin/experts` reçoit un DTO dont le *champ* s'appelle
   `photo_url` et dont la *valeur* est déjà signée. Ce qui compte est la **PROVENANCE**, pas le nom —
   d'où deux règles posées là où la provenance est connue : côté route (aucune projection brute) et
   côté écran en lecture client-directe (aucune adresse fabriquée). **Trouvé par exécution, pas par
   relecture.**
2. **Le contrôle a trouvé deux défauts que l'audit avait manqués** :
   `/api/profile/upload-cv` et `/api/profile/cdi-upload-cv` servaient `photo_url` **brute** dans le
   DTO rendu au client. Même classe, même correctif.

**Corollaire — `src` absent et `src` qui ÉCHOUE sont deux choses.** Partout, le motif était
`{url ? <img/> : <repli/>}` : le repli ne couvrait que l'**absence**, jamais l'**échec de
chargement**, et une adresse morte donnait l'icône d'image cassée du navigateur — un écran mort,
interdit par la checklist, et présent **avant** ce lot. `diag-logo-organisation` en a trouvé **dix**.
C'est devenu structurel : une URL **signée vit 300 s**, donc un onglet resté ouvert au-delà rouvre
une image expirée — un échec **parfaitement normal**. D'où
[components/ui/ImageOuRepli.tsx](../components/ui/ImageOuRepli.tsx).

**Sous-corollaire React** : la remise à zéro de l'état d'échec quand `src` change s'écrit **pendant
le rendu** (`if (src !== srcPrecedent) { … }`), **jamais** dans un `useEffect` — la règle
`react-hooks/set-state-in-effect` refuse la seconde forme, et un effet s'exécutant après la peinture
ferait scintiller le repli.

<a id="e18"></a>
### E.18 — Une SECONDE clé étrangère entre deux tables casse TOUS les embeds PostgREST entre elles.

**Trouvé en rejouant les migrations sur une base vierge, puis CONFIRMÉ EN LIGNE SUR STAGING.**

La migration `20260914200010_siege_administrateur` a ajouté `organizations_siege_admin_fkey` — une
clé étrangère **composite** de `organizations` vers `organization_members`, dans le sens inverse de
`organization_members_organization_id_fkey` qui existait déjà. À partir de là, **tout** embed
PostgREST entre ces deux tables répond :

```
Could not embed because more than one relationship was found
for 'organization_members' and 'organizations'
```

**L'effet, et il était total.** `loadOrganizationContext` ([lib/auth-guard.ts](../lib/auth-guard.ts))
retourne `null` **sur erreur**. Donc tout membre d'une organisation devenait *sans organisation*, et
chaque route gardée répondait **403 `no_organization`**. Le dashboard entreprise entier était mort —
sur staging **comme sur toute base neuve**. Neuf requêtes étaient concernées, plus **trois** autres
sur la paire `organization_members ↔ users` (`invited_by` + `user_id`), que le grep initial avait
manquées et que le contrôle a trouvées.

**Pourquoi personne ne l'a vu** — c'est la famille §E.1, dans sa forme la plus coûteuse :
- `npx tsc` ne voit rien : l'embed est une **chaîne** ;
- `next build` non plus, pour la même raison ;
- la migration s'applique **sans la moindre erreur** — le schéma est parfaitement valide, c'est la
  **lecture** qui devient ambiguë ;
- et la panne ne se manifeste qu'**une fois connecté comme membre d'une organisation**, ce qu'aucun
  contrôle statique ne fait.

**La parade** : nommer le lien à suivre — `organizations!organization_members_organization_id_fkey(…)`.
Le nom de contrainte **n'est pas décoratif** ; le retirer pour « simplifier » rouvre la panne. Le
dépôt utilisait déjà cette forme ailleurs (`users!profiles_user_id_fkey`), sans que la raison en soit
écrite nulle part.

**Le contrôle** : [scripts/diag-embeds-ambigus.mjs](../scripts/diag-embeds-ambigus.mjs) reconstruit le
graphe des clés étrangères **depuis les migrations**, compte les liens par paire de tables, et rougit
sur tout embed non désambiguïsé entre deux tables doublement liées. Il balaie `app/`, `lib/` **et**
`components/`. Six paires sont ambiguës aujourd'hui — `organization_members ↔ users`,
`organization_members ↔ organizations`, `organizations ↔ users`, `profiles ↔ users`,
`publications ↔ users`, `referrals ↔ users` : **toute** nouvelle lecture entre elles doit nommer sa
contrainte.

**⚠️ ET LE CONTRÔLE AVAIT UN TROU — `!inner` N'EST PAS UN NOM DE CONTRAINTE.**
Le motif d'origine acceptait `cible!\w+(` comme « embed désambiguïsé ». Or `inner` est un `\w+` :
`users!inner(…)` sur une paire ambiguë **passait pour nommé** alors qu'il ne nomme rien. `!inner` et
`!left` sont des **modificateurs de jointure** — ils disent *comment* joindre, pas *quel lien
suivre* ; PostgREST répond exactement la même erreur d'ambiguïté.
Le cas qui rendait le trou dangereux n'est pas hypothétique : quelqu'un qui « simplifie »
`users!organization_members_user_id_fkey(…)` en `users!inner(…)` — un raccourci qui a l'air d'une
optimisation — **rouvrait la panne en laissant le contrôle vert**. Corrigé en excluant explicitement
les deux modificateurs (`MODIFICATEURS = /^(inner|left)$/i`, commit `9f10635`).
**Mesuré : zéro occurrence réelle dans le dépôt.** Le trou était donc ouvert et non encore tombé
dedans — c'est le seul moment où il est bon marché de le fermer.

**La leçon qui dépasse le cas** : ajouter une clé étrangère est une opération qu'on croit purement
additive. Elle ne l'est pas — elle **change la façon dont on a le droit de LIRE** les deux tables
qu'elle relie, partout, y compris dans du code écrit des mois plus tôt.

> **Seconde collision de numeros, resolue comme la premiere — par RENUMEROTATION.**
> `feat/s1-ux-profil` a ecrit un §E.13, un §E.14 et un §E.17 pendant que le tronc en ecrivait
> d'autres. Ceux du tronc gardent leur numero (ils sont cites ailleurs) ; ceux de S1 deviennent
> **§E.19**, **§E.20** et **§E.21**. Et ils sont REPLACES dans §E, avant le fourre-tout §E.9 —
> la fusion automatique les avait empiles APRES lui, ce qui les sortait de la liste des pieges.

<a id="e19"></a>
### E.19 — UNE API ASYNCHRONE QUI REND UN IDENTIFIANT DE DEMANDE NE DIT PAS QUE LE MESSAGE EST PARTI.

**Le piège.** Un fournisseur accepte une demande et rend un identifiant. Le code lit cet identifiant
comme une confirmation d'envoi, alors qu'il ne confirme que la **réception de la demande**. Ce qui se
passe ensuite — routage, filtrage, blocage — n'est pas dans cette réponse.

**La preuve, dans ce dépôt.** Vonage **Verify v2** (`api.nexmo.com/v2/verify`) répond `request_id`,
puis peut bloquer l'envoi. Sur la **Tunisie (+216)**, les journaux Verify affichent `BLOCKED` **après**
cette réponse. Le code rendait 200, l'écran lançait son compte à rebours et affichait six cases de
code — pour un SMS qui ne partirait jamais. **Six mois d'inscriptions perdues sans une ligne de log
côté produit.**

**Ce qui est en place.** Les routes d'envoi rendent `livraison_confirmee: false`, les écrans disent
« **demande transmise** » et jamais « SMS envoyé », et une **sortie** s'ouvre quand le compte à rebours
expire : un lien vers le formulaire de contact existant, prérempli avec le numéro et le pays.

**La règle générale.** Un écran qui **affirme plus que ce qu'on sait** est un écran mort : il enferme
quelqu'un dans une attente qu'aucun événement ne viendra rompre. Quand l'état réel n'est connaissable
qu'après coup, on dit ce qu'on sait — « transmis » — et on donne une action.
⚠️ Vaut pour **tout** fournisseur asynchrone, pas seulement les SMS : e-mail, webhook de paiement,
file de traitement. La question à poser est toujours la même : *cette réponse prouve-t-elle le
RÉSULTAT, ou seulement la PRISE EN COMPTE ?*

<a id="e20"></a>
### E.20 — UN CORRECTIF APPLIQUÉ À UN PARCOURS ET NON RÉTROPORTÉ À SON JUMEAU SE LIT COMME CORRIGÉ ALORS QU'IL EST VIVANT.

**Le piège.** Deux écrans font la même chose par deux codes recopiés. On corrige l'un, on documente la
correction dans **son** commentaire, et le dépôt affirme désormais que le défaut est fermé. Il l'est à
un endroit sur deux, et la recherche du défaut s'arrête sur le commentaire qui dit qu'il est réglé.

**La preuve, dans ce dépôt.** `PhoneOtpField` portait, en commentaire, l'explication d'une regex
laxiste corrigée : `/^\+[1-9]\d{6,14}$/` laissait passer un numéro structurellement E.164 mais **non
attribuable**, le bouton s'activait, le serveur refusait, et l'écran affichait « Service SMS
indisponible » pour une faute de saisie. Le correctif n'a **jamais** été rétroporté à
`inscription/organisation`, qui portait la même regex **six mois plus tard**. Et ses ≈200 lignes
jumelles avaient en plus leur propre table d'erreurs, plus pauvre.

**Pire encore sur le troisième jumeau** — les paramètres du compte — qui avait son propre `toE164` :
`if (s.startsWith('0')) return '+33' + s.slice(1)`. Un utilisateur marocain qui tapait `0612345678`
enregistrait un numéro **français** en croyant enregistrer le sien. Le code n'échouait pas : il
**inventait**, exactement ce que [lib/phone.ts](../lib/phone.ts) refuse de faire, en-tête à l'appui.

**Le remède, et c'est le seul qui tienne.** Ce n'est pas « penser à rétroporter » : c'est **supprimer le
jumeau**. Une saisie de téléphone ([components/phone/SaisieTelephone.tsx](../components/phone/SaisieTelephone.tsx)),
un parcours OTP ([components/PhoneOtpField.tsx](../components/PhoneOtpField.tsx)), trois usages.
`scripts/diag-saisie-telephone.mjs` **rougit** si une seconde implémentation réapparaît — c'est la
seule forme qui empêche la divergence de revenir.

<a id="e21"></a>
### E.21 — UN CHAMP QUE LE FORMULAIRE NE DEMANDE PAS REÇOIT UNE VALEUR EN DUR — ET CETTE VALEUR CHOISIT UN COMPORTEMENT AILLEURS.
Le formulaire d'inscription d'organisation ne demandait **pas** le pays du siège. Il postait
`country_code: 'FR'` ; la finalisation retombait sur `?? 'FR'` ; la colonne portait
`default 'FR'`. **Trois endroits**, et aucun choix.

Ça se lit comme cosmétique. Ça ne l'est pas : `verification_providers` **sélectionne le registre
officiel SUR CE CODE**. Une société marocaine était donc cherchée dans **Sirene**, absente, et
renvoyée en `pending_admin_review`. Le champ était en **lecture seule** sur son écran : elle ne
pouvait même pas se corriger. Cul-de-sac parfait, et **invisible** — l'écran affichait « Pays :
FR », ce qui ressemble à une donnée, pas à une décision du code.

**La question qui a décidé du correctif n'était pas « quels pays ajouter ».** C'était : *la revue
humaine est-elle un repli acceptable ou un cul-de-sac ?* Réponse lue dans le code : **c'est le repli
CONÇU** — refus explicite sans dépense, « jamais de rejet automatique », écran qui dit déjà « En
cours de revue ». Le défaut n'était donc pas d'arriver là ; c'était d'y arriver **pour la mauvaise
raison**, et que rien ne distingue les deux.

**Le second piège est de FORME, et il est plus retors.** Le motif de mise en revue était écrit dans
`verification_data.notes` — et la fiche back-office affiche `notes` sous le libellé **« Note IA »**.
On lisait donc « Aucun appel IA n'a été fait » **sous** « Note IA ». Et ces branches écrivaient
`score: 0`, rendu **« 0 » en rouge** : une organisation étrangère au dossier parfait ressemblait à un
zéro pointé. **Rien n'était faux au sens strict — et tout se lisait à l'envers.**

**Ce qu'il faut retenir, et qui vaut au-delà du pays :**
· une valeur **par défaut** sur un champ non demandé est un **choix fait à la place de quelqu'un**,
  et il ne se signale jamais ;
· chercher les autres occurrences **par balayage**, pas de mémoire — l'audit en avait compté deux,
  le dépôt en portait **cinq** (`register-org`, `finalize-org-registration`, le défaut de colonne,
  `ensurePersonalOrg`, et les deux écrans de profil expert) ;
· un **refus** rendu à l'utilisateur et un **motif** destiné à l'exploitant ne sont pas le même
  texte, et ne doivent pas partager le même champ ;
· `score: null` quand rien n'a été noté. **Un score inventé a l'air d'avoir été décidé.**

`scripts/diag-pays-organisation.mjs` garde les quatre points, **exceptions nommées** (`sirene.ts`
garde `country_code !== 'FR'` et ses neuf chiffres : Sirene **est** le registre français), et il lit
le **code seul** — ce lot cite « FR » partout pour expliquer ce qu'il a retiré, et un contrôle naïf
rougirait sur sa propre explication.

<a id="e22"></a>
### E.22 — UNE ERREUR TECHNIQUE CONVERTIE EN REFUS MÉTIER : LE REFUS EST JUSTE, LE MOTIF MENT.

C'est la classe dont §E.18 n'était qu'un **cas particulier** — et elle a été balayée après lui, sur
`app/`, `lib/` **et** `components/` (457 fichiers). **Trente-sept occurrences** de la forme :
un `catch` qui rend `null`, un `if (error)` qui rend `[]`, un compteur qui rend `0` quand il n'a
pas pu compter — **mesurées sur l'arbre du commit `c063ad1`, pas déduites**. Trente-trois le sont
restées, et elles sont **légitimes** : un formateur de date, un pitch best-effort, une validation de
format qui rend `false` parce que la chaîne n'en est effectivement pas une. C'est précisément ce qui
rend la classe coûteuse — **le motif n'est pas un défaut**.

> ⚠️ **ET LE BALAYAGE EST UN FILET, PAS UNE PREUVE.** Il cherche une valeur neutre **rendue** dans un
> bloc d'erreur. Le cas ⑤ ci-dessous ne rend rien du tout : il laisse un tableau **pré-initialisé**
> à `[]` et sort du bloc `if (memErr)` sans écrire. Aucun motif textuel ne l'attrape ; il a été
> trouvé en **suivant la valeur jusqu'à l'écran**. Huit des neuf cas sont dans les trente-sept ; le
> neuvième dit ce que ce genre de balayage ne verra jamais.

**Le défaut naît une ligne plus loin, chez l'APPELANT**, quand la valeur neutre traverse une **garde**
qui la lit comme un **fait** et en tire un refus **nommé**.

**LE CAS SOURCE : `loadOrganizationContext`** ([lib/auth-guard.ts](../lib/auth-guard.ts)). Sur erreur de
lecture, elle rendait `null` — la même valeur que « cet utilisateur n'appartient à aucune
organisation ». `requireAuth` traduisait ce `null` en **403 `no_organization`**. Le 14 septembre,
une seconde clé étrangère a rendu l'embed ambigu (§E.18), cette lecture a commencé à échouer, et
**le dashboard entreprise entier est mort en accusant l'utilisateur** : « vous n'appartenez à aucune
organisation », dit à un membre parfaitement légitime, sur staging et sur toute base neuve.

**LES NEUF CAS, ET LEURS QUATRE CONSÉQUENCES DIFFÉRENTES.**

| # | Où | Ce que la valeur neutre produisait | Nature |
|---|---|---|---|
| ① | `loadOrganizationContext` ([lib/auth-guard.ts](../lib/auth-guard.ts)) | 403 `no_organization` | **mauvais résultat ET mauvais motif** |
| ② | `organizationsLeftWithoutAdmin` ([app/api/admin/user-purge/route.ts](../app/api/admin/user-purge/route.ts)) | `[]` ⇒ la **barrière d'acquittement sautait en silence** | **garde contournée, action irréversible** |
| ③ | `expertProfileGate` ([lib/expert-verified-guard.ts](../lib/expert-verified-guard.ts)) | 403 « profil non vérifié » | refus **juste**, **motif faux** |
| ④ | `loadAdminActionTarget` ([lib/admin/user-actions-guard.ts](../lib/admin/user-actions-guard.ts)) | 404 `target_not_found` | « cet utilisateur n'existe pas », dit d'un compte réel |
| ⑤ | l'avertissement de purge (`app/api/admin/get-user/[id]/route.ts`) | liste vide ⇒ **aucun avertissement affiché** | l'admin décide en croyant qu'il n'y a rien à perdre |
| ⑥ | `joinBlockReason` ([lib/org-members.ts](../lib/org-members.ts)) | `null` = **AUTORISÉ** ⇒ un compte expert entrait dans une organisation | **le seul FAIL-OPEN** |
| ⑦ | `loadConfig` ([lib/verification/expert-verification.ts](../lib/verification/expert-verification.ts)) | note écrite **en base** : « provider non configuré » — sur une panne de **lecture** | motif faux, **persisté**, lu par l'admin |
| ⑧ | `loadProfileForVerification` (même fichier) | **rien n'était écrit** ⇒ profil figé en `pending`, « vérification en cours » pour toujours | **mensonge par omission** |
| ⑨ | `usage_peek` ([app/api/admin/org-usage/route.ts](../app/api/admin/org-usage/route.ts), [app/api/me/organisation/offre/route.ts](../app/api/me/organisation/offre/route.ts)) | `0` ⇒ « 0 / 2 annonces ce mois-ci » | **chiffre faux à l'écran**, au moment de décider |

**⑦ ⑧ ⑨ ONT ÉTÉ TROUVÉS APRÈS COUP, EN RELISANT CE QUE J'AVAIS GELÉ.** Le premier passage avait
figé `lib/verification/expert-verification.ts` et les deux compteurs de consommation sans les
ouvrir — au motif qu'ils « ressemblaient » aux autres cas légitimes. Ils ne l'étaient pas.
**Un cliquet ne dispense pas de lire chaque ligne qu'on y met** : il fige un inventaire, il ne le
juge pas. C'est la leçon la plus chère de ce lot, et elle vaut pour tous les cliquets du dépôt.

**⑧ est le plus instructif.** Le commentaire du bloc `if (error)` **nommait déjà la distinction** —
« les confondre envoie chercher un profil disparu qui se porte très bien » — et la ligne suivante
rendait `null` dans les deux cas. Un commentaire juste au-dessus d'un code qui ne le suit pas est
**pire qu'un fichier muet** : il fait croire que la question a été traitée (famille §E.7).

**⑨ avait déjà sa réponse dans le dépôt.** `app/api/admin/ecosystemes/[id]/impact/route.ts` rend
`null` sur exactement le même motif, et son commentaire dit pourquoi : « un compteur en panne qui
affiche zéro dirait *il n'y a rien à perdre* au moment précis où on décide de couper ». Deux
fichiers plus loin, le même compteur rendait `0`. **La bonne pratique était écrite ; elle n'était
pas gardée.**

**② mérite d'être lu deux fois.** L'en-tête de la route écrivait que l'avertissement était
best-effort, « parce que c'est un AVERTISSEMENT et non une garde ; aucune des trois barrières n'en
dépend ». **C'était faux d'une barrière** — la quatrième, l'acquittement `acknowledge_org_lockout`,
ne se lève **que si la liste est non vide**. Une liste vide par panne de lecture la faisait donc
sauter, sans trace, sur la seule action irréversible du back-office. Une justification écrite noir
sur blanc dans le fichier, et fausse : c'est la famille §E.7 appliquée à un raisonnement, pas à une
règle.

**LA PARADE, ET ELLE EST UN TYPE, PAS UNE DISCIPLINE.**
Un **état de plus** dans l'union — `'indisponible'` — ou un `null` dont le sens est **« je ne sais
pas »** et non « rien ». Le compilateur force alors chaque appelant à répondre. Trois règles en
sortent :
1. **Le refus ne se relâche pas.** On n'ouvre pas une porte qu'on n'a pas su vérifier. Ce qui change
   est le **motif** et le **statut** : **503**, jamais 403 (« cherchez un droit ») ni 404
   (« le compte a disparu »). Les deux se règlent séparément.
2. **L'ORDRE DU TEST COMPTE.** Ajouter un état à une union n'est pas gratuit : le jour où
   `'indisponible'` est apparu, `quota/route.ts` testait `gate === 'not_approved'` — le nouvel état
   ne correspondait à rien et la garde se serait **OUVERTE** sur une panne, l'inverse exact du
   correctif. Le compilateur ne dit rien d'une comparaison qui reste possible.
3. **Une porte par contrat, et une seule lecture.** `isExpertProfileApproved` **délègue** désormais
   à `expertProfileGate` ; `countActiveAdmins` n'est plus qu'une **façade** sur
   `activeAdminCountOrUnknown` qui applique le repli prudent (2) pour ses trois appelants
   **réversibles**. Un appelant **définitif** ne consomme jamais ce repli-là : rendre `2` sur une
   panne, c'est affirmer « cette organisation a d'autres administrateurs » à celui qui s'apprête à
   effacer le dernier.

**ET LE MOTIF HONNÊTE DOIT ARRIVER JUSQU'À L'ÉCRAN**, sinon on a remplacé un mensonge précis par un
silence poli. Cinq clés ajoutées dans les **quatre** langues, et chacune dit les trois mêmes choses —
ce qui n'a pas marché (une **lecture**), ce qui n'a **pas** été fait (rien n'est perdu), et la suite :
`err_org_lockout_check_unavailable`, `err_target_lookup_unavailable`,
`confirm_purge_org_lockout_unknown`, `collaboration.errors.profile_check_failed`,
`invitation_public.err_join_check_unavailable`.

**LE CONTRÔLE** : [scripts/diag-echec-silencieux.mjs](../scripts/diag-echec-silencieux.mjs) —
**50 assertions, 16 mutations jouées, 16 détectées**. Huit sections : un **cliquet** sur le
recensement (une occurrence NEUVE rougit, la dette ne peut que décroître — **33 gelées**, toutes
relues une par une après l'erreur ci-dessus) ; les réparations ancrées **sur le bloc qu'elles
visent** (§E.8) ; l'**ordre** des tests chez chaque appelant ; la parité i18n des motifs ; le
fail-open ⑥ ; les motifs de la vérification d'expert ⑦ ⑧ ; les compteurs ⑨ ; et la non-confusion des
deux compteurs d'administrateurs.

> **Le cliquet a mordu sur mes propres réparations**, et c'est le signe qu'il fonctionne : en
> passant les compteurs de `0` à `null`, la forme `erreur:null` est devenue *neuve* dans deux
> fichiers. Il a fallu rouvrir le GEL et écrire **pourquoi** la même forme y change de sens. Un
> cliquet qui ne bronche jamais sur une amélioration ne regarde pas ce qu'il prétend regarder.

> **Il ne double pas [scripts/diag-erreurs-avalees.mjs](../scripts/diag-erreurs-avalees.mjs)**, qui
> existait déjà et qui **recense** 143 emplacements en rendant toujours 0 — « ni un contrôle qui
> échoue, ni un cliquet », dit son propre en-tête, et il ne balaie que `app/` + `lib/`. Celui-ci
> **échoue**, il est un cliquet, et il balaie **`components/`** aussi. Les deux sont utiles :
> l'un donne la carte, l'autre ferme la porte.

**Deux faux positifs, trouvés en l'exécutant** — et ils valent d'être nommés, parce qu'un contrôle
qui crie à tort est désactivé le jour même : le comptage d'accolades était **borné à 4000
caractères** et coupait le corps de `loadOrganizationContext` (≈5700), si bien que deux assertions
rougissaient sur du code correct ; et le retrait des commentaires **perdait des lignes**, ce qui
faisait glisser tous les numéros du recensement. **Une mutation a aussi montré une assertion trop
lâche** : `/block === 'indisponible'[\s\S]{0,400}?503/` restait verte sur
`if (false && block === 'indisponible')`. Les conditions sont désormais **ancrées sur leur forme
exacte**, puis on lit **leur** bloc.

<a id="e23"></a>
### E.23 — LE COMPTE FANTÔME : `auth.users` créé, `public.users` absent, et AUCUNE ERREUR.
C'est §E.22 sur le chemin le plus coûteux du produit — la création de compte — et sa forme la plus
pure : **rien n'est converti, rien n'est avalé ; le succès lui-même est faux.**

`handle_new_user` mappe `raw_user_meta_data->>'role'` vers `users.user_type`. Il ne connaît que
`expert` / `cdi` / `entreprise` / `cabinet`. Pour **tout autre rôle — `admin` compris** :

```sql
IF v_user_type IS NULL THEN
  RAISE WARNING '[handle_new_user] role inconnu: %, user % - aucun miroir cree', v_role_front, NEW.id;
  RETURN NEW;
END IF;
```

`RAISE WARNING` **n'annule pas la transaction**. Le compte `auth.users` est donc créé, la fonction
rend la main **sans erreur**, et `public.users` n'a **aucune ligne**. Ce qui suit :
· le compte passe `requireAuth` (le JWT est valide) puis **échoue partout** — `requireAdmin` lit
  `users.user_type` et ne trouve rien ;
· **il OCCUPE l'adresse e-mail** : la seconde tentative répond « déjà utilisée » ;
· et **rien** ne le signale, ni à l'appelant, ni à l'écran. Seul le journal de la base porte le
  `WARNING`, que personne ne lit.

**La parade est une LECTURE, pas une confiance.** `/api/admin/create-admin` et
[scripts/creer-premier-administrateur.mjs](../scripts/creer-premier-administrateur.mjs) **relisent le
miroir** juste après `createUser` et, s'il est absent, **suppriment le compte auth** et échouent
proprement. Cette relecture **ressemble à une redondance** — c'est exactement le contrôle que
quelqu'un retirera en croyant simplifier. Elle est gardée par `diag-admin-create` (trois assertions,
pas une), et la migration est relue au passage : *si le point mort disparaît un jour, le diagnostic
doit le dire, pas continuer à garder un fantôme.*

**Le contournement assumé qui en découle** : on crée le compte avec `role: 'entreprise'` — le seul
rôle que le trigger sait traiter et qui ne crée ni profil expert ni organisation — puis on bascule
`user_type` en base. Écrire `'admin'` produirait le fantôme. **L'alternative propre serait une
branche `admin` dans le trigger** ; elle n'a pas été prise, et ce paragraphe existe pour que le
contournement ne se lise pas comme une négligence.

<a id="e24"></a>
### E.24 — UN CHIFFRE JUSTE SOUS UNE ÉTIQUETTE FAUSSE. Distinct de §E.16, et plus retors.
§E.16 recense le chiffre qui **vieillit** : il était vrai, il ne l'est plus, et rien ne le dit.
Celle-ci est l'inverse : **le chiffre est exact, c'est le nom de ce qu'on a compté qui est faux.**

**Le cas fondateur, mesuré le 18/09/2026.** §E.11 écrivait :
*« `diag-configuration-absente` balaie `app/` ET `lib/` (445 fichiers) »*, et posait un
**NON VÉRIFIÉ** sur `components/`. Or `RACINES = ['app', 'lib', 'components']` est dans ce fichier
**depuis sa création** (`git log -L` sur la ligne, commit `a5ccfb9`), et **445 était le compte des
trois racines** à la date citée (`app` + `lib` seuls : 354). Le nombre était juste, l'étiquette
annonçait deux dossiers pour trois.

**Pourquoi c'est plus coûteux qu'un chiffre périmé.** Un relecteur vérifie **le nombre** — il le
recompte, il tombe juste, il passe. Il ne recompte pas **le nom de ce qu'on a compté**. Le chiffre
exact sert alors de **caution** à la phrase fausse. Et ici la phrase fausse a produit un
avertissement (`NON VÉRIFIÉ`) qui envoyait chercher un défaut **là où il ne pouvait pas être**,
pendant que le vrai défaut de la même classe dormait dans `components/` (§E.22 dans le shell et les
paramètres, fermé au lot 4.1).

**Ce qu'on en tire, et c'est une règle d'écriture :** un chiffre ne s'écrit **jamais sans dire sur
quoi il porte**, et l'étiquette se vérifie **en relisant le code qui produit le chiffre** — pas en
recomptant. Un `NON VÉRIFIÉ` bâti sur une étiquette non relue est pire qu'un silence : il **oriente**
la recherche, et il l'oriente à côté.

<a id="e25"></a>
### E.25 — PLUSIEURS MAINS, AUCUNE CONVENTION : LE PROPRIÉTAIRE NE SAIT PLUS LIRE SON PRODUIT.
Ce n'est **pas un défaut de code**. Rien ne plantait, aucun test n'aurait rougi, et chaque réglage
pris isolément était juste. C'est ce que produit **l'absence de convention quand plusieurs mains
écrivent en parallèle** — et c'est le seul piège de cette liste qu'aucun contrôle n'aurait pu
trouver, parce qu'il ne se voit que devant l'écran.

**Les faits, mesurés.** Trois worktrees, plusieurs semaines, **trente-cinq réglages** — quand on en
comptait **neuf**. Le mot « seuil » désignait **quatre comportements incompatibles** : ce qui bloque,
ce qui alerte, ce qui trie, ce qui juge. Deux échelles coexistaient sans que rien ne le dise, si bien
que **« 1 » voulait dire *parfait* d'un côté de la page et *médiocre* de l'autre**. Et **seize**
valeurs n'avaient **aucun écran** — dont la grille tarifaire, dont dépend tout le compteur d'argent.

**Ce qui est révélateur, c'est la façon dont ça s'est su.** Pas par un audit, pas par un contrôle :
**Youssef a ouvert `/admin/matching` et n'a rien compris.** Un audit aurait dit « tout est cohérent »,
parce que chaque morceau l'était.

**Trois leçons, et la troisième est la plus coûteuse à apprendre :**
1. **Un vocabulaire ne s'installe pas tout seul.** Chacun prend le mot du moment ; les mots
   divergent ; et la divergence ne se voit qu'une fois qu'elle est partout. §D.9 impose les quatre
   mots, et nomme l'exception pour que la règle ne mente pas au premier `grep`.
2. **Une échelle est une convention, donc elle se décide et elle se garde.** §D.10, et le contrôle
   qui interdit une seconde conversion.
3. **UN INVENTAIRE NE SE COMPTE PAS DE MÉMOIRE.** Neuf annoncés, trente-cinq trouvés — un facteur
   quatre. C'est la même famille que §E.16 (« un inventaire incomplet se lit comme exhaustif »),
   mais à l'échelle du produit entier, et sur ce qu'un propriétaire croit connaître de son propre
   back-office.

**Ce qui en découle pour la méthode** : avant de refaire un écran, **recenser d'abord ce qu'il
gouverne** — où chaque valeur vit, **qui la lit vraiment** (fichier et ligne), ce qu'elle fait, son
échelle, et si un écran l'expose. Le recensement a coûté une phase entière, et il a changé le lot :
deux des prémisses de départ étaient fausses, et la vraie cause n'était pas l'écran mais le
vocabulaire.

<a id="e26"></a>
### E.26 — UN ÉCRAN QUI AFFICHE TOUT CE QUI EXISTE EN BASE DEVIENT ILLISIBLE — ET C'EST UNE INSTRUCTION D'ARCHITECTE QUI L'A PRODUIT, PAS UN DÉFAUT DE CODE.

`/admin/seuils` rendait **toutes** les lignes de `verification_providers`. Le code était juste : la
route lisait bien, l'écran rendait bien, aucun test n'aurait rougi. Le résultat, sur cinq blocs :
· **deux qui ne décident de rien** — un champ grisé avec trois lignes expliquant qu'il ne gouverne
  rien, et une ligne « non réglable » ;
· des **identifiants de base en guise de titres** (`claude_expert_coherence_check`,
  `ai_coherence_check`) ;
· un **bandeau de soixante pays en corps 8** pour dire une phrase ;
· **cinq boutons « Enregistrer »**.

**L'instruction était « montre l'état de la configuration ». La bonne instruction était « fais
décider ».** Un écran de réglage n'est pas une vue sur une table : c'est une surface de décision.
D'où **§D.11**, qui manquait.

> **ET LA MOITIÉ QUI COMPTE EST L'ÉCHANGE, PAS LE RETRAIT.** La propriété de cet écran — *déclarer
> ce qui ne gouverne rien* — était **exemplaire**, et c'est même la seule surface du dépôt qui le
> faisait. La retirer sans contrepartie aurait perdu la connaissance. Elle est donc **rangée** :
> `NE_GOUVERNENT_RIEN` dans [lib/jugement/sujets.ts](../lib/jugement/sujets.ts), §B.2 ⑨ dans
> [docs/architecture.md](architecture.md), et une section de `diag-reglages-inertes` qui **exige
> les trois à la fois** — déclaré, documenté, et **absent de l'écran**. Documenter sans retirer
> laisserait le champ ; retirer sans documenter perdrait la raison.

**LA RECHUTE, LE MÊME JOUR, ET ELLE EST DE MA MAIN.** Le lot 1.3 a passé une journée à fermer
§E.22 — une erreur technique convertie en affirmation métier — dans `lib/`. **L'écran livré le même
jour l'a rouverte** : il annonçait « la lecture a échoué » alors que le moteur n'avait jamais tourné.
La cause était en SQL (`from runs, generate_series(1,10)` rend `NULL` quand `runs` est vide, donc le
`null` de « rien à agréger » et celui de « je n'ai pas pu lire » ont **la même forme**).

**Ce que cette rechute enseigne, et c'est plus large que le cas :** fermer une classe **dans une
couche** ne la ferme pas **dans la suivante**. `lib/` était propre, et la confusion s'est reformée
une couche plus haut, en quelques heures, chez quelqu'un qui venait de la corriger. **Une classe de
défaut se ferme par un TYPE qui traverse les couches** — ici `etatRepartition()`, trois états nommés,
éprouvée **en l'exécutant** — pas par une correction locale, si soigneuse soit-elle.

<a id="e27"></a>
### E.27 — QUAND LA VALEUR NEUTRE EST RÉÉCRITE OU ESTAMPILLÉE, LA PANNE CESSE DE MENTIR : ELLE DEVIENT LA VÉRITÉ.

C'est une **famille à part** de §E.22, et elle est pire que ses neuf cas. Les neuf s'arrêtaient tous
à une **lecture** — un refus, un message, un compteur. On pouvait recharger la page et voir le vrai.
Ici, non : la valeur neutre franchit une frontière après laquelle **plus rien n'est rattrapable**.

Deux formes, trouvées au lot 4.1b en ouvrant les 45 emplacements de `lib/` et `app/[locale]`.

**FORME A — LA VALEUR NEUTRE EST CHARGÉE DANS UN FORMULAIRE, PUIS RÉÉCRITE EN BASE.**

Les deux écrans de validation de profil chargeaient expériences, formations et langues par
`(res.data ?? [])`. Une panne de lecture rendait donc un **formulaire vide** ; l'expert enregistrait ;
le corps portait `experiences: []` ; et `PATCH /api/profile` applique une liste vide par un
`delete().eq('profile_id', …)` **qui ne réinsère rien**.

**L'expert lisait « Brouillon enregistré » à la seconde exacte où sa carrière entière disparaissait.**

**Et le chemin sans barrière était le bouton PAR DÉFAUT.** La barrière de complétude de la route ne
s'arme que sous `body.visible === true`. Qui **publie** était sauvé — 400 `incomplete`, avec un motif
faux (« expériences manquantes », dit d'un profil qui en a dix) mais rien de perdu. Qui **enregistre
un brouillon** n'avait **rien du tout**. C'est l'ordre du test, encore : la garde existait, elle était
simplement sous la mauvaise condition.

**LA PARADE EST UN TYPE, ET IL RÉUTILISE LE VOCABULAIRE EXISTANT.**
[lib/lecture/liste.ts](../lib/lecture/liste.ts) : `ListeLue<T>` = `{ etat: 'indisponible' }` ou
`{ etat: 'disponible'; lignes: T[] }`. `lignes` **n'existe que dans la seconde branche** — `?? []`
devient inécrivable. Le discriminant s'appelle `etat` et `'indisponible'` y veut dire **la même chose**
que dans `etatRepartition` (§E.26) et dans `expertProfileGate` (§E.22) : *la lecture a échoué, on ne
sait pas*. **Trois noms pour la même idée rouvriraient la confusion qu'ils ferment.**

**ET LA BARRIÈRE EST AU SERVEUR, PARCE QU'UN CORRECTIF D'ÉCRAN N'EST PAS UNE BARRIÈRE.** Le dépôt
portait **quatre copies** du même chargement (§E.20) — deux qui écrivaient, deux qui affichaient.
`PATCH /api/profile` refuse désormais un remplacement **par le vide** d'une liste **non vide** que le
corps n'a pas déclarée lue (`listes_lues`). C'est la forme exacte de `acknowledge_org_lockout`
(§E.22 ②) : *une action irréversible ne se prend pas sur une liste qu'on n'a pas constatée.*
La barrière est posée **exactement sur l'irréversible** — remplacer par une liste non vide passe,
vider une liste déjà vide passe. Une barrière qui gêne le cas normal est une barrière qu'on retire.

> ⚠️ **ET LA BARRIÈRE NE RETOMBE PAS DANS LA CLASSE QU'ELLE FERME.** Elle compte ce qu'elle
> s'apprête à détruire ; si ce **comptage** échoue, elle refuse — **503**, motif nommé, aucune
> écriture. Ne pas savoir combien de lignes on effacerait n'autorise pas à les effacer. Sans cela,
> une seconde panne de lecture aurait contourné la garde posée contre la première.

Gardé par [scripts/diag-effacement-de-masse.mjs](../scripts/diag-effacement-de-masse.mjs).

**LA QUESTION QUI GÉNÉRALISE, ET ELLE EST COURTE :** *cette valeur va-t-elle REPARTIR EN ÉCRITURE ?*
Tant qu'une valeur neutre reste affichée, un rechargement la corrige. Dès qu'un formulaire la porte,
le prochain enregistrement la **grave**. Tout écran qui charge une liste pour la **renvoyer** est
concerné, pas seulement ceux-ci.

> **TROISIÈME OCCURRENCE DE LA FORME A, ET ELLE PORTE UN TAMPON DE SUCCÈS** — les deux analyseurs
> de CV, fermés le 20/09/2026. Sur un **cache hit** (même empreinte, analyse déjà `done`), les trois
> listes du profil étaient relues pour être **renvoyées à l’écran**. Aucune des trois lectures ne
> récupérait son erreur — c'est la forme ①-bis, où le motif objet du `Promise.all` ne porte même pas
> `error` (§E.30). Une panne rendait donc les trois listes à `[]`, **et la réponse annonçait**
> **`status: 'done', cached: true`**.
>
> **Ce n'est pas un affichage dégradé : c'est un FAIT FAUX QUI SE CROIT.** L'expert vient de
> redéposer son CV et lit que l'analyse a réussi et n'a rien trouvé. Le formulaire qu'il ouvre
> ensuite est prérempli avec ce vide, et le prochain enregistrement l’**écrit** — la boucle exacte
> de la forme A, avec en plus un **tampon de succès** qui décourage de recommencer.
>
> **La question de la forme A s'applique donc en deux temps** : *cette valeur va-t-elle repartir en
> écriture ?* — oui, par le formulaire ; et *qu'affirme-t-on en la servant ?* — ici, qu'elle est le
> résultat d’un travail réussi. **Un cache ne sert pas ce qu’il n’a pas su lire** : 503, et le
> prochain dépôt refait le travail. Rien n’est perdu, rien n’est écrit.

**FORME B — LA VALEUR NEUTRE ARRIVE APRÈS UN JALON D'IDEMPOTENCE, ET « RÉESSAYER » NE RÉPARE RIEN.**

Un jalon d'idempotence — `anonymized_at`, un tampon de réclamation — existe pour qu'un rejeu ne
refasse pas le travail. Il produit donc exactement l'inverse de ce qu'on attend quand une panne
survient **après** lui : le rejeu passe, voit le jalon, et **conclut que c'est fait**.

**LE CAS SOURCE : `purgeAccount`** ([lib/account-purge.ts](../lib/account-purge.ts)). Le commentaire de
l'étape 2 disait *« best-effort, ne bloque pas la purge »*. **C'est vrai de la suppression de
fichier.** Le même `prof` commandait aussi l'étape 3, **l'anonymisation du profil** — c'est-à-dire
l'obligation légale elle-même. L'erreur n'était pas récupérée ; `prof` valait `null` ; `if (prof?.id)`
était faux ; et **tout le bloc était sauté** : résumé, titre, photo, CV, adresse, code postal, année
de naissance, LinkedIn, téléphone, ville, compétences, langues, certifications **restaient en base**,
le fichier de CV restait dans le Storage.

L'étape 4 s'exécutait quand même, posait `anonymized_at`, et `logAudit` écrivait `anonymized: true`.
**Le registre déclarait tenue une obligation qui ne l'était pas, et le jalon interdisait toute
reprise.**

C'est **§E.22 ② mot pour mot** — une justification écrite noir sur blanc dans le fichier, vraie
d'**une** chose, et couvrant une garde qui n'était pas best-effort du tout. Et ici ce n'est plus un
message à l'écran : c'est une obligation légale que le registre déclare remplie.

**La parade** : on **lève**, exactement comme l'en-tête du fichier le promettait déjà pour les échecs
« auth, profil, user ». `anonymized_at` n'est alors pas posé, et le passage suivant reprend le compte
— l'idempotence joue enfin dans le bon sens. Et le registre porte désormais `profil_anonymise`,
`cv_supprime`, `avatar_supprime` : **il dit ce qui a eu lieu, pas ce qu'on espérait.** Un fichier
resté dans le Storage est un manquement qu'il faut pouvoir *chercher*, donc *tracer*.

> ✅ **ET LE DÉFAUT N'A JAMAIS FRAPPÉ — MESURÉ, PAS SUPPOSÉ.** La signature d'une étape 3 sautée est
> exacte et indélébile : un compte porte `anonymized_at` **et** des PII de profil. La requête qui la
> cherche est en tête de [docs/architecture.md](architecture.md) §C.8 ; passée **par Youssef**,
> **sur la base réelle** (staging `wnayuerhakekxccgimeg`), **le 19/09/2026**, elle rend **zéro ligne**.
> Toutes les purges déclarées sont complètes.
>
> **Par qui, comment, à quelle date — les trois s'écrivent.** Une mesure sans sa provenance est
> §E.24 : un chiffre juste sous une étiquette qu'on ne peut plus vérifier. Même discipline que le
> gel des plages de migrations (§G.2), établi lui aussi par une lecture humaine sur la base.
> ⚠️ Elle vaut **à sa date** et **aucun contrôle ne la rejoue** : elle exige une base (§E.12). Elle
> ne couvre pas non plus les **fichiers** du Storage, qui ne laissent aucune trace en base.

**LE SECOND CAS, ET IL M'A OBLIGÉ À CORRIGER MON PROPRE VERDICT.**
`runChannel` ([lib/notifications/dispatch.ts](../lib/notifications/dispatch.ts)) réclame ses
notifications par un `UPDATE … .is(dispatch_at, null)` atomique, puis trois lectures d'enrichissement
suivent **après** ce tampon. J'avais conclu « notifications perdues ». **C'est faux, et le fichier le
disait** : le chemin d'échec pose `attempts: 1` et laisse `dispatch_at` posé — *« échec DÉFINITIF,
aucun cron pour reprendre »*. Une lecture en panne produit donc **exactement le même résultat** qu'une
entité réellement disparue.

**Ce qui était perdu n'était pas la notification : c'était LA RAISON.** Personne ne pouvait
distinguer « l'annonce n'existe plus » d'une panne de base — et les deux appellent des actions
opposées. Les trois lectures journalisent désormais leur erreur, nommément.

> ⚠️ **ET UNE RÉSERVE RESTE OUVERTE, ÉCRITE DANS LE CODE — NON VÉRIFIÉ.** Sur la réclamation
> elle-même : si l'`UPDATE` **commite** et que seule la réponse se perd, le tampon est posé sans
> qu'aucun envoi n'ait eu lieu, et `.is(dispatch_at, null)` interdit la reprise. **Je ne l'ai pas
> observé ; je le déduis de la forme.** Le réparer demande une écriture en deux temps (réserver,
> puis confirmer) : c'est un lot à lui seul, et il n'est pas fait. Ce qui est fait : la panne ne se
> déguise plus en « rien à envoyer ».

**LE TROISIÈME CAS DE LA FORME B, ET IL EST DANS LE CHEMIN DE L'ARGENT — TROUVÉ LE 20/09/2026.**

`stripe_event_claim()` ([supabase/migrations/20260901000000_stripe_fondations.sql](../supabase/migrations/20260901000000_stripe_fondations.sql), §5.a)
est le jalon d'idempotence du webhook Stripe, et **il est juste** : un unique `insert … on conflict`
dont la clé primaire est l'identifiant `evt_…`, et dont la garde `where se.status = 'failed'` est
précisément ce qui empêche un **double crédit** sur un événement rejoué. On n'y touche pas.

**Mais si le processus meurt APRÈS la réclamation et AVANT la clôture** — plafond de durée atteint,
fonction tuée — la ligne reste en `'received'`, et **cette même garde refuse TOUS les réessais de
Stripe**. Le jalon produit alors l'inverse exact de ce qu'on attend de lui : il déclare fait un
travail qui n'a pas eu lieu, et « réessayer » ne répare plus rien. **Stripe abandonne au bout de
trois jours** ; passé ce délai, l'effet de cet événement — un droit ouvert, une validité prolongée,
une pièce comptable — ne sera **jamais** appliqué.

La migration **nommait déjà le risque** dans son commentaire (« ⚠ ÉVÉNEMENT BLOQUÉ EN `received` »),
et le tranchait correctement : *« mieux vaut un événement non appliqué et VISIBLE qu'un double
crédit »*. **Visible par qui ?** Mesuré le 20/09/2026 par balayage de `app/`, `lib/`, `components/`
et `scripts/` : les seuls accès applicatifs à `stripe_events` étaient les deux RPC du webhook.
**Aucun écran, aucune route ne lisait cette table.** Le commentaire promettait une visibilité que
rien ne fournissait — famille §E.7, appliquée à une garantie plutôt qu'à une règle.

**Ce qui est fait** : `/admin/facturation` en fait une ligne **rouge** et non une ligne parmi
d'autres, le compte remonte dans `/admin/supervision` comme **bloquant**, et le délai au-delà duquel
un `'received'` devient un incident **se déduit** du `maxDuration` du webhook plutôt que de se
choisir ([lib/stripe-exploitation/journal.ts](../lib/stripe-exploitation/journal.ts)).
**Ce qui n'est PAS fait, et délibérément** : rouvrir le rejeu en repassant la ligne en `'failed'`.
C'est un arbitrage d'**argent** dans une RPC du socle — on le **signale**, on ne le tranche pas.

> **Mesuré le 20/09/2026 sur la base de recette `wnayuerhakekxccgimeg` : `stripe_events` contient
> ZÉRO ligne.** Donc zéro événement coincé — mais **pour la bonne raison, et il faut l'écrire** :
> aucun événement n'est jamais arrivé (`ENABLE_BILLING` n'est pas posé, rien n'encaisse). « Zéro
> coincé » et « zéro reçu » ne sont pas le même fait, et publier le premier sans le second serait
> exactement §E.24 — un chiffre juste sous une étiquette qui rassure.

**LA QUESTION QUI GÉNÉRALISE LES DEUX FORMES, ET ELLE TIENT EN UNE LIGNE :**
*après cette valeur neutre, reste-t-il un chemin de retour ?* Si une écriture la grave (forme A) ou
si un jalon déclare le travail fait (forme B), **il n'y en a pas** — et la garde doit être posée
**avant**, jamais après.


<a id="e28"></a>
### E.28 — CE QUE 45 EMPLACEMENTS OUVERTS UN PAR UN ONT APPRIS (lot 4.1b).

Le recensement de §E.22 annonçait **47** emplacements dans `lib/` et `app/[locale]`. Il y en avait
**45** : deux étaient des faux positifs **du motif lui-même**. Sur les 45, **29 mentaient** et sont
corrigés, **16 sont légitimes** et gelés avec, chacun, **sa** raison. Ce qui suit est ce que la
lecture a appris, et qu'aucune mesure n'aurait donné.

**① LE CONTRÔLE ÉTAIT TROMPÉ PAR LA PROSE DE SON PROPRE CORRECTIF. C'est §E.7 À L'ENVERS.**
D'ordinaire un contrôle est trompé par un anti-pattern **écrit dans un commentaire**. Ici il l'était
par **la documentation du correctif**. `loadOrganizationContext` ([lib/auth-guard.ts](../lib/auth-guard.ts))
relit bien son `memberErr` — **28 lignes plus bas**, dont **19 de commentaire** expliquant §E.18 et la
classe même que ce recensement existe pour trouver. La fenêtre de 25 lignes ne contenait donc que
**six lignes de code**, et **les deux sites les mieux documentés du dépôt étaient comptés fautifs**.

Trois correctifs, et **le troisième n'est apparu qu'une fois les deux premiers posés** : les
commentaires sont retirés avant détection ; la fenêtre compte des lignes **de code** ; et
`MOTIF_DE_LIAISON` borne ce qui a le droit de se trouver entre les crochets d'une déstructuration —
la regex partait du **mauvais `const [`**, dix-sept lignes plus haut, et seule la disparition de la
prose l'a révélé. **Un défaut du script masquait un autre défaut du même script.**

**Corollaire, et il vaut pour tout recensement : le motif est lui-même un angle mort possible.**
Deux listes, donc (§G.8) — `JUGÉS`, lus avec leur raison ; `À JUGER`, comptés et **non lus**.

**② LA FORME ③ EST UNE CARTE PAR CONSTRUCTION, ET ÇA NE SE RÉGLERA PAS.**
Elle cherche `if (error) { … return null }`. **C'est exactement la forme du correctif** — un `null`
dont le sens est « je ne sais pas ». Trois des seize légitimes sont des parades écrites au lot 1.3,
dénoncées par le motif qui les cherche. Ce n'est pas un réglage à affiner : **le motif ne peut pas
distinguer la parade de ce qu'elle répare.** Le verdict se rend en lisant **l'appelant**, jamais en
lisant le motif — et c'est pourquoi le gel porte une raison **par entrée**.

**③ UNE RÈGLE ÉCRITE À CÔTÉ D'UNE LIGNE NE COUVRE PAS SES VOISINES.**
Deux asymétries, trouvées à l'œil, et ce sont les prises les plus parlantes du lot :

· `lib/verification/expert-verification.ts` — un `Promise.all` de **quatre** éléments. Le
  **quatrième** porte, en commentaire : *« Pas de fallback en dur : un domaine sans nom = anomalie
  traitée par le caller, jamais masquée »*. Les **trois premiers** retombaient sur `[]`. Même appel,
  deux standards — et l'IA jugeait alors un expert **à zéro expérience**, notait bas, et la note
  **fausse** partait **en base**, lue ensuite par un administrateur (§E.22 ⑦, sur le chemin des
  données cette fois). **Et on payait l'appel.**
· `lib/home-ecosystem.ts` — `branchesRes.error` **est** testé, la section entière disparaît,
  honnêtement. `specialitiesRes` ne l'était pas, deux lignes plus bas : la page publique affichait
  les branches **sans aucune spécialité**, c'est-à-dire un écosystème qui a l'air vide.
  **Le repli partiel est plus trompeur que le repli total.**

**④ UN TYPE DÉCLARÉ TROP ÉTROIT NE FAIT PAS OUBLIER L'ERREUR : IL LA REND INATTEIGNABLE.**
Forme neuve, et elle disculpe l'auteur. `loadReferentielLabels`
([lib/publication-synthesis.ts](../lib/publication-synthesis.ts)) déclarait son client à la main :
`PromiseLike<{ data: unknown }>`. **Sans champ `error`.** Le compilateur *refusait* d'écrire
`specRes.error` : la seule façon d'écrire ce module était d'ignorer la panne. Ce n'est pas une
négligence, c'est une **forme imposée** — et elle produisait une annonce affichée **sans spécialité
ni zone**, qui se lit « cette annonce ne vise personne en particulier », sur la synthèse même que
l'expert consulte pour décider.
**La leçon : quand on écrit un type structurel pour découpler, on recopie la surface d'ERREUR, pas
seulement celle du succès.** Un type qui ne peut pas exprimer l'échec le rend impensable.

**⑤ LE MODÈLE, ET IL N'EST PAS DE MOI : LA GARDE EST UNE CONTRAINTE DE SCHÉMA, PAS UNE LECTURE.**
`findPersonalOrg` ([lib/collaboration/ensure-personal-org.ts](../lib/collaboration/ensure-personal-org.ts))
rend `null` sur panne, l'appelant **crée**, et **l'index unique partiel refuse le doublon** (23505,
rattrapé) ; si la relecture échoue à son tour, la fonction **lève**. La valeur neutre **ne peut pas**
produire de doublon, parce que la garde n'est pas la lecture — **c'est le schéma**.
**C'est la forme la plus solide du dépôt : elle ne dépend d'aucune discipline.** Partout où une règle
peut descendre en contrainte de base, elle doit y descendre ; le code de garde est le second choix,
et le commentaire le dernier.

**⑥ ET L'ORDRE DU TEST A ENCORE MORDU, DEUX FOIS.**
· `app/[locale]/reactivation/page.tsx` testait `userType === 'cdi'`. `my_account_routing()` rend
  `users.user_type`, donc `'expert_cdi'`. **La comparaison n'était jamais vraie** : *tous* les experts
  en CDI réactivés atterrissaient sur le tableau de bord freelance — panne ou pas. Le compilateur ne
  dit rien d'une comparaison qui reste **possible**. Corrigé en **déléguant** à
  `dashboardUrlForUserType`, source unique du routage : une table recopiée diverge, et celle-ci avait
  divergé.
· `app/api/candidatures/[id]/unlock/route.ts` testait `lifecycle?.bucket === 'archived'`. Un
  `undefined` **ouvrait** la garde — sur une action **payante** dont le dévoilement d'identité ne se
  reprend pas. On exige l'état, **puis** on le lit.

**⑦ CE QUI RESTE, ET IL EST COMPTÉ.** 125 emplacements, 60 fichiers : **16 jugés**, **109 à juger** —
les 109 sont dans `app/api`, périmètre des lots 4.1c et 4.1d, **et ils ne sont pas lus**. Le cliquet
les empêche de grandir ; il ne les déclare pas légitimes.

> ⚠️ **UN DÉFAUT VU ET DÉLIBÉRÉMENT NON TRAITÉ, ÉCRIT ICI POUR QU'IL NE SE PERDE PAS.**
> `app/api/publications/route.ts` retombe sur des compteurs **à zéro** quand l'état de vie est
> indérivable — « 0 candidature » dit à une organisation qui en a reçu dix. C'est le même défaut que
> porte déjà son propre `candErr` (« best-effort : on continue avec des compteurs vides »), et la
> parade est connue : §E.22 ⑨, un compteur illisible affiche « — », jamais zéro. Elle demande un
> `candidatures: null` dans le DTO **et** l'écran des annonces. **Les deux se jugent ensemble au lot
> 4.1c, pas à moitié ici.** Ce que 4.1b a fermé sur ce fichier : plus aucune candidature n'est rangée
> sous un motif **inventé** (« annonce clôturée » sur une panne).

<a id="e29"></a>
### E.29 — UN COMMENTAIRE VRAI D'UN CAS COUVRE UN CAS VOISIN OÙ IL EST FAUX.

Ce n'est pas §E.7 — là, le commentaire dit **quelque chose de faux**, et un contrôle s'y trompe.
Ici le commentaire est **exact**, et c'est ce qui le rend coûteux : il **arrête la recherche**. Le
lecteur voit que la question a été posée, lit une réponse juste, et passe — sans voir que la ligne
qu'elle couvre traite **deux cas**, et que la réponse n'en couvre qu'un.

**Trois occurrences, toutes de la classe §E.22, et la troisième a fait le tour du produit :**

| Où | Le commentaire, VRAI de… | …et FAUX du voisin |
|---|---|---|
| `app/api/admin/user-purge/route.ts` (§E.22 ②) | « c'est un AVERTISSEMENT, aucune des trois barrières n'en dépend » — vrai des trois | la **quatrième**, l'acquittement, ne se lève que si la liste est non vide |
| `lib/account-purge.ts` (§E.27 forme B) | « best-effort, ne bloque pas la purge » — vrai de la suppression de **fichier** | le même `prof` commande l'**anonymisation du profil**, qui est l'obligation légale |
| `lib/candidatures/lifecycle.ts` (lot 4.1b) | « publication introuvable (supprimée / hors scope) : plus rien ne peut en sortir » — vrai d'une **suppression** | **faux d'une panne de lecture** : toute candidature en attente basculait en « Annonce clôturée », des deux côtés à la fois |

**La troisième mérite d'être lue en entier.** Une seule lecture en échec sur `publications` faisait
paraître **toute la place éteinte** : l'organisation voyait son pipeline mort, l'expert voyait ses
candidatures clôturées, et le motif accusait **l'annonce**. Le commentaire, lui, disait vrai — de
l'autre cas.

**La question à poser devant tout commentaire qui justifie un repli : DE QUOI EXACTEMENT
EST-IL VRAI ?** S'il justifie « absent », il ne justifie pas « illisible ». S'il justifie « supprimé »,
il ne justifie pas « en panne ». Ces paires ont la même **forme** en mémoire (`null`, `[]`, `0`) et
jamais le même **sens** — c'est toute §E.22 en une ligne.

> **Et la parade ne peut pas être « mieux commenter ».** Un commentaire plus précis reste un
> commentaire : il n'empêche rien. Ce qui ferme la porte est le **type** qui rend les deux cas
> distincts — `lib/lecture/liste.ts`, `etatRepartition`, ou un `null` dont le sens est *je ne sais
> pas* et que l'appelant doit traiter.

---


> ⚠️ **QUATRIÈME OCCURRENCE — 21/09/2026, ET CELLE-CI A CACHÉ UNE HEURE D'ATTENTE.**
>
> `lib/matching-resync-hint.ts` s'ouvrait sur cette phrase :
>
> > *« Plusieurs actions côté client déclenchent un `runMatchingForExpert` côté serveur via
> > `after()` (**~8-15s**) »*
>
> **Elle était vraie — de l'approbation d'un expert et de la réanalyse d'un CV**, deux chemins qui
> exécutent effectivement le moteur dans un `after()`. Elle était **fausse de la sortie de « ne pas
> déranger »**, citée deux lignes plus bas dans la même liste : ce chemin-là posait une échéance à
> **soixante minutes**.
>
> **C'est le commentaire qui a rendu le défaut invisible**, et exactement de la façon que cette
> section décrit : il arrête la recherche. Un lecteur qui se demande « combien de temps ça prend ? »
> trouve une réponse chiffrée, plausible, écrite par quelqu'un qui a manifestement regardé — et il
> passe. Le fichier tout entier — une fenêtre de 120 s, un sondage à 3 s — est **dimensionné sur ce
> chiffre**. Il ne pouvait pas l'être : le travail était à une heure.
>
> **Ce que cette occurrence ajoute aux trois autres.** Les trois premières couvraient un cas d'erreur
> voisin ; celle-ci couvre un **chemin d'exécution** voisin. La question reste la même — *de quoi
> exactement est-il vrai ?* — mais la réponse ne se lit plus dans le fichier : elle est à l'autre bout
> d'une route d'API. **Un commentaire qui chiffre une durée ne peut être vrai que d'un chemin à la
> fois, et il ne dit jamais lequel.**
>
> Le fichier a été **supprimé** avec le défaut (§E.51) : ni le chiffre ni la fenêtre n'ont de raison
> d'être quand l'écran attend la vraie fin du moteur.

<a id="e30"></a>
### E.30 — UN TYPE DÉCLARÉ SANS CHAMP D'ERREUR REND L'ÉCHEC IMPENSABLE.

La forme la plus retorse trouvée au lot 4.1b, parce qu'elle **disculpe l'auteur** : il n'a pas
négligé la panne, **le compilateur lui interdisait de l'écrire**.

**Le cas source.** `loadReferentielLabels`
([lib/publication-synthesis.ts](../lib/publication-synthesis.ts)) déclare son client Supabase à la main,
pour être appelable sans le vrai client :

```ts
supabaseAdmin: {
  from: (t: string) => {
    select: (c: string) => { in: (col: string, v: string[]) => PromiseLike<{ data: unknown }> }
  }
}
```

**`{ data: unknown }`. Sans `error`.** Écrire `specRes.error` ne compilait pas. La seule façon
d'écrire ce module était donc d'**ignorer la panne** — et une lecture en échec produisait une annonce
affichée **sans spécialité ni zone**, qui se lit *« cette annonce ne vise personne en particulier »*,
sur la synthèse même que l'expert consulte pour décider.

**Pourquoi c'est une classe et pas un cas.** Un type structurel écrit à la main est un **contrat que
quelqu'un a recopié**, et on recopie ce qu'on utilise : la surface du **succès**. La surface de
l'**échec** est précisément celle qu'on n'utilise pas encore — donc celle qu'on oublie, et qu'on rend
alors inutilisable pour toujours.

**La règle : quand on écrit un type structurel pour découpler, on recopie la surface d'ERREUR en
premier.** Un type qui ne peut pas exprimer l'échec le rend impensable, et l'absence de gestion
d'erreur cesse d'être un choix.

> **Où chercher, et c'est la consigne pour les 109 emplacements restants** (`app/api`, lots 4.1c et
> 4.1d) : tout client déclaré à la main, tout type d'emprunt, tout `as` qui rétrécit un résultat de
> requête. Partout où le type ne peut pas dire « ça a raté », personne ne l'a écrit — et ce n'est pas
> une négligence à reprocher, c'est une porte à rouvrir.

---

<a id="e31"></a>
### E.31 — UNE GARDE QUI EST UNE CONTRAINTE DE SCHÉMA NE DÉPEND D'AUCUNE DISCIPLINE.

Règle **positive**, et elles sont rares : celle-ci dit quoi faire, pas quoi éviter.

**Le modèle, trouvé en jugeant les 45 du lot 4.1b, et il n'est pas de moi.**
`findPersonalOrg` ([lib/collaboration/ensure-personal-org.ts](../lib/collaboration/ensure-personal-org.ts))
rend `null` sur une panne de lecture. C'est **exactement** la forme de §E.22 — et pourtant rien ne
casse : l'appelant **crée**, l'**index unique partiel** refuse le doublon (`23505`, rattrapé), et si
la relecture échoue à son tour la fonction **lève**.

**La valeur neutre ne PEUT PAS produire de doublon, parce que la garde n'est pas la lecture : c'est
le schéma.**

**Ce que ça change, et c'est la hiérarchie à retenir :**

| Où vit la garde | Ce qui la tient | Ce qui la casse |
|---|---|---|
| **une contrainte de base** | le moteur, sur toute écriture, quel que soit l'appelant | une migration qui la retire — visible, versionnée, relue |
| du **code de garde** | la discipline de chaque appelant | un nouvel appelant qui l'oublie (§E.20 : le dépôt portait **quatre** copies du même chargement) |
| un **commentaire** | rien | le temps (§E.29) |

**La règle : partout où une règle peut descendre en contrainte de base, elle y descend.** Le code de
garde est le second choix, le commentaire n'en est pas un. Et c'est cohérent avec ce que le dépôt
sait déjà : §E.17 posait le CHECK en base **et** la redérivation côté serveur, « deux verrous
volontairement redondants » — le premier des deux est celui qui ne s'oublie pas.

---

<a id="e32"></a>
### E.32 — UNE DESTINATION QUI N'EXISTE PAS NE LÈVE RIEN : ELLE REND UN 404.

`FALLBACK_DASHBOARD_URL` valait `'/dashboard'`. Or `app/[locale]/dashboard/` ne porte **pas** de
`page.tsx` — seulement un `layout.tsx` et quatre sous-dossiers. Ce chemin tombait donc sur
`app/[locale]/[...rest]/page.tsx`, qui appelle `notFound()`. **Un 404 propre — mais un 404**, servi
au repli de `dashboardUrlForUserType()` pour **tout type inconnu** : un compte fantôme (§E.23), une
lecture de type en panne, et surtout quelqu'un qui venait de **réinitialiser son mot de passe avec
succès**.

**POURQUOI RIEN NE POUVAIT LE VOIR — et le troisième point est le seul qui compte :**
· `npx tsc` ne voit rien : une route est une **chaîne** (famille §E.1) ;
· `next build` non plus, pour la même raison ;
· et **un balayage des littéraux au point d'appel ne le voyait pas davantage** : il n'existe aucun
  `router.push('/dashboard')` dans le dépôt. Le chemin vivait dans une **constante**, rendue par une
  **fonction**, appelée ailleurs. **C'est exactement ce qui l'a gardé invisible.**

**La parade : [scripts/diag-liens-morts.mjs](../scripts/diag-liens-morts.mjs)**, qui reconstruit l'arbre
des routes depuis le disque et confronte **tous les littéraux de chemin**, où qu'ils soient — jamais
les points d'appel. Il couvre les écrans **et** les routes `/api` (mesuré : **62 écrans statiques**,
21 dynamiques, **104 routes d'API statiques**, 30 dynamiques ; **aucun chemin `/api` mort**).

> ⚠️ **L'ATTRAPE-TOUT EST EXCLU DE LA RÉSOLUTION, ET C'EST LA MOITIÉ QUI FAIT MARCHER LE CONTRÔLE.**
> `[...rest]` matche **toute** URL. Le compter comme une route rendait le contrôle vert sur
> n'importe quelle faute de frappe — il ne pouvait plus rien trouver. Mesuré : avec l'attrape-tout
> compté comme route, **zéro** destination morte ; sans lui, le cas source apparaît.

> ⚠️ **ET IL A ROUGI SUR SA PROPRE NORMALISATION.** Il retirait la barre oblique finale de chaque
> chemin ; `'/'` devenait donc la chaîne vide, et **l'accueil — qui existe — passait pour
> introuvable**. Corrigé, et dit ici parce qu'un contrôle qui crie à tort est désactivé le jour même.

**Le nom a changé avec la valeur** : `FALLBACK_ROUTE_URL = '/'`. Garder `FALLBACK_DASHBOARD_URL` en
pointant sur l'accueil aurait été un chiffre juste sous une étiquette fausse (§E.24).
**Et l'accueil plutôt qu'un tableau de bord est un choix, pas un défaut** : on arrive là parce que le
type est **inconnu** — désigner un tableau de bord serait deviner, la garde de rôle du layout
renverrait la personne ailleurs, et on aurait seulement **déplacé** le cul-de-sac. Le contrôle garde
cette propriété nommément.

<a id="e33"></a>
### E.33 — UN POINT DE COMPARAISON MAL CHOISI DÉPLACE LA FAUTE.

Cinq diagnostics étaient rouges. Pour savoir s'ils l'étaient **avant** mon lot, j'ai mesuré sur un
worktree détaché en `9aec284` — « le commit d'où je suis parti ». Verdict : *déjà rouges, pas de moi*.

**`9aec284` était le HEAD au début de la SESSION, pas le début du lot qui les avait cassés.** Il
contenait déjà les quatre commits de la refonte de `/admin/matching`. Remesuré en `fd3633b`, le
parent du premier de ces quatre : **les cinq étaient verts.** Ils étaient de moi, livrés rouges, et
ma première mesure m'innocentait.

**La règle : « mesurer avant mon lot » exige de savoir OÙ COMMENCE son lot.** Ce n'est pas le HEAD de
départ de la session, ni la dernière chose qu'on a commitée : c'est le **parent du premier commit qui
a touché la surface concernée**. `git log --oneline` et `git rev-parse <commit>^` donnent la réponse
en dix secondes ; l'intuition donne la réponse fausse avec la même assurance.

> **ET LE BIAIS A UN SENS.** Un point de comparaison trop récent **innocente** toujours : tout ce
> qu'on a cassé entre-temps est déjà dans la référence. C'est l'erreur confortable, donc celle qu'on
> ne relit pas. Le doute doit porter sur la mesure qui **arrange**, pas sur celle qui accuse.

**LE BANC S’ÉPROUVE SUR CE DÉPÔT, PAS SUR UN DÉPÔT IDÉAL — ET LA CAUSE EST MÉCANIQUE.**
Troisième occurrence de la même famille, et les trois sont des **propriétés de l’environnement**,
jamais des fautes de raisonnement :

| # | Ce qui a faussé le banc | Ce que ça produisait |
|---|---|---|
| ① | `execSync` passe par **cmd.exe**, où `^` est le caractère d’échappement : `<sha>^` lisait le commit **corrigé**, pas son parent | deux motifs sains paraissaient **muets**. Parade : les SHA sont **résolus** (`git rev-parse`) avant usage |
| ② | un point de comparaison pris au **HEAD de la session** et non au parent du lot | la mesure **innocentait** son auteur (ci-dessus) |
| ③ | les motifs d’un runner de mutation écrits sur `\n` alors que **le dépôt est en CRLF** (§E.3) | `\n      }\n` ne matchait jamais : **la mutation ne mutait pas**, ne retirait qu’une moitié de garde, et le contrôle restait vert — **il paraissait aveugle alors qu’il voyait** |

**③ est le plus retors des trois, parce qu’il accuse le bon outil.** Un contrôle qui reste vert sur
une mutation se lit immédiatement comme un contrôle troué ; on part le réparer, et on le rend plus
laxiste pour qu’il « morde ». **La question à poser d’abord n’est pas « pourquoi le contrôle n’a
rien vu ? » mais « la mutation a-t-elle réellement muté ? »** — et elle se vérifie, elle ne se
suppose pas : un runner de mutation compare le texte AVANT et APRÈS **et** vérifie que la garde
visée a bien disparu, par une empreinte **bornée au bloc** (§E.8 — une empreinte lâchée sur le
fichier retrouve toujours un `return` plus bas, et déclare incomplète une mutation parfaite).

**La règle : un banc d’essai est du code, et il porte les mêmes pièges que le code qu’il éprouve.**
CRLF, échappement du shell, portée d’une regex — §E.3 et §E.8 valent **dans les scripts de
mutation**, pas seulement dans les diagnostics.

> **④ — LA QUATRIÈME OCCURRENCE, LA PLUS BÊTE, DONC LA PLUS PROBABLE.** En éprouvant le motif de
> §E.42, le banc appelait `eprouve(label, cond)` avec les arguments **inversés** : la condition
> testée était la **chaîne du libellé**, toujours vraie. **Trois preuves passaient à vide** — le
> banc affichait `ok false`, et il fallait le lire pour voir que le mot après `ok` était la
> valeur de la condition. Un banc vert qui ne prouve rien **vaut moins qu’aucun banc : il
> autorise à se croire.** Ce qui l’a révélé n’est pas la relecture, c’est la sortie : un `ok`
> suivi de `false` ne se lit pas comme un succès quand on regarde la ligne. **La première ligne
> d’un banc à écrire est celle qui le fait échouer** — sur la fixture du défaut, avant la fixture
> du correctif.

> **⑤ — LE SHELL A RÉÉCRIT LA MÉMOIRE, ET LE SCRIPT A DIT « ok ».** Le 20/09/2026, un paragraphe
> de ce fichier a été écrit par `node -e "…"` dans une chaîne bash **entre guillemets doubles**.
> Chaque `` `identifiant` `` du texte était pour bash une **substitution de commande** : `reactivate`,
> `userErr`, `AuthError(403)` ont été exécutés comme des commandes, ont échoué (`command not
> found`), et ont été remplacés par **leur sortie — rien**. Le script a reçu un texte à trous, l’a
> écrit, a imprimé `ok`, et le commit est parti avec « confondue de  réintroduite, la racine
> remise ». **Aucun contrôle ne le voit** : `diag-memoire-exacte` vérifie des liens et des numéros de
> section, pas des phrases (§G.5 bis). Trouvé en relisant le `git show` du commit, pas la sortie de
> la commande.
> La règle, et elle est mécanique : **un texte qui porte des backticks ne traverse jamais une
> chaîne shell** — il s’écrit dans un fichier par un outil d’écriture, et ce fichier s’exécute. C’est
> la même famille que ① (cmd.exe et `^`) : le shell a une grammaire, elle s’applique **avant** le
> programme, et le programme ne peut pas savoir ce qu’il n’a pas reçu.

**Corollaire, payé le même jour : le nombre de contrôles rejoués compte aussi.** Les cinq rouges
avaient été trouvés en rejouant une liste choisie. En rejouant **les 77 `diag-*` du dépôt**, un
**sixième** est apparu — `diag-ecran-seuils`, cassé par la réécriture de `/admin/seuils` — plus une
régression écrite **une heure plus tôt** dans ce lot-ci : j'avais traduit une alerte par « seuil
d'alerte », le mot que §D.9 interdit. *La série complète n'est pas une formalité de fin de lot :
c'est le seul moment où l'on apprend ce qu'on ne cherchait pas.*

---

<a id="e34"></a>
### E.34 — UN CONTRÔLE QUI S'ANCRE SUR UN NOM ROUGIT AU PREMIER RENOMMAGE ET VERDIT AU PREMIER DÉPLACEMENT.

Quatre occurrences en deux lots — c'est une famille, et elle a **deux** faces, dont la seconde est la
dangereuse.

| Contrôle | Ce qu'il épinglait | Ce qu'il défendait vraiment |
|---|---|---|
| `diag-plafonds-listes` | la signature `Promise<{ dtos; troncature }>` au caractère près | le retour est un **objet** qui porte la troncature |
| `diag-moteur-reranking` | quatre **noms de clés** i18n | l'écran **refuse** un ordre incohérent entre les deux filtres |
| `diag-depense-ia`, `diag-lot7-securite`, `diag-moteur-echelle` | deux **adresses de fichier** | la mesure est lue, elle atteint un écran, illisible ≠ zéro |
| `diag-ecran-seuils` | sept **identifiants** (`seuilValide`, `seuil_invalide`, `drapeaux_vides`…) | un validateur existe au serveur, il refuse avec un code, la trace porte l'avant et l'après |

**LA FACE VISIBLE : il rougit sur une amélioration.** `diag-plafonds-listes` a rougi parce qu'on
ajoutait `| null` — c'est-à-dire parce qu'on fermait un défaut. Un contrôle qui punit le progrès est
désactivé le jour même.

**LA FACE DANGEREUSE : il VERDIT au déplacement.** Un contrôle ancré sur `fichier X contient Y` reste
vert si `Y` disparaît de `X` **et** du produit, pourvu qu'on ait aussi changé le contrôle ; et
inversement, il rougit d'un déménagement sans savoir le distinguer d'une perte. **C'est exactement ce
qui m'a fait annoncer une perte qui n'en était pas une** : le compteur de résumés non produits avait
simplement changé d'écran.

**LE CRITÈRE DE RELECTURE, À APPLIQUER À TOUT CONTRÔLE ÉCRIT DÉSORMAIS :**

> *Si je renomme cet identifiant sans rien changer d'autre, le contrôle rougit-il ? Si je déplace
> cette propriété dans un autre fichier sans rien perdre, rougit-il ?*
> **Deux fois oui : il est ancré sur un nom. Il doit l'être sur la propriété.**

En pratique : on balaie **un périmètre** (`app/api/admin`, `app/[locale]/admin`, `app/ + lib/ +
components/`) et on demande *« ceci existe-t-il QUELQUE PART ? »*, plutôt que d'ouvrir deux fichiers
par leur chemin. Le périmètre est stable ; le nom de fichier ne l'est pas.

> ⚠️ **ET LA TROISIÈME RÉPONSE EXISTE, elle n'est ni « contrôle » ni « code ».** Une assertion peut
> défendre une propriété qu'on a **délibérément inversée**. `diag-ecran-seuils` exigeait que la
> valeur inerte soit *montrée en lecture seule* ; §D.11 tranche l'inverse — un champ qui ne règle
> rien finit par être rempli, **même grisé**. L'assertion n'est pas supprimée : elle est
> **retournée**, et la raison est écrite sur place. Une assertion qu'on efface sans écrire pourquoi
> est une règle qu'on perd.

**LA CONTRE-MUTATION DOIT ÊTRE AUSSI ÉPROUVÉE QUE LA MUTATION.**

Le critère ci-dessus se vérifie par une **contre-mutation** : on renomme, et le contrôle doit rester
**vert**. Encore faut-il que le renommage ne perde vraiment rien — et c’est là que la contre-mutation
peut mentir à son tour.

**Le cas, mesuré le 20/09/2026.** Pour éprouver le contrôle du bouton de reprise (§E.46), la
contre-mutation renommait la variable `motif` en `raison`. Le contrôle a rougi. Premier réflexe :
*il est ancré sur un nom.* **Faux.** Le remplacement était global, et il avait donc aussi renommé le
**code d’erreur `motif_requis`** — une valeur **rendue au client**, sur laquelle l’écran s’aligne.

> **Un renommage qui atteint un contrat n’est pas un renommage neutre, et un contrôle qui rougit**
> **dessus a raison.** Le nom d’une variable locale ne quitte pas le fichier ; un code d’erreur, un
> nom de colonne, un chemin de route, une clé i18n, une action d'audit **traversent la frontière** et
> quelqu’un dehors s’y adosse. Le premier se renomme librement, les seconds se **négocient**.

**Ce que ça change dans la manière d’écrire une contre-mutation** : elle vise **la variable et rien
d’autre** (`/\bmotif\b(?!_requis)/`), et elle porte une **empreinte** qui vérifie qu’elle a bien
muté ce qu’elle prétendait muter — la même exigence que pour une mutation (§E.33 ③). Une
contre-mutation trop large **accuse un contrôle sain**, et on désarme alors la seule chose qui
marchait.

**LE LOT C4a (20/09/2026) — QUATRE CONTRÔLES, UNE PROPRIÉTÉ, ET LES NOMS QUI TOMBENT.**
`refus-actionnables`, `murs-fermes`, `plafonds-listes` et `score-de-pertinence` défendent la même
chose — *un écran ne promet que ce que le serveur tient* — et l’épinglaient chacun sur des NOMS de
fichiers : deux routes et quatre vues, cinq composants, six fichiers, deux chaînes route → écran.
Ils passent en **balayage** sur un socle partagé, [scripts/balayage-promesse.mjs](../scripts/balayage-promesse.mjs)
(pur : les fichiers d’un périmètre, la résolution **route → écrans par le chemin d’appel**
`/api/x/${…}/y`, les quatre dictionnaires). Chaque contrôle garde ses motifs, ses preuves sur
fixtures et sa campagne ; seul le *où chercher* est mis en commun.

| Contrôle | Avant | Après | Ce que le balayage a trouvé que le nom cachait |
|---|---|---|---|
| `score-de-pertinence` | 2 routes + 4 vues nommées | **136 routes, 188 fichiers client** ; le palier exigé sur *toute* route qui ordonne par le score ou le sélectionne, **au moins deux** | rien de rouge sur le code — mesuré, pas supposé. **Mais la campagne a trouvé un trou dans le MOTIF** : `(r as X).relevance_score` passait vert (le motif exigeait un identifiant devant le point). 7 mutations : 5 détectées, 2 déplacements de fichier tus (§E.34) |
| `murs-fermes` | 5 composants nommés | **188 fichiers client, 136 routes** ; les murs trouvés par la clé qui les nomme (`wall_title`), les lecteurs du verrou par le champ qu’ils lisent (`billing_enabled`), les écrans par le chemin de la route qu’ils appellent | **deux défauts nommés, gelés** : `SousTraitanceView` ne referme pas le verrou sur un quota illisible (le jumeau `DetailView` le fait — §E.20, non rétroporté) ; `collaboration.wall_contact`, clé orpheline dans les quatre langues depuis `c4b6916` — **les deux corrigés le 20/09/2026 sur arbitrage** (une ligne rétroportée ; la clé retirée des quatre dictionnaires, suppression voulue). Et un **troisième appelant** de la route quota est apparu (`SousTraitanceListView`). **10 mutations : 8 détectées, 2 déplacements tus** — et le déplacement du fichier GELÉ rougit, à raison : le gel d’un défaut nommé suit son fichier, et le contrôle dit de le mettre à jour (la face *visible* de §E.34, pas la dangereuse) |
| `refus-actionnables` | 2 chaînes route → écran écrites à la main | les routes trouvées par ce qu’elles **émettent** (un 402), les écrans par ce qu’ils **appellent**, les messages par la clé qui se termine par le code : **2 routes émettrices, 4 écrans appelants** | **un défaut nommé, gelé — et c’est le défaut fondateur du contrôle** : `CandidatureCard` appelle `/unlock` et jette `unlock_limit_reached` dans « une erreur est survenue », sur un écran que les deux chaînes n’ouvraient pas. Le message existait déjà ; **corrigé le 20/09/2026 sur arbitrage** — la branche, et la ligne d’issue ambre du jumeau. **7 mutations : 6 détectées, 1 tue** — et déplacer la **route** rougit, à raison : un chemin d’appel est un contrat, l’écran promettrait un traitement que le serveur ne tient plus |
| `plafonds-listes` | 6 fichiers nommés — les deux listes qu’un lot avait rendues honnêtes | **tous les `.limit(` de `app/api` + `lib` : 47**, classés — 18 lookups, 12 annoncés (le fichier compte ou rend le plafond), 2 sondés, **15 muets tous lus** : 8 légitimes (entrées de jugement IA, lots par passes, un flux), **6 défauts nommés** ; puis côté écran, tout **lecteur** (pas écrivain) d’une route qui rend `troncature`/`truncated`/`has_more` doit le lire | **14 défauts nommés, gelés** : `me/candidatures` 200, `me/conversations` 200, le fil de messages 500, les trois listes de la fiche expert admin — servis comme complets, coupés en silence ; et **8 écrans** qui lisent une route qui DIT sa troncature et la taisent (l’accueil entreprise pour les compteurs ET les annonces, la page Candidatures, les candidatures d’une annonce, deux vues de sous-traitance, un bloc de tableau de bord, la fiche utilisateur admin). Le socle est trouvé par ce qu’il **exporte**. **8 mutations : 6 détectées, 2 tues** (le socle déplacé, l’écran déplacé), dont une entrée du gel qui cesse d’être vraie et doit en sortir. **Les 14 sont corrigés le 21/09/2026 sur arbitrage** : les six plafonds muets sont **sondés** (`limiteSondee` + `couperEtSignaler`, 8 sondés désormais — `me/candidatures`, `me/conversations`, le fil de messages, les trois listes de la fiche expert, dont les langues ont reçu le tri qui leur manquait : la principale d’abord) et relaient `troncature` ; les huit écrans la montrent par **un composant partagé**, [components/ui/BandeauTroncature.tsx](../components/ui/BandeauTroncature.tsx) — le modèle de la page Annonces, mutualisé — l’accueil entreprise en premier, plus les cinq écrans des routes nouvellement sondées (suivi expert, boîte de réception, fil, fiche expert admin, et le panneau de détail qui dit désormais qu’« introuvable » peut être « au-delà du plafond »). Huit phrases i18n, une par chose coupée et par bout qui tombe. Les gels sont vides ; restent 9 muets, tous LÉGITIMES |
> **LE RÉSOLVEUR A RENDU ZÉRO APPELANT PARTOUT, ET UN CONTRÔLE « POUR CHAQUE APPELANT » EST PASSÉ
> VERT.** `routesApi()` construisait `/app/api/x/[id]/y` au lieu de `/api/x/[id]/y` : aucun écran
> n’appelle ce chemin, `consommateurs()` rendait `[]`, et la boucle « chaque écran qui appelle la
> route lit le verrou en `=== true` » n’a rien vérifié — en vert. C’est §E.33 ④ sous une autre
> forme : **une boucle sur un ensemble vide est une preuve à vide.** Ce qui l’a révélé n’est pas
> `murs-fermes`, c’est `refus-actionnables`, qui exige qu’une route émettrice ait **au moins un**
> appelant — et a rougi. **Tout balayage qui itère sur un ensemble découvert affirme d’abord que
> l’ensemble n’est pas vide** : c’est la ligne qui distingue « rien à redire » de « rien regardé ».
> Second défaut du même commit : `/^(DÉFAUT NOMMÉ)\b/` ne matchait jamais — hors drapeau `u`, un
> `É` n’est pas un caractère de mot en JS, donc pas de frontière après lui.

> **UN APPELANT N’EST PAS UN LECTEUR.** `PublicationForm` appelle `/api/publications` — en `POST`,
> pour créer. Lui reprocher de ne pas afficher la troncature de la LISTE était un faux positif, et le
> résolveur a appris le **verbe** : un appel dont le `method:` porte `POST`/`PATCH`/`PUT`/`DELETE`
> n’est pas une lecture. Y compris `method: isCreating ? 'POST' : 'PATCH'` — la première version
> ne lisait le verbe que collé à `method:`. Deux faux positifs, trouvés en exécutant, fermés avant
> de livrer.

**LE LOT C4b (20/09/2026) — SIX DÉCISIONS, UNE PAR CONTRÔLE, ET CE QUE LES BALAYAGES ONT TROUVÉ.**
Rapport rendu contrôle par contrôle AVANT d’y toucher ; l’architecte a tranché les six : deux
convertis, deux mixtes (la propriété générale en balayage, l’invariant d’un écran gardé nommé —
une adresse de route est un contrat), deux **non touchés** (`admin-create`, `admin-purge`,
`admin-ecosystemes` : la propriété est celle d’une chaîne précise ; `candidature-lifecycle` : une
table pure exécutée).

| Contrôle | Décision | Après | Ce que le balayage a trouvé |
|---|---|---|---|
| `login-loading` | **convertir** | « un drapeau de chargement posé avant un `await` se relâche dans un `finally` » vaut pour **tous** les écrans : **61 gestionnaires** trouvés (188 fichiers) — 40 `finally`, 5 `finally` + énumération, 16 énumération. Clé de gel « appel discriminant \| setter », jamais un numéro de ligne | **21 défauts nommés, LUS un par un** — dont **4 qui FIGENT** aujourd’hui (aucun `catch` : `mot-de-passe-oublie`, écran sœur de `/connexion` ; le chargeur de `freelance/mon-profil` ; `PublicationForm` enregistrer ; `DndEmptyState`) et 17 fragiles (énumération complète, ou un `finally` doublé de relâchements épars). Le motif est éprouvé sur six fixtures, dont le `setTrue` imbriqué qui doit remonter au GESTIONNAIRE et non au bloc. **Les 21 sont corrigés le 21/09/2026 sur arbitrage** : 61 gestionnaires sur 61 relâchent dans un `finally`, et là seulement, avec une garde de ré-entrance là où une navigation de succès suit (le motif de `/connexion`, recopié). Le gel est vide ; l’ancien reste dans le contrôle comme liste de formes déjà jugées, il n’exempte rien |
| `expert-name-masking` | **mixte** : garder l’exécution, convertir la projection | §D.4 dit *aucun chemin serveur* : toute chaîne de `select` qui embarque l’identité (`profiles(…)`, `users!…(…)`) et cite `email` / `phone` / `linkedin_url` / `cv_url` est un candidat — **24 sur 288 fichiers** ; légitime si admin (`requireAdmin`), cron, ou lecture de soi-même ; 8 gelés LÉGITIME avec raison (dispatcher, vérification IA, garde admin, achat Stripe, hook client…) | rien de rouge : **aucune route hors admin ne projette le contact d’un expert** — et c’est la première fois que c’est mesuré sur toutes les routes, pas sur cinq fichiers. Son gel ne porte que du **LÉGITIME** (8 entrées, chacune lue) : rien à corriger |
| `admin-users` | **famille A seulement** | le numéro cherché dans **54 routes admin** (plus six), le jeton de session dans **136 routes** ; B et C restent nommés | **un défaut nommé** : `admin/get-expert/[id]` sert `phone` dans l’embed `users!profiles_user_id_fkey`, et la fiche d’approbation l’affiche. La décision « aucun numéro pour administrer un compte » (list-users) ne dit pas si l’approbation d’un professionnel en a besoin — **arbitrage produit**, pas correctif d’office. **Arbitré le 21/09/2026 : VOULU.** L’administrateur appelle l’expert en cas de doute avant de valider — la donnée sert à la décision, c’est une finalité, pas une tolérance (produit §P2.4). Gelé **LÉGITIME** avec cette raison ; la décision « aucun numéro pour administrer un COMPTE » reste entière |
| `selecteur-ecosysteme` | **mixte** : R1 et R5 en balayage | R1 : les appelants d’`init-session` dans tout le code client sont un **état mesuré** gelé (les trois écrans qui OUVRENT une session, et eux seuls) ; R5 : toute route qui **LISTE** `domains` (pas une lecture unitaire par slug) filtre par `ecosystemAccessScope` ou est admin — 16 routes lisent `domains`, 6 en liste | rien de rouge |

> **Le lot C4a + C4b a laissé au gel 36 défauts nommés** — 14 de `plafonds-listes`, 21 de
> `login-loading`, 1 de `admin-users`. Aucun destructeur ; tous lus. **Arbitrage du 21/09/2026 :**
> **tous corrigés, par famille, un commit chacune** — sauf le téléphone sur la fiche d’approbation,
> **voulu** (produit §P2.4). Un défaut lu qui attend est un défaut qu’on réapprend.



---

<a id="e35"></a>
### E.35 — SÉPARER LE RÉGLAGE ET LA MESURE FAIT TOMBER LA MESURE.

La refonte a séparé ce qui se **décide** (`/admin/matching`, `/admin/seuils`) de ce qui s'**observe**
(`/admin/supervision`). C'était juste, et §D.11 le demande. **Mais la séparation n'est pas
symétrique, et c'est le piège :**

· **un réglage a un champ.** On le déplace, on le voit, on le teste — il crie s'il disparaît.
· **une mesure n'a rien.** C'est une ligne dans un tableau. Si elle reste en route, **personne ne
  s'en aperçoit** : l'écran est plus clair qu'avant, et il l'est parce qu'il montre moins.

**Mesuré sur ce dépôt, en confrontant les sources de lecture de l'ancien écran et de son ancienne
route à TOUT le dépôt d'aujourd'hui :** une seule mesure est tombée — `ai_spend_par_acteur`, la
dépense par compte déclencheur. Le **réglage** qui la surveille (les seuils d'alerte par acteur) est
resté, lui, intact. **On pouvait donc régler une alerte sans jamais voir ce qu'elle surveille** —
c'est §D.11 par l'autre bout : *un réglage sans sa mesure se règle à l'aveugle.*

**Et deux mesures ont survécu en perdant leurs MOTS**, ce qui est la forme discrète de la même
chute : les causes de panne (`modele_indisponible`, `reponse_illisible`) et les origines de relance
(`profil_modifie`…) s'affichaient en **identifiants de base** sur l'écran d'exploitation. La donnée
était là ; le sens était resté sur l'ancien écran (§E.26).

**CE QU'IL FAUT FAIRE AVANT DE DÉPLACER UN ÉCRAN, ET ÇA TIENT EN TROIS LIGNES :**
1. lister ce que l'écran **lit** — RPC, vues, colonnes — pas ce qu'il montre ;
2. après le déplacement, confronter cette liste à **tout le dépôt**, pas à l'écran d'arrivée ;
3. vérifier que les **libellés** ont suivi la donnée, sinon on a déplacé des clés.

Le point 2 est le seul qui trouve quelque chose : une mesure tombée ne casse rien, ne lève rien, et
n'apparaît dans aucun test. **La seule trace qu'elle laisse est une fonction de base que plus
personne n'appelle.**

> **Mesuré, et la distinction vaut d'être écrite** : sur les 65 fonctions et vues définies dans les
> migrations, **26 ne sont lues par aucune ligne de `app/`, `lib/` ou `components/`**. La plupart
> sont des *triggers*, des fonctions appelées par `pg_cron`, ou des helpers SQL internes — c'est
> normal. Mais **sept** sont des mesures de santé sans aucun lecteur :
> `admin_cron_chain_violations`, `annonces_expirees_par_duree`, `candidature_ai_health`,
> `cron_purge_health`, `cron_run_summary`, `matching_health`, `matching_relance_health`.
> **Elles n'en avaient déjà aucun AVANT la refonte** (mesuré sur `fd3633b`) : c'est une dette
> antérieure, pas une conséquence. Elle est nommée ici pour qu'on cesse de la redécouvrir.

<a id="e36"></a>
### E.36 — DEUX GARDES QUI TOMBENT SUR LA MÊME PANNE N'EN FONT QU'UNE.

C'est la prise la plus coûteuse du lot 4.1c, et ce n'est pas le fail-open qui la rend coûteuse :
c'est le **couple**.

`/admin/get-branch` comptait ce qu'une branche porte pour le **montrer**, `/admin/delete-branch` le
recomptait pour **autoriser**, et l'écran de taxonomie le resommait pour **activer le bouton**.
**Six lectures, aucune erreur récupérée, toutes en `count ?? 0`.**

**Une seule panne rendait les trois aveugles du même zéro.** L'écran affichait « 0 usage »,
l'administrateur supprimait en croyant décider en connaissance de cause, le bouton était actif, et la
barrière `in_use` ne se levait pas parce qu'elle lisait ce zéro.
**L'humain croyait décider ; la machine croyait qu'il avait décidé.**

**ET LE SCHÉMA NE RATTRAPAIT QU'UN TIERS :**

| Référence | Contrainte | Ce qui arrive |
|---|---|---|
| `profiles.branch_id`, `profile_alerts.branch_id` | RESTRICT | ✅ la base refuse |
| `publications.branch_id` | **ON DELETE SET NULL** | ❌ les annonces perdent leur branche, en silence |
| `specialities.branch_id` | **ON DELETE CASCADE** | ❌ elles sont **supprimées** avec elle |

Une branche sans profil mais avec des spécialités était donc **effaçable par une panne de lecture**,
sur le référentiel du produit. **Un tiers de protection n'est pas une protection.**

**LA PARADE N'EST PAS « CORRIGER LES DEUX » : C'EST N'EN AVOIR QU'UN.**
[lib/admin/usage-branche.ts](../lib/admin/usage-branche.ts) — une lecture, un type, trois
consommateurs. `UsageBranche` est `{ etat: 'indisponible' }` ou
`{ etat: 'disponible'; profils; publications; specialites }` : les comptes n'existent **que** dans la
seconde branche, donc `count ?? 0` est inécrivable. Le prédicat `brancheReferencee()` — celui qui
**montre** et celui qui **autorise** — vit désormais une seule fois.
**Si l'on ne peut pas savoir, l'écran le DIT et la barrière REFUSE. Jamais l'inverse, et jamais l'un
sans l'autre** — ils ne lisent plus séparément, donc ils ne peuvent plus diverger.

> ⚠️ **UNE SEULE DES TROIS ERREURS SUFFIT À RENDRE `'indisponible'`.** Rendre deux comptes sur trois
> serait pire que rien : le total aurait l'air d'un fait et n'en serait pas un — et c'est exactement
> sur ce genre de total qu'on décide de supprimer.

**LA RÈGLE ÉTAIT DÉJÀ ÉCRITE DANS LE DÉPÔT, DEUX FICHIERS PLUS LOIN.**
`app/api/admin/ecosystemes/[id]/impact/route.ts` rend `null` sur exactement ce motif, et son
commentaire dit pourquoi : *« un compteur en panne qui affiche zéro dirait "il n'y a rien à perdre"
au moment précis où on décide de couper »*. **Une règle écrite à un endroit ne protège pas son
voisin** — §E.28 ③, **troisième occurrence**.

**CE QUE ÇA DONNE COMME QUESTION, ET ELLE SE POSE PARTOUT OÙ UN ÉCRAN PRÉCÈDE UNE ACTION
DESTRUCTRICE :**

> *Si cette lecture échoue, combien de gardes tombent ?*
> **Plus d'une : elles n'en font qu'une, et il faut les fondre.**

Gardé par [scripts/diag-couple-ecran-barriere.mjs](../scripts/diag-couple-ecran-barriere.mjs) —
**12 mutations jouées, 12 détectées** : le type qui perd son état, une erreur sur trois qui ne suffit
plus, la barrière qui recompte pour son compte, le bouton qui se rallume, l'écran qui cesse de dire
pourquoi.
⚠️ Il garde **un** couple. La règle est générale ; rien ne **découvre** les autres — ils se cherchent
à la lecture.

---

<a id="e37"></a>
### E.37 — UNE GARDE PEUT NE PAS S'OUVRIR : ELLE PEUT CHOISIR LE MAUVAIS ÉTAT.

Forme plus discrète que le fail-open, et trouvée au même lot. Rien ne s'ouvre bruyamment : **tout se
déplace.**

`app/api/admin/user-status/route.ts` : sur `reactivate`, la route lisait `verification_status` pour
choisir entre `'in_review'` et `'active'`. L'erreur n'était pas récupérée ; la valeur tombait à
`null` ; et le défaut `'active'` restait. **Un expert en `pending_admin_review` retrouvait donc
l'accès complet sans la revue.**

Aucune barrière n'a sauté, aucun refus n'a été contourné, aucun code d'erreur n'a menti. Le compte a
simplement atterri **un cran trop loin**. C'est pour cela qu'on ne la trouve pas en cherchant des
`return` : **elle vit dans un défaut d'affectation, pas dans une condition.**

**Où la chercher** : partout où une lecture choisit une VALEUR parmi plusieurs, et où l'une d'elles
est le défaut. `let x = 'permissif'` suivi d'un `if` qui ne se déclenche pas est la même chose qu'une
garde ouverte — le compilateur, lui, ne voit qu'une affectation parfaitement légale.

**LE CAS SOURCE, ET C'EST LA SEULE OCCURRENCE RÉELLE TROUVÉE À CE JOUR** — `PATCH /api/profile`,
fermé le 20/09/2026. Une lecture de `users.user_type` décidait de tout le reste :

```ts
const userType = (userMetaRow?.user_type as string | null) ?? null
const isCdi = userType === 'expert_cdi'
```

L'erreur n'était pas récupérée. `isCdi` tombait à **faux**, et le PATCH d'un expert **CDI** était
alors validé avec la **liste blanche FREELANCE** : ses champs `cdi_*` n'étaient pas retenus, et le
prédicat de visibilité s'appliquait avec le mauvais parcours. **Aucun refus contourné, aucun code
d'erreur menteur, aucune valeur neutre rendue** — le profil part simplement un cran à côté, et
l'expert lit « enregistré ».

**Ce qui rend cette occurrence instructive : sa forme est une AFFECTATION.** Les balayages de la
classe §E.22 cherchent une valeur neutre **rendue** (`return null`, `?? []`, `count ?? 0`) ; ici la
valeur neutre est **consommée sur place** par un `===` dont le résultat est parfaitement légal.
C'est pourquoi elle figure dans la LISTE DE LECTURE de §E.38 ③ : **elle se lit, elle ne se balaie**
**pas**. Elle a été trouvée en ouvrant les 59 emplacements un par un, pas par un motif.

---

<a id="e38"></a>
### E.38 — CE QUI NE SE BALAIE PAS SE DÉCLARE. Trois dettes nommées, plutôt que trois contrôles verts.

**① LA COMPARAISON QUI N'EST JAMAIS VRAIE N'A AUCUN GARDE-FOU.**
`userType === 'cdi'` alors que la source rend `'expert_cdi'` (§E.28 ⑥). J'ai écrit le motif — « ce
littéral est-il **produit** quelque part ? » — et **il échoue sa propre preuve** : `'cdi'` **est**
produit dans le dépôt, comme valeur de `side` pour le tableau de bord, **pas** comme `user_type`.
Le littéral est le même, **le domaine ne l'est pas**, et un balayage textuel ne connaît pas les
domaines. `tsc` ne le dit pas non plus : `TS2367` ne mord que sur une union qui **exclut** le
littéral, jamais sur un `string` trop large.
**Cette forme SE LIT, garde par garde. Elle ne se balaie pas — et le dire vaut mieux que livrer un
zéro qui ne prouve rien.**

**② SEPT MESURES DE SANTÉ N'ONT AUCUN LECTEUR.** `admin_cron_chain_violations`,
`annonces_expirees_par_duree`, `candidature_ai_health`, `cron_purge_health`, `cron_run_summary`,
`matching_health`, `matching_relance_health` — **mesuré : elles n'en avaient déjà aucun avant la
refonte** (§E.35). Dette antérieure, à traiter avec les inventaires.

**③ LA LISTE DE LECTURE — TROIS FORMES QUI SE LISENT, GARDE PAR GARDE, ET NE SE BALAIENT PAS.**
Établie au lot 4.1d, en refusant de compter quatorze prises là où le motif n'en voyait aucune.
Elle sert à une chose : **savoir quoi lire à la main quand on ouvre un fichier**, plutôt que de
croire un contrôle vert.

| # | La forme | Pourquoi aucun motif ne la voit | Le cas fondateur |
|---|---|---|---|
| ① | **La comparaison qui n'est jamais vraie** — `userType === 'cdi'` quand la source rend `'expert_cdi'` | le littéral **est** produit ailleurs dans le dépôt, dans un autre domaine (`side`) ; un balayage textuel ne connaît pas les domaines | §E.28 ⑥ |
| ② | **Le couple §E.36 ENTRE FICHIERS** — deux gardes qui tombent sur la même panne | les deux moitiés sont saines **chacune dans son fichier** ; c'est leur *conjonction* qui est le défaut, et elle n'est écrite nulle part | `delete-branch` + `get-branch` (4.1c) |
| ③ | **§E.37 — la garde qui choisit le MAUVAIS ÉTAT** | rien ne s'ouvre, rien ne rend une valeur neutre : la garde se ferme correctement, sur le mauvais motif. Il n'y a pas de valeur suspecte à chercher | `expertProfileGate` et l'ordre du test |

> **ET UNE FORME LÉGITIME QUE LE MOTIF DE §E.42 PRENAIT POUR UN DÉFAUT — la RPC qui rend son motif
> dans son MESSAGE.** `if (rpcErr) { if (msg.includes('cron_job_not_found')) return 404 ; return 500 }`
> a la forme exacte d’une garde confondue : la condition nomme une erreur, le bloc rend 404. Mais
> l’erreur **PORTE** le fait métier — `cron_job_not_found`, `package_not_found` sont le **contrat**
> de la fonction SQL, pas une panne — et l’échec générique, lui, rend 500. Cinq occurrences
> (`cron-jobs/run`, `schedule`, `toggle` ×2, `package-default`). **Elle se reconnaît par sa
> propriété** (le statut vit sous le test du message), et c’est ainsi que le contrôle la range —
> pas par une liste de chemins.

**LA QUATRIÈME, ELLE, SE BALAIE — et c'est §E.39.** Le couple §E.36 **à l'intérieur d'une seule
fonction** a une signature textuelle : une garde teste `X`, une action consomme `f(X)`. Deux
lectures suffisent ; il n'a pas besoin de deux fichiers. **La différence entre ② et la quatrième
n'est pas la gravité, c'est la PORTÉE** — et la portée décide si un motif peut exister.

> **La règle commune aux trois : une propriété qu'on ne sait pas contrôler se NOMME.** Un contrôle qui
> rend zéro sans pouvoir trouver est pire qu'une dette écrite : le premier rassure, la seconde
> attend. C'est la même exigence que « le contrôle doit mordre », appliquée à ce qu'on décide de
> **ne pas** contrôler.

<a id="e39"></a>
### E.39 — LA GARDE TESTE `X`, L'ACTION CONSOMME `f(X)` : §E.36 À L'INTÉRIEUR D'UNE SEULE FONCTION.

**Le couple n'a pas besoin de deux fichiers pour exister. Il lui suffit de DEUX LECTURES.**

**Le cas fondateur, et il efface des données saisies à la main.** Les deux analyseurs de CV
écrivaient les langues ainsi : la garde testait `parsed.languages_structured.length > 0` — la liste
**brute** rendue par le modèle ; puis un `delete` vidait `profile_languages` ; puis la réinsertion
consommait `normalised`, la liste **dédoublonnée et filtrée**. Un modèle qui rend
`[{ language: "  " }]` — une réponse non vide mais illisible, cause que ce dépôt nomme déjà
`reponse_illisible` — **passait la garde, déclenchait la suppression, et réinsérait zéro ligne.**
Toutes les langues saisies à la main disparaissaient, et le dépôt du CV répondait 200.

**Ce qui rend la forme coûteuse : les deux moitiés sont justes.** La garde est juste (« il y a
quelque chose à écrire »), le filtre est juste (« une langue sans nom n'est pas une langue »). Le
défaut est **entre les deux**, et il n'est écrit nulle part.

**LA PROPRIÉTÉ, ET ELLE N'EST PAS UNE FORME :** *la liste qui sera RÉINSÉRÉE est testée AVANT la
SUPPRESSION.* Peu importe comment. Les trois écrivains la tiennent par **deux mécanismes
différents**, et c'est délibéré :
· `upload-cv` et `cdi-upload-cv` → une **garde locale** sur `normalised` ;
· `PATCH /api/profile` → une **barrière en amont** qui compte les entrées *écrivables* avec le même
  prédicat que les `.filter()`, et refuse **400 `liste_illisible`** avant d'atteindre les blocs.
Un contrôle ancré sur la forme locale aurait rougi sur le seul écrivain qui se protège autrement
(§E.34). Il est donc ancré sur la propriété, et l'exemption du troisième porte une **sentinelle** :
si la barrière disparaît, l'exemption tombe et le contrôle rougit.

**LE MOTIF, ÉPROUVÉ AVANT D'ÊTRE CRU** (scripts/diag-garde-et-action.mjs) : pour chaque
`.delete()`, il résout la liste que l'`.insert()` suivant consomme, et vérifie qu'un test de
**cette** liste précède la suppression. Il est **prouvé sur son cas connu avant tout balayage** —
le témoin est le bloc langues **tel qu'il était** (§E.33 : un témoin doit être ce qui a disparu, pas
ce qui entourait le défaut), et le contrôle vérifie **les deux sens** : il voit le défaut d'avant,
il se tait sur le correctif.

**Ce qu'il ne voit pas, et c'est écrit dans son en-tête** : il ne suit qu'**une** indirection
(`const rows = <B>`), il ne distingue pas `.map()` — qui conserve la longueur — de `.filter()` —
qui la réduit —, et une suppression passée par un RPC lui est invisible.

> **Deux pièges payés en l'écrivant, et les deux sont dans cette même section §E.**
> ① Le résolveur rendait `normalised.map` au lieu de `normalised`, et allait donc chercher
> `normalised.map.length` : **tout le dépôt rougissait**, pour six faux positifs. ② L'ancre de la
> troisième section était `indexOf("from('profile_languages')")` — qui tombait sur la **lecture du
> cache**, trois cents lignes plus haut, et examinait une zone qui ne contenait pas le bloc visé
> (§E.8 : on ancre sur le bloc qu'on vise, jamais une regex lâchée sur le fichier).

<a id="e40"></a>
### E.40 — UNE FENÊTRE DE VOISINAGE MESURE LA DISTANCE AU TRAITEMENT, PAS SON ABSENCE.

`diag-erreurs-avalees` cherchait une relecture de l'erreur dans une **fenêtre de 25 lignes de
code**. On attendait de cette fenêtre un cadran de **détection** : plus large, plus de prises.
**Mesuré, sur six réglages :**

| fenêtre | 15 | 20 | 25 | 30 | 40 | 50 |
|---|---|---|---|---|---|---|
| emplacements | 106 | 98 | **96** | 95 | 93 | 91 |

**Elle fait l'inverse.** L'élargir **retire** des emplacements, et les dix qui entrent à 15 comme
les cinq qui sortent à 50 sont **tous** de la forme ② (« récupérée puis jamais relue »). C'est
mécanique : la forme ② cherche une **relecture** ; une fenêtre trop courte ne la voit pas et
**accuse du code qui traite parfaitement son erreur**.

**LES CINQ, LUS UN PAR UN — et les cinq sont des FAUX POSITIFS :**

| Emplacement | L'erreur est relue | Ce qui l'en séparait |
|---|---|---|
| `publications:301` | +26 lignes → **500** | un `.insert({…})` de 26 lignes |
| `upload-cv:347` | +33 lignes | un `.update({…})` de 32 lignes |
| `cdi-upload-cv:111` | +41 lignes → 404 | un `.select([…])` qui énumère **40 colonnes** |
| `cdi-upload-cv:415` | +44 lignes | un `.update({…})` de 44 lignes |
| `cv/reset:76` | +50 lignes → **500** | un `.update({…})` qui efface **46 colonnes** |

**Ce qui les sépare de leur relecture n'est pas du code qui oublie : c'est une LISTE DE COLONNES.**
Un recensement qui compte les lignes d'une charge utile comme de la distance accuse les routes qui
écrivent le plus de champs — **exactement celles qui comptent**.

**LE RÉGLAGE N'EST DONC PAS UN NOMBRE.** « L'erreur est-elle traitée ? » est une question de
**PORTÉE** : elle se pose sur tout le reste du fichier — et c'est **déjà** la règle que la forme
①-ter applique vingt lignes plus bas **dans le même script**. « **Comment** est-elle traitée ? »
reste une question de **VOISINAGE**, et garde sa fenêtre. Les deux ne se bornent pas pareil.
**Résultat mesuré : la forme ② passe de 5 à ZÉRO**, et zéro entrant.

> ⚠️ **ET LE PRIX SE DIT (§E.38)** : une erreur dont le nom est réutilisé plus loin dans le fichier
> pour une autre requête passe désormais pour relue. C'est le prix de la portée, il est assumé, et
> la forme ② est **éprouvée par mutation** — sans quoi un zéro ne prouverait rien.

<a id="e41"></a>
### E.41 — LES TROIS PHRASES DU LOT 4.1d. Chacune tient parce qu'elle a un cas MESURÉ derrière.

**①  « UNE BRANCHE D'ERREUR DOIT SORTIR QUAND LA SUITE CONSOMME CE QUI A ÉCHOUÉ. »**
Née d'un demi-correctif de ma main : `candidatures:656` journalisait la cohorte incomplète **puis
continuait**, et la suite consommait précisément la cohorte. La première formulation — « une
branche d'erreur qui ne sort pas n'est pas une branche d'erreur » — était **trop large** : l'audit
de trente-quatre branches a montré qu'une branche qui **journalise et continue** est légitime
quand la continuation **ne consomme pas** ce qui a échoué. C'est la mesure qui a imposé la
formulation, pas l'inverse.
**L'exception se DÉCLARE, et il y en a une** : `candidatures:415`. `ownerUserType` ne choisit que
le *segment* du lien de la cloche ; inconnu, la garde de routage redirige le propriétaire vers son
propre tableau de bord — il arrive **ailleurs**, pas **nulle part** — et ne pas notifier du tout
coûterait infiniment plus cher. Une exception écrite n'affaiblit pas la règle : elle l'empêche
d'être contournée en silence.

**②  « UNE ABSENCE SE RECHARGE ; UN FAUX PRIX SE CROIT. »**
`me/organisation/offre` : sur une lecture en panne, une organisation **qui paie** lisait le nom et
le prix de l'offre **gratuite** comme étant la sienne. Rien n'était perdu en base — et c'est le
problème : **rien ne signalait que le chiffre affiché n'était pas le sien**. La route rend
désormais l'absence, et l'écran l'écrit : le slug en repli, et `price_undefined` — **jamais
« Gratuit »**, les deux y étaient déjà distingués.

**③  « UNE LISTE INCOMPLÈTE QUI SE PRÉSENTE COMME COMPLÈTE EST UNE AFFIRMATION, PAS UNE ABSENCE. »**
*(Cette troisième est de moi, pas de l'architecte — elle est notée ici parce qu'une règle sans son
auteur se cite mal.)* `me/conversations` construisait sa réponse avec **quatre** lectures, chacune
retombant sur `[]`. Une seule panne produisait « vous n'avez aucune conversation », dit à quelqu'un
qui en a. **Un seul drapeau pour les quatre, un seul refus** — 503 `conversations_indisponibles` —
parce que les quatre répondent à la **même question** : elles échouent ensemble ou pas du tout.

> **Corollaire d'arbitrage, tiré du même lot** : `publications` avait **deux causes** — la lecture
> des candidatures en panne, et un état de vie indérivable — produisant **la même ignorance**. Elles
> partagent **un seul drapeau**. *On ne multiplie pas les états quand l'action à mener est la même.*

<a id="e42"></a>
### E.42 — LA CLASSE VOISINE : UNE LECTURE EN ÉCHEC REND UN VERDICT MÉTIER, ET LE STATUT HTTP LE REND DÉFINITIF.

**Ce n’est pas §E.22, et la différence est ce qui la rend dangereuse.** Dans §E.22 la valeur est
**neutre** — `null`, `[]`, `0` — et le défaut naît chez l’appelant qui la lit comme un fait. Ici
la valeur n’est pas neutre : **elle est FAUSSE, et elle porte une AUTORITÉ** — un **404** (« cet
objet n’existe pas ») ou un **403** (« vous n’y avez pas droit ») rendu sur une **lecture en**
**panne**. « Introuvable » dit d’un objet qui existe. « Interdit » dit d’un membre légitime.

**Pourquoi le statut compte plus que le message.** Un 404 **se met en cache**, **se redirige**, et
**se lit par le navigateur comme un fait** — l’écran affiche sa page « introuvable », le client
cesse de réessayer, l’utilisateur cherche ailleurs. Un 503, lui, dit *réessayez* — et la même
requête, une minute plus tard, réussit. **Le refus est le même ; c’est sa durée de vie qui change.**

**LE CAS QUI A DÉCIDÉ DE L’ORDRE — `me/account/reactivate:55`, la seule irréversible.** Une personne
**annule sa suppression**. La lecture de son compte échoue ; la route répond 404 « User not found »
à quelqu’un que `requireAuth` vient d’authentifier. La fenêtre de grâce **court pendant qu’on lui
dit qu’elle n’existe pas** — et le jour où elle expire, **la purge s’exécute sur quelqu’un qui a
essayé de l’annuler et qu’on a renvoyé.**

**ET LA RACINE ÉTAIT DANS `requireAuth` LUI-MÊME** (`lib/auth-guard.ts`) : une lecture de `users` en
panne levait **403 `user_lookup_failed`** — le code distinguait déjà la panne de l’absence
(`user_lookup_failed` / `user_missing`), **le statut ne le faisait pas**. Toute route gardée héritait
donc d’un « interdit » sur une panne. C’est §E.22 ① (`loadOrganizationContext`, 403
`no_organization`) **sur la lecture d’à côté** — deux lignes plus haut dans le même fichier.

**LA MÉTHODE, ET POURQUOI `if (err || !x)` NE SUFFISAIT PAS.** C’est une **forme**, et elle rate la
moitié de la classe : celle où l’erreur n’est **même pas dans la condition**, parce qu’elle a été
**avalée en amont** et que la garde ne voit plus qu’un `!x`. On part donc de la **garde**, pas du
refus : chaque `if (…)` (parenthèses équilibrées), son bloc (comptage d’accolades, §E.8), *rend-il*
*404/403 ?*, puis la condition — nomme-t-elle l’erreur d’une **lecture** (CONFONDUE) ? teste-t-elle
`!x` où `x` sort d’une lecture dont l’erreur n’est pas prise (**AVALÉE EN AMONT**) ?

> **LE DÉFAUT VIT UN SAUT PLUS LOIN QUE LA FORME.** La garde teste `!invitation`, mais `invitation`
> n’est pas ce qui sort de la lecture : `const { data } = await admin…` puis `invitation = data ??`
> `null`. Un résolveur sans saut rendait **zéro sur le défaut même** que le recensement existe pour
> trouver. C’est la leçon du `select` non littéral et de la constante rendue par une fonction
> (§E.32) : **on suit un saut de réaffectation — un seul, et c’est déclaré.**

**MESURÉ le 20/09/2026, AVANT correction** sur `app/` + `lib/` + `components/` : **151 gardes
rendant 404/403** — 26 CONFONDUE, 54 erreur prise ailleurs, 71 hors classe. Réconcilié avec le
premier compte (49 occurrences de `if (err || !x)`, 18 verdicts) : les 18 sont un sous-ensemble
des 26, et le nouveau motif **résout deux des treize « sans statut HTTP »**
(`new Response(…, {status:404})`, et un statut porté dans un objet de retour).
**APRÈS, par le contrôle livré** ([scripts/diag-verdict-sur-panne.mjs](../scripts/diag-verdict-sur-panne.mjs)) :
**164 gardes** — le motif compte désormais aussi `AuthError(403|404`, la forme de la racine
(§E.24 : un chiffre ne s’écrit pas sans dire sur quoi il porte) — **79 erreur prise ailleurs,
72 hors classe, 7 non résolues, 5 portées par la RPC, 1 CONFONDUE** (l’exemptée ci-dessous).

| Verdict | Nombre | |
|---|---|---|
| **Défauts** | **20** (+ la racine `requireAuth`) | trois familles : le **compte** authentifié déclaré inexistant (7), le **profil** expert déclaré inexistant (9), l’**objet** métier déclaré inexistant (4) |
| Faux positifs du motif | 5 | voir ci-dessous — **une forme légitime, nommée** |
| Légitime, avec réserve | 1 | `invitations/resolve:52` |
| Aucun fail-open | 0 | **structurel** : la classe est définie par un refus |

**LA FORME LÉGITIME QUE LE MOTIF NE SAIT PAS LIRE — une RPC qui rend son motif dans son message.**
`cron-jobs/run`, `schedule`, `toggle` ×2 et `package-default` rendent 404 **uniquement** si le message
de la RPC contient `cron_job_not_found` / `package_not_found`. **L’erreur PORTE le fait métier :**
**c’est un contrat, pas une panne.** L’échec générique, lui, rend 503/500. Le motif voit « la
condition nomme une erreur » et ne lit pas le `msg.includes(…)` imbriqué. Ces cinq sont **rangés**
avec leur raison dans le contrôle, pas corrigés — et la forme est ajoutée à §E.38 ③.

**`invitations/resolve:52` — réponse volontairement UNIFORME, et on ne la rouvre pas.** Un attaquant
qui sonde des jetons ne doit pas distinguer « invalide » de « expiré » de « lecture en panne » : c’est
une décision de sécurité juste. **Mais le silence vers l’extérieur ne justifie pas le silence vers**
**l’intérieur** : la panne est désormais **journalisée côté exploitant**, sans rien changer à ce que
l’attaquant voit.

**UN SEUL CODE PAR NATURE, 503, JAMAIS 404 NI 403 :** `compte_verification_indisponible` (une
lecture de `users`), `profil_verification_indisponible` (une lecture de `profiles` — il existait,
réutilisé), `objet_verification_indisponible` (l’annonce, le suivi d’analyse), et
`ecosysteme_indisponible` (réutilisé) pour l’inscription. **Le motif honnête arrive jusqu’à
l’écran** : l’écran de réactivation a une vue « je ne sais pas », qui n’est ni « actif » ni « purgé ».

**LE CONTRÔLE — [scripts/diag-verdict-sur-panne.mjs](../scripts/diag-verdict-sur-panne.mjs).** Il est
**éprouvé sur ses cas connus avant tout balayage** (§E.33) : trois témoins qui sont *ce qui a
disparu* — `reactivate:55`, `accept:94` (valeur renommée), `auth-guard:279` (`AuthError(403)`) —
plus le correctif (il se tait), la forme RPC (il la reconnaît) et une validation de format (il ne
crie pas). Il reconnaît la forme légitime **par sa propriété** — le 404 vit sous un
`includes('…not_found')` sur le message — et non par cinq chemins de fichiers : un sixième
appelant de la même RPC sera classé de lui-même (§E.34). L’exemption de `resolve:52` porte une
**sentinelle** : si la panne cesse d’être journalisée, l’exemption tombe.
**Éprouvé par mutation, après commit (§G.5) — 6 jouées, 6 détectées, 1 contre-mutation tue** : la garde
confondue de `reactivate` réintroduite, la racine `AuthError(403)` remise, le journal de `resolve` retiré,
la levée 503 de `loadOrganizationContext` redescendue en 403, la forme RPC privée de son `includes(…)`,
une garde `!x` neuve non résolue — toutes rouges ; et renommer `userErr` reste vert (§E.34).
**C’est la preuve demandée : `reactivate` ne peut plus renvoyer quelqu’un qui existe sans que le
contrôle le dise.**

> **DEUX PIÈGES PAYÉS EN L’ÉCRIVANT.** ① Le motif de refus est lâche — `json(…, 404` sur deux cents
> caractères — et il **démarrait sur le `json(` voisin** : dans `cron-jobs/run`, un 409
> (`already_running`) précède le 404 dans le même bloc, la coupe tombait avant le `includes(…)`,
> et la forme légitime était comptée CONFONDUE. On coupe à la **fin** du match, pas à son début
> (§E.8 : ancrer sur le bloc qu’on vise). ② `const org = auth.organization` puis `if (!org) → 403`
> — **vingt occurrences** — sortaient en « non résolues ». Elles sont **hors classe**, mais pour
> une raison qui vit dans un autre fichier : `loadOrganizationContext` **lève 503** sur
> `memberErr` (§E.22 ①), donc `null` y veut dire « aucune organisation » et rien d’autre. La règle
> porte sa **sentinelle** sur cette levée : si elle disparaît, les vingt redeviennent des verdicts
> sur une panne, et le contrôle rougit.

> **CE QUI RESTE DÉCLARÉ, PAS ABSENT (§E.38).** Sept gardes `!x` (six entrées, `messages` en porte
> deux) dont le résolveur à un saut **ne remonte pas** l’origine — une destructuration de tableau
> (`Promise.all`), un objet dérivé deux fois, un booléen sorti d’un contexte. **Toutes les sept ont
> été LUES**, et chacune est légitime : l’erreur sort en 500 plus haut dans le même fichier, ou
> c’est un format, ou `'indisponible'` est testé la ligne d’avant. Elles sont gelées **nommément**
> — clé fichier + condition, jamais un numéro de ligne — avec une raison par entrée qui commence
> par LÉGITIME (§G.8) ; une garde neuve que le motif ne résout pas rougit, et le compte ne se
> relève pas : on lit, puis on ajoute. Le couple §E.39 a été cherché sur les 54 « erreur prise
> ailleurs » d’avant correction : **44 refusent avant la garde, zéro couple.**
<a id="e43"></a>
### E.43 — UNE RÉTROGRADATION NE SE DÉCIDE PAS SUR UN ÉTAT QU'ON N'A PAS LU.

C'est §E.27 forme A — la panne qui cesse de mentir et **devient** la vérité — sur la surface la
plus banale du produit : **un expert qui enregistre un brouillon**.

`PATCH /api/profile` relit le statut après l’enregistrement, dans un `after()`, pour choisir
entre remettre l’expert en relation et le **rétrograder**. L’erreur de cette relecture n’était
pas récupérée : `postUpd` tombait à `null`, `status` valait `null`, `null !== 'approved'` était
VRAI — et la branche **DÉMOTION** s’exécutait. Deux écritures : les recommandations supprimées,
et `users.is_verified` remis à **faux**.

**CE QUI REND CE CAS LE PLUS GRAVE DU GEL, ET C’EST MESURÉ, PAS DÉDUIT :**
· pour un expert, **`is_verified: true` n'est écrit QUE par `/api/admin/approve-expert`** —
  aucune réconciliation, aucun cron, aucun chemin de retour automatique ;
· `profiles.verification_status` restait **`approved`** : **aucune revue ne s'ouvrait**, donc
  aucun administrateur ne voyait qu’il y avait quelque chose à re-approuver ;
· l'invariant que trois autres routes énoncent en toutes lettres —
  `is_verified === (verification_status === 'approved')` — était **rompu en silence** ;
· et l’expert, lui, lisait « Brouillon enregistré ».

**LA FORME QUI REND LA CHOSE INVISIBLE : la comparaison est NÉGATIVE.** `!== 'approved'` met
« je ne sais pas » **du côté qui écrit**. Un test positif (`=== 'approved'`) aurait mis l'inconnu
du côté qui ne fait rien, et la panne n’aurait rien cassé. **Le même défaut, écrit dans l’autre
sens, serait passé inaperçu pour une bonne raison : il n’aurait rien fait.**

**LE CORRECTIF** : les deux causes sortent **séparément** avant toute décision — `postUpdErr`
(une lecture en panne, qui se rejoue au prochain enregistrement) et `!postUpd` (un profil
introuvable juste après son propre enregistrement, qui ne se rejoue pas) — §E.29. Ni démotion,
ni remise en relation : **les deux consomment `status`** (§E.41 ①).

**LE CONTRÔLE** — `diag-echec-silencieux`, section I. Il **balaie** (`app/` + `lib/` +
`components/`) au lieu d’ouvrir deux fichiers par leur chemin, et il tient **deux** exigences :
· **A** — toute lecture de statut qui précède une rétrogradation refuse sur son erreur ;
· **B** — quand la rétrogradation vit **sous une comparaison négative** du statut, les deux
  causes sortent séparément. B ne s’applique qu’à la forme dangereuse, et c’est le point.

> ⚠️ **ET LA PREMIÈRE VERSION DE CE CONTRÔLE PORTAIT UNE PHRASE FAUSSE, QUE SA PROPRE PREMIÈRE
> EXÉCUTION A DÉMENTIE.** J'avais écrit qu'une rétrogradation décidée par un humain « ne lit
> aucun statut, donc le balayage ne la voit pas ». Il la voit : `reject-expert` et `reject-org`
> **lisent** `verification_status` — pour refuser un 409 si le dossier n’est pas en attente.
> **Ce qui les sépare du cas source n’est pas la lecture, c’est la POSITION de l’écriture** :
> chez eux la rétrogradation est **inconditionnelle** (elle exécute une demande) ; ici elle
> vivait **sous** le test du statut. La distinction a été trouvée en EXÉCUTANT, pas en relisant
> — et elle a rendu le contrôle plus juste que ce que j’en attendais.

> **TROISIÈME COLLISION DE NUMÉROS, RÉSOLUE COMME LES DEUX PREMIÈRES — PAR RENUMÉROTATION.**
> Le tronc (lot 4.1d) et `feat/s1-ux-profil` (module Stripe d'exploitation) ont écrit un **§E.39**
> chacun, le même jour, sans se voir. Celui du tronc garde son numéro : il est **cité** par
> §E.38 ③ (« LA QUATRIÈME, ELLE, SE BALAIE — et c’est §E.39 »). Celui de S1 devient **§E.44** —
> `git grep` sur toute sa branche confirme qu'il n'était cité nulle part ailleurs, ni en prose,
> ni dans un commentaire de code. **Aucune ligne n’a été arbitrée : les six pièges sont là, en
> entier.**

---

<a id="e44"></a>
### E.44 — UN CONSTAT PÉRISSABLE NE SE PERSISTE PAS : IL SE REJOUE. UN ÉVÉNEMENT DATÉ, SI.

Établi au lot « module Stripe d'exploitation », et la question s'est posée trois fois dans le même
lot — c'est ce qui en fait une règle et non un cas.

**LE PIÈGE.** Une mesure coûteuse invite à être mise en cache. On crée une table, on y écrit le
résultat, l'écran le relit. **Et le résultat continue de vieillir pendant qu'il est affiché.**
La table ne ment pas le jour où on l'écrit : elle ment le lendemain, avec l'autorité de quelque
chose qui a été enregistré — et plus personne ne sait de quand date ce qu'il lit.

**LE CAS QUI TRANCHE, ET IL EST NET.** Un « écart de facturation » — une organisation dont les
droits en base ne correspondent pas à son abonnement Stripe — **cesse d'être vrai à la seconde où
le webhook suivant arrive**. Le persister, c'est garantir qu'un matin l'écran affichera un écart
déjà refermé, et qu'on ira chercher un défaut qui n'existe plus. **Il se recalcule à l'affichage,
et il ne se stocke nulle part.**

**LA CONTRE-ÉPREUVE, DANS LE MÊME LOT.** Le résultat de la vérification **nocturne**, lui, EST
persisté — et ce n'est pas une contradiction, c'est le critère :

> *Cette affirmation reste-t-elle vraie demain sans qu'on la refasse ?*
> **Un CONSTAT** (« il y a N écarts ») vieillit dès que la réalité bouge → il se **rejoue**.
> **Un ÉVÉNEMENT DATÉ** (« cette nuit-là, on a comparé et vu ceci ») ne vieillit jamais : il n'est
> vrai qu'une fois, il ne se recalcule pas, et sans lui personne ne peut dire le matin si la
> vérification a seulement tourné → il s'**écrit**.

**ET LE COROLLAIRE EST LE PLUS UTILE.** Ce qu'on écrit doit porter **l'état de la mesure avant son
résultat**. `stripe_reconciliation_runs` déclare `etat` (`compare` / `impossible`) **avant** ses
compteurs, et une **contrainte de base** refuse un compteur posé à côté d'un état `impossible`
(§E.31). Sans elle, un `manquants = 0` écrit sur une nuit où l'on n'a rien pu comparer se lirait
« zéro écart » pour toujours — **la forme la plus durable du mensonge de §E.36**, parce qu'elle est
enregistrée.

**Le troisième cas, refusé lui aussi** : ne pas recopier les factures, montants et litiges de
Stripe. Même raisonnement, appliqué à une source externe — une copie locale diverge de sa source,
pas le jour où on l'écrit, mais le jour où une synchronisation saute. Ce qu'un tiers détient
s'atteint par **un lien**, pas par une table.

Gardé par [scripts/diag-ecarts-stripe.mjs](../scripts/diag-ecarts-stripe.mjs) — 87 assertions,
**18 mutations jouées, 18 détectées**. Il n'appelle ni Stripe ni la base : les trois modules de
règle n'importent que des **types**, effacés par le dépouillement de types de Node, donc il les
**exécute** en Node nu depuis n'importe quel worktree (§E.3).

> ⚠️ **ET LA DIX-HUITIÈME MUTATION A SURVÉCU AU PREMIER PASSAGE — dans mon CONTRÔLE, pas dans le
> code.** Le motif `public\.cron_job_catalog` matchait encore `public.cron_job_catalog_DESACTIVE` :
> la tâche pouvait sortir du catalogue sans que rien ne rougisse. `\b` n'aurait rien changé — `_`
> **est** un caractère de mot, exactement le piège de §G.3 sur les horodatages. Et le même motif
> traversait le `;` pour lire l'instruction voisine. **Un contrôle écrit, relu et vert gardait une
> porte ouverte ; seule la mutation l'a montré.**

<a id="e45"></a>
### E.45 — UNE COLLISION QUI NE PRODUIT PAS DE CONFLIT EST PIRE QU'UNE QUI EN PRODUIT.

Le 20/09/2026, le tronc et `feat/s1-ux-profil` ont écrit **chacun un §C.10** dans
`docs/architecture.md`. **Git n’a rien signalé** : les deux insertions étaient à des endroits
différents du fichier, la fusion automatique a donc parfaitement réussi.

**Le fichier obtenu est valide, cohérent à la lecture, et FAUX À LA CITATION** : deux sections du
même numéro, dont l’une est citée deux fois ailleurs (`architecture.md:65`, `produit.md:628`).
Rien dans `git`, rien dans `tsc`, rien dans `next build` — et rien dans le rapport de merge, qui
ne parle que de ce qui a **échoué**.

**CE QUI REND CETTE FORME PLUS COÛTEUSE QU’UN CONFLIT, ET C’EST CONTRE-INTUITIF :**
· **un conflit ARRÊTE la fusion** et exige une décision de quelqu’un. Il est bruyant, donc traité ;
· **une collision silencieuse laisse la décision NON PRISE**, et personne ne sait qu’il y en avait
  une à prendre. La mémoire du projet se met alors à se citer de travers — exactement la faute que
  §E.16 décrit : *une mémoire fausse ne se voit pas, elle se cite.*

**Elle a été trouvée en RECOMPTANT les sections ajoutées par chaque côté après la fusion**, pas en
lisant le rapport de merge. D’où la règle de méthode :

> **Vérifier une fusion, ce n’est pas relire ses conflits : c’est recompter ce que les deux côtés
> ont ajouté.** Le rapport de merge ne décrit que les endroits où git a renoncé ; tout ce qu’il a
> réussi à combiner sort sans commentaire, y compris ce qu’il n’avait pas les moyens de juger.

**La résolution reste celle de M1 bis** : celui qui est **déjà cité** garde son numéro, l’autre est
renuméroté, et les deux sont **replacées** dans l’ordre. On renumérote, on ne choisit pas.

**LE CONTRÔLE** : [scripts/diag-memoire-exacte.mjs](../scripts/diag-memoire-exacte.mjs) section F —
aucun numéro de section porté deux fois, sur les **trois** fichiers de mémoire. Il est **éprouvé
sur son cas connu avant tout balayage** (§E.33) : le témoin est l’état du fichier **juste après la
fusion automatique**, et il vérifie les deux sens — il voit les deux §C.10, et il se tait sur
`bis` / `ter` / `quater`, qui sont des sections à part entière.

> ⚠️ **ET IL A FAILLI DÉNONCER TROIS SECTIONS SAINES.** Sa première version ne portait le suffixe
> que sur la forme sans point (`M1 bis`) et pas sur la forme pointée : `G.5 bis`, `P1.2 bis` et
> `P3.0 bis`/`ter` apparaissaient comme des doublons de `G.5`, `P1.2` et `P3.0`. **Un contrôle qui
> crie à tort est désactivé le jour même** — mesuré avant de livrer, pas après.

> **Ce qu’il ne vérifie pas, et c’est dit** : que les numéros se **suivent**. Un §C.8 suivi d’un
> §C.10 sans §C.9 ne rougit pas — un numéro peut avoir été retiré volontairement, et l’exiger
> ferait crier le contrôle à chaque suppression légitime.

<a id="e46"></a>
### E.46 — UNE REPRISE MANUELLE NE S'AUTORISE QUE SI « REJOUER » EST INOFFENSIF — ET ÇA SE MESURE.

**Le problème.** `stripe_event_claim` ne laisse repasser que les lignes en `failed` : c'est la
garde d'idempotence, et elle est juste. Mais un processus qui meurt **entre la réclamation et la**
**clôture** laisse la ligne en `received`, et cette même garde refuse alors **tous** les réessais de
Stripe — définitivement, puisque Stripe abandonne au bout de trois jours. **§E.27 forme B** : le
jalon d'idempotence déclare fait un travail qui n'a pas eu lieu.

**Le commentaire de la fonction disait : « mieux vaut un événement non appliqué et VISIBLE qu'un**
**double crédit ».** Cette phrase a gouverné la conception, et elle méritait d'être **vérifiée**
avant de décider quoi que ce soit. Mesuré, en lisant les six gestionnaires : **le double crédit
n'est pas atteignable par eux.**

| Écriture | Ce qui la rend rejouable | Où vit la garde |
|---|---|---|
| droits d’abonnement (`applyPackageState`) | **état ABSOLU, jamais un delta** ; son propre en-tête dit « c’est ce qui rend un rejeu inoffensif » | dans le `WHERE` : `package_source_event_at` |
| prolongation de validité (`extendValidity`) | un événement plus ancien rend `stale` | dans le code |
| transaction (`invoice.paid`) | `upsert` sur `stripe_invoice_id` | **INDEX UNIQUE PARTIEL en base** (§E.31) |

**D'où la réponse au cas qui faisait hésiter** — un `invoice.paid` de trois jours dont l'abonnement
est résilié depuis : le rejeu écrit la transaction (c’est un **fait**, l’argent a été pris) et la
prolongation de validité rend `stale`, parce que la résiliation est plus récente. **L’abonnement
résilié ne ressuscite pas.**

**CE QUI A ÉTÉ DÉCIDÉ, ET CE QUI A ÉTÉ REFUSÉ.**
· **Retenu** — une reprise **explicite, tracée, déclenchée par un humain** : un bouton qui repasse
  une ligne `received` en `failed` au-delà du délai, avec **un motif écrit exigé** et une entrée
  d'audit nommant qui et pourquoi. Jusque-là, la seule reprise possible était un `UPDATE` à la main
  dans l'éditeur SQL — précisément ce que **§E.10** interdit.
· **Refusé** — le **délai de grâce automatique** (`received` redevenant réclamable seul au bout de
  N minutes). Il ouvre une course avec un processus **lent mais vivant**, et **transforme une**
  **propriété vérifiable en pari sur un chronomètre**.

**LA CONDITION EST LA PARTIE QUI COMPTE, ET ELLE EST DANS LE MÊME COMMIT QUE LE BOUTON.**
« Rejouer est inoffensif » tient aujourd'hui **par construction**. Un **septième gestionnaire** —
un remboursement, un avoir, un compteur — qui écrirait un **delta** la casserait **en silence**, et
la reprise deviendrait le double crédit qu’on cherchait à éviter. `diag-billing-socle` garde donc
les quatre propriétés : aucun delta (arithmétique, `+=`, RPC d’incrémentation), la garde d’ordre,
le `stale`, et l'index unique derrière chaque `onConflict`. **Sans ce contrôle, le bouton
n'existerait pas** — et c'est la condition que l'architecte a posée en l'acceptant.

**Éprouvé par mutation — neuf, dont un FAUX SEPTIÈME GESTIONNAIRE sous ses trois formes** :
incrémenter un compteur, composer avec l’état antérieur (`+=`), insérer sans `onConflict`. Plus
les deux propriétés qui portent le bouton (garde d’ordre, `stale`), les trois du bouton lui-même
(condition dans le `WHERE`, motif exigé, trace), et **une contre-mutation** : renommer la variable
`motif` ne doit **pas** faire rougir.

> ⚠️ **ET LA CONTRE-MUTATION ÉTAIT FAUSSE AVANT DE PASSER.** Elle renommait `motif` **partout**,
> donc aussi le **code d'erreur** `motif_requis` — qui fait partie du contrat rendu au client. Le
> contrôle avait raison de rougir. **Un renommage qui touche un contrat n'est pas un renommage
> neutre**, et une contre-mutation mal écrite accuse un contrôle sain.

> **ET UNE ASSERTION DE `diag-ecarts-stripe` A ÉTÉ RETOURNÉE, PAS SUPPRIMÉE** (§E.34, troisième
> réponse). Elle exigeait que la surface d'exploitation n'expose **aucun** verbe d'écriture — et
> elle avait raison le jour où elle a été écrite. La propriété a été **délibérément changée** ;
> l'assertion garde désormais ce qui reste vrai : **au plus UN** verbe d'écriture, qui n'écrit ni
> droit, ni transaction, ni catalogue, et qui **ne rejoue pas** l'événement — il le rend rejouable.

<a id="e47"></a>
### E.47 — UNE RÈGLE JUSTE, APPLIQUÉE À UNE SEULE SURFACE, SE LIT COMME APPLIQUÉE PARTOUT.

C'est **§E.28 ③ à l'échelle du produit** — *une règle écrite à côté d'une ligne ne protège pas ses
voisines* — et la démonstration la plus chère qu'en ait donnée ce dépôt.

**LA RÈGLE ÉTAIT EXCELLENTE.** [lib/couleur.ts](../lib/couleur.ts) (alors dans `domain-config`)
porte une fonction de trente lignes, commentée sur dix-huit, qui abaisse la luminance de la couleur
de marque **à teinte et saturation constantes** jusqu'à franchir un contraste de 7 pour 1. Son
commentaire explique même pourquoi un assombrissement à taux fixe ne vaut rien : *« le même retrait
de luminance donne des ratios très différents selon la teinte »*. Elle conclut qu'ainsi
**« AUCUN écosystème futur ne pourra produire une page inaccessible »**.

**ELLE NE PROTÉGEAIT QU'UNE PAGE.** Mesuré le 21/09/2026 : la couleur corrigée était lue par
**trois fichiers**, tous les trois l'accueil. La couleur de marque **BRUTE** était lue par
**59 fichiers, 339 fois** — dont **66 fois en couleur de TEXTE**, à **2,77 contre du blanc**.

| | fichiers | usage |
|---|---|---|
| l'accent **corrigé** (7,31) | **3** | l'accueil, et rien d'autre |
| la marque **brute** (2,77) | **59** | boutons, liens, bordures, et du texte |

**POURQUOI PERSONNE NE L'A VU, ET C'EST LA PARTIE UTILE.** Rien ne manquait. La fonction existait,
elle était juste, elle était commentée, et son commentaire était vrai. Un lecteur qui tombe dessus
lit *« aucun écosystème futur ne pourra produire une page inaccessible »*, constate que c'est exact,
et **arrête de chercher** — exactement §E.29 : *un commentaire vrai d'un cas couvre un cas voisin où
il est faux*. Ici le cas voisin, c'était **tout le reste du produit**.

**CE QUI L'A TROUVÉ** n'est pas une relecture : c'est un **balayage qui a compté les lecteurs**.
Trois contre cinquante-neuf est un rapport qu'aucune lecture ne donne, et qu'aucun compilateur ne
signale — `domain.primaryColor` est un accès de propriété parfaitement légal.

> **LA QUESTION QUI GÉNÉRALISE :** *cette règle a-t-elle des lecteurs, et COMBIEN ?* Une règle sans
> lecteur est une intention ; une règle avec **trois** lecteurs sur soixante-deux est une intention
> qui se croit une garantie. Le compte se mesure, il ne se suppose pas.

**LA PARADE** n'est pas d'appeler la fonction partout : c'est de retirer la possibilité de ne pas
l'appeler. La couleur corrigée est désormais un **jeton** — `--sk-accent` — posé une fois sur
`<html>`, et la marque brute n'est plus accessible qu'à travers `--sk-marque`, dont le seul lecteur
est le logo. Gardé par [scripts/diag-couleurs-litterales.mjs](../scripts/diag-couleurs-litterales.mjs).

<a id="e48"></a>
### E.48 — UNE VARIABLE CSS NE RÉSOUT PAS DANS UN ATTRIBUT DE PRÉSENTATION SVG. Elle ne peint RIEN.

`stroke="var(--sk-muted)"` n'est pas une couleur invalide qui lèverait, et ce n'est pas non plus une
couleur par défaut : c'est un attribut que le navigateur **ignore**. Le trait disparaît. Ni `tsc`, ni
`next build`, ni la console n'en disent un mot.

La raison est dans la spécification et elle est nette : `var()` est substitué **au temps du calcul
d'une PROPRIÉTÉ CSS**. Un attribut de présentation SVG n'est pas une propriété — c'est une valeur
d'attribut, lue avant toute cascade.

**LE CAS FONDATEUR EST DE MA MAIN, ET IL A MORDU DEUX FOIS DANS LE MÊME LOT.**
La conversion de la palette remplaçait chaque couleur par son jeton. Elle a mordu :
· d'abord sur **neuf attributs** existants — chevrons de sélecteurs, coches, icône d'alerte —
  repérés **avant** la conversion, et convertis en propriété ;
· puis sur **le curseur de la démonstration de l'accueil**, que ma propre première passe venait
  d'introduire. Celui-là n'a pas été vu en relisant le code : la ligne a l'air juste. Il a été vu
  **en relisant le rendu**.

**DEUX FORMES CORRECTES, ET IL FAUT CHOISIR SELON CE DONT ON DISPOSE :**
· la **PROPRIÉTÉ** plutôt que l'attribut — `style={{ stroke: 'var(--sk-muted)' }}` ;
· la **VALEUR** plutôt que le jeton — `fill={palette.cartes}` — quand le code a la palette résolue
  sous la main. C'est le cas de la démonstration, qui construit son SVG en chaînes : elle reçoit
  `ctx.palette` entière et n'écrit toujours aucun littéral.

**Le contrôle** : [scripts/diag-svg-couleurs.mjs](../scripts/diag-svg-couleurs.mjs). Il retire les
commentaires avant de chercher (§E.7 : sinon il rougirait sur son propre en-tête, qui cite le défaut
qu'il défend). **Éprouvé par mutation, dont le cas fondateur rejoué tel qu'il était cassé.**
⚠️ Ce qu'il ne voit pas, et c'est écrit : `fill={x}` où `x` est une chaîne `var(…)` construite
ailleurs. Suivre la valeur demanderait d'exécuter le code ; cette forme **se lit** (§E.38).

<a id="e49"></a>
### E.49 — UNE PROPRIÉTÉ PERSONNALISÉE EST SUBSTITUÉE LÀ OÙ ELLE EST DÉCLARÉE, PAS LÀ OÙ ELLE EST LUE.

Le défaut le plus discret de la série, parce que le code **a l'air** de dire le contraire.

```css
:root {
  --sk-accent:      #2F6BF0;                                    /* valeur de secours */
  --sk-accent-soft: color-mix(in srgb, var(--sk-accent) 12%, white);
}
```

Puis, plus bas dans la page, le shell posait `--sk-accent: <couleur de l'écosystème>` en ligne, et
comptait sur `--sk-accent-soft` pour suivre.

**Elle ne suit pas.** `--sk-accent-soft` est calculée **sur `:root`**, avec la valeur de `--sk-accent`
**telle qu'elle est sur `:root`**. Ce que les enfants héritent est ce résultat déjà figé. La
surcharge posée plus bas change `--sk-accent` pour qui la lit directement, et **rien d'autre**.

**MESURÉ, DANS UN VRAI NAVIGATEUR**, sur un témoin reproduisant la cascade mot pour mot :

| ce qui lit | résultat | suit l'écosystème ? |
|---|---|---|
| `var(--sk-accent)` — la bordure | `#0EA5E9` | **oui** |
| `var(--sk-accent-soft)` — le fond | `#E6EDFD` | **non**, c'est le dérivé de `#2F6BF0` |
| `var(--sk-accent-ink)` — le texte | `#2553BB` | **non**, idem |

À l'écran : l'entrée de menu active sortait **en bleu indigo** pendant que le logo et les liens
sortaient **en bleu ciel**, à quinze pixels d'écart. Le commentaire du shell affirmait l'inverse —
*« un domaine non-bleu reste cohérent »*.

**CE QUI REND CE DÉFAUT COÛTEUX : il a l'air d'un réglage.** Trois déclarations cohérentes, une
surcharge au bon endroit, aucune erreur nulle part. Il ne se voit ni en lisant le CSS, ni en lisant
le composant : **il ne se voit qu'en lisant la valeur CALCULÉE**.

**LA PARADE N'EST PAS DE CORRIGER LA DÉRIVATION : C'EST DE N'EN AVOIR AUCUNE.** Tout est calculé
**au serveur** et posé **en littéral** sur `<html>`. Il n'y a plus rien à dériver au navigateur, donc
plus rien qui puisse se figer au mauvais endroit. La classe entière disparaît ; elle n'est pas
contournée. C'est la même hiérarchie que §E.31 : *une garde qui est une contrainte de schéma ne
dépend d'aucune discipline* — ici, une palette qui ne se dérive nulle part ne peut pas se dériver mal.

> ⚠️ **ET IL N'Y A AUCUN CONTRÔLE DESSUS, C'EST DIT.** Un motif qui chercherait `color-mix` dans une
> feuille ne saurait pas dire si la variable citée est surchargée plus bas — c'est une propriété de
> la CASCADE, pas du texte. Ce qui ferme la porte ici est **structurel** : `globals.css` ne déclare
> plus aucune couleur, et `diag-couleurs-litterales` le tient.

<a id="e50"></a>
### E.50 — UN SUFFIXE D'OPACITÉ COLLÉ À UNE COULEUR CESSE DE MARCHER LE JOUR OÙ LA COULEUR DEVIENT UN JETON.

**La forme.** `` `${couleur}33` `` — deux caractères hexadécimaux collés à une
couleur pour l'afficher à 20 %. Elle marche parfaitement tant que `couleur`
porte un hexadécimal : la chaîne produit `#RRGGBB33`.

**Ce qui la casse.** Le jour où `couleur` porte un JETON, la chaîne produit
`var(--sk-red)33`. Ce n'est pas une couleur. Le navigateur **ignore la
déclaration**, sans erreur, sans avertissement, sans rien : le fond disparaît,
l'ombre disparaît, la bordure disparaît.

**LE CAS FONDATEUR EST DE MA MAIN, ET IL EST INSTRUCTIF PARCE QUE LA PARADE
EXISTAIT DÉJÀ DANS LE MÊME LOT.** Le codemod de la palette traitait ce cas
nommément — il rendait `` `${domain.primaryColor}NN` `` en `color-mix`, et son
commentaire expliquait pourquoi. Il ne l'a pas traité pour les variables
**locales** qui reçoivent un jeton : `STATUS_COLORS[opt]`, `SECTION_PALETTE`,
`statusColor`, `statusBadgeColor`, `accent`, `c`.

**Vingt déclarations sont devenues invalides**, dont — et c'est là que ça se
paie — **le fond teinté et l'ombre de la carte SÉLECTIONNÉE du bouton de
disponibilité**, des deux côtés. C'est le bouton que le propriétaire du produit
était en train de tester. §E.28 ③, une fois de plus : *une règle écrite à côté
d'une ligne ne protège pas sa voisine.*

**POURQUOI RIEN NE POUVAIT LE VOIR.** Il n'y a aucun littéral — le contrôle des
couleurs littérales est vert. `tsc` ne lit pas une chaîne de style. `next build`
non plus. Et le rendu ne casse pas : il **manque** quelque chose, ce qui ne se
voit qu'en sachant ce qui devrait être là.

**LA PARADE EST UNE FORME QUI NE PEUT PAS SE TAIRE.**
`color-mix(in srgb, <couleur> N%, transparent)` accepte un hexadécimal **comme**
un jeton. Une couleur invalide y est une erreur de syntaxe, pas un silence.

**LE CONTRÔLE, ET SA RÈGLE EST PLUS LARGE QUE LE DÉFAUT — DÉLIBÉRÉMENT.**
[scripts/diag-opacite-concatenee.mjs](../scripts/diag-opacite-concatenee.mjs)
refuse le suffixe collé **même quand la variable porte un hexadécimal**, là où
il marche encore. Deux raisons, et la seconde est la vraie :
· savoir si une variable porte un jeton demanderait de suivre sa valeur à
  travers les props, les fonctions et les fichiers — la résolution que §E.42 a
  appris à ne pas croire ;
· **une forme qui marche « tant que » est une forme qui cassera.** Elle a déjà
  cassé une fois, en masse, sans un mot.

Seize occurrences encore valides ont donc été converties avec les vingt cassées.
Elles auraient cassé au lot suivant, au moment exact où leur fichier passe à la
palette. Les laisser aurait été programmer la même panne en sachant qu'elle vient.

> ⚠️ **CE QU'IL NE VÉRIFIE PAS, ET C'EST DIT** : une concaténation hors gabarit
> (`couleur + '33'`), qui n'existe pas dans ce dépôt ; et la JUSTESSE du
> pourcentage — il vérifie qu'une déclaration est valide, pas qu'elle est jolie.
> Le motif exige **exactement deux** caractères hexadécimaux : accepter un seul
> ferait mordre sur `` `${jours}j` `` et `` `${n}h` ``, et un contrôle qui crie à
> tort est désactivé le jour même (§E.14).

<a id="e51"></a>
### E.51 — UN ÉCRAN QUI SIMULE UNE ANALYSE QUI N'A PAS LIEU FINIT PAR ANNONCER UN RÉSULTAT QU'IL N'A PAS.

**Le cas, mesuré le 21/09/2026 sur les deux tableaux de bord experts.** Youssef bascule sa
disponibilité sur « à l'écoute ». L'écran affiche une roue et « Analyse de votre profil en cours…
vos missions arrivent dans quelques instants ». Deux minutes plus tard : « Aucune mission ne
correspond à votre profil pour le moment. »

**Les deux phrases étaient fausses, et la seconde est la plus coûteuse.**

| Ce que l'écran disait | Ce qui se passait |
|---|---|
| « analyse en cours » | `/api/me/sync-matching` posait une **échéance à 60 minutes** (`programmerRelance`) et rendait la main en quelques millisecondes. Rien n'avait commencé. |
| « vos missions arrivent dans quelques instants » | le pilote `expert_relance_trigger` passe toutes les 5 min, mais ne prend que les échéances **dues** : la première exécution possible était à **T+60 min**. |
| « aucune mission ne correspond à votre profil » | **un RÉSULTAT affirmé sans recherche.** Pire : le moteur était **éteint** (`ENABLE_RERANKING` et `COHERE_API_KEY` absentes) — même à T+60 min, rien ne serait sorti. |

**LA FIN DE « L'ANALYSE » ÉTAIT DÉCIDÉE PAR DEUX CHRONOMÈTRES.** `useMatchingAnalyzing` s'arrêtait à
**75 s** (« retrait silencieux », dit son propre commentaire) ; `matching-resync-hint` tenait une
fenêtre de **120 s** en `sessionStorage`. Ni l'un ni l'autre ne savait quoi que ce soit du moteur :
**ils mesuraient le temps.** Le travail, lui, était à 60 minutes. Les deux expiraient donc
**toujours** avant que rien ne se produise.

**La phrase à retenir.** *Un écran qui simule un travail finit par en affirmer le résultat. La
simulation est l'erreur ; la fausse conclusion n'en est que la conséquence.*

**Trois défauts distincts, et ils se renforcent.**
① **La réponse existait au clic et n'a pas été dite.** Profil non visible, CV non analysé,
   consentement absent, profil non approuvé : quatre refus lisibles en **une lecture de ligne**.
   L'expert attendait 60 minutes pour apprendre ce qu'on savait immédiatement.
② **Un chronomètre remplaçait un signal.** Aucune des deux minuteries ne pouvait dire si le moteur
   avait tourné, trouvé, ou refusé de partir.
③ **Une panne de configuration était présentée comme un verdict sur le profil.** Reranking éteint →
   « aucune mission ne correspond ». Le moteur écrivait pourtant sa raison — dans une note de
   journal **dont le type dit en toutes lettres qu'elle n'est jamais affichée à un utilisateur**.

**La parade est un TYPE, pas une discipline.** `IssueDeRecherche`
([lib/matching/issue-de-recherche.ts](../lib/matching/issue-de-recherche.ts)) est une union fermée :
`trouvees` · `aucune` · `ineligible` · `echec`. Il n'existe **aucune branche « on ne sait pas
encore »** qui pourrait rester affichée indéfiniment, et l'écran **refuse de compiler** sur une issue
non traitée (`assertJamais`). La route exécute le moteur **dans la requête** et rend l'issue réelle.

**Et l'issue se lit sur une VALEUR, jamais sur une phrase (§E.24).** La première version de
`issueDepuisVerdict` distinguait « moteur éteint » de « aucune mission » par une **expression
régulière sur la note de journal**. Corriger un accent dans cette phrase aurait suffi à faire
annoncer « aucune mission » sur une panne de configuration, en silence et en production. Le reranker
rend donc un `arret_code` typé, le verdict porte un `empechement` structuré, et
`Exclude<ArretDeNotation, 'aucun_document'>` interdit **à la compilation** de présenter un vivier
vide comme une panne (§E.31).

**Ce que l'attente maximale ne fait pas.** La route s'arrête à **45 s**, sous le couperet de 60 s
(§E.5), et rend `trop_long` — une issue **nommée**. Le run, lui, **n'est pas interrompu** : il est
confié à `after()`, sans quoi la réponse le tuerait. *Ce qui expire est l'attente, pas le travail*,
et la phrase affichée le dit.

**Contrôle** : [scripts/diag-issue-de-recherche.mjs](../scripts/diag-issue-de-recherche.mjs) —
**10 mutations, 10 détections**. Il vérifie que l'éligibilité est consultée **avant** le run (§E.8 :
ancré sur l'ordre, pas sur deux présences), qu'aucun minuteur ne subsiste, que « aucune mission »
passe **après** la recherche dans l'ordre de rendu, qu'aucune assertion ne lit `notes`, et que les
douze raisons ont leur phrase **dans les quatre langues**.

> **Le corollaire de supervision, et il vaut pour tout le dépôt.**
> **UN MOTEUR ÉTEINT NE PRODUIT AUCUNE ERREUR — C'EST CE QUI LE REND INVISIBLE.** Le jour de la
> mesure, `/admin/supervision` était **vert partout** : zéro panne, zéro lot en échec, zéro
> dépassement — parce que **rien n'était tenté**. Un écran qui ne surveille que les échecs ne voit
> pas l'absence de tentative. Depuis, l'interrupteur fermé et la clé absente sont **deux problèmes
> bloquants distincts**, en tête de liste
> ([lib/supervision/problemes.ts](../lib/supervision/problemes.ts)), et
> `diag-parametrage-manuel` exige que la procédure de mise en production le dise **dans un encadré**
> — pas dans une cellule de tableau. *Cette dernière précision a été trouvée par mutation* : la
> première assertion cherchait le mot « BLOQUANT » n'importe où dans le voisinage, et **attrapait la
> ligne de tableau voisine** pendant que l'encadré s'affadissait (§E.8, encore).

<a id="e52"></a>
### E.52 — UN SIGNAL BLOQUANT QU'AUCUNE ACTION NE PEUT ÉTEINDRE APPREND À ÊTRE IGNORÉ.

**Le cas, mesuré le même jour.** `/admin/supervision` affichait, en rouge et en bloquant :
« **6 annonces publiées n'ont JAMAIS été mises en relation**, depuis le 4 juin 2026 ».

**La cause n'était pas une panne — et c'est tout le sujet.** Les six ont été publiées entre le
**4 juin et le 28 juillet 2026**. La colonne `matching_attempted_at` n'existait pas : elle est créée
par `…_reprise_apres_couperet` (**1ᵉʳ septembre**), et l'écriture qui la renseigne — `marquerTentative` —
a été posée **deux jours plus tard**. Leur `matching_attempted_at` est donc `NULL` parce que
**personne ne pouvait l'écrire**, pas parce qu'un run a échoué.

> **La vue lisait une absence d'INSTRUMENTATION comme une absence de TRAVAIL.** Les deux ont la même
> forme en base — une colonne vide — et appellent des actions opposées. C'est la famille de §E.22,
> appliquée au passé : *toute colonne ajoutée après coup a un avant, et cet avant n'est pas une
> panne.*

**Et les six sont expirées depuis des mois.** Le moteur ne note que les annonces `published` **et
non expirées** : le signal réclamait donc **une action qui n'existe pas**. Un administrateur ne
pouvait ni les relancer, ni les faire disparaître — seulement apprendre à ne plus les voir.

**Ce que ça a coûté, concrètement.** Le jour de la mesure, la vraie panne — **le moteur était
éteint** — n'avait aucune place où s'afficher : six lignes rouges permanentes depuis juin occupaient
déjà la tête de l'écran. `lib/supervision/problemes.ts` portait pourtant la règle en toutes lettres
depuis sa création : *« un écran qui signale le fonctionnement normal enseigne à ignorer ses
signaux »*. Elle était écrite ; elle n'était pas **gardée**.

**La parade.** `matching_runs_inacheves` filtre désormais sur l'activité de l'annonce
(`…_inacheves_hors_annonces_expirees`), avec **l'expression exacte** de la lecture —
`coalesce(expires_at, published_at + vie_annonce_jours)` — et la durée **lue dans `duree_reglages`**,
jamais écrite en dur (§D.7). Une troisième expression aurait annoncé un compte que ni
`annonces_expirees_par_duree` ni [lib/publications/expiry.ts](../lib/publications/expiry.ts) ne
retrouveraient (§E.24).

**Aucune ligne de `publications` n'a été touchée.** Les six annonces existent, leur
`matching_attempted_at` reste `NULL`, leur histoire reste lisible. Ce qui change est ce que la
supervision **réclame** : une action possible, jamais une action impossible.

<a id="e53"></a>
### E.53 — UNE EXCEPTION OUVERTE POUR UNE PAGE DEVIENT UN ENDROIT OÙ D'AUTRES TOMBENT.

**Le cas, mesuré le 21/09/2026.** L'espace connecté compte **66 pages** et portait **cinq cadres
différents** :

| Cadre | Pages | Ce qu'il portait |
|---|---|---|
| `DashboardShell` | 38 | barre latérale + en-tête + bouton Retour |
| le layout admin, en ligne | 24 | barre latérale seule, **aucun en-tête** |
| une coquille recopiée dans `freelance/mon-profil` | 1 | en-tête maison de **58 px**, `DashboardSidebar` montée à la main — **en trois exemplaires dans le même fichier** |
| un en-tête maison dans `cdi/mon-profil` | 1 | **ni barre latérale, ni navigation, ni bouton Retour** |
| `OrganisationSidebar` | **0** | 338 lignes montées par personne |

**LE PIRE EST LE QUATRIÈME.** Une liste d'exclusion sortait `cdi/mon-profil` du cadre partagé, et sa
justification était écrite dans le layout, en toutes lettres : *« Seule /mon-profil conserve son shell
inline custom (**elle rend DashboardSidebar elle-même**) »*.

> **C'ÉTAIT FAUX, ET MESURABLE EN UN `grep`.** `DashboardSidebar` n'était importée nulle part dans
> cette page. L'expert qui ouvrait son profil n'avait plus **aucun lien** vers le reste du produit —
> seulement le bouton « précédent » du navigateur. Le commentaire avait **survécu au code qu'il
> décrivait**, et c'est lui qui défendait l'exclusion (§E.7 : un commentaire n'a jamais rendu une
> barre latérale).

**LA FORME DU DÉFAUT, ET C'EST ELLE QU'IL FAUT RETENIR.** La liste se décrivait elle-même comme
« **TEMPORAIRE** — à supprimer dès que /mon-profil est refactorisée ». Elle a tenu assez longtemps
pour que **deux pages voisines y tombent par accident** : `/profil` et `/profil/valider`, qui ne
rendaient aucun cadre, se sont affichées **nues** — le commentaire du correctif qui les en a sorties
le raconte. La liste, elle, est restée.

*Une exception ouverte pour UNE page devient un endroit où d'autres tombent, et le cadre cesse
d'être une garantie pour devenir une habitude.*

**Trois défauts plus discrets, trouvés en tirant sur le fil :**
① **Le squelette de chargement peignait une FAUSSE coquille** — faux en-tête de 58 px, fausse barre
   latérale de 248 px, tous deux en `--sk-surface`. Or la vraie barre est en `--sk-bandeau` et le vrai
   en-tête fait 60 px : à l'arrivée des données, **le cadre sautait de couleur et de deux pixels**.
② **Trois pages déjà DANS la coquille peignaient un second plein écran** (`minHeight: 100vh`). Sous
   un en-tête de 60 px, la page acquiert une barre de défilement de soixante pixels qui ne mène nulle
   part, et un état de chargement centré passe sous la ligne de flottaison.
③ **L'en-tête était blanc et la barre latérale beige.** Deux surfaces du même cadre, deux couleurs :
   `--sk-surface` nomme les **cartes**, `--sk-bandeau` nomme le **cadre**. C'est ce que le
   propriétaire du produit a vu en premier, et il avait choisi le beige.

**La parade.** Les deux listes d'exclusion sont **supprimées**, les trois coquilles recopiées aussi,
et `OrganisationSidebar` avec (**règle 0** — elle n'était retenue au dépôt que par un import de
**type**, donc invisible à toute recherche de « composant jamais utilisé », puisqu'il l'était).

**Contrôle** : [scripts/diag-coquille-unique.mjs](../scripts/diag-coquille-unique.mjs) — **7
mutations, 7 détections**. Il balaie les 66 pages et refuse : un layout qui rend `children` nus, une
page qui monte la barre latérale elle-même, une barre de la hauteur d'un en-tête, un second plein
écran, un en-tête dont le fond diffère de celui de la barre latérale, et le retour du code mort.

> ⚠️ **IL S'ANCRE SUR LE COMPORTEMENT, PAS SUR `LEGACY_SHELL_ROUTES` (§E.34).** Interdire ce nom
> serait contourné par un renommage. Ce qui est interdit, c'est **le retour sans coquille** —
> `return <>{children}</>` — et, plus en amont, qu'un layout de cadre **consulte le chemin** :
> lire `usePathname()` là n'a qu'un usage, faire une exception.

<a id="e54"></a>
### E.54 — UNE COULEUR D'ÉTAT POSÉE SUR UN ÉLÉMENT DÉCORATIF DIT QUELQUE CHOSE. ELLE MENT.

**Le cas, mesuré le même jour.** Les **quatre** pages de profil expert numérotaient leurs sections
avec une pastille colorée, et chacune portait **sa propre table de couleurs**, sous trois noms
différents (`SECTION_PALETTE`, `SECTION_COLORS`, `SECTION_COLORS`) :

| Écran | Ce que peignaient les couleurs d'état |
|---|---|
| `freelance/mon-profil` | « Missions » en **ROUGE**, « Langues » en **AMBRE**, « Disponibilité » en **VERT** |
| `cdi/mon-profil` | deux **VERTS**, un **AMBRE**, un **ROUGE** sur douze sections |
| `freelance/profil/valider` | « Coordonnées » en **AMBRE**, « Missions » en **ROUGE** |
| `cdi/profil/valider` | trois **AMBRE**, un **VERT**, un **ROUGE** |

**§D.12 réserve ces trois couleurs à un ÉTAT** — *« les rendre réglables inviterait à peindre une
erreur en vert »*. Un formulaire dont la section 5 est rouge dit à celui qui le remplit qu'il s'y est
trompé. **Elle ne disait rien du tout : le rouge y était décoratif.**

Et ce n'était pas seulement le numéro : la même table peignait **des pastilles de frise, des puces de
liste et des étiquettes** — quatorze usages sur la seule page freelance.

**Ce que la première tentative de correctif a raté, et ce que ça enseigne.** Le script supprimait les
tables, en supposant qu'elles ne servaient qu'aux en-têtes. `tsc` a répondu en une seconde
(« Cannot find name 'SECTION_PALETTE' ») et a trouvé au passage un `action` que le composant partagé
n'avait pas. *Une supposition sur l'usage d'un symbole se vérifie en comptant ses lecteurs, pas en
lisant son nom.*

**La parade n'est pas une consigne, c'est l'ABSENCE DU CHAMP.** Il existe désormais **un** composant
([components/dashboard/SectionHeader.tsx](../components/dashboard/SectionHeader.tsx)) pour les quatre
écrans, et **il n'accepte pas de couleur**. Les quatre tables ont disparu avec : une table qui rend
toujours la même valeur n'est plus une table, c'est une **invitation** — elle a exactement la forme
qu'il faut pour qu'on y remette du vert, et c'est comme ça qu'il y est arrivé (§E.31).

> **CE QUI RESTE LÉGITIME, ET QUI EST DIT PLUTÔT QUE BALAYÉ (§E.38).** Le statut de marché d'un
> expert CDI — « en poste » en rouge, « en recherche » en vert — **est** un état : ses couleurs sont
> justes, et la pastille a été **déplacée**, pas supprimée, quand l'en-tête maison qui la portait a
> disparu. Aucun motif ne distingue une couleur d'état d'une couleur décorative : cette moitié-là se
> lit écran par écran, exactement comme la règle `--sk-faint` de §D.12.


> ## ⛔ CE QUI S'EST PASSÉ, EXACTEMENT — ET C'EST LE LOT PRÉCÉDENT QUI A FABRIQUÉ LE DÉFAUT
>
> J'avais rapporté que les numéros de section étaient « ramenés à la couleur de marque ». Ils ne
> l'étaient pas, et la mesure dit pourquoi.
>
> **AVANT le lot palette**, `cdi/mon-profil` numérotait ses douze sections avec **douze teintes
> arbitraires** — un arc-en-ciel :
>
> ```
> #6366f1  #a855f7  #10b981  #f59e0b  #ec4899  #06b6d4
> #14b8a6  #f43f5e  #3b82f6  #84cc16  #0ea5e9  #d946ef
> ```
>
> **APRÈS**, chacune avait pris **le jeton le plus proche par teinte** :
>
> | Avant | Après | Ce que ça voulait dire avant | Ce que ça dit après |
> |---|---|---|---|
> | `#10b981` émeraude | `var(--sk-success)` | « une des douze couleurs » | **SUCCÈS** |
> | `#f59e0b` ambre | `var(--sk-amber)` | idem | **AVERTISSEMENT** |
> | `#f43f5e` rose | `var(--sk-red)` | idem | **ERREUR** |
> | `#84cc16` lime | `var(--sk-success)` | idem | **SUCCÈS** |
>
> **LA MIGRATION A CONVERTI LA SYNTAXE ET HÉRITÉ D'UNE SÉMANTIQUE QUI N'EXISTAIT PAS AVANT ELLE.**
> Un rose n'affirmait rien ; `var(--sk-red)` affirme une erreur. Le défaut n'a pas *survécu* au lot
> palette : **il a été créé par lui**.
>
> **Et le cliquet était vert, à juste titre.** Sa propriété est « aucune couleur littérale dans un
> composant », et elle était vraie — parfaitement vraie. Il ne pouvait pas voir le reste : il l'écrit
> d'ailleurs lui-même, dans sa propre section « ce que ce contrôle ne vérifie pas » —
> *« que le jeton choisi soit le BON. `var(--sk-red)` sur un état de succès est vert ici et faux à
> l'écran : aucun motif ne lit un rôle. »*
>
> **CE QUE J'AI VÉRIFIÉ, C'EST LE CONTRÔLE — PAS L'ÉCRAN.** J'ai lu un vert et j'ai rapporté un
> résultat. C'est la même faute que §E.7 commet avec un commentaire, un cran plus haut : un contrôle
> qui dit vrai sur ce qu'il mesure ne dit rien sur ce qu'il ne mesure pas, et **son vert se cite
> comme s'il disait tout**.
>
> **La règle qui en sort, et elle vaut au-delà des couleurs :**
> *Une migration automatique qui remplace une valeur par un NOM lui donne un SENS. Si les valeurs de
> départ n'avaient pas de sens, le nom en invente un — et personne ne l'a décidé.*

<a id="e55"></a>
### E.55 — DEUX PHRASES VRAIES, L'UNE SOUS L'AUTRE, PEUVENT SE LIRE COMME UNE CONTRADICTION.

**Le cas, vu par le propriétaire du produit sur son propre tableau de bord, le 21/09/2026.** Quatre
défauts, tous de la même famille : **rien n'est faux, et l'écran ment quand même.**

**① Un profil complet à qui on demande de se compléter.**
> « Profil complété à **100 %** »  ·  « **Compléter →** »
> « Un profil complet génère 5x plus de propositions de missions. »

Les trois textes sont écrits pour un profil **inachevé** et s'affichent sur un profil **achevé**. Le
bouton demande de faire ce qui est fait ; la phrase vante un état qu'on a déjà atteint. L'expert en
conclut que le 100 % est faux — c'est la seule lecture cohérente qui lui reste.

**② « Votre profil n'est plus visible » · ● Profil vérifié.**
Le bandeau en tête d'écran, la pastille verte juste en dessous. **Les deux sont vraies.** La
vérification dit qu'un administrateur a approuvé le dossier ; la visibilité dit que de **nouveaux
champs** sont devenus nécessaires depuis, et que le profil est masqué en attendant.

> **Côte à côte, l'expert conclut que l'un des deux ment, et il n'a aucun moyen de savoir lequel.**
> C'est ce qui distingue cette famille de §E.24 : là-bas, un chiffre juste porte une étiquette
> fausse ; ici, **deux énoncés exacts se détruisent par voisinage**.

**③ Deux multiplicateurs, pour la même promesse.** « **5x** plus de propositions » côté freelance,
« **3×** plus de recruteurs » côté CDI. Aucune mesure derrière, ni d'un côté ni de l'autre — rien
dans le dépôt ne les soutient. La règle de maintenance l'écrit pour la mémoire : *une affirmation non
vérifiable ne s'écrit pas.* Elle vaut **à plus forte raison face à l'utilisateur**, qui ne peut rien
vérifier du tout. L'incitation reste, le chiffre part.

**④ « Score IA 7/10 » sur une annonce de sous-traitance.** Le nombre est **juste** : c'est la note de
qualité du **texte de l'annonce**, produite à sa publication. L'étiquette ne dit pas ce qu'elle note —
et sur l'écran d'un **expert**, « Score IA » se lit comme une note portée **sur lui**, c'est-à-dire
exactement ce que §D.6 interdit. §D.9 tranche le mot : c'est une **NOTE**, elle juge un dossier, et
son libellé doit dire lequel. Elle s'appelle désormais « Qualité de l'annonce ».

**Ce que les quatre ont en commun, et c'est la phrase à retenir.**
> *Un écran ne se relit pas énoncé par énoncé : il se lit d'un coup d'œil. Deux vérités qui se
> touchent forment une troisième affirmation, que personne n'a écrite et que personne ne relit.*

**Les parades.**
① Le pourcentage **choisit** le texte — trois clés séparées, branchées sur `>= 100`.
② La pastille reçoit un drapeau `masque` et prend alors les couleurs de l'**attente**, avec son
propre libellé (« Vérifié · profil masqué »). **`masque` est un argument, pas un sixième état** :
ajouter `approved_hidden` à `VerificationUiState` aurait changé le sens de tous les `=== 'approved'`
du dépôt — barre latérale, verrous de section, garde du flux — et un profil vérifié serait devenu
« non vérifié » pour du code qui n'a rien demandé.
③ Le chiffre disparaît des quatre langues ; le contrôle refuse tout `N× plus`.
④ Le libellé nomme son objet, et l'explication dit en toutes lettres qu'elle **ne juge aucun expert**.

> ⚠️ **`=== false`, JAMAIS `!visible` (§E.22).** Une lecture en panne rend `null`, et `!null` vaut
> `true` : on annoncerait « profil masqué » à quelqu'un dont on n'a simplement pas pu lire l'état.
> **Le doute ne se peint pas en avertissement.**

**Contrôle** : [scripts/diag-ecran-qui-se-contredit.mjs](../scripts/diag-ecran-qui-se-contredit.mjs)
— **7 mutations, 7 détections**. Il lit le **branchement**, pas la présence de la clé : une clé
déclarée et jamais lue ne change rien à l'écran (§E.8).

> **ET IL DIT CE QU'IL NE PEUT PAS FAIRE.** Il ne relit pas les phrases : **aucune machine ne dira
> qu'un texte en contredit un autre.** Les quatre cas ont été trouvés par un humain devant son écran,
> et c'est la seule façon. Ce qui est gardé, c'est la **mécanique** qui les a fermés — que les deux
> voies la partagent, et qu'elle ne disparaisse pas au prochain lot (§E.38).

<a id="e56"></a>
### E.56 — UN LOT QUI CONVERTIT UNE SYNTAXE HÉRITE D'UNE SÉMANTIQUE QUI N'EXISTAIT PAS AVANT LUI.

**La phrase à retenir, et elle est de moi, le 21/09/2026 :**
> **« J'avais vérifié le contrôle, pas l'écran. »**

**Le cas.** Le lot palette a remplacé 3180 littéraux de couleur par des jetons `--sk-*`, en mappant
chaque teinte vers **le jeton le plus proche PAR COULEUR**
([scripts/lib/correspondance-couleurs.mjs](../scripts/lib/correspondance-couleurs.mjs)). L'émeraude
est devenue `--sk-success`, l'ambre `--sk-amber`, le rose `--sk-red`.

Sur les numéros de section des quatre pages de profil expert, ces teintes étaient **décoratives** :
`#10B981` y était une couleur parmi 184, et ne disait rien. Après la conversion, le même pixel
s'appelle `--sk-success` — **et §D.12 réserve ce jeton à un ÉTAT**. L'écran n'a pas changé de
couleur : **il a changé de SENS**, et une section de formulaire s'est mise à dire « c'est bon » à
qui la remplissait (le symptôme est détaillé en [§E.54](#e54)).

**LE DÉFAUT N'A PAS SURVÉCU AU LOT : IL A ÉTÉ CRÉÉ PAR LUI**, dans le commit même qui rendait le
cliquet vert.

**Et le cliquet était vert À JUSTE TITRE.** Sa propriété est *« aucune couleur littérale »*, et il
n'en restait aucune. Il n'a rien manqué — **on ne lui avait jamais demandé ça.** Un jeton se lit
dans le source ; le **rôle de l'élément qui le porte** ne s'y lit pas.

| Ce qu'un contrôle voit | Ce qu'il ne verra jamais |
|---|---|
| la teinte a disparu, le jeton est là | que ce jeton **signifie** quelque chose ici |
| le jeton existe dans la palette | que l'élément qui le porte est **décoratif** |

**La parade n'est pas un contrôle de plus.** Pour ce cas précis, c'est l'**absence du champ** — un
composant partagé qui n'accepte pas de couleur ([§E.54](#e54), [§E.31](#e31)). Pour la **classe**,
c'est une règle de méthode, et elle a un coût assumé :

> **UNE CONVERSION DE MASSE QUI MAPPE PAR APPARENCE NE TRANSPORTE AUCUN SENS — DONC ELLE EN INVENTE
> UN. La liste des écrans touchés se relit, écran par écran, APRÈS la conversion.** Le dictionnaire
> de correspondance dit lesquels de ses jetons cibles **portent une signification** : les trois
> couleurs d'état (`--sk-success`, `--sk-amber`, `--sk-red`) en portent une, les huit rôles de
> marque n'en portent aucune. Une teinte qui atterrit sur l'un des trois se lit à l'écran avant
> d'être déclarée faite.

**Ce que ça distingue des voisins.** [§E.7](#e7) : un contrôle lit un commentaire au lieu de la
règle. [§E.34](#e34) : il s'ancre sur un nom. [§E.40](#e40) : il mesure une proximité au lieu d'une
appartenance. **Ici, le contrôle est juste, sa propriété est la bonne, et il est vert pour de bonnes
raisons** — c'est l'écran qui a changé de sens sous lui. Aucune relecture du contrôle ne l'aurait
montré ; il fallait **ouvrir la page**.

> **Et c'est la deuxième fois dans le même lot.** Le bandeau « votre profil n'est plus visible »
> ([§E.55](#e55) ②) a été déclaré livré alors qu'il n'avait jamais été touché. Les deux fois, ce que
> j'avais vérifié était **vrai** ; les deux fois, **ce n'était pas la question**. La règle qui en
> sort tient en une ligne, et elle est du propriétaire du produit :
> *un point oublié qui se dit vaut mieux qu'un « tout est livré » qu'on découvre faux sur l'écran.*


<a id="e57"></a>
### E.57 — L'OUTIL QUI LANCE LES CONTRÔLES N'AVAIT JAMAIS TOURNÉ. 219 COMMITS.

**Le cas, mesuré le 22/09/2026.** `scripts/diag.mjs` — le lanceur de toute la série — s'arrêtait sur
un `ReferenceError` **à chaque lancement, depuis le commit qui l'a créé le 07/09/2026**. Le drapeau
s'était appelé `--avec-base` avant d'être renommé `--avec-ecritures` ; le renommage avait laissé un
`avecBase` dans le message d'état, **deux lignes avant la première exécution**. `git log -S` le
confirme : `const avecBase` n'a **jamais** existé dans aucun commit.

**Ce que ça coûte, et ce n'est pas le plantage.** Un plantage se voit. Ce qui ne se voit pas, c'est
qu'**une validation annoncée n'a pas eu lieu** : on rapporte « la série complète est verte » sur la
foi d'un résumé, et le résumé vient d'ailleurs — d'une boucle écrite à la main, d'un souvenir, d'un
lot précédent. Le nombre était d'ailleurs **juste** ici (84 verts, retrouvés à l'identique par le
lanceur réparé) : **un chiffre juste obtenu par un chemin qu'on ne peut pas refaire n'est pas une
mesure, c'est une coïncidence vérifiée après coup.**

**Et les deux autres défauts du même fichier disent quelque chose de plus gênant.**

| Ce que le fichier DIT de lui-même, dans son en-tête | Ce que son code faisait |
|---|---|
| *« TROIS ÉTATS, et jamais deux : VERT / ROUGE / N'A PAS TOURNÉ »* | tout code de sortie non nul → **ROUGE**. Le **2** — *« n'a pas tourné »*, la convention du dépôt, celle par laquelle `garde-ecriture.mjs` **refuse** — était rangé dans les rouges. Un refus prudent s'affichait en régression. |
| *« La liste est donc explicite, courte, et relue »* (les scripts qui écrivent en base) | elle en nommait **deux** ; il y en a **trois**. `diag-lot3-messagerie` manquait — celui qui **SUPPRIME** les messages d'une conversation. |

> **Les deux moitiés du défaut s'emboîtent, et c'est ça qui le rendait invisible.** La liste
> incomplète laissait `diag-lot3-messagerie` être lancé ; la garde le refusait proprement, en
> sortant en **2** ; le lanceur peignait ce 2 en **ROUGE**. On lisait donc « 1 rouge » sur un
> contrôle qui s'était **protégé exactement comme prévu**.

**La parade — dériver l'appartenance, et pas la recopier (§E.34).** La propriété n'est pas un nom :
c'est que le script **APPELLE** `garde-ecriture.mjs`. Le motif existait déjà, éprouvé, dans
`diag-scripts-destructeurs` — on ne réécrit pas une seconde détection à côté de la première
(§E.20). La table de noms ne décide plus de rien : elle ne porte plus que la **raison**, en clair,
et une entrée sans raison **le dit** au lieu d'en inventer une (§G.8).

> ⚠️ **ET LA PREMIÈRE VERSION DE CETTE DÉRIVATION A ÉCARTÉ UN VRAI CONTRÔLE.**
> `diag-scripts-destructeurs` **porte** ce motif — c'est lui qui détecte les scripts gardés, le
> motif y est une **donnée**. Sans retirer les commentaires, et sans distinguer le motif **échappé**
> (`'\.\/garde…'`) de l'appel **littéral** (`'./garde…'`), il sortait du balayage : **un contrôle
> muet, présenté comme « écarté par prudence »**. C'est [§E.7](#e7) — dans le fichier même dont
> l'en-tête prévient que *« trois scripts en contiennent le texte sans jamais l'exécuter »*.
> Le `sansCommentaires` nécessaire **existait déjà** dans ce fichier, écrit pour ce piège exact et
> **jamais appelé** : lint le disait depuis le premier jour, *« assigned a value but never used »*.

**La règle.**
> **UN OUTIL DE VÉRIFICATION SE VÉRIFIE D'ABORD LUI-MÊME. Ce qu'il exige des autres — trois états,
> un inventaire complet, une propriété plutôt qu'un nom — vaut pour lui, et c'est chez lui que
> personne ne regarde, parce qu'on lit ce qu'il affiche au lieu de ce qu'il fait.**


<a id="e58"></a>
### E.58 — UN CACHE CLÉ SUR L'IDENTITÉ SERT UNE VALEUR CALCULÉE SUR UN CONTENU QUI N'EXISTE PLUS.

**Le cas, mesuré le 22/09/2026.** `matching_notes_partielles` — le brouillon qui évite de repayer la
notation d'un run interrompu — était indexé par `(publication_id, profile_id)`, plus le modèle en
colonne. **Trois identités, aucun contenu.**

Un expert modifiait son profil ; le moteur repartait ; `notesDejaAcquisesPourAnnonces` retrouvait
« sa » note et ne la repayait pas. **C'était la note du profil d'AVANT.** Aucune exception, aucun
journal, aucune ligne rouge : la note servie était simplement fausse, jusqu'à la purge — **24 heures**.

> **ET LE MÊME TROU EXISTAIT DU CÔTÉ ANNONCE, PAR UN CHEMIN PLUS COURT QU'IL N'Y PARAÎT.** Le run
> d'une annonce **solde** son brouillon quand il s'achève — donc, seul, il ne laissait rien traîner.
> Mais le brouillon **sert les deux sens**, et c'est écrit et voulu : *« une note acquise ici épargne
> aussi le run de l'annonce correspondante. »* Une note périmée écrite par le sens expert était donc
> **servie au sens annonce**. Deux mécanismes sains séparément ; le défaut naît de leur **partage**.

**Ce que la mesure a corrigé dans le raisonnement, et c'est la partie instructive.** Le module de
relance justifiait son report d'une heure par le **coût** — *« dix runs coûtent dix fois »*. Mesuré,
c'était **faux** : la reprise par identité rendait un second run presque **gratuit**, puisqu'il
réutilisait tout. **La raison affichée était fausse ; la vraie raison était la JUSTESSE** — attendre
l'état final était la seule façon de ne pas noter un profil périmé.

Et le report ne fermait même pas cette fenêtre : **il la rétrécissait**. Une modification à
T+61 minutes relançait un run qui reprenait la note écrite à T+60.

**La décision — arbitrée par Youssef le 22/09/2026, entre deux sorties qui n'ont pas la même nature.**

| Sortie | Ce qu'elle vaut |
|---|---|
| **Solder le brouillon** en fin de run | une **DISCIPLINE** : elle dépend de la fin du run. Un run qui meurt à mi-chemin laisse des notes périmées derrière lui — exactement le cas où le brouillon sert. |
| **Cléer sur le CONTENU** | **JUSTE PAR CONSTRUCTION** : un profil modifié a une autre empreinte, donc d'autres notes ; un profil inchangé réutilise les siennes. Rien à attendre, aucun ordre à respecter. |

> **UNE GARDE QUI EST UNE CLÉ NE DÉPEND D'AUCUNE DISCIPLINE ([§E.31](#e31)).** C'est la seconde qui
> a été retenue, et la colonne est `not null` **sans défaut** : une ligne sans empreinte n'est pas
> déconseillée, elle est **impossible**.

**Le piège dans la parade, et il coûtait de l'argent.** L'empreinte porte le couple *(texte annonce,
texte profil)* — mais les deux sens n'appellent pas le reranker dans le même ordre : l'un interroge
avec l'annonce, l'autre avec le profil. **Hacher dans l'ordre de l'APPEL** aurait donné deux
empreintes différentes pour le même couple de textes, et **supprimé le partage entre les deux sens** —
une régression de coût décidée par accident, en écrivant un correctif de justesse. L'ordre est donc
**canonique**, annonce d'abord, quel que soit l'appelant.

> ⚠️ **CE QUE CE PARTAGE SUPPOSE, ET QUI N'EST TOUJOURS PAS VÉRIFIÉ.** Il suppose que la note de
> *(requête = annonce, document = profil)* vaut celle de *(requête = profil, document = annonce)*.
> **Un reranker ne le garantit pas.** Cette supposition **préexiste** à l'empreinte — elle est écrite
> en toutes lettres dans `run-for-expert.ts` — et le correctif la **conserve à l'identique** plutôt
> que de la trancher au passage. Elle est **nommée pour être arbitrable**, pas corrigée en douce
> (§E.38).

**Le délai a changé de raison, donc de valeur.** Il ne porte plus la justesse : il ne garde que
l'anti-rafale. Et cette raison-là, **fausse quand elle était écrite, est devenue vraie** le jour où
la clé a porté le contenu — dix modifications font désormais dix empreintes neuves, donc dix runs
réellement payants. **60 minutes → 10 minutes** : les cinquante autres payaient la justesse, que la
clé donne gratuitement, et coûtaient à l'expert une heure d'invisibilité.

**Contrôle** : [scripts/diag-empreinte-des-notes.mjs](../scripts/diag-empreinte-des-notes.mjs) —
il **exécute** `empreinteDeNote` (module pur, §E.33) et vérifie sur la vraie fonction qu'un texte
modifié change l'empreinte, qu'un texte identique la conserve, et que **les deux sens produisent la
même**. Il vérifie ensuite que **chaque lecture** du brouillon compare l'empreinte et que **chaque
écriture** en fournit une — ancré sur la propriété, jamais sur un nom de fonction (§E.34).

> **CE QU'IL NE VÉRIFIE PAS, ET IL LE DIT.** Il ne prouve pas que le texte haché soit **celui** qui
> part au reranker : il vérifie que c'est la **même expression**, dans la même portée. Une refonte
> qui recalculerait le texte autrement entre les deux lignes passerait — et c'est le seul endroit où
> la justesse redeviendrait une discipline.


<a id="e59"></a>
### E.59 — UN CORRECTIF DE JUSTESSE QUI CHANGE SILENCIEUSEMENT UN COÛT.

**Le cas, évité de justesse le 22/09/2026, en écrivant la parade de [§E.58](#e58).**

Il fallait cléer les notes du brouillon sur le **contenu** des textes. Le geste naturel — celui
qu'on écrit sans y penser — est de hacher les arguments **dans l'ordre où on les a sous la main** :

```
sens annonce → experts :  empreinte(requete, document)   // requête = annonce, document = profil
sens expert → annonces :  empreinte(requete, document)   // requête = PROFIL, document = ANNONCE
```

Deux lignes identiques, dans deux fichiers, **et deux empreintes différentes pour le même couple de
textes** — parce que les deux sens interrogent le reranker à l'envers l'un de l'autre.

**Ce que cela aurait fait, et ce que cela n'aurait PAS fait.** Le brouillon **sert les deux sens**,
délibérément : une note acquise par le run d'un expert épargne celui de l'annonce correspondante.
Des empreintes divergentes auraient **supprimé ce partage** — chaque sens repayant ce que l'autre
venait de payer.

| Ce qui aurait été **juste** | Ce qui aurait **changé, sans rien dire** |
|---|---|
| plus aucune note périmée, des deux côtés | la facture du reranker, **à la hausse** |
| `tsc` vert, `next build` vert | aucun type, aucune assertion, aucun écran ne bouge |
| le contrôle de §E.58 **vert** — il mesure la justesse | rien ne mesure un coût |

**LA CLASSE, ET ELLE EST PLUS LARGE QUE LES COULEURS OU LES CACHES.**
> **Un correctif qui vise une propriété qui LÈVE (la justesse, un type, un statut) peut déplacer une
> propriété qui NE LÈVE PAS — l'argent, la latence, la charge, le nombre d'appels sortants. Les
> secondes n'ont pas de compilateur : rien ne les vérifie, et leur dégradation n'apparaît que sur une
> facture, un mois plus tard, sans rien pour la relier au commit qui l'a causée.**

**Ce qui l'a attrapé, et ce n'était pas un contrôle.** C'était de **relire le commentaire qui
décrivait le partage** avant de toucher à la clé — six lignes dans `run-for-expert.ts` qui disent en
toutes lettres *« il sert donc les deux directions sans distinction »*. Sans elles, l'ordre de
l'appel passait sans que personne s'en aperçoive.

**La parade, en deux temps.**
① **Avant de changer la clé d'un partage, on nomme ce qui est partagé et avec qui.** Un cache, une
mémoïsation, une déduplication, un réessai : tous partagent quelque chose avec quelqu'un, et la clé
est le contrat de ce partage. La changer sans lire le contrat, c'est le réécrire à l'aveugle.
② **L'ordre devient CANONIQUE, et un contrôle le tient.** L'empreinte se calcule toujours dans
l'ordre *(annonce, profil)*, quel que soit l'appelant ; [`diag-empreinte-des-notes`](../scripts/diag-empreinte-des-notes.mjs)
vérifie **les deux appelants nommément**, et sa mutation ⑧ — remplacer l'ordre canonique par celui
de l'appel — le fait rougir.

> **ET CE QUI RESTE OUVERT EST ÉCRIT LÀ OÙ ON LE RELIRA.** Le partage entre les deux sens suppose que
> la note est **symétrique**. La supposition **préexiste** au correctif, qui l'a conservée à
> l'identique plutôt que de la trancher au passage — mais elle n'a **jamais été mesurée**, et aucun
> diagnostic ne le peut : il faut une base jetable et une clé Cohere. Elle est donc portée en tête de
> [scripts/recette-3-3.mjs](../scripts/recette-3-3.mjs), avec **ce qui décide** : que l'écart change
> un **classement**, pas qu'il soit non nul. Décision de Youssef : *pas avant d'avoir le chiffre.*


<a id="e60"></a>
### E.60 — `IF NOT EXISTS` SUR UN NOM D'INDEX DÉJÀ PRIS : UNE CRÉATION SAUTÉE EN SILENCE.

**UN NOM D'INDEX EST UNIQUE PAR SCHÉMA, PAS PAR TABLE.** Deux tables ne peuvent pas porter deux index
du même nom. Avec `if not exists`, Postgres ne le signale pas : **il ne crée rien, et il ne dit rien.**

**Le cas, trouvé par le propriétaire du produit dans la sortie de `db push`, le 22/09/2026, puis
confirmé par une lecture de la base.**

`20260922000010_catalogue_stripe_par_mode` créait trois index uniques sur la table neuve
`packages_stripe`. Les trois noms — `idx_packages_stripe_product`, `…_price_monthly`,
`…_price_yearly` — **appartenaient déjà** aux index posés sur `packages.stripe_*` par
`20260910300000`. Puis, **quelques lignes plus bas dans la même migration**, le `drop column` des
anciennes colonnes a emporté les anciens index.

| Ce que la migration annonçait | Ce que la base contient |
|---|---|
| trois index **uniques** sur `packages_stripe` | **aucun** — seule la clé primaire |
| trois garanties | zéro |
| « migration réussie » | une ligne `already exists, skipping` dans la sortie |

> **LES GARANTIES ONT DISPARU ENTRE DEUX INSTRUCTIONS DE LA MÊME MIGRATION.** Et ça se reproduit à
> l'identique sur **toute base vierge, production comprise** : ce n'est pas un accident d'un
> environnement.

**Deux sur trois étaient des GARDES, pas des index de performance — et la mémoire le disait déjà.**
[§F](architecture.md) nomme `idx_packages_stripe_price_monthly` comme la garantie contre *« deux
offres pour un même `price` Stripe : le webhook tirerait au sort des droits payés »*. Sans elle,
`resolvePackageByPrice` peut trouver deux lignes : il refuse proprement, mais **un abonnement réel
devient irrésolvable, et l'argent est déjà encaissé**. Le troisième (le produit) garde un état qu'on
ne saurait plus démêler : deux offres sur un même `Product` rendent le catalogue Stripe illisible.

**CE QUI AURAIT DÛ LE VOIR EXISTAIT DÉJÀ, DANS LE FICHIER VOISIN.** `20260910300000` se termine par
*« VÉRIFICATION FINALE — la migration se contrôle elle-même »*, qui vérifie la présence de ces index.
Je ne l'ai pas repris.

> ⚠️ **ET REPRIS TEL QUEL, IL N'AURAIT PAS SUFFI.** Il interroge `pg_class where relname = '…'`
> **sans dire sur quelle table**. Il aurait trouvé l'index de `packages` — encore vivant à cet
> instant — et conclu que tout allait bien. Une postcondition doit vérifier **le nom, la table, et
> l'unicité** : un index non unique ne garde rien.

**Les trois parades, et la première est la plus importante.**
① **Pas de `if not exists` sur une création qu'on veut garantie.** C'est lui qui transforme une
collision en silence. Ce qu'on perd — la migration n'est plus rejouable telle quelle — ne coûte
rien : une migration passe **une** fois, et `schema_migrations` le garantit.
② **Des noms qui n'appartiennent qu'à elle.** Préfixe `uq_` quand c'est une garantie d'unicité : le
nom dit alors ce qu'il est, et pas seulement ce qu'il indexe.
③ **La migration vérifie ce qu'elle a créé**, et lève sinon.

> **C'EST LA TROISIÈME QUI AURAIT SUFFI — À UNE CONDITION.** Le motif existait déjà dans le fichier
> voisin, et il n'aurait **rien vu** : il interroge `pg_class where relname = '…'`, c'est-à-dire
> « ce nom existe-t-il **quelque part** ». Il aurait trouvé l'index de `packages`, encore vivant à
> cet instant, et conclu que tout allait bien.
>
> **Une postcondition d'index vérifie TROIS choses, et la deuxième est celle qu'on oublie :**
> · le **nom** existe ; · il porte sur **la bonne table** ; · il a la **bonne forme** — unique quand
> c'est une garde, les bonnes colonnes **dans le bon ordre** quand c'est une lecture.
>
> Vérifier le nom seul, c'est vérifier qu'une chaîne de caractères est prise dans le schéma. Ça ne
> dit rien de ce qu'on voulait poser.

> ⚠️ **LE PIÈGE DERRIÈRE LE PIÈGE : ON NE FAIT PAS `drop index if exists` AVANT.**
>
> Le réflexe, quand on découvre qu'un nom est pris, est de le libérer : `drop index if exists <nom>`
> puis `create index <nom>`. **C'est la même faute, retournée, et elle est pire.**
>
> Le nom étant unique **par schéma**, ce `drop` ne vise pas « l'index de ma table qui porte ce nom » :
> il vise **le seul index du schéma qui porte ce nom**, quelle que soit sa table. Sur un nom
> appartenant à une autre table, il **supprime l'index de cette autre table**, silencieusement, et
> `if exists` garantit qu'aucune erreur ne sera levée.
>
> **Et c'est sans retour.** Une création sautée laisse une garantie absente, qu'une lecture de la base
> retrouve. Une suppression réussie sur la mauvaise table ne laisse **rien** : ni trace, ni message —
> on s'en aperçoit le jour où une lecture devient lente, ou le jour où une unicité qu'on croyait
> acquise ne tient plus.
>
> **La règle : on ne libère jamais un nom. On en prend un autre.** Et si une suppression est vraiment
> nécessaire — c'est le cas de la seconde occurrence ci-dessous — elle **vérifie la table du nom
> avant d'agir**, et **lève** si ce n'est pas la sienne.

**Contrôle** : [scripts/diag-index-sautes.mjs](../scripts/diag-index-sautes.mjs) — **5 mutations,
5 détections**, dont le cas réel. Il **rejoue l'historique des migrations dans l'ordre**, tient le
registre des index vivants, et refuse toute création `if not exists` sur un nom déjà vivant. Il
connaît les suppressions **explicites** (`drop index`) **et implicites** (`drop column`, `drop
table`) — c'est par la seconde que ce cas est passé, sans que le mot « index » apparaisse nulle part.

> **IL A TROUVÉ UNE SECONDE OCCURRENCE À SA PREMIÈRE EXÉCUTION — RÉPARÉE LE JOUR MÊME.**
> `20260919000010_suivi_consommation` recréait `ai_spend_action_mois_idx`, nom pris depuis
> `20260916110000`, **sur la même table, avec les colonnes dans l'ordre inverse** —
> `(created_at, action)` contre `(action, created_at)`. La création a été sautée : l'index annoncé
> pour « la lecture par mois » n'existait pas, c'est l'ancien, taillé pour un autre tri, qui servait.
> **Aucune garantie n'était perdue** — un index de performance, pas une garde.
>
> **RÉPARÉ MAINTENANT PARCE QUE C'EST MAINTENANT QUE C'EST GRATUIT.** `ai_spend_events` ne contient
> **aucune ligne** : le verrou dure zéro seconde. Dans six mois, sur une table de journal pleine, le
> même geste devient un arbitrage — combien de temps accepte-t-on de bloquer les écritures. Décision
> de Youssef : *le seul moment où fermer ce trou est gratuit, c'est maintenant.*
>
> **L'ancien index est parti**, et la question a été tranchée par une mesure, pas par prudence : les
> **quatre** lecteurs de la table ont été relus, **aucun ne filtre sur `action`** — le troisième la
> *groupe*, ce qui n'est pas la même chose, son prédicat sélectif étant la fenêtre de temps. Et
> aucun code applicatif ne lit cette table : `revoke all` + `grant to service_role`, et
> `lib/ai-budget.ts` n'y fait qu'un `insert`. **L'inventaire des lecteurs est complet, pas
> échantillonné.**

> **ET LE CONTRÔLE N'A PLUS DE GEL — ce qui vaut mieux qu'un gel vide.** Il en a porté un, avec ses
> raisons (§G.8). Mais un gel tolère une ligne **parce qu'elle est écrite dans une liste**, et il
> faut penser à l'en retirer quand elle est réparée. La propriété qui compte n'est pas « ce nom a
> déjà servi » : c'est **qu'aucun index annoncé ne manque**. Une création sautée est donc un défaut
> **sauf si** une migration ultérieure crée le même index — même table, **mêmes colonnes dans le même
> ordre** — pour de bon, sans `if not exists`. Le gel se vide alors **de lui-même**, et une collision
> neuve et non réparée rougit sans qu'on ait rien à inscrire.

**ET C'EST [§E.56](#e56) POUR LA DEUXIÈME FOIS — « J'avais vérifié le contrôle, pas l'écran. »**

Mon propre contrôle affirmait l'unicité par mode. Il cherchait
`create unique index … (mode, price_id_monthly)` **dans le texte de la migration qui l'annonçait**,
et il le trouvait : l'instruction y est bien écrite. Elle n'a simplement **rien créé**.

> **Le contrôle était vert et la base était nue.** La première fois, j'avais vérifié le contrôle et
> pas l'écran ; ici, j'ai vérifié **le texte** et pas **la base**. C'est la même faute avec un autre
> substitut : on mesure la chose la plus proche, celle qu'un fichier donne tout de suite, et on la
> prend pour la chose elle-même.
>
> **Ce qui distingue une assertion utile d'une assertion rassurante : peut-elle être vraie pendant
> que le produit est faux ?** Ici, oui — et rien dans le contrôle ne le disait.

**Et la leçon qui déborde les index.**
> **Une migration qui « réussit » n'a rien prouvé. `db push` rapporte ce qu'il a ENVOYÉ, pas ce que
> la base a RETENU — et un état de la base vient d'une LECTURE.** Le même jour, j'ai écrit que
> quatre migrations étaient « toutes en attente, aucune appliquée » : je ne l'avais pas lu, l'une
> d'elles était déjà passée. C'est [§E.12](#e12) pour les données, et c'est vrai du schéma aussi.


<a id="e61"></a>
### E.61 — UN CONTRÔLE DONT LA COUVERTURE EST UNE LISTE TENUE À LA MAIN NE PROTÈGE QUE CE QU'ON A PENSÉ À LUI DONNER.

**Le cas, mesuré le 22/09/2026.** `GET /api/me/missions/[id]` sélectionnait `matches.score`,
colonne **supprimée le 1ᵉʳ septembre** par `score_de_pertinence`. La base répondait
`column matches.score does not exist` ; **aucune mission ne s'ouvrait** ; et comme le bouton
« Postuler » ne vit que sur cet écran, **personne ne pouvait postuler** — donc le seul endroit où
Claude devait encore entrer était inatteignable. **Trois semaines, et rien ne l'a dit.**

**Le cliquet existait pourtant, et il était vert.** `diag-colonnes-supprimees` défendait exactement
cette propriété — « aucune chaîne ne cite une colonne supprimée » — depuis le lot 2c. Il ne
connaissait simplement pas celle-là : **sa liste était écrite à la main**, six noms ajoutés un par un
par ceux qui y pensaient au moment de la migration.

> **LE DÉFAUT N'EST PAS LA LIGNE OUBLIÉE. C'EST QUE LA COUVERTURE DU CONTRÔLE DÉPENDAIT DE LA
> MÉMOIRE DE CELUI QUI L'ALIMENTAIT.** Une liste tenue à la main est une **discipline** ; et une
> discipline, par construction, protège de tout sauf du jour où l'on oublie (§E.31).

**La mesure qui donne l'ordre de grandeur, et elle est nette.**

| | |
|---|---|
| ce que la liste à la main connaissait | **6** noms |
| ce que le rejeu des migrations trouve | **21** colonnes mortes hors tables héritées |
| ce que le balayage a trouvé en première exécution | **15 lectures mortes, dans 8 fichiers** |
| ce qu'a trouvé le **troisième filet**, ajouté le jour même | **1 de plus**, invisible aux deux autres |

Les quinze n'étaient pas toutes dormantes : outre le détail de mission, **`POST /api/profile/cv/reset`
écrivait deux colonnes mortes** — l'expert qui supprimait son CV recevait « Update failed » **après**
que le fichier eut été retiré du stockage, et repartait avec un chemin qui ne pointait plus sur rien.

**LA PARADE — DÉRIVER, JAMAIS RECOPIER.** Le registre des colonnes mortes se **rejoue depuis les
migrations**, dans l'ordre : `create table`, `add column`, `drop column`, `rename column`,
`drop table`. Une colonne supprimée puis recréée n'y est pas ; une colonne renommée y entre par son
ancien nom. C'est **la mécanique de [§E.60](#e60)** — `diag-index-sautes` rejoue déjà l'historique
pour les index — et elle vivait **déjà à moitié** dans `diag-migration-donnees`, qui reconstruisait
le schéma pour confronter les types. Elle est donc **extraite**, pas réécrite :
[scripts/lib/schema-migrations.mjs](../scripts/lib/schema-migrations.mjs), **un rejeu, deux
lecteurs** — les types et les morts. Un second dialecte aurait vieilli séparément (§E.20).

> ⚠️ **ET L'EXTRACTION A CORRIGÉ LE LECTEUR HISTORIQUE, SANS CHANGER UN SEUL DE SES VERDICTS.**
> Le rejeu lisait le SQL **dépouillé de ses blocs `do $$ … $$`** — et **cinq
> `alter table … rename column` du dépôt vivent à l'intérieur d'un de ces blocs** (gardes
> d'idempotence). Le schéma reconstruit croyait donc `publications.location` vivante et
> `location_note` inexistante : **l'inverse exact de la base**. Aucune insertion ne citait ces
> colonnes, donc aucun verdict ne bougeait — et c'est précisément ce qui rendait l'erreur
> increvable. Vérifié : sortie **identique, caractère pour caractère**, avant et après.

**L'ATTRIBUTION DE LA TABLE EST LA MOITIÉ QUI FAIT MARCHER LE CONTRÔLE, ET ELLE N'EST PAS UN
RAFFINEMENT.** `score` est **morte** sur `matches` et **vivante** sur
`matching_notes_partielles` ; `location` est morte sur `publications` et vivante sur
`profiles` ; `seniority` et `speciality_id` sont mortes sur `profiles` et vivantes sur
`profile_alerts`. Un balayage **par nom seul** serait donc faux dans les deux sens — et un contrôle
qui crie à tort est désactivé le jour même (§E.14). Sur les 21 mortes, **9 seulement** le sont sur
toutes les tables.

On résout donc la table : la chaîne `.from('x')` et ses appels (ancrée sur le bloc, jamais une
regex lâchée — §E.8), les embeds PostgREST qui portent leur propre table, les références qualifiées
`x.col`, les reprises `q = q.eq(…)` d'une requête construite en plusieurs morceaux, et les corps
de fonction SQL par leurs alias de `from` / `join`.

> **ET LES VUES SQL COMPTENT.** Une fonction qui lit une colonne morte ne casse **ni à la
> compilation, ni à la migration** : elle casse **en base**, le jour où quelqu'un l'appelle. Seule la
> **dernière définition** de chaque fonction compte — `create or replace` remplace, et c'est
> celle-là qu'il faut confronter au schéma **final**.

**CE QUI NE SE RÉSOUT PAS SE NOMME, AVEC SON ADRESSE (§E.38).** Le dépliage de constantes est borné
et statique : il suit `const`, littéraux, concaténations, tableaux, gabarits et ternaires, il
n'appelle aucune fonction. Ce qui lui échappe est **compté et affiché à chaque exécution**, fichier
et ligne — pas rangé dans un silence. Mesure du 22/09/2026 : **1 select sur 16** reste illisible,
`lib/missions/feed.ts` (`opts.select`, un paramètre), et il est écrit à l'écran.

**ET LA DETTE DÉCLARÉE AVAIT UNE VRAIE PRISE DEDANS — ELLE A ÉTÉ MESURÉE, PAS SUPPOSÉE.**
`.select('*')` **ne cite aucune colonne** : la base ne refuse rien, elle rend la ligne entière. Une
colonne morte lue ensuite comme **propriété** — `prof.speciality_id` — vaut donc `undefined`. Pas
d'erreur, pas de 500, **une valeur fausse**. Les deux premiers filets ne pouvaient pas la voir : il
n'y a aucune chaîne à lire.

| Ce qu'on a essayé | Ce que ça a rendu |
|---|---|
| balayer les **noms** morts en propriété, sans table | **1232** occurrences, quasi toutes du bruit — `message`, `subject`, morts sur des tables d'archive. Une propriété ne dit pas sa table : c'est la raison même pour laquelle ce chemin ne se balayait pas. |
| balayer les `.from('T').select('*')`, **table connue** | **16** `select('*')` attribués, 10 sur des tables portant des colonnes mortes, **1 lecture réelle, 0 faux positif** |

La prise : `scripts/diag-readonly-expert-achwek.mjs:41` lisait `prof.speciality_id`, singulier mort
depuis `profil_annonce_multivalues`. **Un diagnostic écrit pour expliquer « pourquoi cet expert n'a
0 mission » affichait « aucune spécialité » quelle que soit la réalité** — et il aurait fait chercher
au mauvais endroit. C'est §E.24 : un chiffre juste sous une étiquette fausse, en pire, puisque la
valeur elle-même était vide.

> **CE QUI REND CE TROISIÈME FILET DÉCIDABLE EST EXACTEMENT CE QUI MANQUAIT AU PREMIER ESSAI : LA
> TABLE.** Elle est dans le `.from(…)` qui précède le `*`. On ne confronte donc que les colonnes
> mortes **de cette table** — et non 55 noms morts « partout » dont la moitié sont des mots anglais
> courants. **La limite reste déclarée** : la recherche porte sur le *fichier*, pas sur la variable
> qui reçoit la ligne. Aucun cas dans le dépôt ; le jour où il y en a un, il se nomme.

**Le contrôle a donc TROIS FILETS**, du plus précis au plus large — la citation attribuée, la liste
non attribuée confrontée aux seuls noms morts partout, et le `select('*')` suivi d'une propriété.
Chacun affiche son compte **et son dénominateur** : `0 sur 9 noms`, `0 sur 16 select('*')`. Un zéro
sans dénominateur ne dit pas s'il a cherché.

> **Deux pièges payés en l'écrivant, et les deux sont dans cette même section §E.**
> ① **Le contrôle rougissait sur ses propres témoins** : ils sont de vrais
> `.from('matches').select('… score …')`, et c'est tout leur intérêt. Il se retire donc du
> balayage — par `import.meta.url`, qui survit à un renommage, jamais par un chemin (§E.34).
> ② **Sa sentinelle lisait un COMMENTAIRE.** Elle vérifie qu'aucun `createClient<Database>`
> n'existe (sans quoi `lib/database.types.ts` cesse d'être inerte et son exemption tombe) — et
> elle a rougi immédiatement, sur **trois commentaires**, dont celui de `database.types.ts` qui
> cite la forme pour expliquer qu'elle n'est pas employée. **§E.7, dans le contrôle même qui s'en
> réclame.**

**La règle, et elle vaut pour tous les cliquets du dépôt :**
> **UNE LISTE QU'ON ALIMENTE À LA MAIN MESURE CE QU'ON A PENSÉ À Y METTRE, JAMAIS CE QUI EXISTE.
> Partout où l'inventaire peut se DÉRIVER de la source — les migrations, le disque, l'historique
> git — il se dérive. Ce qui reste écrit à la main n'est plus une couverture : c'est une
> EXEMPTION, elle porte sa raison, et le contrôle la compte à voix haute (§G.8).**

<a id="e62"></a>
### E.62 — UN DÉFAUT PEUT PROTÉGER QUELQUE CHOSE. LE RÉPARER NE DOIT PAS ROUVRIR CE QU'IL FERMAIT.

**Le cas, mesuré le 22/09/2026.** Le digest e-mail des mises en relation composait, pour chaque
opportunité, la ligne **« {titre} · {note}/10 »**. La note venait de `matches.score`, **supprimée le
1ᵉʳ septembre**. La lecture échouait donc en silence, tous les paliers retombaient à zéro, et
l'e-mail partait quand même — une des quinze lectures mortes de [§E.61](#e61).

**La réparation évidente était de remettre la colonne vivante à la place de la morte.** C'est ce
qu'on a fait quatorze fois dans le même lot, et c'était juste quatorze fois. **La quinzième aurait
réarmé un interdit** : §D.6 ne sert **aucun score de pertinence chiffré à l'expert** — seul le
palier sort, et il a deux valeurs. Écrire `relevance_score` là où `score` était mort aurait remis
un nombre de pertinence dans un e-mail, **avec l'air d'un correctif**, et personne n'aurait relu la
ligne une seconde fois : elle venait d'être corrigée.

> **LA COLONNE MORTE FERMAIT PAR ACCIDENT UNE PORTE QUE LE PRODUIT FERME PAR DÉCISION.**
> Depuis le 1ᵉʳ septembre, aucun expert n'a reçu de note de pertinence — non parce que la règle
> tenait, mais parce que la requête échouait. La règle et le défaut se recouvraient exactement, et
> **rien ne distinguait les deux depuis le code** : le digest était conforme, et il l'était pour une
> mauvaise raison.

**LA RÈGLE, ET ELLE NE SE DEVINE PAS AU MOMENT DU CORRECTIF :**

> **Avant de remplacer une lecture morte par sa remplaçante vivante, demander ce que le produit
> autorise À CET ENDROIT — pas ce que la colonne d'à côté contient.** Un défaut réparé « à
> l'identique » rétablit le comportement d'avant le défaut ; si une DÉCISION a été prise entre-temps,
> l'identique est une régression, et elle porte l'étiquette d'une correction.

**Ce qui a été fait à la place.** Le nombre part — **du rendu ET du type** `MatchDigestItem` : un
champ absent ne se remplit pas par distraction (§E.31) — et les deux requêtes qui le servaient avec
lui (`matches`, `profiles`). Le digest annonce des opportunités par leur **titre**. Deux requêtes
de moins par envoi, et la règle produit ne dépend plus d'une panne pour tenir.

**C'est [§E.56](#e56) à l'envers.** §E.56 dit : *« j'avais vérifié le contrôle, pas l'écran »* — un
lot qui convertit une syntaxe hérite d'une sémantique qui n'existait pas avant lui. Ici, un lot qui
**répare** hérite d'une sémantique qui a changé **pendant** que le défaut vivait. Les deux se
referment sur la même question, et c'est la seule à poser : **qu'est-ce que cet endroit a le droit
de faire AUJOURD'HUI ?**

> ⚠️ **ET LE SYMÉTRIQUE EST FAUX : UN DÉFAUT QUI PROTÈGE N'EST PAS UNE RAISON DE LE GARDER.**
> La requête échouait à chaque digest, les paliers étaient faux, et la prochaine main qui aurait
> « réparé » la lecture aurait rouvert la porte sans le savoir. Une règle qui ne tient que par
> l'échec d'une requête ne tient pas : elle attend.

**Ce qui le garde**, et ce n'est pas ce lot :
[`diag-score-de-pertinence`](../scripts/diag-score-de-pertinence.mjs) vérifie qu'aucun nombre de
pertinence ne sort vers l'expert, et il classe explicitement la note de **candidature** (`N/10`)
parmi les occurrences **légitimes** — les deux grandeurs ne disent pas la même chose (§D.6). Le
contrôle existait avant le défaut ; il ne l'a pas vu, parce qu'il balaie les **surfaces expert**, et
qu'un gabarit d'e-mail n'en est pas une. **Il en est une depuis ce lot.**

<a id="e63"></a>
### E.63 — UN RÉSULTAT POSÉ SUR UN SUPPORT QUI EXPIRE EST UN RÉSULTAT QU'ON PERDRA.

**Le cas, mesuré le 22/09/2026.** **9 853** passages des deux pilotes du moteur depuis le
3 septembre. **7 201 sans aucun verdict HTTP — soixante-treize pour cent.**

**La cause n'est pas une panne, et c'est tout le sujet.** La tâche ne rendait pas compte : elle
posait sa réponse chez `pg_net`, qui la garde **environ six heures**, et la réconciliation ne passe
qu'à **03 h 15** et **03 h 45**. Un passage de dix heures du matin n'avait donc plus de réponse à
recopier la nuit suivante. **Seule la tranche 21 h – 4 h arrivait à temps.**

| Ce que l'écran montrait | Ce que ça voulait dire |
|---|---|
| une ligne sans verdict | la tâche a peut-être parfaitement tourné |
| trois quarts des lignes ainsi | on ne peut pas répondre à « est-ce que ça tourne ? » |

**CE QUI A ÉTÉ REFUSÉ, ET POURQUOI.** *Ramasser plus souvent.* Ça réduit la perte, ça ne la
supprime pas : il reste toujours une fenêtre entre la fin d'un passage et le ramassage suivant, et
elle s'élargit dès qu'une tâche déborde. **On aurait déplacé le seuil, pas le mécanisme** — et le
jour où il aurait remordu, personne n'aurait su dire s'il s'agissait d'une panne ou d'un retard.

**LA PARADE : IL N'Y A PLUS D'INTERVALLE.** La ligne de journal naît **avant** l'appel, son
identifiant part dans le corps, et la tâche **écrit son verdict elle-même en terminant**. Rien
n'expire entre les deux, parce qu'il n'y a plus de « entre les deux ».

> **ET LA RÉCONCILIATION RESTE — DEUX COLLECTEURS, DEUX PANNES DIFFÉRENTES.**
> Ce n'est **pas** §E.36 (« deux gardes qui tombent sur la même panne n'en font qu'une ») : elles ne
> tombent pas sur la même panne. La tâche n'écrit pas quand elle a été **tuée** ; la réconciliation
> n'écrit pas quand la réponse a **expiré**. Une tâche tuée à la trentième seconde laisse donc
> encore une trace, par l'autre chemin. C'est la redondance assumée de §E.17.

**LE VERDICT S'ÉCRIT SUR TOUS LES CHEMINS DE SORTIE, Y COMPRIS UNE EXCEPTION.** Cinq tâches, dix
sorties HTTP : un guichet **partagé** les enveloppe. Cinq copies auraient été cinq occasions
d'oublier une branche (§E.20) — et celle qu'on oublie est toujours celle de l'échec, qu'on ne joue
jamais. Le guichet **relaie** l'exception après avoir écrit : l'avaler ferait d'une panne un succès
silencieux, la classe même qu'on ferme.

**ET L'ÉCRITURE NE PEUT PAS ÉCHOUER EN SILENCE — c'est la condition posée par l'architecte.**
Quatre issues, quatre journaux : la base refuse · la fonction rend `false` (aucune ligne n'a bougé)
· le corps est **illisible** · le corps est **absent**.

> ⚠️ **LES DEUX DERNIÈRES AVAIENT D'ABORD LA MÊME FORME, ET LE CLIQUET A MORDU.**
> `lireIdentifiantDeJournal` rendait `null` pour les deux, avec un commentaire disant « l'appel ne
> vient pas du pilote ». **Vrai d'un `curl` de mise au point. Faux d'un corps que le pilote a bien
> envoyé et qu'on n'a pas su lire** — là, une ligne attend un verdict qu'elle ne recevra jamais par
> ce chemin. C'est **§E.29 dans la parade elle-même**, et c'est
> [`diag-echec-silencieux`](../scripts/diag-echec-silencieux.mjs) qui l'a vu, à la première
> exécution, sur du code écrit une heure plus tôt. La distinction est un **type** à trois états.

**L'HISTORIQUE PERDU SE DIT, IL NE SE DEVINE PAS.** Les 7 201 lignes déjà vides ne se rattrapent
pas — la réponse qui les portait n'existe plus. `cron_run_log.attendu_de_la_tache` les marque à
`false` : **aucun verdict n'est attendu d'elles**, et l'écran l'écrit plutôt que de laisser lire un
trou d'activité. Sans cette colonne, on rouvrait §E.52 à l'identique — *une absence
d'INSTRUMENTATION lue comme une absence de TRAVAIL*, qui a déjà coûté un signal bloquant permanent
sur cet écran.

**La règle, et elle dépasse les tâches planifiées :**
> **UN RÉSULTAT QU'ON POSE POUR QUE QUELQU'UN VIENNE LE CHERCHER SE PERD À LA PREMIÈRE FENÊTRE
> MANQUÉE. Celui qui SAIT écrit ; celui qui ramasse est un second recours, jamais le premier.**
> La question à poser devant tout mécanisme de collecte : *combien de temps le résultat survit-il,
> et qui passe le chercher — avec quelle période ?* Si la seconde est plus grande que la première,
> la perte est **arithmétique**, pas accidentelle.

**Contrôle** : [scripts/diag-verdict-de-run.mjs](../scripts/diag-verdict-de-run.mjs) — il
**découvre** les tâches sous `app/api/cron/` au lieu de les lister (une tâche ajoutée demain est
couverte sans qu'on l'inscrive nulle part, §E.61), vérifie que **chaque sortie HTTP** passe par le
guichet, que les quatre issues journalisent, que la ligne naît **avant** l'appel, que les deux
collecteurs ne se marchent pas dessus, et que l'écran distingue « pas attendu » de « pas rendu »
dans les quatre langues.

<a id="e64"></a>

## E.64 — `NOT VALID` NE DISPENSE QUE L'INSERTION : IL REND IMMUABLES LES LIGNES QU'IL TOLÈRE

**Le cas, mesuré le 23/09/2026.** Le lot « une candidature n'existe que complète » devait poser une
contrainte exigeant note et résumé. La base portait **4 candidatures** des 4 et 5 juin 2026, toutes
`unlocked`, toutes **sans `ai_assessment`**. Le réflexe était `NOT VALID` : « les anciennes
lignes passent, les nouvelles sont refusées ».

**C'est faux, et d'une manière qui ne se voit qu'en production.** `NOT VALID` dispense la
**validation initiale** — le balayage de la table au moment de l'`ALTER`. Il ne dispense **aucune
écriture ultérieure** : toute `INSERT` **et toute `UPDATE`** est vérifiée, **y compris l'UPDATE
d'une ligne qui viole déjà la contrainte**. Les quatre candidatures seraient donc devenues
**IMMUABLES** : plus de sélection, plus de refus, plus d'archivage par le cycle de vie. Quatre
dossiers réels figés — et le premier symptôme aurait été une erreur Postgres opaque sur un clic
d'organisation, des semaines plus tard.

**La parade, et elle est une expression, pas une discipline.** La contrainte porte la tolérance
**dans son prédicat** :

```sql
check (
  created_at < timestamptz '2026-09-23 00:00:00+00'   -- le passé, DÉCLARÉ
  or ( ai_match_score is not null and ai_assessment is not null and … )
)
```

Trois propriétés que `NOT VALID` n'a pas :
· elle s'installe **VALIDÉE** — la table entière a été balayée, on SAIT qu'aucune ligne ne la viole ;
· les lignes anciennes restent **modifiables**, parce qu'elles satisfont la contrainte ;
· la tolérance est **lisible dans la définition** : `pg_get_constraintdef` la montre, alors qu'un
  `NOT VALID` ne dit ni combien de lignes il tolère ni lesquelles.

**Et l'échec va dans le bon sens.** Si une ligne nue était créée entre l'écriture de la migration et
son application, l'`ADD CONSTRAINT` **échouerait bruyamment** au déploiement — plutôt que de
s'installer en fermant les yeux (§E.60).

> **La question à se poser, et elle n'est pas « faut-il valider ? » :** *que deviennent les lignes
> que je tolère, le jour où quelqu'un les modifie ?* `NOT VALID` répond « elles cessent d'être
> modifiables », et ne le dit nulle part.

**Gardé par** [`diag-candidature-complete`](../scripts/diag-candidature-complete.mjs) : il refuse
`not valid` sur cette contrainte, exige la borne de date, et la postcondition de la migration
vérifie `convalidated`.

---

<a id="e65"></a>

## E.65 — DÉPLACER UN TRAITEMENT DÉPLACE LES GARDES QUI EN DÉPENDENT

**La règle.** Quand on change **l'ordre** d'une chaîne — un appel qui passe avant, un traitement qui
quitte un `after()`, une écriture qui recule —, on **relit CHAQUE garde que la chaîne traverse**,
pas seulement celle qu'on vise. Une garde est écrite contre un ÉTAT ; déplacer le traitement change
l'état qu'elle observe, et elle continue de compiler.

**Les deux cas mesurés, le 23/09/2026, dans le même lot** (§D.19 : le jugement passe avant
l'écriture d'une candidature). Aucun des deux n'était le sujet du lot ; les deux ont été trouvés en
déplaçant, pas en cherchant.

**① UNE GARDE QUI COMPARE À « L'APPELANT » CHANGE DE SENS QUAND L'APPELANT CHANGE.**
« On ne candidate pas à son propre besoin » comparait `publication.created_by` à
`auth.user.id` — l'utilisateur de la session. C'était **exact** tant que le seul chemin était
« l'expert dépose ». Le lot a ajouté un second appelant : le bouton RELANCER du back-office, où
l'appelant est un **administrateur**. La garde aurait comparé l'auteur de l'annonce à l'administrateur,
donc **laissé passer exactement ce qu'elle refuse**. Elle compare désormais à
`profiles.user_id` — l'expert —, ce qui est **identique sur le chemin d'origine** et juste sur les
deux.

> **Le signe qui la trahit** : une garde dont l'un des deux membres vient de la SESSION et l'autre de
> l'OBJET. Elle est juste tant qu'un seul type d'acteur l'atteint, et elle ne dit nulle part lequel.

**② UNE GARDE QUI ATTEND UN ÉTAT TRANSITOIRE DEVIENT MUETTE QUAND CET ÉTAT DISPARAÎT.**
Le dévoilement inclus différait sa décision tant qu'une **candidature non encore notée** existait sur
l'annonce — sans quoi la place offerte va au PREMIER déposant au lieu du MEILLEUR. Le lot a supprimé
cet état : une candidature naît notée. La garde ne serait pas tombée en erreur — elle aurait compté
**zéro**, donc n'aurait plus jamais différé, et le défaut qu'elle fermait serait revenu **avec la
même fenêtre de trente secondes**, sans qu'une ligne ne change de couleur.

> **C'est §E.62 vu de l'autre côté.** §E.62 dit qu'un défaut peut protéger quelque chose. Celui-ci dit
> qu'une **garde** peut cesser de protéger sans cesser d'exister : elle reste verte, elle reste
> exécutée, et elle ne mesure plus rien. Le correctif rouvre ce qu'il ferme, **par sa propre
> réussite**.
>
> La parade n'est pas de garder la garde : c'est de lui **reposer sa question dans le nouveau
> monde**. Ici : « un autre DÉPÔT est-il en cours ? » à la place de « une autre candidature est-elle
> non notée ? ». Même fenêtre, même filet, même comportement — autre observable.

**LE RÉFLEXE, EN TROIS QUESTIONS, À POSER SUR CHAQUE GARDE TRAVERSÉE :**
1. **Qui** compare-t-elle ? Un des deux membres vient-il de la session plutôt que de l'objet ?
2. **Quel état** observe-t-elle ? Cet état existe-t-il encore après le déplacement, et veut-il
   toujours dire la même chose ?
3. **Que ferait-elle** si l'état qu'elle attend n'arrivait jamais ? Si la réponse est « rien, en
   silence », elle est déjà morte.

**Ce qu'aucun contrôle ne trouve tout seul.** Un balayage voit les gardes ; il ne sait pas
**laquelle a changé de sens**. Ce qui les a trouvées ici, c'est d'avoir déplacé le code à la main en
relisant ce qu'il traverse — et le premier des deux a été vu en écrivant le chemin de relance, pas en
relisant le chemin de dépôt. **Ce qui se garde** est la conséquence : les deux propriétés corrigées
sont désormais tenues par [`diag-candidature-complete`](../scripts/diag-candidature-complete.mjs) et
[`diag-devoilement-inclus`](../scripts/diag-devoilement-inclus.mjs), chacune éprouvée par mutation.

---

<a id="e66"></a>

## E.66 — UN `import type` EST EFFACÉ. LE TRANSFORMER EN IMPORT DE VALEUR CHANGE CE QUI DOIT SE RÉSOUDRE, ET REND UN BANC MUET.

**Le cas, mesuré le 24/09/2026.** Six modules portaient
`import type { ConsommationIA } from '@/lib/ai-consommation'`. Le lot §D.24 y a ajouté une
fonction : `import { consommationJetons, type ConsommationIA } from '@/lib/ai-consommation'`.
Un caractère de différence à la lecture ; deux choses différentes à l'exécution.

| | Ce que Node doit faire |
|---|---|
| `import type` | **RIEN** — le type est effacé à la compilation, le spécificateur n'est jamais résolu |
| `import` d'une valeur | **RÉSOUDRE** `@/lib/ai-consommation` — un alias de `tsconfig` que Node ne connaît pas |

**Conséquence, et c'est elle qui compte** : `diag-publication-gate` et `diag-gate-recalibrage`
chargent `lib/verification/ai-publication-quality.ts` **tel quel**, avec Node. Ils sont passés de
**vert** à **n'a pas tourné**, sur un `ERR_MODULE_NOT_FOUND` que personne ne lisait.

> ⚠️ **ILS NE SONT PAS DEVENUS ROUGES. ILS SONT DEVENUS MUETS.** Un rouge a conclu ; un muet n'a
> pas commencé. `diag.mjs` les range dans une catégorie à part exactement pour ça — mais encore
> faut-il **lancer la série**. Le lot a tourné ses contrôles ciblés, tous verts, et a conclu que
> les validations passaient. **Deux contrôles avaient cessé de vérifier quoi que ce soit.**

**LA PARADE EST UNE PROPRIÉTÉ DE RÉSOLUTION, PAS UNE VIGILANCE.** `allowImportingTsExtensions`
dans `tsconfig.json` (compatible avec `noEmit`, déjà posé), et les six imports passent en
**relatif avec extension** — `from '../ai-consommation.ts'` —, que Node résout sans alias. Uniforme
sur les six, et pas seulement sur celui qui cassait : le suivant qu'un banc chargera est couvert
d'avance (§E.20).

**LA RÈGLE QUI EN SORT.** Un module que charge un banc ne peut avoir, dans tout son graphe, que
des imports de valeur **résolubles par Node**. Le dépôt en avait la discipline sans l'écrire : ses
bancs ne chargeaient que des modules **purs**. `ai-publication-quality.ts` l'était **par accident**
— son seul import croisé était un `import type`, donc invisible à l'exécution.

> **Et la leçon plus large, qui vaut pour tout ce fichier** : une modification qui ne change
> **rien** à ce que le code fait peut changer **tout** à ce qui doit exister pour qu'il se charge.
> Le compilateur était vert, le `build` était vert, les contrôles ciblés étaient verts. Seule la
> **série complète** l'a dit.

---

<a id="e9"></a>
### E.9 — Autres pièges nommés dans le dépôt, à connaître.
- **pg_cron valide la FORME d'une expression, pas sa satisfaisabilité.** `0 3 30 2 *` (30 février) est
  acceptée et ne se déclenchera **jamais** : aucune erreur, aucune ligne dans `job_run_details`. D'où le
  parti pris de `/admin/taches-planifiees` : **on ne reçoit jamais d'expression cron**, mais des
  composants typés et bornés.
- **Ne JAMAIS granter le schéma `cron` à `service_role`.** Le point d'exposition reste une fonction
  `SECURITY DEFINER` nommée. Répété dans cinq migrations.
- **Un webhook Stripe lu en `.json()` casse la signature** (HMAC des octets exacts) — de façon
  intermittente et incompréhensible.
- **Les interrupteurs échouent FERMÉ**, tous, via `capaciteActive()`
  ([lib/interrupteurs.ts](../lib/interrupteurs.ts)) : la valeur doit être exactement `'true'`. Deux
  conventions opposées coexistaient ; `0`, `off`, `FALSE`, `flase` **laissaient l'IA active** et
  dépenser. Conséquence assumée : une capacité sans variable est **éteinte** — il faut donc déclarer
  `=true` en Preview comme en Production.
- **Le fail-safe n'est pas uniforme, et c'est voulu** : `entitlements` et `rate-limit` sont
  **fail-open** (une panne commerciale ne bloque pas l'usage) ; `ai-budget` est **fail-closed**
  (« ne pas savoir combien on a dépensé n'autorise pas à dépenser plus »).
