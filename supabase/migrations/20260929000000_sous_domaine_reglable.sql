-- ════════════════════════════════════════════════════════════════════════════
--  LE SOUS-DOMAINE D'UN ÉCOSYSTÈME EST UN RÉGLAGE — il se modifie dans l'écran
--  Écosystèmes ; l'identifiant technique (`domains.id`) ne change jamais.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : AVANT le déploiement. N'ajoute qu'une contrainte, deux
--  commentaires et trois clés à une liste blanche ; l'écran qui modifie arrive
--  avec le déploiement, et le code en ligne n'écrit rien que la contrainte refuse
--  (la création valide déjà la même forme). Rejouable.
--
--  L'ÉTAT (lu dans le code et les migrations, 29/09/2026) : `domains.slug` EST le
--  sous-domaine — unique (`domains_slug_key`), lu À CHAQUE REQUÊTE par sa valeur
--  (l'adresse → l'écosystème), jamais recopié comme clé dans une autre table :
--  toutes les références passent par `domains.id`. La clé technique existe donc
--  déjà et ne change pas ; le sous-domaine n'était « non modifiable » que par une
--  décision d'écran, levée par Youssef le 29/09/2026.
--
--  CE QUE CETTE MIGRATION AJOUTE :
--   ① LA FORME, EN BASE (la sécurité en base, jamais seulement dans l'écran) :
--      `domains_sous_domaine_forme` — une étiquette DNS : minuscules, chiffres,
--      tirets, 1 à 63 caractères, ni tiret en tête ni en fin. La même règle que
--      `SLUG_ECOSYSTEME` (lib/subdomain.ts) et `SLUG_RE` (lib/ecosystem-url.ts) ;
--      `diag-sous-domaine` prouve que les trois disent la même chose.
--      VALIDÉE à la pose (jamais `not valid`, §E.64) : une ligne existante hors
--      forme ARRÊTE la migration — la requête de staging la compte avant le push.
--      L'unicité existe déjà (`domains_slug_key`).
--   ② LA TRACE : `ecosysteme_modifie` accepte `sous_domaine.avant` et
--      `sous_domaine.apres` — deux identifiants d'adresse, pas une donnée
--      personnelle, comme le `slug` que porte déjà `ecosysteme_cree`.
--   ③ LE SENS, DANS LE SCHÉMA : un commentaire sur `domains.id` et `domains.slug`.
--
--  LA LANGUE DU CODE : celle du grand livre existant (français, §D.26).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.domains drop constraint if exists domains_sous_domaine_forme;
alter table public.domains
  add constraint domains_sous_domaine_forme
  check (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$');

comment on column public.domains.id is
  'Identifiant technique de l''écosystème : ne change jamais. Toute référence (users, organisations, publications, grand livre…) passe par lui.';
comment on column public.domains.slug is
  'Sous-domaine de l''écosystème (<sous-domaine>.<racine>) : un RÉGLAGE, modifiable dans l''écran Écosystèmes. Étiquette DNS, unique. Lu à chaque requête par sa valeur ; jamais recopié comme clé.';

update public.grand_livre_actions
   set cles_detail = array['operation', 'champs', 'champs[]', 'traductions', 'traductions[]', 'visuel',
                           'sous_domaine', 'sous_domaine.avant', 'sous_domaine.apres']::text[]
 where code = 'ecosysteme_modifie';


-- ── POSTCONDITION — LA STRUCTURE (§E.77) ─────────────────────────────────────
do $post$
declare
  v_def  text;
  v_ok   boolean;
  v_cles text[];
begin
  select pg_get_constraintdef(c.oid), c.convalidated into v_def, v_ok
    from pg_constraint c
   where c.conrelid = 'public.domains'::regclass and c.conname = 'domains_sous_domaine_forme';
  if v_def is null then
    raise exception 'postcondition NON TENUE : domains_sous_domaine_forme absente';
  end if;
  if not v_ok then
    raise exception 'postcondition NON TENUE : domains_sous_domaine_forme posée sans être validée';
  end if;
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = 'public.domains'::regclass and c.conname = 'domains_slug_key' and c.contype = 'u') then
    raise exception 'postcondition NON TENUE : l''unicité du sous-domaine (domains_slug_key) a disparu';
  end if;
  select a.cles_detail into v_cles from public.grand_livre_actions a where a.code = 'ecosysteme_modifie';
  if v_cles is distinct from array['operation', 'champs', 'champs[]', 'traductions', 'traductions[]', 'visuel',
                                   'sous_domaine', 'sous_domaine.avant', 'sous_domaine.apres']::text[] then
    raise exception 'postcondition NON TENUE : liste blanche de ecosysteme_modifie [%]', v_cles;
  end if;
  raise notice 'postcondition tenue : forme du sous-domaine validée en base, unicité présente, ecosysteme_modifie porte avant/après ; les refus et la trace sont prouvés par tests/database/grand_livre/sous_domaine.test.sql';
end
$post$;
