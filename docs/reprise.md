# Reprise — le lot du grand livre

> **À lire en premier par une session qui repart.** Tenu à jour toutes les cinq actions.
> Ce fichier dit **où en est le lot** ; le **pourquoi** vit dans la mémoire — §D.26, §C.20, §C.21
> et §H.3 de [architecture.md](architecture.md). Rien ici ne remplace le code : en cas de doute,
> `node scripts/diag-grand-livre.mjs` compte ce qui est branché.

**Dernière mise à jour : 26/09/2026.** Branche `feat/sprint-archi-orga`. Aucun `git push`, aucune écriture en base.

## Le mandat, en une phrase par étape

- **Étape 2** — chaque action de `grand_livre_actions` (55) a **exactement un** écrivain, prouvé par le contrôle.
- **Étape 3** — une colonne `piece` sur `audit_logs`, `ai_spend_events`, `stripe_events`, `cron_run_log`
  (pièce née en SQL, transmise dans le corps HTTP), `notifications`. Pas de reprise de l'historique.
- **Étape 4** — l'écran `/admin` du grand livre (filtres, pièce complète, lien vers l'objet, montants, nom
  rejoint à la lecture ou « compte supprimé », pagination réelle, troncature annoncée) et le batch de
  nettoyage (manuel, rétention réglable, plancher légal, annonce avant, confirmation, sa propre ligne).

## Fait

| Famille | Actions |
|---|---|
| (a) argent et réglages | `reglage_modifie` (6 familles), `paiement_recu`, `plafond_atteint`, `refus_plafond_atteint`, `ip_effacees` |
| (b) candidature et dévoilement | `candidature_deposee` (et la pièce du rejeu), `refus_depot_sans_jugement`, `refus_expert_inapte`, `refus_garde_eligibilite`, `refus_quota_cv`, `candidature_declinee`, `candidature_retenue`, `devoilement_ouvert`, `devoilement_ferme` |
| (c) le moteur, deux sens | `recherche_lancee`, `_filtree`, `_classee`, `_correspondances`, `_notifiee`, `_terminee`, `_echouee`, `_abandonnee` |
| (d) annonce, profil, CV, disponibilité | `annonce_publiee`, `annonce_modifiee`, `annonce_depubliee`, `annonce_expiree`, `cv_televerse`, `profil_publie`, `profil_modifie`, `disponibilite_basculee` |
| (e) comptes | `compte_suspendu`, `compte_reactive`, `compte_valide`, `compte_refuse`, `session_revoquee`, `suppression_programmee`, `suppression_annulee`, `email_change`, `mot_de_passe_change`, `telephone_verifie` |
| (e) gouvernance | `membre_invite`, `invitation_revoquee` (`bd77104`), `invitation_renvoyee`, `invitation_acceptee`, `role_membre_change`, `membre_retire`, `membre_parti` — **(e) fait** |
| (f) collaboration | `sous_traitance_publiee`, `sous_traitance_candidature` |
| (g) RGPD | `compte_purge_demande`, `compte_purge_inactivite`, `compte_purge_admin`, `inactivite_avertie` |
| messagerie | `message_envoye` |

**Compte : 54 / 55** — reste `journal_nettoye`, dont l’écrivain SQL (le nettoyage) est avancé en fin d’étape 2 ; son écran suit en étape 4.

## ⛔ PHASE A — ON ATTEND LE REJEU LOCAL (26/09/2026)

Le premier `npx supabase db reset --local` s'est arrêté sur `liste_blanche_par_action` : les chemins d'un
détail sortaient en double. **Corrigé**, et la relecture des 45 postconditions a trouvé **quatre** autres
sondes qui auraient arrêté la chaîne (§E.71 de pieges.md). **Aucune migration nouvelle n'est écrite tant
que les 45 ne passent pas en local.** Youssef relance, rend la sortie ; on recommence jusqu'au vert.
Staging est intact.

## PHASE B — APRÈS LE FEU VERT DU REJEU LOCAL (décisions de Youssef, 26/09/2026)

1. **Les 7 gestes deviennent des actions** : inscription d'un expert, préinscription d'une organisation,
   création d'un administrateur, annonce créée en brouillon, mission écartée par l'expert, événement Stripe
   rouvert à la main, tâche lancée à la main.
2. **La règle des rattachements** : le nom d'une action dit ce qui s'est passé — si filtrer sur une action
   rend des lignes qui ne sont pas ce que son nom annonce, c'est une action distincte. **Distinctes, imposées** :
   `taxonomie_modifiee`, `ecosysteme_modifie`, `organisation_modifiee`, `identite_modifiee`,
   `cv_reinitialise` (son détail dit que le profil sort de la vitrine). **Les neuf autres rattachements**
   de §H.3 ter : appliquer la règle, garder ceux qui la tiennent, rendre la liste gardé/séparé.
3. **Les 7 routes hors périmètre sont confirmées** — chacune ÉCRITE dans la liste d'exclusion du contrôle,
   avec sa raison (aucune exclusion silencieuse).
4. **Critère de fin** : 55 + 7 + les actions séparées. CHAQUE action a EXACTEMENT UN appelant, sauf le
   nettoyage (`journal_nettoye`), qui vient avec l'écran. Le rapport donne le compte exact. Le contrôle
   devient STRICT et la mesure des routes devient un contrôle (exceptions nommées, §G.8).
5. Puis l'**étape 3** (colonne `piece` sur les sous-journaux) et l'**étape 4** (l'écran et le batch).

## Validations à rejouer avant chaque commit

`npx tsc --noEmit` · `npx next build` (séparément, §E.2) · `npm run lint` (base 66/28) · `node scripts/diag.mjs`
(série statique ; 5 muets attendus : 3 écartés parce qu'ils écrivent, 2 qui plantent sur l'environnement Windows) ·
mutation du nouveau contrôle, **après** le commit.

## ⚠️ Les migrations du lot n'ont JAMAIS tourné (§E.70)

Mesuré le 26/09/2026 : 22 sondes ne demandant aucune donnée auraient levé sur une base vierge — donc
aucune migration de l'étape 2 n'avait été rejouée. Corrigées en place (non appliquées nulle part) et
gardées par un contrôle de classe. **Le rejeu sur base jetable avant staging n'est pas une formalité.**

## Migrations depuis `origin/feat/sprint-archi-orga`

`git diff --name-only origin/feat/sprint-archi-orga -- supabase/migrations` — à rejouer sur une base jetable
(`npx supabase db reset --local`) avant staging (§G.4 bis).
