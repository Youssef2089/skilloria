# Mettre Skilloria en production — pas à pas

Cette page est faite pour être suivie **écran ouvert, dans l'ordre**, sans connaissance technique.

Elle couvre **tout ce qui ne peut pas vivre dans le dépôt** : des secrets, des réglages de compte, des noms de domaine. Le reste — les tables, les fonctions, la taxonomie, les pays, les seuils — est appliqué automatiquement par les mises à jour de base de données.

> **Ce que vous faites ici n'est PAS rattrapable par un déploiement de code.**
> Un secret oublié ne se voit pas : l'application démarre, les écrans s'affichent, et une purge légale ne tourne pas. C'est pour cela que chaque étape se termine par **« Comment savoir que c'est bon »**. Ne passez jamais à la suivante sans cette vérification.

---

## Ce qu'il ne faut surtout pas faire

1. **Ne créez aucune donnée à la main dans la base** — ni écosystème, ni branche, ni spécialité, ni seuil. Elles arrivent par les mises à jour. Une ligne posée à la main **ne survit pas à une reconstruction**, et personne ne s'en aperçoit. C'est exactement ce qui est arrivé au seuil de validation des experts : posé à la main en juin, il n'existait nulle part, et il a fallu croiser deux traces pour le retrouver.
2. **Ne posez aucune clé Stripe** tant que le lancement est gratuit. Voir [docs/stripe-premier-paiement.md](stripe-premier-paiement.md).
3. **N'inventez pas un nom de secret.** Les noms ci-dessous sont lus tels quels par la base. Une faute de frappe = le secret est introuvable = la tâche ne tourne pas.

---

## L'ordre des opérations

Huit étapes. **L'ordre compte** : chacune suppose la précédente.

| | Étape | Où |
|---|---|---|
| 1 | Appliquer les mises à jour de base | Base de données |
| 2 | Vérifier que le paramétrage est bien arrivé | Base de données |
| 3 | Poser les deux secrets du coffre-fort | Supabase → Vault |
| 4 | Régler l'authentification | Supabase → Authentication |
| 5 | Poser les variables d'environnement | Vercel |
| 6 | Brancher les sous-domaines | Vercel |
| 7 | Créer le premier administrateur | Votre machine (une fois) |
| 8 | Vérifier que les tâches planifiées tournent | Supabase |

---

# ÉTAPE 1 — Appliquer les mises à jour de base de données

C'est ce qui crée les tables, les fonctions, **et le paramétrage** : l'écosystème, ses couleurs, les branches, les spécialités, les 64 pays, les seuils de vérification, les traductions.

1. Demandez l'application des migrations sur l'environnement de production.

**Comment savoir que c'est bon :** la commande se termine sans erreur, et affiche en fin de course une ligne qui commence par `PARAMETRAGE —` suivie de nombres. Elle doit indiquer **au moins 1 domaine**, des branches, des spécialités et des pays.

> **Si elle affiche une erreur `PARAMETRAGE — …`, arrêtez-vous.** La migration refuse volontairement de se terminer sur une base incomplète : c'est elle qui vous évite de découvrir le problème au premier utilisateur.

*Pourquoi c'est la première étape :* sans écosystème en base, **aucune inscription ne fonctionne**. Le site s'affiche — aux couleurs par défaut — et le premier compte créé échoue. Rien ne vous préviendrait : l'affichage par défaut masque l'absence.

---

# ÉTAPE 2 — Vérifier que le paramétrage est bien arrivé

1. Ouvrez Supabase → **Table Editor**.
2. Regardez ces tables, l'une après l'autre :

| Table | Ce que vous devez voir |
|---|---|
| `domains` | au moins une ligne, colonne `active` cochée |
| `domain_configs` | une ligne par écosystème, avec des couleurs |
| `branches` | plusieurs lignes |
| `specialities` | plusieurs lignes |
| `countries` | plusieurs dizaines de lignes |
| `verification_providers` | plusieurs lignes, `is_active` coché |
| `translations` | plusieurs centaines de lignes |

**Comment savoir que c'est bon :** aucune de ces tables n'est vide. Si `domains` est vide, ne continuez pas — reprenez l'étape 1.

---

# ÉTAPE 3 — Poser les deux secrets du coffre-fort

**C'est l'étape la plus facile à oublier, et la plus coûteuse.**

La base déclenche elle-même cinq tâches en appelant l'application par Internet. Pour cela, il lui faut deux informations qui **changent d'un environnement à l'autre** et qui ne doivent donc **jamais** être écrites dans le dépôt :

| Nom du secret | Ce que c'est |
|---|---|
| `cron_secret` | le **même** mot de passe que la variable `CRON_SECRET` de Vercel, au caractère près |
| `purge_cron_base_url` | l'adresse de votre site, **sans barre oblique finale** — par exemple `https://microsoft.skilloria.io` |

### Ce qui se passe si vous les oubliez

**Cinq** des neuf tâches planifiées s'arrêtent net à chaque déclenchement :

| Tâche | Ce qu'elle fait | Conséquence si elle ne tourne pas |
|---|---|---|
| `purge_deletions_trigger` | efface les comptes dont la suppression demandée est échue | **Obligation légale (RGPD art. 17)** non tenue |
| `purge_inactive_trigger` | avertit à 23 mois, efface à 24 | **Obligation légale (CNIL)** non tenue |
| `matching_retry_trigger` | reprend les mises en relation inachevées | des annonces sans candidats, sans explication |
| `expert_relance_trigger` | applique les modifications de profil en attente | des experts dont les changements ne sont jamais pris en compte |
| `stripe_reconcile_trigger` | compare chaque nuit les événements de paiement produits par Stripe à ceux que le site a reçus | un événement de paiement perdu **n'est jamais signalé** — et Stripe ne conserve les siens que 30 jours, au-delà il est introuvable |

Ces tâches **ne se plaignent pas à l'écran**. Elles lèvent une erreur que seul le journal technique de la base porte. **Vous pourriez ne rien remarquer pendant des mois.**

Les quatre autres tâches (`cron_run_reconcile`, `cron_run_log_purge`, `rate_limit_hits_purge`, `matching_notes_partielles_purge`) travaillent uniquement dans la base et **ne dépendent pas** de ces secrets.

### Comment les poser

1. Supabase → **Project Settings** → **Vault** (ou **Integrations → Vault** selon la version).
2. **New secret**.
3. Dans **Name**, tapez exactement `cron_secret`. Dans **Secret**, collez la valeur de `CRON_SECRET`.
4. Enregistrez.
5. Recommencez pour `purge_cron_base_url`, avec l'adresse de votre site.

> **Sans barre oblique à la fin.** `https://microsoft.skilloria.io` — pas `https://microsoft.skilloria.io/`.
> Avec la barre, les adresses appelées contiendraient un double `//` et l'appel échouerait.

**Comment savoir que c'est bon :**
1. Supabase → **SQL Editor** → collez ceci et lancez :
   ```sql
   select name, length(decrypted_secret) as longueur
     from vault.decrypted_secrets
    where name in ('cron_secret', 'purge_cron_base_url');
   ```
2. Vous devez voir **deux lignes**, chacune avec une `longueur` supérieure à zéro.

Si une ligne manque ou si `longueur` vaut 0, le secret n'est pas posé — reprenez.

> **Ne collez jamais le secret lui-même dans une requête pour « vérifier ».** La requête ci-dessus ne montre que la longueur, volontairement.

---

# ÉTAPE 4 — Régler l'authentification

Ces réglages vivent dans votre compte Supabase et **ne sont pas repris par les mises à jour**. Ils sont à refaire à la main sur chaque environnement.

Supabase → **Authentication** → **URL Configuration** :

1. **Site URL** : l'adresse de votre site, par exemple `https://microsoft.skilloria.io`.
2. **Redirect URLs** : ajoutez une ligne **par écosystème, par langue et par chemin** — Supabase refuse toute adresse absente de cette liste, et le lien reçu par e-mail tomberait dans le vide.

   Il y a **deux chemins**, et oublier le second est invisible jusqu'au jour où quelqu'un perd son mot de passe :

   ```
   https://microsoft.skilloria.io/fr/auth/callback
   https://microsoft.skilloria.io/en/auth/callback
   https://microsoft.skilloria.io/es/auth/callback
   https://microsoft.skilloria.io/de/auth/callback
   https://microsoft.skilloria.io/fr/nouveau-mot-de-passe
   https://microsoft.skilloria.io/en/nouveau-mot-de-passe
   https://microsoft.skilloria.io/es/nouveau-mot-de-passe
   https://microsoft.skilloria.io/de/nouveau-mot-de-passe
   ```
   *Remplacez `microsoft` par le sous-domaine de chaque écosystème actif, et répétez les quatre langues.*

   | Chemin | Ce qui l'emprunte | Ce qui casse s'il manque |
   |---|---|---|
   | `/auth/callback` | confirmation d'inscription | personne ne peut créer de compte |
   | `/nouveau-mot-de-passe` | mot de passe oublié **et invitation d'un administrateur** | personne ne peut reprendre son compte, **et l'étape 7 ne peut pas aboutir** |

   > **C'est ce second chemin qui rend l'étape 7 possible.** L'invitation d'un administrateur passe exactement par là : sans cette ligne, le lien envoyé au premier administrateur est refusé par Supabase.

Supabase → **Authentication** → **Emails** :

3. **SMTP** : renseignez votre fournisseur d'envoi. Sans SMTP propre, Supabase utilise un service de démonstration **limité à quelques messages par heure** — largement insuffisant, et les inscriptions échoueraient sans message clair.
4. **Gabarits d'e-mail** : relisez au minimum « Confirm signup » et « Reset password ». Ils partent en anglais par défaut.

**Comment savoir que c'est bon :** créez un compte de test depuis le site, avec une adresse que vous relevez. Vous devez recevoir l'e-mail, et le lien doit vous ramener **sur votre site**, connecté. Si le lien vous envoie ailleurs ou affiche une erreur, la liste des **Redirect URLs** est incomplète.

---

# ÉTAPE 5 — Poser les variables d'environnement

Vercel → votre projet → **Settings** → **Environment Variables**.

> **Chaque variable est posée pour un environnement précis** : *Production*, *Preview*, ou les deux. Une variable posée sur le mauvais environnement ne sert à rien — et, pour les clés Stripe, c'est dangereux.

### Indispensables — sans elles, l'application ne fonctionne pas

| Variable | Ce que c'est |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | adresse de votre base |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé publique de la base |
| `SUPABASE_SERVICE_ROLE_KEY` | clé privée de la base — **ne la partagez jamais** |
| `SUPABASE_JWT_SECRET` | secret de signature des sessions |
| `NEXT_PUBLIC_SITE_URL` | l'adresse de votre site, sans barre oblique finale |
| `CRON_SECRET` | **la même valeur** que le secret `cron_secret` du coffre-fort (étape 3) |

> **`NEXT_PUBLIC_SITE_URL` n'est pas optionnelle en production.**
> C'est elle qui construit les liens de **tous** les e-mails : approbation d'un expert, refus d'une organisation, invitation à rejoindre une équipe, notifications, et l'avertissement d'inactivité à 23 mois.
> Si elle manque en production, **ces e-mails ne partent plus du tout** — c'est volontaire : un message contenant un lien mort est pire qu'un message absent. Vous le verrez dans les journaux Vercel, sous la mention `origine du site inconnaissable`.

### Services externes

| Variable | À quoi ça sert | Si elle manque |
|---|---|---|
| `ANTHROPIC_API_KEY` | analyse des CV, vérifications, jugement des candidatures | ces fonctions répondent « indisponible » |
| `COHERE_API_KEY` | moteur de mise en relation | aucune mise en relation |
| `RESEND_API_KEY` · `RESEND_FROM_EMAIL` | envoi des e-mails | aucun e-mail |
| `SIRENE_API_TOKEN` | vérification des entreprises françaises | la vérification passe en revue manuelle |
| `VONAGE_API_KEY` · `VONAGE_API_SECRET` · `VONAGE_SMS_FROM` | code de confirmation par SMS | aucune inscription possible |
| `PHONE_OTP_HMAC_SECRET` · `REAUTH_HMAC_SECRET` | signature des codes de confirmation | les codes sont refusés |
| `DEV_DOMAIN_SLUG` | **développement uniquement** | *ne pas poser en production* |

### Interrupteurs

Ces quatre variables **doivent valoir exactement le mot `true`**, en minuscules. Toute autre valeur — `TRUE`, `1`, `oui`, un espace en trop — **éteint** la fonction.

| Variable | Ce qu'elle ouvre |
|---|---|
| `ENABLE_AI_CV_PARSING` | l'analyse des CV |
| `ENABLE_AI_CANDIDATURE_ASSESSMENT` | le résumé d'une candidature |
| `ENABLE_RERANKING` | **la mise en relation — voir l'encadré ci-dessous, c'est BLOQUANT** |
| `ENABLE_BILLING` | **le paiement — à laisser absente tant que le lancement est gratuit** |

> ### ⛔ `ENABLE_RERANKING` et `COHERE_API_KEY` — SANS ELLES, LE PRODUIT NE FAIT PLUS RIEN
>
> Ce n'est pas une fonction parmi d'autres : c'est **la** fonction. Sans ces deux variables,
> **aucun expert et aucune organisation ne reçoit la moindre proposition, dans aucun écosystème**.
>
> **Et rien ne le dit.** C'est ce qui rend cette panne différente des autres, et c'est mesuré :
> le 21/09/2026, les deux étaient absentes sur l'environnement de test. Le moteur s'arrêtait
> proprement, en quelques millisecondes, en écrivant sa raison dans une note de journal que
> personne ne lit. Tous les compteurs de supervision restaient **verts** — zéro panne, zéro lot en
> échec, zéro dépassement — parce que **rien n'était tenté**. Et chaque écran présentait ce silence
> comme un verdict : « aucune mission ne correspond à votre profil ».
>
> **Un moteur éteint ne produit aucune erreur. C'est exactement ce qui le rend invisible.**
>
> Depuis, `/admin/supervision` affiche les deux cas **en BLOQUANT, en tête de liste**, séparément —
> l'interrupteur fermé et la clé absente appellent deux gestes différents.
>
> **À vérifier le jour de la mise en production, avant tout le reste :**
> 1. `ENABLE_RERANKING` vaut **exactement `true`**, sur Production **et** sur Preview.
> 2. `COHERE_API_KEY` est posée, sur les deux environnements.
> 3. Ouvrez `/admin/supervision` : **aucune ligne rouge ne doit mentionner le moteur.**

> **Une variable absente éteint la fonction.** C'est délibéré : laisser une intelligence artificielle tourner par accident coûte de l'argent et envoie des données à un tiers ; la laisser éteinte par accident ne fait que priver d'une fonction, visiblement, et se corrige en une variable.
> Conséquence : il faut les poser **sur Production ET sur Preview** pour qu'elles fonctionnent des deux côtés.

### Les clés Stripe — le contrôle va dans les deux sens

Tant que le lancement est gratuit, **aucune clé Stripe sur Production**. Quand viendra le moment :

| Environnement | Clé attendue | Ce qui arrive si vous vous trompez |
|---|---|---|
| Production | `sk_live_…` ou `rk_live_…` | une clé de **test** en production : les clients croient payer, **rien n'est encaissé** |
| Preview | `sk_test_…` ou `rk_test_…` | une clé **live** hors production : vos tests **débitent de vraies cartes** |

**Les deux erreurs sont refusées durement par l'application** — elle répond « clé incohérente avec l'environnement » plutôt que d'encaisser de travers. C'est un filet, pas une permission de se tromper.

`STRIPE_WEBHOOK_SECRET` : il y en a **un par point de réception**, et celui du bac à sable est **différent** de celui du live. Voir [docs/stripe-premier-paiement.md](stripe-premier-paiement.md).

**Comment savoir que c'est bon :** après avoir posé les variables, **relancez un déploiement** (les variables ne sont lues qu'au démarrage). Puis ouvrez le site : il doit s'afficher aux **couleurs de votre écosystème**, pas en gris neutre. Créez un compte de test : vous devez recevoir le SMS de confirmation, puis l'e-mail.

---

# ÉTAPE 6 — Brancher les sous-domaines

Chaque écosystème est servi par **son propre sous-domaine**. C'est le sous-domaine qui dit à l'application quel écosystème afficher — il n'y a **aucun réglage** pour cela, et aucun nom n'est écrit dans le code.

Pour **chaque** ligne active de la table `domains` :

1. Vercel → votre projet → **Settings** → **Domains** → **Add**.
2. Saisissez `<slug>.skilloria.io`, où `<slug>` est **exactement** la valeur de la colonne `slug`.
3. Suivez les instructions DNS affichées par Vercel.

**Comment savoir que c'est bon :** ouvrez `https://<slug>.skilloria.io`. Le site s'affiche **aux couleurs de cet écosystème**, avec ses libellés.

> **Si le site s'affiche en gris neutre**, c'est que le sous-domaine n'a pas été reconnu : ou bien il n'est pas branché chez Vercel, ou bien le `slug` ne correspond pas à la ligne de la table `domains`. L'application ne plante pas — elle retombe sur un affichage neutre. **C'est confortable et trompeur : vérifiez toujours les couleurs.**

---

# ÉTAPE 7 — Créer le premier administrateur

**Sur une production neuve, personne ne peut administrer le site.** Il n'y a aucun compte administrateur, et **aucun écran ne permet d'en créer un** : l'écran qui le fait est dans le back-office, et le back-office demande d'être déjà administrateur.

Cette étape est donc la seule de ce document qui ne se fasse pas depuis une interface. Elle se fait **une fois**, et une seule.

> **Pourquoi une inscription normale ne suffit pas.** Si vous créez un compte depuis le site puis essayez de le passer « administrateur », vous obtenez un compte à moitié créé : la base sait créer un expert, un CDI, une entreprise ou un cabinet, et **rien d'autre**. Pour tout autre rôle elle n'échoue pas — elle se tait, et laisse un compte qui ne peut plus se connecter **et qui occupe l'adresse e-mail**. C'est exactement ce que la commande ci-dessous évite.

### Ce dont vous avez besoin

- une copie du dépôt sur votre machine, et `node` installé ;
- un fichier `.env.local` contenant `NEXT_PUBLIC_SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` **de la production** ;
- le **slug** de l'écosystème (celui que vous avez vérifié à l'étape 2), par exemple `microsoft` ;
- l'adresse e-mail réelle du premier administrateur — c'est là qu'arrivera le lien.

### La commande

```bash
node --env-file=.env.local scripts/creer-premier-administrateur.mjs \
     --email=vous@exemple.fr --prenom=Prénom --nom=Nom \
     --ecosysteme=microsoft --db
```

> **Sans `--db`, rien n'est écrit.** Le script vous annonce d'abord, table par table, ce qu'il ferait, et s'arrête. Lancez-le d'abord sans le drapeau : c'est la relecture, pas une perte de temps.

**L'écosystème n'accorde aucun droit.** Un administrateur est **de la plateforme** : il voit tous les écosystèmes. Le slug sert seulement à rattacher le compte à une ligne existante.

### Comment savoir que c'est bon

Le script affiche `ADMINISTRATEUR CRÉÉ`, avec l'identifiant du compte et la mention **`siège plateforme : POURVU`**.

Ce second point n'est pas décoratif : c'est la garantie « la plateforme ne peut plus tomber à zéro administrateur ». Si vous lisez autre chose, **ne continuez pas** — le compte fonctionne, mais il n'est plus protégé contre sa propre suppression.

### Ouvrir la session

Le compte **n'a pas encore de mot de passe**, et c'est voulu : aucun secret n'a été affiché ni écrit dans un journal.

1. Ouvrez le site, cliquez sur **Mot de passe oublié**.
2. Saisissez l'adresse que vous venez d'utiliser.
3. Suivez le lien reçu, choisissez votre mot de passe.

**Si le lien affiche une erreur d'adresse invalide** : il manque les lignes `/nouveau-mot-de-passe` dans les **Redirect URLs** de l'étape 4. C'est le chemin qu'emprunte toute réinitialisation — et toute invitation d'administrateur.

### Et ensuite

Les administrateurs suivants **ne passent plus par là**. Ils se créent depuis **/admin/utilisateurs → Créer un administrateur**, qui demande une re-saisie du mot de passe et laisse une trace nominale — deux choses que cette commande ne peut pas faire, puisqu'au moment où on la lance il n'y a personne pour s'authentifier.

**Le script refuse de servir une seconde fois** : s'il trouve déjà un administrateur, il s'arrête et vous renvoie vers l'écran.

---


# ÉTAPE 8 — Vérifier que les tâches planifiées tournent vraiment

Poser les secrets ne prouve pas qu'ils sont **bons**. Un secret différent de celui de Vercel donnerait un refus poli, invisible.

1. Ouvrez l'application, connectez-vous en administrateur.
2. Allez sur **/admin/taches-planifiees**.
3. Vous devez voir **neuf** tâches.
4. Choisissez `matching_retry_trigger` — c'est la moins risquée à déclencher : si elle n'a rien à faire, elle ne fait rien.
5. Cliquez sur **Exécuter maintenant**.
6. Attendez une minute, puis ouvrez l'historique de cette tâche.

**Comment savoir que c'est bon :** la dernière exécution montre un appel qui a **abouti**, avec un code de réponse `200`.

**Si vous voyez `401`** : le `cron_secret` du coffre-fort ne correspond pas au `CRON_SECRET` de Vercel. Reprenez l'étape 3, en recopiant la valeur **exactement** (attention aux espaces ajoutés par le copier-coller).

**Si vous voyez une erreur de connexion** : `purge_cron_base_url` est faux, ou porte une barre oblique finale.

> **Pourquoi ce détour ?** La base envoie sa demande et n'attend pas la réponse. La liste des exécutions dirait donc « réussi » même sur un refus. Seul l'historique détaillé porte le vrai code.

---

## Récapitulatif — la liste à cocher

- [ ] Les migrations sont passées, et la ligne `PARAMETRAGE —` affiche des nombres
- [ ] `domains`, `branches`, `specialities`, `countries`, `verification_providers`, `translations` ne sont pas vides
- [ ] Les deux secrets du coffre-fort existent, avec une longueur non nulle
- [ ] Une tâche déclenchée à la main répond `200` dans son historique
- [ ] **Site URL** et **Redirect URLs** sont renseignées, quatre langues par écosystème
- [ ] Le SMTP est réglé, et un e-mail de test est bien reçu
- [ ] Les variables indispensables sont posées sur **Production**
- [ ] `NEXT_PUBLIC_SITE_URL` est posée — sinon aucun e-mail ne part
- [ ] `CRON_SECRET` (Vercel) et `cron_secret` (coffre-fort) sont **identiques**
- [ ] Les interrupteurs voulus valent exactement `true`
- [ ] **Aucune** clé Stripe sur Production tant que le lancement est gratuit
- [ ] Un sous-domaine par écosystème actif, et le site s'affiche à ses couleurs

---

## En cas de doute

**Arrêtez-vous et demandez.** Aucune de ces étapes n'est urgente au point de valoir un secret posé de travers.

Deux repères pour situer un problème :

- **Le site s'affiche mais tout est gris** → sous-domaine (étape 6) ou paramétrage (étapes 1-2).
- **Le site s'affiche bien mais l'inscription échoue** → variables d'environnement (étape 5) ou réglages d'authentification (étape 4).
