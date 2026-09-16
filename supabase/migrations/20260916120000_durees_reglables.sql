-- ═══════════════════════════════════════════════════════════════════════════
-- LES DEUX DURÉES QUI FONT LE CONTRAT DE LA PLACE — ENFIN RÉGLABLES
--
-- ━━━ CE QU'ELLES SONT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--   VIE D'UNE ANNONCE       — 30 jours, dans `PUBLICATION_TTL_DAYS` (code).
--   FENÊTRE D'ÉCHANGE       — 15 jours, dans `CONVERSATION_TTL_DAYS` (code).
--
--   Ce sont les deux promesses que la place fait à ses deux côtés : combien de
--   temps une annonce se voit, et combien de temps on a pour se parler une fois
--   le contact payé. Les changer demandait jusqu'ici un déploiement.
--
-- ━━━ UNE SEULE LIGNE, GARANTIE PAR LA STRUCTURE ━━━━━━━━━━━━━━━━━━━━━━━━━━━
--   `ligne_unique boolean primary key default true check (ligne_unique)` :
--   la seule valeur admissible est `true`, et c'est la clé primaire. Il ne peut
--   donc exister qu'UNE ligne, et aucune requête n'a besoin de choisir laquelle.
--
--   Les durées sont GLOBALES, et non par écosystème ni par type d'offre. C'est
--   une décision, pas un oubli : « identiques pour toutes les offres » est la
--   règle produit. Un réglage par écosystème inviterait une divergence que
--   personne n'a demandée, et rendrait l'analyse de rétroactivité ci-dessous
--   différente pour chaque domaine.
--
-- ━━━ L'ASYMÉTRIE, ET ELLE EST STRUCTURELLE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--   CHANGER LA VIE D'UNE ANNONCE EST RÉTROACTIF.
--     `publications.expires_at` n'est JAMAIS écrit (laissé NULL) : une annonce
--     est active tant que `published_at + durée > now`, calculé À LA LECTURE.
--     Baisser la durée expire donc immédiatement des annonces déjà publiées.
--
--   CHANGER LA FENÊTRE D'ÉCHANGE NE L'EST PAS.
--     `conversations.expires_at` EST écrit au déblocage. Les conversations
--     ouvertes gardent la date qu'elles avaient ; seuls les déblocages à venir
--     utilisent la nouvelle durée.
--
--   Ce n'est pas un détail d'implémentation : c'est ce qu'un administrateur doit
--   savoir AVANT de cliquer, et l'écran l'écrit en toutes lettres.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.duree_reglages (
  -- Le verrou de cardinalité : une seule valeur possible, et c'est la clé.
  ligne_unique          boolean primary key default true,
  vie_annonce_jours     integer not null,
  fenetre_echange_jours integer not null,
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.users(id) on delete set null,

  constraint duree_ligne_unique_check    check (ligne_unique),
  -- Bornes DÉLIBÉRÉMENT larges : ce sont des garde-fous contre la faute de
  -- frappe (un 0, un 3000), pas une politique commerciale. La politique se
  -- décide à l'écran, pas dans un CHECK qu'il faudrait migrer pour l'assouplir.
  constraint duree_vie_annonce_check     check (vie_annonce_jours between 1 and 365),
  constraint duree_fenetre_echange_check check (fenetre_echange_jours between 1 and 365)
);

-- Les valeurs DE DÉPART sont celles que le code appliquait — 30 et 15. Poser
-- autre chose ici changerait le comportement du produit au milieu d'une
-- migration qui prétend seulement rendre un réglage accessible.
insert into public.duree_reglages (ligne_unique, vie_annonce_jours, fenetre_echange_jours)
values (true, 30, 15)
on conflict (ligne_unique) do nothing;

alter table public.duree_reglages enable row level security;
revoke all on table public.duree_reglages from public, anon, authenticated;
grant all on table public.duree_reglages to service_role;

comment on table public.duree_reglages is
  'Les deux durees du contrat de la place, en UNE ligne (ligne_unique est la cle). '
  'Vie d''une annonce : RETROACTIVE (publications.expires_at n''est jamais ecrit, '
  'l''activite se calcule a la lecture). Fenetre d''echange : NON retroactive '
  '(conversations.expires_at est ecrit au deblocage).';
comment on column public.duree_reglages.vie_annonce_jours is
  'Duree de visibilite d''une annonce publiee. CHANGEMENT RETROACTIF sur tout l''existant.';
comment on column public.duree_reglages.fenetre_echange_jours is
  'Duree de la conversation ouverte au deblocage. CHANGEMENT NON retroactif.';


-- ═══ COMBIEN D'ANNONCES UNE NOUVELLE DURÉE EXPIRERAIT-ELLE ? ════════════════
--
--  ON COMPTE AVANT D'ÉCRIRE, PAS APRÈS. Baisser la durée de 30 à 20 jours
--  n'affiche aucune erreur et ne casse aucune contrainte : il retire simplement
--  des annonces de la place, en silence, pendant que leurs candidatures
--  continuent d'exister. L'administrateur doit voir le nombre AVANT de valider.
--
--  ET SURTOUT LE SOUS-NOMBRE : combien de ces annonces ont des candidatures
--  DÉVOILÉES, c'est-à-dire payées. Une annonce expirée dont un contact a été
--  acheté n'est pas la même chose qu'une annonce expirée sans suite : il y a de
--  l'argent derrière, et une organisation qui va se demander ce qui se passe.
--
--  ⚠️ CETTE FONCTION NE BLOQUE RIEN. Elle compte, elle rend, elle se tait. La
--     décision appartient a l'administrateur, qui la prend en connaissance de
--     cause — c'est l'inverse d'un refus poli qui l'empêcherait d'agir.
create or replace function public.annonces_expirees_par_duree(p_jours integer)
  returns table (
    annonces_expirees          integer,
    dont_candidatures_devoilees integer
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  with bascule as (
    select p.id,
           -- MÊME RÈGLE QUE LA LECTURE (lib/publications/expiry.ts) : expires_at
           -- s'il existe, sinon published_at + duree. Une autre expression ici
           -- annoncerait un nombre que l'ecran ne retrouverait jamais.
           coalesce(p.expires_at, p.published_at + make_interval(days => p_jours)) as fin
      from public.publications p
     where p.status = 'published'
       and p.published_at is not null
  ),
  expirees as (
    select b.id from bascule b where b.fin <= now()
  )
  select
    (select count(*) from expirees)::integer,
    (select count(distinct c.publication_id)
       from public.candidatures c
      where c.publication_id in (select id from expirees)
        and c.unlocked_at is not null)::integer;
$fn$;

revoke all on function public.annonces_expirees_par_duree(integer) from public, anon, authenticated;
grant execute on function public.annonces_expirees_par_duree(integer) to service_role;

comment on function public.annonces_expirees_par_duree(integer) is
  'Combien d''annonces publiees seraient EXPIREES si la vie d''une annonce valait '
  'p_jours, et combien d''entre elles portent une candidature deverrouillee (payee). '
  'Compte et rend ; ne bloque RIEN.';


-- ═══ ET SURTOUT : COMBIEN BASCULERAIENT ? ═══════════════════════════════════
--
--  UN TOTAL N'EST PAS UNE BASCULE, et c'est la différence qui compte à l'écran.
--  « 14 annonces seraient expirées » n'alarme personne si 12 le sont déjà. La
--  phrase utile est « 14 annonces DEVIENDRAIENT expirées » — celles qui sont
--  visibles aujourd'hui et ne le seraient plus demain.
--
--  On pourrait soustraire deux appels de la fonction ci-dessus. Ce serait juste
--  — l'expiration est monotone dans la durée — mais ce serait un raisonnement
--  tenu ailleurs, dans une route, sur deux nombres qui ne disent pas ça. Ici la
--  question est posée telle qu'elle sera affichée, donc elle est vérifiable.
create or replace function public.annonces_basculant_par_duree(
  p_actuel  integer,
  p_nouveau integer
)
  returns table (
    basculent       integer,
    dont_devoilees  integer
  )
  language sql
  stable
  security definer
  set search_path to 'public'
as $fn$
  with bascule as (
    select p.id,
           coalesce(p.expires_at, p.published_at + make_interval(days => p_actuel))  as fin_actuelle,
           coalesce(p.expires_at, p.published_at + make_interval(days => p_nouveau)) as fin_nouvelle
      from public.publications p
     where p.status = 'published'
       and p.published_at is not null
  ),
  qui_basculent as (
    -- VISIBLES aujourd'hui, expirées demain. Les deja-expirees ne basculent
    -- pas : elles ont deja bascule, et les recompter ferait paniquer pour rien.
    select b.id from bascule b
     where b.fin_actuelle > now() and b.fin_nouvelle <= now()
  )
  select
    (select count(*) from qui_basculent)::integer,
    (select count(distinct c.publication_id)
       from public.candidatures c
      where c.publication_id in (select id from qui_basculent)
        and c.unlocked_at is not null)::integer;
$fn$;

revoke all on function public.annonces_basculant_par_duree(integer, integer) from public, anon, authenticated;
grant execute on function public.annonces_basculant_par_duree(integer, integer) to service_role;

comment on function public.annonces_basculant_par_duree(integer, integer) is
  'Combien d''annonces VISIBLES aujourd''hui (a p_actuel jours) deviendraient EXPIREES '
  'a p_nouveau jours, et combien d''entre elles portent une candidature deverrouillee. '
  'C''est la phrase de l''ecran. Compte et rend ; ne bloque RIEN.';
