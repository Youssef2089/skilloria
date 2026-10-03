# Les skills du dépôt — provenance

Installées le 03/10/2026 (lot skills, branche `lot/skills`). **Chaque skill officielle est une copie
À L'OCTET du dossier publié par son éditeur** (vérifiée par `diff -r` contre le clone), sans retouche :
une mise à jour se compare donc ligne à ligne. Nos skills du projet sont écrites ici, à partir de
CLAUDE.md et de `docs/`.

Ce fichier n'est pas une skill (il n'a pas de `SKILL.md`) : Claude Code ne le charge pas.

## Les skills officielles

Organisations vérifiées le 03/10/2026 par l'API GitHub : `anthropics`, `supabase`, `vercel-labs` portent le
badge « vérifiée » ; `stripe` (site `stripe.dev`) et `resend` (site `resend.com`) ne le portent pas, mais ce
sont les organisations que leurs sites et leurs skills désignent (`metadata.source` de Resend).

| Skill | Dépôt · chemin | Commit | Licence | Ce qu'elle fait | Exécute du code ? |
|---|---|---|---|---|---|
| `supabase` | supabase/agent-skills · `skills/supabase` | `c9be0e9` | MIT (dépôt) | Principes Supabase : vérifier la doc et le changelog, RLS, liste de sécurité (auth, clés, vues, `SECURITY DEFINER`, Storage), CLI, MCP, débogage | **Aucun script.** Demande à l'agent de lancer des commandes (`supabase … --help`, `curl` vers `mcp.supabase.com`, `supabase db advisors`, `db pull`) et propose d'ouvrir un ticket GitHub chez Supabase — avec la permission de l'utilisateur |
| `supabase-postgres-best-practices` | supabase/agent-skills · `skills/supabase-postgres-best-practices` | `c9be0e9` | MIT | 31 règles Postgres (requêtes, index, connexions, RLS, schéma, verrous, données, supervision) | Non — documentation seule |
| `vercel-react-best-practices` | vercel-labs/agent-skills · `skills/react-best-practices` (le **dossier** s'appelle `react-best-practices`, le **nom** de la skill est bien `vercel-react-best-practices`) | `063bee9` | MIT (frontmatter) | 70 règles de performance React / Next.js (cascades, bundle, serveur, rendus) | Non — documentation seule |
| `stripe-best-practices` | stripe/ai · `skills/stripe-best-practices` (identique à `providers/claude/plugin/skills/…`) | `9a33771` | MIT | Choix d'API Stripe (Checkout, PaymentIntents, Billing, Connect, Tax), clés, webhooks | **Aucun script.** Peut proposer d'installer la CLI Stripe (`npm i -g @stripe/cli`, `stripe sandbox create`) |
| `resend` | resend/resend-skills · `skills/resend` | `edbfece` | MIT | API Resend : envoi simple et par lots, idempotence, webhooks, domaines, modèles, erreurs | **Un script d'exemple** : `references/fetch-all-templates.mjs` — LIT la liste des modèles par l'API (`RESEND_API_KEY`), n'écrit rien ; ne tourne que si on le lance |
| `email-best-practices` | resend/email-best-practices · racine (`SKILL.md` + `references/` ; identique à `resend-skills/skills/email-best-practices`) | `ef76428` | MIT (frontmatter) | Délivrabilité (SPF, DKIM, DMARC), e-mails transactionnels, conformité (RGPD, CAN-SPAM), fiabilité, accessibilité | Non — documentation seule |
| `webapp-testing` | anthropics/skills · `skills/webapp-testing` | `8a1541c` | Apache 2.0 (`LICENSE.txt`) | Tester l'application locale avec Playwright (Python) : capture, console, éléments | **Oui.** `scripts/with_server.py` lance des serveurs par `subprocess` (`shell=True`), attend leur port, exécute la commande donnée puis les arrête. Exige **Python et Playwright pour Python** — absents de ce poste au 03/10/2026 |
| `frontend-design` | anthropics/skills · `skills/frontend-design` | `8a1541c` | Apache 2.0 (`LICENSE.txt`) | Direction visuelle d'une interface nouvelle (palette, typographie, mise en page, textes) | Non — instructions seules |
| `skill-creator` | anthropics/skills · `skills/skill-creator` | `8a1541c` | Apache 2.0 (`LICENSE.txt`) | Écrire, éprouver et améliorer une skill (cas de test, comparaison avec et sans, description) | **Oui, Python** : `quick_validate.py`, `package_skill.py`, `aggregate_benchmark.py` (fichiers seulement) ; `run_eval.py` / `run_loop.py` / `improve_description.py` lancent `claude -p` (coût en jetons), écrivent puis effacent des fichiers temporaires dans `.claude/commands/`, et lisent les tubes par `select()` — **ne tourne pas sous Windows** ; `eval-viewer/generate_review.py` ouvre un serveur local (port 3117) et **arrête tout processus qui écoute sur ce port** (`lsof`, absent sous Windows) ; ses pages chargent Google Fonts et SheetJS depuis un CDN |

## Nos skills du projet

| Skill | Ce qu'elle fait | Sources |
|---|---|---|
| `regles-communes-des-lots` | Les règles de chaque consigne : périmètre, migrations, quatre langues, messages et codes, contrôles, mémoire, forme de l'ARRÊT | CLAUDE.md §D, §G ; `docs/reprise.md` (ARRÊTS 24-28) ; `scripts/diag.mjs`, `diag-controles-a-rejouer` |
| `deploiement-deux-temps` | La séquence 0-7 et la règle des deux temps | CLAUDE.md §G.4, §G.4 bis, §G.4 ter ; en-tête de `scripts/diag-deux-temps.mjs` ; ARRÊT 28 ; `docs/mise-en-production.md` |
| `relecture-avant-deploiement` | La liste de vérifications du relecteur et la forme du verdict | ARRÊT 24, relecture du 02/10 (ARRÊT 26), contre-relecture de l'ARRÊT 28, `docs/reprise-s2.md` ; CLAUDE.md §E, §G |

Aucune n'exécute de code. Chacune a ses cas de test dans `evals/evals.json` (méthode de skill-creator) ;
**les comparaisons avec et sans skill n'ont pas été lancées** (Python absent, et elles coûtent des jetons).

## Ce qui frotte avec les règles du dépôt — constaté en lisant

**CLAUDE.md et `docs/` l'emportent.** Ces points sont relevés, pas tranchés :

- `supabase`, « Option B » : itérer en exécutant le SQL **sur la base** puis générer la migration par
  `db pull` — or aucun worktree n'écrit en base (§G.6), les migrations s'écrivent à la main (`npm run db:new`)
  et se rejouent par `db reset --local` (§G.4 bis).
- `stripe-best-practices` : « toujours la dernière version d'API et de SDK » (le projet : `stripe` 22.0.0, la
  skill cite 22.6.0) et une préférence pour les clés restreintes `rk_` — le verrou de §D.1 les accepte déjà
  (`lib/billing/config.ts`).
- `resend` : demande de monter le SDK au-dessus de 6.14.0 — le projet est en **6.10.0**.
- `vercel-react-best-practices` : certaines règles proposent des bibliothèques (`better-all`, `lru-cache`).
- `frontend-design` : une identité visuelle « distinctive » à chaque fois — le projet a sa palette par
  écosystème, en jetons `--sk-*` (§D.12), et sa barre UX (Stripe / Linear / Vercel).
- `webapp-testing` : `npm run dev` exige `DEV_DOMAIN_SLUG` en local (CLAUDE.md, variables) ; les exemples
  écrivent dans `/tmp` et `/mnt/user-data` (chemins Linux).
- `resend` : frontmatter avec deux clés (`inputs`, `references`) que le validateur strict de skill-creator
  refuse ; laissées telles quelles (copie de l'éditeur).

## Mettre à jour une skill officielle

Recloner le dépôt de l'éditeur, comparer (`diff -r`) avec le dossier d'ici, **lire** ce qui change (SKILL.md
et scripts), recopier le dossier entier, et mettre à jour le commit dans le tableau ci-dessus — dans le même
commit.
