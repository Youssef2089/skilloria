-- ─────────────────────────────────────────────────────────────────────────────
-- LE FILTRE DE NOTIFICATION VALAIT « JAMAIS », ET C'EST MA CONVERSION QUI L'A
-- PRODUIT.
--
-- ORDRE DE PASSAGE : INDIFFERENT. Touche UNE valeur de reglage, sous condition
-- stricte, et ne change aucune structure.
--
-- ═══ CE QUI S'EST PASSE ═════════════════════════════════════════════════════
--
--   Avant la bascule d'echelle, `notify_threshold` valait **1** sur une echelle
--   **0-1** : « ne prevenir que sur un score parfait ». Deja tres severe, mais
--   atteignable — le reranker rend des valeurs continues, et 1.0 arrive.
--
--   `echelle_des_notes` a multiplie par 10, comme toutes les autres valeurs, et
--   la valeur est devenue **10 sur 10**. La comparaison est `score >= filtre` :
--   il faut desormais un score de 10 PILE, c'est-a-dire un 1.0 exact du
--   fournisseur. En pratique, **plus personne n'est jamais prevenu**.
--
--   LA MULTIPLICATION ETAIT JUSTE ET LE RESULTAT NE L'EST PAS. Le sens d'une
--   borne SUPERIEURE ne se conserve pas par changement d'echelle de la meme
--   facon que le sens d'une valeur au milieu : 1/1 etait « le maximum », 10/10
--   reste « le maximum », mais sur une echelle a dix crans le maximum cesse
--   d'etre atteignable. C'est un effet de bord que ma migration n'avait pas vu.
--
-- ═══ ET IL Y AVAIT DEUX VERROUS POUR LA MEME CHOSE ══════════════════════════
--
--   `notify_enabled` vaut `false` : les notifications sont deja fermees par
--   l'interrupteur. Un filtre a 10 les fermait UNE SECONDE FOIS, dans le meme
--   bloc de l'ecran — et devant deux verrous pour une seule porte, on ne sait
--   plus lequel agit. L'ecran ne garde qu'un interrupteur ; le filtre reprend
--   une valeur qui VEUT DIRE QUELQUE CHOSE le jour ou l'on ouvre.
--
-- ═══ LA CONDITION EST STRICTE, ET C'EST LE POINT ════════════════════════════
--
--   On ne touche QUE les lignes qui portent EXACTEMENT l'etat produit par la
--   conversion : filtre a 10 **et** notifications fermees. Une ligne ou
--   quelqu'un aurait deliberement pose 10 avec les notifications OUVERTES
--   exprime un choix — on ne l'ecrase pas. §D.7 : le seed du commerce est
--   `DO NOTHING` et jamais `DO UPDATE`, pour cette raison exacte.
--
--   Rejouable : apres passage, plus aucune ligne ne satisfait la condition.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_touchees integer;
  v_restantes integer;
begin
  update public.matching_settings
     set notify_threshold = 8,
         updated_at = now()
   where notify_threshold = 10
     and notify_enabled = false;

  get diagnostics v_touchees = row_count;

  select count(*) into v_restantes
    from public.matching_settings
   where notify_threshold = 10;

  raise notice 'FILTRE NOTIFICATION — % ecosysteme(s) passe(s) de 10 (jamais) a 8.', v_touchees;

  if v_restantes > 0 then
    -- On le DIT plutot que de le corriger : ces lignes ont les notifications
    -- OUVERTES avec un filtre a 10, ce qui est un choix, meme severe.
    raise notice 'FILTRE NOTIFICATION — % ecosysteme(s) gardent 10 avec les notifications ouvertes : choix delibere, non touche.', v_restantes;
  end if;
end
$$;

comment on column public.matching_settings.notify_threshold is
  'FILTRE DE NOTIFICATION, echelle 0-10. Au-dessus, le palier vaut « strong » et '
  'une notification part — SI notify_enabled est vrai. Ces deux reglages ne sont '
  'PAS redondants : l''interrupteur decide SI l''on previent, le filtre decide '
  'A PARTIR DE QUELLE NOTE. Un filtre a 10 ferme la porte une seconde fois et '
  'rend l''interrupteur illisible.';
