-- ════════════════════════════════════════════════════════════════════════════
--  CONSERVATION DU GRAND LIVRE : LES PROPOSITIONS LÉGALES, EN BASE, ET LE BOUTON QUI LES APPLIQUE (ARRÊT 22).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement (§G.4) — une table et une fonction NOUVELLES, que seul le code nouveau lit.
--
--  LA DÉCISION DE YOUSSEF (01/10/2026) : par famille, « Ces écritures sont gardées X mois, puis effacées. La loi impose
--  au moins Y mois », avec la référence légale proposée et un bouton pour l'appliquer. AUCUNE VALEUR DANS LE CODE.
--
--  LA CONTRADICTION, ET SA RÉSOLUTION (docs/reprise.md, ARRÊT 22 ④) : le nombre proposé vivait dans les TRADUCTIONS
--  (« 60 mois »), donc dans le code. Il passe ICI, dans une table de PROPOSITIONS, distincte de la table des valeurs
--  APPLIQUÉES (`grand_livre_conservation`), qui reste née vide (règle du 28/09/2026) : rien ne s'efface tant que
--  l'administrateur n'a pas appliqué une proposition ou saisi ses valeurs — et ce geste s'écrit au grand livre.
--  Les traductions ne gardent que le TEXTE de la référence (l'article de loi), sans nombre.
--
--  ⚠️ CE SONT DES PROPOSITIONS, NON VÉRIFIÉES PAR UN JURISTE. L'écran le dit. `plancher_mois` est la durée minimale
--  qu'un texte IMPOSE (0 : aucun texte trouvé) ; `conservation_mois` la durée proposée (NULL : aucune proposition —
--  l'administrateur choisit).
--  Colonnes lues dans les migrations (§G.10) : grand_livre_conservation (famille PK, conservation_mois 1..1200 ou
--  NULL, plancher_mois 0..1200 ou NULL, conservation >= plancher, famille journal sans conservation).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.grand_livre_conservation_proposee (
  famille           text primary key references public.grand_livre_conservation(famille),
  plancher_mois     integer not null,
  conservation_mois integer,
  constraint gl_conservation_proposee_plancher check (plancher_mois between 0 and 1200),
  constraint gl_conservation_proposee_duree check (conservation_mois is null or conservation_mois between 1 and 1200),
  constraint gl_conservation_proposee_au_dessus check (conservation_mois is null or conservation_mois >= plancher_mois),
  constraint gl_conservation_proposee_journal check (famille <> 'journal')
);
alter table public.grand_livre_conservation_proposee enable row level security;
revoke all on public.grand_livre_conservation_proposee from public, anon, authenticated;
grant select on public.grand_livre_conservation_proposee to service_role;
comment on table public.grand_livre_conservation_proposee is
  'Propositions de conservation par famille du grand livre (plancher impose par un texte, duree proposee). NON VERIFIEES par un juriste ; elles ne s appliquent que par le geste de l administrateur.';

-- Les propositions — reprises des références affichées jusqu'ici (messages, `reference.<famille>`), sans en changer
-- une valeur : commerce (Code de commerce L123-22, 10 ans), compte (minimum strict : 1 an — décret 2021-1362 ; durée
-- proposée : la prescription de 5 ans, Code civil 2224), organisation (5 ans), rgpd (5 ans, par prudence),
-- administration et refus (CNIL, 2021-122 : 6 mois à 1 an — une recommandation, pas une obligation), candidature
-- (Code du travail L1134-5 : 5 ans). Les familles sans texte trouvé : aucun minimum, aucune durée proposée.
insert into public.grand_livre_conservation_proposee (famille, plancher_mois, conservation_mois) values
  ('commerce',       120, 120),
  ('compte',          12,  60),
  ('organisation',     0,  60),
  ('rgpd',             0,  60),
  ('administration',   0,  12),
  ('refus',            0,  12),
  ('candidature',      0,  60),
  ('annonce',          0, null),
  ('profil',           0, null),
  ('recherche',        0, null),
  ('devoilement',      0, null),
  ('messagerie',       0, null)
on conflict (famille) do nothing;


-- ── LE BOUTON « APPLIQUER LA PROPOSITION » ──
--  Une seule écriture du réglage : par `regler_conservation_journal()` (son écrivain unique, qui refuse les valeurs
--  incohérentes et ne journalise que s'il y a changement). La durée : la proposition, sinon la durée déjà saisie ;
--  jamais sous le minimum proposé.
create or replace function public.appliquer_proposition_conservation(
  p_piece     uuid,
  p_acteur_id uuid,
  p_famille   text
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_prop record;
  v_cour record;
  v_duree integer;
begin
  select p.plancher_mois, p.conservation_mois into v_prop
    from public.grand_livre_conservation_proposee p where p.famille = p_famille;
  if not found then
    return jsonb_build_object('issue', 'sans_proposition');
  end if;
  select c.conservation_mois into v_cour from public.grand_livre_conservation c where c.famille = p_famille;
  v_duree := coalesce(v_prop.conservation_mois, v_cour.conservation_mois);
  if v_duree is not null and v_duree < v_prop.plancher_mois then
    v_duree := greatest(v_prop.plancher_mois, 1);
  end if;
  return public.regler_conservation_journal(p_piece, p_acteur_id, p_famille, v_duree, v_prop.plancher_mois);
end;
$fn$;
revoke all on function public.appliquer_proposition_conservation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.appliquer_proposition_conservation(uuid, uuid, text) to service_role;


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
begin
  if (select count(*) from public.grand_livre_conservation_proposee) <> 12 then
    raise exception 'postcondition NON TENUE : douze propositions attendues (toutes les familles sauf le journal)';
  end if;
  if has_function_privilege('authenticated', 'public.appliquer_proposition_conservation(uuid, uuid, text)', 'execute') then
    raise exception 'postcondition NON TENUE : appliquer_proposition_conservation ouverte au navigateur';
  end if;
  raise notice 'postcondition tenue : douze propositions, la fonction qui les applique fermee au navigateur ; le geste est prouve par tests/database/grand_livre/liste_validee.test.sql';
end
$post$;
