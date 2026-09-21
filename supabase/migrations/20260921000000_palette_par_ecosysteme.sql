-- ═══════════════════════════════════════════════════════════════════════════
-- LA PALETTE PAR ÉCOSYSTÈME
--
-- ORDRE DE PASSAGE : **AVANT** le déploiement.
--   Elle n'ajoute que du nouveau — six colonnes, avec un `DEFAULT` qui remplit
--   les lignes existantes. Aucune colonne supprimée, aucune ligne détruite.
--   Le code qui suit LIT ces colonnes : les poser d'abord évite que
--   `resolvePalette` retombe sur la référence pendant la fenêtre de
--   déploiement — ce qui serait sans dommage, mais inutilement flou (§G.4).
--
-- ┌─ POURQUOI EN BASE, ET PAS EN CODE ──────────────────────────────────────┐
-- │ Un réglage règle quelque chose, ou il le dit (§D.7). La palette est      │
-- │ l'identité VISUELLE d'un écosystème : elle change d'un écosystème à      │
-- │ l'autre, et Youssef doit pouvoir la changer sans déploiement. En code,   │
-- │ ajouter un écosystème redeviendrait un déploiement — exactement ce que   │
-- │ la migration `format_numero_identification` a retiré au pays du siège.   │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ SIX COLONNES, PAS HUIT, ET C'EST LE POINT ─────────────────────────────┐
-- │ Les huit rôles de `lib/palette.ts` tiennent en SIX colonnes neuves :     │
-- │   · `marque`  RÉUTILISE `primary_color`, qui EST déjà la couleur de      │
-- │     marque de l'écosystème ;                                            │
-- │   · `boutons` RÉUTILISE `accent_color`, qui EST déjà l'override de la    │
-- │     couleur dérivée (migration 20260710000001).                          │
-- │ En créer deux de plus aurait produit deux jumeaux qui divergent (§E.20), │
-- │ et personne n'aurait su laquelle fait foi.                              │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ LE `DEFAULT` N'EST PAS UN REPLI INVENTÉ ───────────────────────────────┐
-- │ §E.11 condamne les replis qu'aucun écran ne montre et que personne n'a   │
-- │ choisis. Ces valeurs-ci sont l'inverse : ce sont les couleurs MESURÉES   │
-- │ de l'accueil (audit du 21/09/2026), elles sont la référence du produit,  │
-- │ et elles sont écrites à l'identique dans `PALETTE_REFERENCE`. Les deux   │
-- │ côtés sont donc d'accord par construction. Un écosystème neuf naît aux   │
-- │ couleurs de la référence plutôt qu'en gris, et `/admin/ecosystemes` les  │
-- │ montre le premier jour.                                                  │
-- │                                                                          │
-- │ ⚠️ Et le `DEFAULT` REMPLIT LES LIGNES EXISTANTES : c'est ce qui fait     │
-- │ qu'aucune migration de DONNÉES n'est nécessaire ici, donc aucune de la   │
-- │ classe que §E.12 décrit — celle que rien ne valide et dont le seul       │
-- │ usage est une base que personne n'a sous la main.                       │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ PLAGE DE NUMÉROTATION : `0xxxxx`, ET LA CONSIGNE DISAIT `1xxxxx` ──────┐
-- │ La consigne du lot demandait la plage `1xxxxx`. §G.2 la déclare FAUSSE  │
-- │ et TRANCHÉE : la plage du tronc est `0xxxxx`, et `1xxxxx` est gelée     │
-- │ nommément sur quatre migrations déjà appliquées. Une cinquième y ferait │
-- │ rougir le cliquet de `diag-migration-donnees`, qui refuse toute         │
-- │ migration neuve hors des plages attribuées. On suit donc le dépôt, qui  │
-- │ est la source de vérité, et on l'écrit ici pour que le choix se lise.   │
-- └─────────────────────────────────────────────────────────────────────────┘
--
-- CONVENTIONS : `if not exists` partout, la migration se rejoue sans effet.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. LES SIX COLONNES DE CHROME
--    Nommées par CE QU'ELLES COLORENT. « couleur_bandeau » dit où la couleur se
--    pose ; « couleur_grise_2 » n'aurait rien dit, et c'est ainsi qu'on se
--    retrouve avec trois gris que personne n'ose toucher (§D.9).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.domain_configs
  add column if not exists couleur_fond_page        character varying(7) not null default '#FDFBF7',
  add column if not exists couleur_bandeau          character varying(7) not null default '#F6F2EA',
  add column if not exists couleur_cartes           character varying(7) not null default '#FFFFFF',
  add column if not exists couleur_bordures         character varying(7) not null default '#E7E2D8',
  add column if not exists couleur_texte_principal  character varying(7) not null default '#1A1815',
  add column if not exists couleur_texte_secondaire character varying(7) not null default '#6B655C';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. LA FORME EST GARDÉE EN BASE, PAS SEULEMENT AU SERVEUR
--    Une garde qui est une contrainte de schéma ne dépend d'aucune discipline
--    (§E.31) : quel que soit l'appelant — la route d'admin, un script, l'éditeur
--    SQL — une valeur qui n'est pas un hexadécimal à six chiffres est refusée.
--    Le serveur valide AUSSI, et c'est voulu : deux verrous volontairement
--    redondants, comme pour le chemin du logo (§E.17).
--
--    ⚠️ La contrainte porte sur la FORME, jamais sur la LISIBILITÉ. Le contraste
--    se vérifie au serveur, où l'on peut nommer la paire fautive et rendre son
--    ratio. Une contrainte en base ne saurait dire que « 23514 ».
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  c text;
begin
  foreach c in array array[
    'couleur_fond_page',
    'couleur_bandeau',
    'couleur_cartes',
    'couleur_bordures',
    'couleur_texte_principal',
    'couleur_texte_secondaire'
  ]
  loop
    if not exists (
      select 1 from pg_constraint
      where conname = 'domain_configs_' || c || '_hex_check'
        and conrelid = 'public.domain_configs'::regclass
    ) then
      execute format(
        'alter table public.domain_configs add constraint %I check (%I ~ ''^#[0-9a-fA-F]{6}$'')',
        'domain_configs_' || c || '_hex_check',
        c
      );
    end if;
  end loop;
end $$;

-- `accent_color` porte le rôle « boutons ». Elle est NULLABLE, et son `null` a
-- un sens PLEIN : « dérive la couleur depuis la marque jusqu'au contraste
-- cible ». Ce n'est pas une absence de réglage, c'est le réglage par défaut —
-- d'où la contrainte qui accepte `null` et refuse tout le reste hors forme.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'domain_configs_accent_color_hex_check'
      and conrelid = 'public.domain_configs'::regclass
  ) then
    alter table public.domain_configs
      add constraint domain_configs_accent_color_hex_check
      check (accent_color is null or accent_color ~ '^#[0-9a-fA-F]{6}$');
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CE QUE CHAQUE COLONNE COLORE, écrit EN BASE
--    Un commentaire de colonne survit à toutes les relectures du code, et c'est
--    le seul endroit que lit celui qui explore la base sans le dépôt.
-- ─────────────────────────────────────────────────────────────────────────────

comment on column public.domain_configs.couleur_fond_page is
  'Palette, rôle « fond de page ». Le fond de toute page, derrière les cartes. Défaut : la valeur mesurée sur l''accueil. Source unique : lib/palette.ts.';
comment on column public.domain_configs.couleur_bandeau is
  'Palette, rôle « bandeau du haut ». En-tête et barre latérale des tableaux de bord, bandeau utilitaire de l''accueil.';
comment on column public.domain_configs.couleur_cartes is
  'Palette, rôle « cartes ». Surface des cartes et des panneaux, ET couleur du libellé posé sur un bouton plein.';
comment on column public.domain_configs.couleur_bordures is
  'Palette, rôle « bordures ». Contour des cartes et séparation des sections. NON gardée par le contraste : la référence vaut 1,25, exiger 3 ferait rougir l''accueil lui-même.';
comment on column public.domain_configs.couleur_texte_principal is
  'Palette, rôle « texte principal ». Tout le texte qui porte, ET le fond du pied de page de l''accueil, seule surface foncée du produit.';
comment on column public.domain_configs.couleur_texte_secondaire is
  'Palette, rôle « texte secondaire ». Chapôs, sous-titres, textes de carte, ET tout texte d''état vide — ceux-ci portent une information et ne prennent jamais le texte tenu, qui vaut 3,63.';
comment on column public.domain_configs.accent_color is
  'Palette, rôle « boutons et éléments actifs ». NULL = dérivé de primary_color jusqu''au contraste cible contre couleur_fond_page. Renseigné = override choisi dans /admin/ecosystemes.';
comment on column public.domain_configs.primary_color is
  'Palette, rôle « couleur de marque ». Le LOGO, et rien d''autre : c''est la teinte vive de l''écosystème, et elle ne passe aucune garde de contraste sur du texte.';
