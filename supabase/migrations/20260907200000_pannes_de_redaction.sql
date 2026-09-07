-- ─────────────────────────────────────────────────────────────────────────────
-- LES RÉSUMÉS QUI N'ONT PAS PU ÊTRE ÉCRITS
--
-- ⚠️ ORDRE D'EXÉCUTION — AVANT le déploiement du code. N'ajoute que du nouveau.
--    Sans elle, l'enregistrement des pannes échoue en silence côté applicatif
--    (best-effort assumé) : les résumés continuent d'être produits, mais
--    personne ne voit ceux qui manquent.
--
-- ═══ POURQUOI CE JOURNAL EXISTE ══════════════════════════════════════════════
--   Un résumé de candidature peut ne pas être écrit pour trois raisons, et
--   `candidature_ai_health()` les confondait toutes en une seule : « sans
--   jugement IA ». Or elles n'appellent pas la même action.
--
--     plafond              → la dépense mensuelle est atteinte. C'est un choix
--                            de gestion : on relève le plafond, ou on assume.
--     modele_indisponible  → clé absente, interrupteur coupé, appel en échec.
--                            C'est une PANNE, et elle se répare.
--     reponse_illisible    → le modèle a répondu, mais pas ce qu'on attendait.
--                            C'est une dérive de qualité, et elle se surveille.
--
--   Le jour où plus aucun résumé n'est produit, un compteur unique dirait
--   seulement « il en manque beaucoup ». Trois compteurs disent lequel des trois
--   problèmes on a — et donc quoi faire.
--
-- ═══ CE QUE CE JOURNAL N'EST PAS ════════════════════════════════════════════
--   Ce n'est PAS une file de modération, ni une file de rejeu. Il n'existe
--   aucun écran pour valider un texte, aucun mécanisme pour le régénérer
--   automatiquement. C'est un COMPTEUR DE PANNES, et rien de plus : il rend
--   visible ce qui n'a pas pu être écrit.
--
--   Aucun texte n'y est stocké. Une panne n'a pas de contenu ; elle a une
--   cause, un moment, et l'objet qu'elle concerne.
--
-- ═══ ET SURTOUT : RIEN DE TOUT CELA NE BLOQUE UNE CANDIDATURE ═══════════════
--   Une candidature dont le résumé n'a pas pu être écrit est déposée
--   normalement, et l'organisation la reçoit. Il lui manque un texte
--   d'agrément, pas un dossier.
-- ─────────────────────────────────────────────────────────────────────────────


create table if not exists public.ai_redaction_failures (
  id         uuid primary key default gen_random_uuid(),

  -- Les trois causes, bornées par contrainte. Du texte plutôt qu'un type enum :
  -- ajouter une cause ne doit pas demander de migrer un type.
  cause      text not null,

  -- Quel texte n'a pas pu être écrit : celui du dépôt (note + reason + pitch)
  -- ou le pitch rédigé à la demande sur une carte ouverte.
  surface    text not null,

  domain_id  uuid references public.domains(id) on delete set null,
  -- La candidature ou le match concerné. Volontairement SANS clé étrangère :
  -- un journal de pannes doit survivre à la suppression de son objet, sinon on
  -- perd l'historique au moment où l'on cherche à comprendre.
  entity_id  uuid,
  detail     text,
  created_at timestamptz not null default now(),

  constraint ai_redaction_cause_check
    check (cause in ('plafond', 'modele_indisponible', 'reponse_illisible')),
  constraint ai_redaction_surface_check
    check (surface in ('candidature', 'pitch'))
);

create index if not exists ai_redaction_failures_mois_idx
  on public.ai_redaction_failures (created_at desc);

alter table public.ai_redaction_failures enable row level security;
revoke all on table public.ai_redaction_failures from public, anon, authenticated;
grant all on table public.ai_redaction_failures to service_role;

comment on table public.ai_redaction_failures is
  'Journal des resumes qui n ont PAS pu etre ecrits, avec leur cause. Ce n est ni '
  'une file de moderation ni une file de rejeu : aucun texte n y est stocke, et '
  'rien ne s y valide. Il rend visible ce qui manque — sans lui, le jour ou plus '
  'aucun resume n est produit, personne ne le voit.';


-- ═══ COMBIEN, ET POURQUOI ═══════════════════════════════════════════════════
-- Les trois causes RESTENT DISTINCTES jusqu'à l'affichage : les additionner ici
-- reproduirait exactement le compteur unique qu'on remplace.
create or replace function public.redaction_failure_health(
  p_depuis interval default interval '30 days'
) returns table (
    cause               text,
    surface             text,
    pannes              bigint,
    derniere            timestamptz
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select f.cause, f.surface, count(*), max(f.created_at)
    from public.ai_redaction_failures f
   where f.created_at > now() - p_depuis
   group by f.cause, f.surface
   order by count(*) desc;
$fn$;

revoke all on function public.redaction_failure_health(interval) from public, anon, authenticated;
grant execute on function public.redaction_failure_health(interval) to service_role;
