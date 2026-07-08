-- Retire les 32 tables de sauvegarde presentes dans la baseline (heritage du dump).
-- La baseline les cree ; cette migration les supprime -> etat final propre sur base vierge, nettoyage sur staging.
-- Idempotent (IF EXISTS). Audit : aucune dependance (index/sequence/policy/trigger/FK entrante).

drop table if exists "public"."_backup_ad_placements_20260422" ;
drop table if exists "public"."_backup_applications_20260422" ;
drop table if exists "public"."_backup_audit_logs_20260422" ;
drop table if exists "public"."_backup_blog_posts_20260422" ;
drop table if exists "public"."_backup_branches_20260422" ;
drop table if exists "public"."_backup_campaigns_20260422" ;
drop table if exists "public"."_backup_conversations_20260422" ;
drop table if exists "public"."_backup_dashboard_stats_20260422" ;
drop table if exists "public"."_backup_domain_configs_20260422" ;
drop table if exists "public"."_backup_domains_20260422" ;
drop table if exists "public"."_backup_features_20260422" ;
drop table if exists "public"."_backup_leads_20260422" ;
drop table if exists "public"."_backup_newsletter_subscriptions_20260422" ;
drop table if exists "public"."_backup_notifications_20260422" ;
drop table if exists "public"."_backup_opportunities_20260422" ;
drop table if exists "public"."_backup_organizations_20260422" ;
drop table if exists "public"."_backup_package_features_20260422" ;
drop table if exists "public"."_backup_package_history_20260422" ;
drop table if exists "public"."_backup_packages_20260422" ;
drop table if exists "public"."_backup_private_messages_20260422" ;
drop table if exists "public"."_backup_profile_alerts_20260422" ;
drop table if exists "public"."_backup_profiles_20260422" ;
drop table if exists "public"."_backup_promo_code_uses_20260422" ;
drop table if exists "public"."_backup_promo_codes_20260422" ;
drop table if exists "public"."_backup_referrals_20260422" ;
drop table if exists "public"."_backup_roles_20260422" ;
drop table if exists "public"."_backup_shortlists_20260422" ;
drop table if exists "public"."_backup_specialities_20260422" ;
drop table if exists "public"."_backup_subscription_history_20260422" ;
drop table if exists "public"."_backup_testimonials_20260422" ;
drop table if exists "public"."_backup_transactions_20260422" ;
drop table if exists "public"."_backup_users_20260422" ;
