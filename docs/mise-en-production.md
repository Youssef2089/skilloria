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

## ⚠️ Avant la vraie bascule : ce que Vercel sert sous « Production »

**Le fait (constat de Youssef, 29/09/2026 — NON VÉRIFIÉ dans le dépôt, c'est un réglage Vercel).** Vercel met en ligne
**tout envoi sur `main`** sous l'étiquette « Production ». La version servie aujourd'hui date du **29 avril**
(`68622f9`, la fusion des Voies 1 et 3), sur `skilloria-chi.vercel.app`.

**Ce que ça veut dire.**
- **Fusionner la branche de travail dans `main` la mettrait en ligne À L'INSTANT** — avant les migrations de la base
  de production, avant ses secrets (`cron_secret`, `inscription_hmac_secret`…), avant ses variables. C'est l'inverse
  de la séquence de déploiement (§G.4 ter : la base d'abord, le code aussitôt après), et rien ne l'empêche.
- **Une version d'avril est publique** sur l'alias `.vercel.app`, et elle parle à une base (laquelle : NON VÉRIFIÉ).
- Sur cet alias, depuis §E.83, le site ne devine aucun écosystème : `.vercel.app` en production ne se résout pas.

**Les options.**
- **A — une branche de production dédiée** : Vercel → Settings → Git → **Production Branch** = `production` (une
  branche qu'on crée le jour de la bascule). `main` redevient une branche de Preview ; mettre en production devient
  un geste EXPLICITE (fusionner vers `production`), placé dans la séquence, après la base.
- **B — bloquer le déploiement de `main`** (« Ignored Build Step ») jusqu'à la bascule : efficace, mais un réglage
  qu'on oubliera de retirer, et qui ne dit pas pourquoi.
- **C — protéger la Production actuelle** : Settings → Deployment Protection → **Vercel Authentication** sur la
  Production, pour que la version d'avril ne soit plus publique.

**Recommandation : A et C, avant la bascule.** A fait de la mise en production un acte délibéré qui suit la base ;
C retire du public une version de cinq mois dont on ne sait pas à quelle base elle parle. B n'apporte rien que A ne
donne mieux. **Rien n'est touché ici** : c'est un réglage du projet Vercel, à décider par Youssef.

---

## L'ordre des opérations

Neuf étapes, de 0 à 8. **L'ordre compte** : chacune suppose la précédente.

| | Étape | Où |
|---|---|---|
| 0 | Faire naître la base sur une version de Postgres corrigée | Supabase → Infrastructure |
| 1 | Appliquer les mises à jour de base | Base de données |
| 2 | Vérifier que le paramétrage est bien arrivé | Base de données |
| 3 | Poser les trois secrets du coffre-fort | Supabase → Vault |
| 4 | Régler l'authentification | Supabase → Authentication |
| 5 | Poser les variables d'environnement | Vercel |
| 6 | Les adresses : relier `*.<racine>` à Vercel | Vercel + DNS |
| 7 | Créer le premier administrateur | Votre machine (une fois) |
| 8 | Vérifier que les tâches planifiées tournent | Supabase |

---

# ÉTAPE 0 — Faire naître la base sur une version de Postgres corrigée

En **17.6.1.104**, un défaut de la plateforme (supautils) **tue le serveur** quand un utilisateur connecté appelle
une fonction qui lui est refusée — et toutes nos fonctions sensibles le sont. Un seul appel suffirait à redémarrer
la base pour tout le monde. C'est corrigé à partir de **17.6.1.121** (constaté sur staging le 28/09/2026, §E.76).

1. Supabase → **Project Settings** → **Infrastructure** : notez la version de Postgres. Si elle est inférieure à
   17.6.1.121, cliquez **Upgrade** avant toute autre étape.
2. Sur votre machine, reliez le projet (`npx supabase link --project-ref <réf. de production>`), puis lancez
   `node scripts/verifier-version-postgres.mjs`.

**Comment savoir que c'est bon :** la commande affiche `✅ Postgres 17.6.1.x ≥ 17.6.1.121`. Si elle affiche `✘`,
arrêtez-vous : mettez la base à jour, reliez à nouveau, relancez.

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

# ÉTAPE 3 — Poser les trois secrets du coffre-fort

**C'est l'étape la plus facile à oublier, et la plus coûteuse.**

La base déclenche elle-même cinq tâches en appelant l'application par Internet. Pour cela, il lui faut deux informations qui **changent d'un environnement à l'autre** et qui ne doivent donc **jamais** être écrites dans le dépôt :

| Nom du secret | Ce que c'est |
|---|---|
| `cron_secret` | le **même** mot de passe que la variable `CRON_SECRET` de Vercel, au caractère près |
| `purge_cron_base_url` | l'adresse de votre site, **sans barre oblique finale** — par exemple `https://microsoft.skilloria.io` |
| `inscription_hmac_secret` | le **même** mot de passe que la variable `INSCRIPTION_HMAC_SECRET` de Vercel, au caractère près (32 caractères au moins). **Sans lui, aucune inscription n'aboutit** : la base refuse tout compte dont elle ne peut pas vérifier la preuve (§D.27) |

### Ce qui se passe si vous les oubliez

**Six** des douze tâches planifiées s'arrêtent net à chaque déclenchement :

| Tâche | Ce qu'elle fait | Conséquence si elle ne tourne pas |
|---|---|---|
| `purge_deletions_trigger` | efface les comptes dont la suppression demandée est échue | **Obligation légale (RGPD art. 17)** non tenue |
| `purge_inactive_trigger` | avertit à 23 mois, efface à 24 | **Obligation légale (CNIL)** non tenue |
| `matching_retry_trigger` | reprend les mises en relation inachevées | des annonces sans candidats, sans explication |
| `expert_relance_trigger` | applique les modifications de profil en attente | des experts dont les changements ne sont jamais pris en compte |
| `stripe_reconcile_trigger` | compare chaque nuit les événements de paiement produits par Stripe à ceux que le site a reçus | un événement de paiement perdu **n'est jamais signalé** — et Stripe ne conserve les siens que 30 jours, au-delà il est introuvable |
| `constats_trigger` | constate chaque nuit les annonces expirées et les échanges refermés, et l'écrit au grand livre | le grand livre ne dit jamais qu'une annonce a expiré ni qu'un échange s'est refermé : l'histoire a des trous |

Ces tâches **ne se plaignent pas à l'écran**. Elles lèvent une erreur que seul le journal technique de la base porte. **Vous pourriez ne rien remarquer pendant des mois.**

**La douzième, `travaux_ia_pilote`, ne s'arrête pas — et c'est pire, parce qu'elle a l'air de marcher.** Chaque minute, elle réveille l'exécutant des travaux d'IA (l'analyse d'un CV, la vérification d'un expert). Sans ces secrets, le réveil n'arrive jamais : **aucun CV n'est analysé, aucun expert n'est vérifié**. Au bout de 30 minutes, elle clôt chaque travail resté en file, avec la cause `non_execute` : l'expert voit « l'analyse n'a pas pu aboutir », la vérification part en revue humaine. **L'écran /admin/travaux-ia les liste, et la supervision le dit en BLOQUANT** (§D.30).

Les cinq autres tâches (`cron_run_reconcile`, `cron_run_log_purge`, `rate_limit_hits_purge`, `matching_notes_partielles_purge`, `ip_retention_purge`) travaillent uniquement dans la base et **ne dépendent pas** de ces secrets.

### Comment les poser

1. Supabase → **Project Settings** → **Vault** (ou **Integrations → Vault** selon la version).
2. **New secret**.
3. Dans **Name**, tapez exactement `cron_secret`. Dans **Secret**, collez la valeur de `CRON_SECRET`.
4. Enregistrez.
5. Recommencez pour `purge_cron_base_url`, avec l'adresse de votre site.
6. Recommencez pour `inscription_hmac_secret`, avec la valeur de `INSCRIPTION_HMAC_SECRET`. Pour en fabriquer une :
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — puis la même valeur sur Vercel (étape 5).

> **Sans barre oblique à la fin.** `https://microsoft.skilloria.io` — pas `https://microsoft.skilloria.io/`.
> Avec la barre, les adresses appelées contiendraient un double `//` et l'appel échouerait.

**Comment savoir que c'est bon :**
1. Supabase → **SQL Editor** → collez ceci et lancez :
   ```sql
   select name, length(decrypted_secret) as longueur
     from vault.decrypted_secrets
    where name in ('cron_secret', 'purge_cron_base_url', 'inscription_hmac_secret');
   ```
2. Vous devez voir **trois lignes**, chacune avec une `longueur` supérieure à zéro.

Si une ligne manque ou si `longueur` vaut 0, le secret n'est pas posé — reprenez.

> **Ne collez jamais le secret lui-même dans une requête pour « vérifier ».** La requête ci-dessus ne montre que la longueur, volontairement.

---

# ÉTAPE 4 — Régler l'authentification

Ces réglages vivent dans votre compte Supabase et **ne sont pas repris par les mises à jour**. Ils sont à refaire à la main sur chaque environnement.

Supabase → **Authentication** → **URL Configuration** :

1. **Site URL** : l'adresse d'un écosystème actif **de cet environnement** — en production `https://<écosystème>.skilloria.io`, sur staging `https://<écosystème>.staging.skilloria.io` (étape 6, « Les adresses »). Ce n'est qu'un repli : le code donne toujours lui-même l'adresse de retour.
2. **Redirect URLs** : **deux lignes par environnement**, une par chemin. Supabase refuse toute adresse absente de cette liste, et le lien reçu par e-mail tomberait dans le vide.

   Il y a **deux chemins**, et oublier le second est invisible jusqu'au jour où quelqu'un perd son mot de passe.

   Projet Supabase de **production** :
   ```
   https://*.skilloria.io/*/auth/callback
   https://*.skilloria.io/*/nouveau-mot-de-passe
   ```
   Projet Supabase de **staging** :
   ```
   https://*.staging.skilloria.io/*/auth/callback
   https://*.staging.skilloria.io/*/nouveau-mot-de-passe
   ```

   **Pourquoi deux lignes suffisent, et pourquoi elles ne laissent rien passer d'autre** (documentation Supabase, *Redirect URLs*, lue le 29/09/2026) : dans ces motifs, `*` remplace une suite de caractères **sans `.` ni `/`**. Le premier `*` est donc **un seul label** — le nom de l'écosystème, exactement la règle du site (étape 6) — et le second **un seul segment** : la langue. `https://microsoft.staging.skilloria.io/fr/auth/callback` passe ; deux labels devant la racine, une autre racine ou un autre chemin ne passent pas. Une adresse de staging ne passe pas non plus le motif de production : `*` ne traverse pas le point de `.staging`. **Un écosystème créé dans l'administration n'ajoute aucune ligne ici.**

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

> **LA LISTE QUI FAIT FOI : [lib/configuration/variables.ts](../lib/configuration/variables.ts)** (§E.86). Chaque
> variable que le code lit y est, avec son rôle et ce qui casse sans elle — un contrôle rougit si le code en lit une
> autre. **Au démarrage d'un environnement déployé**, chaque variable EXIGÉE qui manque est nommée dans les journaux
> Vercel (`[configuration] <NOM> — absente`, code `variable_manquante`), et `/admin/supervision` l'affiche en
> **BLOQUANT**. Les tableaux ci-dessous en sont la lecture pour un humain. Une variable exigée va sur **Production ET
> Preview** : staging se comporte comme la production (§E.83).

### Indispensables — sans elles, l'application ne fonctionne pas

| Variable | Ce que c'est |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | adresse de votre base |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé publique de la base |
| `SUPABASE_SERVICE_ROLE_KEY` | clé privée de la base — **ne la partagez jamais** |
| `SUPABASE_JWT_SECRET` | secret de signature des sessions |
| `NEXT_PUBLIC_DOMAINE_RACINE` | **la racine des adresses de CET environnement** : `skilloria.io` sur **Production**, `staging.skilloria.io` sur **Preview** — jamais un nom d'écosystème (étape 6, « Les adresses ») |
| `NEXT_PUBLIC_SITE_URL` | l'adresse de votre site, sans barre oblique finale |
| `CRON_SECRET` | **la même valeur** que le secret `cron_secret` du coffre-fort (étape 3) |
| `INSCRIPTION_HMAC_SECRET` | **la même valeur** que le secret `inscription_hmac_secret` du coffre-fort (étape 3) — sans elle, les formulaires d'inscription répondent « momentanément indisponible » |

> **`NEXT_PUBLIC_DOMAINE_RACINE` : posez-la AVANT de déployer, sur Production ET sur Preview.**
> Sans elle, un environnement déployé ne sert **aucune page** : le serveur s'arrête en nommant la variable. C'est voulu — une configuration absente n'est pas « aucun écosystème », et un site qui s'afficherait gris sur toutes ses adresses tromperait bien plus longtemps. Elle commence par `NEXT_PUBLIC_` parce que le sélecteur d'écosystème, dans le navigateur, construit les adresses avec la même règle : sa valeur est **inscrite au moment de la construction**. Après l'avoir posée ou changée, **redéployez**.

> **`NEXT_PUBLIC_SITE_URL` n'est pas optionnelle en production.**
> Avec la racine, c'est elle qui autorise les liens de **tous** les e-mails : approbation d'un expert, refus d'une organisation, invitation à rejoindre une équipe, invitation d'un administrateur, notifications, et l'avertissement d'inactivité à 23 mois. Les liens eux-mêmes pointent vers **l'adresse de l'écosystème du destinataire**, `https://<écosystème>.<racine>` : depuis staging, vers staging.
> Si l'une des deux manque en production, **ces e-mails ne partent plus du tout** — c'est volontaire : un message contenant un lien mort est pire qu'un message absent. Vous le verrez dans les journaux Vercel, sous la mention `origine du site inconnaissable` ou le code `domaine_racine_absent`.

> **`DEV_DOMAIN_SLUG` ne se pose sur AUCUN environnement Vercel** (décision de Youssef, 29/09/2026). Elle ne sert
> qu'au poste local, où `localhost` n'a pas de sous-domaine. Staging se comporte **exactement** comme la production :
> l'écosystème se lit dans l'adresse (étape 6). Si elle a été posée sur *Preview*, retirez-la : elle n'y est plus lue.

### Services externes

| Variable | À quoi ça sert | Si elle manque |
|---|---|---|
| `ANTHROPIC_API_KEY` | analyse des CV, vérifications, jugement des candidatures | ces fonctions répondent « indisponible » |
| `COHERE_API_KEY` | moteur de mise en relation | aucune mise en relation |
| `RESEND_API_KEY` · `RESEND_FROM_EMAIL` | envoi des e-mails | aucun e-mail |
| `SIRENE_API_TOKEN` | vérification des entreprises françaises | la vérification passe en revue manuelle |
| `VONAGE_API_KEY` · `VONAGE_API_SECRET` · `VONAGE_SMS_FROM` | code de confirmation par SMS | aucune inscription possible |
| `PHONE_OTP_HMAC_SECRET` · `REAUTH_HMAC_SECRET` | signature des codes de confirmation | les codes sont refusés |
| `DEV_DOMAIN_SLUG` | **poste local uniquement** (`.env.local`) | *ne la posez sur aucun environnement Vercel : elle n'y est pas lue* |

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

### Chez Vonage — ce qu'aucune variable ne dit

Le code SMS passe par **Vonage Verify v2**. Trois réglages vivent dans le compte Vonage, pas dans le dépôt :

| Réglage | Ce qui arrive s'il manque | Ce que disent les journaux Vercel |
|---|---|---|
| **Les clés API** (`VONAGE_API_KEY`, `VONAGE_API_SECRET`) sont celles du tableau de bord Vonage, copiées sans espace | refus des identifiants | `[otp] … — vonage_identifiants_refuses` |
| **Le solde du compte** est positif | plus aucun SMS | `[otp] … — vonage_credit_insuffisant` |
| **Le pays du numéro** est desservi par Verify (la Tunisie, +216, ne l'est pas : liste propre à Verify, levée par un ticket au support — architecture §H) | le SMS ne part pas vers ce pays | `[otp] … — vonage_destination_refusee` ou `vonage_antifraude` |

L'écran, lui, dit « de notre côté » pour les deux premiers, « pays non desservi » pour le troisième, et **« temporairement
indisponible » seulement pour une vraie panne de Vonage** (`vonage_panne`, `vonage_injoignable`, `vonage_delai_depasse`).

**Comment savoir que c'est bon :** après avoir posé les variables, **relancez un déploiement** (les variables ne sont lues qu'au démarrage). Ouvrez `/admin/supervision` : **aucune ligne « variable manquante »**. Puis ouvrez le site : il doit s'afficher aux **couleurs de votre écosystème**, pas en gris neutre. Créez un compte de test : vous devez recevoir le SMS de confirmation, puis l'e-mail.

---

# ÉTAPE 6 — Les adresses

## La règle — une seule, pour la production et pour staging

Une adresse est `<écosystème>.<racine>` : **un seul label devant la racine**, et ce label est **exactement** la colonne `slug` de la table `domains`. C'est l'adresse qui dit à l'application quel écosystème afficher — il n'y a aucun autre réglage, et aucun nom n'est écrit dans le code (`lib/subdomain.ts`, une fonction pour tous les environnements).

| Environnement | Racine (`NEXT_PUBLIC_DOMAINE_RACINE`) | Adresse d'un écosystème | Ce qui la sert |
|---|---|---|---|
| Production | `skilloria.io` | `https://microsoft.skilloria.io` | Vercel, environnement **Production** |
| Staging | `staging.skilloria.io` | `https://microsoft.staging.skilloria.io` | Vercel, environnement **Preview**, branche de test |
| Poste local | *(aucune)* | `http://localhost:3000` | `DEV_DOMAIN_SLUG`, dans `.env.local` seulement |

- **Seule la racine diffère** d'un environnement à l'autre. Aucun nom d'écosystème dans une variable déployée.
- **Un écosystème créé dans l'administration a son adresse dès qu'il existe**, sur staging comme en production : aucun domaine à ajouter chez Vercel, aucune ligne chez Supabase, aucune variable.
- **Une adresse qui ne porte pas d'écosystème ne résout rien** : la racine seule, deux labels devant elle, les adresses aléatoires `…vercel.app` d'une Preview. Le site s'y affiche en gris neutre, et le formulaire d'inscription dit que l'adresse ne correspond à aucun espace (code `ecosysteme_non_resolu` dans les journaux Vercel). **Les essais se font sur une adresse de staging, jamais sur un lien `…vercel.app`.**
- **Les liens des e-mails** — confirmation d'inscription, invitations, notifications, approbation, avertissement d'inactivité — pointent vers `https://<écosystème du destinataire>.<racine>` : depuis staging, vers staging ; jamais vers la production, jamais vers une adresse aléatoire.
- **Le sélecteur d'écosystème reste dans son environnement** : depuis `microsoft.staging.skilloria.io`, il mène à `sap.staging.skilloria.io`.
- Le cookie de session de staging porte un autre nom que celui de la production (`ss_token_staging`) : se connecter à staging ne déconnecte personne de la production.

## Le sous-domaine d'un écosystème se règle dans l'administration

Le label devant la racine est le **sous-domaine** de l'écosystème : Administration → **Écosystèmes** → **Modifier** →
section **Sous-domaine**. Il se choisit à la création et **se change ensuite** au même endroit (§D.28). L'identifiant
technique de l'écosystème, lui, ne change jamais : comptes, organisations, annonces, grand livre restent rattachés.

- **La forme** : minuscules, chiffres et tirets, 63 caractères au plus, sans point ni espace, ni tiret au début ou à la
  fin. **Unique** : deux écosystèmes ne portent jamais le même. La base refuse le reste, l'écran le dit à la saisie.
- **Ne choisissez pas `www` ni `staging`** en production : `staging.skilloria.io` est la racine de staging, et `www`
  a souvent son propre enregistrement — un écosystème ainsi nommé serait injoignable. Rien dans le code ne l'interdit
  (aucune liste écrite en dur) : c'est une règle de cette page.

**Ce qu'un changement de sous-domaine déplace — l'écran le fait lire avant de confirmer :**

| Ce qui existait | Ce qu'il devient |
|---|---|
| **L'ancienne adresse** (`https://<ancien>.<racine>`) | Elle affiche la page **neutre** de Skilloria. **Aucune redirection** vers la nouvelle. |
| **Les liens des e-mails déjà envoyés** — confirmation d'inscription, invitations, approbations, notifications, avertissement d'inactivité | Ils mènent à l'ancienne adresse, qui s'affiche neutre. Une inscription d'**expert** ou d'**organisation** y est **refusée** (« cet espace n'accepte pas d'inscription »). La création du compte d'un **invité** lit l'écosystème de l'organisation, pas l'adresse : elle aboutit — la personne se connecte ensuite à la nouvelle adresse. Les e-mails suivants portent la nouvelle adresse. |
| **Les personnes connectées** | Le navigateur garde la session **par adresse** : à la nouvelle adresse, elles se **reconnectent** (NON MESURÉ en navigateur). Un onglet resté ouvert sur l'ancienne tombe sur « écosystème indisponible ». |
| **Une inscription en cours** à l'instant du changement | Elle échoue (sa preuve signée nomme l'ancien sous-domaine) : la personne recommence sur la nouvelle adresse. |
| **Supabase → Authentication → Site URL**, si elle nomme l'ancienne adresse | À mettre à jour à la main (étape 4). Les deux **Redirect URLs** génériques, elles, couvrent déjà la nouvelle. |
| **Vercel** | Rien à faire : l'adresse générique `*.<racine>` sert déjà la nouvelle adresse. |
| **Le poste local** | `DEV_DOMAIN_SLUG` (dans `.env.local`) désigne un sous-domaine réglé : mettez-le à jour. |

> **Changez un sous-domaine AVANT d'avoir envoyé des liens**, ou acceptez que ceux-ci cessent de marcher. C'est
> pourquoi le changement est un geste à part, confirmé — jamais un champ parmi d'autres du bouton « Enregistrer ».

## Comment relier ces adresses à Vercel — la voie retenue

Tout ce qui suit a été **lu dans la documentation de Vercel le 29/09/2026** (sources en fin de section). Ce qu'elle ne dit pas en toutes lettres est marqué **NON VÉRIFIÉ**.

| Voie | Ce que c'est | Coût (documentation Vercel) | Ce que ça change au DNS de `skilloria.io` | Verdict |
|---|---|---|---|---|
| **A — une adresse générique reliée à la branche de test** | `*.staging.skilloria.io` ajoutée au projet, rattachée à **Preview** et à la branche de test ; la validation du certificat générique est **déléguée** à Vercel | **aucun** — la branche de staging est « *All plans, including Hobby* » | **trois enregistrements AJOUTÉS** chez l'hébergeur DNS actuel, tous sous `staging.` ; rien ne déménage ; les enregistrements de Resend ne sont pas touchés | **RETENUE** |
| B — les serveurs de noms chez Vercel | toute la zone `skilloria.io` servie par `ns1.vercel-dns.com` / `ns2.vercel-dns.com` ; les adresses génériques marchent sans autre réglage | aucun | **toute la zone déménage** : chaque enregistrement existant — dont ceux de Resend (DKIM `resend._domainkey`, SPF, MX de retour : la liste exacte se lit dans l'onglet *Records* de Resend) — doit être recopié **avant** la bascule, sinon les e-mails partent non authentifiés. Vercel ne le fait pas pour vous : « *copy and verify the existing DNS records before switching* » | écartée : un risque sur les e-mails pour un gain nul |
| C — un projet Vercel dédié à staging | un second projet, dont la branche de production est la branche de test | aucun | comme A | **écartée : le code se tromperait d'environnement.** Dans ce projet, staging tournerait en `VERCEL_ENV=production` : `isProduction()` ([lib/env.ts](../lib/env.ts)) y serait vrai, et le verrou Stripe (§D.1) exigerait une clé **live** sur staging. Staging ne serait plus staging. |
| C bis — un environnement personnalisé `staging` | un environnement nommé, avec sa branche, son domaine, ses variables | plans **Pro et Enterprise** seulement (Pro : un par projet, sans surcoût) | comme A | écartée pour l'instant : il faut le plan Pro, et la valeur de `VERCEL_ENV` dans un environnement personnalisé n'est **pas documentée** (seule `VERCEL_TARGET_ENV` porte son nom) — **NON VÉRIFIÉ**, or `isProduction()` la lit. C'est la voie de repli si A est refusée par l'écran. |
| D — le suffixe de Preview | remplace `vercel.app` par un domaine à soi dans les adresses générées | **100 $ par mois** (option du plan Pro) | un générique et sa délégation | **écartée : elle ne donne pas la règle.** L'adresse générée est `<projet>-git-<branche>-<équipe>.<suffixe>` : le label devant la racine est le nom du **déploiement**, pas celui d'un écosystème — exactement la panne de §E.83. Sa variante « multi-tenant » (`<tenant>---<déploiement>.<suffixe>`) exigerait une seconde règle de lecture : staging ne se comporterait plus comme la production. |

### Staging — ce que Youssef fait, une fois

1. **La branche de test.** Celle que sert staging aujourd'hui (`feat/sprint-archi-orga`). *Conseil* : une branche durable nommée `staging`, dans laquelle on fusionne ce qu'on veut essayer — la recette de staging de la documentation Vercel en utilise une, et le réglage du domaine n'a plus à changer à chaque lot.
2. **L'adresse générique.** Vercel → le projet → **Settings** → **Domains** → **Add Domain** → `*.staging.skilloria.io`. Puis **Edit** sur ce domaine → **Connect to an environment** : **Preview**, **Git Branch** = la branche de test.
   > **NON VÉRIFIÉ** : la documentation décrit séparément l'ajout d'une adresse générique et le rattachement d'une adresse à une branche ; elle ne dit pas en toutes lettres que les deux se combinent. **Si l'écran le refuse, arrêtez-vous et dites-le** : la voie de repli est C bis, pas B.
3. **La délégation du certificat.** Vercel → **Domains** (de l'équipe) → `skilloria.io` → **Enable Vercel DNS**, *sans* changer les serveurs de noms chez le bureau d'enregistrement (la documentation : « *Keep your existing nameservers configured at your registrar* »).
4. **Trois enregistrements, chez l'hébergeur DNS ACTUEL de `skilloria.io`** (celui que nomme `dig NS skilloria.io +short`) :

   | Type | Nom (relatif à `skilloria.io`) | Valeur |
   |---|---|---|
   | `NS` | `_acme-challenge.staging` | `ns1.vercel-dns.com.` |
   | `NS` | `_acme-challenge.staging` | `ns2.vercel-dns.com.` |
   | `CNAME` | `*.staging` | `cname.vercel-dns-0.com.` — **ou** la valeur propre au projet si **Settings → Domains** en recommande une autre |

   Les deux `NS` laissent Vercel émettre et renouveler le certificat générique — **gardez-les en place** ; le `CNAME` amène les visiteurs. **Ce que ça change pour Resend : rien.** Aucun des trois ne touche un nom existant ; ils vivent tous sous `staging.`. La documentation prévient qu'une délégation de `_acme-challenge` empêche un **autre** hébergeur d'émettre un certificat pour les mêmes noms — ici, uniquement les noms en `.staging.skilloria.io`, que rien d'autre ne sert (**NON VÉRIFIÉ** : à confirmer d'un coup d'œil sur la zone).
5. **La racine.** Vercel → **Settings** → **Environment Variables** → **Preview** : `NEXT_PUBLIC_DOMAINE_RACINE` = `staging.skilloria.io`. Retirez `DEV_DOMAIN_SLUG` de Preview si elle y est.
6. **L'authentification du projet Supabase de staging** : la **Site URL** et les deux **Redirect URLs** de staging (étape 4).
6 bis. **La protection des déploiements de Vercel** (Settings → **Deployment Protection**). La protection *standard*
   couvre toutes les adresses **sauf la production** — donc `*.staging.skilloria.io` —, et après la connexion Vercel
   elle renvoie « *to the deployment URL* » : l'adresse `…vercel.app` de la branche, qui ne porte aucun écosystème
   (§E.85 ; documentation Vercel, *Vercel Authentication* et *Deployment Protection*, lue le 29/09/2026). Staging
   se comporte comme la production, qui n'est pas protégée : ajoutez l'adresse de staging aux **Deployment
   Protection Exceptions** (« *disable Deployment Protection for a list of preview domains* », sans supplément
   d'après la page des tarifs). **NON VÉRIFIÉ** : qu'une exception accepte le générique `*.staging.skilloria.io` —
   si l'écran le refuse, ajoutez l'adresse de chaque écosystème d'essai, ou désactivez la protection pour Preview.
   Décision à prendre en connaissance de cause : sans protection, staging est public (ses données sont des
   données d'essai).
7. **Redéployez** la branche de test, puis attendez dans **Settings → Domains** que `*.staging.skilloria.io` soit en configuration valide.

**Comment savoir que c'est bon :**
- `https://<un écosystème actif>.staging.skilloria.io/fr` s'affiche **à ses couleurs**, cadenas valide ;
- `https://<un nom qui n'existe pas>.staging.skilloria.io/fr` s'affiche **en gris neutre** — c'est la preuve que l'adresse est lue, et non devinée ;
- le formulaire « Créer un profil Expert » charge ses branches et spécialités ;
- l'enregistrement DKIM de Resend rend **la même valeur qu'avant** : `dig TXT <nom DKIM> +short`, où `<nom DKIM>` est celui de l'onglet *Records* de Resend (de la forme `resend._domainkey.<domaine d'envoi>` — le domaine d'envoi configuré chez Resend est **NON VÉRIFIÉ** dans le dépôt). Resend intact.

### La production — la même voie, répétée

Staging est la répétition : si la voie A y marche, la production est **le même geste avec une autre racine**.

1. `*.skilloria.io` ajoutée au projet, rattachée à **Production** (sans branche).
2. **Enable Vercel DNS** sur `skilloria.io` (déjà fait pour staging), serveurs de noms inchangés.
3. Chez l'hébergeur DNS actuel : `NS _acme-challenge` → `ns1.vercel-dns.com.` et `ns2.vercel-dns.com.` ; `CNAME *` → la valeur que donne Vercel.
   > ⚠️ **À la racine, la délégation a une portée plus large** : `_acme-challenge.skilloria.io` sert à valider tout certificat de `skilloria.io` et de ses noms directs. Si un autre service émet aujourd'hui un certificat pour ces noms par validation DNS, il ne le pourra plus (avertissement de la documentation). **NON VÉRIFIÉ** : qu'aucun service n'en émette — à constater sur la zone avant d'ajouter les deux `NS`.
   > Le `CNAME *` ne répond que pour les noms qui n'ont **pas** d'enregistrement propre (norme DNS, RFC 4592) : ceux de Resend restent servis tels quels. **À constater** par le même `dig` qu'au-dessus, avant et après.
4. `NEXT_PUBLIC_DOMAINE_RACINE` = `skilloria.io` sur **Production**, puis déploiement.
5. Supabase de production : **Site URL** et les deux **Redirect URLs** de production (étape 4).

**Comment savoir que c'est bon :** les quatre vérifications de staging, avec `.skilloria.io`.

> **Si le site s'affiche en gris neutre** sur l'adresse d'un écosystème qui existe, c'est que l'adresse n'a pas été reconnue : ou bien la racine posée ne correspond pas à l'adresse visitée, ou bien le label ne correspond pas **exactement** au sous-domaine réglé dans l'écran Écosystèmes (il a peut-être été changé), ou bien l'écosystème n'est pas actif. L'application ne plante pas — elle retombe sur un affichage neutre. **C'est confortable et trompeur : vérifiez toujours les couleurs.**

**Sources (documentation Vercel, lue le 29/09/2026)** :
[Adding & Configuring a Custom Domain](https://vercel.com/docs/domains/working-with-domains/add-a-domain) (adresses génériques, délégation de `_acme-challenge`) ·
[Assigning a domain to a Git branch](https://vercel.com/docs/domains/working-with-domains/assign-domain-to-a-git-branch) ·
[Environments](https://vercel.com/docs/deployments/environments) (branche de staging sur tous les plans ; environnements personnalisés Pro/Enterprise) ·
[Preview Deployment Suffix](https://vercel.com/docs/deployments/preview-deployment-suffix) et [Pricing](https://vercel.com/docs/pricing) (100 $/mois) ·
[Generated URLs](https://vercel.com/docs/deployments/generated-urls) (forme des adresses générées) ·
[Managing DNS Records](https://vercel.com/docs/domains/managing-dns-records) (recopier la zone avant de changer de serveurs de noms) ·
[System environment variables](https://vercel.com/docs/environment-variables/system-environment-variables) (`VERCEL_ENV`, `VERCEL_TARGET_ENV`) ·
côté Supabase : [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) (`*` ne traverse ni `.` ni `/`).

---

# ÉTAPE 7 — Créer le premier administrateur

**Sur une production neuve, personne ne peut administrer le site.** Il n'y a aucun compte administrateur, et **aucun écran ne permet d'en créer un** : l'écran qui le fait est dans le back-office, et le back-office demande d'être déjà administrateur.

Cette étape est donc la seule de ce document qui ne se fasse pas depuis une interface. Elle se fait **une fois**, et une seule.

> **Pourquoi une inscription normale ne suffit pas.** Si vous créez un compte depuis le site puis essayez de le passer « administrateur », vous obtenez un compte à moitié créé : la base sait créer un expert, un CDI, une entreprise ou un cabinet, et **rien d'autre**. Pour tout autre rôle elle n'échoue pas — elle se tait, et laisse un compte qui ne peut plus se connecter **et qui occupe l'adresse e-mail**. C'est exactement ce que la commande ci-dessous évite.

### Ce dont vous avez besoin

- une copie du dépôt sur votre machine, et `node` installé ;
- un fichier `.env.local` contenant `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` et `INSCRIPTION_HMAC_SECRET` **de la production** (la dernière : la même valeur que le secret du coffre-fort — le script signe la création du compte, §D.27) ;
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
3. Vous devez voir **douze** tâches.
4. Choisissez `matching_retry_trigger` — c'est la moins risquée à déclencher : si elle n'a rien à faire, elle ne fait rien.
5. Cliquez sur **Exécuter maintenant**.
6. Attendez une minute, puis ouvrez l'historique de cette tâche.

**Comment savoir que c'est bon :** la dernière exécution montre un appel qui a **abouti**, avec un code de réponse `200`.

**Si vous voyez `401`** : le `cron_secret` du coffre-fort ne correspond pas au `CRON_SECRET` de Vercel. Reprenez l'étape 3, en recopiant la valeur **exactement** (attention aux espaces ajoutés par le copier-coller).

**Si vous voyez une erreur de connexion** : `purge_cron_base_url` est faux, ou porte une barre oblique finale.

> **Pourquoi ce détour ?** La base envoie sa demande et n'attend pas la réponse. La liste des exécutions dirait donc « réussi » même sur un refus. Seul l'historique détaillé porte le vrai code.

---

# ÉTAPE 9 — Relier le catalogue à Stripe (OBLIGATOIRE avant d'encaisser)

Vos offres ont un prix dans Skilloria. Stripe, lui, ne les connaît pas encore : il faut lui créer un **produit** et un **prix** correspondants, et garder le lien entre les deux. C'est ce qu'on appelle **relier le catalogue**.

**Tant que ce n'est pas fait, le premier vrai paiement échoue** avec « prix hors catalogue » : l'argent est encaissé chez Stripe, et l'application ne sait pas à quelle offre le rattacher.

> **Relier ne fait payer personne.** Cette action crée des fiches chez Stripe, rien de plus : aucune carte n'est débitée, aucun droit n'est ouvert. Vous pouvez donc la faire **avant** d'activer l'encaissement — et c'est même l'ordre à suivre. **Vous n'avez pas besoin de `ENABLE_BILLING` pour cette étape.**

### Ce qu'il vous faut

Une seule chose : la **clé secrète Stripe** (`STRIPE_SECRET_KEY`) posée sur l'environnement où vous cliquez.

- En test, c'est une clé qui commence par `sk_test_`.
- En production, c'est une clé qui commence par `sk_live_`.

L'application refuse les deux combinaisons dangereuses : une clé de test en production, et une clé réelle ailleurs qu'en production. Si vous vous trompez, elle vous le dit en clair au lieu de faire semblant.

### Où cliquer

1. Connectez-vous en administrateur.
2. Allez sur **/admin/packages** (« Catalogue commerce »).
3. En haut à droite, cliquez sur **Relier à Stripe**.

### Ce que vous devez voir

Un bandeau vert : **« N offre(s) reliée(s) à Stripe, en mode test »** (ou *live*), suivi du nom des offres reliées.

En dessous, une ligne grise **« Rien à relier pour : … »** peut apparaître. **Ce n'est pas une erreur.** Les offres **par défaut** — celles sur lesquelles on retombe quand on ne paie pas — sont gratuites par construction : il n'y a aucun prix à créer chez Stripe pour elles. Aujourd'hui, `Free` et `Collaboration` sont dans ce cas. **Sur quatre offres, deux sont à relier.**

Un bandeau rouge nomme l'offre et l'erreur exacte. Relancez après avoir corrigé : **recliquer ne crée jamais de doublon** (chaque création porte une empreinte qui permet à Stripe de reconnaître une demande déjà reçue).

### Comment vérifier que c'est bon

1. Allez sur **/admin/facturation**, onglet **Écarts**.
2. Cherchez le bloc du **raccordement du catalogue**. Il affiche, pour **le mode courant** :
   - les offres **reliées**,
   - celles **à relier** — ce sont les seules qui appellent une action,
   - celles qui n'ont **rien à relier**, avec la raison.
3. **Regardez aussi la ligne de l'autre mode.** C'est là que se joue le passage en production : un catalogue parfaitement relié en test n'est **pas** relié en live.

**Ce qu'il faut voir avant d'ouvrir l'encaissement en production : zéro offre « à relier » en mode `live`.**

> **Vous ne pouvez pas l'oublier.** Tant qu'une offre payante n'est pas reliée dans le mode de la clé de cet environnement, **/admin/supervision** l'affiche comme un problème **bloquant**, avec le lien vers l'écran de facturation. Ce n'est pas un rappel poli : un lien manquant ne se découvre autrement qu'au premier paiement, quand l'argent est déjà encaissé.

> **Pourquoi deux modes ?** Un identifiant de prix créé en test **n'existe pas** en production, et réciproquement. Ce sont deux catalogues séparés chez Stripe, et ils le sont aussi chez nous. **Il faut donc cliquer DEUX FOIS dans la vie du produit** : une fois en test, une fois en production — avec la clé de chacun.

### La case « Offre gratuite »

Chaque offre porte une case **Offre gratuite**, à la création comme à la modification.

- **Cochée** : les prix sont à zéro, les champs sont grisés, et l'offre ne passe **jamais** par Stripe — ni synchronisation, ni paiement.
- **Décochée** : un prix strictement positif est **obligatoire**.

La base refuse toute contradiction entre la case et le prix, **dans les deux sens**. Vous ne pouvez donc plus rendre une offre payante gratuite par une saisie à zéro : l'enregistrement est refusé et vous dit pourquoi.

> **Pourquoi une case plutôt qu'un prix à zéro ?** Parce qu'une erreur de frappe ne doit pas décider. Avant, une offre à 349 € passée à 0 par mégarde sortait de la vente **sans un mot** : plus personne ne pouvait y souscrire, et rien ne le signalait.

---

### Au quotidien, vous n'aurez plus à cliquer

**Créer une offre payante la relie à Stripe dans la même action**, et modifier son prix aussi. Si Stripe refuse, l'action est **refusée avec la raison** et rien n'est enregistré — une offre n'existe jamais à moitié, payante et non reliée.

Le bouton **Relier à Stripe** ne sert donc qu'à deux choses : les offres créées **avant** que la clé Stripe existe, et **le passage en production**.

### Si vous changez un prix plus tard

Ne touchez à rien chez Stripe. **Modifiez le prix dans /admin/packages**, c'est tout : l'application crée le nouveau prix chez Stripe et archive l'ancien. Les clients déjà abonnés **continuent de payer l'ancien montant** — c'est voulu, on ne change pas le prix d'un contrat en cours.

⚠️ Si Stripe est indisponible à ce moment-là, **la modification est refusée** et le prix ne change nulle part. C'est délibéré : deux prix différents des deux côtés serait bien pire qu'un prix qu'on ne peut pas changer pendant une minute.

---

## Récapitulatif — la liste à cocher

- [ ] Postgres est en **17.6.1.121 ou plus** — `node scripts/verifier-version-postgres.mjs` affiche ✅
- [ ] Les migrations sont passées, et la ligne `PARAMETRAGE —` affiche des nombres
- [ ] `domains`, `branches`, `specialities`, `countries`, `verification_providers`, `translations` ne sont pas vides
- [ ] Les trois secrets du coffre-fort existent, avec une longueur non nulle
- [ ] Une tâche déclenchée à la main répond `200` dans son historique
- [ ] **Site URL** et les deux **Redirect URLs** génériques de cet environnement sont renseignées (étape 4)
- [ ] Le SMTP est réglé, et un e-mail de test est bien reçu
- [ ] Les variables indispensables sont posées sur **Production**
- [ ] **Le catalogue est relié à Stripe dans le mode de cet environnement** — zéro offre « à relier » dans `/admin/facturation` → Écarts. **À refaire en `live`** : un prix créé en test n’existe pas en production
- [ ] `NEXT_PUBLIC_DOMAINE_RACINE` est posée **avant** le déploiement (`skilloria.io` sur Production, `staging.skilloria.io` sur Preview) — sinon aucune page ne s'affiche
- [ ] `NEXT_PUBLIC_SITE_URL` est posée — sinon aucun e-mail ne part
- [ ] `DEV_DOMAIN_SLUG` n'est posée sur **aucun** environnement Vercel
- [ ] `CRON_SECRET` (Vercel) et `cron_secret` (coffre-fort) sont **identiques**
- [ ] `INSCRIPTION_HMAC_SECRET` (Vercel) et `inscription_hmac_secret` (coffre-fort) sont **identiques**
- [ ] Les interrupteurs voulus valent exactement `true`
- [ ] **Aucune** clé Stripe sur Production tant que le lancement est gratuit
- [ ] `*.<racine>` est en configuration valide chez Vercel, et l'adresse de chaque écosystème actif s'affiche à ses couleurs ; un nom inexistant s'affiche neutre

---

## En cas de doute

**Arrêtez-vous et demandez.** Aucune de ces étapes n'est urgente au point de valoir un secret posé de travers.

Deux repères pour situer un problème :

- **Le site s'affiche mais tout est gris** → adresse ou racine (étape 6) ou paramétrage (étapes 1-2).
- **Aucune page ne s'affiche, erreur serveur** → `NEXT_PUBLIC_DOMAINE_RACINE` absente ou malformée (étape 5) : les journaux Vercel la nomment.
- **Le site s'affiche bien mais l'inscription échoue** → variables d'environnement (étape 5) ou réglages d'authentification (étape 4).
