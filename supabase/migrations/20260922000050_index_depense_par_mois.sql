-- 20260922000050_index_depense_par_mois.sql
--
-- LA SECONDE CREATION SAUTEE — REPAREE PENDANT QU ELLE EST GRATUITE.
--
-- ORDRE DE PASSAGE : INDIFFERENT. Elle ne touche que des index.
--
-- ═══ POURQUOI MAINTENANT, ET PAS DANS SIX MOIS ═════════════════════════════
--
--   `ai_spend_events` ne contient AUCUNE ligne — mesure du lot precedent. La
--   creation de l'index et la suppression de l'ancien prennent donc un verrou
--   qui dure ZERO SECONDE.
--
--   Sur une table de journal pleine, le meme geste devient un arbitrage :
--   combien de temps accepte-t-on de bloquer les ecritures. LE SEUL MOMENT OU
--   FERMER CE TROU EST GRATUIT, C'EST MAINTENANT. Decision de Youssef.
--
-- ═══ CE QUI S'EST PASSE — MEME MECANIQUE QUE packages_stripe (E.60) ════════
--
--   `20260916110000` a cree :
--     ai_spend_action_mois_idx  on ai_spend_events (action, created_at desc)
--
--   `20260919000010` a voulu creer, POUR LA LECTURE PAR MOIS :
--     create index IF NOT EXISTS ai_spend_action_mois_idx
--       on ai_spend_events (created_at desc, action)
--
--   MEME NOM, MEME TABLE, COLONNES DANS L'ORDRE INVERSE. `if not exists` a vu
--   le nom pris et n'a RIEN fait : l'index annonce n'existe pas, et c'est
--   l'ancien — taille pour un autre tri — qui sert.
--
--   Aucune garantie n'a ete perdue : c'est un index de PERFORMANCE, pas une
--   garde. Rien de faux n'en sort, seulement une lecture plus lente.
--
-- ═══ L'ANCIEN INDEX PART, ET VOICI LA MESURE QUI LE DIT ════════════════════
--
--   Un index sur `(action, created_at)` ne sert qu'a une lecture qui FILTRE sur
--   `action`. Les QUATRE lecteurs de cette table ont ete relus, un par un :
--
--     · ai_spend_status()        — where created_at >= ... group by provider
--     · ai_depense_par_acteur()  — where created_at >= ... group by acteur
--     · ai_depense_par_mois()    — where created_at >= ... group by mois,
--                                  fournisseur, action  ← la lecture visee
--     · ai_depense_operations()  — where created_at dans un mois,
--                                  order by cost_usd desc
--
--   AUCUNE NE FILTRE SUR `action`. La troisieme la GROUPE, ce qui n'est pas la
--   meme chose : son predicat selectif est la fenetre de temps, et un index qui
--   commence par `action` ne peut pas la servir sans tout parcourir.
--
--   Et la table n'est lue par AUCUN code applicatif : elle est `revoke all` +
--   `grant to service_role`, et `lib/ai-budget.ts` n'y fait qu'un `insert`.
--   L'inventaire des lecteurs est donc COMPLET, pas echantillonne.
--
-- ═══ LES TROIS REGLES DE E.60, APPLIQUEES ══════════════════════════════════
--
--   ① UN NOM DISTINCT. `ai_spend_mois_action_idx` dit l'ordre des colonnes,
--      donc la lecture qu'il sert.
--   ② PAS DE `if not exists`. C'est lui qui transforme une collision en
--      silence.
--   ③ UNE POSTCONDITION QUI EXIGE LA TABLE, pas seulement le nom — c'est elle
--      qui aurait suffi a tout voir.
--
--   ⚠️ ET LA SUPPRESSION DE L'ANCIEN VERIFIE SA TABLE AVANT D'AGIR. Un nom
--      d'index est unique PAR SCHEMA : un `drop index if exists` a l'aveugle
--      sur un nom qui appartiendrait a une AUTRE table supprimerait l'index de
--      cette autre table. C'est la faute d'aujourd'hui, en pire et sans retour.

begin;

-- ═══ ① L'ANCIEN PART — PAR SON NOM EXACT, ET SEULEMENT S'IL EST BIEN LE SIEN ═
do $$
declare
  v_table text;
begin
  select tc.relname into v_table
    from pg_class ic
    join pg_index i on i.indexrelid = ic.oid
    join pg_class tc on tc.oid = i.indrelid
    join pg_namespace nc on nc.oid = tc.relnamespace
   where ic.relname = 'ai_spend_action_mois_idx'
     and nc.nspname = 'public';

  if v_table is null then
    raise notice 'ai_spend_action_mois_idx absent : rien a supprimer.';
  elsif v_table <> 'ai_spend_events' then
    raise exception
      'MIGRATION ARRETEE : ai_spend_action_mois_idx porte sur « % », pas sur '
      'ai_spend_events. Un nom d''index est unique PAR SCHEMA : le supprimer '
      'emporterait l''index d''une autre table.', v_table;
  else
    execute 'drop index public.ai_spend_action_mois_idx';
  end if;
end
$$;

-- ═══ ② LE NOUVEAU, POUR LA LECTURE PAR MOIS ════════════════════════════════
create index ai_spend_mois_action_idx
  on public.ai_spend_events (created_at desc, action);

comment on index public.ai_spend_mois_action_idx is
  'Sert ai_depense_par_mois() : fenetre sur created_at, puis groupement par '
  'fournisseur et action. Remplace ai_spend_action_mois_idx, qui portait les '
  'memes colonnes dans l''ordre INVERSE et dont la recreation avait ete sautee '
  'en silence par un « if not exists » sur un nom deja pris (E.60).';

-- ═══ ③ LA MIGRATION VERIFIE CE QU'ELLE A FAIT ══════════════════════════════
do $$
declare
  v_def text;
begin
  select pg_get_indexdef(i.indexrelid) into v_def
    from pg_index i
    join pg_class ic on ic.oid = i.indexrelid
    join pg_class tc on tc.oid = i.indrelid
    join pg_namespace nc on nc.oid = tc.relnamespace
   where ic.relname = 'ai_spend_mois_action_idx'
     and tc.relname = 'ai_spend_events'
     and nc.nspname = 'public';

  if v_def is null then
    raise exception
      'MIGRATION ARRETEE : ai_spend_mois_action_idx absent de ai_spend_events '
      'apres creation. Un nom d''index est unique PAR SCHEMA : verifiez qu''il '
      'n''est pas deja pris par une autre table.';
  end if;

  -- LES COLONNES, ET DANS L'ORDRE. Un index qui porterait les memes colonnes a
  -- l'envers ne sert pas la meme lecture — c'est tout le defaut qu'on repare.
  if v_def !~ '\(created_at DESC, action\)' then
    raise exception
      'MIGRATION ARRETEE : ai_spend_mois_action_idx ne porte pas '
      '(created_at DESC, action). Definition lue : %', v_def;
  end if;

  if exists (
    select 1
      from pg_class ic
      join pg_namespace nc on nc.oid = ic.relnamespace
     where ic.relname = 'ai_spend_action_mois_idx' and nc.nspname = 'public'
  ) then
    raise exception
      'MIGRATION ARRETEE : ai_spend_action_mois_idx existe encore.';
  end if;
end
$$;

commit;
