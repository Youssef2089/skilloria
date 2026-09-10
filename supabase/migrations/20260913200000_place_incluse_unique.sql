-- UNE PLACE GRATUITE NE PEUT PLUS ETRE DONNEE DEUX FOIS
--
-- ═══ LE DEFAUT ════════════════════════════════════════════════════════════
--   Le devoilement inclus lit le nombre de places deja prises, le compare au
--   plafond, puis ecrit. Deux jugements qui finissent au meme instant lisent
--   tous deux 0, concluent tous deux 0 < 1, et devoilent tous deux. Une
--   organisation a UNE place incluse peut en obtenir DEUX.
--
--   C'est la meme structure que le doublon de notification corrige au lot
--   precedent : un lire-puis-ecrire. Aucune verification avant ecriture ne peut
--   garantir un compte sous concurrence — seule la base le peut.
--
--   Et le degat est pire : un devoilement offert est un DROIT PAYANT donne
--   gratuitement, non rattrapable puisqu'on ne retrograde jamais.
--
-- ═══ ETAT DES DONNEES, VERIFIE AVANT D'ECRIRE (staging, lecture seule) ════
--   4 annonces portent au moins un devoilement, toutes sur une offre ILLIMITE.
--   ZERO depassement. La contrainte s'applique sans conflit.
--
-- ═══ LE MECANISME : UN NUMERO DE PLACE, ET UN INDEX UNIQUE ════════════════
--   Chaque devoilement AUTOMATIQUE reserve un numero de place sur son annonce.
--   Un index unique partiel garantit qu'un meme numero ne peut pas etre pris
--   deux fois. Deux transactions concurrentes calculent le meme numero ; la
--   base en accepte UNE et refuse l'autre. C'est declaratif : la garantie ne
--   depend d'aucune relecture, d'aucun ordre, d'aucun verrou applicatif.
--
--   ⚠️ POURQUOI PAS UN CHECK SUR UN COMPTEUR ET UN PLAFOND PORTES PAR
--      L'ANNONCE. C'etait la premiere piste, et elle pose une bombe : un CHECK
--      qui compare `utilisees <= plafond` bloque TOUTE mise a jour ulterieure
--      d'une ligne devenue non conforme. Une organisation qui passe a une offre
--      plus petite rendrait sa propre annonce inmodifiable — y compris pour
--      ecrire la trace d'un run de matching. On refuse une place en trop ; on
--      ne gele pas une ligne.
--
--   ⚠️ POURQUOI PAS UN TRIGGER QUI RECOMPTE. Un trigger qui relit la table voit
--      ce qui est COMMITE : sous deux transactions simultanees, aucune des deux
--      ne voit l'autre, et les deux passent. C'est exactement le defaut qu'on
--      corrige, deplace d'un etage.
--
-- ═══ LE CAS « ILLIMITE » N'EST PAS TOUCHE, ET C'EST STRUCTUREL ════════════
--   A plafond illimite, AUCUN numero n'est attribue : la colonne reste NULL,
--   l'index partiel ne la voit pas, et rien ne peut etre refuse. Ce n'est pas
--   une exception ecrite quelque part — c'est une consequence du fait que la
--   contrainte ne porte QUE sur les lignes numerotees.
--   C'est le reglage de lancement : le casser serait pire que le defaut.

-- Le numero de place occupee par un devoilement AUTOMATIQUE.
-- NULL = pas une place comptee : soit devoilement manuel, soit plafond illimite.
alter table public.candidatures
  add column if not exists place_incluse smallint;

comment on column public.candidatures.place_incluse is
$$Numero de la place INCLUSE consommee par ce devoilement automatique.

NULL dans deux cas, et aucun n'est une anomalie :
  - devoilement MANUEL (il a son propre quota, il ne consomme pas de place) ;
  - plafond ILLIMITE (il n'y a pas de place a disputer).

L'index unique partiel ci-dessous est ce qui rend impossible de donner deux fois
la meme place, meme sous deux transactions simultanees.$$;

-- LA GARANTIE. Partielle : elle ne voit que les lignes numerotees, donc elle ne
-- peut RIEN refuser a plafond illimite.
create unique index if not exists candidatures_place_incluse_unique_idx
  on public.candidatures (publication_id, place_incluse)
  where place_incluse is not null;

comment on index public.candidatures_place_incluse_unique_idx is
$$Une place incluse n'est attribuee qu'UNE FOIS par annonce.

Deux transactions concurrentes calculent le meme numero de place ; la base en
accepte une et refuse l'autre. La garantie est DECLARATIVE : elle ne depend
d'aucune relecture ni d'aucun verrou applicatif, et tient donc quel que soit
l'ordre d'arrivee.

Partielle a dessein : a plafond illimite aucun numero n'est attribue, donc rien
n'est refuse.$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- LA RESERVATION, ATOMIQUE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Le numero est calcule ET pose dans la MEME instruction. L'appelant n'a rien a
-- relire : il apprend seulement s'il a obtenu la place.
--
-- SECURITY DEFINER, STABLE non (elle ECRIT), search_path fige. Elle n'est
-- accordee qu'au service_role : les routes serveur l'appellent avec ce role, et
-- aucune policy n'a besoin de la lire — donc aucun risque de recursion RLS.
create or replace function public.reserver_place_incluse(
  p_candidature_id uuid,
  p_plafond integer
) returns boolean
  language plpgsql
  security definer
  set search_path to 'public'
as $fn$
declare
  v_publication_id uuid;
  v_place          smallint;
begin
  -- ILLIMITE : aucune place a disputer, donc aucun numero, donc aucun refus
  -- possible. On rend `true` sans rien ecrire.
  if p_plafond is null then
    return true;
  end if;

  if p_plafond <= 0 then
    return false;
  end if;

  select c.publication_id into v_publication_id
    from public.candidatures c
   where c.id = p_candidature_id;
  if v_publication_id is null then
    return false;
  end if;

  -- Le prochain numero libre, tel que cette transaction le voit. Deux
  -- transactions simultanees peuvent calculer LE MEME : c'est prevu, et c'est
  -- l'index unique qui tranche juste apres.
  select coalesce(max(c.place_incluse), 0) + 1 into v_place
    from public.candidatures c
   where c.publication_id = v_publication_id
     and c.place_incluse is not null;

  if v_place > p_plafond then
    return false;
  end if;

  begin
    update public.candidatures
       set place_incluse = v_place
     where id = p_candidature_id
       and place_incluse is null;
  exception when unique_violation then
    -- L'AUTRE TRANSACTION A PRIS CETTE PLACE. Ce n'est pas une panne : c'est la
    -- garantie qui fonctionne. On refuse, proprement.
    return false;
  end;

  return found;
end;
$fn$;

comment on function public.reserver_place_incluse(uuid, integer) is
$$Reserve une place INCLUSE pour un devoilement automatique.

Rend true si la place est acquise, false si elle ne l'est pas — plafond atteint,
ou place prise au meme instant par une transaction concurrente.

p_plafond NULL = illimite : rend true sans rien ecrire, donc sans jamais rien
refuser. C'est le reglage de lancement, et il n'est pas touche.

Un refus n'est JAMAIS une panne : l'appelant doit continuer sans devoiler. La
candidature de l'expert existe quoi qu'il arrive — le devoilement est un bonus.$$;

revoke all on function public.reserver_place_incluse(uuid, integer) from public, anon, authenticated;
grant execute on function public.reserver_place_incluse(uuid, integer) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- LIBERER UNE PLACE RESERVEE MAIS NON HONOREE
-- ═══════════════════════════════════════════════════════════════════════════
-- La place est reservee AVANT le devoilement, sinon la course revient. Si le
-- devoilement echoue ensuite, la place doit repartir — sans quoi elle serait
-- perdue pour toujours.
--
-- Si cette liberation echoue a son tour, on aura SOUS-attribue : une place
-- restera inutilisee. C'est la bonne direction d'echec — on ne donne jamais
-- plus que le du, on peut donner moins.
create or replace function public.liberer_place_incluse(p_candidature_id uuid)
returns void
  language sql
  security definer
  set search_path to 'public'
as $fn$
  update public.candidatures set place_incluse = null where id = p_candidature_id;
$fn$;

revoke all on function public.liberer_place_incluse(uuid) from public, anon, authenticated;
grant execute on function public.liberer_place_incluse(uuid) to service_role;
