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
| (e) gouvernance | `membre_invite`, `invitation_revoquee` (`bd77104`), `invitation_renvoyee`, `invitation_acceptee` |

**Compte : 45 / 55.**

## En cours

- (e) gouvernance : `role_membre_change`, `membre_retire`, `membre_parti` — par `maj_membre_organisation()` (le seul chemin d’écriture sur un membre), code DÉRIVÉ du geste, ancienne signature supprimée.

## Reste, dans l'ordre

1. (e) terminé avec la ligne ci-dessus.
2. (f) `sous_traitance_publiee`, `sous_traitance_candidature`.
3. (g) `inactivite_avertie`, `compte_purge_demande`, `compte_purge_inactivite`, `compte_purge_admin` ; `message_envoye` ;
   **les « dix routes sans trace »** : la liste n'est écrite nulle part dans le dépôt — elle sera **mesurée**
   par un balayage à périmètre écrit, et son résultat inscrit ici.
4. Vérifier (a)–(d) complètes.
5. Le contrôle rougit sur **toute** action sans écrivain (aujourd'hui `diag-grand-livre` ne fait que les
   afficher) — critère « 55 sur 55 ». `journal_nettoye` arrive avec l'étape 4.
6. Étapes 3 et 4.

## Validations à rejouer avant chaque commit

`npx tsc --noEmit` · `npx next build` (séparément, §E.2) · `npm run lint` (base 66/28) · `node scripts/diag.mjs`
(série statique ; 5 muets attendus : 3 écartés parce qu'ils écrivent, 2 qui plantent sur l'environnement Windows) ·
mutation du nouveau contrôle, **après** le commit.

## Migrations depuis `origin/feat/sprint-archi-orga`

`git diff --name-only origin/feat/sprint-archi-orga -- supabase/migrations` — à rejouer sur une base jetable
(`npx supabase db reset --local`) avant staging (§G.4 bis).
