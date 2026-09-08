-- ─────────────────────────────────────────────────────────────────────────────
-- LE QUOTA D'ANALYSES DE CV CESSE D'ÊTRE ÉCRIT DANS LE CODE
--
-- « 3 analyses par 24 h » vivait en dur, et pas à un seul endroit : la constante
-- RATE_LIMIT était DUPLIQUÉE dans les deux routes d'analyse (freelance et CDI),
-- la fenêtre de 24 h était recalculée à la main dans chacune, et le chiffre 3
-- était RÉÉCRIT une troisième fois dans le texte du refus. Six écritures pour
-- un réglage. Le relever supposait un déploiement, et le relever à moitié —
-- une route sur deux — n'aurait rien signalé du tout.
--
-- ┌─ POURQUOI UN RÉGLAGE GLOBAL, ET NON UNE LIMITE AU CATALOGUE ─────────────┐
-- │ Le catalogue attache ses limites à une OFFRE, et une offre vit sur une   │
-- │ ORGANISATION. Or ce quota s'applique à des EXPERTS, qui n'ont pas        │
-- │ d'offre : le code aurait donc dû inventer une valeur pour « expert sans  │
-- │ organisation » — c'est-à-dire remettre en dur exactement la constante    │
-- │ qu'on retire ici.                                                        │
-- │                                                                          │
-- │ Et sur le fond : ce quota protège une DÉPENSE (l'API d'analyse), il ne   │
-- │ se vend pas. Sa famille existe déjà — `ai_spend_caps`, rangée en base    │
-- │ pour la même raison : un plafond qu'il faut redéployer pour relever      │
-- │ n'est pas un plafond, c'est un incident.                                 │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ GLOBAL, ET NON PAR ÉCOSYSTÈME ─────────────────────────────────────────┐
-- │ `matching_settings` est par écosystème parce que les seuils d'un moteur  │
-- │ de mise en relation dépendent du marché servi. Ici, la dépense protégée  │
-- │ est celle de Skilloria : un seul compte fournisseur, une seule facture.  │
-- │ Une ligne par écosystème laisserait croire à des budgets séparés qui     │
-- │ n'existent pas. Aucun écosystème n'est nommé nulle part : la règle       │
-- │ multi-écosystème est respectée, elle n'impose pas de tout cloisonner.    │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ AUCUN REPLI CODÉ EN DUR — MÊME DOCTRINE QUE matching_settings ──────────┐
-- │ Ligne absente ⇒ le code REFUSE et le dit (503 quota_config_missing). Il  │
-- │ ne retombe pas sur une valeur de secours : un repli invisible serait un  │
-- │ second réglage prenant la main sans que personne le sache — le défaut    │
-- │ même qu'on corrige. Une ligne absente veut dire que cette migration n'a  │
-- │ pas été appliquée, et cela doit s'entendre.                              │
-- └────────────────────────────────────────────────────────────────────────┘
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ LE RÉGLAGE ═════════════════════════════════════════════════════════════
-- La FENÊTRE est rangée à côté du NOMBRE, et non déduite du nom du réglage :
-- « 3 par 24 h » est un seul réglage à deux valeurs. Les séparer, c'est
-- permettre de changer l'une en croyant avoir changé l'autre.
create table if not exists public.ai_quotas (
  quota          text primary key,
  max_per_window integer not null,
  window_hours   integer not null,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.users(id) on delete set null,

  -- Liste FERMÉE : un quota inventé côté applicatif ne doit pas pouvoir
  -- s'insérer en silence et rester sans lecteur.
  constraint ai_quotas_quota_check  check (quota in ('cv_parsing')),
  -- Zéro interdit : un quota à zéro fermerait la fonctionnalité sans le dire.
  -- Pour la fermer, il y a le coupe-circuit ENABLE_AI_CV_PARSING, qui répond
  -- explicitement 503 ai_disabled.
  constraint ai_quotas_max_check    check (max_per_window >= 1),
  -- 720 h = 30 jours. Au-delà, ce n'est plus une fenêtre glissante anti-abus.
  constraint ai_quotas_window_check check (window_hours between 1 and 720)
);

comment on table public.ai_quotas is
  'Quotas anti-abus des fonctionnalites IA, ranges en base et NON dans le code. '
  'AUCUN repli code en dur cote applicatif : une ligne absente fait REFUSER la '
  'route, qui le dit (503 quota_config_missing). Un repli invisible serait un '
  'second reglage prenant la main sans que personne le sache.';

comment on column public.ai_quotas.window_hours is
  'La fenetre vit A COTE du nombre : "3 par 24 h" est un seul reglage a deux '
  'valeurs. Les separer permettrait de changer l une en croyant changer l autre.';

-- La valeur en vigueur au moment de la bascule : on RANGE l'existant, on ne le
-- change pas. Une migration qui en profite pour modifier un réglage produit
-- deux effets là où on en attendait un.
insert into public.ai_quotas (quota, max_per_window, window_hours)
values ('cv_parsing', 3, 24)
on conflict (quota) do nothing;

alter table public.ai_quotas enable row level security;
revoke all on table public.ai_quotas from public, anon, authenticated;
grant all on table public.ai_quotas to service_role;


-- ═══ VÉRIFICATION ═══════════════════════════════════════════════════════════
-- La migration se contrôle elle-même : sans la ligne 'cv_parsing', les deux
-- routes d'analyse refuseraient toute analyse de CV dès le déploiement suivant.
-- Mieux vaut échouer ici, sur la base, que là-bas, sur un candidat.
do $verif$
declare
  v_ligne public.ai_quotas%rowtype;
begin
  select * into v_ligne from public.ai_quotas where quota = 'cv_parsing';

  if not found then
    raise exception
      'Quota cv_parsing absent apres migration : les routes d analyse de CV refuseraient tout.';
  end if;

  if v_ligne.max_per_window < 1 or v_ligne.window_hours < 1 then
    raise exception
      'Quota cv_parsing incoherent : max=%, fenetre=%h.',
      v_ligne.max_per_window, v_ligne.window_hours;
  end if;
end
$verif$;
