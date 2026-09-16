-- ═══════════════════════════════════════════════════════════════════════════
-- LE PARAMÉTRAGE DE PRODUCTION — la recette construisait une base MORTE
--
-- ╔═════════════════════════════════════════════════════════════════════════╗
-- ║ LE FAIT, ÉTABLI EN DÉROULANT LES 50 MIGRATIONS SUR BASE VIERGE          ║
-- ╠═════════════════════════════════════════════════════════════════════════╣
-- ║ La recette construit parfaitement la STRUCTURE — aucune erreur SQL, les ║
-- ║ 24 RPC couvertes — et ne contient AUCUNE donnée de référence. Elle se   ║
-- ║ terminait sur un succès VERT en produisant une base structurellement    ║
-- ║ parfaite et fonctionnellement MORTE.                                    ║
-- ║                                                                         ║
-- ║ Ce qu'un utilisateur rencontrait, dans l'ordre :                        ║
-- ║   1. le site s'affiche aux couleurs PAR DÉFAUT — `getDomainConfig` ne   ║
-- ║      trouve aucune ligne et retombe sur `defaultDomainConfig`. RIEN     ║
-- ║      N'ALERTE : le repli masque la panne.                               ║
-- ║   2. AUCUNE INSCRIPTION NE FONCTIONNE. `handle_new_user` cherche        ║
-- ║      l'écosystème dans une table vide et lève « domaine actif           ║
-- ║      introuvable pour slug ». 100 % d'échec, dès le premier compte.     ║
-- ║   3. formulaires de profil et d'annonce sans aucun choix, sélecteur de  ║
-- ║      pays vide, vérification d'entreprise sans seuil, taxonomie         ║
-- ║      monolingue.                                                        ║
-- ╚═════════════════════════════════════════════════════════════════════════╝
--
-- ═══ POURQUOI UNE MIGRATION, ET PAS `supabase/seed.sql` ══════════════════════
--   `seed.sql` n'est joué que par `supabase db reset` en LOCAL. Il n'est PAS
--   appliqué par `supabase db push` vers un distant. Une production neuve créée
--   par `db push` ne le recevrait donc jamais — c'est-à-dire exactement la
--   panne qu'on ferme ici. Le seed est un outil de développement ; ce fichier
--   est une livraison.
--
--   Et pas non plus un fichier « à exécuter séparément », comme ceux de
--   `supabase/_archive/`. C'est PRÉCISÉMENT ce mécanisme qui a perdu le seuil
--   d'auto-approbation : posé à la main le 16 juin, il n'existe nulle part dans
--   le dépôt (cf. §1.3 ci-dessous). Un paramétrage qui dépend d'un geste humain
--   se perd à la première reconstruction, et personne ne s'en aperçoit.
--
-- ═══ `DO NOTHING`, JAMAIS `DO UPDATE` ═══════════════════════════════════════
--   Ces lignes sont la CONFIGURATION INITIALE, éditable ensuite au back-office.
--   Un redéploiement ne doit JAMAIS écraser une valeur ajustée par un admin.
--   Même règle que `commerce_seed`, et pour la même raison.
--
--   Conséquence assumée : ce fichier ne CORRIGE rien sur une base déjà peuplée.
--   Il est un no-op complet en production actuelle. Il sert à la RECONSTRUCTION.
--
-- ═══ LES UUID SONT EXPLICITES, ET CE N'EST PAS UN DÉTAIL ════════════════════
--   `translations` est clée par `(table_name, row_id, field, locale)` où
--   `row_id` est l'UUID de la ligne traduite. Laisser `gen_random_uuid()`
--   attribuer de nouveaux identifiants rendrait les 167 traductions
--   ORPHELINES : la taxonomie repartirait monolingue, sans qu'aucune erreur ne
--   se produise. On fige donc les identifiants de `domains`, `domain_configs`,
--   `branches` et `specialities`.
--
-- ═══ CE QUI N'EST PAS ICI, ET POURQUOI ══════════════════════════════════════
--   • AUCUN utilisateur, AUCUNE organisation, AUCUNE annonce, AUCUNE donnée de
--     test. C'est la ligne à ne pas franchir : une production vierge
--     d'utilisateurs et complète en réglages.
--     Contrôle fait avant extraction : aucun motif d'e-mail ni de téléphone
--     dans les 167 traductions ni dans les champs libres ; les 20 lignes de
--     `public_email_domains` ont toutes `added_by` NUL. `api_key_secret_ref`
--     est un NOM de variable d'environnement, jamais une clé.
--
--   • `blocked_email_domains` : la table est VIDE en base. Rien à extraire.
--
--   • Les traductions de `work_zones` (213 lignes) sont ÉCARTÉES. La migration
--     `referentiel_zones_de_travail` crée ces zones avec `gen_random_uuid()` —
--     leurs identifiants ne sont donc PAS stables — et elle seede elle-même
--     leurs traductions, par jointure sur le code. Les recopier ici y poserait
--     des `row_id` périmés : 213 traductions orphelines, et les vraies déjà
--     présentes. On ne refait pas ce qui se refait tout seul, correctement.
--
--   • Déjà amorcés par leurs propres migrations, non repris : `roles`,
--     `features`, `packages`, `package_features`, `work_zones`,
--     `cron_job_catalog`, `matching_settings`, `ai_spend_caps`, `ai_quotas`.
--
-- ═══ L'ORDRE, ET LE PIÈGE QU'IL AURAIT PU OUVRIR ════════════════════════════
--   `reglages_matching_et_depense` seede `matching_settings` par
--   `select d.id from domains d` — et il passe AVANT ce fichier. Sur une base
--   vierge il insère donc ZÉRO ligne, puisque `domains` est encore vide.
--
--   Ce n'est PAS un trou : la même migration pose le déclencheur
--   `domains_matching_settings_trg`, `after insert on domains`. L'insertion
--   ci-dessous crée donc la ligne `matching_settings` de chaque écosystème.
--   Vérifié à la fin de ce fichier plutôt que supposé.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. LA LIGNE MORTE — `claude_profile_matching` cesse de se lire comme vivante
--
-- Elle porte `max_candidates: 100` et `claude-haiku`, et décrit le moteur
-- d'AVANT le reranking. Claude est sorti de la mise en relation : plus aucun
-- code ne lit `provider_type = 'profile_matching'`.
--
-- ON DÉSACTIVE, ON NE SUPPRIME PAS.
--   La valeur `'profile_matching'` reste dans le CHECK de `provider_type` —
--   supprimer la ligne laisserait ce type sans explication, et le prochain
--   lecteur se demanderait ce qu'il configure. Une ligne INACTIVE et commentée
--   répond à la question ; une ligne absente la laisse ouverte.
--   Même raisonnement que `packages.max_seats`, visible et inactif plutôt que
--   caché : ce qu'on cache finit par être renseigné par quelqu'un qui croit
--   régler quelque chose.
--
-- Et elle n'est PAS reprise dans le paramétrage ci-dessous : une base neuve ne
-- la crée jamais. Elle n'existe que comme vestige de la base actuelle.
-- ═══════════════════════════════════════════════════════════════════════════

update public.verification_providers
   set is_active = false
 where provider_type = 'profile_matching'
   and is_active = true;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LE PARAMÉTRAGE
--
-- ⚠️ LE SEUIL D'AUTO-APPROBATION VAUT 8, ET LE CHIFFRE 8 N'EXISTAIT NULLE PART
--    DANS LE DÉPÔT. Il a été posé À LA MAIN en base le 16 juin 2026 (le commit
--    du jour, « seuil sain », ne touche que deux fichiers TypeScript ; seul
--    `updated_at` en portait la trace). Le seed archivé disait 9.
--
--    Sans cette ligne, une production neuve repartirait sur 9 — et presque tous
--    les profils tomberaient en validation manuelle, ce qui est précisément le
--    problème corrigé en juin.
--
--    Et il ne vit PAS dans la colonne `confidence_threshold` : il vit dans
--    `config->>'auto_approve_threshold'`. Le chemin expert LIT la colonne
--    (`select confidence_threshold, …`) puis ne s'en sert JAMAIS. On recopie
--    donc les deux telles qu'elles sont en base, sans chercher à les aligner :
--    les aligner serait une décision produit, pas une reprise.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ domains ═══
insert into public.domains (id, slug, name, description, tagline, active, launch_date)
values
  ('90477d2f-7b3a-419a-b158-3a1660aa966a', 'microsoft', 'Skilloria 365', 'Plateforme spécialisée écosystème Microsoft', 'For Microsoft Ecosystem Experts', true, null)
on conflict do nothing;


-- ═══ domain_configs ═══
insert into public.domain_configs (id, domain_id, logo_url, favicon_url, primary_color, secondary_color, accent_color, tags, featured_products, ecosystem_expert_label, ecosystem_community_label, ecosystem_speciality_label, ecosystem_domain_search_label, cms_content, seo_meta)
values
  ('dec68d15-6b55-41dd-b307-86230d88e53c', '90477d2f-7b3a-419a-b158-3a1660aa966a', null, null, '#0ea5e9', '#6366f1', null, '["Azure","Dynamics 365","Power Platform","Power BI","SharePoint","Teams","Microsoft 365","Copilot","Fabric","SQL Server"]'::jsonb, '[{"icon":"dynamics","label":"Dynamics 365"},{"icon":"azure","label":"Azure"},{"icon":"power-platform","label":"Power Platform"},{"icon":"microsoft-365","label":"Microsoft 365"},{"icon":"copilot","label":"Copilot"}]'::jsonb, 'expert Microsoft certifié', 'écosystème Microsoft', 'Spécialité Microsoft principale', 'Domaine Microsoft recherché', '{}'::jsonb, '{"title":"Skilloria 365 — Experts Microsoft certifiés","description":"La marketplace premium des experts certifiés de l''écosystème Microsoft."}'::jsonb)
on conflict do nothing;


-- ═══ branches ═══
insert into public.branches (id, domain_id, slug, name, description, icon_url, active, sort_order)
values
  ('d288333a-4203-40e5-89ef-317fd44a7ebd', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'business-apps', 'Business Applications', 'Dynamics 365, Power Platform, Business Central', null, true, 1),
  ('dc505858-8e31-44fc-8b0b-c6021daef52c', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'azure', 'Azure & Cloud', 'Infrastructure, données, IA sur Azure', null, true, 2),
  ('24ca0280-a0bd-4ad3-b2f6-80bb1c3e8a7c', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'modern-work', 'Modern Work', 'Microsoft 365, Teams, SharePoint, Viva', null, true, 3),
  ('2f9c8862-5e77-42ad-a9bb-d2464da868f0', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'security', 'Security', 'Defender, Sentinel, Purview, Entra', null, true, 4),
  ('49019980-255d-44ae-a4cc-71aeaf7e43c0', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'data-ai', 'Data & AI', 'Fabric, Synapse, Power BI, Copilot Studio', null, true, 5),
  ('7e491a7b-cb2a-47bd-a476-01fca85577c6', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'developer', 'Developer', 'Visual Studio, .NET, GitHub, DevOps', null, true, 6)
on conflict do nothing;


-- ═══ specialities ═══
insert into public.specialities (id, branch_id, domain_id, slug, name, active, sort_order)
values
  ('bb08bf67-a419-4354-8ef7-598a179eb487', 'd288333a-4203-40e5-89ef-317fd44a7ebd', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'autre', 'Autre', true, 0),
  ('35602f1a-3ecb-4143-b7e8-394042fc131f', 'd288333a-4203-40e5-89ef-317fd44a7ebd', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'd365-fo', 'Dynamics 365 F&O', true, 1),
  ('4dd2d933-c3de-4658-abed-2ab1d726409d', 'dc505858-8e31-44fc-8b0b-c6021daef52c', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'azure-infra', 'Azure Infrastructure', true, 1),
  ('aabc56da-9bc0-4220-98ae-16cf83e0f4a5', '24ca0280-a0bd-4ad3-b2f6-80bb1c3e8a7c', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'm365', 'Microsoft 365', true, 1),
  ('41525d64-5923-427d-a29f-3e9a7f055a38', '2f9c8862-5e77-42ad-a9bb-d2464da868f0', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'defender', 'Defender', true, 1),
  ('9e915b28-8079-443d-a0b8-d4e945ab803a', '49019980-255d-44ae-a4cc-71aeaf7e43c0', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'power-bi', 'Power BI', true, 1),
  ('75d246c4-2c00-493f-ad18-bd96e19aa698', '7e491a7b-cb2a-47bd-a476-01fca85577c6', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'dotnet', '.NET', true, 1),
  ('83b081f0-ea8c-4a99-8ec2-94993d3f80d2', '49019980-255d-44ae-a4cc-71aeaf7e43c0', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'fabric', 'Fabric', true, 2),
  ('8cf595bf-9907-40bc-8074-16bb7cbdc61c', '24ca0280-a0bd-4ad3-b2f6-80bb1c3e8a7c', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'teams', 'Teams', true, 2),
  ('9d22a491-ab30-48c6-9a89-5c9dc62280b5', 'd288333a-4203-40e5-89ef-317fd44a7ebd', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'd365-ce', 'Dynamics 365 CE', true, 2),
  ('edb2e2ad-8ad5-4d0e-9e2d-3b3699a1460c', '2f9c8862-5e77-42ad-a9bb-d2464da868f0', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'sentinel', 'Sentinel', true, 2),
  ('b5dbd5e4-7867-4c6a-8175-80f077bea220', '7e491a7b-cb2a-47bd-a476-01fca85577c6', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'github', 'GitHub', true, 2),
  ('d93e2d2d-004e-4bb9-8945-5a50ff8e19c6', 'dc505858-8e31-44fc-8b0b-c6021daef52c', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'azure-data', 'Azure Data', true, 2),
  ('d9bbe86d-36c4-4f33-890c-80bad2a944c1', '24ca0280-a0bd-4ad3-b2f6-80bb1c3e8a7c', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'sharepoint', 'SharePoint', true, 3),
  ('d6627f58-dc5d-4c60-ba33-61750c645999', '2f9c8862-5e77-42ad-a9bb-d2464da868f0', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'entra-id', 'Entra ID', true, 3),
  ('14422d61-066f-450e-89af-941b5ab56ff1', 'dc505858-8e31-44fc-8b0b-c6021daef52c', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'azure-devops', 'Azure DevOps', true, 3),
  ('f96a6cf7-7aaf-4acf-9c39-446661a6ca7a', '49019980-255d-44ae-a4cc-71aeaf7e43c0', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'copilot-studio', 'Copilot Studio', true, 3),
  ('389b40de-2991-4f86-8b5f-3484f1a6a848', 'd288333a-4203-40e5-89ef-317fd44a7ebd', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'business-central', 'Business Central', true, 3),
  ('149b51c0-9034-4d72-b6b5-208567ec8e32', 'dc505858-8e31-44fc-8b0b-c6021daef52c', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'azure-ai', 'Azure AI', true, 4),
  ('e49b11a1-1940-4802-a737-96a6e2f21cbb', 'd288333a-4203-40e5-89ef-317fd44a7ebd', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'power-platform', 'Power Platform', true, 4),
  ('2dfd312a-f9e0-411b-9a8a-db169a281bb0', 'd288333a-4203-40e5-89ef-317fd44a7ebd', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'power-apps', 'Power Apps', true, 5),
  ('b77b7ca1-4f6d-4a8b-b25a-e028b1cbc2c6', 'd288333a-4203-40e5-89ef-317fd44a7ebd', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'power-automate', 'Power Automate', true, 6)
on conflict do nothing;


-- ═══ countries ═══
insert into public.countries (code, name_fr, name_en, name_es, name_de, flag_emoji, phone_code, region, active, sort_order)
values
  ('FR', 'France', 'France', 'Francia', 'Frankreich', '🇫🇷', '+33', 'europe', true, 10),
  ('BE', 'Belgique', 'Belgium', 'Bélgica', 'Belgien', '🇧🇪', '+32', 'europe', true, 20),
  ('CH', 'Suisse', 'Switzerland', 'Suiza', 'Schweiz', '🇨🇭', '+41', 'europe', true, 30),
  ('LU', 'Luxembourg', 'Luxembourg', 'Luxemburgo', 'Luxemburg', '🇱🇺', '+352', 'europe', true, 40),
  ('MC', 'Monaco', 'Monaco', 'Mónaco', 'Monaco', '🇲🇨', '+377', 'europe', true, 50),
  ('GB', 'Royaume-Uni', 'United Kingdom', 'Reino Unido', 'Vereinigtes Königreich', '🇬🇧', '+44', 'europe', true, 60),
  ('IE', 'Irlande', 'Ireland', 'Irlanda', 'Irland', '🇮🇪', '+353', 'europe', true, 70),
  ('DE', 'Allemagne', 'Germany', 'Alemania', 'Deutschland', '🇩🇪', '+49', 'europe', true, 80),
  ('AT', 'Autriche', 'Austria', 'Austria', 'Österreich', '🇦🇹', '+43', 'europe', true, 90),
  ('IT', 'Italie', 'Italy', 'Italia', 'Italien', '🇮🇹', '+39', 'europe', true, 100),
  ('ES', 'Espagne', 'Spain', 'España', 'Spanien', '🇪🇸', '+34', 'europe', true, 110),
  ('PT', 'Portugal', 'Portugal', 'Portugal', 'Portugal', '🇵🇹', '+351', 'europe', true, 120),
  ('NL', 'Pays-Bas', 'Netherlands', 'Países Bajos', 'Niederlande', '🇳🇱', '+31', 'europe', true, 130),
  ('DK', 'Danemark', 'Denmark', 'Dinamarca', 'Dänemark', '🇩🇰', '+45', 'europe', true, 140),
  ('SE', 'Suède', 'Sweden', 'Suecia', 'Schweden', '🇸🇪', '+46', 'europe', true, 150),
  ('NO', 'Norvège', 'Norway', 'Noruega', 'Norwegen', '🇳🇴', '+47', 'europe', true, 160),
  ('FI', 'Finlande', 'Finland', 'Finlandia', 'Finnland', '🇫🇮', '+358', 'europe', true, 170),
  ('IS', 'Islande', 'Iceland', 'Islandia', 'Island', '🇮🇸', '+354', 'europe', true, 180),
  ('PL', 'Pologne', 'Poland', 'Polonia', 'Polen', '🇵🇱', '+48', 'europe', true, 190),
  ('CZ', 'République tchèque', 'Czech Republic', 'República Checa', 'Tschechien', '🇨🇿', '+420', 'europe', true, 200),
  ('SK', 'Slovaquie', 'Slovakia', 'Eslovaquia', 'Slowakei', '🇸🇰', '+421', 'europe', true, 210),
  ('HU', 'Hongrie', 'Hungary', 'Hungría', 'Ungarn', '🇭🇺', '+36', 'europe', true, 220),
  ('RO', 'Roumanie', 'Romania', 'Rumania', 'Rumänien', '🇷🇴', '+40', 'europe', true, 230),
  ('BG', 'Bulgarie', 'Bulgaria', 'Bulgaria', 'Bulgarien', '🇧🇬', '+359', 'europe', true, 240),
  ('GR', 'Grèce', 'Greece', 'Grecia', 'Griechenland', '🇬🇷', '+30', 'europe', true, 250),
  ('HR', 'Croatie', 'Croatia', 'Croacia', 'Kroatien', '🇭🇷', '+385', 'europe', true, 260),
  ('SI', 'Slovénie', 'Slovenia', 'Eslovenia', 'Slowenien', '🇸🇮', '+386', 'europe', true, 270),
  ('EE', 'Estonie', 'Estonia', 'Estonia', 'Estland', '🇪🇪', '+372', 'europe', true, 280),
  ('LV', 'Lettonie', 'Latvia', 'Letonia', 'Lettland', '🇱🇻', '+371', 'europe', true, 290),
  ('LT', 'Lituanie', 'Lithuania', 'Lituania', 'Litauen', '🇱🇹', '+370', 'europe', true, 300),
  ('CY', 'Chypre', 'Cyprus', 'Chipre', 'Zypern', '🇨🇾', '+357', 'europe', true, 310),
  ('MT', 'Malte', 'Malta', 'Malta', 'Malta', '🇲🇹', '+356', 'europe', true, 320),
  ('AD', 'Andorre', 'Andorra', 'Andorra', 'Andorra', '🇦🇩', '+376', 'europe', true, 330),
  ('LI', 'Liechtenstein', 'Liechtenstein', 'Liechtenstein', 'Liechtenstein', '🇱🇮', '+423', 'europe', true, 340),
  ('SM', 'Saint-Marin', 'San Marino', 'San Marino', 'San Marino', '🇸🇲', '+378', 'europe', true, 350),
  ('VA', 'Vatican', 'Vatican City', 'Ciudad del Vaticano', 'Vatikanstadt', '🇻🇦', '+379', 'europe', true, 360),
  ('AL', 'Albanie', 'Albania', 'Albania', 'Albanien', '🇦🇱', '+355', 'europe', true, 370),
  ('BA', 'Bosnie-Herzégovine', 'Bosnia and Herzegovina', 'Bosnia y Herzegovina', 'Bosnien und Herzegowina', '🇧🇦', '+387', 'europe', true, 380),
  ('ME', 'Monténégro', 'Montenegro', 'Montenegro', 'Montenegro', '🇲🇪', '+382', 'europe', true, 390),
  ('MK', 'Macédoine du Nord', 'North Macedonia', 'Macedonia del Norte', 'Nordmazedonien', '🇲🇰', '+389', 'europe', true, 400),
  ('RS', 'Serbie', 'Serbia', 'Serbia', 'Serbien', '🇷🇸', '+381', 'europe', true, 410),
  ('MD', 'Moldavie', 'Moldova', 'Moldavia', 'Moldau', '🇲🇩', '+373', 'europe', true, 420),
  ('UA', 'Ukraine', 'Ukraine', 'Ucrania', 'Ukraine', '🇺🇦', '+380', 'europe', true, 430),
  ('US', 'États-Unis', 'United States', 'Estados Unidos', 'Vereinigte Staaten', '🇺🇸', '+1', 'americas', true, 500),
  ('CA', 'Canada', 'Canada', 'Canadá', 'Kanada', '🇨🇦', '+1', 'americas', true, 510),
  ('MX', 'Mexique', 'Mexico', 'México', 'Mexiko', '🇲🇽', '+52', 'americas', true, 520),
  ('BR', 'Brésil', 'Brazil', 'Brasil', 'Brasilien', '🇧🇷', '+55', 'americas', true, 530),
  ('AR', 'Argentine', 'Argentina', 'Argentina', 'Argentinien', '🇦🇷', '+54', 'americas', true, 540),
  ('CL', 'Chili', 'Chile', 'Chile', 'Chile', '🇨🇱', '+56', 'americas', true, 550),
  ('AU', 'Australie', 'Australia', 'Australia', 'Australien', '🇦🇺', '+61', 'oceania', true, 600),
  ('NZ', 'Nouvelle-Zélande', 'New Zealand', 'Nueva Zelanda', 'Neuseeland', '🇳🇿', '+64', 'oceania', true, 610),
  ('MA', 'Maroc', 'Morocco', 'Marruecos', 'Marokko', '🇲🇦', '+212', 'africa', true, 700),
  ('DZ', 'Algérie', 'Algeria', 'Argelia', 'Algerien', '🇩🇿', '+213', 'africa', true, 710),
  ('TN', 'Tunisie', 'Tunisia', 'Túnez', 'Tunesien', '🇹🇳', '+216', 'africa', true, 720),
  ('EG', 'Égypte', 'Egypt', 'Egipto', 'Ägypten', '🇪🇬', '+20', 'africa', true, 730),
  ('IL', 'Israël', 'Israel', 'Israel', 'Israel', '🇮🇱', '+972', 'asia', true, 740),
  ('AE', 'Émirats arabes unis', 'United Arab Emirates', 'Emiratos Árabes Unidos', 'Vereinigte Arabische Emirate', '🇦🇪', '+971', 'asia', true, 800),
  ('IN', 'Inde', 'India', 'India', 'Indien', '🇮🇳', '+91', 'asia', true, 810),
  ('SG', 'Singapour', 'Singapore', 'Singapur', 'Singapur', '🇸🇬', '+65', 'asia', true, 820),
  ('JP', 'Japon', 'Japan', 'Japón', 'Japan', '🇯🇵', '+81', 'asia', true, 830),
  ('SN', 'Sénégal', 'Senegal', 'Senegal', 'Senegal', '🇸🇳', '+221', 'africa', true, 900),
  ('CI', 'Côte d''Ivoire', 'Ivory Coast', 'Costa de Marfil', 'Elfenbeinküste', '🇨🇮', '+225', 'africa', true, 910),
  ('CM', 'Cameroun', 'Cameroon', 'Camerún', 'Kamerun', '🇨🇲', '+237', 'africa', true, 920),
  ('MU', 'Maurice', 'Mauritius', 'Mauricio', 'Mauritius', '🇲🇺', '+230', 'africa', true, 930)
on conflict do nothing;


-- ═══ verification_providers ═══
insert into public.verification_providers (id, country_code, provider_type, provider_name, api_endpoint, api_key_secret_ref, is_active, priority, confidence_threshold, config)
values
  ('86841d30-cab0-476f-9778-26af5360b3d9', 'FR', 'official_api', 'sirene_insee', 'https://api.insee.fr/api-sirene/3.11', 'SIRENE_API_TOKEN', true, 10, 9, null),
  ('e6814e1c-570e-4dd5-9f81-312e77635206', 'FR', 'opportunity_quality_check', 'claude_opportunity_quality', null, 'ANTHROPIC_API_KEY', true, 10, 7, null),
  ('835aee3c-2f6a-4269-a540-c1cdc4e1b142', 'FR', 'profile_verification', 'claude_expert_coherence_check', null, 'ANTHROPIC_API_KEY', true, 10, 7, '{"model":"claude-haiku-4-5-20251001","max_tokens":2500,"blocking_flags":["CV_PROFILE_INCOHERENT","SUSPICIOUS_CONTENT","DOMAIN_MISMATCH"],"fallback_model":"claude-sonnet-4-6","request_timeout_ms":45000,"domain_mismatch_cap":5,"web_search_max_uses":4,"auto_approve_threshold":8}'::jsonb),
  ('46afe97a-ebeb-4207-982a-a4fd7a3a4f74', 'FR', 'ai_web_search', 'ai_coherence_check', null, 'ANTHROPIC_API_KEY', true, 100, 7, null)
on conflict do nothing;


-- ═══ translations ═══
insert into public.translations (table_name, row_id, field, locale, value)
values
  ('branches', '24ca0280-a0bd-4ad3-b2f6-80bb1c3e8a7c', 'description', 'de', 'Microsoft 365, Teams, SharePoint, Viva'),
  ('branches', '2f9c8862-5e77-42ad-a9bb-d2464da868f0', 'description', 'de', 'Defender, Sentinel, Purview, Entra'),
  ('branches', '49019980-255d-44ae-a4cc-71aeaf7e43c0', 'description', 'de', 'Fabric, Synapse, Power BI, Copilot Studio'),
  ('branches', '7e491a7b-cb2a-47bd-a476-01fca85577c6', 'description', 'de', 'Visual Studio, .NET, GitHub, DevOps'),
  ('branches', 'd288333a-4203-40e5-89ef-317fd44a7ebd', 'description', 'de', 'Dynamics 365, Power Platform, Business Central'),
  ('branches', 'dc505858-8e31-44fc-8b0b-c6021daef52c', 'description', 'de', 'Infrastruktur, Daten, KI auf Azure'),
  ('branches', '24ca0280-a0bd-4ad3-b2f6-80bb1c3e8a7c', 'description', 'en', 'Microsoft 365, Teams, SharePoint, Viva'),
  ('branches', '2f9c8862-5e77-42ad-a9bb-d2464da868f0', 'description', 'en', 'Defender, Sentinel, Purview, Entra'),
  ('branches', '49019980-255d-44ae-a4cc-71aeaf7e43c0', 'description', 'en', 'Fabric, Synapse, Power BI, Copilot Studio'),
  ('branches', '7e491a7b-cb2a-47bd-a476-01fca85577c6', 'description', 'en', 'Visual Studio, .NET, GitHub, DevOps'),
  ('branches', 'd288333a-4203-40e5-89ef-317fd44a7ebd', 'description', 'en', 'Dynamics 365, Power Platform, Business Central'),
  ('branches', 'dc505858-8e31-44fc-8b0b-c6021daef52c', 'description', 'en', 'Infrastructure, data, AI on Azure'),
  ('branches', '24ca0280-a0bd-4ad3-b2f6-80bb1c3e8a7c', 'description', 'es', 'Microsoft 365, Teams, SharePoint, Viva'),
  ('branches', '2f9c8862-5e77-42ad-a9bb-d2464da868f0', 'description', 'es', 'Defender, Sentinel, Purview, Entra'),
  ('branches', '49019980-255d-44ae-a4cc-71aeaf7e43c0', 'description', 'es', 'Fabric, Synapse, Power BI, Copilot Studio'),
  ('branches', '7e491a7b-cb2a-47bd-a476-01fca85577c6', 'description', 'es', 'Visual Studio, .NET, GitHub, DevOps'),
  ('branches', 'd288333a-4203-40e5-89ef-317fd44a7ebd', 'description', 'es', 'Dynamics 365, Power Platform, Business Central'),
  ('branches', 'dc505858-8e31-44fc-8b0b-c6021daef52c', 'description', 'es', 'Infraestructura, datos, IA en Azure'),
  ('branches', '24ca0280-a0bd-4ad3-b2f6-80bb1c3e8a7c', 'description', 'fr', 'Microsoft 365, Teams, SharePoint, Viva'),
  ('branches', '2f9c8862-5e77-42ad-a9bb-d2464da868f0', 'description', 'fr', 'Defender, Sentinel, Purview, Entra'),
  ('branches', '49019980-255d-44ae-a4cc-71aeaf7e43c0', 'description', 'fr', 'Fabric, Synapse, Power BI, Copilot Studio'),
  ('branches', '7e491a7b-cb2a-47bd-a476-01fca85577c6', 'description', 'fr', 'Visual Studio, .NET, GitHub, DevOps'),
  ('branches', 'd288333a-4203-40e5-89ef-317fd44a7ebd', 'description', 'fr', 'Dynamics 365, Power Platform, Business Central'),
  ('branches', 'dc505858-8e31-44fc-8b0b-c6021daef52c', 'description', 'fr', 'Infrastructure, données, IA sur Azure'),
  ('branches', '24ca0280-a0bd-4ad3-b2f6-80bb1c3e8a7c', 'name', 'de', 'Modern Work'),
  ('branches', '2f9c8862-5e77-42ad-a9bb-d2464da868f0', 'name', 'de', 'Sicherheit'),
  ('branches', '49019980-255d-44ae-a4cc-71aeaf7e43c0', 'name', 'de', 'Data & KI'),
  ('branches', '7e491a7b-cb2a-47bd-a476-01fca85577c6', 'name', 'de', 'Entwickler'),
  ('branches', 'd288333a-4203-40e5-89ef-317fd44a7ebd', 'name', 'de', 'Geschäftsanwendungen'),
  ('branches', 'dc505858-8e31-44fc-8b0b-c6021daef52c', 'name', 'de', 'Azure & Cloud'),
  ('branches', '24ca0280-a0bd-4ad3-b2f6-80bb1c3e8a7c', 'name', 'en', 'Modern Work'),
  ('branches', '2f9c8862-5e77-42ad-a9bb-d2464da868f0', 'name', 'en', 'Security'),
  ('branches', '49019980-255d-44ae-a4cc-71aeaf7e43c0', 'name', 'en', 'Data & AI'),
  ('branches', '7e491a7b-cb2a-47bd-a476-01fca85577c6', 'name', 'en', 'Developer'),
  ('branches', 'd288333a-4203-40e5-89ef-317fd44a7ebd', 'name', 'en', 'Business Applications'),
  ('branches', 'dc505858-8e31-44fc-8b0b-c6021daef52c', 'name', 'en', 'Azure & Cloud'),
  ('branches', '24ca0280-a0bd-4ad3-b2f6-80bb1c3e8a7c', 'name', 'es', 'Modern Work'),
  ('branches', '2f9c8862-5e77-42ad-a9bb-d2464da868f0', 'name', 'es', 'Seguridad'),
  ('branches', '49019980-255d-44ae-a4cc-71aeaf7e43c0', 'name', 'es', 'Data e IA'),
  ('branches', '7e491a7b-cb2a-47bd-a476-01fca85577c6', 'name', 'es', 'Desarrollador'),
  ('branches', 'd288333a-4203-40e5-89ef-317fd44a7ebd', 'name', 'es', 'Aplicaciones empresariales'),
  ('branches', 'dc505858-8e31-44fc-8b0b-c6021daef52c', 'name', 'es', 'Azure y Cloud'),
  ('branches', '24ca0280-a0bd-4ad3-b2f6-80bb1c3e8a7c', 'name', 'fr', 'Modern Work'),
  ('branches', '2f9c8862-5e77-42ad-a9bb-d2464da868f0', 'name', 'fr', 'Security'),
  ('branches', '49019980-255d-44ae-a4cc-71aeaf7e43c0', 'name', 'fr', 'Data & AI'),
  ('branches', '7e491a7b-cb2a-47bd-a476-01fca85577c6', 'name', 'fr', 'Developer'),
  ('branches', 'd288333a-4203-40e5-89ef-317fd44a7ebd', 'name', 'fr', 'Business Applications'),
  ('branches', 'dc505858-8e31-44fc-8b0b-c6021daef52c', 'name', 'fr', 'Azure & Cloud'),
  ('domain_configs', 'dec68d15-6b55-41dd-b307-86230d88e53c', 'ecosystem_community_label', 'de', 'Microsoft-Ökosystem'),
  ('domain_configs', 'dec68d15-6b55-41dd-b307-86230d88e53c', 'ecosystem_community_label', 'en', 'Microsoft ecosystem'),
  ('domain_configs', 'dec68d15-6b55-41dd-b307-86230d88e53c', 'ecosystem_community_label', 'es', 'ecosistema Microsoft'),
  ('domain_configs', 'dec68d15-6b55-41dd-b307-86230d88e53c', 'ecosystem_community_label', 'fr', 'écosystème Microsoft'),
  ('domain_configs', 'dec68d15-6b55-41dd-b307-86230d88e53c', 'ecosystem_domain_search_label', 'de', 'Gesuchter Microsoft-Bereich'),
  ('domain_configs', 'dec68d15-6b55-41dd-b307-86230d88e53c', 'ecosystem_domain_search_label', 'en', 'Sought Microsoft domain'),
  ('domain_configs', 'dec68d15-6b55-41dd-b307-86230d88e53c', 'ecosystem_domain_search_label', 'es', 'Área Microsoft buscada'),
  ('domain_configs', 'dec68d15-6b55-41dd-b307-86230d88e53c', 'ecosystem_domain_search_label', 'fr', 'Domaine Microsoft recherché'),
  ('domain_configs', 'dec68d15-6b55-41dd-b307-86230d88e53c', 'ecosystem_expert_label', 'de', 'zertifizierter Microsoft-Experte'),
  ('domain_configs', 'dec68d15-6b55-41dd-b307-86230d88e53c', 'ecosystem_expert_label', 'en', 'certified Microsoft expert'),
  ('domain_configs', 'dec68d15-6b55-41dd-b307-86230d88e53c', 'ecosystem_expert_label', 'es', 'experto Microsoft certificado'),
  ('domain_configs', 'dec68d15-6b55-41dd-b307-86230d88e53c', 'ecosystem_expert_label', 'fr', 'expert Microsoft certifié'),
  ('domain_configs', 'dec68d15-6b55-41dd-b307-86230d88e53c', 'ecosystem_speciality_label', 'de', 'Microsoft-Hauptspezialisierung'),
  ('domain_configs', 'dec68d15-6b55-41dd-b307-86230d88e53c', 'ecosystem_speciality_label', 'en', 'Main Microsoft specialty'),
  ('domain_configs', 'dec68d15-6b55-41dd-b307-86230d88e53c', 'ecosystem_speciality_label', 'es', 'Especialidad principal Microsoft'),
  ('domain_configs', 'dec68d15-6b55-41dd-b307-86230d88e53c', 'ecosystem_speciality_label', 'fr', 'Spécialité Microsoft principale'),
  ('domains', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'description', 'de', 'Spezialisierte Plattform für das Microsoft-Ökosystem'),
  ('domains', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'description', 'en', 'Specialized platform for the Microsoft ecosystem'),
  ('domains', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'description', 'es', 'Plataforma especializada en el ecosistema Microsoft'),
  ('domains', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'description', 'fr', 'Plateforme spécialisée écosystème Microsoft'),
  ('domains', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'ecosystem_name', 'de', 'Microsoft'),
  ('domains', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'ecosystem_name', 'en', 'Microsoft'),
  ('domains', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'ecosystem_name', 'es', 'Microsoft'),
  ('domains', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'ecosystem_name', 'fr', 'Microsoft'),
  ('domains', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'name', 'de', 'Skilloria 365'),
  ('domains', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'name', 'en', 'Skilloria 365'),
  ('domains', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'name', 'es', 'Skilloria 365'),
  ('domains', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'name', 'fr', 'Skilloria 365'),
  ('domains', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'tagline', 'de', 'Für Experten des Microsoft-Ökosystems'),
  ('domains', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'tagline', 'en', 'For Microsoft Ecosystem Experts'),
  ('domains', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'tagline', 'es', 'Para expertos del ecosistema Microsoft'),
  ('domains', '90477d2f-7b3a-419a-b158-3a1660aa966a', 'tagline', 'fr', 'For Microsoft Ecosystem Experts'),
  ('specialities', '14422d61-066f-450e-89af-941b5ab56ff1', 'name', 'de', 'Azure DevOps'),
  ('specialities', '149b51c0-9034-4d72-b6b5-208567ec8e32', 'name', 'de', 'Azure AI'),
  ('specialities', '2dfd312a-f9e0-411b-9a8a-db169a281bb0', 'name', 'de', 'Power Apps'),
  ('specialities', '35602f1a-3ecb-4143-b7e8-394042fc131f', 'name', 'de', 'Dynamics 365 F&O'),
  ('specialities', '389b40de-2991-4f86-8b5f-3484f1a6a848', 'name', 'de', 'Business Central'),
  ('specialities', '41525d64-5923-427d-a29f-3e9a7f055a38', 'name', 'de', 'Defender'),
  ('specialities', '4dd2d933-c3de-4658-abed-2ab1d726409d', 'name', 'de', 'Azure Infrastructure'),
  ('specialities', '75d246c4-2c00-493f-ad18-bd96e19aa698', 'name', 'de', '.NET'),
  ('specialities', '83b081f0-ea8c-4a99-8ec2-94993d3f80d2', 'name', 'de', 'Fabric'),
  ('specialities', '8cf595bf-9907-40bc-8074-16bb7cbdc61c', 'name', 'de', 'Teams'),
  ('specialities', '9d22a491-ab30-48c6-9a89-5c9dc62280b5', 'name', 'de', 'Dynamics 365 CE'),
  ('specialities', '9e915b28-8079-443d-a0b8-d4e945ab803a', 'name', 'de', 'Power BI'),
  ('specialities', 'aabc56da-9bc0-4220-98ae-16cf83e0f4a5', 'name', 'de', 'Microsoft 365'),
  ('specialities', 'b5dbd5e4-7867-4c6a-8175-80f077bea220', 'name', 'de', 'GitHub'),
  ('specialities', 'b77b7ca1-4f6d-4a8b-b25a-e028b1cbc2c6', 'name', 'de', 'Power Automate'),
  ('specialities', 'bb08bf67-a419-4354-8ef7-598a179eb487', 'name', 'de', 'Andere'),
  ('specialities', 'd6627f58-dc5d-4c60-ba33-61750c645999', 'name', 'de', 'Entra ID'),
  ('specialities', 'd93e2d2d-004e-4bb9-8945-5a50ff8e19c6', 'name', 'de', 'Azure Data'),
  ('specialities', 'd9bbe86d-36c4-4f33-890c-80bad2a944c1', 'name', 'de', 'SharePoint'),
  ('specialities', 'e49b11a1-1940-4802-a737-96a6e2f21cbb', 'name', 'de', 'Power Platform'),
  ('specialities', 'edb2e2ad-8ad5-4d0e-9e2d-3b3699a1460c', 'name', 'de', 'Sentinel'),
  ('specialities', 'f96a6cf7-7aaf-4acf-9c39-446661a6ca7a', 'name', 'de', 'Copilot Studio'),
  ('specialities', '14422d61-066f-450e-89af-941b5ab56ff1', 'name', 'en', 'Azure DevOps'),
  ('specialities', '149b51c0-9034-4d72-b6b5-208567ec8e32', 'name', 'en', 'Azure AI'),
  ('specialities', '2dfd312a-f9e0-411b-9a8a-db169a281bb0', 'name', 'en', 'Power Apps'),
  ('specialities', '35602f1a-3ecb-4143-b7e8-394042fc131f', 'name', 'en', 'Dynamics 365 F&O'),
  ('specialities', '389b40de-2991-4f86-8b5f-3484f1a6a848', 'name', 'en', 'Business Central'),
  ('specialities', '41525d64-5923-427d-a29f-3e9a7f055a38', 'name', 'en', 'Defender'),
  ('specialities', '4dd2d933-c3de-4658-abed-2ab1d726409d', 'name', 'en', 'Azure Infrastructure'),
  ('specialities', '75d246c4-2c00-493f-ad18-bd96e19aa698', 'name', 'en', '.NET'),
  ('specialities', '83b081f0-ea8c-4a99-8ec2-94993d3f80d2', 'name', 'en', 'Fabric'),
  ('specialities', '8cf595bf-9907-40bc-8074-16bb7cbdc61c', 'name', 'en', 'Teams'),
  ('specialities', '9d22a491-ab30-48c6-9a89-5c9dc62280b5', 'name', 'en', 'Dynamics 365 CE'),
  ('specialities', '9e915b28-8079-443d-a0b8-d4e945ab803a', 'name', 'en', 'Power BI'),
  ('specialities', 'aabc56da-9bc0-4220-98ae-16cf83e0f4a5', 'name', 'en', 'Microsoft 365'),
  ('specialities', 'b5dbd5e4-7867-4c6a-8175-80f077bea220', 'name', 'en', 'GitHub'),
  ('specialities', 'b77b7ca1-4f6d-4a8b-b25a-e028b1cbc2c6', 'name', 'en', 'Power Automate'),
  ('specialities', 'bb08bf67-a419-4354-8ef7-598a179eb487', 'name', 'en', 'Other'),
  ('specialities', 'd6627f58-dc5d-4c60-ba33-61750c645999', 'name', 'en', 'Entra ID'),
  ('specialities', 'd93e2d2d-004e-4bb9-8945-5a50ff8e19c6', 'name', 'en', 'Azure Data'),
  ('specialities', 'd9bbe86d-36c4-4f33-890c-80bad2a944c1', 'name', 'en', 'SharePoint'),
  ('specialities', 'e49b11a1-1940-4802-a737-96a6e2f21cbb', 'name', 'en', 'Power Platform'),
  ('specialities', 'edb2e2ad-8ad5-4d0e-9e2d-3b3699a1460c', 'name', 'en', 'Sentinel'),
  ('specialities', 'f96a6cf7-7aaf-4acf-9c39-446661a6ca7a', 'name', 'en', 'Copilot Studio'),
  ('specialities', '14422d61-066f-450e-89af-941b5ab56ff1', 'name', 'es', 'Azure DevOps'),
  ('specialities', '149b51c0-9034-4d72-b6b5-208567ec8e32', 'name', 'es', 'Azure AI'),
  ('specialities', '2dfd312a-f9e0-411b-9a8a-db169a281bb0', 'name', 'es', 'Power Apps'),
  ('specialities', '35602f1a-3ecb-4143-b7e8-394042fc131f', 'name', 'es', 'Dynamics 365 F&O'),
  ('specialities', '389b40de-2991-4f86-8b5f-3484f1a6a848', 'name', 'es', 'Business Central'),
  ('specialities', '41525d64-5923-427d-a29f-3e9a7f055a38', 'name', 'es', 'Defender'),
  ('specialities', '4dd2d933-c3de-4658-abed-2ab1d726409d', 'name', 'es', 'Azure Infrastructure'),
  ('specialities', '75d246c4-2c00-493f-ad18-bd96e19aa698', 'name', 'es', '.NET'),
  ('specialities', '83b081f0-ea8c-4a99-8ec2-94993d3f80d2', 'name', 'es', 'Fabric'),
  ('specialities', '8cf595bf-9907-40bc-8074-16bb7cbdc61c', 'name', 'es', 'Teams'),
  ('specialities', '9d22a491-ab30-48c6-9a89-5c9dc62280b5', 'name', 'es', 'Dynamics 365 CE'),
  ('specialities', '9e915b28-8079-443d-a0b8-d4e945ab803a', 'name', 'es', 'Power BI'),
  ('specialities', 'aabc56da-9bc0-4220-98ae-16cf83e0f4a5', 'name', 'es', 'Microsoft 365'),
  ('specialities', 'b5dbd5e4-7867-4c6a-8175-80f077bea220', 'name', 'es', 'GitHub'),
  ('specialities', 'b77b7ca1-4f6d-4a8b-b25a-e028b1cbc2c6', 'name', 'es', 'Power Automate'),
  ('specialities', 'bb08bf67-a419-4354-8ef7-598a179eb487', 'name', 'es', 'Otro'),
  ('specialities', 'd6627f58-dc5d-4c60-ba33-61750c645999', 'name', 'es', 'Entra ID'),
  ('specialities', 'd93e2d2d-004e-4bb9-8945-5a50ff8e19c6', 'name', 'es', 'Azure Data'),
  ('specialities', 'd9bbe86d-36c4-4f33-890c-80bad2a944c1', 'name', 'es', 'SharePoint'),
  ('specialities', 'e49b11a1-1940-4802-a737-96a6e2f21cbb', 'name', 'es', 'Power Platform'),
  ('specialities', 'edb2e2ad-8ad5-4d0e-9e2d-3b3699a1460c', 'name', 'es', 'Sentinel'),
  ('specialities', 'f96a6cf7-7aaf-4acf-9c39-446661a6ca7a', 'name', 'es', 'Copilot Studio'),
  ('specialities', '14422d61-066f-450e-89af-941b5ab56ff1', 'name', 'fr', 'Azure DevOps'),
  ('specialities', '149b51c0-9034-4d72-b6b5-208567ec8e32', 'name', 'fr', 'Azure AI'),
  ('specialities', '2dfd312a-f9e0-411b-9a8a-db169a281bb0', 'name', 'fr', 'Power Apps'),
  ('specialities', '35602f1a-3ecb-4143-b7e8-394042fc131f', 'name', 'fr', 'Dynamics 365 F&O'),
  ('specialities', '389b40de-2991-4f86-8b5f-3484f1a6a848', 'name', 'fr', 'Business Central'),
  ('specialities', '41525d64-5923-427d-a29f-3e9a7f055a38', 'name', 'fr', 'Defender'),
  ('specialities', '4dd2d933-c3de-4658-abed-2ab1d726409d', 'name', 'fr', 'Azure Infrastructure'),
  ('specialities', '75d246c4-2c00-493f-ad18-bd96e19aa698', 'name', 'fr', '.NET'),
  ('specialities', '83b081f0-ea8c-4a99-8ec2-94993d3f80d2', 'name', 'fr', 'Fabric'),
  ('specialities', '8cf595bf-9907-40bc-8074-16bb7cbdc61c', 'name', 'fr', 'Teams'),
  ('specialities', '9d22a491-ab30-48c6-9a89-5c9dc62280b5', 'name', 'fr', 'Dynamics 365 CE'),
  ('specialities', '9e915b28-8079-443d-a0b8-d4e945ab803a', 'name', 'fr', 'Power BI'),
  ('specialities', 'aabc56da-9bc0-4220-98ae-16cf83e0f4a5', 'name', 'fr', 'Microsoft 365'),
  ('specialities', 'b5dbd5e4-7867-4c6a-8175-80f077bea220', 'name', 'fr', 'GitHub'),
  ('specialities', 'b77b7ca1-4f6d-4a8b-b25a-e028b1cbc2c6', 'name', 'fr', 'Power Automate'),
  ('specialities', 'd6627f58-dc5d-4c60-ba33-61750c645999', 'name', 'fr', 'Entra ID'),
  ('specialities', 'd93e2d2d-004e-4bb9-8945-5a50ff8e19c6', 'name', 'fr', 'Azure Data'),
  ('specialities', 'd9bbe86d-36c4-4f33-890c-80bad2a944c1', 'name', 'fr', 'SharePoint'),
  ('specialities', 'e49b11a1-1940-4802-a737-96a6e2f21cbb', 'name', 'fr', 'Power Platform'),
  ('specialities', 'edb2e2ad-8ad5-4d0e-9e2d-3b3699a1460c', 'name', 'fr', 'Sentinel'),
  ('specialities', 'f96a6cf7-7aaf-4acf-9c39-446661a6ca7a', 'name', 'fr', 'Copilot Studio')
on conflict do nothing;


-- ═══ public_email_domains ═══
insert into public.public_email_domains (email_domain, reason, active)
select 'aol.com', 'AOL', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'aol.com');

insert into public.public_email_domains (email_domain, reason, active)
select 'bbox.fr', 'Bouygues Telecom', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'bbox.fr');

insert into public.public_email_domains (email_domain, reason, active)
select 'free.fr', 'Free', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'free.fr');

insert into public.public_email_domains (email_domain, reason, active)
select 'gmail.com', 'Google Mail', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'gmail.com');

insert into public.public_email_domains (email_domain, reason, active)
select 'gmx.com', 'GMX', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'gmx.com');

insert into public.public_email_domains (email_domain, reason, active)
select 'hotmail.com', 'Hotmail', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'hotmail.com');

insert into public.public_email_domains (email_domain, reason, active)
select 'hotmail.fr', 'Hotmail FR', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'hotmail.fr');

insert into public.public_email_domains (email_domain, reason, active)
select 'icloud.com', 'iCloud', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'icloud.com');

insert into public.public_email_domains (email_domain, reason, active)
select 'laposte.net', 'La Poste', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'laposte.net');

insert into public.public_email_domains (email_domain, reason, active)
select 'live.fr', 'Live FR', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'live.fr');

insert into public.public_email_domains (email_domain, reason, active)
select 'me.com', 'Apple Me', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'me.com');

insert into public.public_email_domains (email_domain, reason, active)
select 'orange.fr', 'Orange', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'orange.fr');

insert into public.public_email_domains (email_domain, reason, active)
select 'outlook.com', 'Outlook', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'outlook.com');

insert into public.public_email_domains (email_domain, reason, active)
select 'outlook.fr', 'Outlook FR', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'outlook.fr');

insert into public.public_email_domains (email_domain, reason, active)
select 'proton.me', 'Proton', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'proton.me');

insert into public.public_email_domains (email_domain, reason, active)
select 'protonmail.com', 'ProtonMail', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'protonmail.com');

insert into public.public_email_domains (email_domain, reason, active)
select 'sfr.fr', 'SFR', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'sfr.fr');

insert into public.public_email_domains (email_domain, reason, active)
select 'wanadoo.fr', 'Wanadoo (Orange)', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'wanadoo.fr');

insert into public.public_email_domains (email_domain, reason, active)
select 'yahoo.com', 'Yahoo', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'yahoo.com');

insert into public.public_email_domains (email_domain, reason, active)
select 'yahoo.fr', 'Yahoo FR', true
 where not exists (select 1 from public.public_email_domains where email_domain = 'yahoo.fr');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. LA MIGRATION SE CONTRÔLE ELLE-MÊME
--
-- Un paramétrage qui s'applique à moitié est pire qu'un paramétrage absent :
-- il produit une base qui DÉMARRE et se casse au premier utilisateur. On
-- vérifie donc ici ce dont dépend l'inscription, plutôt que de le supposer.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_domaines   integer;
  v_configs    integer;
  v_branches   integer;
  v_specs      integer;
  v_pays       integer;
  v_providers  integer;
  v_trad       integer;
  v_reglages   integer;
  v_seuil      integer;
begin
  select count(*) into v_domaines  from public.domains where active;
  select count(*) into v_configs   from public.domain_configs;
  select count(*) into v_branches  from public.branches where active;
  select count(*) into v_specs     from public.specialities where active;
  select count(*) into v_pays      from public.countries where active;
  select count(*) into v_providers from public.verification_providers where is_active;
  select count(*) into v_trad      from public.translations where table_name <> 'work_zones';

  -- ① CE DONT DÉPEND L'INSCRIPTION. `handle_new_user` lève si aucun domaine
  --    actif ne porte le slug fourni : sans domaine, 100 % des inscriptions
  --    échouent. C'est le premier symptôme, et le plus coûteux.
  if v_domaines = 0 then
    raise exception 'PARAMETRAGE — aucun domaine actif. handle_new_user levera a chaque inscription.';
  end if;

  -- ② LE DÉCLENCHEUR A-T-IL FAIT SON TRAVAIL ? `matching_settings` est seede
  --    AVANT ce fichier, sur une table `domains` alors vide. Si le declencheur
  --    `domains_matching_settings_trg` n'avait pas pris le relais, le moteur
  --    refuserait de tourner sur chaque ecosysteme, en le disant — mais des
  --    mois plus tard.
  select count(*) into v_reglages
    from public.domains d
    left join public.matching_settings m on m.domain_id = d.id
   where m.domain_id is null;
  if v_reglages > 0 then
    raise exception 'PARAMETRAGE — % domaine(s) sans ligne matching_settings. Le declencheur domains_matching_settings_trg n a pas joue.', v_reglages;
  end if;

  -- ③ LE SEUIL QUI DÉCIDE. Il vit dans le jsonb, pas dans la colonne. Absent,
  --    `loadConfig` rend null et TOUT profil part en validation manuelle.
  select (config->>'auto_approve_threshold')::integer into v_seuil
    from public.verification_providers
   where provider_type = 'profile_verification' and is_active
   order by priority limit 1;
  if v_seuil is null then
    raise exception 'PARAMETRAGE — profile_verification sans auto_approve_threshold. Toute verification partira en revue manuelle.';
  end if;

  raise notice 'PARAMETRAGE — % domaine(s), % config(s), % branche(s), % specialite(s), % pays, % provider(s), % traduction(s). Seuil d auto-approbation : %.',
    v_domaines, v_configs, v_branches, v_specs, v_pays, v_providers, v_trad, v_seuil;
end
$$;
