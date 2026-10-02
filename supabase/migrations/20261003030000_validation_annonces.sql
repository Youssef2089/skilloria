-- ════════════════════════════════════════════════════════════════════════════
--  LA VALIDATION DES ANNONCES PAR L'ADMINISTRATEUR — VALIDER PAR LE MÊME MÉCANISME QU'UNE PUBLICATION DIRECTE,
--  REFUSER AVEC UN MOTIF, ET LE GRAND LIVRE DES DEUX (lot S3 « validation des annonces », 03/10/2026).
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement (§G.4) — rien de ce que le code EN LIGNE écrit n'est refusé (§E.72, §E.91) :
--   · une action NOUVELLE dans la liste fermée (`annonce_refusee`) et une fonction NOUVELLE (`refuser_annonce`), que
--     seul le code du lot appelle ;
--   · une clé AJOUTÉE (`voie`) aux listes blanches de `annonce_publiee` et `sous_traitance_publiee` — on n'en retire
--     aucune ;
--   · `publier_annonce()` REDÉFINIE, SIGNATURE INCHANGÉE. Le code en ligne l'appelle avec `p_statuts_admis = ['draft']`
--     (app/api/publications/[id]/publish) : sur ce chemin le corps fait exactement ce qu'il faisait — même transition,
--     même verdict écrit, même ligne, plus la clé `voie = 'automatique'`. Les DEUX refus nouveaux ne visent que la
--     sortie de `pending_review`, que le code en ligne ne demande jamais (son PUBLISHABLE_FROM est `['draft']`).
--  Rejouable. Plage S3 du 03/10/2026 (`03xxxx`). Colonnes lues dans les migrations (§G.10) :
--   · publications (baseline) : status ∈ draft/pending_review/published/suspended/expired/archived/rejected
--     (`publications_status_check`) ; verified_by → users ON DELETE SET NULL ; verified_at, review_reason libres ;
--     `publications_publiee_requiert_zones_check` (une annonce publiée a au moins une zone) ; déclencheurs
--     `trg_publications_updated_at` et `trg_publications_work_zones` (aucun ne refuse) ;
--   · grand_livre_actions (socle) : code ^[a-z][a-z0-9_]{2,60}$, famille dans la liste fermée, statut_impose,
--     libelle_key NOT NULL, cles_detail, retiree_le.
--
--  ① LE DÉFAUT (vu par Youssef) : un besoin de sous-traitance noté 5/10 par la vérification automatique restait « En
--    attente de validation » POUR TOUJOURS — l'administration n'avait aucune entrée pour le trancher. `publier_annonce()`
--    le disait elle-même : « sa mise en ligne ultérieure, si elle existe un jour, passera par ici ».
--
--  ② VALIDER = `publier_annonce()`, PAS UNE SECONDE FONCTION. `annonce_publiee` a UN écrivain (§D.26, `diag-grand-livre`) ;
--    une `valider_annonce()` qui écrirait la même action en ferait deux. La fonction DÉRIVE la voie de l'état d'avant,
--    relu SOUS VERROU — jamais d'un paramètre qu'un appelant pourrait inventer :
--      · `draft` → `pending_review` | `published` : la voie AUTOMATIQUE (inchangée) ;
--      · `pending_review` → `published` : la voie ADMINISTRATEUR. Seul un administrateur l'emprunte (origine
--        `administrateur`, acteur `admin`, sinon 42501) : c'est l'anti-relance tenue EN BASE — l'auteur d'une annonce
--        en revue ne peut pas la resoumettre au contrôle automatique, ni par la route (déjà refusé) ni par la RPC.
--        Le verdict de la machine (note, méthode, signalements) est CONSERVÉ : c'est pourquoi l'annonce était en
--        revue, et la fiche le montre encore après la décision ; ses trois paramètres doivent donc être nuls (22023).
--        `verified_by` / `verified_at` disent qui a tranché, et quand.
--    La ligne porte `voie` : 'automatique' ou 'administrateur'.
--
--  ③ REFUSER = `refuser_annonce()`, l'écrivain UNIQUE de l'action nouvelle `annonce_refusee` (famille annonce),
--    validée par Youssef. `pending_review` → `rejected`, sous la même garde administrateur ; le MOTIF est obligatoire et
--    vit sur la ligne métier (`review_reason`), jamais au journal (texte libre, §D.26) — la ligne dit le type, l'organisation
--    et la note de la vérification automatique. Rejeu, ou annonce qui n'est plus en revue : null, rien n'est écrit.
--    La place active n'est pas en jeu : une annonce en revue n'en retient aucune (la route de publication la rend).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── ① L'ACTION NOUVELLE, ET LA CLÉ AJOUTÉE ───────────────────────────────────
insert into public.grand_livre_actions (code, famille, statut_impose, libelle_key) values
  ('annonce_refusee', 'annonce', 'reussi', 'journal.actions.annonce_refusee')
on conflict (code) do nothing;

-- `nb_signalements` (contre-relecture de l'ARRÊT 28, point B) : le NOMBRE de signalements du verdict de la machine — un
-- compte, jamais leur texte. Il dit au journal ce que la liste lit sur l'annonce : une note 0 SANS aucun signalement est
-- une vérification qui n'a pas jugé (« non jugée », §E.114) ; une note 0 AVEC des signalements est un vrai 0/10.
update public.grand_livre_actions
   set cles_detail = array['type', 'organization_id', 'verification_score', 'nb_signalements']::text[]
 where code = 'annonce_refusee';

update public.grand_livre_actions
   set cles_detail = array['type', 'organization_id', 'verification_method', 'verification_score', 'published_at', 'voie', 'nb_signalements']::text[]
 where code = 'annonce_publiee';

update public.grand_livre_actions
   set cles_detail = array['type', 'organization_id', 'verification_method', 'verification_score', 'published_at', 'voie', 'nb_signalements']::text[]
 where code = 'sous_traitance_publiee';


-- ── ① bis LA DATE DE SOUMISSION (relecture de l'ARRÊT 28, point 8) ───────────
--  La fiche disait « soumise le » avec `updated_at` — la date de la DERNIÈRE écriture (une place réservée, une décision,
--  une modification), pas celle de la soumission. Une colonne la porte désormais, posée par la voie AUTOMATIQUE de
--  publier_annonce() (l'auteur soumet : `draft` → verdict) et jamais réécrite par la voie administrateur. Nullable : le
--  code en ligne ne la nomme pas (rien de ce qu'il écrit n'est refusé). Les annonces déjà soumises la reçoivent de la
--  trace d'audit de leur DERNIÈRE soumission (`publication_submitted_review` / `publication_published`, best-effort,
--  §E.68) ; sans trace, elle reste vide et la fiche ne dit pas de date plutôt qu'une fausse.
alter table public.publications add column if not exists soumise_le timestamptz;
comment on column public.publications.soumise_le is
  'Quand l''auteur a soumis l''annonce au contrôle (la voie automatique de publier_annonce, draft → verdict) ; jamais réécrite par la voie administrateur. Lue par la fiche admin (« soumise le »).';

-- La reprise des annonces déjà soumises — une reprise de données VOULUE, dans son propre bloc (§G.4 ter).
do $reprise$
declare
  v_n integer;
begin
  update public.publications p
     set soumise_le = a.quand
    from (select l.entity_id, max(l.created_at) as quand
            from public.audit_logs l
           where l.entity_type = 'publication'
             and l.action in ('publication_submitted_review', 'publication_published')
           group by l.entity_id) a
   where a.entity_id = p.id
     and p.soumise_le is null
     and p.status <> 'draft';
  get diagnostics v_n = row_count;
  raise notice 'date de soumission : % annonce(s) reprise(s) depuis la trace d''audit (les autres restent sans date)', v_n;
end
$reprise$;

-- ── ② LA MISE EN LIGNE : DEUX VOIES, UN ÉCRIVAIN ─────────────────────────────
create or replace function public.publier_annonce(
  p_piece            uuid,
  p_piece_origine    uuid,
  p_origine          text,
  p_acteur_id        uuid,
  p_acteur_type      text,
  p_publication_id   uuid,
  p_domain_id        uuid,
  p_organization_id  uuid,
  p_statuts_admis    text[],
  p_verdict          text,
  p_score            numeric,
  p_method           text,
  p_data             jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_avant     text;
  v_par_admin boolean;
  v_p         record;
  v_n         bigint;
begin
  if p_piece is null then
    raise exception 'publier_annonce : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_verdict not in ('published', 'pending_review') then
    raise exception 'publier_annonce : verdict inconnu « % »', p_verdict using errcode = '22023';
  end if;

  -- L'état d'avant, SOUS VERROU : la transition est rejouée (statut admis, écosystème, organisation) et deux
  -- décisions simultanées se sérialisent — la seconde lit un statut qui n'est plus admis, et rend null.
  select p.status into v_avant
    from public.publications p
   where p.id = p_publication_id
     and p.domain_id = p_domain_id
     and p.organization_id = p_organization_id
     for update;
  if not found or not (v_avant = any (p_statuts_admis)) then
    return null;
  end if;

  v_par_admin := (v_avant = 'pending_review');
  if v_par_admin then
    if p_origine is distinct from 'administrateur' or p_acteur_type is distinct from 'admin' or p_acteur_id is null then
      raise exception 'publier_annonce : une annonce en revue ne sort que par un administrateur' using errcode = '42501';
    end if;
    if p_verdict <> 'published' then
      raise exception 'publier_annonce : la voie administrateur ne fait que mettre en ligne' using errcode = '22023';
    end if;
    if p_score is not null or p_method is not null or p_data is not null then
      raise exception 'publier_annonce : le verdict de la machine se conserve sur la voie administrateur' using errcode = '22023';
    end if;
  end if;

  update public.publications p
     set status              = p_verdict,
         verification_score  = case when v_par_admin then p.verification_score  else p_score  end,
         verification_method = case when v_par_admin then p.verification_method else p_method end,
         verification_data   = case when v_par_admin then p.verification_data   else p_data   end,
         verified_by         = case when v_par_admin then p_acteur_id else p.verified_by end,
         verified_at         = case when v_par_admin then now() else p.verified_at end,
         review_reason       = case when v_par_admin then null else p.review_reason end,
         soumise_le          = case when v_par_admin then p.soumise_le else now() end,
         published_at        = case when p_verdict = 'published' then now() else p.published_at end
   where p.id = p_publication_id
  returning p.id, p.type, p.status, p.published_at, p.verification_method, p.verification_score,
            (select count(*) from jsonb_array_elements(case when jsonb_typeof(p.verification_data -> 'flags') = 'array'
                                                            then p.verification_data -> 'flags' else '[]'::jsonb end) f
              where jsonb_typeof(f) = 'string') as nb_signalements
       into v_p;
  -- La ligne est VERROUILLÉE et relue juste au-dessus : zéro ligne touchée ici n'est pas un rejeu, c'est une anomalie
  -- (une politique, un déclencheur qui annule) — elle LÈVE (EC001, §E.74), elle ne rend pas null.
  get diagnostics v_n = row_count;
  perform public.exiger_ecriture(v_n, 'publier_annonce : l''annonce verrouillee n''a pas ete ecrite');

  if p_verdict = 'published' then
    perform public.journaliser(
      p_piece,
      case when v_p.type = 'sous_traitance' then 'sous_traitance_publiee' else 'annonce_publiee' end,
      'reussi', p_origine,
      p_acteur_id, p_acteur_type, p_domain_id,
      'publications', v_p.id,
      jsonb_build_object(
        'type', v_p.type,
        'organization_id', p_organization_id,
        'verification_method', v_p.verification_method,
        'verification_score', v_p.verification_score,
        'published_at', v_p.published_at,
        'voie', case when v_par_admin then 'administrateur' else 'automatique' end,
        'nb_signalements', v_p.nb_signalements),
      p_piece_origine, null::numeric, null::text);
  end if;

  return jsonb_build_object('id', v_p.id, 'status', v_p.status, 'published_at', v_p.published_at,
                            'voie', case when v_par_admin then 'administrateur' else 'automatique' end);
end;
$fn$;
-- Aucun droit n'est repris ni redonné : `create or replace` GARDE ceux de la fonction (fermée au navigateur depuis
-- `journal_annonce_publiee`, service_role seul) — la postcondition le vérifie.


-- ── ③ LE REFUS, AVEC SON MOTIF ───────────────────────────────────────────────
create or replace function public.refuser_annonce(
  p_piece            uuid,
  p_piece_origine    uuid,
  p_origine          text,
  p_acteur_id        uuid,
  p_acteur_type      text,
  p_publication_id   uuid,
  p_motif            text
) returns jsonb
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_motif text := btrim(coalesce(p_motif, ''));
  v_p     record;
begin
  if p_piece is null then
    raise exception 'refuser_annonce : la piece est obligatoire' using errcode = 'GL002';
  end if;
  if p_origine is distinct from 'administrateur' or p_acteur_type is distinct from 'admin' or p_acteur_id is null then
    raise exception 'refuser_annonce : seul un administrateur refuse une annonce' using errcode = '42501';
  end if;
  if v_motif = '' then
    raise exception 'refuser_annonce : le motif est obligatoire' using errcode = '22023';
  end if;

  -- La transition est la garde : seule une annonce EN REVUE se refuse ; l'UPDATE verrouille la ligne, et une
  -- décision concurrente (validée, ou déjà refusée) ne trouve plus rien.
  update public.publications p
     set status        = 'rejected',
         verified_by   = p_acteur_id,
         verified_at   = now(),
         review_reason = v_motif
   where p.id = p_publication_id
     and p.status = 'pending_review'
  returning p.id, p.type, p.domain_id, p.organization_id, p.verification_score, p.verified_at,
            (select count(*) from jsonb_array_elements(case when jsonb_typeof(p.verification_data -> 'flags') = 'array'
                                                            then p.verification_data -> 'flags' else '[]'::jsonb end) f
              where jsonb_typeof(f) = 'string') as nb_signalements
       into v_p;
  if not found then
    return null;
  end if;

  perform public.journaliser(
    p_piece, 'annonce_refusee', 'reussi', p_origine,
    p_acteur_id, p_acteur_type, v_p.domain_id,
    'publications', v_p.id,
    jsonb_build_object(
      'type', v_p.type,
      'organization_id', v_p.organization_id,
      'verification_score', v_p.verification_score,
      'nb_signalements', v_p.nb_signalements),
    p_piece_origine, null::numeric, null::text);

  return jsonb_build_object('id', v_p.id, 'status', 'rejected', 'verified_at', v_p.verified_at);
end;
$fn$;

revoke all on function public.refuser_annonce(uuid, uuid, text, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.refuser_annonce(uuid, uuid, text, uuid, text, uuid, text)
  to service_role;


-- ── POSTCONDITION — LA STRUCTURE ICI, LE COMPORTEMENT PAR LES TESTS (§E.77) ───────────
do $post$
-- Aucune sonde ne lit ni n'écrit une ligne réelle. Le geste — la voie administrateur (mise en ligne, verdict conservé,
-- qui et quand, la ligne avec sa voie), la garde administrateur des deux fonctions, le motif obligatoire, le rejeu nul,
-- la face sous-traitance — est prouvé par supabase/tests/database/grand_livre/annonce_refusee.test.sql.
declare
  v_cles text[];
begin
  if not exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = 'publications' and c.column_name = 'soumise_le') then
    raise exception 'postcondition NON TENUE : publications.soumise_le manque';
  end if;
  if to_regprocedure('public.publier_annonce(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[], text, numeric, text, jsonb)') is null then
    raise exception 'postcondition NON TENUE : publier_annonce manque ou a change de signature';
  end if;
  if to_regprocedure('public.refuser_annonce(uuid, uuid, text, uuid, text, uuid, text)') is null then
    raise exception 'postcondition NON TENUE : refuser_annonce manque ou a change de signature';
  end if;
  if not exists (select 1 from public.grand_livre_actions where code = 'annonce_refusee' and famille = 'annonce'
                    and statut_impose = 'reussi' and retiree_le is null
                    and cles_detail = array['type', 'organization_id', 'verification_score', 'nb_signalements']::text[]) then
    raise exception 'postcondition NON TENUE : annonce_refusee absente ou mal declaree';
  end if;
  for v_cles in select g.cles_detail from public.grand_livre_actions g where g.code in ('annonce_publiee', 'sous_traitance_publiee') loop
    if v_cles is null or not (v_cles @> array['type', 'organization_id', 'verification_method', 'verification_score', 'published_at', 'voie', 'nb_signalements']::text[]) then
      raise exception 'postcondition NON TENUE : la liste blanche d''une mise en ligne ne porte pas la voie [vu : %]', v_cles;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.refuser_annonce(uuid, uuid, text, uuid, text, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.publier_annonce(uuid, uuid, text, uuid, text, uuid, uuid, uuid, text[], text, numeric, text, jsonb)', 'execute') then
    raise exception 'postcondition NON TENUE : refuser_annonce ou publier_annonce est ouverte au navigateur';
  end if;
  raise notice 'postcondition tenue : annonce_refusee declaree, la voie dans les deux listes blanches, publier_annonce et refuser_annonce fermees au navigateur ; le geste est prouve par tests/database/grand_livre/annonce_refusee.test.sql';
end
$post$;
