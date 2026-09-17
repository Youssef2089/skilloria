-- ═══════════════════════════════════════════════════════════════════════════
-- LA TROISIÈME DURÉE REJOINT LES DEUX AUTRES
--
-- ━━━ LE DÉFAUT QU'ON FERME ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--   Une invitation d'organisation expire au bout de **7 jours**. Ce nombre
--   vivait EN DUR, et **dans DEUX fichiers** :
--     app/api/me/organisation/invitations/route.ts       (création)
--     app/api/me/organisation/invitations/[id]/route.ts  (renvoi)
--
--   Deux fichiers qui portent le même nombre divergeront un jour. Ce n'est pas
--   une crainte de principe : c'est exactement ce qui vient d'être trouvé sur
--   les trois parcours de saisie de téléphone, et ce que
--   `lib/org-target-role.ts` a fermé pour le mappage des offres — six copies,
--   dont plusieurs avaient déjà dérivé.
--
--   Le contrôle du lot précédent l'avait RECENSÉE sans la juger : c'était la
--   bonne décision pour ne pas rester rouge en permanence sur un autre sujet,
--   mais elle restait un défaut. Il est traité ici.
--
-- ━━━ ET ELLE N'EST PAS RÉTROACTIVE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--   `organization_invitations.expires_at` est **ÉCRIT** à la création et
--   RÉÉCRIT au renvoi. Une invitation déjà envoyée garde donc sa date : régler
--   la durée à 3 jours ne raccourcit AUCUNE invitation en circulation.
--
--   C'est le même comportement que la fenêtre d'échange, et pour la même
--   raison — une date écrite ne se recalcule pas — et l'inverse de la vie
--   d'une annonce, qui se recalcule à chaque lecture. L'écran dit les trois.
--
--   Conséquence : **aucune garde de comptage** ici. Il n'y a rien à compter,
--   parce qu'il n'y a rien qui bascule.
-- ═══════════════════════════════════════════════════════════════════════════

-- AJOUTÉE NULLABLE, REMPLIE, PUIS RENDUE OBLIGATOIRE — et sans valeur par
-- défaut à l'arrivée. Un `default 7` laissé en place serait une seconde source
-- de vérité : la ligne existe déjà, personne n'insérera plus jamais dans cette
-- table, et un défaut n'y servirait qu'à masquer un oubli.
alter table public.duree_reglages
  add column if not exists invitation_jours integer;

update public.duree_reglages
   set invitation_jours = 7
 where invitation_jours is null;

alter table public.duree_reglages
  alter column invitation_jours set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'duree_invitation_check') then
    alter table public.duree_reglages
      add constraint duree_invitation_check check (invitation_jours between 1 and 365);
  end if;
end
$$;

comment on column public.duree_reglages.invitation_jours is
  'Duree de validite d''une invitation d''organisation. CHANGEMENT NON retroactif : '
  'organization_invitations.expires_at est ECRIT a la creation et au renvoi.';


-- ═══ ET LES TROIS TÂCHES QUE LE CATALOGUE NE NOMMAIT PAS ════════════════════
--
--  DÉFAUT VU PENDANT CE LOT, TRAITÉ DANS CE LOT.
--  `cron_job_catalog` existe pour qu'aucune tâche planifiée ne soit anonyme —
--  une tâche a déjà tourné des mois sans que personne sache ce qu'elle faisait.
--  Il en nommait **CINQ sur HUIT** : les trois tâches du moteur, ajoutées
--  après, n'y figuraient pas.
--
--  Elles n'étaient pas cachées — `admin_cron_jobs_overview()` fait un LEFT JOIN
--  et les rejette en fin de liste — mais elles paraissaient à l'écran **sans
--  libellé, sans description et sans dépendances**. Visibles, et muettes.
--  Le catalogue porte des CLÉS de traduction, jamais du texte : l'écran est
--  servi en quatre langues. Les clés suivent la convention des cinq lignes
--  existantes (`jobs.<nom>.label` / `.description`), et vivent dans
--  `admin_back_office.cron.jobs`.
--
--  `criticality = 'technical'` pour les trois : aucune n'est portée par une
--  obligation légale — ce que `legal` désigne, et ce qui exigerait un
--  `legal_basis_key` (contrainte en base). Les confondre ferait passer une
--  purge RGPD et une reprise de run pour la même chose.
insert into public.cron_job_catalog
  (job_name, label_key, description_key, criticality, writes_run_log, display_order)
values
  ('matching_retry_trigger',
   'jobs.matching_retry.label', 'jobs.matching_retry.description',
   'technical', true, 60),
  ('expert_relance_trigger',
   'jobs.expert_relance.label', 'jobs.expert_relance.description',
   'technical', true, 61),
  ('matching_notes_partielles_purge',
   'jobs.notes_partielles_purge.label', 'jobs.notes_partielles_purge.description',
   'technical', false, 62)
on conflict (job_name) do nothing;
