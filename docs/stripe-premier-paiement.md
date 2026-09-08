# Mettre Stripe en route — pas à pas

Cette page est faite pour être suivie **écran ouvert, dans l'ordre**, sans connaissance technique.

Rien n'a encore été essayé contre Stripe : aucun paiement, aucune page de paiement ouverte, aucun événement reçu. On commence donc par le **bac à sable** — un Stripe complet, avec de fausses cartes, où rien n'est jamais débité.

> **Deux mondes séparés, à ne jamais mélanger.**
> Stripe fonctionne en deux modes indépendants : le **bac à sable** (aussi appelé « mode test ») et le **live**. Ils ont leurs propres clés, leurs propres produits, leurs propres réglages. Ce que vous faites dans l'un n'apparaît jamais dans l'autre.
> **Pour l'instant, vous ne touchez QUE le bac à sable.** La partie « live » est en fin de page pour plus tard.

---

## Ce qu'il ne faut surtout pas faire

Trois choses, à lire avant de commencer :

1. **Ne créez aucun produit ni aucun prix à la main dans Stripe.** Le catalogue de Skilloria est la référence : c'est lui qui crée les produits chez Stripe, automatiquement, à la première souscription. Un produit créé à la main ne serait rattaché à rien, et vous auriez deux catalogues qui se contredisent.
2. **Ne posez aucune clé Stripe sur l'environnement « Production » de Vercel.** Tant que le lancement est gratuit, la production ne doit avoir *aucune* clé. Tout ce qui suit se fait sur l'environnement **Preview** (staging).
3. **Ne remplacez pas une variable existante par une autre « pour voir ».** Si vous avez un doute, arrêtez-vous et demandez.

---

# PARTIE 1 — LE BAC À SABLE

## Étape 1 — Appliquer la mise à jour de la base de données

**C'est le seul point bloquant : sans lui, le premier renouvellement d'abonnement échouera.**

Deux mises à jour de base attendent d'être appliquées. Elles portent ces noms :

- `…_stripe_socle_serveur.sql`
- `…_quota_analyses_cv.sql`

**Comment savoir que c'est bon :** demandez-moi de les appliquer, ou lancez la commande d'application des migrations. Après coup, la table `ai_quotas` doit exister et contenir une ligne `cv_parsing`.

*Pourquoi c'est bloquant :* au tout premier renouvellement automatique, Stripe envoie une facture qui ne contient aucune information sur la personne (il n'y a personne devant l'écran). Sans cette mise à jour, la base refuse d'enregistrer ce paiement, et Stripe réessaie en boucle.

---

## Étape 2 — Passer Stripe en bac à sable et récupérer la clé secrète

1. Connectez-vous à Stripe.
2. En haut de l'écran, basculez sur le **bac à sable** (le sélecteur affiche « Sandbox » ou « Mode test »).
3. Menu **Développeurs** → **Clés API**.
4. Repérez la **Clé secrète**. Cliquez pour la révéler, puis copiez-la.

**Comment savoir que c'est bon :** la clé commence par `sk_test_`. Si elle commence par `sk_live_`, vous n'êtes pas dans le bac à sable — revenez à l'étape 2.1.

> Cette clé est un mot de passe. Ne la collez nulle part d'autre que dans Vercel, ni dans un message, ni dans un document.

---

## Étape 3 — Créer le point de réception des événements (« webhook »)

Un webhook, c'est l'adresse à laquelle Stripe vient nous prévenir de ce qui se passe : « ce client a payé », « ce paiement a échoué ». **C'est ce canal, et lui seul, qui donne les droits à une organisation.** Sans lui, quelqu'un peut payer sans que son offre change.

1. Menu **Développeurs** → **Webhooks** → **Ajouter un point de terminaison**.
2. Dans **URL du point de terminaison**, saisissez :

   ```
   https://VOTRE-SOUS-DOMAINE.skilloria.io/api/stripe/webhook
   ```

   *(remplacez `VOTRE-SOUS-DOMAINE` par l'adresse de votre environnement de test)*

3. **Sélectionnez les événements à écouter.** Il en faut **exactement six**, à recopier un par un :

   ```
   checkout.session.completed
   customer.subscription.created
   customer.subscription.updated
   customer.subscription.deleted
   invoice.paid
   invoice.payment_failed
   ```

4. Validez.

**Comment savoir que c'est bon :** la page du point de terminaison affiche « 6 événements » et l'URL que vous avez saisie.

> **Les quatre du milieu ne sont pas facultatifs.** `checkout.session.completed` ne fait que rattacher le client ; ce sont les événements `customer.subscription.*` qui accordent réellement l'offre. Un webhook abonné au seul premier encaisserait de l'argent sans jamais donner de droits.

---

## Étape 4 — Copier le secret de signature

Sur la page du point de terminaison que vous venez de créer :

1. Cherchez **Secret de signature** (ou « Signing secret »).
2. Cliquez sur **Révéler**, puis copiez.

**Comment savoir que c'est bon :** il commence par `whsec_`.

> Ce secret appartient **à ce point de terminaison précis**. Celui du bac à sable et celui du live sont différents : n'utilisez jamais l'un à la place de l'autre.

---

## Étape 5 — Poser les trois variables dans Vercel

1. Ouvrez le projet Skilloria dans Vercel → **Settings** → **Environment Variables**.
2. Ajoutez ces trois variables, **sur l'environnement `Preview` uniquement** (décochez « Production » et « Development ») :

   | Nom | Valeur |
   |---|---|
   | `ENABLE_BILLING` | `true` |
   | `STRIPE_SECRET_KEY` | la clé `sk_test_…` de l'étape 2 |
   | `STRIPE_WEBHOOK_SECRET` | le secret `whsec_…` de l'étape 4 |

3. Redéployez l'environnement Preview (Vercel le propose, ou relancez le dernier déploiement).

**Comment savoir que c'est bon :** ouvrez la page « Mon offre » d'une organisation sur l'environnement de test. Un bouton de souscription doit apparaître. Tant qu'il n'apparaît pas, une des trois variables manque ou le redéploiement n'a pas eu lieu.

> `ENABLE_BILLING` écrit exactement `true`, en minuscules. Ni `TRUE`, ni `1`, ni `oui` : le code n'accepte que cette écriture, précisément pour qu'il n'y ait aucun doute sur ce qui ouvre le paiement.

> **Sécurité intégrée :** si vous posiez une clé `sk_live_` sur un environnement de test, ou une clé `sk_test_` en production, le site **refuse** de fonctionner et le dit. C'est volontaire — l'erreur inverse débiterait de vraies cartes pendant vos essais.

---

## Étape 6 — Vérifier qu'une offre est vendable

Dans le back-office Skilloria, **Catalogue commerce**, ouvrez l'offre que vous voulez tester. Il lui faut, toutes conditions réunies :

- elle est **active** ;
- ce n'est **pas** l'offre par défaut (celle sur laquelle on retombe est gratuite par construction) ;
- son **prix mensuel** est renseigné et supérieur à 0 ;
- sa **devise** est l'euro.

**Comment savoir que c'est bon :** si l'une manque, la souscription sera refusée avec un message expliquant laquelle.

---

## Étape 7 — Vérifier votre compte de test

Il faut vous connecter avec un compte qui est :

- **administrateur** de l'organisation (un membre « éditeur » ne peut pas engager une dépense) ;
- rattaché à une organisation dont la **vérification est approuvée**.

Les deux sont exigés par le serveur, pas seulement masqués à l'écran.

---

## Étape 8 — Le premier paiement

Sur la page **Mon offre**, choisissez l'offre et lancez le paiement. Vous arrivez sur une page **hébergée par Stripe** — c'est normal et voulu : aucun numéro de carte ne passe jamais par Skilloria.

Utilisez ces cartes de test (date d'expiration : n'importe quelle date future ; code de sécurité : n'importe lequel) :

| Carte | Ce qui doit se passer à l'écran |
|---|---|
| `4242 4242 4242 4242` | Le paiement passe. Vous revenez sur « Mon offre » avec le bandeau vert **« Paiement pris en compte »**, et l'offre payante apparaît en dessous. |
| `4000 0000 0000 0002` | Stripe refuse la carte **sur sa propre page**, dans votre langue. Vous restez chez Stripe, vous pouvez ressayer. Rien n'est débité, aucune offre n'est accordée. |
| `4000 0027 6000 3184` | Une fenêtre d'authentification bancaire (3-D Secure) s'ouvre. Validez-la : le paiement passe comme le premier cas. |
| Bouton « Retour » de Stripe | Vous revenez sur « Mon offre » avec le bandeau neutre **« Paiement abandonné »**. Votre offre est inchangée. |

**Comment savoir que c'est bon :** dans Stripe, **Développeurs → Webhooks → votre point de terminaison**, la liste des événements reçus affiche des lignes en **succès (200)**. Un événement en rouge signale un problème à me remonter.

---

## Étape 9 — LE TEST QUI VALIDE TOUT

> ### 🔴 Payez, puis **fermez l'onglet avant d'être redirigé**.
>
> Dès que vous avez validé le paiement chez Stripe, **fermez la fenêtre immédiatement**, sans attendre le retour sur Skilloria.
>
> **Les droits doivent être posés quand même.**

**Où vérifier :**

1. Rouvrez Skilloria et allez sur **Mon offre** : l'offre payante doit s'afficher, avec le montant prélevé.
2. Confirmation croisée dans le back-office : **Organisations** → votre organisation de test → section **Package**. Le package effectif doit être l'offre payante, avec une date de validité.

**Pourquoi ce test compte plus que les autres :** il prouve que ce n'est pas le retour du navigateur qui donne les droits, mais bien Stripe qui nous prévient de son côté. Si les droits dépendaient de la redirection, tout client fermant son onglet — ou perdant sa connexion — paierait sans rien recevoir. Et ce défaut serait **invisible en développement**, parce qu'un développeur, lui, laisse son navigateur ouvert.

Si l'offre n'apparaît pas après ce test, **arrêtez-vous et dites-le-moi** : c'est le seul résultat de cette page qui ne se rattrape pas tout seul.

---

## Étape 10 — Vérifier ce que le code a créé chez Stripe

Après le premier paiement, allez dans Stripe → **Catalogue de produits**. Un produit doit être apparu **tout seul**, portant le nom de votre offre.

**Comment savoir que c'est bon :** ouvrez-le, section « Métadonnées » — il porte une étiquette `skilloria_package_slug`. C'est ce qui permet de le retrouver ; un produit créé à la main ne l'aurait pas.

---

# PARTIE 2 — LE LIVE (plus tard, avant d'encaisser réellement)

**Ne faites rien de cette partie maintenant.** Elle liste ce qu'il restera à traiter le jour où les abonnements s'ouvrent. Le lancement est gratuit : tant qu'il l'est, la production ne doit avoir aucune clé Stripe.

### À décider avant, pas pendant

1. **La TVA.** Aujourd'hui aucune TVA n'est calculée : les paiements sont enregistrés avec une taxe à zéro. Ce n'est pas un oubli technique, c'est une **décision comptable** qui vous appartient — TVA intracommunautaire, autoliquidation, mentions obligatoires sur les factures. Elle doit être tranchée avant le premier euro encaissé, pas après.

2. **Les paiements qui réclament une authentification.** Il arrive qu'une banque exige une authentification pour un **renouvellement** (personne n'est devant l'écran). Aujourd'hui, Skilloria ne prévient pas la personne dans ce cas : elle ne reçoit que le mail de relance de Stripe. Il faut décider quoi lui afficher, puis me le faire coder. Ce n'est pas urgent tant que rien n'est vendu.

3. **Les contestations de paiement.** Quand un client conteste un débit auprès de sa banque, Skilloria ne réagit pas aujourd'hui. Même chose : à décider avant l'ouverture.

4. **Le calendrier de relances.** Dans Stripe → **Facturation** → **Relances**, vérifiez que les nouvelles tentatives automatiques sont **activées**. Skilloria maintient les accès d'un client dont le paiement a échoué **pendant toute la durée des relances**. Si les relances sont désactivées, il n'y a aucun délai de grâce du tout.

### Les étapes techniques du live

5. **Coordonnées publiques.** Stripe → **Paramètres** → coordonnées publiques : renseignez le nom commercial, l'URL de vos **conditions générales** et celle de votre **politique de confidentialité**. Sans elles, l'espace où vos clients gèrent leur abonnement peut être refusé en live.

6. **Un second webhook, en live.** Refaites l'étape 3 à l'identique, mais en mode live. Il vous donnera un **nouveau** secret `whsec_`, différent de celui du bac à sable.

7. **Les variables de production.** Refaites l'étape 5 sur l'environnement **Production**, avec la clé `sk_live_…` et le secret `whsec_` du webhook live.

8. **Refaites l'étape 9 en live**, avec une vraie carte et un petit montant : payer, fermer l'onglet, vérifier que les droits sont posés.

---

## En cas de doute

- **Un bouton de paiement n'apparaît pas** → une des trois variables de l'étape 5 manque, ou le redéploiement n'a pas eu lieu.
- **Un événement est rouge dans la liste des webhooks** → notez son nom et son horodatage, et transmettez-les-moi.
- **L'offre n'apparaît pas après un paiement réussi** → c'est le cas à me signaler en priorité (voir étape 9).
- **Vous n'êtes pas sûr d'être en bac à sable** → regardez la clé : `sk_test_` = bac à sable, `sk_live_` = argent réel.
