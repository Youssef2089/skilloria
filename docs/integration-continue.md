# L'intégration continue — les contrôles sur GitHub, le verrou des branches, ce que ça coûte

Cette page se suit **écran ouvert, dans l'ordre**. Elle dit ce qui tourne sur GitHub à chaque demande de fusion, comment
fermer les branches à tout envoi direct, ce que le compte GitHub permet sur un dépôt privé, et ce que ça coûte.
Écrite le 03/10/2026 (lot DevOps CI, partie A). **Ce qui n'a pas pu être vérifié depuis le dépôt est marqué NON VÉRIFIÉ.**

> **La règle, depuis ce lot (CLAUDE.md §G.13).** Une tâche = une branche = une demande de fusion = les contrôles = une
> revue = la fusion. **Les contrôles tournent sur GitHub Actions, plus sur le poste de Youssef.** La requête de staging,
> `db push` et `git push` vers les branches protégées restent des gestes de Youssef jusqu'au lot DevOps 2.
>
> **Le principe, écrit dès maintenant** : **la production recevra exactement le commit validé sur staging** — le même,
> pas une reconstruction ni un équivalent. Le lot DevOps 2 l'outillera ; jusque-là, il se tient à la main : ce qui part
> en production est un commit qui a tourné sur staging, nommé par son identifiant.

---

## 1. Ce qui tourne à chaque demande de fusion

Le flux [.github/workflows/controles.yml](../.github/workflows/controles.yml) se déclenche sur **chaque demande de
fusion vers `feat/sprint-archi-orga` et vers `main`** (et à la main, onglet *Actions* → *Contrôles* → *Run workflow*).
Trois travaux, en parallèle, chacun lisible dans la demande de fusion sous **« Contrôles / statique »**,
**« Contrôles / base »**, **« Contrôles / application »** :

| Travail | Ce qu'il vérifie | Durée estimée |
|---|---|---|
| **statique** | `tsc` ; le lint (le cliquet, §G.5 ter) ; la parité des quatre langues ; la mémoire tenue à **chaque commit** de la demande de fusion (`diag-memoire-a-jour --base`) ; **toute la série des diagnostics** qui ne touchent pas une vraie base (`scripts/diag.mjs`) | 6 à 8 min |
| **base** | une base Supabase **démarrée dans le runner, jetable** : `db reset` (les 191+ migrations rejouées depuis zéro), `db lint` (niveau erreur), **tous les tests pgTAP** — dont les accès croisés en base — puis le **jeu de référence du moteur** | 8 à 11 min |
| **application** | la même base jetable ; l'application **construite** (la barrière de construction, §D.51, puis `next build`) et **démarrée** ; puis les **accès croisés par les routes** | 9 à 13 min |

**Durée d'une exécution, de bout en bout : 10 à 13 minutes** (les trois travaux en parallèle). **Minutes consommées :
23 à 32** (la somme des trois, chacun arrondi à la minute supérieure). Ces durées sont **estimées** (mesurées sur le
poste pour la série statique : 2 min 45) : le premier passage sur GitHub donnera les vraies.

**Ce qui n'y tourne pas, et pourquoi.** Aucun contrôle ne touche staging ni la production : la base est locale au runner,
ses clés sont celles de démonstration de la CLI, lues au démarrage. Les fournisseurs (Vonage, Resend, Anthropic, Cohere)
reçoivent des valeurs « ci-factice » : la barrière les exige présentes, rien ne les appelle avec succès. **Aucune clé
n'est écrite dans le flux, et aucune n'est nécessaire** (contrôlé par `diag-integration-continue`).

### Lire le résultat

1. Dans la demande de fusion, en bas : les trois lignes **Contrôles / …**, chacune verte ✅ ou rouge ❌.
2. **Details** à côté d'une ligne → le journal du travail, étape par étape (chaque étape porte un nom en français).
3. **Summary** (en haut à gauche de l'exécution) → le résumé : pour les diagnostics, les rouges et ceux qui n'ont pas
   tourné ; pour les bancs, chaque contrôle avec ✅ / ❌ et, pour un ❌, ce qui a été rendu.
4. Trois états, comme sur le poste : **vert**, **rouge** (un contrôle a conclu « c'est faux »), **n'a pas tourné**
   (la base, l'application ou un outil manquait : rien n'a été vérifié — c'est un échec aussi, pas un « presque vert »).

---

## 2. Ce que prouvent les bancs nouveaux

**Les accès croisés en base** — [supabase/tests/database/vrai_appelant/acces_croises.test.sql](../supabase/tests/database/vrai_appelant/acces_croises.test.sql)
(68 tests). La clé publique et le jeton d'un compte sont dans le navigateur : n'importe qui peut appeler l'API de données
sans passer par nos routes. Le test prend, pour chaque rôle — expert freelance A, expert CDI, client A, client B, cabinet,
ESN, administrateur, visiteur — **son vrai rôle Postgres et son jeton**, comme PostgREST, et prouve : chacun ne lit que
ses lignes ; une organisation ne lit pas le profil ni le compte d'un candidat avant le dévoilement ; personne n'écrit
directement ce que les routes gardent (profil, annonce, candidature, organisation, membres) ; personne ne se promeut
administrateur ; l'administrateur lui-même n'a aucun pouvoir par l'API de données. Puis il relit la base : rien n'a changé.

**Les accès croisés par les routes** — [tests/integration/acces-routes.mjs](../tests/integration/acces-routes.mjs).
Contre l'application construite et démarrée :
- **le visiteur contre toute route privée** : chaque route de `app/api`, chaque méthode — **dérivé du dépôt**, une route
  nouvelle est couverte sans rien écrire — refusée en 401 avec un code ; les 14 routes publiques sont **déclarées une à
  une avec leur raison** ([tests/integration/routes-publiques.mjs](../tests/integration/routes-publiques.mjs)) ;
- **chaque rôle contre chaque route d'administration** (82 couples route × méthode) : 403 `forbidden` ;
- **ce que chaque rôle peut lire**, et le **refus nommé** du reste (404 `not_found`, 403 `org_required`…) ;
- **A contre B** sur les routes à identifiant (mission, candidature, annonce, membre…), puis la base relue : rien n'a changé ;
- un jeton d'un autre compte que celui affiché (403 `compte_different`, §D.29), une adresse d'écosystème inconnue
  (403 `unknown_domain`).

**Le jeu de référence du moteur** — [tests/integration/jeu-de-reference.mjs](../tests/integration/jeu-de-reference.mjs)
(les données) et [tests/integration/moteur-reference.mjs](../tests/integration/moteur-reference.mjs) (le banc). Douze
experts, trois annonces, et le résultat attendu, sur **le vrai moteur** (`lib/matching/` tel qu'il est livré) :
- **sans IA**, le vivier de chaque annonce : branche, spécialités, « Autre » seul, séniorités, zones (pays, continent,
  monde), public natif et ouverture croisée, éligibilité (invisible, « ne pas déranger », salarié non en recherche) ;
- **avec une IA simulée aux réponses fixes** — là où l'IA intervient dans le vrai parcours, le reranker : les
  correspondances et l'étiquette **« Correspondance forte »**, dans les deux sens (expert → annonces, annonce → experts) ;
  un avis par correspondance fraîche, aucun au second passage ; un reranker en panne n'efface rien.

Pour **ajouter un cas** au jeu : un expert ou une annonce dans `jeu-de-reference.mjs`, sa note dans `NOTES`, le résultat
dans `ATTENDU` avec la phrase qui dit pourquoi. `diag-integration-continue` vérifie la cohérence sans base.

---

## 3. Le verrou — les contrôles exigés, et quand ils le deviennent

**La liste vit dans le dépôt** : [.github/controles-exiges.json](../.github/controles-exiges.json). Aujourd'hui, les
trois contrôles sont **« en rodage »** : **un contrôle ne devient exigé qu'après sa première exécution réussie sur
GitHub** — l'exiger avant verrouillerait les branches sur un contrôle qui n'a jamais tourné (et qu'aucune fusion ne
pourrait plus satisfaire).

**Le moment exact où chacun devient exigé** : le jour où la demande de fusion de ce lot le voit **vert** sur GitHub.
Ce jour-là, pour chacun des trois :
1. Youssef l'ajoute à la règle des branches (ci-dessous, étape ④) ;
2. dans `.github/controles-exiges.json`, `"etat"` passe à `"exige"` et `"premiere_execution_verte"` reçoit
   `{ "date": "AAAA-MM-JJ", "adresse": "https://github.com/Youssef2089/skilloria/actions/runs/<numéro>" }` —
   dans un commit, par une demande de fusion. `diag-integration-continue` refuse un « exige » sans cette preuve.

### Ce que le compte GitHub permet — un dépôt PRIVÉ d'un compte personnel

`gh` n'est pas installé sur le poste : **rien n'a été réglé depuis cette session**, tout est ci-dessous, clic par clic.
Le dépôt `Youssef2089/skilloria` appartient à un **compte personnel** ; qu'il soit privé et sur l'offre gratuite est
**NON VÉRIFIÉ** (c'est un réglage du compte, invisible depuis le dépôt). Ce que dit la documentation de GitHub, telle que
je la connais (à vérifier sur github.com/pricing le jour du choix) :

| | **GitHub Free** (gratuit) | **GitHub Pro** (4 $ par mois) |
|---|---|---|
| Protéger une branche (demande de fusion obligatoire, contrôles exigés, aucun envoi direct, aucune suppression) sur un dépôt **privé** | **non** — réservé aux dépôts publics | **oui** |
| Minutes de GitHub Actions par mois (dépôts privés, Linux) | 2 000 | 3 000 |
| Au-delà | les flux **s'arrêtent** jusqu'au mois suivant (plafond de dépense à 0 $ par défaut) | facturé à la minute si un plafond de dépense est posé ; sinon arrêt |
| Dependabot (alertes et mises à jour de sécurité) | oui | oui |
| Détection de clés de GitHub (*Secret Protection*) sur un dépôt privé | **non** — réservée aux organisations (Team ou Enterprise), 19 $ par contributeur actif et par mois | **non** |

**Conclusion : le verrou exige GitHub Pro — 4 $ par mois.** Sans lui, sur un dépôt privé, aucune règle de branche ne
s'applique : les contrôles tournent et se lisent, mais rien n'empêche une fusion rouge ni un envoi direct. La détection
de clés de GitHub reste hors d'atteinte d'un compte personnel : elle est remplacée par `diag-aucune-cle-ecrite` (§5).

### Les réglages, clic par clic

**① Passer en Pro** (si ce n'est pas déjà le cas) : avatar en haut à droite → **Settings** → **Billing and licensing** →
**Plans and usage** → **Upgrade** sur *Pro*. Puis, même écran : **Spending limit** (plafond de dépense) → posez **10 $**
pour les minutes d'Actions — au-delà de 3 000 minutes, les contrôles continuent au lieu de s'arrêter (§4).

**② Autoriser les actions du flux** : le dépôt → **Settings** → **Actions** → **General** →
*Actions permissions* : **Allow Youssef2089, and select non-Youssef2089, actions and reusable workflows** → cochez
**Allow actions created by GitHub** → **Save**. (Le flux n'utilise que `actions/checkout`, `actions/setup-node`,
`actions/cache`.) Plus bas, *Workflow permissions* : **Read repository contents and packages permissions** → **Save**.

**③ La branche par défaut** — recommandé : le dépôt → **Settings** → **General** → *Default branch* → l'icône ⇄ →
**feat/sprint-archi-orga** → **Update**. Pourquoi : Dependabot ouvre ses mises à jour de **sécurité** vers la branche par
défaut, et une fusion dans `main` met en ligne la Production de Vercel (docs/mise-en-production.md, « Ce que Vercel sert
sous Production »). **Vérifiez ensuite chez Vercel** (Settings → Git → *Production Branch*) qu'elle vaut toujours `main` :
ce réglage est propre à Vercel — qu'il ne suive pas le changement est **NON VÉRIFIÉ**.

**④ La règle des branches** (après le premier passage vert pour les contrôles exigés — avant, posez-la sans eux) :
le dépôt → **Settings** → **Rules** → **Rulesets** → **New ruleset** → **New branch ruleset** :
- *Ruleset Name* : `Branches protégées` ; *Enforcement status* : **Active** ;
- *Bypass list* : **vide** — personne, Youssef compris, ne contourne la règle (c'est « aucun envoi direct ») ;
- *Target branches* → **Add target** → **Include by pattern** → `feat/sprint-archi-orga` ; puis encore → `main` ;
- *Rules* :
  - ☑ **Restrict deletions** (aucune suppression) ;
  - ☑ **Require a pull request before merging** → *Required approvals* : **0** (un compte ne peut pas approuver sa
    propre demande ; la revue est celle du relecteur, citée dans la demande) ; ☑ *Require conversation resolution
    before merging* ;
  - ☑ **Require status checks to pass** → **Add checks** → tapez et choisissez **statique**, **base**, **application**
    (source : *GitHub Actions*) — ils n'apparaissent dans la liste qu'**après** avoir tourné une fois. Laissez
    *Require branches to be up to date before merging* **décoché** : chaque exécution teste déjà la fusion avec la tête
    de la branche cible ; le cocher obligerait à relancer les contrôles de chaque branche ouverte à chaque fusion
    (davantage de minutes, plus de frictions entre S1, S2 et S3) ;
  - ☑ **Block force pushes** ;
  - laissez *Restrict updates* **décoché** (il bloquerait aussi la fusion des demandes).
- **Create**.

**⑤ La sécurité du dépôt** : le dépôt → **Settings** → **Advanced Security** (ou *Code security*) :
**Dependency graph** : Enable ; **Dependabot alerts** : Enable ; **Dependabot security updates** : Enable ;
**Grouped security updates** : Enable. (*Secret Protection* n'y est pas proposé sur un dépôt personnel : normal.)

**Comment savoir que c'est bon** : un `git push origin feat/sprint-archi-orga` direct est **refusé** par GitHub
(« protected branch ») ; une demande de fusion dont un contrôle est rouge affiche **Merging is blocked**.

---

## 4. Le coût

**Les contrôles de ce lot : 23 à 32 minutes par exécution** (§1). Une exécution par envoi sur une demande de fusion
ouverte ; un nouvel envoi annule l'exécution en cours (seul le dernier état compte).

**La campagne de nuit de S1 (Playwright, partie B)** : sa durée n'est pas connue de ce lot. Hypothèse : **20 à 30 minutes
par nuit**, soit **600 à 900 minutes par mois**.

| Rythme | Exécutions par mois | Minutes des contrôles | + nuit de S1 | Total | Free (2 000) | Pro (3 000) |
|---|---|---|---|---|---|---|
| calme : 1 demande de fusion par jour ouvré, 1,5 envoi chacune | ~33 | ~900 | 600–900 | **1 500–1 800** | suffit, de justesse | suffit |
| actuel : 3 demandes par jour ouvré (principal, S1, S2, S3), 2 envois chacune | ~130 | ~3 400 | 600–900 | **4 000–4 300** | **ne suffit pas** | **ne suffit pas** : ~1 000 à 1 300 min de plus |

**Au-delà du forfait** : 0,008 $ la minute Linux (2 cœurs), au tarif que je connais — **GitHub a annoncé une baisse de
ses tarifs pour 2026 : NON VÉRIFIÉ, la page de facturation fait foi**. Au rythme actuel sur Pro : **~8 à 11 $ par mois**
de plus, soit **12 à 15 $ par mois en tout** (Pro compris). Sans plafond de dépense, les contrôles **s'arrêtent** une fois le
forfait épuisé — et, avec des contrôles exigés, **plus aucune fusion n'est possible jusqu'au mois suivant**. D'où le plafond
de 10 $ (§3, ①).

**Ce qui réduirait la note, sans rien retirer**, si un jour il le faut : ne lancer `base` et `application` que lorsque
des fichiers de code ou de base changent (un filtre de chemins : une demande de fusion qui ne touche que `docs/` ne
lancerait que `statique`). Non fait ici : le premier mois dira la vraie consommation (*Settings → Billing → Usage*).

---

## 5. La sécurité du dépôt

- **Dependabot** ([.github/dependabot.yml](../.github/dependabot.yml)) : **aucune** mise à jour de version des
  dépendances npm ; les mises à jour de **sécurité** arrivent **toutes ensemble**, dans une seule demande de fusion, chaque
  lundi s'il y en a. Les actions du flux sont tenues à jour une fois par mois. **Rien ne fusionne seul** : aucune fusion
  automatique n'est configurée, et une mise à jour passe les mêmes contrôles et la même revue qu'un lot.
- **Aucune clé écrite** : `scripts/diag-aucune-cle-ecrite.mjs`, dans la série, balaie chaque fichier suivi par git
  (Stripe, Anthropic, Resend, Supabase — jeton de service compris —, GitHub, AWS, clés privées, adresses de base avec
  mot de passe). Il ne voit ni l'historique git ni les clés sans forme reconnaissable (Cohere, Vonage) : **une clé
  écrite par erreur se révoque chez le fournisseur** — la retirer du fichier ne la retire pas de l'historique.
- **Aucune clé dans les flux** : `diag-integration-continue` refuse une valeur de nom sensible qui ne serait pas
  « ci-factice », `pull_request_target`, et une action non épinglée à une version.

---

## 6. Envoyer la branche et lire le résultat — la première fois

1. **La relecture** du lot (skill `relecture-avant-deploiement`).
2. **Avant de fusionner quoi que ce soit dans `feat/sprint-archi-orga`** : sur staging, `/admin/supervision` → la ligne
   de configuration doit dire **toutes les variables exigées sont posées**. Sinon, la prochaine construction de staging
   s'**arrêtera** en nommant ce qui manque (§D.51) — c'est voulu : l'ancienne version reste en ligne.
3. `git push -u origin lot/devops-ci`.
   Vercel construira aussi une **Preview** de cette branche : elle s'arrêtera si les variables de *Preview* ne
   s'appliquent pas à toutes les branches (réglage Vercel, NON VÉRIFIÉ) — sans effet sur staging.
4. Sur github.com → **Pull requests** → **New pull request** → *base* : `feat/sprint-archi-orga`, *compare* :
   `lot/devops-ci` → **Create pull request**.
5. Attendre les trois lignes **Contrôles / statique, base, application** (10 à 15 minutes la première fois : le cache
   de npm est froid). Lire le résultat (§1). Un rouge ou un « n'a pas tourné » au premier passage se lit dans
   **Details** → l'étape en rouge ; la première exécution réelle est celle-ci — elle peut révéler ce qu'aucun poste n'a
   pu exécuter (une option de la CLI, une image Docker, psql sur le runner). Le corriger se fait **sur la branche**,
   par un nouveau commit.
6. Tout vert : poser la règle des branches avec les trois contrôles (§3, ④), passer les trois contrôles à « exige » dans
   `.github/controles-exiges.json` (§3), fusionner (**Merge pull request**).
