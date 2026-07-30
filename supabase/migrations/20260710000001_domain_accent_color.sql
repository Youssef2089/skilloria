-- 20260710000001_domain_accent_color.sql
--
-- Accent des surfaces publiques, par écosystème.
--
-- La plateforme sert un écosystème différent par sous-domaine. La couleur
-- d'accent des pages publiques ne peut donc pas être une constante du code.
--
-- Cette colonne est un OVERRIDE, volontairement NULLABLE :
--   - NULL  -> l'accent est dérivé de primary_color en abaissant la luminance
--              jusqu'au seuil de contraste WCAG (cf. deriveAccentColor dans
--              lib/domain-config.ts). C'est le cas par défaut, y compris pour le
--              domaine microsoft.
--   - non NULL -> la marque de l'écosystème impose sa teinte au pixel
--              (ex. SAP #008FD3, Salesforce #00A1E0). La valeur est alors
--              utilisée telle quelle.
--
-- Additive, nullable, sans valeur par défaut, sans impact RLS : le code
-- fonctionne à l'identique avant et après application de cette migration
-- (colonne absente -> override lu comme NULL -> dérivation).

ALTER TABLE "public"."domain_configs"
  ADD COLUMN IF NOT EXISTS "accent_color" character varying(7);

COMMENT ON COLUMN "public"."domain_configs"."accent_color" IS
  'Accent des pages publiques imposé par la marque de l''écosystème (#RRGGBB). NULL = dérivé de primary_color par contraste WCAG, voir lib/domain-config.ts.';
