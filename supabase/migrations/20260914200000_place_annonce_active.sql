-- UNE ANNONCE ACTIVE DE PLUS QUE L'OFFRE NE PEUT PLUS ETRE PUBLIEE
--
-- ═══ LE DEFAUT ════════════════════════════════════════════════════════════
--   La publication lit le nombre d'annonces actives de l'organisation, le
--   compare au plafond de l'offre, puis ecrit. Deux publications simultanees
--   lisent la meme valeur, concluent toutes deux « il reste de la place », et
--   passent toutes deux. Une offre a 3 annonces actives peut en porter 4.
--
--   C'est le meme lire-puis-comparer-puis-ecrire que la place incluse du lot
--   precedent, et le degat est de meme nature : un DROIT PAYANT donne
--   gratuitement.
--
--   ET LE COMPTAGE ETAIT FAIL-OPEN : une erreur de lecture laissait publier.
--   Un plafond commercial qui s'ouvre quand la base tousse n'est pas un
--   plafond. Les deux defauts sont corriges ensemble — la garantie passe en
--   base, et le sens de l'echec s'inverse cote route.
--
-- ═══ ETAT DES DONNEES, VERIFIE AVANT D'ECRIRE (staging, lecture seule) ════
--   4 organisations, 7 publications. ZERO organisation ne depasse son plafond
--   d'annonces ACTIVES. La contrainte s'applique sans conflit.
--
--   MAIS LE CHIFFRE BRUT DIT AUTRE CHOSE, ET IL A DECIDE DE LA CONCEPTION :
--   l'organisation f812aea7 porte CINQ lignes `status='published'` pour un
--   plafond de 2. Toutes sont publiees en juin 2026, donc EXPIREES. Elle est a
--   0 active, parfaitement en regle.
--
--   Une reservation posee naivement sur `where status = 'published'` l'aurait
--   trouvee a 5 places prises pour 2 disponibles : bloquee, definitivement, des
--   la migration. Le piege de ce point n'est pas la concurrence — c'est la
--   LIBERATION. Il est deja dans les donnees d'aujourd'hui.
--
-- ═══ LE MECANISME : UN NUMERO DE PLACE, ET UN INDEX UNIQUE ════════════════
--   Meme forme qu'au lot precedent, parce que c'est la bonne : chaque annonce
--   qui passe en ligne reserve un NUMERO DE PLACE sur son organisation, et un
--   index unique partiel garantit qu'un meme numero ne peut pas etre pris deux
--   fois. Deux transactions concurrentes calculent le meme numero ; la base en
--   accepte UNE et refuse l'autre. La garantie est DECLARATIVE : elle ne
--   depend d'aucune relecture, d'aucun ordre, d'aucun verrou applicatif.
--
--   ⚠️ POURQUOI PAS UN CHECK SUR UN COMPTEUR ET LE PLAFOND. Meme raison qu'au
--      lot precedent, et elle n'a pas bouge : un CHECK qui compare
--      `actives <= plafond` GELE toute ligne devenue non conforme. Une
--      organisation qui passe a une offre plus petite ne pourrait plus
--      modifier ses propres annonces — pas meme pour y ecrire une trace
--      technique. On refuse une place en trop ; on ne gele pas une ligne.
--
--   ⚠️ POURQUOI PAS UN TRIGGER QUI RECOMPTE. Il ne voit que ce qui est
--      COMMITE : sous deux transactions simultanees aucune ne voit l'autre, et
--      les deux passent. C'est le defaut qu'on corrige, deplace d'un etage.
--
-- ═══ COMMENT UNE PLACE SE LIBERE, ALORS QUE « ACTIF » SE DERIVE ═══════════
--   Il n'existe PAS de colonne `active`. La regle vit dans
--   lib/publications/expiry.ts :
--       status='published' ET COALESCE(expires_at, published_at + 30j) > now()
--   Elle est calculee A LA LECTURE, aucun job ne la materialise, et elle n'est
--   PAS appelable depuis la base.
--
--   ON NE LA RECOPIE DONC PAS ICI. Deux copies d'une meme regle divergent un
--   jour, et l'une a tort en silence — c'est exactement ce qu'on refuse.
--
--   LA BASE NE CONNAIT PAS LA REGLE : ON LA LUI DONNE. L'appelant, qui la
--   possede, calcule la LISTE des annonces actuellement actives de
--   l'organisation avec `activePublishedOrClause()` — l'unique source — et la
--   passe en parametre. La fonction rend alors sa place a toute annonce
--   numerotee qui n'est PAS dans cette liste : cloturee, archivee, repassee en
--   brouillon, ou EXPIREE. Un seul et meme traitement pour les quatre.
--
--   La liberation a lieu AU MOMENT OU ELLE COMPTE, c'est-a-dire quand une
--   place est demandee. Le bail n'est pas resilie : il n'est pas RENOUVELE.
--   Aucun job, aucune colonne materialisee, aucune seconde regle.
--
--   SENS DE L'ERREUR. Une liste trop LARGE (une annonce a expire entre la
--   lecture et l'appel) retient une place de trop : on refuse une place due,
--   l'organisation reessaie et l'obtient. Une liste trop ETROITE donnerait une
--   place en trop — c'est le seul sens dangereux, et il est impossible : une
--   annonce ne peut DEVENIR active que par cette fonction meme.
--   Une liste ABSENTE (NULL) veut dire « je ne sais pas » : la fonction refuse.
--
-- ═══ LE CAS « ILLIMITE » TIENT PAR CONSTRUCTION ═══════════════════════════
--   A plafond NULL, AUCUN numero n'est attribue : la colonne reste NULL,
--   l'index partiel ne voit pas la ligne, et rien ne peut etre refuse. Ce
--   n'est pas une exception ecrite quelque part — c'est une consequence du
--   fait que la contrainte ne porte QUE sur les lignes numerotees.

-- Le numero de place occupee par une annonce EN LIGNE.
alter table public.publications
  add column if not exists place_active smallint;

comment on column public.publications.place_active is
'Numero de la place ACTIVE consommee par cette annonce sur son organisation.

NULL dans deux cas, et aucun n''est une anomalie :
  - plafond ILLIMITE (il n''y a pas de place a disputer) ;
  - annonce qui n''est plus active (cloturee, archivee, brouillon, ou EXPIREE)
    et dont la place a ete reprise.

Ce numero est un REGISTRE DE RESERVATION, jamais une source de verite sur
l''etat d''une annonce : « active » se derive a la lecture
(lib/publications/expiry.ts) et ne se lit JAMAIS ici.';

-- LA GARANTIE. Partielle : elle ne voit que les lignes numerotees, donc elle ne
-- peut RIEN refuser a plafond illimite.
create unique index if not exists publications_place_active_unique_idx
  on public.publications (organization_id, place_active)
  where place_active is not null;

comment on index public.publications_place_active_unique_idx is
'Une place d''annonce active n''est attribuee qu''UNE FOIS par organisation.

Deux publications concurrentes calculent le meme numero de place ; la base en
accepte une et refuse l''autre. La garantie est DECLARATIVE : elle ne depend
d''aucune relecture ni d''aucun verrou applicatif, et tient donc quel que soit
l''ordre d''arrivee.

Partielle a dessein : a plafond illimite aucun numero n''est attribue, donc rien
n''est refuse.';

-- ═══════════════════════════════════════════════════════════════════════════
-- LA RESERVATION, ATOMIQUE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SECURITY DEFINER, search_path fige, accordee au SEUL service_role. Aucune
-- policy ne l'appelle : aucun risque de recursion RLS.
create or replace function public.reserver_place_annonce(
  p_publication_id uuid,
  p_plafond        integer,
  p_ids_actives    uuid[]
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_org   uuid;
  v_place integer;
begin
  -- ILLIMITE : aucune place a disputer, donc aucun numero, donc aucun refus
  -- possible. On rend `true` sans rien ecrire.
  if p_plafond is null then
    return true;
  end if;

  if p_plafond <= 0 then
    return false;
  end if;

  -- « Je ne sais pas quelles annonces sont actives » n'est pas « il n'y en a
  -- aucune ». Sans la liste, liberer reviendrait a tout rendre, donc a donner
  -- des places en trop. On refuse. C'est le pendant en base du fail-closed de
  -- la route : aucun des deux etages ne s'ouvre sur une panne de lecture.
  if p_ids_actives is null then
    return false;
  end if;

  select p.organization_id into v_org
    from public.publications p
   where p.id = p_publication_id;
  if v_org is null then
    return false;
  end if;

  -- ── LIBERATION ────────────────────────────────────────────────────────────
  -- Toute annonce numerotee de cette organisation qui n'est plus dans la liste
  -- des actives rend sa place. Cloturee, archivee, brouillon, EXPIREE : un seul
  -- traitement, et la base n'a jamais eu besoin de connaitre la regle des 30
  -- jours. C'est ici, et nulle part ailleurs, qu'une place expiree redevient
  -- disponible.
  update public.publications p
     set place_active = null
   where p.organization_id = v_org
     and p.place_active is not null
     and p.id <> p_publication_id
     and not (p.id = any(p_ids_actives));

  -- ── ATTRIBUTION ───────────────────────────────────────────────────────────
  -- LE PLUS PETIT NUMERO LIBRE, pas `max + 1`. Ici les trous sont la NORME :
  -- une place liberee au milieu doit etre reutilisable, sinon le plafond
  -- deviendrait un compteur a sens unique et l'organisation serait bloquee a
  -- vie apres N annonces. Le lot precedent pouvait se permettre `max + 1` ;
  -- celui-ci ne le peut pas.
  --
  -- Aucun numero libre <= plafond ⇒ refus. Le plafond est ainsi applique par la
  -- FORME de l'ensemble de numeros, sans comparaison separee a maintenir.
  for v_place in
    select g.n
      from generate_series(1, p_plafond) as g(n)
     where not exists (
       select 1 from public.publications p
        where p.organization_id = v_org
          and p.place_active = g.n
     )
     order by g.n
  loop
    begin
      update public.publications
         set place_active = v_place
       where id = p_publication_id
         and place_active is null;
      if found then
        return true;
      end if;
      -- La ligne a disparu, ou porte deja un numero : rien a reserver.
      return false;
    exception when unique_violation then
      -- UNE AUTRE TRANSACTION A PRIS CE NUMERO. Ce n'est pas une panne : c'est
      -- la garantie qui fonctionne. On tente le numero libre SUIVANT plutot que
      -- de refuser — un refus ici serait un « plafond atteint » mensonger alors
      -- qu'il reste de la place.
      null;
    end;
  end loop;

  -- Tous les numeros du plafond sont pris : la place n'existe pas.
  return false;
end;
$fn$;

comment on function public.reserver_place_annonce(uuid, integer, uuid[]) is
'Reserve une place d''annonce ACTIVE pour la publication demandee.

Rend true si la place est acquise, false sinon — plafond reellement atteint, ou
liste d''actives absente (voir ci-dessous).

p_plafond NULL = illimite : rend true sans rien ecrire, donc sans jamais rien
refuser.

p_ids_actives = la liste des annonces ACTUELLEMENT ACTIVES de l''organisation,
calculee par l''appelant avec lib/publications/expiry.ts — la base n''a pas
acces a cette regle et ne la recopie pas. Toute annonce numerotee absente de la
liste rend sa place : c''est ainsi, et seulement ainsi, qu''une place expiree ou
cloturee redevient disponible.

p_ids_actives NULL = « je ne sais pas » donc refus. Jamais interprete comme
« aucune active », ce qui libererait tout et donnerait des places en trop.';

revoke all on function public.reserver_place_annonce(uuid, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.reserver_place_annonce(uuid, integer, uuid[]) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- RENDRE UNE PLACE RESERVEE MAIS NON HONOREE
-- ═══════════════════════════════════════════════════════════════════════════
-- La place est reservee AVANT la verification IA, sinon la course revient. Si
-- l'annonce ne finit pas en ligne (verdict `pending_review`, ecriture en
-- echec), la place doit repartir tout de suite.
--
-- Ce n'est PAS le mecanisme de liberation — celui-la vit dans la reservation
-- elle-meme, qui reprendrait cette place au prochain appel. C'est un
-- empressement, pour que le compte soit juste immediatement.
--
-- Si cet appel echoue a son tour, on aura SOUS-attribue : une place restera
-- inutilisee jusqu'a la prochaine demande, qui la reprendra. C'est la bonne
-- direction d'echec — on ne donne jamais plus que le du.
create or replace function public.liberer_place_annonce(p_publication_id uuid)
returns void
  language sql
  security definer
  set search_path to 'public'
as $fn$
  update public.publications set place_active = null where id = p_publication_id;
$fn$;

revoke all on function public.liberer_place_annonce(uuid) from public, anon, authenticated;
grant execute on function public.liberer_place_annonce(uuid) to service_role;
