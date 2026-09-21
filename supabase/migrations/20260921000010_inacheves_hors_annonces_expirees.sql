-- ════════════════════════════════════════════════════════════════════════════
--  UNE ANNONCE EXPIRÉE NE PEUT PLUS ÊTRE MISE EN RELATION — ELLE DOIT DONC
--  CESSER DE LE RÉCLAMER.
-- ════════════════════════════════════════════════════════════════════════════
--
--  ORDRE DE PASSAGE : INDIFFÉRENT.
--    Cette migration ne touche AUCUNE donnée : elle remplace le corps d'une
--    fonction de lecture. Rien ne dépend de son ordre par rapport au
--    déploiement du code.
--
-- ┌─ LE CAS MESURÉ, LE 21/09/2026 ────────────────────────────────────────────┐
-- │ L'écran de supervision affichait, en BLOQUANT :                            │
-- │   « 6 annonces publiées n'ont JAMAIS été mises en relation », depuis le    │
-- │   4 juin 2026.                                                             │
-- │                                                                            │
-- │ LA CAUSE N'ÉTAIT PAS UNE PANNE, ET C'EST TOUT LE SUJET.                    │
-- │   Les six ont été publiées entre le 4 juin et le 28 juillet 2026. La       │
-- │   colonne `matching_attempted_at` n'existait pas : elle est créée par      │
-- │   `…_reprise_apres_couperet` (1er septembre 2026), et l'écriture qui la    │
-- │   renseigne — `marquerTentative` — a été posée deux jours plus tard.       │
-- │                                                                            │
-- │   Leur `matching_attempted_at` est donc NULL parce que PERSONNE NE         │
-- │   POUVAIT L'ÉCRIRE, pas parce qu'un run a échoué. La vue lisait une        │
-- │   absence d'instrumentation comme une absence de travail.                  │
-- │                                                                            │
-- │ ET LES SIX SONT EXPIRÉES DEPUIS DES MOIS. Aucune n'est notable : le        │
-- │   moteur ne classe que `status = 'published'` ET non expirées. Le signal   │
-- │   réclamait donc une action QUI N'EXISTE PAS.                              │
-- └───────────────────────────────────────────────────────────────────────────┘
--
--  POURQUOI C'EST GRAVE, ET PAS SEULEMENT INEXACT
--    Un signal bloquant qu'aucune action ne peut éteindre apprend à être
--    ignoré. `lib/supervision/problemes.ts` porte déjà cette règle en toutes
--    lettres : « un écran qui signale le fonctionnement normal enseigne à
--    ignorer ses signaux ». Six lignes rouges permanentes depuis juin sont
--    exactement ça — et elles occupaient la place où le vrai défaut du même
--    jour aurait dû s'afficher : le moteur était ÉTEINT.
--
--  LA RÈGLE, ET ELLE EST CELLE DE LA LECTURE
--    Une annonce est active tant que `coalesce(expires_at, published_at +
--    vie_annonce_jours)` est dans le futur. C'est l'expression EXACTE de
--    `annonces_expirees_par_duree` et de `lib/publications/expiry.ts`. Une
--    troisième expression ici annoncerait un compte que ni l'un ni l'autre ne
--    retrouverait (§E.24).
--
--    La durée est LUE dans `duree_reglages`, jamais écrite en dur : elle est
--    réglable depuis `/admin/durees`, et un nombre gelé ici divergerait du
--    réglage sans que rien ne le dise (§D.7).
--
--  CE QUE CETTE MIGRATION NE FAIT PAS
--    Elle ne touche à aucune ligne de `publications`. Les six annonces
--    existent, leur `matching_attempted_at` reste NULL, et leur histoire reste
--    lisible. Ce qui change est ce que la SUPERVISION réclame : une action
--    possible, jamais une action impossible.

create or replace function public.matching_runs_inacheves(
  p_max_attempts integer default 5
) returns table (
  etat        text,
  publications bigint,
  plus_ancien timestamptz
)
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  select etat, count(*) as publications, min(depuis) as plus_ancien
    from (
      select case
               when p.matching_attempted_at is null then 'jamais_tente'
               when p.matching_attempts >= p_max_attempts then 'abandonne'
               else 'en_cours'
             end as etat,
             coalesce(p.matching_attempted_at, p.published_at) as depuis
        from public.publications p
        -- LA DURÉE VIENT DU RÉGLAGE, PAS D'UN NOMBRE ÉCRIT ICI.
        -- `cross join` sur une table à ligne unique : si la ligne manquait, la
        -- fonction rendrait ZÉRO ligne — un « rien à signaler » sur une
        -- configuration absente. Le `coalesce` ci-dessous ferme ce cas en
        -- retombant sur la valeur par défaut de la colonne.
        left join public.duree_reglages d on true
       where p.status = 'published'
         and p.matching_completed_at is null
         -- ⚠️ UNE ANNONCE EXPIRÉE SORT D'ICI. Elle ne peut plus être notée :
         --    la réclamer serait réclamer une action qui n'existe pas.
         and p.published_at is not null
         and coalesce(
               p.expires_at,
               p.published_at + make_interval(days => coalesce(d.vie_annonce_jours, 30))
             ) > now()
    ) q
   group by etat
   order by count(*) desc;
$fn$;

revoke all on function public.matching_runs_inacheves(integer) from public, anon, authenticated;
grant execute on function public.matching_runs_inacheves(integer) to service_role;

comment on function public.matching_runs_inacheves(integer) is
  'Mises en relation inachevees sur les annonces ENCORE ACTIVES. Une annonce '
  'expiree en sort : elle ne peut plus etre notee, et un signal bloquant '
  'qu''aucune action ne peut eteindre apprend a etre ignore. La duree de vie '
  'est lue dans duree_reglages (reglable depuis /admin/durees), jamais ecrite '
  'en dur — meme expression que annonces_expirees_par_duree et '
  'lib/publications/expiry.ts.';
