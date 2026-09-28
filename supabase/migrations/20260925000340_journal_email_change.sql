-- ════════════════════════════════════════════════════════════════════════════
--  UN CHANGEMENT D'ADRESSE S'ÉCRIT AU GRAND LIVRE — LA DEMANDE, PAS LA BASCULE.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : indifférent — cette migration ne pose que la liste
--  blanche de `email_change` ; l'écrivain est TypeScript
--  (`lib/comptes/journal-compte.ts`, motif « journal après écriture, même
--  pièce » : l'adresse vit chez Supabase Auth, pas dans une table métier).
--  Rejouable.
--
--  `etape` N'EST PAS UN CHAMP DÉCORATIF. La route déclenche l'e-mail de
--  confirmation ; la bascule réelle a lieu quand la personne clique le lien.
--  Écrire « adresse changée » à la demande serait annoncer un fait qui n'est
--  pas arrivé — exactement §E.24. La ligne dit donc ce qui EST arrivé : une
--  demande, et une confirmation envoyée. Le jour où le retour du lien sera
--  branché, il écrira la même action avec `etape: 'confirme'`, et l'histoire
--  se lira dans le bon ordre.
--
--  L'ADRESSE — ni l'ancienne ni la nouvelle — n'entre jamais ici : la sonde le
--  vérifie, et la route ne l'écrivait déjà pas dans son audit.
-- ─────────────────────────────────────────────────────────────────────────────

update public.grand_livre_actions
   set cles_detail = array['etape']::text[]
 where code = 'email_change';


-- ── POSTCONDITION — ELLE S'EXÉCUTE (§E.67) ──────────────────────────────────
do $post$
declare
  v_cles text[];
  v_id   bigint;
begin
  select cles_detail into v_cles from public.grand_livre_actions where code = 'email_change';
  if v_cles is null or not (v_cles @> array['etape']::text[]) then
    raise exception 'postcondition NON TENUE : la liste blanche de email_change est incomplete [vu : %]', v_cles;
  end if;
  -- SONDE — la forme exacte que le module écrit est ACCEPTÉE, puis annulée.
  begin
    v_id := public.journaliser(gen_random_uuid(), 'email_change', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'users', gen_random_uuid(),
                               jsonb_build_object('etape', 'demande'),
                               null::uuid, null::numeric, null::text);
    if v_id is null then
      raise exception 'postcondition NON TENUE : email_change n a pas ete ecrite';
    end if;
    raise exception 'SONDE_ANNULEE';
  exception when others then
    if sqlerrm <> 'SONDE_ANNULEE' then
      raise;
    end if;
  end;
  -- SONDE — l'ADRESSE est REFUSÉE, sous n'importe quel nom de clé connu.
  begin
    perform public.journaliser(gen_random_uuid(), 'email_change', 'reussi', 'utilisateur',
                               gen_random_uuid(), 'client', null::uuid, 'users', gen_random_uuid(),
                               '{"etape":"demande","new_email":"qui@exemple.fr"}'::jsonb,
                               null::uuid, null::numeric, null::text);
    raise exception 'postcondition NON TENUE : une adresse est entree dans email_change';
  exception when sqlstate 'GL004' then
    null;
  end;
  raise notice 'postcondition tenue : email_change — liste blanche posee, l etape acceptee, l adresse refusee ; le geste est ecrit par le TypeScript (lib/comptes/journal-compte.ts) sous journaliser(), sa forme tenue par scripts/diag-grand-livre.mjs';
end
$post$;
