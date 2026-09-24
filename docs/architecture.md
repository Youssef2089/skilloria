# Architecture — Skilloria

> **Deuxième des trois fichiers de la mémoire du projet.** Les deux autres :
> [CLAUDE.md](../CLAUDE.md) (règle de maintenance, décisions figées §D, worktrees §G, index des pièges), [pieges.md](pieges.md) (les pièges §E) et
> [docs/produit.md](produit.md) (les parcours, les écrans, les règles métier).
>
> Écrit depuis le code, les migrations et les diagnostics — pas depuis une conversation. Chaque
> affirmation est vérifiable dans le dépôt ; ce qui ne l'est pas est marqué **NON VÉRIFIÉ**.
> **Relu contre le code le 16 septembre 2026** (§M1 dans [CLAUDE.md](../CLAUDE.md)).
>
> *Ouvrez ce fichier quand vous allez toucher au code et voulez savoir où vous mettez les pieds.*

---

## A. Ce qu'est Skilloria

Place de marché **multi-écosystème** (un écosystème = un sous-domaine = une ligne `domains`) qui met
en relation des **organisations** et des **experts certifiés**. Français par défaut, servi en
4 langues. Next.js 16 + Supabase + Vercel.

**Les populations** — `users.user_type` (CHECK en base) :

| Type | Ce qu'il fait |
|---|---|
| `expert_freelance` | Dépose un CV, se rend visible, reçoit des missions, postule. Peut publier un **besoin de sous-traitance** via une organisation personnelle. |
| `expert_cdi` | Idem, sur des offres CDI. Route et parsing CV dédiés. |
| `client` | Membre d'une organisation. Publie des annonces, reçoit des candidatures, déverrouille, échange. |
| `cabinet` | Même dashboard que `client` (`/dashboard/entreprise`). |
| `admin` | Back-office plateforme. |

**ESN n'est pas un type d'utilisateur** : c'est une valeur de `organizations.org_type`
(`client` \| `cabinet` \| `esn` \| `freelance`). `register-org` mappe `org_type='esn'|'cabinet'`
→ `user_type='cabinet'` (`metadataRoleFromOrgType`, TODO signalé dans [lib/auth-routing.ts](../lib/auth-routing.ts)).
`org_type='freelance'` désigne l'**organisation personnelle** d'un expert (sous-traitance).

**Où l'argent entre** — et il n'entre pas encore : voir §D.1. Le chemin existe et est complet :
`/api/billing/offers` → `/api/billing/checkout` (Checkout **hébergé** chez Stripe, aucune donnée de
carte ne touche le serveur) → `/api/stripe/webhook` (**seule** source de droits) → `/api/billing/portal`
et `/api/billing/change-plan`. Le catalogue (`packages`, `package_features`) est édité au back-office
et synchronisé vers Stripe ([lib/billing/catalogue.ts](../lib/billing/catalogue.ts)).

Ce que l'offre gouverne ([lib/entitlements.ts](../lib/entitlements.ts), codes de features contractuels
avec le seed) : `publications_per_month`, `active_publications_max`,
`revealed_candidates_per_publication`, `manual_unlocks_per_month`. Les refus sortent en **402**
(`quota_publications_reached`, `quota_active_publications_reached`, `unlock_limit_reached`).

---

## B. Le modèle de données et son histoire

### B.1 Les tables, par rôle

**Identité / tenant** — `domains`, `domain_configs`, `users`, `roles`, `profiles`,
`profile_experiences`, `profile_educations`, `profile_languages`, `session_logs`, `translations`,
`countries`, `work_zones`.

**Organisations** — `organizations`, `organization_members`, `organization_invitations`,
`organization_domains` (→ **TRACE HISTORIQUE**, §B.2), `verification_attempts`, `verification_providers`.

**Exploitation** — `baux` (les baux d'exécution, par **portée** et par **clé** — une portée pour les
tâches planifiées, une pour les recherches de missions, §D.22. Elle **remplace**
`cron_run_leases`, reprise puis retirée).

**Boucle cœur** — `publications`, `matches`, `candidatures`, `candidature_depots` (le
journal des DÉPÔTS, §D.19 — une ligne par couple (annonce, expert), née **avant** l'appel au modèle),
`candidature_views`, `conversations`, `messages`, `notifications`, `notification_preferences`.

**Commerce** — `packages`, `packages_stripe`, `package_features`, `package_history`,
`transactions`, `usage_counters`, `promo_codes`, `promo_code_uses`,
`stripe_events`, `stripe_reconciliation_runs` (§C.10).

**Taxonomie** — `branches`, `specialities`, `public_email_domains`, `blocked_email_domains`.

> Ces quatre tables manquaient à cet inventaire, alors que `branches` est citée dans **20** fichiers
> et `specialities` dans **19** : l'inscription d'un expert en dépend (§P1.1). Un inventaire
> incomplet est pire qu'absent — on le croit exhaustif.

**Moteur & exploitation** — `matching_settings`, `matching_notes_partielles`, `relance_overruns`,
`ai_quotas`, `ai_spend_caps`, `ai_spend_seuils_acteur`, `ai_spend_events`, `ai_model_tarifs`,
`duree_reglages`, `ai_redaction_failures`, `rate_limit_hits`, `features`,
`cron_job_catalog`, `cron_run_log`, `cron_run_leases`, `plateforme`, `audit_logs`.

**Journal des transactions (§D.26)** — `grand_livre` (le grand livre, en **ajout seul** : aucun rôle
applicatif n'y écrit, seule `journaliser()` insère), `grand_livre_actions` (la **liste fermée** des
actions, clé étrangère du grand livre).

**Marketing / contenu — CRÉÉES PAR LA BASELINE, ET JAMAIS TOUCHÉES PAR LE CODE.**
`ad_placements`, `blog_posts`, `campaigns`, `dashboard_stats`, `leads`,
`newsletter_subscriptions`, `profile_alerts`, `referrals`, `testimonials`, `waitlist`.
*`user_section_visits` (ici) et `subscription_history` (sous Commerce) en faisaient partie :
**supprimées le 24/09/2026** par la migration tables_mortes_supprimees (§B.2), preuve exécutée (§H.2) ;
`rate_limit_hits`, elle, est **vivante** : écrite en SQL.*

> **Dix tables existent et ne sont lues ni écrites par aucune ligne de `app/` ou `lib/`**
> (onze au balayage du 16/09/2026 ; `user_section_visits` est partie le 24/09/2026). Elles ne sont pas un projet en cours : ce sont des vestiges du dump
> de baseline. Les taire ferait croire, à qui explore la base, que ces fonctionnalités existent.
> **NON VÉRIFIÉ** : rien ne dit si elles portent des données de production — on ne les a pas lues.

### B.2 Les déplacements structurants — ceux qui piègent

> **`grand_livre` (24/09/2026) — LE SOCLE DU JOURNAL DES TRANSACTIONS (§D.26).**
> `grand_livre_actions` (liste fermée, seed `do update` — un référentiel, pas un réglage) ;
> `grand_livre` (quatorze colonnes, neuf contraintes, date en tête des index de filtre) ; privilèges
> **repris** à anon/authenticated/service_role (lecture seule pour service_role) ; trigger
> `grand_livre_ajout_seul` BEFORE UPDATE OR DELETE (GL001) + trigger TRUNCATE ; `journaliser()`
> (GL002 sans pièce ou sans type, GL003 hors liste ou statut contraire, détail passé par
> `audit_logs_detail_sans_pii()`) ; `regler_durees_place()` (réglage + journal en un appel) ;
> `effacer_adresses_ip()` recréée avec sa pièce ; `identifiant_derive()` (le dériveur SQL).
> **Ordre : AVANT le déploiement** — la route des durées appelle `regler_durees_place()`.
>
> ⚠️ **POSTCONDITION QUI S'EXÉCUTE** (§E.67) : sept signatures par `to_regprocedure`, les colonnes
> et contraintes comptées, la **première colonne de chaque index** lue dans `pg_index`, les
> **privilèges interrogés** (`has_table_privilege`), puis six **sondes** annulées : sans pièce (GL002),
> type inconnu et refus au mauvais statut (GL003), une écriture valide dont la clé personnelle est
> retirée puis **un UPDATE et un DELETE qui doivent lever GL001**, `regler_durees_place()` rejouée sur
> un compte réel (sautée, et dite, sur une base vierge — §G.4 bis), `effacer_adresses_ip()` rejouée
> et sa pièce retrouvée. Le témoin du dériveur est celui que `lib/admin/identifiant-derive.ts`
> calcule.

> **`tables_mortes_supprimees` (24/09/2026) — LES DEUX TABLES MORTES PARTENT, PREUVE EXÉCUTÉE.**
> `user_section_visits` et `subscription_history` — vestiges de la baseline, verdict §H.2 — sont
> **supprimées**. La précondition lit **le corps de toute fonction** (`pg_proc.prosrc`, tout langage,
> tout schéma hors système), les clés étrangères entrantes, les vues (`pg_rewrite`) et les triggers,
> et **refuse** en nommant ce qui s'accroche ; elle **compte** les lignes emportées (5 sur
> `user_section_visits`, mesurées) sans bloquer dessus. La postcondition vérifie l'absence par
> `to_regclass` et **relit** les fonctions. `lib/database.types.ts` est nettoyé dans le même commit.
> Gardé par [`diag-tables-mortes`](../scripts/diag-tables-mortes.mjs) : supprimées, preuve présente,
> et **plus rien** ne les cite — code, types générés, SQL.

> **`conservation_ip` (24/09/2026) — LES ADRESSES IP ONT UNE DURÉE DE VIE.**
> `duree_reglages.conservation_ip_mois` (**12**, bornes 1–60, NOT NULL, sans défaut à l'arrivée),
> `ip_limite_de_conservation(integer)` (pure) et `effacer_adresses_ip()` : met à NULL `ip_address`
> **et** `user_agent` dans `audit_logs` **et** `session_logs` au-delà de la durée. Planifiée
> `ip_retention_purge` à 04:20, au catalogue comme **légale** (`legal_basis.ip_12m`), et
> `cron_purge_health()` est recréée avec elle — la fonction **énumère** ses tâches.
>
> **Elle laisse sa trace par le MÊME guichet que les tâches HTTP** : elle ouvre sa ligne de
> `cron_run_log` puis la clôt par `cloturer_run_cron()` (§E.20 — pas un second mécanisme de
> verdict). Un échec est **écrit** sur la ligne (500 + message), jamais levé : levé, il emporterait
> la ligne avec lui. **Mesuré avant** (lecture seule) : 29 lignes d'audit et 185 sessions avec IP,
> aucune tâche.
>
> ⚠️ **POSTCONDITION QUI S'EXÉCUTE** (§E.67) : quatre signatures par `to_regprocedure`, la
> contrainte **éprouvée** (0 et 61 refusés, en sous-transaction), la limite **exécutée**, la tâche
> planifiée et cataloguée, et l'effacement **exécuté puis annulé** (sonde en sous-transaction : ni
> ligne de run, ni adresse effacée par une migration).

> **`audit_sans_donnee_personnelle` (24/09/2026) — LE JOURNAL D'AUDIT SE NETTOIE D'UN COMPTE.**
> Trois fonctions, aucune ligne touchée au passage : `audit_logs_cles_personnelles()` (la liste des
> clés personnelles — **source unique**, lue par la base ET par
> [`diag-audit-sans-donnee-personnelle`](../scripts/diag-audit-sans-donnee-personnelle.mjs)),
> `audit_logs_detail_sans_pii(jsonb)` (pure, récursive : objets et tableaux) et
> `audit_logs_nettoyer_compte(uuid, text)`, appelée par `purgeAccount` **avant** de poser
> `anonymized_at` — trois liens pris : le compte est l'acteur, le sujet, ou son adresse apparaît
> dans le détail (le cas de l'invitation, dont le sujet est l'invitation et l'acteur l'inviteur).
>
> **Mesuré avant de corriger** (lecture seule, 24/09/2026) : 127 lignes, **4** portaient une clé
> personnelle (`email`, `new_email`, `phone_e164`, `company_name`), sur 5 comptes. Pas de migration
> de données (§E.12) : la purge nettoiera chacune le jour où son compte sera purgé.
>
> ⚠️ **POSTCONDITION QUI S'EXÉCUTE** (§E.67) : les trois signatures par `to_regprocedure`, la liste
> qui **couvre les quatre clés mesurées**, la fonction pure **exécutée** sur un objet imbriqué et un
> tableau, et le nettoyage **exécuté** sur un compte inexistant (zéro ligne).

> **`bail_par_portee` (23/09/2026) — LE VERROU DEVIENT GÉNÉRIQUE.**
> Table `baux` clée **(portee, cle)**, fonctions `prendre_bail` / `rendre_bail` / `bail_tenu`.
> `cron_run_leases` est **reprise** (ses baux vivants d'abord) **puis retirée**, et
> `prendre_bail_run` / `rendre_bail_run` deviennent des **enveloppes** : les cinq routes de cron
> n'ont pas une ligne à changer, et le déploiement passe dans n'importe quel ordre.
>
> ⚠️ **L'ORDRE EST LA GARANTIE** : retirer avant de reprendre perdrait l'état des baux en cours, et
> une seconde tâche pourrait partir en parallèle — le chevauchement rouvert par son propre
> correctif.
>
> **Mesuré avant de trancher** : `cron_run_leases` n'était lue par aucune ligne de `app/`, `lib/`
> ou `components/`, ni par aucune autre migration. La garder aurait fait une table morte de plus
> (§M1 ⑥ en recense onze).
>
> ⚠️ **POSTCONDITION QUI LÈVE** (§E.60) : la **clé primaire vérifiée sur ses colonnes** — sans elle
> l'upsert n'est plus atomique —, les cinq signatures de fonction, le fait que les enveloppes
> **délèguent**, et la disparition effective de l'ancienne table.

> **`depense_par_acteur_et_action` (24/09/2026) — ON VOIT ENFIN SUR QUOI.**
> `ai_spend_par_acteur_et_action(p_limite)` ventile la dépense du mois par **(compte, action)**.
> La donnée existait depuis le premier jour : `ai_spend_events` porte l'acteur **et** l'action sur
> chaque ligne ; il manquait la lecture qui les croise. `ai_spend_par_acteur` disait **combien**,
> `ai_depense_par_mois` ventilait par action mais **tous comptes confondus** — les deux se
> croisaient sur tout sauf sur la seule case qui décide.
>
> ⚠️ **LE MÊME CLASSEMENT QUE LA LISTE, ET L'ORDRE EST TOTAL.** L'écran replie le détail sous
> chaque ligne : si les deux lectures ne retenaient pas exactement les mêmes comptes, un compte
> s'afficherait sans détail, ou un détail se rattacherait à une ligne absente. Le second terme
> (`acteur_id`) départage les montants égaux — sans lui, deux comptes à la même dépense pourraient
> être classés différemment d'une requête à l'autre, et **les deux lectures divergeraient sans
> qu'aucune donnée ne change**.
>
> ⚠️ **POSTCONDITION QUI EXÉCUTE, PAS QUI LIT** (§E.60) : elle appelle **les deux** fonctions et
> compare leurs totaux (à 1e-6 près — les deux arrondissent sur des regroupements différents, et
> exiger l'égalité binaire ferait rougir sur un arrondi), puis vérifie par **deux `except`** qu'aucun
> compte n'est d'un côté sans être de l'autre. Vérifier que les deux fonctions « se ressemblent »
> n'aurait rien prouvé.
>
> `action` peut être **NULL** — les dépenses antérieures à cette colonne n'en portent aucune. Elle
> devient `'inconnue'`, que l'écran nomme « opération non catégorisée » : une case vide se lirait
> comme un bogue.

> **`plafond_par_acteur` (23/09/2026) — CHAQUE COMPTE A SON PLAFOND.**
> `ai_spend_seuils_acteur` gagne `plafond_mensuel_usd` (**not null**), et la contrainte
> `ai_spend_alerte_sous_plafond` garantit que l'alerte reste **sous** le plafond du même compte —
> au-dessus, elle ne se déclencherait jamais (§D.25).
>
> ⚠️ **LA FENÊTRE MENSUELLE CESSE D'ÊTRE UNE DISCIPLINE.** Trois fonctions recopiaient
> `date_trunc('month', now() at time zone 'utc')` sous un commentaire disant « AU CARACTÈRE
> PRÈS ». Le jour où l'une dérive, les totaux se décalent de quelques heures en fin de mois et
> **la somme cesse de boucler** — l'écran cesse d'être croyable sans afficher la moindre erreur.
> `ai_spend_debut_du_mois()` est la source unique, et la postcondition vérifie que les **quatre**
> fonctions la **lisent** (dans leur `prosrc`), pas qu'elles donnent le même résultat aujourd'hui.
>
> Trois fonctions neuves : `ai_spend_acteur_etat(type, id)` — la lecture que la garde interroge,
> qui rend **toujours une ligne**, même sans dépense (zéro ligne se lirait « je ne sais pas », et
> l'appelant devinerait, §E.22) ; `ai_spend_acteurs_au_plafond()` — un **décompte sur TOUS** les
> acteurs, jamais sur la liste des dix plus gros (un chiffre juste sous dix acteurs est faux le
> jour où le signal sert, §E.24) ; et `ai_spend_par_acteur` **recréée** avec quatre colonnes de
> plus. Ses colonnes de plafond sont **NULLES** sur `reste_non_detaille` et `non_imputable` — ce
> ne sont pas des acteurs, et zéro les ferait passer pour « au plafond ».
>
> ⚠️ **POSTCONDITION QUI ÉPROUVE** (§E.60) : deux sondes en sous-transaction — une alerte
> au-dessus du plafond doit être **refusée**, une alerte **égale** au plafond doit être
> **acceptée** (sans la seconde, une contrainte qui refuse tout passerait la première, §E.34).
> Et la sonde **mémorise l'alerte avant de la bousculer** pour la remettre **telle quelle** : la
> remettre à sa valeur de seed écraserait un réglage d'administrateur, ce que §D.7 interdit.
> Le type de retour d'une fonction se lit dans `pg_get_function_result`, **pas** dans
> `information_schema.columns` — une fonction qui rend une table n'est pas une table, et le
> `count` y aurait rendu zéro.

> **`tarif_par_recherche` (23/09/2026) — LA GRILLE APPREND UNE TROISIÈME UNITÉ.**
> `ai_model_tarifs` gagne `usd_par_recherche` et `usd_par_recherche_web`, et le reranker **perd**
> son `usd_par_unite` : il était facturé à la recherche et compté au document (§D.24).
>
> ⚠️ **ELLE AURAIT ÉTÉ REJETÉE PAR UNE CONTRAINTE QU'ELLE NE METTAIT PAS À JOUR.**
> `ai_model_tarifs_forme_check` exigeait **exactement une forme parmi deux** ; retirer le prix par
> document sans en donner un autre laisse la ligne **sans aucune forme**. La contrainte est donc
> **retirée, les prix corrigés, puis elle est reposée à TROIS formes** — et **VALIDÉE**, puisque les
> données sont rendues conformes par la migration elle-même (pas de `NOT VALID`, §E.64).
> C'est le cas d'école de §E.31 : la garde a mordu avant qu'on ait fini d'écrire.
>
> **Une colonne NEUVE plutôt qu'une colonne RÉINTERPRÉTÉE.** Donner à `usd_par_unite` le sens
> « par recherche » aurait laissé toutes les lignes déjà écrites sous une étiquette devenue fausse
> (§E.24). Elle garde son sens — par document — et reste renseignable : les dépenses d'avant le
> 23/09/2026 doivent rester recalculables.
>
> **`usd_par_recherche_web` n'est PAS une forme, c'est un SUPPLÉMENT** : la contrainte n'autorise
> à le porter que sur la forme jetons. Ailleurs, ce serait un prix que rien ne peut consommer.
>
> ⚠️ **POSTCONDITION QUI ÉPROUVE, PAS QUI LIT** (§E.60) : quatre **sondes** écrivent dans une
> sous-transaction défaite par son `exception` — une ligne sans forme, une ligne à deux formes, un
> supplément hors jetons (les trois doivent être **refusées**), et la troisième forme (qui doit être
> **acceptée** — sans elle, une contrainte qui refuse tout passerait les trois autres, §E.34).
> Lire `pg_constraint` n'aurait prouvé qu'un **nom pris**, pas une règle qui mord.

> **`candidature_complete_ou_inexistante` (23/09/2026) — LA BASE REFUSE UNE CANDIDATURE NUE.**
> `candidatures` gagne la contrainte `candidatures_complete_ou_inexistante` : note **et** résumé
> (`ai_assessment->>'reason'` et `->>'pitch_org'`, non vides), ou la ligne n'existe pas. Elle est
> **VALIDÉE**, et porte une **borne de date** (`created_at < 2026-09-23`) qui déclare les **4
> candidatures de juin 2026** mesurées en base — toutes sans `ai_assessment`.
> ⚠️ **`NOT VALID` les aurait rendues IMMUABLES** : une contrainte `NOT VALID` est quand même
> vérifiée sur tout UPDATE. C'est **§E.64**, et c'est le piège que ce lot a payé.
>
> Table neuve **`candidature_depots`** — le journal des dépôts, clé `(publication_id, profile_id)`,
> états `en_cours` / `echec` / `depose`. La ligne naît **AVANT** l'appel au modèle (§E.63) ;
> `interrompu` n'est **pas** un état stocké, il se DÉRIVE de l'heure
> ([lib/candidatures/depot-etats.ts](../lib/candidatures/depot-etats.ts)). Fonction neuve
> `ouvrir_depot_candidature()` : l'`on conflict` incrémente `tentatives` **dans la même
> instruction**, parce qu'un lire-puis-écrire aurait compté une seule tentative pour deux relances
> simultanées (§F).
> Le commentaire de `ai_redaction_failures` est **repris** : la surface `candidature` n'y est
> plus écrite, et un lecteur de la base serait sinon tombé sur l'ancienne règle (§E.7).
>
> ⚠️ **POSTCONDITION QUI LÈVE** (§E.60) : la contrainte et sa validation, la table, son **unicité
> vérifiée sur ses COLONNES** et non sur son nom, ses trois `check`, ses deux index dont le
> **partiel**, et la **signature** de la fonction.

> **`verdict_ecrit_par_la_tache` (23/09/2026) — LA TÂCHE N'ATTEND PLUS QU'ON VIENNE LA CHERCHER.**
> `cron_run_log` gagne `verdict_source` (`tache` / `reconciliation`) et `attendu_de_la_tache` ;
> `cloturer_run_cron()` est neuve ; `trigger_purge_cron` **insère sa ligne AVANT l'appel** et passe
> son identifiant dans le corps ; `admin_cron_job_runs` rend deux colonnes de plus — ses quatorze
> colonnes d'origine sont **conservées**, et elle a dû être **supprimée puis recréée** (un
> `returns table` est un type de retour).
>
> **Mesuré avant** : 9 853 passages depuis le 3 septembre, **7 201 sans verdict (73 %)** — la
> réponse `pg_net` expire en ~6 h, la réconciliation passe à 03 h 15 et 03 h 45. Détail et règle
> générale : **§E.63**.
>
> ⚠️ **La migration porte une POSTCONDITION qui LÈVE** (§E.60) : elle vérifie le nom, la table, la
> **signature** de la fonction, et qu'aucune ligne antérieure ne reste marquée comme attendue.

> **`relance_rejouee` (23/09/2026) — UNE RELANCE DONT LE RUN A ÉCHOUÉ NE SE SOLDE PLUS.**
> `profiles` gagne `matching_relance_tentatives`, `matching_relance_echec_at` et
> `matching_relance_echec_code` ; deux fonctions neuves (`marquer_tentative_relance`,
> `echouer_relance_expert`) ; `prochaine_relance_expert` **borne la file** sur le compteur, et
> `matching_relance_health` compte désormais `en_echec` et `abandonnees` — ses **cinq colonnes
> d'origine sont conservées**.
>
> **DEUX SUPPRESSIONS, ET ELLES SONT NÉCESSAIRES.** ① L'ancienne signature à **deux** arguments de
> `prochaine_relance_expert` : `create or replace` **ne remplace pas** une fonction dont la liste
> d'arguments change — les deux coexisteraient, et l'appel existant résoudrait vers **l'ancienne**,
> celle sans plafond. Le correctif aurait été en place, **inerte**, et rien ne l'aurait dit (§E.1).
> ② `matching_relance_health`, parce qu'un `returns table` **est** un type de retour et qu'on lui
> ajoute deux colonnes.
>
> ⚠️ **Le `drop` est écrit AVANT le `create`, et pas seulement pour la lisibilité** : le rejeu des
> migrations ne modélise pas les surcharges — un `drop` placé après faisait disparaître la fonction
> du schéma reconstruit, et le contrôle du lot rougissait sur « elle n'existe pas ».

> **`annonce_active_partagee` (23/09/2026) — CINQ EXPRESSIONS DE LA MÊME RÈGLE, RAMENÉES À UNE.**
> « Une annonce est encore active » était écrit **cinq fois** en SQL : `matching_health` (01/09),
> `annonces_expirees_par_duree` et `annonces_basculant_par_duree` (16/09, celle-ci **deux fois**
> dans la même CTE), `matching_runs_inacheves` (21/09) — et une sixième s'apprêtait à naître dans
> `next_unfinished_matching_run`.
>
> **DEUX D'ENTRE ELLES PORTAIENT LA DURÉE EN DUR, ET C'EST PIRE QUE LA RECOPIE.**
> `matching_health` comparait à `interval '30 days'`, écrit **quinze jours avant** que la durée
> devienne réglable ; sa colonne s'appelle `total_actives`. Régler 20 jours depuis `/admin/durees`
> faisait donc diverger l'écran de supervision de tout le reste du produit — **sans erreur, sans
> alerte, et sans qu'aucun écran ne puisse le montrer, puisque c'est cette fonction qui l'alimente**
> (§E.24, §D.7). `matching_runs_inacheves` portait le sien sous un commentaire **faux** : « la
> valeur par défaut de la colonne » — la colonne n'a pas de défaut, le 30 est une valeur de **semis**
> écrite une fois dans un `insert`.
>
> Désormais : `public.annonce_active(status, expires_at, published_at, vie_jours, maintenant)`,
> **pure et `immutable`** — le moment est un **paramètre**, pas une horloge lue dans le corps, ce
> qui la rend éprouvable. Les cinq fonctions l'appellent. Deux d'entre elles **LÈVENT** si
> `duree_reglages` est vide, au lieu de compter sur une durée inventée : la route de supervision
> traite déjà une erreur comme « je n'ai pas pu regarder », jamais comme « rien à voir » (§E.22).

**① L'abonnement est remonté de `organization_domains` vers `organizations`.**
Migration `abonnement_sur_organisation`. Colonnes désormais sur `organizations` :
`package_id`, `package_started_at`, `package_valid_until`, `stripe_subscription_id`,
`stripe_subscription_status`, `package_source_event_at`. Les mêmes colonnes ont été **supprimées** de
`organization_domains`, index unique et CHECK compris.
Motif produit : une organisation accède à **tous** les écosystèmes actifs avec **un seul** abonnement
et **un seul** quota partagés ; un abonnement porté par le couple (organisation, domaine) produisait
un défaut d'argent silencieux — payer sur un écosystème, retomber sur l'offre gratuite sur un autre.
Ce qui n'a **pas** bougé, délibérément : `usage_counters` / `usage_increment` / `usage_peek`
(clé primaire **sans** `domain_id` — le quota partagé est voulu), `packages`, `package_features`,
l'invariant « offre par défaut = gratuite ».

> **`organization_domains` est une TRACE HISTORIQUE. Elle n'alimente plus AUCUNE décision.**
> Son commentaire de table le dit en toutes lettres. Elle conserve quel écosystème a servi à
> l'inscription, et quand. Rien d'autre. Une absence de ligne pour un couple (organisation,
> écosystème) ne signifie **rien** : c'est le cas normal de tous les écosystèmes sauf celui
> d'inscription. Ni l'accès, ni l'abonnement, ni le cloisonnement ne s'y lisent.

**② `matches.score` est supprimée, remplacée par `relevance_score` + `relevance_tier`.**
Migration `score_de_pertinence`. Deux grandeurs différentes, deux colonnes :
- `matches.relevance_score numeric` borné **[0,1]** — score brut du reranker, **propre à une annonce**.
  Jamais normalisé sur le vivier (normaliser réintroduirait la compétition entre experts). Accompagné
  de `relevance_model` et `relevance_scored_at` : changer de reranker change l'échelle.
- `matches.relevance_tier text` ∈ `{strong, normal}` — le **palier affiché**, **figé au moment de la
  notation** (« strong » = au-dessus du seuil de notification en vigueur **ce jour-là**). Jamais
  recalculé à l'affichage : le seuil est réglable, un recalcul rebaptiserait des matches anciens.
- `candidatures.ai_match_score numeric` borné **[0,10]** — la note de **Claude au dépôt d'une
  candidature**, adossée à `ai_assessment jsonb` (`{reason, pitch_org, model, evaluated_at}`) et
  `ai_model`. **À ne jamais afficher à côté de `relevance_score`** : deux questions, deux moments.
- Index : `matches_profile_score_idx` supprimé → `matches_profile_relevance_idx`.

> ⚠️ **ET LA SUPPRESSION A LAISSÉ TROIS LECTEURS DERRIÈRE ELLE, PENDANT TROIS SEMAINES.**
> `GET /api/me/missions/[id]` (aucune mission ne s'ouvrait, donc personne ne pouvait postuler) et
> le digest e-mail des mises en relation lisaient encore `matches.score`. Le cliquet censé
> l'interdire était **vert** : sa liste de colonnes mortes était écrite **à la main**, et personne
> n'y avait ajouté celle-là. Elle se **dérive** des migrations depuis le 22/09/2026 — §E.61.
> **Une migration qui supprime une colonne doit faire balayer ses lecteurs dans le même lot** :
> ni `tsc` ni `next build` n'en voient rien (§E.1).

**③ Profil et annonce passent au multivalué.** Migration `profil_annonce_multivalues`.
Supprimées : `profiles.speciality_id`, `profiles.seniority`, `publications.speciality_id`,
`publications.seniority`. Renommée : `publications.location` → `location_note`.
Ajoutées : `speciality_ids`, `seniorities`, `work_zone_ids`, `work_zone_countries`.
Cette migration passe **AVANT** le déploiement du code, qui doit partir dans la foulée.

**④ Les préférences de notification quittent `users`.** Migration
`notification_preferences_par_evenement`. `users.notify_match_email` / `notify_match_sms`
**supprimées** → table `notification_preferences (user_id, event_type, channel, enabled)`.
**Absence de ligne = ACTIVÉ** : seules les désactivations sont stockées (opt-out).
Renommages sur `notifications` : `match_email_dispatch_at` → `email_dispatch_at` (idem `attempts`,
`sms_*`).

**⑤ Les purges RGPD changent de déclencheur.** Migration `purges_rgpd_pg_cron` : Vercel Cron →
**pg_cron + pg_net**. Contrainte plateforme : aucun batch, aucun cron hébergé. L'ordonnancement suit
la base. Les routes `/api/cron/*` restent, protégées par `CRON_SECRET`.
Tâches planifiées aujourd'hui : `purge_deletions_trigger`, `purge_inactive_trigger`,
`cron_run_reconcile`, `cron_run_log_purge`, `rate_limit_hits_purge`, `matching_retry_trigger`,
`expert_relance_trigger`, `matching_notes_partielles_purge`.

**⑥ L'archive.** `supabase/_archive/` (18 fichiers) contient les migrations d'avant la baseline. Ce
sont des **traces**, elles ne sont pas rejouées. La baseline (`00000000000000_baseline.sql`) crée
32 tables `_backup_*_20260422` que la migration suivante supprime aussitôt — héritage du dump, pas un
modèle.
> ⚠️ **Et l'archive n'était pas que de l'histoire.** Les **seuls** seeds de
> `verification_providers` y vivaient — donc jamais rejoués. Une base reconstruite les perdait
> silencieusement. Cf. §E.10.

**⑦ Le paramétrage de production est versionné.** Migration `parametrage_de_production`. La recette
construisait la **structure** sans **aucune donnée de référence** : une base parfaite et morte, où
**100 % des inscriptions échouaient** (`handle_new_user` lève sur une table `domains` vide) et où le
site s'affichait aux couleurs par défaut **sans que rien n'alerte**.
Sont désormais versionnés, avec leurs **UUID explicites** (sans quoi les 167 traductions seraient
orphelines) : `domains`, `domain_configs`, `branches`, `specialities`, `countries`,
`verification_providers`, `translations`, `public_email_domains`.
`ON CONFLICT DO NOTHING` partout — il **reconstruit**, il n'écrase jamais un réglage ajusté.
**Ce qui n'y est pas, et ne peut pas y être** : les deux secrets du Vault (`cron_secret`,
`purge_cron_base_url`), les réglages d'authentification du projet Supabase, les variables
d'environnement et les sous-domaines Vercel. Ils vivent dans
[docs/mise-en-production.md](mise-en-production.md).

**⑦ bis — CE QUI SE POSE À LA MAIN EST DÉSORMAIS GARDÉ, et le garder a trouvé un défaut.**
Un réglage non versionnable n'a qu'une trace : la procédure qui le nomme. Ce lien ne tenait sur rien.
[scripts/diag-parametrage-manuel.mjs](../scripts/diag-parametrage-manuel.mjs) le tient — sans base,
sans réseau : il reconstruit depuis les migrations **quelle tâche dépend de quel secret**
(SQL exécutable uniquement : l'en-tête de la migration *nomme* les deux secrets en commentaire, et un
contrôle qui lirait le texte brut resterait vert après leur disparition — §E.7), puis vérifie que la
procédure les nomme, que le **nombre de tâches annoncé** est le nombre réel (§E.16), et que le miroir
`CRON_SECRET` existe aux deux bouts. Éprouvé par **cinq mutations**, cinq détectées.

**Le défaut qu'il a trouvé en naissant** : la procédure ne listait qu'**un** chemin de redirection
Supabase, `/auth/callback`. Le code en demande **deux** — `/<langue>/nouveau-mot-de-passe` est celui
de toute réinitialisation de mot de passe **et de toute invitation d'administrateur**
([lib/admin/admin-invitation.ts](../lib/admin/admin-invitation.ts),
`app/[locale]/mot-de-passe-oublie/page.tsx`). Supabase **refuse** toute adresse absente de sa liste :
sur une production neuve, personne n'aurait pu reprendre son compte, **et le premier administrateur
n'aurait pas pu ouvrir sa session**. Le refus tombe sur l'utilisateur, dans un lien reçu par e-mail,
et ne laisse aucune trace chez nous. Corrigé dans la procédure, et gardé.
Le balayage couvre `app/`, `lib/` **et** `components/`, et il distingue par la **forme** : une adresse
**absolue** part chez Supabase, un chemin **relatif** (`logout({ redirectTo: '/' })`) est un
`router.push` interne. Les confondre l'aurait fait crier à tort — donc désactiver.

**⑦ ter — LE PROBLÈME DU JOUR ZÉRO : personne ne pouvait administrer une production neuve.**
Les deux chemins qu'on croirait ouverts sont fermés, et **aucun des deux ne le dit** :
`POST /api/admin/create-admin` est gardée par `requireAdmin` **et** exige un jeton de
re-authentification — il faut déjà en être un ; et une inscription ordinaire ne peut pas produire un
administrateur, parce que `handle_new_user` ne connaît que expert / cdi / entreprise / cabinet et,
pour tout autre rôle, fait `RAISE WARNING` puis `RETURN NEW` — compte `auth.users` créé, **aucune**
ligne `public.users`, aucune erreur remontée : un compte fantôme qui **occupe l'adresse e-mail**.
L'en-tête de la route l'écrivait déjà — *« ce bootstrap-là est un chantier distinct »* — et le
chantier n'existait nulle part.
[scripts/creer-premier-administrateur.mjs](../scripts/creer-premier-administrateur.mjs) le ferme : il
refait **exactement** ce que fait la route (rôle de pont `entreprise`, vérification du miroir,
bascule en `user_type='admin'` / `status='active'`, constat que le **siège plateforme** a été pourvu
par son trigger), sous la garde d'écriture (§E.4), **et il refuse de servir une seconde fois** —
sinon il serait une porte dérobée permanente, sans re-authentification ni trace nominale.
Il **n'envoie pas** l'invitation : l'écran « mot de passe oublié » est déjà ce chemin, et en écrire
un second en ferait un jumeau (§E.20).
⚠️ Il écrit en base **hors du périmètre** de `diag-scripts-destructeurs` (qui ne balaie que
`scripts/diag-*.mjs`) : il est **gardé**, pas **découvert** — quatrième cas de l'angle mort de §E.4.

**⑨ LES DEUX VALEURS QUI NE GOUVERNENT RIEN — documentées ici parce qu'elles ne s'affichent plus.**

`/admin/seuils` les montrait, chacune avec un champ et trois lignes expliquant qu'elle ne décide de
rien. **§D.11** les a retirées de l'écran : *un champ qui ne règle rien finit par être rempli*.
**Elles ne s'évaporent pas pour autant** — sans cette section, leur absence se lirait comme un oubli,
et quelqu'un les remettrait. Elles sont aussi déclarées dans
[lib/jugement/sujets.ts](../lib/jugement/sujets.ts) (`NE_GOUVERNENT_RIEN`), lu par
`diag-reglages-inertes`.

| Valeur | Pourquoi elle ne gouverne rien | Preuve |
|---|---|---|
| `verification_providers.confidence_threshold` de la ligne `official_api` (`sirene_insee`), **9** | Sirene est un fournisseur de **DONNÉES**, pas un décideur. Il interroge le registre officiel et remet ses champs à l'analyseur de cohérence ; c'est l'IA qui tranche. | `runVerification` ([lib/verification/index.ts:84](../lib/verification/index.ts#L84)) filtre sur `provider_type === 'ai_web_search'` pour choisir son décideur, puis lit **son** `confidence_threshold` (ligne 173). Aucun chemin ne lit celui d'`official_api`. Un admin qui passerait ce 9 à 3 ne changerait **strictement rien**. |
| la ligne `claude_profile_matching` (`provider_type = 'profile_matching'`) | C'est le moteur d'**AVANT** le reranking : Claude est sorti de la mise en relation. | **Aucun code ne lit `provider_type = 'profile_matching'`** — balayage de `app/` + `lib/` + `components/`. La migration `parametrage_de_production` l'a **désactivée** (`is_active = false`) **sans la supprimer**, et ne la recrée pas sur une base neuve : elle n'existe que comme vestige. La valeur reste dans le `CHECK` de `provider_type` pour que le type garde une explication. |

> ⚠️ **ET C'EST CETTE LIGNE VESTIGE QUI A PRODUIT LA CLÉ i18n AFFICHÉE BRUTE.** L'écran rendait
> `t(\`types.${provider_type}.name\`)` — une clé **construite depuis une donnée de base**. Aucune des
> quatre langues n'a `types.profile_matching.name`, next-intl a rendu le **chemin de la clé**, et
> `textTransform: 'uppercase'` l'a mis en capitales :
> `ADMIN_SEUILS.TYPES.PROFILE_MATCHING.NAME`.
> **Le développeur croyait avoir un repli** : `{ default: provider_type }`. **next-intl n'a pas
> d'option `default`** — le second argument est l'objet des valeurs d'interpolation. Le repli n'a
> jamais existé. Gardé par [scripts/diag-cles-i18n.mjs](../scripts/diag-cles-i18n.mjs), qui refuse
> cette option **et** exige qu'une clé dynamique nourrie par la base soit bornée par une liste
> déclarée, des deux côtés.

**⑧ Le format du numéro d'identification quitte le code pour le référentiel pays.**
Migration `format_numero_identification`. `countries` gagne `registre_numero_libelle`,
`registre_numero_exemple`, `registre_numero_longueur_min`, `registre_numero_longueur_max`,
`registre_numero_alphanumerique`. La même migration retire `default 'FR'` de
`organizations.country` — la colonne reste `NOT NULL`, c'est le **défaut** qui disparaît.

Le numéro était validé par `/^\d{9}$/` — le format **français** — codé en dur **aux deux bouts**,
client et serveur, libellé « SIREN » et refus « 9 chiffres attendus ». Un *company number*
britannique (8 alphanumériques) ou un ICE marocain était refusé **à la saisie**, avant toute
vérification. Un `switch (pays)` en TypeScript aurait fait d'un pays de plus un **déploiement** ;
le référentiel porte déjà 64 pays, leurs noms en quatre langues, leur indicatif et leur drapeau.

> **Pas de colonne `regex`, et c'est délibéré.** C'était la forme évidente. Écartée pour deux
> raisons : une expression régulière **lue en base et exécutée côté serveur** ouvre un risque de
> déni de service par retour arrière catastrophique sur une valeur que le code ne contrôle plus ;
> et elle inviterait à encoder une **validité** (clé de contrôle, damier) qu'on ne sait pas
> vérifier, alors qu'on ne cherche qu'une **forme**. On décrit donc la forme : une longueur, et le
> droit ou non aux lettres.

> **`NULL` veut dire « accepté », jamais « refusé ».** Seule la France est renseignée — la seule
> règle que le dépôt **prouve**. Les 63 autres restent à `NULL` et leur saisie passe. Les remplir
> est désormais une **écriture de données**, pas un déploiement : c'est tout l'objet de la
> migration. Ce n'est pas un travail laissé en plan, c'est le refus d'inscrire dans une table de
> réglages des formats nationaux que rien ici ne permet de vérifier.

La lecture est partagée : [lib/pays/numero-identification.ts](../lib/pays/numero-identification.ts)
(serveur **et** client) et [lib/pays/referentiel-client.ts](../lib/pays/referentiel-client.ts) (le
chargement de `/api/countries`, sorti de `CountrySelect` **avant** de se dupliquer une quatrième
fois). `scripts/diag-pays-organisation.mjs` tient les deux unicités.

**⑩ LA PALETTE QUITTE LES COMPOSANTS POUR LA BASE.**
Migration `palette_par_ecosysteme` (21/09/2026). `domain_configs` gagne **six** colonnes de chrome —
`couleur_fond_page`, `couleur_bandeau`, `couleur_cartes`, `couleur_bordures`,
`couleur_texte_principal`, `couleur_texte_secondaire` — chacune `NOT NULL` avec, pour `DEFAULT`, la
valeur **mesurée sur l'accueil**. Un `CHECK` de forme par colonne garde l'hexadécimal à six chiffres,
en base, pour tout appelant (§E.31).

**Six et non huit** : les deux rôles qui manquent réutilisent des colonnes existantes.
`primary_color` **est** déjà la couleur de marque, `accent_color` **est** déjà l'override de la
couleur dérivée. En créer deux de plus aurait fait deux jumeaux qui divergent (§E.20), et personne
n'aurait su laquelle fait foi. Leurs noms anglais restent : une colonne se lit par son nom dans une
chaîne (§E.1), et les renommer est un lot à soi seul.

Le `DEFAULT` **remplit les lignes existantes**, donc cette migration n'a **aucune insertion** — elle
échappe par construction à la classe §E.12. `accent_color` reste nullable, et son `null` a un sens
plein : *dérive la couleur depuis la marque jusqu'au contraste cible*.

> ⚠️ **PLAGE DE NUMÉROTATION : `0xxxxx`, ALORS QUE LA CONSIGNE DU LOT DISAIT `1xxxxx`.**
> §G.2 déclare la consigne `1xxxxx` **fausse et tranchée** : la plage du tronc est `0xxxxx`, et
> `1xxxxx` est **gelée nommément** sur quatre migrations déjà appliquées. Une cinquième y ferait
> rougir le cliquet de `diag-migration-donnees`. Le dépôt fait foi, et le choix est écrit dans
> l'en-tête de la migration pour qu'il se lise.

**⑪ `domain_configs.secondary_color` NE GOUVERNE PLUS RIEN** — à ranger avec les deux valeurs
inertes de §B.2 ⑨. Elle colorait la seconde moitié de **trois** dégradés de barre de progression,
dans les deux tableaux de bord experts ; le lot palette les a rendus aplats de la couleur
« boutons ». **Mesuré : plus aucune ligne de `app/`, `lib/` ou `components/` ne la lit.** La colonne
reste — retirer une colonne que des chaînes citent est exactement §E.1 — et `DomainConfig` garde le
champ, documenté comme inerte sur place.

---

## C. Les chaînes fonctionnelles, de bout en bout

> **§C et §P1 décrivent les mêmes parcours, pour deux usages différents — ce n'est pas un doublon.**
> **§C** est un **repérage** : où vivent les règles, quel fichier ouvrir. On le lit avec le code sous
> les yeux.
> **§P1** est le **produit** : ce qui se passe, dans l'ordre, ce qui bloque et pourquoi, et ce que
> l'utilisateur voit quand ça refuse. On le lit **sans** le code.
> En cas de divergence entre les deux, **§P1 fait foi** : c'est lui qui est écrit pour être relu.

### C.1 Dépôt de CV et visibilité (expert)
`POST /api/profile/upload-cv` (freelance) · `POST /api/profile/cdi-upload-cv` (CDI) — routes
**distinctes et gardées par `user_type`** (403 `wrong_user_type`), `maxDuration = 60`.
Interrupteur `ENABLE_AI_CV_PARSING` → 503 `ai_disabled`. Quota lu en base (`ai_quotas`,
[lib/ai-quotas.ts](../lib/ai-quotas.ts)) : absent ⇒ **refus**, jamais de repli. Parsing par
`claude-haiku-4-5-20251001`, cache SHA-256, consentement RGPD requis. Le bucket `cv` est **privé**
(service-role uniquement, jamais d'URL) ; `avatars` est privé depuis la migration `avatars_private`
(URLs signées courtes, générées serveur).
**Visibilité** : prédicat unique [lib/profile-visibility.ts](../lib/profile-visibility.ts) — lu par la
route (qui refuse), le formulaire (qui prévient) et la bannière (qui dit **quels champs manquent**).
Le résumé est borné **200–800 caractères** : en dessous il n'y a pas matière à juger, au-dessus il
sort du document envoyé au moteur. Le même prédicat existe en contrainte base
(`profiles_visible_requiert_criteres_check`) : toute évolution touche **les trois**.
Le matching est relancé via `after()` (§E.5).

### C.2 Publication d'une annonce (organisation)
`POST /api/publications` → `POST /api/publications/[id]/publish`. Prédicat unique
[lib/publications/publishable.ts](../lib/publications/publishable.ts) + contrainte
`publications_publiee_requiert_zones_check`.
**Sémantique de l'ensemble vide, asymétrique et voulue** : zones de travail **obligatoires**
(`&&` sur un ensemble vide est toujours faux → annonce publiée et silencieusement invisible) ;
spécialités et séniorités **facultatives**, vide = « aucune contrainte sur cet axe », pas « personne ».
Gate qualité IA ([lib/verification/ai-publication-quality.ts](../lib/verification/ai-publication-quality.ts)).
Gates commerce : 402 `quota_publications_reached` / `quota_active_publications_reached`.
**Expiration à 30 jours calculée À LA LECTURE** — aucun job, aucun statut basculé, `expires_at` n'est
jamais écrit ([lib/publications/expiry.ts](../lib/publications/expiry.ts), source unique).

### C.3 Mise en relation et notification
[lib/matching/](../lib/matching/) — quatre temps, chacun sait se taire ou parler :
1. **Réglages** (`settings.ts`) lus dans `matching_settings` par écosystème : `feed_threshold`,
   `notify_threshold`, `notify_enabled`, `rerank_model`, `rerank_batch_size`.
   **Aucun repli codé en dur** : absents ⇒ le moteur refuse **et le dit**.
2. **Vivier** (`pool.ts`) — filtres SQL sur des critères **déclarés par l'expert lui-même** (branche,
   spécialités, séniorités, zones, disponibilité, ouverture croisée) et sur ses **décisions**
   (décliné, déjà postulé). Aucun jugement de pertinence n'écarte personne, et **aucun plafond de
   vivier**. Chaque filtre rend son décompte.
3. **Notation** (`rerank.ts`, Cohere, `ENABLE_RERANKING`) — par lots, budget relu entre chaque lot
   ([lib/ai-budget.ts](../lib/ai-budget.ts), `ai_spend_caps` / `ai_spend_events`).
4. **Réconciliation** (`reconcile.ts`) puis **notifications** (`shared.ts`) — upsert idempotent
   préservant `dismissed` et les candidatures engagées ; on ne notifie que sur les **inserts frais**
   au-dessus du seuil.

> ⛔ **LE MOTEUR NE NOTE PLUS D'ANNONCE EXPIRÉE — 23/09/2026, DANS LES DEUX SENS ET DANS LA
> REPRISE.** Il en notait, et il les **payait** : douze lecteurs du filtre d'expiration existaient
> dans le produit, **zéro** dans `lib/matching/` et **zéro** dans `next_unfinished_matching_run`.
> Les six annonces de la base de recette sont expirées depuis des mois — c'est exactement le vivier
> que le cron de rattrapage s'offrait. Et le flux de l'expert filtre à la lecture : **personne
> n'aurait jamais vu un seul de ces rapprochements.**
>
> **LE FILTRE NE SE RECOPIE PAS, IL SE LIT.** Une seule expression par langage —
> [lib/publications/expiry.ts](../lib/publications/expiry.ts) et `public.annonce_active()` — la
> durée vient de `duree_reglages`, et [`diag-annonce-expiree`](../scripts/diag-annonce-expiree.mjs)
> rougit sur **toute** dérivation locale.
>
> **ET UNE ANNONCE QUI EXPIRE *PENDANT* UN RUN ? LE RUN VA AU BOUT, ET C'EST UNE DÉCISION.**
> Le contrôle se fait **une fois, à l'entrée**, jamais entre deux lots. Trois raisons, dans cet
> ordre :
> ① **ce qui a été noté reste**, et ne coûte rien : la règle est appliquée **à la lecture**, donc
>    les rapprochements d'une annonce expirée sont invisibles à la seconde où elle expire. Les
>    effacer serait une écriture de plus qui n'achète rien, et qui **détruirait la trace** de ce que
>    le run a fait ;
> ② **s'arrêter en cours laisserait le run INACHEVÉ sur une annonce que la reprise refuse désormais
>    de reprendre** — un trou permanent, invisible à la supervision, qui exclut elle aussi les
>    expirées. C'est très exactement le défaut que la migration du 21/09 venait de fermer (§E.52) ;
> ③ **l'argent est déjà dépensé** quand le lot part chez le fournisseur. Interrompre ne rembourse
>    rien, et rend la fin d'un run dépendante de l'horloge — donc irreproductible.
>
> La fenêtre est de quelques secondes contre une durée de vie de trente jours. **Ce qui est refusé
> est de COMMENCER** un run sur une annonce déjà expirée ; ce qui est garanti est qu'un run
> commencé **se termine et se déclare terminé**.

Deux sens : `runMatchingForPublication` (annonce → experts) et `runMatchingForExpert`
(expert → annonces). La trace d'un run est écrite dans `publications.matching_stats` par **un seul**
constructeur (deux chemins qui écrivaient chacun leur objet pouvaient oublier une clé, et une clé
absente se lit `null`, qu'une somme SQL affiche zéro : la supervision aurait dit « tout va bien »).
Un run interrompu reste **INACHEVÉ**, donc visible et rejouable ; la reprise s'appuie sur
`matching_notes_partielles` (ce qui est noté ne se renote pas — migration `reprise_notation`).

> **UNE NOTE APPARTIENT AUX TEXTES QUI L'ONT PRODUITE — migration `empreinte_des_notes`
> (22/09/2026).** Le brouillon était indexé par `(publication_id, profile_id)` + le modèle : trois
> identités, **aucun contenu**. Un profil modifié retrouvait « sa » note — celle calculée sur le
> profil d'avant — pendant les 24 h de vie du brouillon, **sans que rien ne lève**. Le report de
> 60 minutes ne fermait pas cette fenêtre, il la **rétrécissait**.
> La colonne `empreinte` (`not null`, **sans défaut** : une ligne sans empreinte est impossible,
> §E.31) porte le sha-256 du couple *(texte annonce, texte profil)* réellement envoyé au reranker.
> Une note n'est reprise que si l'empreinte recalculée est **identique**.
> ⚠️ **L'ordre est canonique — annonce d'abord — et jamais celui de l'appel.** Les deux sens
> interrogent le reranker à l'envers l'un de l'autre ; hacher dans l'ordre de l'appel donnerait deux
> empreintes pour le même couple de textes et **supprimerait le partage entre les deux sens**, qui
> est délibéré (une note acquise par le run d'un expert épargne celui de l'annonce). Calcul dans
> [lib/matching/empreinte.ts](../lib/matching/empreinte.ts), pur et sans autre import, donc exécuté
> tel quel par son contrôle (§E.33). Détail et mesure : **§E.58** ([pieges](pieges.md#e58)).
**Relance** (migration `relance_expert`) : un déclenchement refusé n'est plus perdu, il est
**reporté** ; RPC `programmer_relance_expert` / `solder_relance_expert` / `prochaine_relance_expert`.
Plafond anti-abus **20/heure/expert**, en constante nommée dans le code, **volontairement sans champ
dans `/admin/matching`** ; les dépassements sont comptés dans `relance_overruns`.
**Canaux** : seul `email` est ouvert (§D.2). Digest pour les opportunités (anti-rafale), per-item pour
les messages.

### C.4 Candidature
`POST /api/candidatures` (`maxDuration = 60`). Claude juge **au dépôt**, sur un seul couple
profil × annonce, via `after()` (`ENABLE_AI_CANDIDATURE_ASSESSMENT`, `claude-sonnet-5`) → écrit
`ai_match_score`, `ai_assessment`, `ai_model`. Le `pitch_org` est adressé à l'organisation et
**affiché avant le déverrouillage payant** : d'où l'interdiction, dans le prompt, de nommer un
employeur ou un client — ce texte doit rester compatible avec le masquage.
Les pannes de rédaction sont journalisées (`ai_redaction_failures`, migration `pannes_de_redaction`)
et distinguées par cause (plafond / interrupteur / erreur) : `candidature_ai_health()` les confondait
en un seul « sans jugement IA ».
**État de vie dérivé à la lecture** ([lib/candidatures/lifecycle.ts](../lib/candidatures/lifecycle.ts)) :
deux buckets, `active` / `archived`, avec une **raison** nommée (`selected`, `exchange_open`,
`awaiting_review`, `exchange_expired`, `publication_expired`, `publication_closed`, `rejected`, …).
`status` est la **mécanique**, l'état de vie est le **fait**. Dérivation **serveur uniquement** : le
client rend la raison, il ne la calcule pas. Statuts vestigiaux jamais écrits par le produit, couverts
en lecture : `shortlisted`, `withdrawn`, `archived`.

### C.5 Dévoilement et messagerie
`POST /api/candidatures/[id]/unlock` (quota manuel, 402) et auto-dévoilement top-1 à la création
(sans quota) — mécanique partagée dans [lib/unlock.ts](../lib/unlock.ts), idempotente.
Le dévoilement ouvre une `conversation` avec `expires_at = unlock + 15 j`
([lib/conversations/expiry.ts](../lib/conversations/expiry.ts), **source unique**).
**Politique de divulgation, une seule fonction** :
`disclosurePolicyForCandidatureLifecycle()` ([lib/expert-disclosure.ts](../lib/expert-disclosure.ts)).
**Cinq écrans**, mais **QUATRE chemins de code** — la distinction compte, parce qu'on audite des
chemins, pas des écrans :
`/api/me/candidatures-org` (candidatures agrégées) · `/api/publications/[id]/candidatures`
(candidatures d'une annonce **ET** sous-traitance : c'est la **même** route, cf.
[components/collaboration/SousTraitanceDetailView.tsx](../components/collaboration/SousTraitanceDetailView.tsx)) ·
`/api/me/conversations` (inbox) · `/api/conversations/[id]/messages` (fil).
Chercher un cinquième appel, c'est chercher ce qui n'existe pas.
`/api/conversations/[id]/messages` : envoi refusé **409** une fois la fenêtre close ; l'aperçu et le
compteur de non-lus sont calculés en SQL **par conversation** (migration `apercus_conversations` —
l'ancienne version lisait les 500 derniers messages toutes conversations confondues et produisait un
résultat **faux**, pas tronqué).

### C.6 Commerce et abonnement
Catalogue édité dans `/admin/packages`, synchronisé vers Stripe **avant** l'écriture locale (échec de
synchro ⇒ écriture refusée, message explicite). Clés d'**idempotence dérivées et stables**
([lib/billing/idempotence.ts](../lib/billing/idempotence.ts)) : deux synchros concurrentes ne créent plus
deux produits.
Webhook `/api/stripe/webhook` — **la seule route qui ACCORDE DES DROITS sans identité d'appelant** :
Stripe n'a ni session, ni jeton, ni domaine, et l'authentification est la **signature** du corps.

> ⚠️ Ce document écrivait « la seule route de l'application sans `requireAuth` ». **C'est faux, et
> beaucoup trop large** : **18 routes sur 128** n'appellent ni `requireAuth`, ni `requireAdmin`, ni
> `requireOrgRole` (mesuré le 16/09/2026, commentaires retirés). Quatre sont des crons gardés par
> `CRON_SECRET` ; les autres sont publiques par construction (inscription, OTP, pays, taxonomie,
> résolution d'invitation, désinscription, contact) ou valident le jeton elles-mêmes
> (`init-session`, `logout`). Aucune n'accorde de droits — **c'est ce qui distingue le webhook**, et
> c'est ce qu'il fallait écrire. Corps lu **brut** (`request.text()`, jamais `.json()`).
Idempotence par contrainte de base : `stripe_event_claim()` est un `INSERT … ON CONFLICT` dont la clé
primaire est l'identifiant Stripe. Un événement `livemode` sur un environnement hors production est
**ignoré** (journalisé, 200) — on ne fait pas échouer l'endpoint, Stripe le désactiverait.
`applyPackageState()` écrit `package_id` / `package_valid_until` sur **`organizations`**.
**L'expiration est décidée À LA LECTURE** ([lib/entitlements.ts](../lib/entitlements.ts)) : aucun batch,
aucun cron. Dépassée ⇒ retour à l'offre par défaut.
**Fail-open assumé** sur toute la couche Droits : un moteur commercial en panne ne bloque jamais
l'usage produit (limite `null` = illimité). Ne pas « corriger » en fail-closed.
Une organisation abonnée voit le montant **prélevé** (lu dans `transactions`), jamais le prix du
catalogue : les `Price` Stripe sont immuables.
L'attribution manuelle (`/api/admin/assign-org-package`) **refuse** de passer par-dessus un abonnement
Stripe vivant ([lib/billing/attribution-manuelle.ts](../lib/billing/attribution-manuelle.ts)).

### C.8 — Ce que la purge RGPD garantit RÉELLEMENT, et à partir de quel jalon rien n'est rattrapable

`purgeAccount` ([lib/account-purge.ts](../lib/account-purge.ts)) est appelée par **trois** chemins —
la suppression demandée (`purge-deletions`), l'inactivité à deux ans (`purge-inactive`) et
l'administrateur (`/api/admin/user-purge`). *Ce paragraphe disait « deux » ; le troisième existait
déjà (relu le 24/09/2026).* Elle n'efface **aucune ligne** : elle **anonymise**, parce que
`messages.sender_id` est `ON DELETE CASCADE` et qu'une suppression emporterait l'historique
d'interactions des deux côtés.

**Ce que la purge laisse comme trace — depuis le 24/09/2026 (étape 0.2 du lot journal).**
· **Chaque purge dit d'où elle vient** : `account_purged.detail.origine` vaut `tache_planifiee`
  (avec `job` : `purge_inactive` ou `purge_deletions`) ou `administrateur`. Le contexte est un
  **paramètre requis et fermé** de `purgeAccount` (`ContextePurge`) — c'est le compilateur qui a
  nommé les trois appelants, pas un balayage. L'administrateur écrit **en plus** sa propre ligne
  `admin_account_purged` : celle-ci dit *qui a décidé*, `account_purged` dit *que c'est arrivé*.
· **Chaque avertissement à 23 mois laisse une ligne**, envoyé (`inactivity_warning_sent`, avec
  l'identifiant de la demande Resend — un accusé de réception de la demande, pas une preuve de
  remise, §E.19 — et `marquage_pose`) ou non (`inactivity_warning_failed`, avec sa cause :
  `sans_email`, le code du fournisseur, ou `exception`). Avant, sa seule marque était
  `users.inactivity_warning_sent_at`, qu'une reconnexion remet à NULL : le fait qu'il ait été
  envoyé, et quand, disparaissait.
· ⚠️ **Le verdict du run ne compte pas les avertissements envoyés, et ne le peut pas.** L'envoi vit
  dans `after()` (§E.5), qui s'exécute **après** que `sousVerdictDeRun` a écrit la ligne de
  `cron_run_log` : `warned_scheduled` est le nombre de comptes **à avertir**. Le nombre
  d'avertissements **réellement partis** un jour donné est le nombre de lignes
  `inactivity_warning_sent` de ce jour dans `audit_logs`.
· Les traces ne portent **que des identifiants** — ni adresse, ni prénom. Gardé par
  [`diag-account-lifecycle`](../scripts/diag-account-lifecycle.mjs) §C bis, ancré sur le **bloc** de
  chaque branche de l'envoi (§E.8) — éprouvé par mutation le 24/09/2026 : 11 mutations, 11 détections.

**Et la purge nettoie le journal d'audit — étape 3 bis, AVANT le jalon (24/09/2026, étape 0.3).**
**Huit** écritures portaient une donnée personnelle dans `audit_logs.detail` — l'adresse invitée
(`org_member_invited`, `org_invitation_resent`, `org_invitation_revoked`), la nouvelle adresse
(`email_change_requested`), le numéro (`phone_verified`), le prénom et le nom (`identity_updated`),
le nom d'organisation (`org_approved`, `org_rejected` — « Prénom Nom » pour l'organisation
personnelle d'un expert, §D.8). La lecture de la base n'en montrait que **quatre** actions : une
mesure sur les lignes existantes ne voit que les actions déjà jouées, et c'est le **contrôle** qui a
trouvé les deux dernières (§E.61). Et la purge laissait le journal intact : **l'adresse survivait au
compte.** Les huit n'écrivent plus que des identifiants et des faits (`has_reason`, `role_in_org`,
`expires_at`, `methode`, `champs_modifies`), et `purgeAccount` appelle
`audit_logs_nettoyer_compte(uid, email)` **avant** de poser `anonymized_at` — un échec **lève**, le
compte reste non marqué et sera repris ; le nombre de lignes nettoyées va dans
`account_purged.detail.audit_lignes_nettoyees`. Gardé par
[`diag-audit-sans-donnee-personnelle`](../scripts/diag-audit-sans-donnee-personnelle.mjs) : chaque
appel `logAudit` a un détail **littéral** (un spread ou une variable est **opaque**, donc refusé),
sans clé de la liste **à toute profondeur**, sans valeur visiblement personnelle sous une clé
innocente — et la liste est **lue dans la migration**, jamais recopiée (§E.20). Éprouvé par mutation
le 24/09/2026 : 15 mutations, 15 détections.

**Les quatre étapes, et ce que chacune garantit.**

| # | Étape | Échec ⇒ | Ce qui est garanti après |
|---|---|---|---|
| 1 | Auth : e-mail placeholder, mot de passe aléatoire, bannissement permanent | **lève** | le compte ne peut plus se connecter, l'adresse d'origine est libérée |
| 2 | Fichiers : CV (bucket `cv`), avatar (bucket `avatars`) | **journalisé, best-effort** | rien — un fichier peut survivre, et le registre le dit |
| 3 | `profiles` : toutes les PII vidées, `visible=false` | **lève** | le profil ne porte plus de donnée personnelle |
| 4 | `users` : nom, téléphone, e-mail miroir, `status='archived'`, **`anonymized_at`** | **lève** | le compte est marqué purgé |

**LE JALON EST `anonymized_at`, ET IL EST POSÉ EN DERNIER — C'EST TOUTE LA MÉCANIQUE.**
Tant qu'il n'est pas posé, le compte reste éligible et le passage suivant le reprend : **chaque étape
amont est idempotente**, la rejouer ne coûte rien. Une fois posé, **le compte est hors de portée de
tout rejeu** — aucune reprise ne reviendra jamais dessus.

> ⚠️ **ET C'EST EXACTEMENT LÀ QU'UN DÉFAUT A VÉCU** (§E.27 forme B). L'étape 2 lisait `profiles` sans
> récupérer son erreur. Une panne de lecture rendait `prof = null`, **l'étape 3 était sautée en
> entier**, l'étape 4 s'exécutait, `anonymized_at` était posé, et `logAudit` écrivait
> `anonymized: true`. **Toutes les PII du profil restaient en base, marquées comme effacées,
> définitivement hors d'atteinte d'un rejeu.**
>
> Corrigé : la lecture lève. Le jalon n'est donc plus posé sur une anonymisation qui n'a pas eu lieu.

**CE QUE LA PURGE NE GARANTIT PAS, ET IL FAUT LE SAVOIR AVANT DE S'EN PRÉVALOIR :**

· **les fichiers ne sont pas garantis supprimés.** L'étape 2 est best-effort par conception — faire
  échouer une purge entière sur une panne de Storage laisserait les PII de la **base** en place, ce
  qui est pire. Le registre porte désormais `cv_supprime` et `avatar_supprime` : un fichier survivant
  est **traçable**, donc rattrapable à la main. Il n'y a **aucune reprise automatique**.
· **l'historique d'interactions est PRÉSERVÉ**, sous forme anonymisée : candidatures, conversations
  et messages restent. Le **corps** des messages n'est pas réécrit — on ne prétend pas l'avoir
  anonymisé (même parti pris qu'en §D.5).
· **`cron_run_log.response_body` conserve des UUID de comptes** — décision arbitrée au titre de
  l'art. 5.2, à inscrire au registre des traitements.
· **rien ne vérifie a posteriori** qu'un compte marqué `anonymized_at` est effectivement anonymisé.
  Le seul contrôle est celui du **chemin** ; il n'existe aucun balayage de cohérence sur l'existant,
  et aucun diagnostic du dépôt ne peut en tenir lieu — **il faut une base** (§E.12).

#### La requête qui dit si le défaut a frappé

**Elle est en tête de ce passage parce qu'elle est la SEULE trace que le défaut laisserait s'il
revenait.** Un compte dont l'étape 3 a été sautée porte `anonymized_at` **et** des PII : c'est la
signature exacte, et elle ne s'efface pas d'elle-même.

```sql
-- Comptes déclarés anonymisés dont le profil porte ENCORE des données personnelles.
-- Chaque colonne testée est une colonne que l'étape 3 met à NULL (ou vide).
-- ⚠️ skills / languages sont text[] NOT NULL et certifications jsonb NOT NULL :
--    ils ne sont JAMAIS null, on les compare donc au VIDE, pas à null.
select u.id as user_id, p.id as profile_id, u.anonymized_at
from public.users u
join public.profiles p on p.user_id = u.id
where u.anonymized_at is not null
  and (
       p.summary        is not null
    or p.title          is not null
    or p.photo_url      is not null
    or p.cv_file_path   is not null
    or p.cv_url         is not null
    or p.cv_hash        is not null
    or p.address_line   is not null
    or p.postal_code    is not null
    or p.birth_year     is not null
    or p.linkedin_url   is not null
    or p.phone          is not null
    or p.city           is not null
    or p.location       is not null
    or p.skills         <> '{}'
    or p.languages      <> '{}'
    or p.certifications <> '[]'::jsonb
  );
```

> ✅ **MESURÉ — ZÉRO LIGNE.** Requête passée **par Youssef**, **sur la base réelle** (staging lié,
> ref `wnayuerhakekxccgimeg`), **le 19 septembre 2026**, après la livraison du correctif de
> §E.27 forme B.
>
> **Ce que la mesure établit :** aucun compte porteur d'`anonymized_at` ne conserve de PII de profil.
> **Le défaut n'a jamais frappé** — toutes les purges déclarées sont complètes, et le registre ne
> ment sur aucune ligne existante.
>
> **Ce qu'elle n'établit pas, et c'est dit ici pour que la ligne ne se cite pas de travers :**
> · elle porte sur les **colonnes PII de `profiles`** listées ci-dessus, pas sur les fichiers du
>   Storage — un CV survivant ne laisse aucune trace en base et n'est **pas** couvert (voir le point
>   sur les fichiers, plus haut) ;
> · elle vaut **à sa date**. Aucun contrôle du dépôt ne la rejoue, pour la raison de §E.12 : elle
>   exige une base, et un diagnostic qui prétendrait la couvrir sans base ferait croire à une
>   garantie qui n'existe pas. **Elle se repasse à la main** — c'est le prix, et il est assumé.
>
> **Par qui, comment, à quelle date : les trois sont écrits, et c'est la règle.** Une mesure sans sa
> provenance est §E.24 — un chiffre juste sous une étiquette qu'on ne peut plus vérifier. Même
> discipline que le gel des plages de migrations (§G.2), établi lui aussi par une lecture humaine
> sur la base, et daté pour la même raison.


### C.9 — Ce que `/admin/supervision` doit porter, mesure par mesure

**Pourquoi ce tableau existe.** La refonte de septembre 2026 a séparé ce qui se **décide** de ce qui
s'**observe** — et la séparation a fait tomber une mesure en route (§E.35). Le réglage crie quand il
disparaît : il a un champ. La mesure ne crie pas : c'est une ligne dans un tableau, et un écran qui en
montre moins paraît simplement plus clair.

**Ce tableau est le contrat.** Une prochaine refonte qui déplace ces écrans doit le relire ligne à
ligne, et vérifier que chaque source est encore **lue**, **affichée**, et **écrite en mots**.

| Source en base | Ce qu'elle mesure | Où elle arrive | « Illisible » se dit |
|---|---|---|---|
| `matching_threshold_health` | la répartition des notes — *« à 7, combien entrent »* | bloc « Répartition » | `etatRepartition()` : `indisponible` ≠ `aucune_execution` (§E.26) |
| `matching_coverage_health` | experts écartés sans avoir été notés | `problemes` → couverture | `couverture === null` |
| `matching_runs_inacheves` | runs de notation jamais terminés | `problemes` → sujet `inacheves` | `lecture_indisponible_inacheves` |
| `redaction_failure_health` | résumés d'IA non produits, **par cause et par surface** | `problemes` → sujet `resumes` | `lecture_indisponible_pannes` |
| `relance_overrun_health` | relances refusées au plafond anti-abus, **par origine** | `problemes` → sujet `relances` | `relances === null` |
| `ai_spend_status` | dépense du mois par fournisseur, et le budget atteint | bloc « Consommation » | `depense === null` |
| `ai_depense_par_mois` | l'historique, que deux totaux ne disaient pas | bloc « Consommation » | `historique === null` |
| `ai_depense_operations` | les dernières opérations payantes | sujet `operations` | `operations === null` |
| `ai_spend_par_acteur` | **la dépense par compte déclencheur** | bloc « Consommation » → *Par compte* | `par_acteur === null` |
| `ai_spend_seuils_acteur` | les **alertes** par acteur — réglées ailleurs, **lues ici** | rapprochement à l'affichage | `seuils_acteur === null` |
| `ai_model_tarifs` | l'âge du tarif le plus ancien | `problemes` → tarif périmé | `tarifs === null` |

> ⚠️ **`ai_spend_par_acteur` EST CELLE QUI ÉTAIT TOMBÉE.** Elle vivait sur `/admin/matching` ; l'écran
> de réglage a gardé les **seuils d'alerte** (ils ont un champ) et perdu **la dépense qu'ils
> surveillent** (elle n'en a pas). On pouvait donc régler une alerte sans jamais voir ce qu'elle
> surveille. Restaurée dans la supervision, avec son alerte **déduite au rapprochement** — jamais
> stockée : un état « en dépassement » écrit quelque part serait faux la seconde suivante.

**TROIS RÈGLES QUI TIENNENT POUR TOUTE LIGNE DE CE TABLEAU :**

1. **`null` veut dire « je n'ai pas pu regarder », jamais `[]`.** C'est le rôle de `ouNull()` dans
   `app/api/admin/supervision/route.ts`. Un tableau vide se lit *« rien à voir »* au moment précis où
   l'on ne sait pas (§E.22 ⑨).
2. **La gravité se décide au SERVEUR**, dans `classerProblemes()`
   ([lib/supervision/problemes.ts](../lib/supervision/problemes.ts)). L'écran rend une liste déjà
   triée ; il ne juge pas.
3. **Les valeurs s'affichent en MOTS, jamais en identifiants de base** (§E.26). `cause`, `surface`,
   `origine` et `etat` passent tous par `t()`. Une refonte qui déplace la donnée sans ses libellés
   laisse `modele_indisponible` s'afficher tel quel sur l'écran où quelqu'un décide — c'est arrivé.

> **Une dette NOMMÉE, pour qu'elle cesse d'être redécouverte.** Sept fonctions de santé existent en
> base et **ne sont lues nulle part** : `admin_cron_chain_violations`, `annonces_expirees_par_duree`,
> `candidature_ai_health`, `cron_purge_health`, `cron_run_summary`, `matching_health`,
> `matching_relance_health`. **Mesuré : elles n'avaient déjà aucun lecteur avant la refonte** — ce
> n'en est donc pas une conséquence. Leur place naturelle est ce tableau ; tant qu'elles n'y sont
> pas, ce sont des mesures que personne ne regarde.

> **NON VÉRIFIÉ** : aucun écran ne dit aujourd'hui quels pays n'ont **aucun fournisseur de
> décision**. Le bandeau qui le faisait a été retiré de `/admin/seuils` par décision (soixante pays en
> corps 8 sur un écran de décision, §E.26) ; l'information n'a pas été reportée ici.

---

### C.10 — Le module Stripe d'exploitation : ce qu'il garantit, ce qu'il NE garantit pas

> État établi le **20/09/2026**, par lecture du code et **une lecture de la base de recette**
> (`wnayuerhakekxccgimeg`). Les chiffres qui suivent portent leur date, et aucun n'est déduit.

#### Pourquoi on ne recopie PAS Stripe — et c'est la moitié du lot

Stripe fournit déjà, et mieux : les **paiements**, les **factures**, les **remboursements** et les
**litiges**. Ils vivent dans son tableau de bord. Le module d'exploitation n'en montre **aucun** :
`/admin/facturation` porte **un lien** vers ce tableau de bord, et c'est tout ce qu'il en dit.

La raison n'est pas l'économie d'effort. **Un écran qui recopie Stripe diverge de Stripe** — pas le
jour où on l'écrit, mais le jour où une synchronisation saute, et alors deux chiffres coexistent
sans que rien ne dise lequel fait foi. C'est la double source de vérité que tout le socle commerce
évite déjà (`resolvePackageByPrice` ne lit jamais un montant chez Stripe : il traduit un
**identifiant de prix** en offre du **catalogue local**, qui fait foi — décision figée).

La gestion d'abonnement **côté client** ne se refait pas non plus : le portail client Stripe est
hébergé et co-brandé, et `/api/billing/portal` l'ouvre déjà.

**Ce qui reste, et que Stripe ne peut PAS savoir : l'état de NOTRE base en regard du sien.**

#### Les quatre surfaces, et la raison qu'il n'y en ait qu'UNE route

| Surface | Ce qu'elle répond |
|---|---|
| Le **journal** | ce que Stripe nous a envoyé, et ce que ce site en a fait |
| Les **écarts** | quelles organisations ont des droits qui ne correspondent pas à leur abonnement |
| La **santé du raccordement** | le tuyau est-il branché, et depuis quand est-il muet |
| La **vérification nocturne** | qu'est-ce qui existe chez Stripe et n'est jamais arrivé ici |

Les trois premières lisent la **même source**. Trois routes qui liraient séparément tomberaient
ensemble sur la même panne — et l'une afficherait « rien à signaler » pendant que l'autre dirait
« je ne sais pas ». C'est **§E.36 mot pour mot**, et le remède n'est pas de corriger les trois :
c'est de n'en avoir **qu'une**, [app/api/admin/facturation/route.ts](../app/api/admin/facturation/route.ts).
Une lecture, un type, trois consommateurs.

`/admin/supervision` **n'appelle jamais Stripe** : il lit le **verdict** de la nuit, en local. L'y
faire appeler Stripe en aurait fait un quatrième consommateur de la même lecture.

#### CE QUE LE MODULE GARANTIT

1. **« Zéro écart » et « je n'ai pas pu comparer » ne se confondent jamais.** `EtatEcarts`
   ([lib/stripe-exploitation/ecarts.ts](../lib/stripe-exploitation/ecarts.ts)) n'expose `ecarts` que
   dans sa branche `'compare'` : l'écran ne PEUT PAS écrire « aucun écart » sur une lecture en
   panne, le compilateur l'interdit. La même garde existe **en base** sur
   `stripe_reconciliation_runs` — sur `etat = 'impossible'`, les trois compteurs sont `NULL`, et une
   contrainte le refuse autrement (§E.31 : une garde qui est une contrainte de schéma ne dépend
   d'aucune discipline).
2. **Le mur fermé est un état NORMAL.** `ENABLE_BILLING` absent ⇒ motif `billing_disabled`, affiché
   en gris avec son propre texte, et la tâche nocturne répond **200**. Peindre en rouge le
   fonctionnement normal apprend à ignorer le rouge.
3. **Le rapprochement se fait sur l'identifiant CLIENT.** Le Customer survit à une résiliation, à
   une re-souscription, à un changement d'offre ; l'abonnement, non. Un **repli documenté** sur
   l'identifiant d'abonnement couvre le désordre de livraison (un `subscription.created` peut
   arriver avant le `checkout.session.completed` qui attache le customer). Plusieurs abonnements
   pour un client sont **classés par statut**, jamais pris dans l'ordre de pagination.
4. **Lecture seule, partout.** La route n'exporte aucun verbe d'écriture ; la tâche nocturne
   n'appelle aucun traitement d'événement. Les deux propriétés sont **gardées**.
5. **Une attribution manuelle n'est pas un écart.** Discriminant : `package_source_event_at IS NULL`
   **et** aucun identifiant Stripe — donc aucun événement n'a jamais écrit cette ligne. Sans cette
   exclusion, l'écran aurait annoncé « accès sans paiement » sur un compte pilote dès sa première
   nuit. *Mesuré le 20/09/2026 : 4 organisations, une avec une offre, **zéro** avec un identifiant
   Stripe.*
6. **La tâche nocturne figure au catalogue**, nommée : 8 tâches avant elle, 9 après.

#### CE QU'IL NE GARANTIT PAS — et il faut le lire avant de s'y fier

- **Il ne retraite rien.** Un événement manqué est **signalé**, jamais rejoué. Le retraitement
  automatique d'un événement de paiement est un lot à lui seul : que faire d'un `invoice.paid`
  vieux de trois jours dont l'abonnement a été résilié depuis est un **arbitrage d'argent**.
- **Il ne corrige aucun écart.** L'écran constate. Corriger automatiquement un écart qu'on ne
  comprend pas encore, c'est rétablir des droits qu'on aurait dû retirer, ou retirer des droits
  payés — irréversible dans les deux sens.
- **Il ne voit rien au-delà de 30 jours.** L'API Events de Stripe ne conserve pas plus. Passé ce
  délai, un événement manqué est **introuvable** : c'est ce qui impose une cadence quotidienne.
- **Il ne sait pas combien de signatures ont échoué.** L'objet `webhook_endpoint` de Stripe expose
  son URL, son statut et ses types souscrits — **ni** compteur d'échecs, **ni** date de dernière
  tentative. L'écran dit donc ce qu'il sait : le point est actif, et rien n'arrive. **NON VÉRIFIÉ**
  au-delà de la surface de cet objet : aucune autre ressource de l'API n'a été cherchée.
- **Les résultats sont BORNÉS.** La pagination s'arrête à 1000 ; au-delà, l'écran affiche
  « tronqué » plutôt que de se dire complet.
- **Il ne prouve pas que le journal est complet.** Une ligne absente ne prouve pas qu'aucun
  événement n'est arrivé : elle prouve qu'on n'en a pas trace. Seule la vérification nocturne
  distingue les deux.
- **Deux JUMEAUX sont assumés** (§E.20) : `STATUTS_OUVRANTS` et la liste des six types traités sont
  recopiés de [lib/billing/events.ts](../lib/billing/events.ts), qui ne les exporte pas. Un contrôle
  lit les **deux** listes dans le source et échoue si elles divergent. Le jour où `events.ts` les
  exporte, les copies disparaissent.

#### LA PROCÉDURE — que faire quand un écart apparaît

**Règle zéro : on ne corrige rien tant qu'on n'a pas compris.** L'écran est en lecture seule
précisément pour empêcher le geste réflexe.

1. **Lire l'ÉTAT avant le compte.** « 0 écart » et « je n'ai pas pu comparer » ne sont pas la même
   page. Si l'état est `impossible`, le motif dit de quel côté regarder — `lecture_locale` désigne
   notre base, les motifs `stripe_*` désignent Stripe ou la clé, `billing_disabled` ne désigne rien
   (le mur est fermé, c'est normal).
2. **Regarder les quatre lignes du raccordement.** Un écart massif et soudain vient presque toujours
   de là : secret désaccordé, endpoint désactivé, endpoints croisés entre les deux modes.
3. **Chercher l'événement dans le journal.** Chaque nature d'écart porte sa phrase d'action.
   · `failed` → le motif est écrit, et l'événement est **rejouable** (Stripe le renverra, ou on le
   renvoie depuis son tableau de bord) ;
   · **coincé en `received`** → il ne se rejouera **jamais** seul, voir §E.27 dans [pieges.md](pieges.md) ;
   · **absent** → la vérification nocturne le nommera, si elle a moins de 30 jours de retard.
4. **Si rien n'explique l'écart**, c'est que le webhook a fonctionné et que l'accès est faux quand
   même : offre écrasée à la main, événement écarté comme retardataire (`package_source_event_at`
   plus récent que l'événement), ou prix changé chez Stripe sans changer au catalogue.
5. **Corriger à la main, et tracer.** Pour un droit : `/admin/organisations/[id]`. Pour un prix
   désaccordé : `/admin/packages`. Jamais en base directement — **un réglage qui n'est pas dans le
   dépôt n'existe pas** (§E.10).

### C.11 — Les TROIS écrivains des listes de profil, et la propriété qui les tient

**Pourquoi cette section existe.** `profile_experiences`, `profile_educations` et
`profile_languages` sont écrites par **trois** routes, et toutes les trois procèdent par
**suppression puis réinsertion**. C'est la forme la plus dangereuse du dépôt : si la réinsertion
n'écrit rien, la suppression, elle, a bien eu lieu — et ce qu'un expert a saisi à la main a
disparu, sans erreur et sans trace.

| Route | Origine des listes | Comment la propriété est tenue |
|---|---|---|
| `POST /api/profile/upload-cv` | l'analyse de CV (freelance) | **garde locale** : la liste normalisée est testée avant le `delete` |
| `POST /api/profile/cdi-upload-cv` | l'analyse de CV (CDI) | **garde locale**, identique |
| `PATCH /api/profile` | le formulaire du profil | **barrière en amont** : 400 `liste_illisible` si une liste non vide n'a aucune entrée écrivable ; et 409 `effacement_non_declare` si un vide remplace une liste non vide sans que le corps déclare `listes_lues` |

**LA PROPRIÉTÉ, une phrase, et elle vaut pour tout écrivain futur :**
> **La liste qui sera RÉINSÉRÉE est testée AVANT la SUPPRESSION.**

Elle ne dit **pas** *comment*. Une garde locale et une barrière en amont la tiennent aussi bien, et
exiger la forme locale ferait rougir le seul écrivain qui se protège autrement (§E.34). Le
contrôle [`diag-garde-et-action`](../scripts/diag-garde-et-action.mjs) est donc ancré sur la
propriété, et l'exemption du troisième écrivain porte une **sentinelle** : si la barrière
disparaît, l'exemption tombe.

**Ce que le CV peut et ne peut pas effacer, pour qu'il n'y ait pas de doute :** un CV analysé dont
une liste ressort **vide** ne supprime rien — ni les expériences, ni les formations, ni les
langues. Une liste **non vide mais entièrement illisible** (des entrées sans rôle, sans école, sans
nom de langue) ne supprime rien non plus, et **le dit** : `liste_illisible` côté formulaire, une
journalisation nommée côté analyse de CV. Détail de la forme et de son cas fondateur : **§E.39**
dans [CLAUDE.md](../CLAUDE.md).

### C.12 — La recette 3.3 : ce qu’elle prouve, ce qu’elle NE prouve PAS, et ce qu’il lui faut

[scripts/recette-3-3.mjs](../scripts/recette-3-3.mjs), livrée le 20/09/2026 **sans avoir jamais tourné**
**contre une base** — volontairement, et écrit en tête du script : c’est l’état exact de la migration
de §E.12, et la seule façon honnête de la livrer est de le dire. Elle prouvera quelque chose le jour
où Youssef ouvre la session sur un projet jetable.

**Ce qu’elle prouve.** Contre un vrai serveur et une vraie base, pour **chaque route du**
**cloisonnement** — dérivées de [scripts/inventaire-cloisonnement.mjs](../scripts/inventaire-cloisonnement.mjs),
sorti de `diag-ecosystem-scope` pour que la matrice ne soit **jamais écrite à la main** (une route
ajoutée y entre toute seule, ou le diagnostic rougit) — et pour **chaque population** (anonyme, expert
freelance, expert CDI, client, cabinet, administrateur), sous **quatre écosystèmes** (le sien, un autre
actif, un inactif, un inconnu) : le statut HTTP rendu est celui attendu, **les refus autant que les**
**succès**. Puis le **parcours métier, une fois** : publier → mise en relation → candidature →
dévoilement → conversation, avec les deux assertions de §D.4 sur ce que l’organisation reçoit (un code,
jamais l’e-mail ni le téléphone).

**D’où viennent les attendus.** `ATTENDUS`, dans le même module que l’inventaire : le *mode* dit **où**
la route cloisonne, `ATTENDUS` dit **ce qu’elle doit répondre** — dérivé des gardes que chaque route
appelle, lues dans le code (`requireOrgRole` → expert 403, admin 403 ; accès par identifiant → 404 hors
organisation ou hors écosystème, jamais 403 ; expert hors de son écosystème → 403, §D.3). Un attendu
`null` est **observé et dit, jamais compté** : c’est la liste à promouvoir après la première séance.
Une action **à effet** (clôturer, refuser, dévoiler, publier, appeler l’IA) est prouvée **une fois** dans
le parcours et **jamais rejouée** dans la matrice pour son propriétaire — la rejouer détruirait les
fixtures des cellules suivantes ; ses refus pour les autres populations, eux, sont joués (un refus ne
mute rien).

**Ce qu’elle NE prouve PAS — et une recette dont on croit qu’elle couvre tout est pire qu’aucune :**
· rien du **rendu**, de l’**i18n**, de l’**UX** — elle ne rend pas une page ;
· rien des **Redirect URLs** : gardées par `diag-parametrage-manuel`, pas par elle ;
· rien de **Vonage** ni du **SMTP** : l’OTP est **signé par la recette** avec le même secret que
  `verify-phone-otp` (les vraies routes `register-expert` / `register-org` sont appelées, seul le SMS
  est court-circuité), et l’e-mail est confirmé par l’API admin — `email_confirm: true`, arbitrage
  de l’architecte du 20/09/2026 ;
· le **premier administrateur** n’est pas créé par une route (aucune n’existe) : c’est le contournement
  §E.23, le même que `creer-premier-administrateur` ;
· le **moteur** : sans `ENABLE_RERANKING=true` et `COHERE_API_KEY`, aucun match ne naît, la candidature
  répond 403 `not_matched`, et la recette marque candidature → dévoilement → conversation **non joués**
  — elle ne les compte ni verts ni rouges.

**Ce qu’il lui faut** (l’en-tête du script le répète, c’est lui qui fait foi) : un projet Supabase
**jetable**, migrations et seed de production appliqués ; un `npm run dev` qui pointe dessus ; dans
l’environnement du script `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `PHONE_OTP_HMAC_SECRET` (ou `SUPABASE_JWT_SECRET`), `DEV_DOMAIN_SLUG`,
et `RECETTE_BASE_URL` si le serveur n’est pas sur `localhost:3000` ; un projet qui **accepte le**
**signUp anon** (SMTP configuré ou confirmation désactivée) ; et, pour le parcours, le moteur allumé.

**Ses garde-fous.** Sous `garde-ecriture` (`--db`, sinon code 2 et la liste de ce qu’elle écrirait) ;
`--base-jetable=<ref>` **obligatoire et égal** au ref du projet visé — on ne crée pas des comptes sur
une base par accident ; tout ce qu’elle crée porte un identifiant de passage et est **supprimé à la**
**fin** (sauf `--garder`), les traces d’audit d’abord (leur clé vers `users` est `RESTRICT`), en disant
ce qui reste. Trois codes de sortie : `0` vert · `1` rouge · `2` n’a pas tourné.

> **C’est le cinquième script qui écrit en base hors du périmètre de `diag-scripts-destructeurs`**
> (§E.4) — dit ici et dans le commit qui le livre, comme pour `creer-premier-administrateur`.

### C.13 — LA PALETTE : où elle vit, comment elle atteint l'écran, comment on ajoute un écosystème

> Établi au lot « palette unique » (21/09/2026), sur la mesure de
> [docs/audit-couleurs.html](audit-couleurs.html) : **184 teintes distinctes, 3180 couleurs écrites
> à la main dans 125 fichiers sur 479, zéro classe Tailwind**. L'accueil, lui, tenait en **quinze**
> couleurs déclarées dans un seul fichier. Décision : c'est cette palette-là qui gagne.

#### Les trois étages, et il n'y en a pas un quatrième

| Étage | Fichier | Ce qu'il porte |
|---|---|---|
| **Le calcul** | [lib/couleur.ts](../lib/couleur.ts) | Luminance WCAG, contraste, conversions TSL, dérivation d'accent. **Aucune couleur** — que des fonctions. C'est ce qui le rend importable sans cycle, et exécutable tel quel par un diagnostic (§E.3). |
| **Les valeurs** | [lib/palette.ts](../lib/palette.ts) | Les **huit rôles**, les **valeurs de référence**, les **couleurs fixes**, la **garde de contraste**, et les **jetons CSS**. Le seul fichier d'interface autorisé à écrire une couleur. |
| **Le réglage** | `domain_configs` | Ce qui change d'un écosystème à l'autre (§B.2 ⑩). |

**Une seule exception déclarée** : [lib/portraits-demo.ts](../lib/portraits-demo.ts), les 33 couleurs
des portraits SVG de la démonstration. Ce sont des couleurs d'**illustration** — carnations,
chevelures, vêtements —, pas d'interface : elles ne se règlent pas, ne portent aucun état, et la
garde de contraste n'a rien à dire d'une couleur de cheveux. L'exemption est **nommée, avec sa
raison**, dans le contrôle (§G.8 : une exemption sans raison est un tampon qu'on remplit sans lire).

#### LE CHEMIN, EN UNE LIGNE, ET C'EST TOUT L'INTÉRÊT

`domain_configs` → `resolvePalette()` **au serveur** → `stylePalette()` → **un style en ligne sur
`<html>`** ([app/[locale]/layout.tsx](../app/[locale]/layout.tsx)) → les jetons `--sk-*` → tout
l'écran.

**Pourquoi sur `<html>` et pas dans une feuille de style :**
· `<html>` **est** `:root` : les jetons naissent là où tout le monde les lit ;
· un style en ligne l'emporte sur toute feuille — il n'existe donc **aucun second endroit** où une
  couleur pourrait vivre, et c'est la propriété qu'on cherchait ;
· il arrive dans le HTML initial : la page n'est **jamais** peinte sans sa palette ;
· et il ferme **par construction** le défaut mesuré ci-dessous.

> ⚠️ **LE DÉFAUT QU'IL FERME, ET IL ÉTAIT INVISIBLE DEPUIS DES MOIS.**
> `globals.css` déclarait `--sk-accent` avec une valeur de secours, puis dérivait
> `--sk-accent-soft` et `--sk-accent-ink` par `color-mix(in srgb, var(--sk-accent) …)` **sur
> `:root`** — en comptant sur la surcharge que `<DashboardShell>` posait plus bas.
>
> **Ça n'a jamais marché.** Une propriété personnalisée est substituée **à l'endroit où elle est
> déclarée** : les deux dérivés se figeaient sur la valeur de secours et n'ont jamais suivi
> l'écosystème. **Mesuré dans un navigateur le 21/09/2026**, sur un témoin reproduisant la cascade
> mot pour mot : bordure `#0EA5E9` (elle lit `--sk-accent` directement, elle suit), fond
> `#E6EDFD` et texte `#2553BB` (les dérivés d'un bleu que personne n'avait choisi). L'entrée de
> menu active sortait **en indigo** pendant que le logo était **en bleu ciel**, à quinze pixels
> d'écart. Le commentaire de `DashboardShell` affirmait *« un domaine non-bleu reste cohérent »*.
>
> **La parade n'est pas de corriger la dérivation : c'est de N'EN AVOIR AUCUNE.** Tout est calculé
> au serveur et posé en littéral. La classe entière disparaît, elle n'est pas contournée.

#### AJOUTER UN ÉCOSYSTÈME — ce qu'il faut faire, et ce qu'il ne faut PAS faire

1. Le créer dans `/admin/ecosystemes`. Sa ligne `domain_configs` naît **aux couleurs de la
   référence**, par le `DEFAULT` des colonnes : il est lisible dès la première seconde, et
   l'écran les montre le premier jour.
2. Y régler la **couleur de marque** (le logo) et, si la marque l'impose au pixel, les autres rôles.
3. Ne rien régler d'autre : `boutons` se **dérive** de la marque jusqu'au contraste cible contre le
   fond de page de **cet** écosystème. Un écosystème dont le fond n'est pas celui de la référence
   obtient donc quand même un bouton lisible — c'est tout l'objet de la dérivation.
4. **Ne toucher à aucun fichier.** Un écosystème de plus n'est pas un déploiement, et c'est la
   propriété que ce lot achète.

**Ce qui est vérifié avant d'écrire, et ce qui ne l'est pas.** `verifierContraste()` refuse
**sept paires** — le texte principal et le texte secondaire sur chacune des trois surfaces, plus le
libellé d'un bouton sur son bouton. **Les bordures n'y sont pas, et c'est délibéré** : la bordure de
référence vaut **1,25** contre le fond de page, et exiger 3 pour 1 ferait rougir la palette de
l'accueil elle-même dès le premier jour (§E.14). On ne garde que ce qui a été nommé.

### C.14 — QUI DÉCLENCHE LE MOTEUR EXPERT, ET QUI ATTEND SA FIN

> ⛔ **UN RUN QUI A ÉCHOUÉ NE SE SOLDE PLUS — 23/09/2026, SUR LES TROIS APPELANTS.**
> `cron/expert-relance`, `me/sync-matching` et `admin/approve-expert` appelaient
> `solderRelance()` **quel que soit le verdict**. Moteur éteint, clé absente, plafond de dépense
> atteint, réglages illisibles : l'échéance était effacée comme après un run réussi. **Le jalon est
> posé, plus rien ne reprend** (§E.27 forme B) — et la modification de profil qui avait déclenché la
> relance n'est **jamais** notée.
>
> **LE CÔTÉ ANNONCE FAISAIT L'INVERSE DEPUIS TOUJOURS.** `acheverRun(…, acheve)` laisse
> `matching_completed_at` à `NULL` sur un échec : le run reste rejouable, borné à cinq tentatives,
> et **visible** au-delà. Deux comportements pour un même fait, et **c'est celui qui PERD qui était
> du côté de l'expert**.
>
> **LE TROISIÈME APPELANT N'ÉTAIT PAS DANS L'AUDIT.** L'approbation a été trouvée par le contrôle du
> lot, à sa première exécution, parce qu'il cherche un **comportement** — « qui appelle
> `solderRelance` ? » — et non une liste. C'est le pire des trois : son propre commentaire dit
> *« c'est le moment qui compte pour l'expert […] son premier contact avec la plateforme »*. Un
> moteur éteint à cette seconde-là, et cet écran restait vide **pour toujours**.
>
> **LA DÉCISION EST UN MODULE PUR** — [lib/matching/run-abouti.ts](../lib/matching/run-abouti.ts),
> **sans aucun import**, donc exécuté tel quel par son contrôle (§E.33), comme
> `expert-name-code.ts`, `empreinte.ts` et `vendabilite.ts`. `arret_de_notation`, `error` et
> `no_config` ⇒ on rejoue ; `ok`, `empty_pool` et **`ineligible`** ⇒ on solde — rejouer cinq fois
> ne rendra pas éligible un expert qui ne l'est pas, et son écran le lui dit déjà (§D.13 ①).
>
> **ET L'EXPERT LE SAIT.** Le flux porte `expert_status.derniere_recherche` ; les **deux** écrans
> jumeaux l'affichent au lieu d'« aucune mission » (§D.14), avec un motif **nommé** — jamais une
> phrase — et les six clés existent dans les quatre langues. Au-delà du plafond, le texte change :
> plus rien ne reprendra, et il le dit.
>
> **Gardé par [`diag-relance-rejouee`](../scripts/diag-relance-rejouee.mjs)** — il **exécute** la
> décision sur sept verdicts fabriqués, vérifie que **tout** appelant de `solderRelance` consulte
> d'abord `runAcheve`, que la base garde l'échéance et borne la file, et que le plafond vaut la même
> chose dans le module pur, dans le défaut SQL **et** dans la supervision.

Mesuré le 21/09/2026, puis corrigé le même jour. Le tableau ci-dessous est **l'inventaire complet**
des chemins qui mettent un expert en relation avec des annonces — il n'y en a pas d'autre.

| Déclencheur | Ce qui part | Qui attend | Pourquoi |
|---|---|---|---|
| **Bascule de disponibilité** (`/api/me/sync-matching`) | le moteur, **dans la requête** | **l'écran**, jusqu'à l'issue | un interrupteur à deux positions ne produit **aucune rafale** : l'heure d'attente n'y absorbait rien |
| **Ouverture croisée qui S'ÉLARGIT** (même route) | le moteur, dans la requête | l'écran | le périmètre grandit : il faut renoter |
| **Ouverture croisée qui SE FERME** (même route) | un **élagage SQL** dans `after()` | personne | rien n'est noté, rien n'est dépensé, **aucune issue n'est rendue** — la liste se raccourcit, c'est tout |
| **Approbation d'un profil** (`/api/profile`, transition vers `approved`) | le moteur, dans `after()` | personne | on ne se fait approuver qu'une fois : ce n'est pas une rafale, et c'est **le moment qui compte** pour l'expert |
| **Approbation par un admin** (`/api/admin/approve-expert`) | le moteur, dans `after()` | personne | idem |
| **Ré-analyse d'un CV** (`/api/profile/upload-cv`, `…/cdi-upload-cv`) | le moteur, dans `after()` | personne | le document qui décrit l'expert a changé |
| **Enregistrement ORDINAIRE du profil** (`/api/profile`, déjà approuvé) | une **relance à 10 min** (§D.15 — elle valait 60 jusqu'au 22/09/2026), repoussée à chaque enregistrement | personne | **c'est ici, et seulement ici, que la rafale existe** : dix passes sur un profil produisaient dix runs |
| **Pilote `expert_relance_trigger`** (pg_cron, 5 min) | la relance la plus ancienne **due** | personne | il ne prend que les échéances échues : une relance posée à T+60 ne part pas avant T+60 |

**LE PLAFOND HORAIRE S'APPLIQUE AUX DEUX PREMIERS COMME AUX RELANCES**, et c'est **le même** —
`consommerPlafondHoraire()` ([lib/matching/relance.ts](../lib/matching/relance.ts)), une seule
implémentation, extraite de `programmerRelance` le jour où un second appelant est apparu. Le
recopier aurait produit deux plafonds portant le même nom et vieillissant séparément (§E.20).

**L'ORIGINE EST DÉRIVÉE DU SERVEUR, JAMAIS DU CLIENT.** La route compare le périmètre courant à la
trace du dernier run (`profiles.last_matching_scope`) : différents ⇒ `ouverture_croisee`, identiques
⇒ `disponibilite`. Cette seconde origine **existait dans le type et n'était appelée nulle part** :
tout partait sous `ouverture_croisee`, y compris les bascules de disponibilité — les dépassements de
plafond étaient donc comptés sous une étiquette fausse, dans le seul compteur qui dise qui heurte le
plafond (§E.24).

**CE QUE LA ROUTE REND, ET CE QU'ELLE NE REND PAS.** La réponse porte une `IssueDeRecherche`
([lib/matching/issue-de-recherche.ts](../lib/matching/issue-de-recherche.ts)) — quatre états fermés,
douze raisons nommées, traduites dans les quatre langues. **L'élagage n'en rend aucune** : il n'a
rien cherché, et prétendre le contraire serait la faute symétrique de celle que §E.51 décrit.

**L'ATTENTE EST BORNÉE À 45 SECONDES, LE TRAVAIL NE L'EST PAS.** `maxDuration = 60` est le plafond de
l'hébergement (§E.5) ; au-delà la requête est tuée et l'écran ne peut plus rien dire de vrai. On
s'arrête donc avant, en rendant `trop_long` — une issue **nommée**. Le run, lui, est confié à
`after()` : il va jusqu'au bout, note, écrit ses recommandations, et l'expert les voit au
rafraîchissement suivant. *Ce qui expire est l'attente, pas le travail.*

> **CE QUE LE MOTEUR NE PEUT PAS FAIRE SANS CONFIGURATION, ET COMMENT ON LE SAIT MAINTENANT.**
> `ENABLE_RERANKING` doit valoir exactement `'true'` et `COHERE_API_KEY` doit être posée. Sans
> elles, `rerankerTout` s'arrête en quelques millisecondes, **sans erreur** — et le 21/09/2026 c'est
> exactement ce qui se passait, en silence, tous les compteurs de supervision au vert.
> Depuis : le reranker rend un `arret_code` **typé** (`interrupteur_ferme`, `cle_absente`,
> `aucun_document`, `plafond_atteint`), le verdict le porte dans `empechement`, l'écran le traduit
> en `moteur_indisponible` ou `plafond_atteint`, et `/admin/supervision` affiche les deux causes
> **en bloquant, séparément**. Détail et raisons : **§E.51** et **§E.52**.

### C.15 — LA COQUILLE DE L'ESPACE CONNECTÉ : qui la monte, qui en héritait, et ce qui reste

Recensé le 21/09/2026, page par page. **85 pages** sous `app/[locale]/`, dont **66 connectées**.

#### Ce qui monte le cadre, et à quel étage

| Fichier | Ce qu'il porte |
|---|---|
| `app/layout.tsx` | rien — `return children` (motif next-intl) |
| `app/[locale]/layout.tsx` | le document, les fournisseurs, et **la palette posée sur `<html>`** (§C.13) |
| `app/[locale]/dashboard/layout.tsx` | **aucun cadre visuel** : battement de session, garde de suppression, pied de page légal, garde de rôle serveur |
| `…/dashboard/{freelance,cdi,entreprise}/layout.tsx` | **montent `DashboardShell`** — 39 pages |
| `app/[locale]/admin/layout.tsx` | le cadre **admin**, écrit en ligne — 24 pages |

**`DashboardShell`** assemble `DashboardSidebar` (248 px, `--sk-bandeau`), `DashboardTopbar` (60 px,
`--sk-bandeau` depuis ce lot), le `<main>` et `GlobalBackButton`.

#### Les quatre cadres qui ont disparu

| Ce qui existait | Pages | Ce qui s'est passé |
|---|---|---|
| coquille recopiée dans `freelance/mon-profil`, **en trois exemplaires dans le même fichier** | 1 | supprimée — la page prend le cadre partagé |
| en-tête maison dans `cdi/mon-profil`, **sans barre latérale** | 1 | supprimé — la page prend le cadre partagé |
| `OrganisationSidebar` — 338 lignes | **0** | supprimée (règle 0) ; son type `OrganisationLite` est rapatrié chez son unique consommateur |
| deux listes d'exclusion (`LEGACY_SHELL_ROUTES`) | — | supprimées |

**Ce qui a été DÉPLACÉ, pas perdu.** Les deux en-têtes maison portaient des informations que la
coquille partagée ne porte pas : la **pastille de vérification** (les deux écrans) et le **statut de
marché** « en poste / en recherche » (CDI). Les deux suivent désormais le **titre de la page**. Les
retirer en silence aurait ôté, sur la page consacrée au profil, l'endroit même où l'expert lit son
état.

#### Les trois pages connectées SANS cadre, et pourquoi

| Page | Pourquoi |
|---|---|
| `dashboard/cabinet/page.tsx` | **redirection pure** vers `/dashboard/entreprise` (décision produit B3.5.fix : un seul tableau de bord organisation pour `client` / `esn` / `cabinet`). Conservée pour que les anciens signets ne tombent pas en 404. Elle ne s'affiche jamais plus d'un instant. |
| `reactivation/page.tsx` | vit **hors** de `/dashboard`, délibérément : sous la garde de suppression, elle produirait une boucle de redirection. |
| `invitation/[token]/page.tsx` | le destinataire n'est pas encore membre — il n'a pas de cadre à recevoir. |

#### Le cadre ADMIN, et la dette qu'il portait

Migré le 21/09/2026. Décision de Youssef : **le même cadre que le reste, seul le contenu du menu
diffère.**

| | Avant | Après |
|---|---|---|
| Barre latérale | **220 px**, peinte `#fff` **en dur** | 248 px, `--sk-bandeau` |
| Barre supérieure | **aucune** | la même que partout, `side="admin"` |
| Fond de page | `--color-background-secondary` (non défini) | `--sk-bg` |
| Défilement | `minHeight: 100vh` en grille — **la page entière défilait, menu compris** | le `<main>` défile, le cadre reste |
| Sélecteur de langue | en bas de la barre latérale | dans la barre supérieure, comme partout |

**LA BARRE SUPÉRIEURE EST LA MÊME, PAS UNE SECONDE.** `DashboardTopbar` accepte désormais
`side="admin"` et rend alors le titre et la langue, sans cloche, sans messagerie, sans sélecteur
d'écosystème — un administrateur n'a rien à faire de ces trois-là. Écrire un `AdminTopbar` à côté
aurait produit deux barres jumelles : corriger la hauteur de l'une aurait laissé l'autre derrière, et
la seconde se serait lue comme corrigée (§E.20).

**LE TITRE VIENT DU MENU, PAS D'UNE SECONDE LISTE.** `ADMIN_NAV_SECTIONS` porte déjà le nom de chaque
écran. Une table « chemin → titre » aurait créé deux inventaires des mêmes écrans, et le second aurait
vieilli seul : une entrée ajoutée au menu serait apparue à gauche et pas en haut.

#### Les jetons qui ne résolvaient nulle part — 574 occurrences

Le back-office lisait cinq propriétés `--color-*` **définies nulle part** : ni dans `app/globals.css`
(qui ne déclare que `--color-background` et `--color-foreground`), ni dans `lib/palette.ts` (qui
n'émet que des `--sk-*`). Elles retombaient donc **systématiquement** sur leur valeur de secours en
dur, et **le back-office ne suivait aucune palette d'écosystème**.

> **ET ÇA NE LÈVE RIEN.** Un `var()` dont la propriété n'existe pas prend sa valeur de secours, en
> silence : ni erreur, ni avertissement, ni style manquant. C'est la famille de §E.48 — une variable
> qui ne résout pas ne se voit pas.

**La correspondance n'a pas été devinée : elle était déjà écrite dans le dépôt.** Six de ces jetons
portaient **déjà** un `var(--sk-*)` en valeur de secours à certains endroits — la trace d'une
migration commencée et jamais finie. C'est donc le dépôt qui a dit vers quoi chacun allait.

| Jeton | Devient | Occurrences |
|---|---|---|
| `--color-text-secondary` | `--sk-muted` | 163 |
| `--color-text-primary` | `--sk-text` | 110 |
| `--color-text-tertiary` | `--sk-faint` | 75 |
| `--color-border-tertiary` · `--color-border` | `--sk-border` | 96 |
| `--color-background-primary` · `--color-surface` | `--sk-surface` | 43 |
| `--color-background-secondary` · `--color-surface-subtle` | `--sk-surface-2` | 19 |
| `--color-error` · `--color-error-soft` | `--sk-red` · `--sk-red-soft` | 40 |
| `--color-primary` | `--sk-accent` | 12 |
| `--color-warning` · `--color-warning-soft` | `--sk-amber` · `--sk-amber-soft` | 12 |
| `--color-success` | `--sk-success` | 4 |

**Les valeurs de secours ont DISPARU avec, et c'est le point** : un jeton `--sk-*` est toujours défini
— posé sur `<html>` par le layout racine — donc un secours n'aurait plus servi qu'à masquer une faute
de frappe dans un nom.

> ⚠️ **LES 75 `--sk-faint` DE L'ADMIN RESTENT À LIRE UN PAR UN.** La correspondance est mécanique et
> préserve l'intention visuelle (le gris ardoise `#94a3b8` ≈ le texte tenu), mais §D.12 interdit à
> `--sk-faint` de porter **une information** : il vaut 3,63 de contraste. Aucun motif ne distingue un
> repère d'un texte qu'on lit — cette moitié-là se lit écran par écran (§E.38).

**48 occurrences restent hors de l'espace admin**, dans six fichiers, gelées nommément dans
`diag-coquille-unique` : `AnnonceCard` (26), `OrganisationDashboard` (14), `not-found` (3),
`LegalFooter` (3), `MissionCard` (1), `PublicationForm` (1). Gel d'**état mesuré** (§G.8) : le compte
ne peut que descendre, et tout fichier NOUVEAU fait rougir.

**Deux exemptions déclarées, avec leur raison** : les propriétés `--font-*`, posées par `next/font`
dans une feuille générée au build que le contrôle ne peut pas lire ; et les propriétés qu'un composant
pose **sur sa propre racine** et relit dans son `<style>` (`--avatar-primary`, `--tjm-primary`,
`--compact-accent`) — un usage local parfaitement valide, que le compter comme orphelin ferait crier
à tort, donc désactiver dans la semaine (§E.14).


### C.17 — L'ÉLIGIBILITÉ : une liste de données que les deux sens du moteur plient

**Le défaut, mesuré le 23/09/2026.** `lib/matching/pool.ts` (annonce → experts) poussait **sept**
filtres en SQL ; `lib/matching/run-for-expert.ts` (expert → annonces) faisait **six** tests en
mémoire. Trois manquaient au second — compte **suspendu**, en **suppression**, **anonymisé** — et
son `select` ne chargeait ni `status`, ni `deletion_scheduled_at`, ni `anonymized_at` : le test
aurait lu `undefined` (§E.1).

**Et les deux fichiers disaient le contraire** : « exactement les mêmes conditions que côté vivier »
(run-for-expert) et « la SEULE implémentation de la garde […] pas de seconde liste »
(issue-de-recherche). Deux commentaires vrais le jour de leur écriture (§E.7).

**Ce que ça coûtait, et c'était atteignable.** `requireAuth` ferme la porte aux trois états
(`account_suspended`, `account_deletion_scheduled`, `account_anonymized`) : aucun écran ne pouvait
déclencher un run sur un compte fermé. **Deux chemins serveur ne passent pas par là** :
`app/api/cron/expert-relance` (aucune session) et `app/api/admin/approve-expert` (c'est le statut
de **l'administrateur** que la garde lit). Un expert suspendu était donc noté chez le fournisseur —
dépense réelle — puis **notifié** : des e-mails « de nouvelles missions » à un compte dont l'accès
est coupé.

**La forme retenue, et pourquoi pas une fonction partagée.** Les deux sens ne peuvent pas partager
une fonction : l'un construit une requête sur cinquante mille lignes, l'autre juge une ligne déjà
chargée. Une « fonction commune » aurait été deux fonctions — le jumeau qui venait de diverger.
Chaque condition est donc une **donnée** portant ses deux formes :

| | |
|---|---|
| `remplie(ligne)` | le test en mémoire |
| `filtre` | `{ cible, colonne, operateur, valeur }` — la forme SQL, **décrite**, pas appliquée |
| `portee` | `toujours` · `expert_freelance` · `expert_cdi` |
| `raison` / `journal` | le code que l'écran traduit, et la phrase du journal serveur |

`pool.ts` plie `appelsPostgrest()` en quatre lignes ; `run-for-expert.ts` appelle
`jugerEligibilite()`. **Ajouter une condition l'ajoute des deux côtés**, et il n'existe aucun endroit
où l'on puisse en ajouter une d'un seul côté.

> ⚠️ **`neq_ou_null` N'EST PAS UN CAPRICE.** En SQL, `colonne <> 'x'` vaut NULL quand la colonne est
> NULL, et la ligne est **écartée** ; en mémoire, `p.colonne === 'x'` est faux sur `null` et la
> ligne est **gardée**. Sur une colonne nullable, un `neq` simple ferait donc diverger les deux sens
> sur exactement les profils qui n'ont jamais touché au réglage. `users.status` est `not null`
> (mesuré) : elle seule garde un `neq` simple.

**Ce qui est dérivé, et ne peut donc plus diverger** : le type `RaisonIneligible` (de la liste), les
colonnes des deux `select` (de la liste), la phrase de journal (portée par la condition).
`issue-de-recherche.ts` **ré-exporte** le type au lieu de le redéfinir.

**Gardé par [`diag-eligibilite-unique`](../scripts/diag-eligibilite-unique.mjs)** : il **exécute**
les deux formes sur une matrice de quinze lignes × deux publics et exige le **même verdict** —
sémantique NULL comprise. Il balaie `lib/matching/` pour **toutes** les colonnes et `app/api/` pour
les colonnes de **compte**, qualifiées ; le détecteur est construit **depuis la liste du module**
(§E.61), et l'exclusion des colonnes de profil hors du moteur est **mesurée** (`/api/profile/visibility`
les écrit légitimement), pas supposée.

> ⚠️ **Quatre contrôles ont rougi sur le DÉMÉNAGEMENT, pas sur une régression** —
> `diag-moteur-echelle`, `diag-lot-expert-verification`, `diag-moteur-reranking`,
> `diag-issue-de-recherche` cherchaient le **texte** des filtres dans le vivier. Ils interrogent
> désormais la règle à la source (§E.34). Et l'un d'eux a révélé un piège de plus : un
> `await import()` en milieu de fichier fait **planter Node à la sortie sous Windows quand stdout
> est redirigé** — vert à la main, **MUET dans la série**. Les imports de modules purs sont donc
> **statiques** (§E.57).

### C.18 — « OCCUPÉ » : les quatre surfaces, et ce que chacune ferme

| Surface | Ce qu'elle ferme | Comment elle le sait |
|---|---|---|
| `lib/matching/pool.ts` | l'expert n'entre pas dans le vivier d'une annonce | plie les filtres SQL de la règle |
| `lib/matching/run-for-expert.ts` | aucune recommandation ne lui est calculée | plie le test en mémoire |
| `lib/missions/feed.ts` | sa liste de missions est fermée | `enIndisponibilite()` |
| `lib/candidatures/depot.ts` | **il ne peut pas postuler** — c'est §D.21 | `jugerEligibilite()` |

**Les trois premières tenaient, la quatrième manquait.** Un match posé avant qu'il ne se déclare
occupé restait cliquable : le bouton s'affichait, et le serveur **acceptait** le dépôt.

**Le dépôt lit la règle ENTIÈRE, et ce n'est pas un élargissement gratuit.** §D.19 a rendu le
jugement de Claude obligatoire au dépôt ; un expert dont le **consentement IA** a été retiré après la
création du match aurait donc vu son profil partir chez le fournisseur. La condition existait dans le
moteur et n'avait aucune raison de s'arrêter à la porte du dépôt.

**Trois propriétés, et chacune ferme un chemin :**
· la garde est posée **avant le journal, avant le modèle, avant l'écriture** — juger après, c'est
  payer un jugement dont on jette le résultat ;
· elle rend `{ issue: 'inapte', raison }`, **distinct** de `refusee` : un refus de garde porte sur
  l'annonce, celui-ci sur LUI, et il peut y remédier. Les confondre rendrait un code qui ne dit pas
  quoi faire ;
· le **public** vient de `users.user_type` — une constante appliquerait la disponibilité freelance
  à un salarié, et inversement.

**L'écran ferme le bouton AVANT le clic** : la réponse est connue sans rien lancer (§D.13 ①). Il est
**remplacé** par sa raison, pas grisé (§D.1), et l'aptitude vient du **serveur** — la recopier dans
l'UI la figerait dans le bundle (§E.15). Le refus serveur est traité **aussi** : l'écran a pu être
chargé avant que l'expert ne se déclare occupé.

**PARITÉ CDI, MESURÉE** : les deux pages de détail — freelance et CDI — montent le **même**
composant. La parité est structurelle ; un second composant la ferait diverger (§E.20).

> ⚠️ **DEUX ÉCRIVAINS DE PLUS, TROUVÉS EN FAISANT CE POINT.** `lib/missions/feed.ts` posait
> `availability_status === 'do_not_disturb' || cdi_status === 'employed'` sous un commentaire disant
> « UN SEUL endroit lit ces colonnes » — vrai du flux, faux du produit (§E.7). `DashboardShell`
> posait la même, pour sa pastille : elle aurait dit « disponible » à un expert que le serveur venait
> de fermer. Les deux lisent désormais `enIndisponibilite()`.
> **Le contrôle de §D.20 ne balayait que `lib/matching/`** : il ne pouvait pas les voir (§E.61).

> **UNE SEULE EXEMPTION, ET ELLE PORTE SA RAISON (§G.8)** : `SpotlightCandidateCard` compare la
> valeur pour choisir un **libellé** et une **couleur**, et distingue **trois** états — disponible,
> occupé, inconnu. La règle répond à une question binaire ; la lui faire poser perdrait le libellé
> « disponible ». Elle ne décide de rien.

### C.19 — QUI PARLE POUR UNE ORGANISATION, ET DANS QUELLE LANGUE ON LUI ÉCRIT

**Une organisation n'a pas de langue.** Elle a des membres, qui en ont chacun une. La question se
pose dès qu'un texte lui est adressé : l'e-mail d'approbation, celui de refus, la fiche admin — et
depuis §D.23, le **résumé de candidature**.

**La règle existait, et elle n'était écrite nulle part** : *le membre ADMIN **actif** le plus
**ancien***. Les trois ensemble — un admin inactif ne parle plus, et sans l'ordre on prend n'importe
lequel, donc un autre à chaque lecture. Elle vivait dans quatre requêtes, sous un commentaire.

**Le module partage le CRITÈRE, pas la projection**
([lib/organisations/porte-parole.ts](../lib/organisations/porte-parole.ts)). Les quatre lecteurs ne
chargent pas les mêmes colonnes : l'un veut une langue, les autres aussi un e-mail et un prénom.
Partager la projection les forcerait à charger ce dont ils n'ont pas besoin — et **un e-mail chargé
pour rien est une donnée personnelle chargée pour rien**.

| Lecteur | Ce qu'il en tire |
|---|---|
| le **dépôt de candidature** | la langue du résumé (§D.23) — il appelle `langueDeLOrganisation()` |
| `approve-org` | langue + e-mail + prénom, pour l'e-mail d'approbation |
| `reject-org` | idem, pour l'e-mail de refus |
| `get-org/[id]` | le contact principal affiché sur la fiche admin |

> **CE QUI RESTE OUVERT, ET SE DIT (§E.38)** : les trois derniers n'utilisent pas encore la constante
> `PORTE_PAROLE`. Le jour où la règle change — le propriétaire plutôt que le doyen, par exemple —
> il faudra les quatre. Le contrôle les **liste nommément**, avec leur raison : leur nombre ne peut
> que descendre (§G.8).

**LA LANGUE PAR DÉFAUT EST UNE DÉCISION, PAS UN REPLI.** Le produit est francophone d'abord ; une
organisation sans admin actif lisible reçoit donc du **français**, et non « rien » — qui laisserait
le modèle choisir. Aucune lecture en panne ne fait échouer un dépôt : refuser une candidature parce
qu'on n'a pas su dans quelle langue l'écrire serait absurde. Mais elle **se dit** (§E.22).

### C.20 — LE GRAND LIVRE : pourquoi pas de trigger d'écriture, pourquoi pas de partitionnement, comment la pièce traverse pg_cron et `after()`

**Pourquoi pas de trigger d'écriture — `set local` et PostgREST.** La conception de départ posait la
garantie sur la base : *« là où c'est possible, c'est la base qui écrit, par trigger sur la table
métier »*. Mesuré dans ce dépôt : **178 sites d'écriture, 41 tables, 86 fichiers, tous par PostgREST**.
Chaque `.from(…).insert(…)` est **sa propre transaction** ; il n'existe aucun moyen, avec ce client,
d'écrire la ligne métier et la ligne de journal dans la même. Et un trigger ne peut pas connaître la
**pièce** : le seul canal serait une variable de session (`set local app.piece`), qui **ne vaut que pour
la transaction courante** — la requête suivante prend une connexion du pool, peut-être une autre, et
ouvre une transaction neuve. Les cinq écritures d'un dépôt de candidature ne partagent **aucun**
contexte de session. Ce n'est pas une mesure à faire, c'est la définition. En revanche `set local` et
la pièce vivent très bien **à l'intérieur d'une RPC** : c'est ce que le projet a déjà choisi huit fois
(§F — `programmer_relance_expert`, `set_default_package`, `stripe_event_claim`, `usage_increment`,
`rate_limit_check`, `maj_membre_organisation`, `ouvrir_depot_candidature`, `prendre_bail`). Le grand
livre généralise ce choix : **une RPC SECURITY DEFINER écrit la ligne métier ET la ligne de journal en
un appel**, et le trigger ne sert qu'au **verrou**. Deux mécanismes d'écriture auraient divergé (§E.20).

**Le coût honnête, et comment il se paie.** Faire passer 178 sites par des RPC est un très gros lot.
On ne le fait pas d'un coup : le contrôle se pose sur **la liste des actions journalisables**, pas sur
« toute route qui écrit ». Les actions de la liste passent par la fonction, une par une (étape 2) ;
le reste écrit comme aujourd'hui.

**Pourquoi pas de partitionnement maintenant.** Aucune table du dépôt n'est partitionnée, et le volume
journalisé tient en trois chiffres (127 lignes d'audit en cinq mois). Partitionner le premier jour
achèterait quatre contraintes Supabase (index locaux, RLS et revoke à reposer par partition, un
batch qui détache une partition) contre rien. Ce qui est fait **dès aujourd'hui** est ce qui rend le
partitionnement indolore plus tard : la **date en tête** de chaque index de filtre, vérifiée dans
`pg_index` par la postcondition ; et deux exceptions nommées (pièce, sujet) parce qu'elles se
cherchent sans période. Le batch manuel, la rétention réglable, le plancher légal, l'annonce avant, la
confirmation et l'écriture de l'exécution sont conservés tels quels pour l'étape 4 (§E.46).

**Comment la pièce traverse pg_cron.** Une tâche SQL pure génère la sienne : `effacer_adresses_ip()`
pose `v_piece := gen_random_uuid()` en tête et journalise **succès** (dans le bloc) et **échec** (dans
le gestionnaire, après l'annulation du sous-bloc), même pièce. Une tâche qui appelle une route
(`trigger_purge_cron`) la générera de la même façon et la **transmettra dans le corps HTTP** à côté de
`log_id` — la route la lit avec `estPiece()` et la passe à tout ce qui en découle (étape 3). Le moteur
n'a **aucun identifiant de run** à promouvoir en pièce (mesuré : zéro occurrence) : le grand livre ne
relie pas son histoire, il la **crée** — une ligne par étape de run, jamais par lot ni par profil.

**Comment la pièce traverse `after()`.** Elle voyage en **paramètre** — `nouvellePiece()` à l'entrée
de la route, avant toute écriture, puis passée à chaque appel. Un `after()` capture la pièce dans sa
fermeture comme n'importe quelle valeur : rien à faire, et rien d'autre ne survit à la réponse (§E.5).
Ce qui **ne** marcherait **pas**, et qui est interdit dans `lib/journal/` : un contexte ambiant
(`AsyncLocalStorage`), qui aurait l'air commode et perdrait la pièce au premier changement de
contexte, en silence. Un paramètre obligatoire ne se perd pas : le compilateur nomme l'appel qui
l'oublie.

**Un rejeu est un nouveau geste.** Il porte une **nouvelle** pièce qui référence l'originale
(`piece_origine`), à la date du rejeu, par l'administrateur qui l'a décidé — jamais la pièce du dépôt
d'origine, ce qui ferait une histoire où un expert a postulé deux fois. Et il vit dans le grand livre,
pas dans `candidature_depots`, qui écrase au rejeu.

### C.16 — LES E-MAILS : pourquoi ils n'ont pas de jetons, et d'où viennent leurs couleurs

**LA CONTRAINTE, MESURÉE.** Les clients de messagerie **ne lisent pas les propriétés
personnalisées**. Outlook rend le HTML avec le moteur de Word, les webmails réécrivent la feuille de
style, les applications mobiles en gardent un sous-ensemble : `color: var(--sk-text)` y est **ignoré**,
et le texte tombe sur la couleur par défaut du client — souvent noir sur blanc, **parfois blanc sur
blanc en thème sombre**.

> C'est la famille de **§E.48** — une variable qui ne résout pas ne se voit pas — mais pour une raison
> différente. Là-bas, c'est la **syntaxe** qui l'interdit (un attribut de présentation SVG n'est pas
> une propriété CSS). Ici, c'est le **destinataire** qui ne sait pas la lire, et nous ne saurons jamais
> lequel il utilise.

**Un e-mail ne peut donc porter que des valeurs littérales. « Littérales » ne veut pas dire « écrites
deux fois. »**

| | Avant le 21/09/2026 | Après |
|---|---|---|
| Où vivaient les couleurs | recopiées à la main dans `lib/emails/layout.ts` **et** dans `lib/emails/templates.ts` | résolues par [lib/emails/couleurs.ts](../lib/emails/couleurs.ts) depuis `lib/palette.ts` |
| Ce qu'elles valaient | la gamme ardoise, plus `#00B9FF` — **qui n'est la marque de personne** depuis le lot palette | les valeurs de `PALETTE_REFERENCE` |
| Ce que ça produisait | **un e-mail envoyé portait des couleurs que plus aucun écran n'utilisait** | la même palette que les écrans |

#### Le piège de l'interpolation, et pourquoi le script a refusé

Huit de ces couleurs vivaient dans des chaînes entre **apostrophes**, passées à `interpolate()`. Une
apostrophe n'interpole pas : y écrire `${…}` aurait produit le texte littéral
`${COULEURS_EMAIL.texte}` **dans l'e-mail du destinataire**.

Trois chaînes ont été converties en chaînes modèles — mais **seulement après vérification** qu'elles
ne contiennent ni backtick ni `${`. Leurs marqueurs à elles sont des `{url}` / `{label}` en accolades
simples, que `interpolate()` remplace et qu'une chaîne modèle laisse tranquilles. Les deux dernières
ont été faites à la main.

#### L'exemption de sécurité, et sa borne

`diag-lot7-securite` exige que **toute valeur interpolée dans du HTML d'e-mail soit échappée ou
nommée en exception**. Les `${COULEURS_EMAIL.x}` ne sont pas échappés : ce sont des constantes du
dépôt, vérifiées par la garde de contraste et par le cliquet des couleurs littérales.

> ⚠️ **L'EXEMPTION EST BORNÉE À CET OBJET**, pas à « tout ce qui ressemble à une couleur ». Le jour
> où une couleur viendra de la **base** — la palette d'un écosystème, par exemple — elle devra être
> échappée comme n'importe quelle autre valeur, et cette ligne ne la couvrira pas.

#### Ce qui reste ouvert, et qui se dit plutôt que se cache

Ces couleurs sont celles de la palette **de référence**, pas celles de l'écosystème du destinataire.
Les rendre dynamiques demande de faire descendre la palette jusqu'au point d'envoi, qui ne reçoit
aujourd'hui que le **nom de marque** (`brandName`). C'est un lot à soi, et il n'est pas fait — l'écrire
est plus honnête que de laisser croire le contraire (§E.38).

## D. Les décisions figées — le détail

> **L'index tient dans [CLAUDE.md](../CLAUDE.md) §D — une ligne par décision, chargée à chaque
> session. Le DÉTAIL vit ici depuis le 24/09/2026** : le cas mesuré, les arguments, le contrôle qui
> garde chaque décision. Déplacé pour ramener CLAUDE.md sous 80 000 caractères (budget 100 000,
> §G.5 bis) sans renégocier le budget à chaque lot. **Rien n'a été réécrit** : chaque bloc est celui
> qui vivait dans CLAUDE.md, liens relatifs corrigés. La règle de maintenance vaut ici comme là-bas :
> une décision nouvelle → sa ligne dans l'index, son détail ici, **dans le même commit**.

<a id="d1"></a>

**D.1 — Le lancement est gratuit et rien n'encaisse. Deux verrous, tous deux au serveur.**
[lib/billing/config.ts](../lib/billing/config.ts) :
① la **clé Stripe scopée par environnement** — absente ⇒ 503 ; et le contrôle va **dans les deux
sens** : `sk_test_` en production (les clients croient payer) et `sk_live_` hors production (les tests
débitent de vraies cartes) sont **tous deux refusés durement** ;
② l'**interrupteur `ENABLE_BILLING`**, qui doit valoir exactement `'true'`.
**Aucune variable `NEXT_PUBLIC_`** : le verrou serait lisible dans le bundle, et l'UI pourrait diverger
du serveur. L'UI apprend l'état du mur par une réponse serveur.
Corollaire gardé par `diag-murs-fermes.mjs` : **aucun bouton désactivé** sur un mur de conversion (un
bouton qu'on ne peut pas cliquer promet une porte qui n'existe pas), et le mur reste **fermé par
ignorance** (`=== true`, jamais une vérité simple).

<a id="d2"></a>

**D.2 — Les SMS de notification sont coupés AU DISPATCHER. Les OTP sont intacts.**
[lib/notifications/canaux.ts](../lib/notifications/canaux.ts) : `CANAUX_OUVERTS = ['email']`.
Un seul point, **fermé par défaut** — couper événement par événement laisserait le prochain événement
ajouté repartir tout seul par recopie de `channels: ['email','sms']`.
Les **OTP d'authentification ne passent pas par là** : autre API Vonage (Verify v2,
`api.nexmo.com/v2/verify`), appelée directement par les routes d'auth, sans toucher ni ce module, ni le
dispatcher, ni [lib/sms/vonage.ts](../lib/sms/vonage.ts) (`rest.nexmo.com/sms/json`).
Code V2 **conservé délibérément** : `runChannel`, le gabarit SMS et les branches `channel === 'sms'`
sont inatteignables tant que le canal est fermé — ce n'est pas un oubli.
⚠️ Rouvrir `sms` **réactive une dépense sortante immédiatement**. Prérequis minimum : préférence par
défaut en **opt-in** (aujourd'hui l'absence de ligne vaut activé, §B.2 ④) et interrupteurs rendus aux
écrans.

<a id="d3"></a>

**D.3 — Un expert appartient à un écosystème à vie ; une organisation les voit tous.**
[lib/ecosystem-scope.ts](../lib/ecosystem-scope.ts), `ecosystemAccessScope()` :
expert → `own` · client/cabinet → `all_active` · admin → `platform` (écosystème **désactivé compris** :
c'est de là qu'on le réactive) · **tout autre type → `null` = REFUS**, aucun `default:` permissif.
Le cloisonnement des **données** se fait sur `publications.domain_id` et `candidatures.domain_id`, via
`activeEcosystemId(auth)` — un nom unique et **greppable**, parce qu'un filtre manquant ne lève rien :
il renvoie simplement trop de lignes. Le filtre est posé **dans** la recherche par identifiant, pas
après : un objet hors écosystème est **introuvable** (404, jamais 403 — « cet objet existe, mais
ailleurs » serait déjà une fuite).
`x-subdomain` **est falsifiable** : le proxy ne l'injecte pas sur `/api` (son matcher exclut `api`),
c'est le client qui le pose via `useSecureFetch`. La garde ne dépend donc pas de l'appelant, elle
recroise l'en-tête avec `users.domain_id` et la population. Gardé par
`diag-cloisonnement-ecosysteme.mjs` et `diag-ecosystem-scope.mjs`.

<a id="d4"></a>

**D.4 — Le nom de l'expert s'affiche abrégé, au serveur ; e-mail et téléphone ne sortent JAMAIS.**
[lib/expert-name-code.ts](../lib/expert-name-code.ts) (calcul pur, **sans aucun import**, pour être
exécutable tel quel par le diagnostic) + [lib/expert-name-masking.ts](../lib/expert-name-masking.ts)
(libellés de repli traduits).
Règle : 1ʳᵉ lettre du prénom + 2 premières lettres du nom, majuscules, sans espace ni point.
`Youssef Cherif → YCH`. **Asymétrie voulue** : nom absent → 3 lettres du **prénom** ; prénom absent →
**2 lettres seulement** du nom (le patronyme est la partie identifiante, on n'en donne jamais plus).
Séparateurs sautés (`D'Amico → DA`), `normalize('NFC')`, `toUpperCase()` et **non**
`toLocaleUpperCase()` (en turc `i → İ` : le même nom s'afficherait différemment selon le serveur).
`reveal_contact` vaut **`false` partout, toujours**, même après dévoilement. Aucun chemin serveur ne
projette `email` / `phone` / `linkedin_url` / `cv_url` vers un utilisateur d'organisation.

<a id="d5"></a>

**D.5 — Le dévoilement se referme quand la candidature bascule en archive, sauf si elle est retenue.**
[lib/expert-disclosure.ts](../lib/expert-disclosure.ts) : **l'état de vie prime sur le statut**. Un
`status='unlocked'` figé en base ne rouvre rien une fois la candidature archivée — sinon une
organisation pourrait publier, déverrouiller, laisser expirer, et se constituer une base de profils
identifiés (détournement de finalité).
Le motif de l'archivage est **indifférent** : expiration 30 j, clôture manuelle, retrait, fenêtre
d'échange close, refus — clôturer plutôt que laisser expirer ne contourne rien.
`selected` est **actif sans limite de durée** ([lib/candidatures/lifecycle.ts](../lib/candidatures/lifecycle.ts) §2) :
un candidat retenu ne se re-masque jamais, la relation commerciale existe.
Ce qui se ferme est le **chemin d'accès permanent**, pas la trace : le corps des messages n'est pas
réécrit, on n'efface aucun historique et on ne prétend pas l'avoir anonymisé. L'en-tête d'un fil
archivé, lui, re-masque.

<a id="d6"></a>

**D.6 — Aucun score de PERTINENCE chiffré à l'expert ; la note de CANDIDATURE sur 10, OUI, et c'est VOULU.**
Ce qui est vrai et gardé (`diag-score-de-pertinence.mjs`) : `relevance_score` n'est **jamais lu** par
`/api/me/missions` ni `/api/me/missions/[id]` (il est seulement passé en **chaîne** à `.order()`), et
les vues expert n'affichent **aucun nombre** de pertinence. Seul le **palier** sort
(`strong` / `normal`). Deux valeurs et pas trois : une troisième réintroduirait une graduation, donc un
classement, donc la comparaison entre experts — que le produit interdit.
**L'AUTRE MOITIÉ DE LA RÈGLE, ET ELLE EST DÉLIBÉRÉE.** La note de **candidature** `ai_match_score`
**est** servie à l'expert par `/api/me/candidatures` et **affichée** sous la forme `N/10` —
[components/dashboard/CandidaturesTrackingView.tsx:291](../components/dashboard/CandidaturesTrackingView.tsx#L291),
monté par `/dashboard/freelance/candidatures` et `/dashboard/cdi/candidatures`, plus
`CandidatureDetailPanel` (`timeline.ai_proposed`). `diag-score-de-pertinence.mjs` la classe
explicitement parmi les occurrences **légitimes**.
**Ce fut un temps signalé ici comme un écart. Ce n'en est pas un : c'est une décision produit,
arbitrée.** Les deux grandeurs ne disent pas la même chose — la pertinence explique *pourquoi ce
profil apparaît* et n'est ni calibrée ni comparable d'une annonce à l'autre ; la note de candidature
dit *ce que vaut ce dossier*, sur une échelle tenue par un texte. La première se compare entre
experts, la seconde non.
**La règle, en une phrase : aucun score de PERTINENCE chiffré à l'expert ; la note de CANDIDATURE
sur 10, oui, et c'est voulu.**

<a id="d7"></a>

**D.7 — Le commerce se pilote depuis le back-office. Rien en dur.**
Écrans : `/admin/packages`, `/admin/matching`, `/admin/quotas-ia`, `/admin/organisations/[id]`,
`/admin/ecosystemes`, `/admin/taches-planifiees`, `/admin/taxonomie`.
`lib/entitlements.ts` ne contient **aucune** valeur de prix ni de quota — seulement les **codes** de
features (contrat avec le seed) et le mapping `org_type → target_role`.
La règle est plus large que le commerce : **un réglage règle quelque chose, ou il le dit**
(`diag-reglages-inertes.mjs`). Les trois cas déjà corrigés — les seuils du moteur (qui vivaient dans le
prompt), le quota d'analyses de CV (six écritures en dur pour un réglage), le plafond de dépense.
Le seed (`commerce_seed`) est `ON CONFLICT DO NOTHING`, **jamais `DO UPDATE`** : un redéploiement ne
doit pas écraser une valeur ajustée par un admin.
Exception **assumée et documentée** : le plafond anti-abus de relance (20/h/expert) reste une constante
de code — « un seuil anti-abus n'est pas un réglage commercial, et le rendre réglable invite à le
désactiver le jour où il gêne ».

<a id="d8"></a>

**D.8 — L'organisation PERSONNELLE d'un expert n'a PAS de logo, et c'est délibéré.**
L'organisation `org_type = 'freelance'` est **technique** : elle existe parce que
`publications.organization_id` est `NOT NULL` (§P1.2 bis). Le bucket `org-logos` et ses policies la
couvrent **sans exception** — une exception dans une policy est une dette — mais **aucune surface
d'édition** ne lui est ouverte, et son état vide reste les **initiales** de `company_name` (qui vaut
« Prénom Nom » de l'expert).

Le motif, pour que personne ne prenne ça pour un oubli et ne l'ouvre :
1. **L'expert a DÉJÀ une image, et elle est protégée.** `profiles.photo_url` est servie par URL
   signée **sous la gate de dévoilement** (`reveal_photo`). Un logo d'organisation personnelle serait
   une **seconde image de la même personne, SANS gate**.
2. **Ce serait donc un contournement du masquage**, sur la surface exacte où il compte : les cartes
   de casting ne masquent que sur `pub.confidential`. Un expert annonceur pourrait poser sa propre
   photo en « logo » et la faire voir hors de toute gate.
3. Lui donner une identité visuelle propre reviendrait à en faire une vraie entité — et il faudrait
   alors lui construire un écran dans un dashboard où elle n'a pas sa place.

Décision prise par Youssef, sur les trois arguments ci-dessus. **Rouvrir ce point suppose de trancher
le point 2 d'abord.**

<a id="d9"></a>

**D.9 — LE MOT « SEUIL » EST INTERDIT. Quatre mots, un par comportement.**
Trois worktrees ont posé **trente-cinq** réglages sur plusieurs semaines. Chacun a écrit « seuil »
parce que c'était le mot du moment, et personne n'a imposé de vocabulaire. Résultat : **le
propriétaire du produit a ouvert `/admin/matching` et n'a pas su quoi faire.** C'est le seul verdict
qui compte, et il est sans appel.

| Mot | Ce qu'il fait | Exemple |
|---|---|---|
| **PLAFOND** | il **BLOQUE** — atteint, la fonctionnalité s'arrête | dépense mensuelle, quota d'analyses de CV |
| **ALERTE** | elle **SIGNALE** — elle marque, elle n'empêche rien | dépense par organisation, par expert |
| **FILTRE** | il **TRIE** — il décide ce qui est montré | `feed_threshold`, `notify_threshold` |
| **NOTE** | elle **JUGE** — elle qualifie un dossier | auto-approbation d'expert, vérification d'entreprise, qualité d'annonce |

**La règle : tout nouveau réglage se nomme plafond, alerte, filtre ou note — à l'écran, dans la doc,
et dans tout code neuf. Un réglage qui ne rentre dans aucun des quatre SE DIT** (une durée, un
référentiel, un interrupteur, un choix de modèle) **plutôt que de se faire appeler « seuil » par
défaut.** Un worktree qui écrit « seuil » réintroduit le défaut de ce lot.

> ⚠️ **L'EXCEPTION, ET ELLE EST DANS LE MÊME PARAGRAPHE — SINON LA RÈGLE MENT AU PREMIER `grep`.**
> **Les colonnes existantes y échappent encore** : `feed_threshold`, `notify_threshold`,
> `confidence_threshold`, `auto_approve_threshold`, `seuil_mensuel_usd`. Les clients Supabase ne
> sont pas typés (§E.1) : une colonne est lue **par son nom, dans une chaîne**, et un renommage
> **casse au runtime, en silence**, dans tout code qui la cite. Leur renommage est un **lot à lui
> seul**, avec son propre contrôle. C'est une décision, pas un oubli.
> Ce qui prend le vocabulaire **dès maintenant** : les écrans, la documentation, les messages i18n,
> les **noms de contraintes** (aucun lecteur en chaîne — `matching_settings_filtre_flux_check`), et
> tout code neuf.

<a id="d10"></a>

**D.10 — TOUTE NOTE DU PRODUIT EST SUR 0-10. Il n'y a pas de seconde échelle.**
Les filtres de pertinence vivaient en **0-1**, les notes de jugement en **0-10**, et rien ne le disait
à l'écran : **« 1 » signifiait *parfait* d'un côté et *médiocre* de l'autre**, sur la même page.
Le reranker produit du 0-1 — c'est sa nature, on n'y touche pas : sa sortie est multipliée par 10
**au seul point où un score entre dans le système**, la frontière avec le fournisseur
([lib/matching/rerank.ts](../lib/matching/rerank.ts)).
**Aucune autre conversion n'existe**, et c'est gardé par
[scripts/diag-echelle-des-notes.mjs](../scripts/diag-echelle-des-notes.mjs). Convertir à l'affichage
laisserait deux représentations ; convertir à la comparaison la mettrait sur **quatre** sites, et en
oublier un transformerait `score < 7` en `score < 0.7` — tout passe, ou rien ne passe, **en silence**.
Détail et raisons complets : **§P3.0** dans [docs/produit.md](produit.md).

<a id="d11"></a>

**D.11 — UN ÉCRAN DE RÉGLAGE NE MONTRE QUE CE QUI SE DÉCIDE.**
Un réglage **mort**, **inerte** ou **technique** se **documente** ; il ne s'affiche pas avec un champ
de saisie et un bouton « Enregistrer » à côté.

**Un champ qui ne règle rien finit par être rempli.** C'est la règle qui manquait, et c'est
l'absence de cette règle qui a produit **35 réglages dont 16 sans écran et 2 qui ne gouvernent rien**.

**Ce qu'elle interdit, concrètement :**
· afficher un champ grisé avec trois lignes expliquant qu'il ne décide de rien — on l'a fait pour
  `sirene_insee`, et le résultat est un écran qu'on ne sait plus lire ;
· afficher un identifiant de base (`claude_expert_coherence_check`, `ai_coherence_check`) comme
  **titre** — ce sont des clés, pas des noms ;
· mêler un paramètre technique aux décisions produit. S'il doit rester réglable (§D.7), il vit
  **replié**, **à part**, et **en dessous**.

**Ce qu'elle exige en échange, et c'est la moitié qui compte :** l'information ne s'évapore pas.
La propriété de `/admin/seuils` — **déclarer ce qui ne gouverne rien** — était exemplaire ; elle
**migre** vers [docs/architecture.md](architecture.md) §B.2 ⑨ et vers un contrôle qui la garde.
Retirer un champ sans écrire pourquoi ailleurs, c'est perdre la connaissance au lieu de la ranger.

> **La règle complète les deux précédentes** : §D.7 dit qu'un réglage règle quelque chose **ou le
> dit** ; celle-ci dit **où** il le dit — dans la documentation, jamais dans un champ de saisie.

<a id="d12"></a>

**D.12 — AUCUNE COULEUR LITTÉRALE DANS UN COMPOSANT. Une seule source, réglée par écosystème.**
Une couleur se lit dans un jeton `--sk-*`, jamais écrite en toutes lettres. La source unique est
[lib/palette.ts](../lib/palette.ts) ; les jetons sont posés **au serveur**, en littéral, sur `<html>`
par le layout racine. **Gardé par [`diag-couleurs-litterales`](../scripts/diag-couleurs-litterales.mjs)**,
par [`diag-svg-couleurs`](../scripts/diag-svg-couleurs.mjs) pour le piège §E.48, et par
[`diag-opacite-concatenee`](../scripts/diag-opacite-concatenee.mjs) pour §E.50 — un suffixe d'opacité
ne se colle JAMAIS à une couleur, on écrit `color-mix`.

> ⛔ **LE GEL DU CLIQUET EST VIDE — 21/09/2026.** Parti de **3 180 couleurs dans 125 fichiers**,
> descendu à zéro espace par espace, un commit chacun. **Toute entrée qui y apparaîtra est une dette
> NOUVELLE**, à nommer et à justifier ; elle ne se glisse plus dans un inventaire existant.
> Il **reste en place**, vide : le retirer parce qu'il n'a plus rien à tolérer rouvrirait la porte.
>
> **LES E-MAILS SONT L'EXCEPTION, ET ELLE EST STRUCTURELLE.** Les clients de messagerie ne lisent
> **pas** les propriétés personnalisées : `color: var(--sk-text)` y est ignoré, et le texte tombe sur
> la couleur par défaut du client. Un e-mail ne porte donc que des **littéraux** — mais **résolus**
> depuis `lib/palette.ts` par [lib/emails/couleurs.ts](../lib/emails/couleurs.ts), jamais recopiés.
> Ils portaient encore `#00B9FF`, qui n'est la marque de personne depuis ce lot.
> **Ce qui reste ouvert et se dit** : ce sont les valeurs de la palette **de référence**, pas celles
> de l'écosystème du destinataire — le point d'envoi ne reçoit que le nom de marque.

**Les valeurs sont celles de l'accueil**, mesurées le 21/09/2026
([docs/audit-couleurs.html](audit-couleurs.html)) : c'était la seule surface du produit qui
tenait en quinze couleurs déclarées à un seul endroit, contre 184 teintes et 3180 littéraux ailleurs.

| Ce qui se règle | Ce qui ne se règle pas |
|---|---|
| les **huit rôles** — fond de page, bandeau, cartes, bordures, texte principal, texte secondaire, marque, boutons — par écosystème, dans `/admin/ecosystemes` | le **vert**, l'**ambre** et le **rouge** : ils disent un ÉTAT, pas une marque. Les rendre réglables inviterait à peindre une erreur en vert. |
| | le **texte tenu** et la **bordure douce** : mesurés sur l'accueil, non dérivables, et sans variation d'un écosystème à l'autre. |

**La garde de contraste REFUSE, et elle refuse au serveur.** Sept paires, minimum 4,5. Le refus nomme
la paire, son ratio et le minimum ([`diag-palette-contraste`](../scripts/diag-palette-contraste.mjs)).

> **Et la palette juste ne prouve pas l'écran juste.** Une page peut lire deux bons jetons et les
> poser l'un sur l'autre. [`diag-contraste-par-ecran`](../scripts/diag-contraste-par-ecran.mjs) ouvre
> **chaque bloc `style={{…}}` des 66 pages** de l'espace connecté, en extrait le couple
> *(texte, fond)* réellement écrit et le mesure — **212 couples, 0 sous son minimum**. Il ne devine
> **aucun** fond hérité : les **743** blocs qui peignent un texte sans déclarer leur fond sont
> comptés et **déclarés** (§E.38), jamais estimés (§E.40). Sa sortie `--json` alimente la colonne
> de [docs/audit-couleurs.html](audit-couleurs.html) — **un chiffre d'audit se reçoit du
> contrôle, il ne se saisit pas** (§E.16, §E.24).
**Les bordures en sont exclues, à dessein** : la bordure de référence vaut 1,25, et l'exiger à 3
ferait rougir la palette de l'accueil elle-même dès le premier jour (§E.14).

> ⚠️ **`--sk-faint` (le texte tenu) vaut 3,63 : il ne porte JAMAIS d'information.** Titres de
> groupes, survols, séparateurs — des repères qu'on balaie. Un état vide **dit** quelque chose : il
> prend `--sk-muted`. **Cette règle ne se balaie pas** — aucun motif ne distingue un repère d'un
> texte qu'on lit — elle se lit écran par écran (§E.38).

> **Deux exemptions, nommées avec leur raison** : [lib/portraits-demo.ts](../lib/portraits-demo.ts)
> (couleurs d'ILLUSTRATION : carnations, chevelures, vêtements — la garde de contraste n'a rien à
> dire d'une couleur de cheveux) et `MARQUES_TIERCES` dans `lib/palette.ts` (le logo d'un tiers garde
> SA couleur : la recolorer afficherait un logo LinkedIn qui n'est pas celui de LinkedIn).

<a id="d13"></a>

**D.13 — UN ÉCRAN NE SIMULE JAMAIS UN TRAVAIL. Il l'attend, ou il dit ce qu'il sait déjà.**
Une recherche de missions a **quatre issues nommées**, et aucune autre :
`trouvees` · `aucune` · `ineligible` · `echec` ([lib/matching/issue-de-recherche.ts](../lib/matching/issue-de-recherche.ts)).
L'union est **fermée** : il n'existe aucune branche « on ne sait pas encore » qui pourrait rester
affichée indéfiniment, et l'écran **refuse de compiler** sur une issue non traitée.

**Trois règles, et chacune ferme un défaut mesuré le 21/09/2026** (§E.51) :

① **La réponse connue au clic se dit AU CLIC.** Profil non visible, CV non analysé, consentement
  absent, profil non approuvé : quatre refus lisibles en **une lecture de ligne**. Ils sortent
  immédiatement, avec le bouton pour y remédier — jamais après une roue qui tourne.
② **Ce qui se lance s'attend.** La bascule de disponibilité **exécute** le moteur dans la requête.
  Aucun chronomètre ne décide de la fin d'une recherche : les deux qui le faisaient (75 s et 120 s)
  sont **supprimés**, pas désactivés.
③ **« Aucune mission » ne s'écrit que sur une recherche ACHEVÉE.** Un empêchement, un refus de
  débit, une panne de configuration : chacun dit ce qu'il est. Affirmer un résultat qu'on n'a pas
  est le défaut, pas le retard.

> **Le report garde son rôle — sur le SEUL chemin où la rafale existe.** Mesuré : ses deux appelants
> étaient `/api/profile` (un expert reprend son profil en dix passes) et la bascule de disponibilité
> (**un interrupteur à deux positions ne produit aucune rafale**). Il reste sur le premier, il est
> retiré du second. Et il ne s'applique pas à l'**approbation** : `lib/matching/relance.ts` l'énonce
> depuis le lot 6, le code ne l'appliquait pas, et un expert fraîchement approuvé lisait « aucune
> mission ne correspond ».
> ⚠️ **Sa durée est passée à 10 minutes, et sa raison a changé — §D.15.** Il ne porte plus la
> justesse (la clé du brouillon la donne par construction) ; il ne garde que l'anti-rafale.
> **Le plafond horaire, lui, s'applique partout** — et c'est le MÊME (`consommerPlafondHoraire`),
> pas une copie (§E.20).

**Gardé par [`diag-issue-de-recherche`](../scripts/diag-issue-de-recherche.mjs)** — 10 mutations,
10 détections — et par [`diag-relance-expert`](../scripts/diag-relance-expert.mjs), dont deux sections
ont été **réécrites** parce qu'elles défendaient l'ancienne règle et se contredisaient entre elles.

<a id="d14"></a>

**D.14 — UNE SEULE COQUILLE POUR TOUT L'ESPACE CONNECTÉ. AUCUNE EXCEPTION.**
Les **66 pages** connectées portent le même cadre : `DashboardShell` — barre latérale, en-tête,
bouton Retour. Il est monté par les **sub-layouts**, jamais par une page.

**L'en-tête et la barre latérale sont BEIGES**, tous deux en `--sk-bandeau`. L'en-tête était en
`--sk-surface`, c'est-à-dire le **blanc des cartes** : deux surfaces du même cadre, deux couleurs.
`--sk-surface-2` porte aujourd'hui la même valeur mais ne dit pas la même chose — il nomme un fond
**dans** une carte, pas le cadre.

**Ce que la règle interdit, et qui existait :**
· une **liste d'exclusion** dans un sub-layout — il y en avait deux, dont une justifiée par un
  commentaire **faux** qui laissait une page sans aucune navigation (§E.53) ;
· une page qui **rebâtit** son cadre — trois copies dans un seul fichier ;
· un **second plein écran** (`minHeight: 100vh`) sous un en-tête de 60 px ;
· un **numéro de section** peint en vert, en ambre ou en rouge : ce sont des états (§E.54).

> **L'ADMIN GARDE LE MÊME CADRE ; SEUL LE CONTENU DE SON MENU DIFFÈRE.** Décision de Youssef,
> **appliquée le 21/09/2026** : barre latérale de 248 px en `--sk-bandeau`, barre supérieure — il
> n'en avait **aucune** —, et le même modèle de défilement.
> Sa dette est payée avec : **574 occurrences** de jetons `--color-*` qui n'étaient **définis nulle
> part** et retombaient en silence sur des valeurs en dur. Le back-office ne suivait **aucune palette
> d'écosystème**. Détail et correspondance en **§C.15** ([architecture](architecture.md)).

> **UN JETON QUI NE RÉSOUT NULLE PART NE SE VOIT PAS.** `var(--truc)` non défini prend sa valeur de
> secours, **sans erreur ni style manquant** — famille de §E.48. Le contrôle vérifie donc la
> **définition** de chaque propriété lue, jamais un préfixe de nom (§E.34) : un jeton inventé demain
> est attrapé sans qu'on l'ajoute à une liste. **48 occurrences restent, hors admin, gelées
> nommément** dans six fichiers ; le compte ne peut que descendre.
> Deux exemptions déclarées : les `--font-*` (posées par `next/font` dans une feuille générée au
> build) et celles qu'un composant pose **sur sa propre racine** et relit dans son `<style>`.

**Gardé par [`diag-coquille-unique`](../scripts/diag-coquille-unique.mjs)** — 10 mutations,
10 détections. Il s'ancre sur le **comportement**, pas sur un nom (§E.34) : ce qui est refusé, c'est
un layout qui rend `children` nus, et plus en amont qu'un layout de cadre **consulte le chemin**.

**ET LA PARITÉ EXPERT EST GARDÉE À PART** — [`diag-parite-expert`](../scripts/diag-parite-expert.mjs),
7 mutations, 7 détections. Décision de Youssef : *« l'espace CDI prend EXACTEMENT l'ergonomie de
l'espace freelance — parité intégrale, pas un rapprochement. »* Le contrôle vérifie **14 écrans
jumeaux** : même inventaire, même cadre, mêmes primitives partagées, même traitement du texte tenu,
mêmes clés de comportement.
> ⚠️ **Il ne dit PAS que les deux écrans se ressemblent à l'œil** — deux pages peuvent monter les
> mêmes composants et disposer leurs blocs autrement. Ce qu'il garde, c'est qu'aucune des deux voies
> ne **perde** ce que l'autre a : la forme exacte que prend une dérive de parité (§E.20).

<a id="d15"></a>

**D.15 — UNE NOTE APPARTIENT AUX TEXTES QUI L'ONT PRODUITE. La clé porte le CONTENU.**
Le brouillon de notation (`matching_notes_partielles`) était indexé par `(publication_id,
profile_id)` + le modèle : **trois identités, aucun contenu**. Un profil modifié retrouvait « sa »
note — celle calculée sur le profil d'avant — pendant les **24 h** de vie du brouillon, **sans que
rien ne lève**. Le report de 60 minutes ne fermait pas cette fenêtre : **il la rétrécissait**.

Arbitré par Youssef le 22/09/2026, entre deux sorties **qui n'ont pas la même nature** :

| Sortie | Ce qu'elle vaut |
|---|---|
| **solder** le brouillon en fin de run | une **DISCIPLINE** — elle dépend de la fin du run, et un run qui meurt à mi-chemin laisse des notes périmées : le cas même où le brouillon sert |
| **cléer sur le contenu** | **JUSTE PAR CONSTRUCTION** — profil modifié ⇒ autre empreinte ⇒ autres notes ; profil inchangé ⇒ ses notes. Rien à attendre, aucun ordre à respecter |

**La seconde. Une garde qui est une CLÉ ne dépend d'aucune discipline (§E.31).**
Colonne `empreinte`, `not null` **et sans défaut** : une ligne sans empreinte n'est pas déconseillée,
elle est **impossible**. Calcul dans [lib/matching/empreinte.ts](../lib/matching/empreinte.ts) — module
**pur**, exécuté tel quel par son contrôle (§E.33).

> ⚠️ **L'ORDRE EST CANONIQUE — ANNONCE D'ABORD — ET JAMAIS CELUI DE L'APPEL.** Les deux sens
> interrogent le reranker à l'envers l'un de l'autre. Hacher dans l'ordre de l'appel donnerait **deux
> empreintes pour le même couple de textes** et supprimerait le **partage entre les deux sens**, qui
> est délibéré — une régression de coût décidée par accident, en écrivant un correctif de justesse.
> Ce partage suppose que la note est **symétrique**, ce qu'un reranker ne garantit pas : la
> supposition **préexiste**, elle est conservée à l'identique et **nommée pour être arbitrable**
> (§E.38), pas tranchée au passage.

**Le délai de relance a changé de raison, donc de valeur : 60 → 10 minutes.** Il ne porte plus la
justesse, il ne garde que l'**anti-rafale** — et cette raison-là, **fausse quand elle était écrite**
(la reprise par identité rendait un second run presque gratuit), **est devenue vraie** avec
l'empreinte : dix modifications font dix empreintes neuves, donc dix runs réellement payants.
Les cinquante minutes retirées payaient la justesse, que la clé donne gratuitement, et coûtaient à
l'expert une heure d'invisibilité. **Dix minutes est une PROPOSITION argumentée, pas une mesure** :
rien dans le dépôt ne dit la durée d'une séance d'édition. Elle se change en une ligne ; la justesse,
elle, ne dépend plus de ce nombre.

**Gardé par [`diag-empreinte-des-notes`](../scripts/diag-empreinte-des-notes.mjs)** — 8 mutations,
8 détections. Détail et mesure : **§E.58**.

<a id="d16"></a>

**D.16 — RELIER N'EST PAS ENCAISSER. La synchronisation du catalogue n'exige QU'UNE CLÉ.**
Synchroniser crée chez Stripe un `Product` et un `Price` par offre vendable. **Ça ne fait payer
personne** : aucune session de paiement, aucun droit accordé, aucune carte touchée.

Exiger `ENABLE_BILLING` pour relier créait une **dépendance circulaire de fait** : pour ouvrir
l'encaissement il faut les identifiants de prix, et pour les obtenir il fallait ouvrir
l'encaissement. **C'est ce qui a laissé le catalogue non relié** — et un premier abonnement réel
serait sorti « prix hors catalogue », un paiement encaissé que rien ne sait rattacher à une offre.

| Ce qui exige **une clé valide** | Ce qui exige **EN PLUS `ENABLE_BILLING`** |
|---|---|
| `/api/admin/synchroniser-catalogue` (derrière `requireAdmin`) | le checkout, le portail, le changement d'offre |
| la synchro déclenchée par la **création** et la **modification** d'une offre | l'**APPLICATION** des événements du webhook |

> ⛔ **UNE OFFRE NE SE RELIE JAMAIS À LA MAIN.** Créer une offre payante la relie
> **dans la même action** ; modifier son prix, sa devise, son nom ou sa mise en vente
> aussi. Si Stripe refuse, l'action admin **refuse avec la raison nommée** (`stripe_sync_failed`),
> et la création **supprime l'offre qu'elle venait d'écrire** : une offre n'existe jamais à moitié,
> payante et non reliée.
> **Le bouton « Relier à Stripe » est un RATTRAPAGE**, et l'écran le dit : les offres créées quand
> aucune clé n'était présente, et le passage en production. Plus jamais au quotidien.
>
> **Et l'oubli du passage en live est gardé par la SUPERVISION** : une offre payante non reliée
> **dans le mode de la clé en usage** remonte en **BLOQUANT** (`catalogue_non_relie`), avec son lien
> vers `/admin/facturation`. « Je ne sais pas » (clé absente, lecture en panne) est un problème
> **distinct**, en attention — jamais un « tout va bien » (§E.22).

`resolveCatalogueKey()` et `resolveBillingKey()` — [lib/billing/config.ts](../lib/billing/config.ts) —
et deux fabriques, [`getStripeCatalogue()`](../lib/billing/stripe.ts) / `getStripe()`. **Une seule
implémentation des règles de clé** : la seconde délègue à la première puis ajoute l'interrupteur,
dans cet ordre (`billing_disabled` sort AVANT tout examen de clé, c'est ce motif que l'écran peint
en gris comme un état normal). Les trois contrôles restent entiers, **cohérence clé/environnement
comprise, dans les deux sens**.

> ⚠️ **LA CONSÉQUENCE SUR L'ÉDITION D'UNE OFFRE EST VOULUE ET ELLE COÛTE.** `catalogue-guard`
> conditionnait sa synchro à `ENABLE_BILLING` ; c'est désormais « une clé valide ». Sur un
> environnement qui porte une clé, **modifier un prix pousse vers Stripe, et un échec de Stripe
> REFUSE la modification**. C'est la garantie même du module : sans elle, un catalogue relié
> divergerait dès la première correction de tarif, en silence, et la divergence ne se verrait
> qu'au premier paiement. Sans clé, rien n'est tenté et le back-office reste libre.

<a id="d17"></a>

**D.17 — TEST ET PRODUCTION SONT DEUX CATALOGUES. Le mode est dans la CLÉ.**
Un `price_...` créé avec `sk_test_` **n'existe pas** en mode live. Une seule colonne par période
rendait donc le passage en production **faux en silence**, et rien ne pouvait le voir : une colonne
qui porte un identifiant ne dit pas dans quel mode il a été créé.

Table `packages_stripe`, clé primaire **(package_id, mode)** — migration `catalogue_stripe_par_mode`.
**Et ses trois gardes d'unicité ont dû être reposées** par `index_packages_stripe` : les noms annoncés
par la première étaient déjà pris, `if not exists` a sauté les créations sans rien dire, et le
`drop column` a emporté les anciens — `packages_stripe` est resté **sans aucune garde** (§E.60).
Les trois colonnes `packages.stripe_*` sont **supprimées** : deux sources pour la même chose, dont
une sans mode, est ce qu'on ferme. **La migration REFUSE de tourner** si un identifiant y existait
encore, en nommant les offres — on ne supprime pas une colonne en *croyant* qu'elle est vide.

| Forme | Comment elle se trompe |
|---|---|
| deux jeux de colonnes (`..._test` / `..._live`) | un lecteur qui oublie le suffixe **compile, tourne, et lit l'autre mode**. En silence (§E.1 : la colonne est une chaîne). |
| **une table clée (package_id, mode)** | un lecteur qui oublie le mode obtient **deux lignes** : il doit trancher, donc savoir. **§E.31** — la garde est une clé. |

**D'OÙ VIENT LE MODE, ET CE N'EST PAS LA MÊME ORIGINE PARTOUT** — deux fonctions distinctes alors
qu'elles calculent la même chose, parce que les confondre est la faute :
· une action de **catalogue** agit avec une clé → `modeDeLaCle(handle.live)` ;
· le **webhook** ne choisit pas → `modeDeLEvenement(event.livemode)`. Lire le mode de sa clé
supposerait que l'endpoint et la clé sont accordés — **c'est précisément ce qui casse quand on
croise les deux tableaux de bord Stripe**.
`resolvePackageByPrice` exige donc un `mode`, **sans valeur par défaut** : un défaut rouvrirait la
porte en silence.

> **L'écran des écarts dit ce qui est relié DANS LE MODE COURANT, et ce qui ne l'est pas dans
> l'autre** ([lib/stripe-exploitation/catalogue-relie.ts](../lib/stripe-exploitation/catalogue-relie.ts)).
> Trois états par offre, et jamais deux : `reliee`, `a_relier`, **`rien_a_relier`**.
>
> **CE QUI DÉCIDE EST LE PRIX, JAMAIS LE NOM NI LE STATUT** — une seule implémentation,
> [lib/billing/vendabilite.ts](../lib/billing/vendabilite.ts), module **pur** exécuté par le contrôle.
> Une offre **gratuite n'a rien à relier, que son prix soit `NULL` ou `0`** : un `Price` récurrent
> à 0,00 € n'encaisse rien et apparaîtrait pourtant comme une offre réelle chez Stripe.
> `is_default` **a disparu du critère** et rien n'a changé : la contrainte
> `packages_default_must_be_free` fait que le prix l'écartait déjà — le garder faisait croire que le
> STATUT décide. Aujourd'hui `Free` et `Collaboration` sont donc écartées **parce qu'elles sont
> gratuites**, pas parce qu'elles s'appellent ainsi ; et une offre payante qu'on rendrait gratuite
> demain sortirait de la vente **toute seule**.
>
> ⚠️ **Un tarif ILLISIBLE a sa propre raison.** `Number('abc')` vaut `NaN`, et `NaN > 0` est faux :
> confondu avec zéro, un tarif corrompu sortirait **silencieusement** de la vente. L'écran le
> distingue — c'est une donnée à corriger, pas une offre gratuite.

**Gardé par [`diag-relier-nest-pas-encaisser`](../scripts/diag-relier-nest-pas-encaisser.mjs)** —
14 mutations, 14 détections. Il **découvre** les routes qui écrivent une offre au lieu de les
lister, et n'exige la liaison que de celles qui touchent à ce que Stripe connaît — une route
ajoutée demain est donc couverte sans qu'on l'inscrive nulle part (§E.34). Il **exécute** les clés d'idempotence (§E.33) pour prouver qu'un second
clic ne crée pas de doublon chez Stripe : un doublon ne se verrait pas dans notre base et fausserait
l'écran des écarts.

<a id="d18"></a>

**D.18 — LA GRATUITÉ SE DIT, ELLE NE SE DÉDUIT PAS. Une case, et la base la garde.**
La règle était « prix nul ou zéro ⇒ gratuite ». **Exacte, et implicite** — l'intention n'était écrite
nulle part. Conséquence, et elle se paie en argent : **une offre payante saisie à 0 par erreur
sortait de la vente EN SILENCE.** Aucun refus, aucune alerte : elle cessait d'être reliée, et le
premier client qui voulait y souscrire ne pouvait plus. Dans l'autre sens, rien n'empêchait une offre
déclarée gratuite de porter un prix.

**`packages.is_free` est une INTENTION DÉCLARÉE** — migration `offre_gratuite_explicite`. Une case à
cocher dans `/admin/packages`, à la création **et** à la modification : cochée, les champs de prix
sont désactivés et valent zéro ; décochée, un prix strictement positif est **obligatoire**.

**LA RÈGLE EST EN BASE, DANS LES DEUX SENS** — `packages_gratuite_coherente` :

| | |
|---|---|
| `is_free` | ⇒ prix mensuel **et** annuel nuls |
| `not is_free` | ⇒ **au moins un** prix strictement positif |

Une offre payante à 0 et une offre gratuite avec un prix deviennent **impossibles à écrire**, quel
que soit le chemin — l'écran, une route, un script, une main dans le tableau de bord Supabase.
**Une garde qui est une contrainte ne dépend d'aucune discipline (§E.31).**
`packages_default_must_be_free` **devient un cas de celle-ci** : `is_default ⇒ is_free`. Même
garantie, exprimée une seule fois ; le nom est **conservé**, il est cité ailleurs (§E.16).

> **L'écran et la route ne gardent RIEN de plus — ils EXPLIQUENT.** La contrainte rendrait une erreur
> Postgres, que la route traduirait en 500 « db_error », lequel n'apprend rien. Le contrôle de
> cohérence des routes rend un **400 nommé** (`free_with_price`, `paid_without_price`) ; le retirer ne
> rouvrirait aucun trou, il rendrait le refus incompréhensible.
> ⚠️ **Côté modification, il porte sur l'ÉTAT FINAL, pas sur le corps reçu** : une modification est
> partielle, et cocher « gratuite » sans toucher au prix est un corps valide **et** contradictoire
> avec la ligne en base. On compose l'existant écrasé par le corps, et c'est lui qu'on vérifie.

**`vendabilite.ts` LIT LA CASE, PLUS LE PRIX.** Il ne porte même plus le prix dans son type d'entrée :
la déduction ne peut pas revenir par distraction. Deux critères disparaissent avec elle —
`is_default`, qui n'a jamais rien décidé (la contrainte l'impliquait déjà), et `tarif_illisible`, qui
n'existait que parce qu'on lisait un nombre arrivé en chaîne.

**UNE OFFRE GRATUITE NE PASSE JAMAIS PAR STRIPE — ni synchro, ni paiement.**
La synchronisation la refusait déjà. **Le paiement avait un trou réel, et il est fermé** : une offre
payante **reliée**, puis passée en gratuite, garde sa ligne dans `packages_stripe` ; la liaison
rendait donc un prix, et le checkout s'ouvrait **au prix d'avant** sur une offre déclarée gratuite.
Le refus est désormais **en tête de `resolveSellablePrice`, avant toute lecture de liaison**.

**Gardé par [`diag-relier-nest-pas-encaisser`](../scripts/diag-relier-nest-pas-encaisser.mjs)** —
**18 mutations, 18 détections**. Il exécute la règle (§E.33), vérifie que le module **ne lit aucun
prix**, que le refus d'achat précède la lecture de liaison, et que la contrainte porte **les deux
sens**.

<a id="d19"></a>

**D.19 — UNE CANDIDATURE EXISTE AVEC SA NOTE ET SON RÉSUMÉ, OU ELLE N'EXISTE PAS.**
Arbitré par Youssef le 23/09/2026, et cette décision **REMPLACE** la précédente, qui disait
l'inverse en toutes lettres (« RIEN NE BLOQUE UNE CANDIDATURE », en tête de
`20260907200000_pannes_de_redaction.sql`) : *« une candidature avec sa note et son résumé, ou pas de
candidature. Une candidature nue chez un client, c'est amateur. On ne la livre pas. »*

**L'ORDRE EST LE CORRECTIF, TOUT LE RESTE EN DÉCOULE.** Le jugement est **appelé avant l'écriture**
et **attendu dans la requête** ([lib/candidatures/depot.ts](../lib/candidatures/depot.ts)). Il aboutit →
la candidature est écrite **avec** sa note et son résumé, en une opération. Il échoue → **rien n'est
écrit**.

| Ce qui est refusé | Pourquoi |
|---|---|
| **un filtre à l'affichage** | **17 fichiers** lisent `candidatures` (mesuré le 23/09/2026). Il suffirait d'en oublier un. La garantie est que **l'objet incomplet n'existe pas**, pas qu'on le cache. |
| **un rejeu automatique** | Refusé par Youssef : « ça tournerait en boucle et ça coûterait ». |
| **prévenir l'expert** | « L'expert ne paie pas une panne qui ne le concerne pas, et on ne lui montre pas nos coulisses. » Aucun message d'erreur, aucun bouton « réessayer ». |

**LA BASE REFUSE** — `candidatures_complete_ou_inexistante`, contrainte **validée**, pas
discipline (§E.31). Elle porte une **borne de date** plutôt qu'un `NOT VALID`, et ce n'est pas un
détail : une contrainte `NOT VALID` est **quand même vérifiée sur tout UPDATE**, elle aurait donc
rendu **IMMUABLES** les 4 candidatures de juin 2026 (§E.64).

> ⚠️ **CE QUE ÇA COÛTE, ET C'EST ASSUMÉ.** L'écran affiche « votre candidature a été envoyée » alors
> que rien n'a été écrit — un tampon de succès sur un travail qui n'a pas eu lieu, la forme exacte
> de §E.27. Youssef a nommé cette conséquence lui-même, et c'est **précisément** pourquoi l'écran
> `/admin/depots-en-echec` est **BLOQUANT en supervision tant qu'il n'est pas vide**. Le tampon est
> tenable parce qu'il n'est **jamais silencieux côté plateforme**. Sans cet écran, ce serait un
> défaut ; avec lui, c'est un arbitrage.

**CE QUI N'ABOUTIT PAS SE VOIT, ET SE REJOUE À LA MAIN.** Table `candidature_depots`, une ligne
par couple (annonce, expert), **écrite AVANT l'appel au modèle** — cet appel dure jusqu'à 30 s dans
la requête, et c'est exactement là qu'une fonction se fait tuer (§E.63). L'écran
`/admin/depots-en-echec` montre les échecs **et** les dépôts **interrompus** (état DÉRIVÉ de
l'heure, jamais stocké), filtrables par cause, date et écosystème, avec un bouton **RELANCER** qui
appelle **la même fonction** que le dépôt d'un expert — pas une copie (§E.20).

<a id="d20"></a>

**D.20 — « ÉLIGIBLE » S'ÉCRIT UNE FOIS. LES SUSPENDUS SONT EXCLUS PARTOUT, SANS EXCEPTION.**
Le moteur a deux sens, et chacun jugeait de son côté. **Trois conditions manquaient côté expert** —
compte **suspendu**, en **suppression**, **anonymisé** — et elles n'étaient même pas *chargeables* :
le `select` ne demandait pas les colonnes. Les deux fichiers affirmaient l'inverse en toutes lettres
(§E.7). Atteignable par les **deux chemins sans session** — le cron de relance et l'approbation par
un administrateur : un expert suspendu était noté (dépense réelle) **et notifié**.

**La règle est une LISTE DE DONNÉES, pas une fonction** — [lib/matching/eligibilite.ts](../lib/matching/eligibilite.ts),
module **pur**. Les deux sens n'ont pas la même forme et ne peuvent pas l'avoir : l'un filtre
cinquante mille lignes en SQL, l'autre juge une ligne chargée. Une « fonction partagée » aurait donc
été deux fonctions, c'est-à-dire le jumeau qui vient de diverger (§E.20). Chaque condition porte
donc **les deux formes**, et les deux sens plient la **même** liste.
· le type des raisons est **dérivé** de la liste ; · les **colonnes** du `select` aussi — un test sur
une colonne non chargée lit `undefined` et conclut (§E.1) ; · l'opérateur `neq_ou_null` existe
parce qu'en SQL `colonne <> 'x'` **écarte** un NULL que le test en mémoire **garde**.

**Gardé par [`diag-eligibilite-unique`](../scripts/diag-eligibilite-unique.mjs)** — il **exécute les
deux formes** sur trente lignes et exige le même verdict. Détail : **§C.17**
([architecture](architecture.md)).

<a id="d21"></a>

**D.21 — « OCCUPÉ » FERME AUSSI LE DÉPÔT. Le SERVEUR refuse, pas seulement l'écran.**
*« Je ne reçois rien, je ne vois rien, JE NE POSTULE PAS »* (Youssef, 23/09/2026). Les deux premiers
tiers tenaient ; le troisième non — un match posé **avant** qu'il ne se déclare occupé restait
cliquable, et le serveur acceptait.

**Le dépôt lit la règle ENTIÈRE** (§D.20), pas seulement la disponibilité — parce que §D.19 a rendu
le jugement de Claude **obligatoire** au dépôt : un expert dont le **consentement IA** a été retiré
après la création du match aurait vu son profil partir chez le fournisseur. La garde est posée
**avant toute dépense** et rend une issue **distincte** d'un refus de garde : elle porte sur LUI, et
il peut y remédier.

**L'écran ferme le bouton AVANT le clic, avec sa raison** — pas grisé, **remplacé** (§D.1) — et
l'aptitude vient du **serveur** : la recopier dans l'UI la figerait dans le bundle (§E.15). Parité
CDI **structurelle** : les deux voies montent le même composant.

> ⚠️ **Un TROISIÈME écrivain de la règle a été trouvé en faisant ce point** : `lib/missions/feed.ts`
> posait sa propre expression sous un commentaire disant « UN SEUL endroit lit ces colonnes ».
> Le contrôle de §D.20 ne balayait que `lib/matching/` — il ne pouvait pas le voir (§E.61).
> `DashboardShell` en était un quatrième, pour sa pastille.

**Gardé par [`diag-occupe-ferme-le-depot`](../scripts/diag-occupe-ferme-le-depot.mjs)**.

<a id="d22"></a>

**D.22 — AU PLUS UNE RECHERCHE PAR EXPERT. Le second ATTEND, et rien n'a « échoué ».**
Rien n'empêchait deux recherches simultanées sur le **même** expert : un double clic, ou une bascule
de disponibilité pendant qu'un cron de relance tourne — le même vivier noté deux fois, et **payé**
deux fois. Le mécanisme existait (le bail des tâches de fond ferme exactement ce chevauchement) mais
il était clé sur un **nom de tâche**.

**Le bail devient GÉNÉRIQUE : une portée, une clé** ([lib/bail.ts](../lib/bail.ts), table `baux`).
Deux portées — `cron` et `matching_expert` — et **une seule** implémentation : une seconde aurait
été un **jumeau de verrou**, celui qui ne sert que sous concurrence, donc dont l'écart ne se
découvre jamais (§E.20). Les deux fonctions de cron deviennent des **enveloppes** ; leurs cinq
routes n'ont pas une ligne à changer.

**LE FAUX MESSAGE D'ÉCHEC DISPARAÎT.** Le second clic consommait un jeton du plafond horaire et
répondait « Trop de recherches lancées coup sur coup » — un message d'**échec** pour quelque chose
qui n'a pas échoué. Le chemin direct **attend** désormais que le bail se libère **avant** de
consommer le plafond. Si l'attente expire, l'issue est `trop_long` : *« la recherche se poursuit,
vos missions apparaîtront ici »* — qui est vrai.

> ⚠️ **AUCUN CINQUIÈME ÉTAT D'ÉCRAN.** §D.13 ferme l'union à quatre, et « une recherche est en
> cours » serait exactement la branche « on ne sait pas encore » qu'elle interdit — celle qui peut
> rester affichée indéfiniment.

> ⚠️ **ATTENDRE DEMANDE UN BUDGET, ET SEUL CELUI QUI RÉPOND À UN ÉCRAN EN A UN.** Le moteur prend
> le bail ou **passe son tour** ; l'attente vit chez l'appelant direct, dérivée de son propre budget
> de réponse. Une option « attendre N ms » sur le moteur aurait été un réglage que personne ne
> remplit (§D.11), et deux attentes se seraient disputé le même temps.

**Gardé par [`diag-recherche-doublee`](../scripts/diag-recherche-doublee.mjs)**.

<a id="d23"></a>

**D.23 — CHAQUE TEXTE DANS LA LANGUE DE CELUI QUI LE LIT. Écrit une fois, conservé.**
Le jugement au dépôt produit **deux** textes pour **deux** lecteurs — l'explication pour l'EXPERT,
le résumé pour l'ORGANISATION. Ils recevaient **une** seule langue, et elle valait `'fr'` **en
dur** : un expert allemand lisait son explication en français, une organisation espagnole recevait
un résumé qu'elle ne pouvait pas lire. Le type ne portait qu'un champ `locale` — il n'y avait même
pas de place pour la seconde.

| Texte | Lu par | Sa langue vient de |
|---|---|---|
| `reason` | l'expert | `users.locale` de **son** compte |
| `pitch_org` | l'organisation | son **porte-parole** — le membre admin **actif** le plus **ancien** |

**Une organisation n'a pas de langue : elle a des MEMBRES.** La règle existait déjà — c'est celle de
l'e-mail d'approbation — mais elle vivait dans une requête, au milieu d'une route, sous un
commentaire. Elle est écrite une fois
([lib/organisations/porte-parole.ts](../lib/organisations/porte-parole.ts)), et le module partage le
**critère**, pas la projection : les trois autres lecteurs ont besoin d'un e-mail ou d'un prénom en
plus, et leur imposer une seconde requête pour une langue qu'ils lisent déjà serait absurde. Ils
sont **déclarés** dans le contrôle, et leur nombre ne peut que descendre (§G.8).

**ÉCRIT UNE FOIS, CONSERVÉ.** La langue de chaque texte est stockée **avec lui** — sans quoi rien ne
dirait plus tard dans laquelle il est (§E.24). Rien ne régénère : si l'un change de langue, il relit
le texte d'origine. **Assumé.**

> ⚠️ **LE PROMPT PRÉVIENT QUE LES DEUX LANGUES PEUVENT DIFFÉRER.** Sans cette phrase, un modèle qui
> trouve la consigne étrange **harmonise** — et le défaut revient, en silence.

**Gardé par [`diag-langue-du-jugement`](../scripts/diag-langue-du-jugement.mjs)**.

<a id="d24"></a>

**D.24 — LE COMPTEUR COMPTE CE QU'ON PAIE. L'UNITÉ EST CELLE DU FOURNISSEUR, ET ON LA LIT.**
Le reranker était compté **au DOCUMENT** — `unites: lot.length` × un prix au document — alors que
Cohere facture **à la RECHERCHE**. Mesuré le 23/09/2026 : `rerank_batch_size = 200` et
`usd_par_unite = 0,000002`, soit **0,0004 $** au compteur contre **0,002 $** à la facture.

> ⚠️ **CE N'ÉTAIT PAS UNE ERREUR DE VALEUR, C'ÉTAIT UNE ERREUR D'UNITÉ** — et c'est ce qui la
> rendait insaisissable. Le facteur d'écart **dépend d'un réglage** : environ 10 sur des lots
> pleins, plus de 60 sur des lots d'une quinzaine. Aucune correction de chiffre ne l'aurait fermée ;
> un administrateur qui déplaçait la taille des lots déplaçait le compteur sans le savoir.

**Et les recherches WEB des deux vérificateurs n'étaient comptées NULLE PART.** L'outil natif
`web_search_20250305` se facture à la recherche **en plus** des jetons du même appel ; seuls les
jetons l'étaient.

| Ce qui compte | D'où vient le nombre |
|---|---|
| les **jetons** | `usage.input_tokens` / `output_tokens` |
| les **recherches web** | `usage.server_tool_use.web_search_requests` — **jamais** `max_uses`, qui est un PLAFOND, pas une mesure |
| les **recherches** du reranker | `meta.billed_units.search_units`, rendu par le fournisseur |

**ON LIT, ON N'ESTIME PAS.** Quand le fournisseur ne dit rien, la consommation porte
`source: 'plancher'` et vaut le **minimum structurel** — un appel abouti a été facturé au moins une
unité. Ce n'est pas une estimation, c'est une **borne, et elle est déclarée** : sans cette étiquette,
une valeur lue et une valeur bornée se liraient pareil (§E.24).

**UNE SEULE FABRIQUE POUR LA FORME « JETONS »** — `consommationJetons()`
([lib/ai-consommation.ts](../lib/ai-consommation.ts)). **Sept** sites construisaient l'objet à la main ;
n'en corriger que les deux qui cherchent aurait laissé **cinq jumeaux** (§E.20) — le jour où l'un des
cinq active la recherche, sa dépense redevient muette, **en silence**, et un appel qui cherche a
exactement la même tête qu'un appel qui ne cherche pas. Elle lit l'`usage` de façon **structurelle** :
typer `server_tool_use` lierait le compteur à une version du SDK, et un `?? 0` sur un champ absent
compile très bien tout en ne comptant jamais rien (§E.1).

**UN COÛT PARTIEL EST UN COÛT FAUX.** Un appel qui a cherché sans que la grille porte un prix de
recherche rend **`null`**, pas le prix de ses seuls jetons : l'appelant a déjà le chemin « tarif
inconnu », et un montant incomplet se lirait comme complet.

**TROIS FORMES EN BASE, ET LA CONTRAINTE LES TIENT** — `ai_model_tarifs_forme_check`, migration
`tarif_par_recherche` : jetons · par document (historique, conservée pour que les lignes déjà
écrites restent recalculables) · par recherche. Une et une seule, jamais deux, jamais aucune.
`usd_par_recherche_web` **n'est pas une forme mais un SUPPLÉMENT** : seule la forme jetons peut le
porter — ailleurs, ce serait un prix que rien ne peut consommer, c'est-à-dire un réglage mort qui a
l'air vivant parce qu'il est chiffré (§D.11).
La contrainte est posée **VALIDÉE** (les données sont corrigées avant), et sa postcondition
l'**ÉPROUVE** par **quatre sondes** en sous-transaction — dont une qui vérifie que la troisième forme
est **acceptée** : sans elle, une contrainte qui refuse tout passerait les trois sondes de refus
(§E.34). Lire `pg_constraint` n'aurait prouvé qu'un nom pris.

> **Les deux prix sont des RELEVÉS DE GRILLE, pas des mesures de facture** — 0,002 $ la recherche
> (Cohere, relevé par Youssef le 23/09/2026) et 0,01 $ la recherche web (Anthropic). Ils vivent en
> base et se corrigent depuis `/admin/tarifs-ia`, sans déploiement (§D.7). Ce qui est **mesuré**,
> c'est l'unité ; ce qui est **saisi**, c'est le prix.

**Gardé par [`diag-compteur-ce-quon-paie`](../scripts/diag-compteur-ce-quon-paie.mjs)** — il **découvre**
les points de dépense au lieu de les lister (§E.61) et **exécute** le module pur (§E.33).
⚠️ Il ne repose **pas** la question « la dépense est-elle enregistrée et le plafond consulté » :
c'est celle de [`diag-depense-ia`](../scripts/diag-depense-ia.mjs), et deux gardes sur la même panne
n'en font qu'une (§E.36). Un appel peut être **parfaitement enregistré et parfaitement faux** — le
reranker l'était, et l'autre contrôle le voyait vert.

<a id="d25"></a>

**D.25 — UN PLAFOND PAR COMPTE. LE GLOBAL DEVIENT LE DERNIER GARDE-FOU.**
Il n'existait qu'UN plafond : le global, par fournisseur. Une seule organisation pouvait donc
consommer le budget de tout l'écosystème, et ce qui s'arrêtait alors s'arrêtait **pour tout le
monde**. Les seuils par acteur existaient — mais ils **ALERTENT**, ils n'ont jamais arrêté une
dépense (§D.9).

> ⚠️ **CE QU'UN PLAFOND DE COMPTE ARRÊTE, ET C'EST LA MOITIÉ QUI COMPTE.** Il arrête ce que la
> **PLATEFORME** dépense d'elle-même pour ce compte. Il n'arrête **RIEN** de ce que la personne
> vient de demander. Décision de Youssef : *« une organisation au plafond PUBLIE QUAND MÊME — elle
> a payé — mais le classement ne part pas. Un expert au plafond garde son compte utilisable. »*

| | Ce qui s'arrête | Ce qui continue |
|---|---|---|
| **organisation au plafond** | le **classement** de ses annonces | elle publie, elle demande ses pitchs, ses annonces passent la garde de qualité |
| **expert au plafond** | ses **recherches automatiques** | il postule, son CV s'analyse, sa vérification aboutit |
| **plafond GLOBAL** | **TOUT** — c'est le dernier garde-fou, et il parle d'un budget qui n'existe plus | — |

**LA CLASSE D'UNE ACTION EST UNE DONNÉE, PAS DEUX `if` BIEN PLACÉS** —
[lib/ai-plafonds.ts](../lib/ai-plafonds.ts), `CLASSE_DES_ACTIONS`. `automatique` : la plateforme la
déclenche seule, en boucle, sans que personne ne l'attende sur un écran — c'est là que part l'argent
d'un compte qui dérape. `deliberee` : quelqu'un vient de faire un geste et attend son résultat ; la
bloquer ne protège pas l'argent, elle **casse le geste**, et de façon invisible.
**L'exhaustivité tient par le TYPE** (`satisfies Record<ActionIA, ClasseAction>`) : une huitième
action sans classe **ne compile pas**. Sans ça, elle tomberait par distraction du côté qui ne bloque
jamais — un plafond qu'on ajoute et qui ne plafonne rien.

> ⚠️ **ET `candidature_assessment` EST DÉLIBÉRÉE PARCE QUE §D.19 L'EXIGE.** « Une candidature avec
> sa note et son résumé, ou pas de candidature » : bloquer le jugement, c'est empêcher l'expert de
> postuler, et un compte qui ne peut plus postuler n'est pas « utilisable ». L'abus par répétition
> est fermé ailleurs, et par le bon outil — le plafond horaire de relance (§D.7).

**L'ORDRE EST LE PLUS SPÉCIFIQUE D'ABORD** : le plafond de l'acteur, puis le global. Inversé, un
compte qui dérape serait arrêté par un motif qui dit « la plateforme est à court » — et on
chercherait ailleurs. **L'acteur et l'action sont OBLIGATOIRES** dans `budgetDisponible`, sans
défaut : c'est le compilateur qui a nommé les **sept** points de dépense, un à un. Et chacun
interroge le plafond **de l'acteur qu'il impute** (§E.39) — une garde qui teste X pendant que la
dépense est imputée à Y protège le mauvais compte, et **les deux appels réussissent**.

**L'ALERTE RESTE SOUS LE PLAFOND, ET LA BASE LE TIENT** — `ai_spend_alerte_sous_plafond`. Au-dessus,
elle ne se déclencherait **jamais** : le plafond arrête la dépense avant qu'elle n'y arrive. Ce serait
un réglage qu'on peut saisir, qui s'affiche, et qui ne peut rien produire (§D.11). La route rend un
**400 nommé** plutôt qu'un 500 de contrainte, et elle juge l'**ÉTAT FINAL** — un corps qui ne change
que l'alerte est valide en lui-même et peut contredire le plafond déjà en base (même forme que §D.18).

**LA FENÊTRE MENSUELLE DEVIENT UN MÉCANISME.** Trois fonctions recopiaient
`date_trunc('month', now() at time zone 'utc')` sous un commentaire disant « AU CARACTÈRE PRÈS ».
C'est une **discipline** : le jour où l'une dérive, les totaux se décalent de quelques heures en fin
de mois et **la somme cesse de boucler** — l'écran cesse d'être croyable sans afficher la moindre
erreur. `ai_spend_debut_du_mois()` est désormais la source unique, lue par les **quatre** fonctions
(§E.31).

**CE QUI REMONTE, ET À QUEL NIVEAU.** Un compte au plafond remonte en **ATTENTION**, avec le lien
vers `/admin/consommation`. C'est un arbitrage : un compte au plafond est le fonctionnement
**normal** d'une règle qu'on a posée ; en faire un bloquant le ferait sonner chaque fin de mois, et
un signal bloquant qu'on voit tous les mois **apprend à être ignoré** (§E.52), y compris les fois où
il compte. Le décompte porte sur **TOUS** les acteurs, jamais sur la liste des dix plus gros : un
chiffre juste tant qu'il y en a moins de dix est faux le jour où le signal sert (§E.24).

**ET L'ÉCRAN EXISTE, PARCE QU'UN PLAFOND QU'ON NE VOIT PAS SE RELÈVE AU JUGÉ.**
`/admin/consommation` — ce que chaque compte a coûté, son plafond, son état, **et sur quoi**. La
supervision dit **combien** de comptes sont arrêtés ; cet écran dit **lesquels**, à combien, et sur
quoi. Les deux
états viennent de la **base** : les recalculer dans le navigateur ferait une seconde règle sur une
seconde fenêtre mensuelle (§E.15, §E.20). Ce qui n'est pas détaillé est **dit** — le reste agrégé et
compté, le non-imputable — parce que cacher la troisième famille donnerait un total plus propre et
faux.

> ⚠️ **LA VENTILATION PAR ACTION N'EST PAS UN ORNEMENT, C'EST CE QUI PERMET DE DÉCIDER.** Un compte
> à 24 $ sur un plafond de 25 $ appelle une décision, et on ne la prend pas sans savoir si ces 24 $
> sont cent classements légitimes ou une boucle d'analyses de CV. La donnée existait depuis le
> premier jour — `ai_spend_events` porte l'acteur **et** l'action sur chaque ligne ; il manquait la
> lecture qui les croise. `ai_spend_par_acteur_et_action` retient **les mêmes comptes** que la liste
> (même classement **total**, même fenêtre), et sa postcondition **EXÉCUTE les deux** pour vérifier
> que leurs totaux bouclent et qu'aucun compte n'est d'un côté sans être de l'autre.
> Le détail est **replié par défaut** : cinquante comptes × sept actions font 350 lignes, et un
> écran qui montre tout ce qui existe cesse d'être lu (§E.26).

> **Les deux valeurs — 25 $ par organisation, 5 $ par expert — sont des PROPOSITIONS**, à réviser sur
> un mois de données réelles, comme les alertes le disent déjà d'elles-mêmes. Elles vivent en base et
> se règlent dans `/admin/matching` (§D.7). L'écart avec l'alerte (10 $ / 2 $) est délibéré : **on
> regarde avant de bloquer**.

**Gardé par [`diag-plafond-par-acteur`](../scripts/diag-plafond-par-acteur.mjs)** — il **exécute** la
règle (§E.33), **découvre** les appelants au lieu de les lister, et vérifie que la garde et la
dépense portent le **même acteur**. Il ne repose pas la question « la dépense est-elle enregistrée
et le plafond global consulté » : c'est `diag-depense-ia` (§E.36).

> ⚠️ **ET IL GARDE AUSSI L'ÉCRAN DE §D.19, QUI N'AVAIT AUCUNE ASSERTION.** `/admin/depots-en-echec`
> avait été livré et vérifié **existant** ; son **bouton RELANCER** et ses **trois filtres** ne
> l'étaient pas. « L'écran existe » et « l'écran fait ce qu'on attendait » sont deux affirmations
> différentes, et **seule la seconde se garde**. Le contrôle exige désormais que le rejeu appelle
> **la même fonction** que le dépôt d'un expert (découverte, pas listée), qu'il ne rebâtisse **rien**
> du dépôt, et que chacun des trois filtres soit **envoyé par l'écran ET honoré par le serveur** —
> un filtre que le serveur ignore rend une liste qui **a l'air** filtrée, ce qui est pire qu'aucun
> filtre : on croit avoir regardé.

<a id="d26"></a>

**D.26 — LE GRAND LIVRE : TOUTE ACTION MÉTIER LAISSE UNE ÉCRITURE, AVEC SA PIÈCE. Le socle (étape 1, 24/09/2026).**
Le modèle est le grand livre de D365 F&O : chaque écriture porte sa **pièce** — le numéro qui relie
toutes les écritures d'un même geste — et on remonte la chaîne depuis n'importe quel bout. Le grand
livre porte la **synthèse** ; les sous-journaux (`audit_logs`, `ai_spend_events`, `stripe_events`,
`cron_run_log`, `notifications`) gardent le **détail** et recevront une colonne `piece` (étape 3).
On ne recopie rien : on relie. **Les lectures sont hors périmètre** : consulter une annonce n'est pas
une transaction, le journal enregistre ce qui change un état.

**La ligne** — `grand_livre` : horodatage · pièce · pièce d'origine (contrepassation, rejeu) · type
d'action (**liste fermée en base**, `grand_livre_actions`, clé étrangère) · acteur par identifiant +
type (`users.user_type`), **jamais par nom** · écosystème · sujet (type + identifiant) · statut
(reussi / echoue / refuse) · détail jsonb **sans donnée personnelle** · origine (utilisateur /
tache_planifiee / administrateur / systeme) · coût + unité facturée (§D.24). Neuf contraintes tiennent
la cohérence (acteur ⇔ type, geste humain ⇒ acteur, sujet ⇔ type, coût ⇔ unité).

**La liste fermée, et pourquoi elle est double.** La liste qui **décide** est en base — un type inconnu
ne s'écrit pas (GL003). `lib/journal/actions.ts` la reflète pour le **compilateur** (une faute de frappe
est une erreur de compilation), et `diag-grand-livre` compare les deux **dans les deux sens** : un code
ajouté d'un seul côté rougit. Cinquante-cinq actions : la liste de départ, les onze manquantes de la
revue, les **cinq refus nommés explicitement** (`refus_plafond_atteint`, `refus_expert_inapte`,
`refus_garde_eligibilite`, `refus_quota_cv`, `refus_depot_sans_jugement` — un refus n'insère rien, il
faut le nommer pour qu'il existe, et son statut est **imposé** par la base), les **trois purges
séparées**, et `journal_nettoye` dans sa propre famille, visible même quand on filtre l'administration.

**La garantie : une fonction unique, jamais un trigger d'écriture.** Le client Supabase n'ouvre aucune
transaction multi-requêtes ; chaque appel PostgREST **est** une transaction et `set local` meurt avec
elle. Un trigger sur une table métier ne peut donc pas connaître la pièce du geste — elle vit dans une
autre requête. À l'intérieur d'une RPC, en revanche, tout tient : **`journaliser()`** (SECURITY DEFINER)
est la seule fonction qui insère — elle **exige** la pièce et le type (GL002), refuse un type hors
liste et un statut contraire à celui que le type impose (GL003), et passe le détail par
`audit_logs_detail_sans_pii()` — la même liste que le journal d'audit, jamais recopiée. Une action qui
**écrit** une ligne métier passe par une **RPC métier + journal en un appel** : `regler_durees_place()`
met à jour `duree_reglages` et journalise dans la même transaction — l'un sans l'autre est
impossible. Détail de la chaîne et de ses raisons : **§C.20**.

**Le verrou : revoke ET trigger.** Les privilèges par défaut sont **repris** à tous les rôles applicatifs
(`service_role` ne garde que la lecture, pour l'écran) ; un UPDATE ou un DELETE lève **SQLSTATE GL001**,
un TRUNCATE aussi. Le **seul** chemin de suppression sera le nettoyage de l'étape 4 : sa RPC posera
`set local grand_livre.nettoyage = 'autorise'` — un réglage qui meurt avec sa transaction — et c'est
de l'intérieur de cette RPC, et de nulle part ailleurs, que le DELETE est reconnu. Jamais l'UPDATE.
Une erreur ne se corrige pas, elle se **contrepasse** par une nouvelle ligne qui référence la pièce
d'origine ; un rejeu porte une **nouvelle** pièce qui référence l'originale. Modèle :
`transactions_block_delete`.

**La pièce, générable des deux côtés, transmise explicitement.** Code : `nouvellePiece()`
([lib/journal/piece.ts](../lib/journal/piece.ts)), type **marqué**, une par geste, créée **à l'entrée
de la route avant toute écriture**, transmise en **paramètre obligatoire** — jamais un contexte ambiant
(`AsyncLocalStorage` est interdit dans `lib/journal/`) : c'est ce qui la fait traverser `after()`
sans rien perdre, comme n'importe quelle valeur capturée par la fermeture (§E.5). SQL :
`gen_random_uuid()` — `effacer_adresses_ip()` génère la sienne et journalise **succès et échec**,
chacun dans son bloc ; les tâches qui appellent une route la transmettront dans le corps HTTP
(étape 3). Le dériveur d'identifiant existe en SQL (`identifiant_derive()`) comme en TypeScript, et
la postcondition **prouve** leur égalité sur un témoin que le contrôle recalcule.

**Le partitionnement attend, et il ne changera pas le modèle.** 127 lignes d'audit en cinq mois. La
**date est en tête** de chaque index de filtre dès aujourd'hui — un partitionnement par mois gardera
les index locaux et élaguera par période sans toucher aux colonnes, à `journaliser()` ni à l'écran.
Deux index n'ont pas la date en tête et c'est dit : la pièce et le sujet se cherchent sans période.

**Ce qui est branché, ce qui ne l'est pas.** Deux actions réelles passent par le socle :
`reglage_modifie` (l'écran `/admin/durees`, par la route) et `ip_effacees` (la tâche SQL). Le
branchement des autres actions, la colonne `piece` des sous-journaux, l'écran et le batch de
nettoyage sont les étapes 2 à 4 — **§H.3**. `audit_logs` reste, comme premier sous-journal, FK
intacte.

> **LA RÈGLE : toute action nouvelle s'ajoute à la liste fermée — le seed SQL ET
> `lib/journal/actions.ts` — et passe par `journaliser()` ou par une RPC métier qui l'appelle.
> Sinon [`diag-grand-livre`](../scripts/diag-grand-livre.mjs) rougit.** Il garde la liste dans les
> deux sens, l'unique `insert` du dépôt, l'absence d'écriture directe et d'appel RPC hors de la porte,
> la pièce obligatoire et jamais inventée, les deux actions réelles, le témoin du dériveur, et une
> postcondition qui **tente** un UPDATE et un DELETE et exige qu'ils lèvent. Éprouvé par mutation le
> 24/09/2026 : **18 mutations, 18 détections**.

---

## F. La classe de défaut « lire puis écrire »

> **DETTE NOMMÉE, NON OUVERTE — `extendValidity` (20/09/2026).**
> `applyPackageState` écrit en **un seul statement**, garde comprise : sa condition
> d'antériorité (`package_source_event_at`) vit dans le `WHERE`, donc deux livraisons
> concurrentes sont arbitrées par la base. **`extendValidity`, lui, LIT puis ÉCRIT** : il relit
> `package_valid_until` et `package_source_event_at`, compare en mémoire, puis écrit. C'est la
> classe que cette section recense.
>
> **Ce qui le tient aujourd'hui est le verrou de réclamation** : `stripe_event_claim` sérialise les
> livraisons du même événement, et deux événements **différents** portent des horodatages
> différents. La fenêtre est donc étroite — mais **elle n'est pas fermée par le schéma**, et c'est
> la différence avec son voisin.
>
> **Relevée en instruisant le bouton de reprise de `/admin/facturation`** (§E.46), et **laissée
> ouverte sur décision de l'architecte** : la fermer suppose de descendre la comparaison dans le
> `WHERE`, comme `applyPackageState` — un lot à lui seul. Elle est écrite ici pour ne pas être
> redécouverte.

**Le motif.** L'applicatif lit une ligne, décide, puis écrit. Entre les deux, une autre exécution passe.
Le client Supabase JS **ne sait pas ouvrir de transaction multi-requêtes** : la fenêtre ne peut pas être
fermée côté code. Rien ne lève, rien ne casse — une des deux écritures est simplement **perdue**, ou
l'objet est créé **deux fois**.

**Où la garantie vit désormais : en base, en une seule instruction.**

| Défaut | Garantie, et où elle vit |
|---|---|
| Deux modifications de profil simultanées : une relance perdue | `programmer_relance_expert()` / `solder_relance_expert()` — un seul `UPDATE … RETURNING`, `SECURITY DEFINER`, `service_role` seul. `solder` **ne solde que ce qui était dû** (`due_at <= debut_run`) : un déclenchement arrivé pendant le run n'est pas effacé. |
| Transfert de l'offre par défaut en deux `UPDATE` : fenêtre où une cible n'a **aucune** offre par défaut, et une inscription tombant dedans ne reçoit rien | RPC `set_default_package()` — tout dans une seule transaction serveur. Étendue à la cible `collaboration` par `collaboration_default_coverage`. |
| Deux livraisons du même événement Stripe : double crédit | `stripe_event_claim()` — `INSERT … ON CONFLICT DO UPDATE … WHERE status = 'failed'`, clé primaire = identifiant Stripe. Le verrou de ligne PostgreSQL sérialise. « Aucune lecture-puis-écriture ici : elle aurait précisément le trou qu'on ferme. » |
| Deux synchros catalogue quasi simultanées : **deux** produits Stripe (le rattrapage par `products.search` ne voit pas le produit créé quelques secondes plus tôt — index différé ~1 min) | Clé d'idempotence **dérivée et stable** ([lib/billing/idempotence.ts](../lib/billing/idempotence.ts)). Un UUID aléatoire ou un horodatage redonnerait deux créations : aucune protection. |
| Consommation d'un quota | `usage_increment()` — un seul `INSERT … ON CONFLICT DO UPDATE` sous garde de limite. |
| Limitation de débit | `rate_limit_check()` — vérifie **et** enregistre atomiquement. Contrat : un refus **n'enregistre pas** le hit. |
| Course à la création d'une organisation personnelle | Index unique partiel `organizations_personal_owner_unique_idx` ; `23505` ⇒ on relit et on retourne l'existante. |
| Deux offres pour un même `price` Stripe : le webhook tirerait au sort des droits payés | Index unique `uq_packages_stripe_prix_mensuel_par_mode`, sur `(mode, price_id_monthly)` — migration `index_packages_stripe`. ⚠️ **Cette garde a été ABSENTE du 22/09/2026 au correctif** : l'index annoncé par `catalogue_stripe_par_mode` portait un nom déjà pris, `if not exists` a sauté sa création sans rien dire, et le `drop column` a emporté l'ancien (§E.60). Le nom cité ici jusque-là — `idx_packages_stripe_price_monthly` — **ne désigne plus rien**. |
| **Une place incluse donnée DEUX fois** : deux jugements terminés au même instant lisent 0, concluent tous deux `0 < 1`, et dévoilent tous deux | migration `place_incluse_unique` |
| **Une annonce active de plus que l'offre** : deux publications simultanées lisent le même compte et passent toutes deux | migration `place_annonce_active` |
| **Une organisation à ZÉRO administrateur** : deux admins qui se rétrogradent au même instant lisent tous deux « il en reste 2 » | migration `siege_administrateur` — trigger `organizations_cliquet_siege_admin` + RPC `maj_membre_organisation` |
| **La PLATEFORME à zéro administrateur** : deux admins qui programment leur suppression au même instant | migration `siege_admin_plateforme` — table `plateforme`, `cliquet_siege_admin()` |
| **Une organisation née sans aucun membre** : `register-org` insère l'org, PUIS le membre — un échec entre les deux laisse une coquille | migration `organisation_jamais_sans_membre` |
| **Deux runs du même cron qui se chevauchent** : `expert_relance_trigger` tourne toutes les 5 min pour un run de 300 s max — le chevauchement est **structurel**, et deux runs simultanés reçoivent **le même profil** et repaient le même travail d'IA | migration `bail_de_run_cron` — `cron_run_leases`, RPC `prendre_bail_run` / `rendre_bail_run`, [lib/cron/bail-de-run.ts](../lib/cron/bail-de-run.ts) |

> ⚠️ **CES SIX LIGNES MANQUAIENT.** Elles sont toutes de la classe que cette section recense, et
> toutes postérieures à sa rédaction. Une section qui liste les garanties de concurrence et en
> oublie six ne se lit pas comme incomplète : elle se lit comme exhaustive. **Le bail de run et le
> siège plateforme n'apparaissaient nulle part dans ce fichier** — deux mécanismes entiers,
> invisibles.

**Ce qui reste ouvert sur cette classe.**
- La clé d'idempotence Stripe ne vit que **24 h**. Elle ferme la **course** (quelques secondes), pas la
  récupération d'un produit orphelin découvert des jours plus tard — c'est pour ce seul cas que
  `products.search` reste sur le chemin.
- Un événement Stripe **bloqué en `received`** (crash ou timeout avant marquage) refuse tous les
  réessais. **Délibéré** : mieux vaut un événement non appliqué et visible qu'un double crédit. Il se
  repère par `idx_stripe_events_status` et se rejoue en repassant la ligne à `failed`. Rien n'automatise
  ce repérage aujourd'hui.
- [lib/collaboration/ensure-personal-org.ts](../lib/collaboration/ensure-personal-org.ts) reste
  **transactionnel par compensation** (échec en aval ⇒ suppression de l'org, CASCADE), pas par
  transaction serveur.
- ~~La branche `feat/s1-ux-profil` porte une migration `verrou_run_et_unicite_notifications` qui
  n'est pas sur le tronc~~ — **elle y est** :
  `supabase/migrations/20260912200000_verrou_run_et_unicite_notifications.sql`. Cette ligne était
  périmée ; elle envoyait chercher un travail déjà fait.

---

## H. Ce qui reste ouvert

**H.0 — UN PROFIL PUBLIÉ NE PEUT PLUS ÊTRE DÉPUBLIÉ. SUJET À PART, NON TRANCHÉ.**
Signalé pendant l'audit du moteur, **hors des douze défauts**, et **Youssef ne l'a pas arbitré** — il
a demandé qu'il soit **noté ici et pas corrigé**. Un état qu'on ne peut plus quitter est un problème
en soi ; et le RGPD s'en mêle, parce qu'un expert qui veut cesser d'être visible n'a pas d'autre
porte que la suppression de son compte. **Ne pas le refermer par un correctif de passage** : il
demande de décider ce que deviennent les matches, les candidatures en cours et les conversations
ouvertes d'un profil qu'on retire.

**H.1 — UNE PLACE INCLUSE PEUT RESTER VIDE POUR TOUJOURS. Défaut PRÉEXISTANT, déclaré.**
Le dévoilement inclus **diffère** quand un autre dépôt de la même annonce est encore en cours : le
dernier à finir voit tout le monde et tranche. Si ce dernier est **tué** en plein appel au modèle,
personne ne reprend la décision — la place reste vide, et rien ne le dit.
**Ce n'est pas né avec §D.19** : la version d'avant différait sur « une candidature non encore
notée » et avait exactement le même trou. Le refermer demande un balayage périodique des annonces à
place libre, donc une tâche planifiée — un lot à lui seul, et un arbitrage de coût. **Mesure requise
avant** : combien d'annonces ont aujourd'hui une place incluse non attribuée.

Uniquement ce qui est établi depuis le code ou depuis un TODO réel.

**Palette**
- **LES E-MAILS PORTENT LA PALETTE DE RÉFÉRENCE, PAS CELLE DE L'ÉCOSYSTÈME DU DESTINATAIRE.**
  Arbitré par Youssef le 21/09/2026 : **tant qu'il n'existe qu'un écosystème, c'est identique**, et
  le lot ne s'ouvre qu'avec le **second**.
  Ce qu'il faudra faire ce jour-là : faire descendre la palette jusqu'au point d'envoi. Aujourd'hui
  `renderEmailHtml` reçoit `brandName` — le nom de marque, déjà dynamique (§D3) — et rien d'autre ;
  [lib/emails/couleurs.ts](../lib/emails/couleurs.ts) résout des constantes depuis
  `PALETTE_REFERENCE`. Il faudra lui passer la palette résolue de `domain_configs`, comme le layout
  racine le fait déjà pour les écrans (§C.13).
  ⚠️ **Les valeurs resteront LITTÉRALES quoi qu'il arrive** : aucun client de messagerie ne lit une
  propriété personnalisée (§C.16). Ce qui change est leur **origine**, pas leur forme.

**Commerce / Stripe**
- ⛔ **`packages.stripe_price_id_monthly` est NULL SUR LES QUATRE OFFRES — MESURÉ PAR S1 SUR LA
  BASE RÉELLE, le 20/09/2026.** C’est **la première action avant d’ouvrir l’encaissement**, avant
  même `ENABLE_BILLING` : sans ce raccordement, **le premier abonnement réel sortirait « hors
  catalogue »** — un paiement encaissé que rien dans le produit ne sait rattacher à une offre.
  La synchronisation sortante **existe**, dans `/admin/packages` ; elle **n’a jamais tourné sur
  cette base**. Ce n’est donc pas du code à écrire : c’est une action à exécuter, et à vérifier.
  ⚠️ Mesure faite par une **lecture humaine sur la base**, à cette date : aucun contrôle du dépôt
  ne peut la refaire seul (§E.12), et elle vaut **à sa date**.
  > **→ CE QUI BLOQUAIT EST LEVÉ — 22/09/2026 (§D.16, §D.17).** Deux choses manquaient, et la
  > première explique pourquoi l’action « existante » n’avait jamais pu être exécutée :
  > ① **relier exigeait `ENABLE_BILLING`**, c’est-à-dire le verrou qu’on ne peut ouvrir qu’une fois
  > le catalogue relié — une dépendance circulaire. La synchronisation a désormais **son propre
  > verrou** (une clé valide, `requireAdmin`) et **son propre bouton**,
  > [/api/admin/synchroniser-catalogue](../app/api/admin/synchroniser-catalogue/route.ts) ;
  > ② **rien ne portait le MODE.** Les identifiants vivent maintenant dans `packages_stripe`, clés
  > (package_id, mode) ; les trois colonnes `packages.stripe_*` sont **supprimées**.
  > **Reste à faire, et c’est un geste d’exploitation, pas du code** : cliquer, en test puis en
  > live. Vérification dans `/admin/facturation` → écarts, qui nomme le mode.
  > ⚠️ **Deux des quatre offres seulement sont reliables** : `Free` et `Collaboration` sont les
  > offres **par défaut**, donc gratuites par contrainte de base — elles n’ont rien à relier, et
  > l’écran le dit (`rien_a_relier`) plutôt que de les compter comme manquantes.
- `ENABLE_BILLING` n'est pas posé : le mur est fermé, rien n'encaisse (§D.1). La date d'ouverture n'est
  pas fixée. La marche à suivre pour le premier paiement est écrite dans
  [docs/stripe-premier-paiement.md](stripe-premier-paiement.md).
- Aucun repérage automatique d'un `stripe_events` bloqué en `received` (§F).

**Vérification par SMS (OTP d'inscription)**
- **La Tunisie (+216) est bloquée par Vonage sur l'API Verify, et ce point N'EST PAS DANS LE CODE.**
  Vérifié : ce n'est ni Fraud Defender Countries (activé sur les deux canaux), ni une Traffic Rule —
  c'est une **liste de pays restreints propre à Verify**, qui exige un **ticket au support Vonage**.
  Les journaux Verify affichaient `BLOCKED`, deux fois, sur Orange Tunisie.
  **Ne cherchez pas la cause dans le dépôt : elle n'y est pas.** Ce qui a été fait, c'est rendre
  l'échec **visible** (§E.13). Le déblocage appartient à Youssef.
- **Le webhook de statut Vonage est un CHOIX DIFFÉRÉ, pas un oubli.** Sans lui, le serveur ne peut
  pas savoir si un SMS a été **remis** : il ne connaît que l'acceptation de la demande. Cesser
  d'affirmer qu'il est parti et donner une sortie apporte l'essentiel du bénéfice pour une fraction
  du travail — un webhook est une **adresse publique à exposer, à sécuriser et à déclarer chez
  Vonage**. Il viendra si des échecs invisibles sont constatés en production.

**Moteur**
- **L'AUDIT DU MOTEUR DU 22/09/2026 EST RENDU, ET RIEN N'Y EST CORRIGÉ** —
  [docs/audit-moteur.html](audit-moteur.html), lecture seule, commit `46971b3`, base de staging lue
  le jour même. **Douze défauts**, dont un **bloquant** : `GET /api/me/missions/[id]` sélectionnait
  `matches.score`, colonne supprimée par `…_score_de_pertinence` — la base répondait
  `column matches.score does not exist`, aucune mission ne s'ouvrait, donc **personne ne pouvait
  postuler** (le dépôt part de la seule vue qui charge cette route).
  > ✅ **D1 EST FERMÉ — 22/09/2026, et pas seulement le cas.** La liste des colonnes mortes se
  > **dérive désormais des migrations** au lieu d'être tenue à la main : le balayage a trouvé
  > **quinze** lectures mortes dans huit fichiers — **seize** avec celle que le troisième filet
  > a trouvée ensuite —, dont **deux autres défauts de produit** : la
  > remise à zéro du CV, impossible depuis le 1ᵉʳ septembre, et le digest e-mail des mises en
  > relation. Les quinze sont fermées. Mécanisme et mesure : **§E.61**. Deux écarts à l'architecture figée : les
  deux sens notaient des **annonces expirées** (aucun lecteur du filtre d'expiration dans
  `lib/matching/`, ni dans `next_unfinished_matching_run`), et une **relance dont le run échoue est
  soldée quand même** (`cron/expert-relance:101-102`, `me/sync-matching:211-215`).
  > ✅ **D2 EST FERMÉ — 23/09/2026.** Le filtre entre dans **les deux sens** et dans la **reprise**,
  > et il ne se recopie pas : une seule expression par langage, la durée lue dans `duree_reglages`,
  > et un contrôle qui rougit sur toute dérivation locale. Le balayage a trouvé **cinq** expressions
  > SQL de la règle au lieu des trois annoncées, **deux avec la durée en dur** — dont
  > `matching_health`, qui alimente l'écran de supervision. Détail en **§B.2** et **§C.3** ; la
  > réponse sur l'annonce qui expire *pendant* un run est en **§C.3**.
  > ✅ **D3 EST FERMÉ — 23/09/2026.** Une relance dont le run a échoué n'est plus soldée : elle est
  > rejouée, bornée par un plafond de tentatives symétrique de celui des annonces, et l'expert lit
  > l'échec au lieu d'« aucune mission ». **L'audit nommait deux appelants ; il y en avait trois** —
  > l'approbation, trouvée par le contrôle et non par une relecture. Détail en **§C.14** et **§B.2**. Puis : le tarif
  du reranker sans source fournisseur et compté par document, les recherches web de la vérification
  non comptées, aucun bail par profil sur le chemin direct, un jugement de candidature jamais rejoué,
  deux définitions d'« éligible », le jugement toujours en français, un profil masqué qui postule
  encore, un plafond de dépense commun à tous les acteurs, et 73 % des passages des pilotes cron sans
  verdict HTTP. **Onze arbitrages** sont listés en tête du document ; aucun n'a été tranché.
  ⚠️ La base de staging **n'a jamais fait tourner le moteur actuel** (0 dépense, 0 brouillon,
  0 match noté par le reranker) : le comportement réel reste à mesurer par la recette.
- Le canal SMS est fermé au dispatcher (§D.2). Rouvrir exige d'abord de basculer le défaut de préférence
  en **opt-in** et de rendre les interrupteurs aux écrans — ni l'un ni l'autre n'est fait.
  ⚠️ **Sans rapport avec l'OTP d'inscription** : autre API (Verify v2), autre chemin, aucun point
  commun. `scripts/diag-canal-sms.mjs` tient cette séparation dans les deux sens.
- `lib/database.types.ts` est périmé et **inutilisé** (§E.1). Le régénérer et typer les clients
  supprimerait toute la classe E.1 ; personne ne l'a fait.

**Divulgation**
- `reveal_contact` est un **point d'extension** conçu mais **non branché**
  ([lib/expert-disclosure.ts](../lib/expert-disclosure.ts)) : le packaging commerce qui l'ouvrirait n'existe
  pas.

**Erreurs converties en verdicts (§E.22)**
- **Les neuf cas identifiés sont fermés**, et le recensement de la classe est **sous cliquet**
  ([scripts/diag-echec-silencieux.mjs](../scripts/diag-echec-silencieux.mjs)) : **37 occurrences
  au départ** (mesurées sur `c063ad1`), **33 gelées** aujourd'hui, **toutes relues une par une** —
  aucune ne traverse une garde. Une NEUVE rougit.
  ⚠️ **Trois des neuf ont été trouvés APRÈS un premier gel trop confiant.** Un cliquet fige un
  inventaire, il ne le juge pas : y mettre une ligne sans l'ouvrir, c'est déclarer légitime ce
  qu'on n'a pas lu. La leçon vaut pour tous les cliquets du dépôt.
- **LA CARTE EST DEVENUE UN CLIQUET** (lot 4.1a).
  [scripts/diag-erreurs-avalees.mjs](../scripts/diag-erreurs-avalees.mjs) recensait **143
  emplacements** de la famille élargie et **rendait toujours 0** — son en-tête le disait : « ni un
  contrôle qui échoue, ni un cliquet ». Une carte ne ferme aucune porte, et personne ne savait
  depuis quand elle n'avait pas été relue. Trois changements, tous mesurés :

  **① Le balayage passe à `app/` + `lib/` + `components/`** (457 fichiers). Il y a trouvé **trois
  requêtes, dans deux fichiers**, et les deux conséquences étaient pires qu'une erreur non
  journalisée :
  · `components/shell/DashboardShell.tsx` — une panne rendait `null`, et le shell en tirait un badge
    « non vérifié » **et un VERROU de navigation** (`dashboardNavSections`) : un utilisateur approuvé
    se voyait refuser une entrée de menu parce qu'une requête avait échoué. Aggravant — ce
    chargement est **relancé** sur `sk:availability-changed` et `sk:profile-changed`, donc une panne
    au refetch **effaçait un état déjà bon** ;
  · `components/settings/SettingsView.tsx` — même motif, mais `loadUser` est passé en `reload` à
    deux sections : il est rappelé **après un enregistrement réussi**. Une panne à cet instant vidait
    l'écran juste après un « enregistré », et laissait croire la saisie perdue.
  Les deux sont fermés : l'erreur est récupérée, journalisée comme **panne** (jamais comme absence),
  et l'état précédent est **conservé**. Le verrou de navigation sur `userIsVerified` n'est **pas**
  touché — ce qu'il faut afficher quand la vérification est *inconnue* est une décision produit, pas
  une question de gestion d'erreur, et la garde qui tranche est au serveur (`expertProfileGate`).

  **② Son motif avait DEUX trous**, et ils couvraient exactement le défaut ci-dessus. Il exigeait
  `const { … } = await <objet>.` ; lui échappaient `const [{ data: a }] = await Promise.all([…])`
  (**①-bis**) et `const [aRes] = await Promise.all([…])` suivi de `aRes.data` lu et `aRes.error`
  jamais (**①-ter**). Un `Promise.all` d'**auxiliaires** est exclu explicitement : son erreur vit
  dans l'auxiliaire, et les confondre ferait crier à tort.

  **③ Deux listes, pas une** (§G.8) : `JUGÉS` (lus, avec leur raison) et `À JUGER` (**comptés, pas
  lus**). Geler 158 emplacements d'un coup les déclarerait légitimes sans les avoir ouverts —
  l'erreur du lot 1.3, en dix fois plus gros. Le cliquet **refuse toute occurrence neuve** (rouge,
  sortie 1) ; le reliquat est **bruyant mais vert**, parce qu'un contrôle durablement rouge est un
  contrôle qu'on apprend à ignorer (§E.14) et que celui-là doit survivre aux lots qui le videront.

  **État mesuré au 18/09/2026** : **158 emplacements sur 78 fichiers** — ① 124 · ①-bis 6 · ①-ter 10 ·
  ② 9 · ③ 9. **JUGÉS : 0. À JUGER : 158.** `components/` est à **zéro**, les trois occurrences ayant
  été corrigées plutôt que gelées. Répartition du reliquat : `app/api` **120**, `lib` **36**,
  `app/[locale]` **12**.
- `joinBlockReason` était le **seul fail-open** de la classe ; il refuse désormais à l'écriture et se
  tait à l'affichage. Aucun autre n'a été trouvé — **mesuré, pas supposé**.

**Dette nommée dans le code**
- `metadataRoleFromOrgType` mappe encore `esn → cabinet` ; sans conséquence sur le routing aujourd'hui,
  à revoir si un autre appelant dépend de la distinction ([lib/auth-routing.ts](../lib/auth-routing.ts)).
- Factorisation V1 (freelance) / V3 (CDI) en attente, TODO posés sur : [lib/cv-parser-cdi.ts](../lib/cv-parser-cdi.ts),
  [app/api/profile/cdi-upload-cv/route.ts](../app/api/profile/cdi-upload-cv/route.ts),
  `app/[locale]/dashboard/cdi/profil/page.tsx`, `app/[locale]/dashboard/cdi/profil/valider/page.tsx`.
- [app/api/auth/finalize-org-registration/route.ts](../app/api/auth/finalize-org-registration/route.ts) :
  TODO V2 — migrer vers une file de travaux.
- [lib/nav-config.ts](../lib/nav-config.ts) : une entrée de menu non cliquable, fonctionnalité non livrée.
- `scripts/diag.mjs` — lanceur **RÉPARÉ le 22/09/2026** (§E.57) : il mourait sur un
  `ReferenceError` depuis sa création, et cette ligne le donnait pour « cassé et inachevé ». Il
  reste retiré de `package.json` pour cesser de piéger
  (`912d437`). Il reste dans le dépôt, réattribué.
- `scripts/diag-lot2b-expert.mjs`, `diag-lot2c-org.mjs`, `diag-lot3-messagerie.mjs` s'annoncent
  eux-mêmes **« DONNÉES OBSOLÈTES depuis le cleanup »**.
- `scripts/diag-readonly-expert-achwek.mjs` cible une **adresse e-mail réelle** ; à retirer ou à
  anonymiser au regard du registre RGPD.
- Trois scripts écrivent en base hors du périmètre de la garde (§E.4).

**Mise en production**
- Le paramétrage de référence est versionné (§B.2 ⑦). **Ce qui ne peut pas l'être** — deux secrets du
  Vault, réglages d'authentification, variables d'environnement, sous-domaines, **et le premier
  administrateur** — est décrit pas à pas dans [docs/mise-en-production.md](mise-en-production.md),
  pour quelqu'un de non technique. **Huit** étapes, et l'ordre a été corrigé le 18/09/2026 : la
  vérification des tâches planifiées demande d'ouvrir le back-office, donc elle suppose les variables
  d'environnement, les sous-domaines **et un administrateur** — elle était placée en quatrième
  position, où elle est **inatteignable**. Le document annonçait pourtant « l'ordre compte : chacune
  suppose la précédente ». Elle est désormais la dernière.
  **Gardé** par [scripts/diag-parametrage-manuel.mjs](../scripts/diag-parametrage-manuel.mjs)
  (§B.2 ⑦ bis) pour tout ce qui est mécaniquement vérifiable ; l'ordre, lui, ne l'est pas.
- **Cinq** des dix tâches planifiées passent par `trigger_purge_cron` et **lèvent** sans les deux
  secrets du Vault : `purge_deletions_trigger`, `purge_inactive_trigger`, `matching_retry_trigger`,
  `expert_relance_trigger`. Les deux premières portent une **obligation légale** (RGPD art. 17 et
  CNIL). Elles ne se plaignent qu'au journal de la base : rien à l'écran.
- **`ensure_rls` est ÉPROUVÉ.** Sa branche `create` avait été sautée par un `if not exists` sur tous
  les environnements connus, donc **jamais exécutée nulle part** ; `CREATE EVENT TRIGGER` exige un
  privilège que le rôle `postgres` de Supabase ne possède pas toujours, et un refus aurait fait
  échouer la migration **au 4ᵉ fichier**, les suivantes ne s'appliquant pas.
  **Le 16 septembre 2026, les 52 migrations se sont déroulées sur une base VIERGE en local, sans une
  seule erreur. La branche `create` s'est exécutée pour la première fois, sans refus de privilège.**

**Conformité**
- L'inscription au **registre des traitements** reste à faire pour `cron_run_log.response_body`, qui
  conserve des UUID de comptes (décision arbitrée au titre de l'art. 5.2, migration
  `cron_run_log_retention`).

**Arbitrages TRANCHÉS — ne pas les rouvrir**
- **La plage du tronc est `0xxxxx`** (§G.2). La consigne « 1xxxxx » était fausse.
- **La note sur 10 affichée à l'expert sur ses candidatures est VOULUE** (§D.6). Ce n'était pas un
  écart, c'est une décision produit.

**Arbitrages en attente (signalés par ce document)**
- La règle de fusion UNION sur `messages/*.json` n'est imposée par rien (§G.7).
- ~~Les seuils de `verification_providers` sans écran~~ — **CLOS** : `/admin/seuils` est livré (§P2.4).
  Reste sans écran : **`ai_spend_caps`**, les plafonds de dépense IA — `/admin/matching` affiche la
  dépense du mois **sans** le plafond en regard.
- ~~Cinq des sept points de dépense IA n'enregistrent rien~~ — **CLOS.** Les **sept** consultent le
  plafond avant d'appeler et enregistrent après, au tarif du modèle réellement appelé (§E.13).
  Gardé par un contrôle **de classe** : un huitième point ajouté demain rougit s'il est muet.
- ~~`ai_spend_caps` et `ai_spend_seuils_acteur` n'ont aucun écran~~ — **CLOS.** Les deux se règlent
  sur `/admin/matching`, chacun dans le bloc qui porte déjà sa valeur, bornés au serveur et tracés
  sous **deux** actions distinctes. L'écran écrit lequel **bloque** et lequel **alerte** (§P3.7).
- ~~La durée de validité d'une invitation vit en dur, dans DEUX fichiers~~ — **CLOS.** Elle rejoint
  `duree_reglages` (`invitation_jours`), et la seconde copie a disparu : `invitationExpiryIso()` est
  la source unique. Non rétroactive — la date est **écrite** à l'envoi et réécrite au renvoi — donc
  **aucune garde de comptage**, et l'écran le dit.
- ~~Trois des huit tâches planifiées ne sont pas dans `cron_job_catalog`~~ — **CLOS.** Les neuf sont
  nommées et traduites en quatre langues.
- ~~La dépense IA n'est pas répartie par acteur~~ — **CLOS.** Chaque événement nomme son acteur
  **déclencheur** (« qui fait monter la facture »), et **un seul** : contrainte en base
  (`ai_spend_un_seul_acteur`) *et* dans le type (`ActeurIA` est une union, pas deux champs
  optionnels), pour que les deux sommes ne comptent jamais deux fois la même dépense.
  `/admin/matching` affiche le découpage, l'alerte étant **recalculée à chaque affichage** —
  rien n'est stocké, aucune tâche planifiée. **Un dépassement alerte, il ne bloque pas.**
  La dépense antérieure au découpage apparaît en clair sur une ligne **« non imputable »** :
  elle n'est **jamais proratisée** sur les autres, et elle décroît d'elle-même (lecture mensuelle).
  Ces deux réglages ont désormais leur écran (voir ci-dessus).

**H.2 — LES TROIS TABLES DITES « MORTES » : LE VERDICT, MESURÉ LE 24/09/2026. RIEN N'EST SUPPRIMÉ.**
La revue du journal des transactions (23/09/2026) en déclarait trois mortes, sur un balayage de
`app/` et `lib/`. **Une des trois ne l'est pas**, et c'est le balayage qui était faux, pas la
table : un écrivain SQL ne se voit pas depuis le code (§E.61). Le périmètre d'un verdict de mort
inclut les **fonctions, les vues, les tâches et les politiques**.

| Table | Verdict | Ce qui a été lu |
|---|---|---|
| `rate_limit_hits` | **VIVANTE** | écrite par la fonction SQL `rate_limit_check()` (migration `rate_limiter`), purgée par la tâche `rate_limit_hits_purge`, lue par `cron_supervision_read` ; le code ne cite **jamais** la table — il appelle la fonction (`lib/rate-limit.ts`), et c'est sur elle que repose le plafond anti-abus de relance (§D.7). |
| `user_section_visits` | **MORTE → SUPPRIMÉE** (24/09/2026) | DDL, index, deux politiques RLS (`self_read`, `self_write` pour `authenticated`) et grants de la baseline — aucun écrivain, aucun lecteur, dans le code comme dans le SQL. Elle portait **5 lignes** d'un parcours disparu, emportées avec elle. |
| `subscription_history` | **MORTE → SUPPRIMÉE** (24/09/2026) | DDL, index, une politique RLS (`self_read`) de la baseline et les types générés — aucun écrivain, aucun lecteur, 0 ligne. Sa table de sauvegarde avait été retirée par `drop_backup_tables` ; elle-même restait. |

**Ce qui est fait — règle de l'architecte : « règle 0, elles partent ».** Migration
`tables_mortes_supprimees` (§B.2) : la **précondition exécute la preuve** que le balayage du code ne
peut pas donner — `pg_proc.prosrc` de toute fonction, clés étrangères entrantes, vues, triggers — et
refuse en nommant ce qui s'accroche ; la postcondition vérifie l'absence (`to_regclass`) et relit
les fonctions. `lib/database.types.ts` est nettoyé. Le verdict reste gardé par
[`diag-tables-mortes`](../scripts/diag-tables-mortes.mjs) : la vivante a son écrivain SQL, les deux
supprimées ne sont **plus citées nulle part** — code, types générés, SQL. Un état mesuré (§G.8).

**H.3 — LE GRAND LIVRE N'EST BRANCHÉ QUE SUR DEUX ACTIONS. Les étapes 2 à 4 attendent l'accord de Youssef.**
Le socle est posé (§D.26, §C.20) : la table, le verrou, `journaliser()`, la première RPC métier, la
pièce des deux côtés. Deux actions réelles journalisent — `reglage_modifie` et `ip_effacees`. **Tout le
reste de la liste fermée n'écrit encore rien** : cinquante-trois codes existent en base sans appelant.
Ce n'est pas un oubli, c'est l'ordre du lot — le socle se valide sur une base locale jetable puis sur
staging **avant** qu'on y branche quoi que ce soit. À venir, dans cet ordre : **étape 2**, brancher les
actions une par une avec la preuve que chacune écrit **une** fois (les dix routes qui changent un état
sans trace, le moteur dans les deux sens — déclenchement, filtrage, classement, correspondances,
notifications, fin ou échec ou abandon) ; **étape 3**, une colonne `piece` sur `audit_logs`,
`ai_spend_events`, `stripe_events`, `cron_run_log`, `notifications`, et la pièce transmise par
`trigger_purge_cron` dans le corps HTTP ; **étape 4**, l'écran et le batch de nettoyage (la seule RPC
autorisée à supprimer, reconnue par le trigger). La porte TypeScript `journaliser()`
(`lib/journal/journaliser.ts`) n'a **aucun appelant** aujourd'hui : elle attend les refus de l'étape 2.

---

---

## M. Les fusions, et comment les collisions ont été tranchées

> **Ces trois récits vivaient dans [CLAUDE.md](../CLAUDE.md), et ils en sont sortis le 23/09/2026**
> — ce fichier-là est chargé à chaque session et avait atteint 99 667 de ses 100 000 caractères.
> Un récit de fusion se lit **le jour d'une fusion**, pas tous les jours : même critère que celui
> qui a sorti §E vers [pieges.md](pieges.md) le 20/09/2026. Rien n’a été coupé.

> **Ce qu’ils ont en commun, et c’est la seule raison de les garder** : trois fois, deux worktrees
> ont écrit dans la mémoire du projet le même jour sans se voir, et **les deux avaient raison**.
> La question n’a jamais été « quel côté garder » mais **« que fait chaque côté, et comment les
> deux coexistent »**. On renumérote, on ne choisit pas — et **celui qui est déjà cité garde son
> numéro**. Enfin §E.45 : une collision qui ne produit **pas** de conflit est pire qu’une qui en
> produit, parce qu’elle laisse un fichier valide à la lecture et faux à la citation.

> **§M1 les a rejoints le 24/09/2026**, pour la même raison et au même endroit : les 18 écarts
> trouvés en relisant CLAUDE.md contre le code sont l’histoire de cette mémoire, pas une consigne
> à avoir sous les yeux avant d’écrire une ligne. La règle qu’ils établissent, elle, est restée
> dans CLAUDE.md : **une mémoire fausse ne se voit pas** (§E.16).

### M0 — Les énoncés PÉRIMÉS des sections anglaises de CLAUDE.md

Rien n'a été supprimé. Les énoncés ci-dessous sont contredits par le code actuel ; ils sont
marqués sur place par `⚠️ PÉRIMÉ — voir §M0`.

| Énoncé (sections anglaises ci-dessus) | Ce que dit le code |
|---|---|
| « proxy.ts … Locally it hardcodes `microsoft` » (§Commands, §Multi-tenancy) | Aucun slug n'est codé en dur. `resolveSubdomainFromHost()` ([lib/subdomain.ts](../lib/subdomain.ts)) lit `DEV_DOMAIN_SLUG` sur localhost et **lève une erreur actionnable** si la variable manque ; en production le slug vient du host, et un hôte non résolvable rend `null` (aucun repli). La section §Environment variables du même fichier l'énonçait déjà correctement : le fichier se contredisait. |
| « Every authenticated request re-checks that the user's `domain_id` matches `x-subdomain` » | Vrai pour les **experts uniquement**. `requireAuth` délègue à `resolveEcosystemAccess()` ([lib/ecosystem-guard.ts](../lib/ecosystem-guard.ts)), qui applique `ecosystemAccessScope()` ([lib/ecosystem-scope.ts](../lib/ecosystem-scope.ts)) : expert → `own`, client/cabinet → `all_active`, admin → `platform`, type inconnu → refus. |
| « Matching … Anthropic Claude » (§AI pipelines) | **Claude est sorti de la mise en relation.** Le moteur est un reranker (Cohere, [lib/matching/rerank.ts](../lib/matching/rerank.ts)) ; seuils et modèle sont lus dans `matching_settings` ([lib/matching/settings.ts](../lib/matching/settings.ts)). Claude ne subsiste qu'au **dépôt d'une candidature** ([lib/candidatures/ai-assessment.ts](../lib/candidatures/ai-assessment.ts)). |
| « CV parsing … rate-limited 3/24h » | Le quota n'est plus dans le code : il est lu en base (table `ai_quotas`, [lib/ai-quotas.ts](../lib/ai-quotas.ts)). Ligne absente ⇒ la route **refuse** (`quota_config_missing`), elle ne devine pas. |
| « Model IDs in use: `claude-haiku-4-5-*`, `claude-sonnet-4-6` » | Incomplet. En usage : `claude-haiku-4-5-20251001` (parsing CV, vérifications), `claude-sonnet-4-6` (repli des vérifications), `claude-sonnet-5` (jugement de candidature, pitch). |
| §Environment variables | Manquent : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ENABLE_BILLING`, `VONAGE_SMS_FROM`, `VERCEL_ENV`. |
| « currently the "microsoft" tenant » | Aucun écosystème n'est codé en dur nulle part. `/admin/ecosystemes` en crée ; `microsoft` n'est qu'un slug de test usuel. |
| **§P3.3 — « Seuil d'auto-approbation d'expert : défaut 9/10 »** | **FAUX, deux fois.** ① La valeur réelle est **8**. ② Elle ne vit **pas** dans la colonne `confidence_threshold` mais dans **`config->>'auto_approve_threshold'`** (jsonb). Le chemin expert *lit* la colonne puis ne s'en sert **jamais** — j'avais documenté le `DEFAULT 9` de la baseline, qui ne gouverne rien. Établi par requête sur la base réelle, cf. §E.10. |

Tout le reste des sections anglaises a été revérifié et tient.

---

### M1 — La relecture du 16 septembre 2026, et les 18 écarts trouvés

Ce fichier a été écrit depuis ce que l'on croyait savoir, puis relu **ligne à ligne contre le code**.
Dix-huit affirmations étaient fausses ou périmées. Elles sont corrigées sur place ; ce tableau
existe pour une seule raison : **chaque écart dit quelque chose sur la façon dont on se trompe.**

| # | Ce qui était écrit | Ce que le code dit | Famille |
|---|---|---|---|
| 1 | §P1.2 — vérification d'entreprise : « défaut **9** sur 10 » | **7**, sur la ligne `ai_web_search`. Le 9 est celui de `sirene_insee`, **jamais lu** | colonne inerte |
| 2 | §P3.5 — dernier admin d'org : « policies `organization_members` » | **trigger** `organizations_cliquet_siege_admin` + RPC | origine fausse |
| 3 | §C.6 / §P1.6 — « la **seule** route sans `requireAuth` » | **18 routes sur 128**. La bonne phrase : la seule qui **accorde des droits** sans identité | règle trop large |
| 4 | §C.5 — « les **cinq** surfaces la traversent » | 5 écrans, **4 chemins** : la sous-traitance emprunte la route des candidatures d'annonce | règle trop large |
| 5 | §B.1 — inventaire des tables | **18 tables sur 64 manquaient**, dont `branches` et `specialities` | inventaire incomplet |
| 6 | §B.1 — rien sur les tables mortes | **11 tables** ne sont lues ni écrites par aucune ligne de `app/` ou `lib/` | silence trompeur |
| 7 | §F — table des garanties de concurrence | **six manquaient**, toutes de la classe que §F recense | inventaire incomplet |
| 8 | (nulle part) — le **bail de run** | `cron_run_leases` ferme un chevauchement **structurel** qui faisait repayer le même travail d'IA | mécanisme absent |
| 9 | (nulle part) — le **siège admin plateforme** | table `plateforme` + `cliquet_siege_admin()` | mécanisme absent |
| 10 | §P2.4 — écran `/admin/ecosystemes/[id]` | **n'existe pas** : panneau dans la liste, seule la route API porte ce chemin | écran fantôme |
| 11 | §P2.4 — `/admin/durees` | livré au lot 3, **absent du tableau** | oubli de maintenance |
| 12 | §P3.1 — trois offres | **quatre** : `Collaboration` (1/1/1/**0**) gouverne l'organisation personnelle d'un expert | inventaire incomplet |
| 13 | §P3.1 — « offre par défaut : Free » | **deux** défauts, un par cible | imprécision |
| 14 | §P3.6 — « `cron_job_catalog` **nomme chaque** tâche » | **5 sur 8**. Les trois du moteur sont muettes à l'écran — **corrigé depuis** : les huit sont nommées | le défaut qu'on prétend fermé |
| 15 | §E.3 — « en tête de **32** scripts » | **50** sur 71 | chiffre vieilli |
| 16 | §E.11 — « **438** fichiers » | **445** | chiffre vieilli |
| 17 | §E.12 — « **51** migrations, **35** insertions, **1913** valeurs » | **61 / 38 (sur 50 vues) / 1944** | chiffre vieilli |
| 18 | §F — « `verrou_run_et_unicite_notifications` n'est **pas** sur le tronc » | elle y est | affirmation périmée |

**Ce que ces dix-huit écarts ont en commun.** Aucun n'était un mensonge : chacun était **vrai le jour
où il a été écrit**, ou tiré d'une lecture trop rapide. C'est ce qui les rend dangereux — ils se
citent, et rien dans le fichier ne dit depuis quand ils n'ont pas été vérifiés.

**Deux fois pendant cette relecture, le piège §E.7 s'est refermé sur le relecteur lui-même** : un
`grep` a trouvé `disclosurePolicyForCandidatureLifecycle` dans un **commentaire** de
`lib/admin/user-actions-guard.ts` (faux sixième consommateur), et `requireAuth` dans le
**commentaire** de `stripe/webhook` qui énonce précisément la règle contestée. **Un contrôle, pas une
promesse de vigilance** : §E.16.

---

### M2 — Les quatre migrations en `1xxxxx`, et pourquoi on ne les renomme pas

> ⚠️ **ET LA RÈGLE A ÉTÉ ENFREINTE PAR LE TRONC LUI-MÊME, QUATRE FOIS.**
> `20260916100000_tarifs_ia`, `…110000_depense_ia_par_acteur`, `…120000_durees_reglables` et
> `…130000_duree_invitation` portent un suffixe **`1xxxxx`** — précisément la plage que le
> paragraphe ci-dessus déclare **fausse et corrigée**. Écrites les 16 et 17 septembre 2026, relues
> plusieurs fois, et personne ne l'a vu : **rien ne pouvait le voir.**
>
> **Aucune collision n'en a résulté** — `1xxxxx` n'est attribuée à aucun worktree, et l'ordre
> chronologique tient. Mais la plage existe *pour* éviter la collision, et celle-ci a déjà coûté un
> renumérotage en urgence.
>
> **Les quatre sont APPLIQUÉES en base — MESURÉ le 18/09/2026.** Ce paragraphe disait « trois des
> quatre », et c'était vrai à sa date : la quatrième était alors **renommable**, et le gel ne disait
> pas laquelle. C'était la seule ligne gelée du dépôt sans raison individuelle (§G.8).
> **La fenêtre est refermée** : au moment de cette mesure le disque portait **65** migrations — il en
> compte **66** depuis `echelle_des_notes` (19/09/2026) —, et la requête sur
> `supabase_migrations.schema_migrations` — celle qui est en tête du gel dans
> [scripts/diag-migration-donnees.mjs](../scripts/diag-migration-donnees.mjs) — a rendu **quatre
> lignes**. Le gel est **définitif**.
> ⚠️ La mesure vient d'une **lecture humaine sur la base**, pas du dépôt : aucun contrôle ne peut la
> refaire tout seul (§E.12). Les renommer ferait diverger
> `supabase_migrations.schema_migrations` du disque, donc **rejouer des migrations déjà passées**.
> On ne corrige pas le passé : **on l'inscrit, et on ferme l'avenir.**
>
> **La parade — un CLIQUET**, dans [scripts/diag-migration-donnees.mjs](../scripts/diag-migration-donnees.mjs),
> même forme que `diag-colonnes-supprimees` : les quatre sont **gelées nommément**, le compte ne peut
> que **descendre**, et toute **nouvelle** migration hors des plages attribuées fait rougir. Éprouvé
> par mutation, dans les deux sens : une migration en `4xxxxx` est refusée, une gelée renommée dans
> la bonne plage est signalée comme sortie du gel.

### M1 bis — La fusion de `feat/s2`, et comment la collision a été tranchée

Le 17/09/2026, `feat/s2` a été fusionné dans le tronc. **Les deux côtés avaient écrit dans la mémoire
du projet le même jour, sans se voir**, et les deux avaient raison. Résolution **en union** : aucune
section n'a disparu, aucune n'a été arbitrée.

**La collision.** Les deux côtés ont écrit un **§E.16**. Celui du tronc garde son numéro — il était
déjà cité **cinq fois** dans le fichier découpé ; ceux de `feat/s2` deviennent **§E.17** (l'URL
saisie servie à `<img src>`) et **§E.18** (l'embed ambigu). Leurs renvois internes ont suivi.
**On renumérote, on ne choisit pas.**

**Le replacement.** `feat/s2` a écrit contre le fichier **monolithique**, avant le découpage. Ses
sections ont donc été **replacées**, jamais empilées en fin de fichier : §D.8 dans §D et §E.17/§E.18
dans §E (aujourd’hui `docs/pieges.md`) ; §P1.2 (« 2 bis »), §P2.3, §P2.4, §P3.3 et §P3.5 dans
[docs/produit.md](produit.md), chacune à sa place dans son tableau.

**La seule ligne non reprise telle quelle, et pourquoi.** `feat/s2` écrivait
`` | `ecosystemes` · `ecosystemes/[id]` | `` — or §M1 n°10 a **établi par mesure** que
`/admin/ecosystemes/[id]` n'existe pas : le détail est un panneau dans la page de liste. La ligne
fusionnée porte **toute** la substance de `feat/s2` (logo, favicon, bucket public, chemin dérivé de
`domain_id`, disparition de la saisie d'URL) **et** la correction du tronc. Reprendre la mention de
l'écran aurait réintroduit l'erreur que §M1 venait de fermer — vérifié par mutation :
`diag-memoire-exacte` rougit dessus.

**Les quatre `messages/*.json` se sont fusionnés seuls**, et la fusion est l'**union exacte** des
deux côtés : 3133 clés à la base, +21 côté tronc, +26 côté `feat/s2`, **3180** après fusion, parité
exacte sur les quatre langues. Deux clés ont disparu — `field_logo_url` et `logo_url_help` — parce
que `feat/s2` les a **délibérément supprimées** en remplaçant la saisie d'URL par un téléversement.
Une suppression voulue n'est pas une perte ; elle est vérifiée comme telle, pas supposée.
### M1 ter — La fusion de `feat/s1-ux-profil`, et les deux écrans partagés

Le 17/09/2026, `feat/s1-ux-profil` a été fusionné. **Deux worktrees avaient travaillé sur LES MÊMES
ÉCRANS d'organisation sans se croiser** — `feat/s2` sur le logo (déjà sur le tronc), `feat/s1` sur le
pays du siège et le motif de mise en revue. **Les deux sont justes ; aucun ne remplace l'autre.**

**Cinq conflits, dont trois sur du code.** Pour chacun, la question posée n'a pas été « quel côté
garder » mais « que fait chaque côté, et comment les deux coexistent ».

| Fichier | Ce que chaque côté faisait | L'union |
|---|---|---|
| `app/api/me/organisation/route.ts` | `logo_url` est **préexistant** : S2 l'a **retiré** de la whitelist (c'était une saisie d'URL, §E.17) ; S1 ne l'a pas touché et a **ajouté** `country` | le **retrait** de S2 **et** l'ajout de S1 — vérifié sur la base `392dd07` avant de trancher |
| `app/api/admin/get-org/[id]/route.ts` | un import chacun, plus un validateur de motif chez S1 | purement additif : les deux |
| `dashboard/entreprise/organisation/page.tsx` | S2 monte `OrgLogoUpload` ; S1 monte `CountrySelect` et charge le référentiel | les deux composants, et le champ `logo_url` reste **hors** du formulaire |
| `CLAUDE.md` | les deux avaient mis à jour le **nombre de migrations** — 63 pour le tronc, 64 pour S1 | **65**, mesuré après fusion : aucun des deux n'était bon, et choisir l'un aurait réintroduit le défaut que cette phrase raconte |
| `docs/produit.md` | deux paragraphes **au même endroit, sur des sujets différents** | les deux, dans l'ordre du parcours — le motif de revue prolonge l'étape 2, le logo ouvre l'étape 2 bis |

**Seconde collision de numéros de section, résolue comme la première.** `feat/s1` portait un §E.13, un
§E.14 et un §E.17 — les trois déjà pris par le tronc, et **en double dans son propre fichier** (sa
fusion précédente les avait empilés après §E.9 sans renuméroter). Ils deviennent **§E.19**, **§E.20**
et **§E.21**, et ils sont **replacés** dans §E, avant le fourre-tout §E.9.

**198 lignes ajoutées par `feat/s1` à la mémoire, toutes présentes** — sauf le paragraphe du nombre
de migrations, remesuré ci-dessus. Vérifié par script, pas supposé.

**Les `messages/*.json` sont l'union EXACTE** : 3154 à la base, +26 côté tronc, +37 côté `feat/s1`,
**3217** après fusion, parité exacte sur les quatre langues. **Cinq suppressions délibérées** sont
propagées — deux du logo (S2 remplace la saisie d'URL par un téléversement), trois de la saisie de
téléphone (S1 unifie les trois parcours). Une suppression voulue n'est pas une perte, et c'est
vérifié comme telle.

**Défaut vu pendant la fusion, traité dans la fusion.** Les deux migrations de `feat/s1` portaient un
suffixe **`1xxxxx`** — la plage que §G.2 déclare fausse, et **la même infraction que celle du tronc**.
Elles n'étaient appliquées nulle part : elles ont été renumérotées dans la plage de S1
(`20260917200000`, `20260917210000`), exactement comme `912d437` l'avait fait avant application.
Toutes les références passent par le **suffixe** (§G.3), donc rien ne casse. Le cliquet de
`diag-migration-donnees` les avait dénoncées — c'est sa première prise.
### M1 quater — La fusion du module Stripe d’exploitation (20/09/2026), et la collision QUI N’A PAS FAIT DE CONFLIT

Le 20/09/2026, `feat/s1-ux-profil` a été fusionné une seconde fois : il portait le **module
Stripe d’exploitation** — `/admin/facturation`, `/admin/facturation/ecarts`, **une seule** route
API pour les trois surfaces, un cron de vérification nocturne, `lib/stripe-exploitation/*`, et une
migration `2xxxxx`. **Fichiers neufs uniquement** : aucune route de `app/api/billing/` ni de
`app/api/stripe/` n’a été touchée, et la fusion le confirme — **aucun conflit de code**.

**DEUX COLLISIONS DE NUMÉROS, ET LA SECONDE EST LA PLUS INSTRUCTIVE.**

| Où | Ce qui est entré en collision | Résolution |
|---|---|---|
| `CLAUDE.md` | les deux côtés ont écrit un **§E.39** | git a levé un **CONFLIT** : celui du tronc garde son numéro (il est **cité** par §E.38 ③), celui de S1 devient **§E.44** |
| `docs/architecture.md` | les deux côtés ont écrit un **§C.10** | **git n'a rien signalé** — insertions à des endroits différents, fusion automatique réussie, et **deux sections du même numéro** dans le fichier |

> ⚠️ **UNE COLLISION QUI NE PRODUIT PAS DE CONFLIT EST PIRE QU'UNE QUI EN PRODUIT.** Un conflit
> arrête la fusion et exige une décision. Celle-ci a produit un fichier **valide, cohérent à la
> lecture, et faux à la citation** : deux §C.10, dont un cité deux fois — `architecture.md:65` et
> `produit.md:628`. Rien dans git, rien dans `tsc`, rien dans `next build`. Elle a été trouvée en
> **recomptant les sections des deux côtés après la fusion**, pas en lisant le rapport de merge.
> *Vérifier une fusion, ce n’est pas relire ses conflits : c’est recompter ce que les deux côtés
> ont ajouté.*

**Même convention que M1 bis et M1 ter : CELUI QUI EST DÉJÀ CITÉ GARDE SON NUMÉRO.** Le §C.10 de
S1 (module Stripe) est cité deux fois → il garde `C.10`. Celui du tronc (les trois écrivains des
listes de profil) n’est cité nulle part → il devient **`C.11`**. Et les deux sont **replacées** :
la fusion automatique laissait l'ordre `C.1-6, C.10, C.8, C.10, C.9` ; il est rendu croissant.
**Vérifié par script — 897 lignes avant, 897 après**, et aucune ligne altérée hors des deux
en-têtes renumérotées.

**Les quatre `messages/*.json` se sont fusionnés seuls, et la fusion est l’UNION EXACTE** :
**3341** à la base, **+1** côté tronc, **+119** côté S1, **3461** après fusion, parité stricte sur
les quatre langues — **zéro clé manquante, zéro clé en trop**. Et **aucune suppression délibérée
d’aucun côté** : vérifié en confrontant chaque côté à la base, pas supposé (c’est le piège que
M1 bis avait dû trancher à la main).

**CE QUE S1 RENVOIE AU TRONC, ET QUI N’EST PAS TRAITÉ DANS LA FUSION** — quatre points, aucun
bloquant, ordonnés avec les quatorze défauts nommés du gel 4.1d :
① `stripe_event_claim` — un processus mort **entre la réclamation et la clôture** laisse la ligne
   en `received`, et la garde `where status = 'failed'` refuse alors **tous** les réessais de
   Stripe, définitivement. S1 le **signale à l’écran** et n’y touche pas : c’est un arbitrage
   d’**argent**, pas de code. Proposition rendue à l’architecte, décision non prise seul.
② `lib/billing/events.ts` doit **exporter** `STATUTS_OUVRANTS` et la liste des six types du
   `switch` — S1 les a recopiés (jumeaux assumés, §E.20) et son contrôle échoue s’ils divergent.
③ Deux commentaires **faux** dans `app/api/stripe/webhook/route.ts` — « la seule route sans
   `requireAuth` » (elles sont **18 sur 128**, §M1 n°3) et « zéro cron » (**4 routes, 9 tâches**) —
   le second **répété** dans `20260901000000_stripe_fondations.sql`.
④ L’en-tête de `lib/billing/stripe.ts` : `getStripe()` a maintenant **quatre** appelants.

