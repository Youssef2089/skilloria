


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."organization_role" AS ENUM (
    'admin',
    'editor',
    'viewer'
);


ALTER TYPE "public"."organization_role" OWNER TO "postgres";


CREATE TYPE "public"."package_scope" AS ENUM (
    'organization',
    'user',
    'organization_per_seat'
);


ALTER TYPE "public"."package_scope" OWNER TO "postgres";


CREATE TYPE "public"."verification_status_enum" AS ENUM (
    'pending_provider_check',
    'pending_admin_review',
    'approved',
    'rejected',
    'requires_more_info'
);


ALTER TYPE "public"."verification_status_enum" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expert_has_match_for_publication"("_publication_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.matches m
      JOIN public.profiles p ON p.id = m.profile_id
     WHERE m.publication_id = _publication_id
       AND p.user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."expert_has_match_for_publication"("_publication_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_email_confirmed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.users
    SET
      email_verified = TRUE,
      status         = CASE WHEN status = 'draft' THEN 'active' ELSE status END
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[handle_email_confirmed] erreur maj miroir pour user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_email_confirmed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_meta        JSONB;
  v_role_front  TEXT;
  v_user_type   TEXT;
  v_expert_type TEXT;
  v_domain_slug TEXT;
  v_domain_id   UUID;
  v_role_id     UUID;
  v_firstname   TEXT;
  v_lastname    TEXT;
  v_specialty   TEXT;
BEGIN
  v_meta        := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_role_front  := v_meta->>'role';
  v_domain_slug := COALESCE(v_meta->>'domain_slug', 'microsoft');
  v_firstname   := v_meta->>'firstname';
  v_lastname    := v_meta->>'lastname';
  v_specialty   := v_meta->>'specialty';

  -- Mapping role front -> user_type BDD + expert_type
  CASE v_role_front
    WHEN 'expert'     THEN v_user_type := 'expert_freelance'; v_expert_type := 'freelance';
    WHEN 'cdi'        THEN v_user_type := 'expert_cdi';       v_expert_type := 'cdi';
    WHEN 'entreprise' THEN v_user_type := 'client';           v_expert_type := NULL;
    WHEN 'cabinet'    THEN v_user_type := 'cabinet';          v_expert_type := NULL;
    ELSE                   v_user_type := NULL;               v_expert_type := NULL;
  END CASE;

  -- Role inconnu/absent : compte hors parcours Skilloria. On ne cree pas de miroir,
  -- mais on n'echoue pas (ne pas bloquer un eventuel compte technique).
  IF v_user_type IS NULL THEN
    RAISE WARNING '[handle_new_user] role inconnu: %, user % - aucun miroir cree', v_role_front, NEW.id;
    RETURN NEW;
  END IF;

  -- Domaine obligatoire. Absent -> ECHEC (inscription annulee), pas d'orphelin silencieux.
  SELECT id INTO v_domain_id FROM public.domains
  WHERE slug = v_domain_slug AND active = TRUE LIMIT 1;

  IF v_domain_id IS NULL THEN
    SELECT id INTO v_domain_id FROM public.domains
    WHERE slug = 'microsoft' AND active = TRUE LIMIT 1;
  END IF;

  IF v_domain_id IS NULL THEN
    RAISE EXCEPTION '[handle_new_user] aucun domaine actif (demande: %, ni microsoft) - inscription annulee pour %', v_domain_slug, NEW.id;
  END IF;

  -- Role commercial par defaut (Gratuit) obligatoire. Absent -> ECHEC.
  SELECT id INTO v_role_id FROM public.roles
  WHERE name = 'Gratuit' AND active = TRUE LIMIT 1;

  IF v_role_id IS NULL THEN
    RAISE EXCEPTION '[handle_new_user] role "Gratuit" actif introuvable - inscription annulee pour %', NEW.id;
  END IF;

  -- Miroir public.users. Toute erreur ici remonte et annule l'inscription (atomique).
  INSERT INTO public.users (
    id, email, role_id, domain_id, user_type,
    status, email_verified, is_verified,
    first_name, last_name, locale
  ) VALUES (
    NEW.id, NEW.email, v_role_id, v_domain_id, v_user_type,
    'draft', COALESCE(NEW.email_confirmed_at IS NOT NULL, FALSE), FALSE,
    v_firstname, v_lastname, 'fr'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Profil expert (freelance + CDI) uniquement.
  IF v_expert_type IS NOT NULL THEN
    INSERT INTO public.profiles (
      user_id, domain_id, expert_type, title, visible,
      profile_score, languages, skills, certifications
    ) VALUES (
      NEW.id, v_domain_id, v_expert_type, v_specialty, FALSE,
      0, ARRAY['fr']::TEXT[], '{}'::TEXT[], '[]'::jsonb
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_admin_of_org"("p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.organization_members
    WHERE organization_id = p_org_id 
      AND user_id = auth.uid() 
      AND role_in_org = 'admin'
      AND status = 'active'
  );
$$;


ALTER FUNCTION "public"."is_active_admin_of_org"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_member_of_org"("p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.organization_members
    WHERE organization_id = p_org_id 
      AND user_id = auth.uid() 
      AND status = 'active'
  );
$$;


ALTER FUNCTION "public"."is_active_member_of_org"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."org_has_unlocked_candidature_for_profile"("_profile_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.candidatures c
      JOIN public.publications pub
        ON pub.id = c.publication_id
      JOIN public.organization_members me
        ON me.organization_id = pub.organization_id
     WHERE c.profile_id = _profile_id
       AND c.status = 'unlocked'
       AND me.user_id = auth.uid()
       AND me.status = 'active'
  );
$$;


ALTER FUNCTION "public"."org_has_unlocked_candidature_for_profile"("_profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."_backup_ad_placements_20260422" (
    "id" "uuid",
    "user_id" "uuid",
    "title" "text",
    "description" "text",
    "url" "text",
    "position" "text",
    "is_active" boolean,
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_ad_placements_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_applications_20260422" (
    "id" "uuid",
    "opportunity_id" "uuid",
    "user_id" "uuid",
    "status" "text",
    "message" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_applications_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_audit_logs_20260422" (
    "id" "uuid",
    "user_id" "uuid",
    "action" "text",
    "table_name" "text",
    "record_id" "uuid",
    "details" "jsonb",
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_audit_logs_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_blog_posts_20260422" (
    "id" "uuid",
    "title" "text",
    "slug" "text",
    "content" "text",
    "author_id" "uuid",
    "status" "text",
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_blog_posts_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_branches_20260422" (
    "id" "uuid",
    "domain_id" "uuid",
    "name" "text",
    "slug" "text",
    "is_active" boolean,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_branches_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_campaigns_20260422" (
    "id" "uuid",
    "name" "text",
    "type" "text",
    "status" "text",
    "start_date" "date",
    "end_date" "date",
    "budget" numeric(10,2),
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_campaigns_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_conversations_20260422" (
    "id" "uuid",
    "opportunity_id" "uuid",
    "sender_id" "uuid",
    "receiver_id" "uuid",
    "subject" "text",
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_conversations_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_dashboard_stats_20260422" (
    "id" "uuid",
    "user_id" "uuid",
    "stat_date" "date",
    "profile_views" integer,
    "opportunity_views" integer,
    "applications_sent" integer,
    "messages_received" integer,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_dashboard_stats_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_domain_configs_20260422" (
    "id" "uuid",
    "domain_id" "uuid",
    "config_key" "text",
    "config_value" "text",
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_domain_configs_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_domains_20260422" (
    "id" "uuid",
    "name" "text",
    "slug" "text",
    "description" "text",
    "is_active" boolean,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_domains_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_features_20260422" (
    "id" "uuid",
    "name" "text",
    "slug" "text",
    "description" "text",
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_features_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_leads_20260422" (
    "id" "uuid",
    "email" "text",
    "first_name" "text",
    "last_name" "text",
    "source" "text",
    "status" "text",
    "campaign_id" "uuid",
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_leads_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_newsletter_subscriptions_20260422" (
    "id" "uuid",
    "email" "text",
    "is_active" boolean,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_newsletter_subscriptions_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_notifications_20260422" (
    "id" "uuid",
    "user_id" "uuid",
    "type" "text",
    "content" "text",
    "is_read" boolean,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_notifications_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_opportunities_20260422" (
    "id" "uuid",
    "user_id" "uuid",
    "title" "text",
    "description" "text",
    "type" "text",
    "domain_id" "uuid",
    "branch_id" "uuid",
    "speciality_id" "uuid",
    "location" "text",
    "remote_allowed" boolean,
    "daily_rate_min" numeric(10,2),
    "daily_rate_max" numeric(10,2),
    "start_date" "date",
    "duration" "text",
    "status" "text",
    "is_active" boolean,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_opportunities_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_organizations_20260422" (
    "id" "uuid",
    "user_id" "uuid",
    "name" "text",
    "siret" "text",
    "website" "text",
    "logo_url" "text",
    "size" "text",
    "sector" "text",
    "created_at" timestamp with time zone,
    "billing_address" "text",
    "billing_city" "text",
    "billing_zip" "text",
    "billing_country" "text",
    "vat_number" "text"
);


ALTER TABLE "public"."_backup_organizations_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_package_features_20260422" (
    "id" "uuid",
    "package_id" "uuid",
    "feature_id" "uuid",
    "limit_value" integer,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_package_features_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_package_history_20260422" (
    "id" "uuid",
    "user_id" "uuid",
    "old_package_id" "uuid",
    "new_package_id" "uuid",
    "changed_at" timestamp with time zone,
    "reason" "text"
);


ALTER TABLE "public"."_backup_package_history_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_packages_20260422" (
    "id" "uuid",
    "role_id" "uuid",
    "name" "text",
    "slug" "text",
    "price_monthly" numeric(10,2),
    "price_yearly" numeric(10,2),
    "is_active" boolean,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_packages_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_private_messages_20260422" (
    "id" "uuid",
    "conversation_id" "uuid",
    "sender_id" "uuid",
    "content" "text",
    "is_read" boolean,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_private_messages_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_profile_alerts_20260422" (
    "id" "uuid",
    "user_id" "uuid",
    "type" "text",
    "filters" "jsonb",
    "is_active" boolean,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_profile_alerts_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_profiles_20260422" (
    "id" "uuid",
    "user_id" "uuid",
    "first_name" "text",
    "last_name" "text",
    "avatar_url" "text",
    "bio" "text",
    "phone" "text",
    "location" "text",
    "linkedin_url" "text",
    "website_url" "text",
    "domain_id" "uuid",
    "branch_id" "uuid",
    "speciality_id" "uuid",
    "years_experience" integer,
    "daily_rate" numeric(10,2),
    "availability" "text",
    "score" integer,
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "billing_address" "text",
    "billing_city" "text",
    "billing_zip" "text",
    "billing_country" "text",
    "vat_number" "text"
);


ALTER TABLE "public"."_backup_profiles_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_promo_code_uses_20260422" (
    "id" "uuid",
    "promo_code_id" "uuid",
    "user_id" "uuid",
    "used_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_promo_code_uses_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_promo_codes_20260422" (
    "id" "uuid",
    "code" "text",
    "discount_percent" integer,
    "discount_amount" numeric(10,2),
    "max_uses" integer,
    "uses_count" integer,
    "expires_at" timestamp with time zone,
    "is_active" boolean,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_promo_codes_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_referrals_20260422" (
    "id" "uuid",
    "referrer_id" "uuid",
    "referred_email" "text",
    "status" "text",
    "reward_granted" boolean,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_referrals_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_roles_20260422" (
    "id" "uuid",
    "name" "text",
    "slug" "text",
    "description" "text",
    "is_active" boolean,
    "created_at" timestamp with time zone,
    "is_multi_domain" boolean
);


ALTER TABLE "public"."_backup_roles_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_shortlists_20260422" (
    "id" "uuid",
    "opportunity_id" "uuid",
    "user_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_shortlists_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_specialities_20260422" (
    "id" "uuid",
    "branch_id" "uuid",
    "name" "text",
    "slug" "text",
    "is_active" boolean,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_specialities_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_subscription_history_20260422" (
    "id" "uuid",
    "user_id" "uuid",
    "package_id" "uuid",
    "started_at" timestamp with time zone,
    "ended_at" timestamp with time zone,
    "status" "text",
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_subscription_history_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_testimonials_20260422" (
    "id" "uuid",
    "user_id" "uuid",
    "content" "text",
    "rating" integer,
    "is_published" boolean,
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_testimonials_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_transactions_20260422" (
    "id" "uuid",
    "user_id" "uuid",
    "package_id" "uuid",
    "amount" numeric(10,2),
    "currency" "text",
    "status" "text",
    "stripe_payment_id" "text",
    "created_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_transactions_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_backup_users_20260422" (
    "id" "uuid",
    "email" "text",
    "role" "text",
    "first_name" "text",
    "last_name" "text",
    "phone" "text",
    "language" "text",
    "is_active" boolean,
    "is_verified" boolean,
    "package_id" "uuid",
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "domain_id" "uuid",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."_backup_users_20260422" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ad_placements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "position" character varying(50) NOT NULL,
    "content_type" character varying(20),
    "entity_id" "uuid",
    "title" character varying(200),
    "image_url" character varying(500),
    "target_url" character varying(500),
    "active" boolean DEFAULT true NOT NULL,
    "valid_until" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ad_placements_content_type_check" CHECK ((("content_type")::"text" = ANY ((ARRAY['mission'::character varying, 'profile'::character varying, 'cabinet'::character varying, 'banner'::character varying])::"text"[])))
);


ALTER TABLE "public"."ad_placements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "action" character varying(50) NOT NULL,
    "entity_type" character varying(50) NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "detail" "jsonb",
    "ip_address" character varying(45),
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blocked_email_domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email_domain" character varying NOT NULL,
    "reason" "text",
    "added_by" "uuid",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."blocked_email_domains" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blog_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain_id" "uuid",
    "slug" character varying(200) NOT NULL,
    "title" character varying(200) NOT NULL,
    "excerpt" "text",
    "content" "text" NOT NULL,
    "author_id" "uuid",
    "cover_url" character varying(500),
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "status" character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "blog_posts_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'published'::character varying, 'archived'::character varying])::"text"[])))
);


ALTER TABLE "public"."blog_posts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."branches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "name" character varying(100) NOT NULL,
    "slug" character varying(50) NOT NULL,
    "description" "text",
    "icon_url" character varying(500),
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."branches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain_id" "uuid",
    "name" character varying(200) NOT NULL,
    "channel" character varying(50),
    "target_role" character varying(30),
    "start_date" "date",
    "end_date" "date",
    "budget" numeric(10,2),
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."candidature_views" (
    "user_id" "uuid" NOT NULL,
    "candidature_id" "uuid" NOT NULL,
    "viewed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."candidature_views" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."candidatures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "publication_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "match_id" "uuid",
    "domain_id" "uuid" NOT NULL,
    "cover_message" "text",
    "ai_match_score" numeric,
    "status" "text" DEFAULT 'received'::"text" NOT NULL,
    "status_reason" "text",
    "unlocked_at" timestamp with time zone,
    "preview" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "selected_at" timestamp with time zone,
    CONSTRAINT "candidatures_status_check" CHECK (("status" = ANY (ARRAY['received'::"text", 'in_review'::"text", 'shortlisted'::"text", 'unlocked'::"text", 'selected'::"text", 'rejected'::"text", 'withdrawn'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."candidatures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "candidature_id" "uuid",
    "domain_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "last_message_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "conversations_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'closed'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."countries" (
    "code" character varying(2) NOT NULL,
    "name_fr" character varying(100) NOT NULL,
    "name_en" character varying(100) NOT NULL,
    "name_es" character varying(100) NOT NULL,
    "name_de" character varying(100) NOT NULL,
    "flag_emoji" character varying(10) NOT NULL,
    "phone_code" character varying(6),
    "region" character varying(30),
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."countries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dashboard_stats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "metric_key" character varying(50) NOT NULL,
    "metric_value" numeric(15,2) NOT NULL,
    "period" character varying(20) NOT NULL,
    "period_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dashboard_stats_period_check" CHECK ((("period")::"text" = ANY ((ARRAY['daily'::character varying, 'weekly'::character varying, 'monthly'::character varying, 'yearly'::character varying, 'all_time'::character varying])::"text"[])))
);


ALTER TABLE "public"."dashboard_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."domain_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "logo_url" character varying(500),
    "favicon_url" character varying(500),
    "primary_color" character varying(7) DEFAULT '#0078D4'::character varying NOT NULL,
    "secondary_color" character varying(7) DEFAULT '#005A9E'::character varying NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "featured_products" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "ecosystem_expert_label" character varying(100) DEFAULT 'expert certifié'::character varying NOT NULL,
    "ecosystem_community_label" character varying(100) DEFAULT 'écosystème'::character varying NOT NULL,
    "ecosystem_speciality_label" character varying(100) DEFAULT 'Spécialité principale'::character varying NOT NULL,
    "ecosystem_domain_search_label" character varying(100) DEFAULT 'Domaine recherché'::character varying NOT NULL,
    "cms_content" "jsonb",
    "seo_meta" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."domain_configs" OWNER TO "postgres";


COMMENT ON TABLE "public"."domain_configs" IS 'Présentation, branding et vocabulaire par domaine. Une ligne par domaine (1-1).';



COMMENT ON COLUMN "public"."domain_configs"."tags" IS 'Technologies/produits du domaine. Indexé GIN pour recherche/matching.';



COMMENT ON COLUMN "public"."domain_configs"."cms_content" IS 'Contenus éditoriaux libres (FAQ, pages, bannières) gérés depuis le back-office admin.';



CREATE TABLE IF NOT EXISTS "public"."domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tagline" character varying(200),
    "launch_date" "date",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."domains" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."features" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" character varying(50) NOT NULL,
    "name" character varying(100) NOT NULL,
    "description" "text",
    "category" character varying(50) NOT NULL,
    "value_type" character varying(20) NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "features_value_type_check" CHECK ((("value_type")::"text" = ANY ((ARRAY['integer'::character varying, 'boolean'::character varying, 'unlimited'::character varying, 'string'::character varying])::"text"[])))
);


ALTER TABLE "public"."features" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain_id" "uuid",
    "campaign_id" "uuid",
    "email" character varying(255) NOT NULL,
    "first_name" character varying(100),
    "last_name" character varying(100),
    "source" character varying(100),
    "utm_json" "jsonb",
    "status" character varying(20) DEFAULT 'new'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "leads_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['new'::character varying, 'contacted'::character varying, 'qualified'::character varying, 'converted'::character varying, 'lost'::character varying])::"text"[])))
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."matches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "publication_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "score" numeric NOT NULL,
    "explanation" "jsonb",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "matches_score_range_check" CHECK ((("score" >= (0)::numeric) AND ("score" <= (10)::numeric))),
    CONSTRAINT "matches_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'notified'::"text", 'viewed'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."matches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."newsletter_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain_id" "uuid",
    "email" character varying(255) NOT NULL,
    "confirmed" boolean DEFAULT false NOT NULL,
    "unsubscribed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."newsletter_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "type" character varying(50) NOT NULL,
    "channel" character varying(20) DEFAULT 'inapp'::character varying NOT NULL,
    "title" character varying(200),
    "body" "text",
    "link_url" character varying(500),
    "status" character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone,
    "entity_id" "uuid",
    CONSTRAINT "notifications_channel_check" CHECK ((("channel")::"text" = ANY ((ARRAY['email'::character varying, 'inapp'::character varying, 'both'::character varying])::"text"[]))),
    CONSTRAINT "notifications_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'failed'::character varying, 'read'::character varying])::"text"[])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "activated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "package_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."organization_domains" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "email" character varying NOT NULL,
    "token" character varying NOT NULL,
    "role_in_org" character varying DEFAULT 'viewer'::character varying NOT NULL,
    "invited_by" "uuid",
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "accepted_at" timestamp with time zone,
    "status" character varying DEFAULT 'pending'::character varying NOT NULL,
    "domain_validation_passed" boolean DEFAULT false NOT NULL,
    "email_already_exists" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organization_invitations_role_check" CHECK ((("role_in_org")::"text" = ANY ((ARRAY['admin'::character varying, 'editor'::character varying, 'viewer'::character varying])::"text"[]))),
    CONSTRAINT "organization_invitations_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'expired'::character varying, 'revoked'::character varying])::"text"[])))
);


ALTER TABLE "public"."organization_invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "role_in_org" character varying DEFAULT 'viewer'::character varying NOT NULL,
    "status" character varying DEFAULT 'active'::character varying NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "invited_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organization_members_role_check" CHECK ((("role_in_org")::"text" = ANY ((ARRAY['admin'::character varying, 'editor'::character varying, 'viewer'::character varying])::"text"[]))),
    CONSTRAINT "organization_members_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['active'::character varying, 'pending'::character varying, 'suspended'::character varying, 'removed'::character varying])::"text"[])))
);


ALTER TABLE "public"."organization_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_type" character varying(30) NOT NULL,
    "company_name" character varying(200) NOT NULL,
    "siren" character varying(20),
    "vat_number" character varying(30),
    "sector" character varying(100),
    "country" character varying(2) DEFAULT 'FR'::character varying NOT NULL,
    "size" character varying(20),
    "description" "text",
    "logo_url" character varying(500),
    "website_url" character varying(500),
    "is_verified" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email_domain" character varying,
    "verification_status" character varying,
    "verification_method" character varying,
    "verification_data" "jsonb",
    "verified_at" timestamp with time zone,
    "verified_by" "uuid",
    "verification_notes" "text",
    "setup_completed_at" timestamp with time zone,
    "review_reason" "text",
    CONSTRAINT "organizations_org_type_check" CHECK ((("org_type")::"text" = ANY ((ARRAY['client'::character varying, 'cabinet'::character varying, 'esn'::character varying])::"text"[]))),
    CONSTRAINT "organizations_size_check" CHECK ((("size")::"text" = ANY ((ARRAY['1-10'::character varying, '11-50'::character varying, '51-200'::character varying, '201-500'::character varying, '501-1000'::character varying, '1000+'::character varying])::"text"[]))),
    CONSTRAINT "organizations_verification_method_check" CHECK ((("verification_method" IS NULL) OR (("verification_method")::"text" = ANY ((ARRAY['official_api'::character varying, 'ai_web_search'::character varying, 'manual_admin'::character varying])::"text"[])))),
    CONSTRAINT "organizations_verification_status_check" CHECK ((("verification_status" IS NULL) OR (("verification_status")::"text" = ANY ((ARRAY['pending_provider_check'::character varying, 'pending_admin_review'::character varying, 'approved'::character varying, 'rejected'::character varying, 'requires_more_info'::character varying])::"text"[]))))
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."organizations"."verified_at" IS 'Timestamp de la décision — rempli pour approved ET rejected. Cf. B5.';



COMMENT ON COLUMN "public"."organizations"."verified_by" IS 'Auteur de la décision de vérification. NULL = approval automatique. Non-null = décision manuelle admin. Cf. B5.';



COMMENT ON COLUMN "public"."organizations"."setup_completed_at" IS 'Timestamp de complétion de la modale setup post-login (B3.4). NULL = setup à faire ; not null = setup OK.';



COMMENT ON COLUMN "public"."organizations"."review_reason" IS 'Motif optionnel de la décision admin (surtout pour les refus). NULL = aucun motif. Cf. B5.';



CREATE TABLE IF NOT EXISTS "public"."package_features" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "package_id" "uuid" NOT NULL,
    "feature_code" character varying(50) NOT NULL,
    "value" character varying(50) NOT NULL,
    "reset_period" character varying(20),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "package_features_reset_period_check" CHECK ((("reset_period")::"text" = ANY ((ARRAY['never'::character varying, 'daily'::character varying, 'weekly'::character varying, 'monthly'::character varying, 'yearly'::character varying])::"text"[])))
);


ALTER TABLE "public"."package_features" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."package_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "package_id" "uuid" NOT NULL,
    "snapshot" "jsonb" NOT NULL,
    "changed_by" "uuid",
    "change_reason" character varying(200),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."package_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain_id" "uuid",
    "name" character varying(100) NOT NULL,
    "slug" character varying(50) NOT NULL,
    "target_role" character varying(30) NOT NULL,
    "description" "text",
    "price_monthly" numeric(10,2),
    "price_yearly" numeric(10,2),
    "currency" character varying(3) DEFAULT 'EUR'::character varying NOT NULL,
    "stripe_price_id_monthly" character varying(200),
    "stripe_price_id_yearly" character varying(200),
    "stripe_product_id" character varying(200),
    "is_default" boolean DEFAULT false NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "scope" character varying DEFAULT 'user'::character varying NOT NULL,
    "included_domain_ids" "uuid"[],
    "max_seats" integer,
    CONSTRAINT "packages_max_seats_positive_check" CHECK ((("max_seats" IS NULL) OR ("max_seats" > 0))),
    CONSTRAINT "packages_scope_check" CHECK ((("scope")::"text" = ANY ((ARRAY['organization'::character varying, 'user'::character varying, 'organization_per_seat'::character varying])::"text"[]))),
    CONSTRAINT "packages_target_role_check" CHECK ((("target_role")::"text" = ANY ((ARRAY['expert_freelance'::character varying, 'expert_cdi'::character varying, 'client'::character varying, 'cabinet'::character varying])::"text"[])))
);


ALTER TABLE "public"."packages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "speciality_id" "uuid",
    "seniority" character varying(20),
    "work_mode" character varying(30),
    "location" character varying(100),
    "accept_direct_message" boolean DEFAULT false NOT NULL,
    "frequency" character varying(20) DEFAULT 'daily'::character varying NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profile_alerts_frequency_check" CHECK ((("frequency")::"text" = ANY ((ARRAY['immediate'::character varying, 'daily'::character varying, 'weekly'::character varying])::"text"[])))
);


ALTER TABLE "public"."profile_alerts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_educations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "school" character varying(200) NOT NULL,
    "degree" character varying(200) NOT NULL,
    "field" character varying(200),
    "start_year" integer,
    "end_year" integer,
    "location" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profile_educations_check" CHECK ((("end_year" IS NULL) OR ("start_year" IS NULL) OR ("end_year" >= "start_year"))),
    CONSTRAINT "profile_educations_end_year_check" CHECK ((("end_year" IS NULL) OR (("end_year" > 1950) AND ("end_year" < ((EXTRACT(year FROM "now"()))::integer + 10))))),
    CONSTRAINT "profile_educations_start_year_check" CHECK ((("start_year" IS NULL) OR (("start_year" > 1950) AND ("start_year" < ((EXTRACT(year FROM "now"()))::integer + 1)))))
);


ALTER TABLE "public"."profile_educations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_experiences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "role" character varying(200) NOT NULL,
    "client_name" character varying(200),
    "sector" character varying(100),
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "is_current" boolean DEFAULT false NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "experience_type" character varying(20) DEFAULT 'project'::character varying NOT NULL,
    "employer" character varying(200),
    CONSTRAINT "profile_experiences_check" CHECK ((("end_date" IS NULL) OR ("end_date" >= "start_date"))),
    CONSTRAINT "profile_experiences_experience_type_check" CHECK ((("experience_type")::"text" = ANY ((ARRAY['career'::character varying, 'project'::character varying])::"text"[])))
);


ALTER TABLE "public"."profile_experiences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_languages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "language" character varying(50) NOT NULL,
    "level" character varying(10) NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profile_languages_level_check" CHECK ((("level")::"text" = ANY ((ARRAY['A1'::character varying, 'A2'::character varying, 'B1'::character varying, 'B2'::character varying, 'C1'::character varying, 'C2'::character varying, 'native'::character varying])::"text"[])))
);


ALTER TABLE "public"."profile_languages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "speciality_id" "uuid",
    "expert_type" character varying(20),
    "title" character varying(200),
    "summary" "text",
    "seniority" character varying(20),
    "years_experience" integer,
    "languages" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "skills" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "certifications" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "location" character varying(100),
    "mobility" character varying(50),
    "tjm_min" integer,
    "tjm_max" integer,
    "salary_min" integer,
    "salary_max" integer,
    "availability_date" "date",
    "cv_url" character varying(500),
    "linkedin_url" character varying(500),
    "visible" boolean DEFAULT true NOT NULL,
    "profile_score" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "cv_file_path" character varying(500),
    "cv_hash" character varying(64),
    "cv_uploaded_at" timestamp with time zone,
    "cv_parsing_status" character varying(20),
    "cv_parsing_error" "text",
    "cv_parsed_at" timestamp with time zone,
    "cv_parsing_count_24h" integer DEFAULT 0,
    "cv_parsing_reset_at" timestamp with time zone,
    "ai_consent_at" timestamp with time zone,
    "phone" character varying(30),
    "address_line" character varying(200),
    "postal_code" character varying(20),
    "city" character varying(100),
    "country" character varying(2) DEFAULT 'FR'::character varying,
    "birth_year" integer,
    "photo_url" character varying(500),
    "years_total_experience" integer,
    "availability_status" character varying(20),
    "work_modes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "cdi_status" "text",
    "cdi_notice_period" "text",
    "cdi_availability_date" "date",
    "cdi_confidential_mode" boolean DEFAULT false,
    "cdi_salary_min" integer,
    "cdi_salary_max" integer,
    "cdi_variable_pct" integer,
    "cdi_benefits" "text"[],
    "cdi_company_size" "text"[],
    "cdi_sectors" "text"[],
    "cdi_geo_mobility" "text",
    "cdi_contract_types" "text"[],
    "cdi_motivations" "text",
    "cdi_career_goals" "text",
    "verification_status" character varying,
    "verification_method" character varying,
    "verification_score" numeric,
    "verification_data" "jsonb",
    "verified_at" timestamp with time zone,
    "verified_by" "uuid",
    "review_reason" "text",
    "deletion_scheduled_at" timestamp with time zone,
    "pre_deletion_visible" boolean,
    CONSTRAINT "profiles_availability_status_check" CHECK ((("availability_status" IS NULL) OR (("availability_status")::"text" = ANY ((ARRAY['available'::character varying, 'do_not_disturb'::character varying])::"text"[])))),
    CONSTRAINT "profiles_birth_year_check" CHECK ((("birth_year" IS NULL) OR (("birth_year" > 1920) AND ("birth_year" < (EXTRACT(year FROM "now"()))::integer)))),
    CONSTRAINT "profiles_cdi_geo_mobility_check" CHECK ((("cdi_geo_mobility" IS NULL) OR ("cdi_geo_mobility" = ANY (ARRAY['local'::"text", 'regional'::"text", 'national'::"text", 'international'::"text"])))),
    CONSTRAINT "profiles_cdi_notice_period_check" CHECK ((("cdi_notice_period" IS NULL) OR ("cdi_notice_period" = ANY (ARRAY['immediate'::"text", '1_month'::"text", '2_months'::"text", '3_months'::"text", 'negotiable'::"text"])))),
    CONSTRAINT "profiles_cdi_salary_max_check" CHECK ((("cdi_salary_max" IS NULL) OR ("cdi_salary_max" >= 0))),
    CONSTRAINT "profiles_cdi_salary_min_check" CHECK ((("cdi_salary_min" IS NULL) OR ("cdi_salary_min" >= 0))),
    CONSTRAINT "profiles_cdi_salary_range_check" CHECK ((("cdi_salary_min" IS NULL) OR ("cdi_salary_max" IS NULL) OR ("cdi_salary_min" <= "cdi_salary_max"))),
    CONSTRAINT "profiles_cdi_status_check" CHECK ((("cdi_status" IS NULL) OR ("cdi_status" = ANY (ARRAY['employed'::"text", 'open_to_work'::"text"])))),
    CONSTRAINT "profiles_cdi_variable_pct_check" CHECK ((("cdi_variable_pct" IS NULL) OR (("cdi_variable_pct" >= 0) AND ("cdi_variable_pct" <= 100)))),
    CONSTRAINT "profiles_cv_parsing_status_check" CHECK ((("cv_parsing_status")::"text" = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'done'::character varying, 'failed'::character varying])::"text"[]))),
    CONSTRAINT "profiles_expert_type_check" CHECK ((("expert_type")::"text" = ANY ((ARRAY['freelance'::character varying, 'cdi'::character varying])::"text"[]))),
    CONSTRAINT "profiles_seniority_check" CHECK ((("seniority")::"text" = ANY ((ARRAY['junior'::character varying, 'confirmed'::character varying, 'senior'::character varying, 'expert'::character varying])::"text"[]))),
    CONSTRAINT "profiles_verification_status_check" CHECK ((("verification_status" IS NULL) OR (("verification_status")::"text" = ANY ((ARRAY['pending'::character varying, 'pending_admin_review'::character varying, 'approved'::character varying, 'rejected'::character varying, 'requires_more_info'::character varying])::"text"[])))),
    CONSTRAINT "profiles_work_modes_valid" CHECK (("work_modes" <@ ARRAY['remote'::"text", 'onsite'::"text", 'hybrid'::"text"])),
    CONSTRAINT "profiles_years_total_experience_check" CHECK ((("years_total_experience" IS NULL) OR (("years_total_experience" >= 0) AND ("years_total_experience" <= 70))))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."verification_status" IS 'État vérif expert : pending|pending_admin_review|approved|rejected|requires_more_info';



COMMENT ON COLUMN "public"."profiles"."verification_method" IS 'ai_web_search (IA seule) | manual_only (admin sans IA)';



COMMENT ON COLUMN "public"."profiles"."verification_score" IS 'Score IA 0..10 — confiance cohérence (3 axes : CV↔profil / domaine / LinkedIn)';



COMMENT ON COLUMN "public"."profiles"."verification_data" IS 'Trace IA : { score, notes, discrepancies, flags, last_provider, attempts_count, web_search_used }';



COMMENT ON COLUMN "public"."profiles"."verified_at" IS 'Moment de la décision (rempli même pour rejet)';



COMMENT ON COLUMN "public"."profiles"."verified_by" IS 'Admin qui a tranché (NULL pour auto-approve par l''IA)';



COMMENT ON COLUMN "public"."profiles"."review_reason" IS 'Motif admin (surtout pour les refus, visible dans la bannière dashboard expert)';



COMMENT ON COLUMN "public"."profiles"."deletion_scheduled_at" IS 'S3 — miroir de users.deletion_scheduled_at (marqueur ; la logique de matching ne le lit pas — elle continue de lire profiles.visible).';



COMMENT ON COLUMN "public"."profiles"."pre_deletion_visible" IS 'S3 — valeur de profiles.visible AVANT le flip à false lors de la programmation de suppression. Sert à restaurer exactement le même état à la réactivation.';



CREATE TABLE IF NOT EXISTS "public"."promo_code_uses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "promo_code_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "transaction_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."promo_code_uses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."promo_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain_id" "uuid",
    "code" character varying(50) NOT NULL,
    "discount_type" character varying(20) NOT NULL,
    "discount_value" numeric(10,2) NOT NULL,
    "max_uses" integer,
    "used_count" integer DEFAULT 0 NOT NULL,
    "valid_from" timestamp with time zone,
    "valid_until" timestamp with time zone,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "promo_codes_discount_type_check" CHECK ((("discount_type")::"text" = ANY ((ARRAY['percent'::character varying, 'amount'::character varying])::"text"[])))
);


ALTER TABLE "public"."promo_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."public_email_domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email_domain" character varying NOT NULL,
    "reason" "text",
    "added_by" "uuid",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."public_email_domains" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."publications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "domain_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "branch_id" "uuid",
    "speciality_id" "uuid",
    "skills_required" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "seniority" "text",
    "work_mode" "text",
    "location" "text",
    "duration" "text",
    "start_date" "date",
    "budget_min" numeric,
    "budget_max" numeric,
    "confidential" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "verification_score" numeric,
    "verification_method" "text",
    "verification_data" "jsonb",
    "verified_by" "uuid",
    "verified_at" timestamp with time zone,
    "review_reason" "text",
    "published_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "publications_budget_range_check" CHECK ((("budget_min" IS NULL) OR ("budget_max" IS NULL) OR ("budget_min" <= "budget_max"))),
    CONSTRAINT "publications_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'pending_review'::"text", 'published'::"text", 'suspended'::"text", 'expired'::"text", 'archived'::"text", 'rejected'::"text"]))),
    CONSTRAINT "publications_type_check" CHECK (("type" = ANY (ARRAY['mission'::"text", 'offre'::"text"])))
);


ALTER TABLE "public"."publications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referrals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "referrer_id" "uuid" NOT NULL,
    "referred_id" "uuid",
    "referral_code" character varying(50) NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    "reward_value" numeric(10,2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "referrals_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'completed'::character varying, 'rewarded'::character varying, 'expired'::character varying])::"text"[])))
);


ALTER TABLE "public"."referrals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(50) NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."session_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "ip_address" "inet",
    "user_agent" "text",
    "login_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "session_token" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."session_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."specialities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "name" character varying(100) NOT NULL,
    "slug" character varying(50) NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."specialities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscription_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "package_from" character varying(100),
    "package_to" character varying(100) NOT NULL,
    "change_reason" character varying(100),
    "transaction_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subscription_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."testimonials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "domain_id" "uuid",
    "user_id" "uuid",
    "author_name" character varying(100),
    "author_role" character varying(100),
    "content" "text" NOT NULL,
    "rating" integer,
    "published" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "testimonials_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."testimonials" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "package_id" "uuid",
    "domain_id" "uuid" NOT NULL,
    "stripe_payment_intent_id" character varying(200),
    "stripe_subscription_id" character varying(200),
    "stripe_customer_id" character varying(200),
    "amount" numeric(10,2) NOT NULL,
    "currency" character varying(3) DEFAULT 'EUR'::character varying NOT NULL,
    "status" character varying(20) NOT NULL,
    "billing_period" character varying(20),
    "period_start" timestamp with time zone,
    "period_end" timestamp with time zone,
    "invoice_url" character varying(500),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "transactions_billing_period_check" CHECK ((("billing_period")::"text" = ANY ((ARRAY['monthly'::character varying, 'yearly'::character varying, 'one_time'::character varying])::"text"[]))),
    CONSTRAINT "transactions_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'success'::character varying, 'failed'::character varying, 'refunded'::character varying, 'canceled'::character varying])::"text"[])))
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."translations" (
    "table_name" character varying(50) NOT NULL,
    "row_id" "uuid" NOT NULL,
    "field" character varying(50) NOT NULL,
    "locale" character varying(5) NOT NULL,
    "value" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."translations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_section_visits" (
    "user_id" "uuid" NOT NULL,
    "section" "text" NOT NULL,
    "last_visited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_section_visits_section_check" CHECK (("section" = ANY (ARRAY['missions'::"text", 'candidatures_expert'::"text", 'candidatures_org'::"text", 'annonces_org'::"text"])))
);


ALTER TABLE "public"."user_section_visits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "email" character varying(255) NOT NULL,
    "role_id" "uuid" NOT NULL,
    "domain_id" "uuid" NOT NULL,
    "user_type" character varying(30) NOT NULL,
    "status" character varying(20) DEFAULT 'active'::character varying NOT NULL,
    "email_verified" boolean DEFAULT false NOT NULL,
    "is_verified" boolean DEFAULT false NOT NULL,
    "first_name" character varying(100),
    "last_name" character varying(100),
    "phone" character varying(30),
    "locale" character varying(10) DEFAULT 'fr'::character varying NOT NULL,
    "last_login_at" timestamp with time zone,
    "last_session_token" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "phone_verified" boolean DEFAULT false NOT NULL,
    "civility" "text",
    "job_title" "text",
    "linkedin_url" "text",
    "deletion_scheduled_at" timestamp with time zone,
    "anonymized_at" timestamp with time zone,
    CONSTRAINT "users_civility_check" CHECK ((("civility" IS NULL) OR ("civility" = ANY (ARRAY['mr'::"text", 'mrs'::"text", 'mx'::"text"])))),
    CONSTRAINT "users_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'in_review'::character varying, 'suspended'::character varying, 'rejected'::character varying, 'archived'::character varying])::"text"[]))),
    CONSTRAINT "users_user_type_check" CHECK ((("user_type")::"text" = ANY ((ARRAY['expert_freelance'::character varying, 'expert_cdi'::character varying, 'client'::character varying, 'cabinet'::character varying, 'admin'::character varying])::"text"[])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON COLUMN "public"."users"."civility" IS 'M./Mme/Mx — collecté en modale post-login (B3.4). NULL = pas encore renseigné.';



COMMENT ON COLUMN "public"."users"."job_title" IS 'Poste occupé par l''user dans l''organisation — modale post-login (B3.4).';



COMMENT ON COLUMN "public"."users"."linkedin_url" IS 'URL profil LinkedIn (optionnelle) — modale post-login (B3.4).';



COMMENT ON COLUMN "public"."users"."deletion_scheduled_at" IS 'S3 — date d''effacement définitif programmé (now()+90j). NULL = compte actif. Pendant la grâce : login autorisé uniquement pour réactiver. Effacée à la réactivation.';



COMMENT ON COLUMN "public"."users"."anonymized_at" IS 'S3 — horodatage de la purge effective (PII anonymisées + login banni). NULL tant que non purgé. Une fois posé, le login est définitivement bloqué.';



CREATE TABLE IF NOT EXISTS "public"."verification_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "provider_used" character varying NOT NULL,
    "result" character varying NOT NULL,
    "confidence_score" integer,
    "raw_response" "jsonb",
    "triggered_admin_review" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "verification_attempts_confidence_check" CHECK ((("confidence_score" IS NULL) OR (("confidence_score" >= 0) AND ("confidence_score" <= 10)))),
    CONSTRAINT "verification_attempts_result_check" CHECK ((("result")::"text" = ANY ((ARRAY['approved'::character varying, 'rejected'::character varying, 'inconclusive'::character varying, 'error'::character varying])::"text"[])))
);


ALTER TABLE "public"."verification_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."verification_providers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "country_code" character varying(2) NOT NULL,
    "provider_type" character varying NOT NULL,
    "provider_name" character varying NOT NULL,
    "api_endpoint" "text",
    "api_key_secret_ref" character varying,
    "is_active" boolean DEFAULT true NOT NULL,
    "priority" integer DEFAULT 100 NOT NULL,
    "confidence_threshold" integer DEFAULT 9 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "config" "jsonb",
    CONSTRAINT "verification_providers_confidence_check" CHECK ((("confidence_threshold" >= 0) AND ("confidence_threshold" <= 10))),
    CONSTRAINT "verification_providers_type_check" CHECK ((("provider_type")::"text" = ANY ((ARRAY['official_api'::character varying, 'ai_web_search'::character varying, 'manual_only'::character varying, 'opportunity_quality_check'::character varying, 'profile_matching'::character varying, 'profile_verification'::character varying])::"text"[])))
);


ALTER TABLE "public"."verification_providers" OWNER TO "postgres";


COMMENT ON COLUMN "public"."verification_providers"."api_endpoint" IS 'TODO V2 : actuellement NON UTILISÉ par le code. L''endpoint est en dur dans lib/verification/sirene.ts (const SIRENE_BASE_URL) et autres providers. À utiliser dans une future refacto pour permettre changement d''endpoint sans redéploiement.';



COMMENT ON COLUMN "public"."verification_providers"."config" IS 'Configuration spécifique au provider (jsonb extensible). Exemples : { "model": "claude-haiku-4-5-20251001", "max_candidates": 100, "max_tokens": 3000 }';



CREATE TABLE IF NOT EXISTS "public"."waitlist" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "first_name" "text",
    "role_interest" "text",
    "source" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."waitlist" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ad_placements"
    ADD CONSTRAINT "ad_placements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blocked_email_domains"
    ADD CONSTRAINT "blocked_email_domains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."blog_posts"
    ADD CONSTRAINT "blog_posts_domain_id_slug_key" UNIQUE ("domain_id", "slug");



ALTER TABLE ONLY "public"."blog_posts"
    ADD CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_domain_id_slug_key" UNIQUE ("domain_id", "slug");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."candidature_views"
    ADD CONSTRAINT "candidature_views_pkey" PRIMARY KEY ("user_id", "candidature_id");



ALTER TABLE ONLY "public"."candidatures"
    ADD CONSTRAINT "candidatures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."candidatures"
    ADD CONSTRAINT "candidatures_publication_profile_unique" UNIQUE ("publication_id", "profile_id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_candidature_unique" UNIQUE ("candidature_id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."countries"
    ADD CONSTRAINT "countries_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."dashboard_stats"
    ADD CONSTRAINT "dashboard_stats_domain_id_metric_key_period_period_date_key" UNIQUE ("domain_id", "metric_key", "period", "period_date");



ALTER TABLE ONLY "public"."dashboard_stats"
    ADD CONSTRAINT "dashboard_stats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."domain_configs"
    ADD CONSTRAINT "domain_configs_domain_id_key" UNIQUE ("domain_id");



ALTER TABLE ONLY "public"."domain_configs"
    ADD CONSTRAINT "domain_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."domains"
    ADD CONSTRAINT "domains_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."domains"
    ADD CONSTRAINT "domains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."domains"
    ADD CONSTRAINT "domains_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."features"
    ADD CONSTRAINT "features_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."features"
    ADD CONSTRAINT "features_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_publication_profile_unique" UNIQUE ("publication_id", "profile_id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."newsletter_subscriptions"
    ADD CONSTRAINT "newsletter_subscriptions_domain_id_email_key" UNIQUE ("domain_id", "email");



ALTER TABLE ONLY "public"."newsletter_subscriptions"
    ADD CONSTRAINT "newsletter_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_domains"
    ADD CONSTRAINT "organization_domains_org_domain_unique" UNIQUE ("organization_id", "domain_id");



ALTER TABLE ONLY "public"."organization_domains"
    ADD CONSTRAINT "organization_domains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_invitations"
    ADD CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_invitations"
    ADD CONSTRAINT "organization_invitations_token_unique" UNIQUE ("token");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_user_org_unique" UNIQUE ("user_id", "organization_id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."package_features"
    ADD CONSTRAINT "package_features_package_id_feature_code_key" UNIQUE ("package_id", "feature_code");



ALTER TABLE ONLY "public"."package_features"
    ADD CONSTRAINT "package_features_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."package_history"
    ADD CONSTRAINT "package_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_domain_id_slug_target_role_key" UNIQUE ("domain_id", "slug", "target_role");



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_alerts"
    ADD CONSTRAINT "profile_alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_educations"
    ADD CONSTRAINT "profile_educations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_experiences"
    ADD CONSTRAINT "profile_experiences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_languages"
    ADD CONSTRAINT "profile_languages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profile_languages"
    ADD CONSTRAINT "profile_languages_profile_id_language_key" UNIQUE ("profile_id", "language");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."promo_code_uses"
    ADD CONSTRAINT "promo_code_uses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."promo_code_uses"
    ADD CONSTRAINT "promo_code_uses_promo_code_id_user_id_key" UNIQUE ("promo_code_id", "user_id");



ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."public_email_domains"
    ADD CONSTRAINT "public_email_domains_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."publications"
    ADD CONSTRAINT "publications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referral_code_key" UNIQUE ("referral_code");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."session_logs"
    ADD CONSTRAINT "session_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."specialities"
    ADD CONSTRAINT "specialities_branch_id_slug_key" UNIQUE ("branch_id", "slug");



ALTER TABLE ONLY "public"."specialities"
    ADD CONSTRAINT "specialities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_history"
    ADD CONSTRAINT "subscription_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."testimonials"
    ADD CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."translations"
    ADD CONSTRAINT "translations_pkey" PRIMARY KEY ("table_name", "row_id", "field", "locale");



ALTER TABLE ONLY "public"."user_section_visits"
    ADD CONSTRAINT "user_section_visits_pkey" PRIMARY KEY ("user_id", "section");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."verification_attempts"
    ADD CONSTRAINT "verification_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."verification_providers"
    ADD CONSTRAINT "verification_providers_country_name_unique" UNIQUE ("country_code", "provider_name");



ALTER TABLE ONLY "public"."verification_providers"
    ADD CONSTRAINT "verification_providers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."waitlist"
    ADD CONSTRAINT "waitlist_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."waitlist"
    ADD CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id");



CREATE INDEX "blocked_email_domains_active_idx" ON "public"."blocked_email_domains" USING "btree" ("active") WHERE ("active" = true);



CREATE UNIQUE INDEX "blocked_email_domains_domain_unique_idx" ON "public"."blocked_email_domains" USING "btree" ("lower"(("email_domain")::"text"));



CREATE INDEX "candidature_views_cand_idx" ON "public"."candidature_views" USING "btree" ("candidature_id");



CREATE INDEX "candidatures_domain_idx" ON "public"."candidatures" USING "btree" ("domain_id");



CREATE INDEX "candidatures_match_idx" ON "public"."candidatures" USING "btree" ("match_id") WHERE ("match_id" IS NOT NULL);



CREATE INDEX "candidatures_profile_idx" ON "public"."candidatures" USING "btree" ("profile_id");



CREATE INDEX "candidatures_publication_idx" ON "public"."candidatures" USING "btree" ("publication_id");



CREATE INDEX "candidatures_selected_idx" ON "public"."candidatures" USING "btree" ("profile_id", "selected_at" DESC) WHERE ("status" = 'selected'::"text");



CREATE INDEX "candidatures_status_idx" ON "public"."candidatures" USING "btree" ("status");



CREATE INDEX "conversations_domain_idx" ON "public"."conversations" USING "btree" ("domain_id");



CREATE INDEX "conversations_last_message_idx" ON "public"."conversations" USING "btree" ("last_message_at" DESC NULLS LAST);



CREATE INDEX "conversations_status_idx" ON "public"."conversations" USING "btree" ("status");



CREATE INDEX "idx_ad_placements_active" ON "public"."ad_placements" USING "btree" ("active");



CREATE INDEX "idx_ad_placements_domain_id" ON "public"."ad_placements" USING "btree" ("domain_id");



CREATE INDEX "idx_ad_placements_position" ON "public"."ad_placements" USING "btree" ("position");



CREATE INDEX "idx_audit_logs_action" ON "public"."audit_logs" USING "btree" ("action");



CREATE INDEX "idx_audit_logs_domain_id" ON "public"."audit_logs" USING "btree" ("domain_id");



CREATE INDEX "idx_audit_logs_entity" ON "public"."audit_logs" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_audit_logs_user_id" ON "public"."audit_logs" USING "btree" ("user_id");



CREATE INDEX "idx_blog_posts_domain_id" ON "public"."blog_posts" USING "btree" ("domain_id");



CREATE INDEX "idx_blog_posts_status" ON "public"."blog_posts" USING "btree" ("status");



CREATE INDEX "idx_blog_posts_tags_gin" ON "public"."blog_posts" USING "gin" ("tags");



CREATE INDEX "idx_branches_active" ON "public"."branches" USING "btree" ("active");



CREATE INDEX "idx_branches_domain_id" ON "public"."branches" USING "btree" ("domain_id");



CREATE INDEX "idx_campaigns_active" ON "public"."campaigns" USING "btree" ("active");



CREATE INDEX "idx_campaigns_domain_id" ON "public"."campaigns" USING "btree" ("domain_id");



CREATE INDEX "idx_countries_active_sort" ON "public"."countries" USING "btree" ("active", "sort_order");



CREATE INDEX "idx_countries_region" ON "public"."countries" USING "btree" ("region");



CREATE INDEX "idx_dashboard_stats_domain_id" ON "public"."dashboard_stats" USING "btree" ("domain_id");



CREATE INDEX "idx_dashboard_stats_metric" ON "public"."dashboard_stats" USING "btree" ("metric_key");



CREATE INDEX "idx_dashboard_stats_period" ON "public"."dashboard_stats" USING "btree" ("period", "period_date");



CREATE INDEX "idx_domain_configs_domain_id" ON "public"."domain_configs" USING "btree" ("domain_id");



CREATE INDEX "idx_domain_configs_tags_gin" ON "public"."domain_configs" USING "gin" ("tags");



CREATE INDEX "idx_domains_active" ON "public"."domains" USING "btree" ("active");



CREATE INDEX "idx_domains_slug" ON "public"."domains" USING "btree" ("slug");



CREATE INDEX "idx_features_category" ON "public"."features" USING "btree" ("category");



CREATE INDEX "idx_leads_campaign_id" ON "public"."leads" USING "btree" ("campaign_id");



CREATE INDEX "idx_leads_domain_id" ON "public"."leads" USING "btree" ("domain_id");



CREATE INDEX "idx_leads_email" ON "public"."leads" USING "btree" ("email");



CREATE INDEX "idx_leads_status" ON "public"."leads" USING "btree" ("status");



CREATE INDEX "idx_newsletter_subscriptions_domain_id" ON "public"."newsletter_subscriptions" USING "btree" ("domain_id");



CREATE INDEX "idx_newsletter_subscriptions_email" ON "public"."newsletter_subscriptions" USING "btree" ("email");



CREATE INDEX "idx_notifications_domain_id" ON "public"."notifications" USING "btree" ("domain_id");



CREATE INDEX "idx_notifications_status" ON "public"."notifications" USING "btree" ("status");



CREATE INDEX "idx_notifications_type" ON "public"."notifications" USING "btree" ("type");



CREATE INDEX "idx_notifications_user_id" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "idx_organizations_org_type" ON "public"."organizations" USING "btree" ("org_type");



CREATE INDEX "idx_organizations_siren" ON "public"."organizations" USING "btree" ("siren");



CREATE INDEX "idx_package_features_feature_code" ON "public"."package_features" USING "btree" ("feature_code");



CREATE INDEX "idx_package_features_package_id" ON "public"."package_features" USING "btree" ("package_id");



CREATE INDEX "idx_package_history_package_id" ON "public"."package_history" USING "btree" ("package_id");



CREATE INDEX "idx_packages_active" ON "public"."packages" USING "btree" ("active");



CREATE INDEX "idx_packages_domain_id" ON "public"."packages" USING "btree" ("domain_id");



CREATE INDEX "idx_packages_target_role" ON "public"."packages" USING "btree" ("target_role");



CREATE INDEX "idx_pedu_domain_id" ON "public"."profile_educations" USING "btree" ("domain_id");



CREATE INDEX "idx_pedu_profile_id" ON "public"."profile_educations" USING "btree" ("profile_id");



CREATE INDEX "idx_pexp_domain_id" ON "public"."profile_experiences" USING "btree" ("domain_id");



CREATE INDEX "idx_pexp_experience_type" ON "public"."profile_experiences" USING "btree" ("experience_type");



CREATE INDEX "idx_pexp_is_current" ON "public"."profile_experiences" USING "btree" ("is_current");



CREATE INDEX "idx_pexp_profile_id" ON "public"."profile_experiences" USING "btree" ("profile_id");



CREATE INDEX "idx_pexp_sector" ON "public"."profile_experiences" USING "btree" ("sector");



CREATE INDEX "idx_plang_language" ON "public"."profile_languages" USING "btree" ("language");



CREATE INDEX "idx_plang_profile_id" ON "public"."profile_languages" USING "btree" ("profile_id");



CREATE INDEX "idx_profile_alerts_active" ON "public"."profile_alerts" USING "btree" ("active");



CREATE INDEX "idx_profile_alerts_domain_id" ON "public"."profile_alerts" USING "btree" ("domain_id");



CREATE INDEX "idx_profile_alerts_user_id" ON "public"."profile_alerts" USING "btree" ("user_id");



CREATE INDEX "idx_profiles_availability_status" ON "public"."profiles" USING "btree" ("availability_status");



CREATE INDEX "idx_profiles_branch_id" ON "public"."profiles" USING "btree" ("branch_id");



CREATE INDEX "idx_profiles_city" ON "public"."profiles" USING "btree" ("city");



CREATE INDEX "idx_profiles_country" ON "public"."profiles" USING "btree" ("country");



CREATE INDEX "idx_profiles_cv_hash" ON "public"."profiles" USING "btree" ("cv_hash");



CREATE INDEX "idx_profiles_cv_parsing_status" ON "public"."profiles" USING "btree" ("cv_parsing_status");



CREATE INDEX "idx_profiles_domain_id" ON "public"."profiles" USING "btree" ("domain_id");



CREATE INDEX "idx_profiles_expert_type" ON "public"."profiles" USING "btree" ("expert_type");



CREATE INDEX "idx_profiles_skills_gin" ON "public"."profiles" USING "gin" ("skills");



CREATE INDEX "idx_profiles_speciality_id" ON "public"."profiles" USING "btree" ("speciality_id");



CREATE INDEX "idx_profiles_user_id" ON "public"."profiles" USING "btree" ("user_id");



CREATE INDEX "idx_profiles_work_modes_gin" ON "public"."profiles" USING "gin" ("work_modes");



CREATE INDEX "idx_promo_code_uses_promo_id" ON "public"."promo_code_uses" USING "btree" ("promo_code_id");



CREATE INDEX "idx_promo_code_uses_user_id" ON "public"."promo_code_uses" USING "btree" ("user_id");



CREATE INDEX "idx_promo_codes_active" ON "public"."promo_codes" USING "btree" ("active");



CREATE INDEX "idx_promo_codes_domain_id" ON "public"."promo_codes" USING "btree" ("domain_id");



CREATE INDEX "idx_referrals_referred_id" ON "public"."referrals" USING "btree" ("referred_id");



CREATE INDEX "idx_referrals_referrer_id" ON "public"."referrals" USING "btree" ("referrer_id");



CREATE INDEX "idx_referrals_status" ON "public"."referrals" USING "btree" ("status");



CREATE INDEX "idx_specialities_active" ON "public"."specialities" USING "btree" ("active");



CREATE INDEX "idx_specialities_branch_id" ON "public"."specialities" USING "btree" ("branch_id");



CREATE INDEX "idx_specialities_domain_id" ON "public"."specialities" USING "btree" ("domain_id");



CREATE INDEX "idx_subscription_history_domain_id" ON "public"."subscription_history" USING "btree" ("domain_id");



CREATE INDEX "idx_subscription_history_user_id" ON "public"."subscription_history" USING "btree" ("user_id");



CREATE INDEX "idx_testimonials_domain_id" ON "public"."testimonials" USING "btree" ("domain_id");



CREATE INDEX "idx_testimonials_published" ON "public"."testimonials" USING "btree" ("published");



CREATE INDEX "idx_transactions_domain_id" ON "public"."transactions" USING "btree" ("domain_id");



CREATE INDEX "idx_transactions_package_id" ON "public"."transactions" USING "btree" ("package_id");



CREATE INDEX "idx_transactions_status" ON "public"."transactions" USING "btree" ("status");



CREATE INDEX "idx_transactions_stripe_pi" ON "public"."transactions" USING "btree" ("stripe_payment_intent_id");



CREATE INDEX "idx_transactions_stripe_sub" ON "public"."transactions" USING "btree" ("stripe_subscription_id");



CREATE INDEX "idx_transactions_user_id" ON "public"."transactions" USING "btree" ("user_id");



CREATE INDEX "idx_translations_locale" ON "public"."translations" USING "btree" ("locale");



CREATE INDEX "idx_translations_lookup" ON "public"."translations" USING "btree" ("table_name", "row_id", "locale");



CREATE INDEX "idx_users_deletion_due" ON "public"."users" USING "btree" ("deletion_scheduled_at") WHERE (("deletion_scheduled_at" IS NOT NULL) AND ("anonymized_at" IS NULL));



CREATE INDEX "idx_users_domain_id" ON "public"."users" USING "btree" ("domain_id");



CREATE INDEX "idx_users_role_id" ON "public"."users" USING "btree" ("role_id");



CREATE INDEX "idx_users_status" ON "public"."users" USING "btree" ("status");



CREATE INDEX "idx_users_user_type" ON "public"."users" USING "btree" ("user_type");



CREATE INDEX "matches_domain_idx" ON "public"."matches" USING "btree" ("domain_id");



CREATE INDEX "matches_profile_idx" ON "public"."matches" USING "btree" ("profile_id");



CREATE INDEX "matches_publication_idx" ON "public"."matches" USING "btree" ("publication_id");



CREATE INDEX "matches_status_idx" ON "public"."matches" USING "btree" ("status");



CREATE INDEX "messages_conversation_idx" ON "public"."messages" USING "btree" ("conversation_id");



CREATE INDEX "messages_created_at_idx" ON "public"."messages" USING "btree" ("created_at" DESC);



CREATE INDEX "messages_domain_idx" ON "public"."messages" USING "btree" ("domain_id");



CREATE INDEX "messages_sender_idx" ON "public"."messages" USING "btree" ("sender_id");



CREATE INDEX "notifications_unread_idx" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC) WHERE ("read_at" IS NULL);



CREATE INDEX "organization_domains_domain_idx" ON "public"."organization_domains" USING "btree" ("domain_id");



CREATE INDEX "organization_domains_org_idx" ON "public"."organization_domains" USING "btree" ("organization_id");



CREATE INDEX "organization_invitations_email_idx" ON "public"."organization_invitations" USING "btree" ("lower"(("email")::"text"));



CREATE INDEX "organization_invitations_org_idx" ON "public"."organization_invitations" USING "btree" ("organization_id");



CREATE INDEX "organization_invitations_status_idx" ON "public"."organization_invitations" USING "btree" ("status", "expires_at");



CREATE INDEX "organization_members_org_idx" ON "public"."organization_members" USING "btree" ("organization_id");



CREATE INDEX "organization_members_user_idx" ON "public"."organization_members" USING "btree" ("user_id");



CREATE UNIQUE INDEX "organizations_email_domain_unique_idx" ON "public"."organizations" USING "btree" ("lower"(("email_domain")::"text")) WHERE ("email_domain" IS NOT NULL);



CREATE UNIQUE INDEX "organizations_siren_unique_idx" ON "public"."organizations" USING "btree" ("siren") WHERE ("siren" IS NOT NULL);



CREATE INDEX "organizations_verification_status_idx" ON "public"."organizations" USING "btree" ("verification_status");



CREATE INDEX "profiles_verification_status_idx" ON "public"."profiles" USING "btree" ("verification_status");



CREATE INDEX "public_email_domains_active_idx" ON "public"."public_email_domains" USING "btree" ("active") WHERE ("active" = true);



CREATE UNIQUE INDEX "public_email_domains_domain_unique_idx" ON "public"."public_email_domains" USING "btree" ("lower"(("email_domain")::"text"));



CREATE INDEX "publications_branch_idx" ON "public"."publications" USING "btree" ("branch_id") WHERE ("branch_id" IS NOT NULL);



CREATE INDEX "publications_domain_idx" ON "public"."publications" USING "btree" ("domain_id");



CREATE INDEX "publications_organization_idx" ON "public"."publications" USING "btree" ("organization_id");



CREATE INDEX "publications_published_at_idx" ON "public"."publications" USING "btree" ("published_at" DESC) WHERE ("status" = 'published'::"text");



CREATE INDEX "publications_speciality_idx" ON "public"."publications" USING "btree" ("speciality_id") WHERE ("speciality_id" IS NOT NULL);



CREATE INDEX "publications_status_idx" ON "public"."publications" USING "btree" ("status");



CREATE INDEX "session_logs_login_at_idx" ON "public"."session_logs" USING "btree" ("login_at" DESC);



CREATE INDEX "session_logs_user_login_idx" ON "public"."session_logs" USING "btree" ("user_id", "login_at" DESC);



CREATE INDEX "user_section_visits_user_idx" ON "public"."user_section_visits" USING "btree" ("user_id");



CREATE INDEX "verification_attempts_org_idx" ON "public"."verification_attempts" USING "btree" ("organization_id", "attempt_at" DESC);



CREATE INDEX "verification_providers_country_priority_idx" ON "public"."verification_providers" USING "btree" ("country_code", "priority") WHERE ("is_active" = true);



CREATE OR REPLACE TRIGGER "trg_ad_placements_updated_at" BEFORE UPDATE ON "public"."ad_placements" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_blocked_email_domains_updated_at" BEFORE UPDATE ON "public"."blocked_email_domains" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_blog_posts_updated_at" BEFORE UPDATE ON "public"."blog_posts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_branches_updated_at" BEFORE UPDATE ON "public"."branches" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_campaigns_updated_at" BEFORE UPDATE ON "public"."campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_candidatures_updated_at" BEFORE UPDATE ON "public"."candidatures" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_conversations_updated_at" BEFORE UPDATE ON "public"."conversations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_countries_updated_at" BEFORE UPDATE ON "public"."countries" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_domain_configs_updated_at" BEFORE UPDATE ON "public"."domain_configs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_domains_updated_at" BEFORE UPDATE ON "public"."domains" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_features_updated_at" BEFORE UPDATE ON "public"."features" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_leads_updated_at" BEFORE UPDATE ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_matches_updated_at" BEFORE UPDATE ON "public"."matches" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_messages_updated_at" BEFORE UPDATE ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_organization_domains_updated_at" BEFORE UPDATE ON "public"."organization_domains" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_organization_invitations_updated_at" BEFORE UPDATE ON "public"."organization_invitations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_organization_members_updated_at" BEFORE UPDATE ON "public"."organization_members" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_organizations_updated_at" BEFORE UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_packages_updated_at" BEFORE UPDATE ON "public"."packages" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_profile_alerts_updated_at" BEFORE UPDATE ON "public"."profile_alerts" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_profile_educations_updated_at" BEFORE UPDATE ON "public"."profile_educations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_profile_experiences_updated_at" BEFORE UPDATE ON "public"."profile_experiences" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_promo_codes_updated_at" BEFORE UPDATE ON "public"."promo_codes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_public_email_domains_updated_at" BEFORE UPDATE ON "public"."public_email_domains" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_publications_updated_at" BEFORE UPDATE ON "public"."publications" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_referrals_updated_at" BEFORE UPDATE ON "public"."referrals" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_roles_updated_at" BEFORE UPDATE ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_specialities_updated_at" BEFORE UPDATE ON "public"."specialities" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_testimonials_updated_at" BEFORE UPDATE ON "public"."testimonials" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_translations_updated_at" BEFORE UPDATE ON "public"."translations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_verification_providers_updated_at" BEFORE UPDATE ON "public"."verification_providers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."ad_placements"
    ADD CONSTRAINT "ad_placements_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."blocked_email_domains"
    ADD CONSTRAINT "blocked_email_domains_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."blog_posts"
    ADD CONSTRAINT "blog_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."blog_posts"
    ADD CONSTRAINT "blog_posts_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."candidature_views"
    ADD CONSTRAINT "candidature_views_candidature_id_fkey" FOREIGN KEY ("candidature_id") REFERENCES "public"."candidatures"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."candidature_views"
    ADD CONSTRAINT "candidature_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."candidatures"
    ADD CONSTRAINT "candidatures_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."candidatures"
    ADD CONSTRAINT "candidatures_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."candidatures"
    ADD CONSTRAINT "candidatures_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."candidatures"
    ADD CONSTRAINT "candidatures_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_candidature_id_fkey" FOREIGN KEY ("candidature_id") REFERENCES "public"."candidatures"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."dashboard_stats"
    ADD CONSTRAINT "dashboard_stats_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."domain_configs"
    ADD CONSTRAINT "domain_configs_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."matches"
    ADD CONSTRAINT "matches_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."newsletter_subscriptions"
    ADD CONSTRAINT "newsletter_subscriptions_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_domains"
    ADD CONSTRAINT "organization_domains_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."organization_domains"
    ADD CONSTRAINT "organization_domains_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_domains"
    ADD CONSTRAINT "organization_domains_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."organization_invitations"
    ADD CONSTRAINT "organization_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."organization_invitations"
    ADD CONSTRAINT "organization_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."package_features"
    ADD CONSTRAINT "package_features_feature_code_fkey" FOREIGN KEY ("feature_code") REFERENCES "public"."features"("code") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."package_features"
    ADD CONSTRAINT "package_features_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."package_history"
    ADD CONSTRAINT "package_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."package_history"
    ADD CONSTRAINT "package_history_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."profile_alerts"
    ADD CONSTRAINT "profile_alerts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."profile_alerts"
    ADD CONSTRAINT "profile_alerts_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."profile_alerts"
    ADD CONSTRAINT "profile_alerts_speciality_id_fkey" FOREIGN KEY ("speciality_id") REFERENCES "public"."specialities"("id");



ALTER TABLE ONLY "public"."profile_alerts"
    ADD CONSTRAINT "profile_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_educations"
    ADD CONSTRAINT "profile_educations_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."profile_educations"
    ADD CONSTRAINT "profile_educations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_experiences"
    ADD CONSTRAINT "profile_experiences_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."profile_experiences"
    ADD CONSTRAINT "profile_experiences_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_languages"
    ADD CONSTRAINT "profile_languages_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_speciality_id_fkey" FOREIGN KEY ("speciality_id") REFERENCES "public"."specialities"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."promo_code_uses"
    ADD CONSTRAINT "promo_code_uses_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promo_code_uses"
    ADD CONSTRAINT "promo_code_uses_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id");



ALTER TABLE ONLY "public"."promo_code_uses"
    ADD CONSTRAINT "promo_code_uses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."promo_codes"
    ADD CONSTRAINT "promo_codes_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."public_email_domains"
    ADD CONSTRAINT "public_email_domains_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."publications"
    ADD CONSTRAINT "publications_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."publications"
    ADD CONSTRAINT "publications_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."publications"
    ADD CONSTRAINT "publications_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."publications"
    ADD CONSTRAINT "publications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."publications"
    ADD CONSTRAINT "publications_speciality_id_fkey" FOREIGN KEY ("speciality_id") REFERENCES "public"."specialities"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."publications"
    ADD CONSTRAINT "publications_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referred_id_fkey" FOREIGN KEY ("referred_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."session_logs"
    ADD CONSTRAINT "session_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."specialities"
    ADD CONSTRAINT "specialities_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."specialities"
    ADD CONSTRAINT "specialities_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscription_history"
    ADD CONSTRAINT "subscription_history_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."subscription_history"
    ADD CONSTRAINT "subscription_history_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id");



ALTER TABLE ONLY "public"."subscription_history"
    ADD CONSTRAINT "subscription_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."testimonials"
    ADD CONSTRAINT "testimonials_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."testimonials"
    ADD CONSTRAINT "testimonials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."user_section_visits"
    ADD CONSTRAINT "user_section_visits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "public"."domains"("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id");



ALTER TABLE ONLY "public"."verification_attempts"
    ADD CONSTRAINT "verification_attempts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE "public"."_backup_ad_placements_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_applications_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_audit_logs_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_blog_posts_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_branches_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_campaigns_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_conversations_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_dashboard_stats_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_domain_configs_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_domains_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_features_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_leads_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_newsletter_subscriptions_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_notifications_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_opportunities_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_organizations_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_package_features_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_package_history_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_packages_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_private_messages_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_profile_alerts_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_profiles_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_promo_code_uses_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_promo_codes_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_referrals_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_roles_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_shortlists_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_specialities_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_subscription_history_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_testimonials_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_transactions_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."_backup_users_20260422" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ad_placements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ad_placements_public_read" ON "public"."ad_placements" FOR SELECT USING (("active" = true));



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blocked_email_domains" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blog_posts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "blog_posts_public_read" ON "public"."blog_posts" FOR SELECT USING ((("status")::"text" = 'published'::"text"));



ALTER TABLE "public"."branches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "branches_public_read" ON "public"."branches" FOR SELECT USING (("active" = true));



ALTER TABLE "public"."campaigns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."candidature_views" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "candidature_views_self" ON "public"."candidature_views" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."candidatures" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "candidatures_expert_insert" ON "public"."candidatures" FOR INSERT TO "authenticated" WITH CHECK ((("status" = 'received'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "candidatures"."profile_id") AND ("p"."user_id" = "auth"."uid"())))) AND "public"."expert_has_match_for_publication"("publication_id")));



CREATE POLICY "candidatures_expert_read" ON "public"."candidatures" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "candidatures"."profile_id") AND ("p"."user_id" = "auth"."uid"())))));



CREATE POLICY "candidatures_expert_update" ON "public"."candidatures" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "candidatures"."profile_id") AND ("p"."user_id" = "auth"."uid"()))))) WITH CHECK ((("status" = ANY (ARRAY['received'::"text", 'withdrawn'::"text"])) AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "candidatures"."profile_id") AND ("p"."user_id" = "auth"."uid"()))))));



CREATE POLICY "candidatures_org_read" ON "public"."candidatures" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."publications" "pub"
     JOIN "public"."organization_members" "me" ON (("me"."organization_id" = "pub"."organization_id")))
  WHERE (("pub"."id" = "candidatures"."publication_id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."status")::"text" = 'active'::"text")))));



ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversations_party_read" ON "public"."conversations" FOR SELECT TO "authenticated" USING (((("expires_at" IS NULL) OR ("expires_at" > "now"())) AND (EXISTS ( SELECT 1
   FROM ((("public"."candidatures" "c"
     LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "c"."profile_id")))
     LEFT JOIN "public"."publications" "pub" ON (("pub"."id" = "c"."publication_id")))
     LEFT JOIN "public"."organization_members" "me" ON ((("me"."organization_id" = "pub"."organization_id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."status")::"text" = 'active'::"text"))))
  WHERE (("c"."id" = "conversations"."candidature_id") AND ("c"."status" = 'unlocked'::"text") AND (("p"."user_id" = "auth"."uid"()) OR ("me"."user_id" IS NOT NULL)))))));



ALTER TABLE "public"."countries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "countries_public_read" ON "public"."countries" FOR SELECT USING (("active" = true));



ALTER TABLE "public"."dashboard_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."domain_configs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "domain_configs_public_read" ON "public"."domain_configs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."domains" "d"
  WHERE (("d"."id" = "domain_configs"."domain_id") AND ("d"."active" = true)))));



ALTER TABLE "public"."domains" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "domains_public_read" ON "public"."domains" FOR SELECT USING (("active" = true));



ALTER TABLE "public"."features" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "features_public_read" ON "public"."features" FOR SELECT USING (("active" = true));



ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."matches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "matches_expert_read" ON "public"."matches" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "matches"."profile_id") AND ("p"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "messages_party_mark_read" ON "public"."messages" FOR UPDATE TO "authenticated" USING ((("sender_id" <> "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM (((("public"."conversations" "conv"
     JOIN "public"."candidatures" "c" ON (("c"."id" = "conv"."candidature_id")))
     LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "c"."profile_id")))
     LEFT JOIN "public"."publications" "pub" ON (("pub"."id" = "c"."publication_id")))
     LEFT JOIN "public"."organization_members" "me" ON ((("me"."organization_id" = "pub"."organization_id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."status")::"text" = 'active'::"text"))))
  WHERE (("conv"."id" = "messages"."conversation_id") AND ("c"."status" = 'unlocked'::"text") AND (("conv"."expires_at" IS NULL) OR ("conv"."expires_at" > "now"())) AND (("p"."user_id" = "auth"."uid"()) OR ("me"."user_id" IS NOT NULL)))))));



CREATE POLICY "messages_party_read" ON "public"."messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM (((("public"."conversations" "conv"
     JOIN "public"."candidatures" "c" ON (("c"."id" = "conv"."candidature_id")))
     LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "c"."profile_id")))
     LEFT JOIN "public"."publications" "pub" ON (("pub"."id" = "c"."publication_id")))
     LEFT JOIN "public"."organization_members" "me" ON ((("me"."organization_id" = "pub"."organization_id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."status")::"text" = 'active'::"text"))))
  WHERE (("conv"."id" = "messages"."conversation_id") AND ("c"."status" = 'unlocked'::"text") AND (("conv"."expires_at" IS NULL) OR ("conv"."expires_at" > "now"())) AND (("p"."user_id" = "auth"."uid"()) OR ("me"."user_id" IS NOT NULL))))));



CREATE POLICY "messages_sender_insert" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK ((("sender_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM (((("public"."conversations" "conv"
     JOIN "public"."candidatures" "c" ON (("c"."id" = "conv"."candidature_id")))
     LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "c"."profile_id")))
     LEFT JOIN "public"."publications" "pub" ON (("pub"."id" = "c"."publication_id")))
     LEFT JOIN "public"."organization_members" "me" ON ((("me"."organization_id" = "pub"."organization_id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."status")::"text" = 'active'::"text"))))
  WHERE (("conv"."id" = "messages"."conversation_id") AND ("c"."status" = 'unlocked'::"text") AND (("conv"."expires_at" IS NULL) OR ("conv"."expires_at" > "now"())) AND (("p"."user_id" = "auth"."uid"()) OR ("me"."user_id" IS NOT NULL)))))));



ALTER TABLE "public"."newsletter_subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "newsletter_subscriptions_public_insert" ON "public"."newsletter_subscriptions" FOR INSERT WITH CHECK (true);



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_self_read" ON "public"."notifications" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "notifications_self_update" ON "public"."notifications" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."organization_domains" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organization_domains_admin_write" ON "public"."organization_domains" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "me"
  WHERE (("me"."organization_id" = "organization_domains"."organization_id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."role_in_org")::"text" = 'admin'::"text") AND (("me"."status")::"text" = 'active'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "me"
  WHERE (("me"."organization_id" = "organization_domains"."organization_id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."role_in_org")::"text" = 'admin'::"text") AND (("me"."status")::"text" = 'active'::"text")))));



CREATE POLICY "organization_domains_member_read" ON "public"."organization_domains" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "me"
  WHERE (("me"."organization_id" = "organization_domains"."organization_id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."status")::"text" = 'active'::"text")))));



ALTER TABLE "public"."organization_invitations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organization_invitations_admin_all" ON "public"."organization_invitations" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "me"
  WHERE (("me"."organization_id" = "organization_invitations"."organization_id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."role_in_org")::"text" = 'admin'::"text") AND (("me"."status")::"text" = 'active'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "me"
  WHERE (("me"."organization_id" = "organization_invitations"."organization_id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."role_in_org")::"text" = 'admin'::"text") AND (("me"."status")::"text" = 'active'::"text")))));



CREATE POLICY "organization_invitations_member_read" ON "public"."organization_invitations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "me"
  WHERE (("me"."organization_id" = "organization_invitations"."organization_id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."status")::"text" = 'active'::"text")))));



ALTER TABLE "public"."organization_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organization_members_admin_write" ON "public"."organization_members" TO "authenticated" USING ("public"."is_active_admin_of_org"("organization_id")) WITH CHECK ("public"."is_active_admin_of_org"("organization_id"));



CREATE POLICY "organization_members_select_self_or_org" ON "public"."organization_members" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_active_member_of_org"("organization_id")));



ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organizations_admin_update" ON "public"."organizations" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "me"
  WHERE (("me"."organization_id" = "organizations"."id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."role_in_org")::"text" = 'admin'::"text") AND (("me"."status")::"text" = 'active'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "me"
  WHERE (("me"."organization_id" = "organizations"."id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."role_in_org")::"text" = 'admin'::"text") AND (("me"."status")::"text" = 'active'::"text")))));



CREATE POLICY "organizations_member_read" ON "public"."organizations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "me"
  WHERE (("me"."organization_id" = "organizations"."id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."status")::"text" = 'active'::"text")))));



ALTER TABLE "public"."package_features" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "package_features_public_read" ON "public"."package_features" FOR SELECT USING (true);



ALTER TABLE "public"."package_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."packages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "packages_public_read" ON "public"."packages" FOR SELECT USING (("active" = true));



CREATE POLICY "pedu_self_read" ON "public"."profile_educations" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "profile_educations"."profile_id") AND ("p"."user_id" = "auth"."uid"())))));



CREATE POLICY "pexp_self_read" ON "public"."profile_experiences" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "profile_experiences"."profile_id") AND ("p"."user_id" = "auth"."uid"())))));



CREATE POLICY "plang_self_read" ON "public"."profile_languages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "profile_languages"."profile_id") AND ("p"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."profile_alerts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profile_alerts_self_all" ON "public"."profile_alerts" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."profile_educations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_experiences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_languages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_org_unlocked_read" ON "public"."profiles" FOR SELECT TO "authenticated" USING ("public"."org_has_unlocked_candidature_for_profile"("id"));



CREATE POLICY "profiles_self_insert" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "profiles_self_read" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "profiles_self_update" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."promo_code_uses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."promo_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."public_email_domains" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."publications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "publications_member_read" ON "public"."publications" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "me"
  WHERE (("me"."organization_id" = "publications"."organization_id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."status")::"text" = 'active'::"text")))));



CREATE POLICY "publications_member_write" ON "public"."publications" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "me"
  WHERE (("me"."organization_id" = "publications"."organization_id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."status")::"text" = 'active'::"text"))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."organization_members" "me"
  WHERE (("me"."organization_id" = "publications"."organization_id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."status")::"text" = 'active'::"text")))) AND ("status" = ANY (ARRAY['draft'::"text", 'suspended'::"text", 'archived'::"text"]))));



ALTER TABLE "public"."referrals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roles_public_read" ON "public"."roles" FOR SELECT USING (("active" = true));



ALTER TABLE "public"."session_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "session_logs_self_read" ON "public"."session_logs" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."specialities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "specialities_public_read" ON "public"."specialities" FOR SELECT USING (("active" = true));



ALTER TABLE "public"."subscription_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscription_history_self_read" ON "public"."subscription_history" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."testimonials" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "testimonials_public_read" ON "public"."testimonials" FOR SELECT USING (("published" = true));



ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transactions_self_read" ON "public"."transactions" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."translations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "translations_public_read" ON "public"."translations" FOR SELECT USING (true);



ALTER TABLE "public"."user_section_visits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_section_visits_self_read" ON "public"."user_section_visits" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_section_visits_self_write" ON "public"."user_section_visits" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_self_read" ON "public"."users" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "users_self_update" ON "public"."users" FOR UPDATE USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."verification_attempts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "verification_attempts_admin_read" ON "public"."verification_attempts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."organization_members" "me"
  WHERE (("me"."organization_id" = "verification_attempts"."organization_id") AND ("me"."user_id" = "auth"."uid"()) AND (("me"."role_in_org")::"text" = 'admin'::"text") AND (("me"."status")::"text" = 'active'::"text")))));



ALTER TABLE "public"."verification_providers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "verification_providers_authenticated_read" ON "public"."verification_providers" FOR SELECT TO "authenticated" USING (("is_active" = true));



ALTER TABLE "public"."waitlist" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."expert_has_match_for_publication"("_publication_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expert_has_match_for_publication"("_publication_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."expert_has_match_for_publication"("_publication_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."expert_has_match_for_publication"("_publication_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_email_confirmed"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_email_confirmed"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_email_confirmed"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_active_admin_of_org"("p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_active_admin_of_org"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_active_admin_of_org"("p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_active_member_of_org"("p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_active_member_of_org"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_active_member_of_org"("p_org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."org_has_unlocked_candidature_for_profile"("_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."org_has_unlocked_candidature_for_profile"("_profile_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."org_has_unlocked_candidature_for_profile"("_profile_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."org_has_unlocked_candidature_for_profile"("_profile_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."_backup_ad_placements_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_ad_placements_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_ad_placements_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_applications_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_applications_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_applications_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_audit_logs_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_audit_logs_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_audit_logs_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_blog_posts_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_blog_posts_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_blog_posts_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_branches_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_branches_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_branches_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_campaigns_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_campaigns_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_campaigns_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_conversations_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_conversations_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_conversations_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_dashboard_stats_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_dashboard_stats_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_dashboard_stats_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_domain_configs_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_domain_configs_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_domain_configs_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_domains_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_domains_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_domains_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_features_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_features_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_features_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_leads_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_leads_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_leads_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_newsletter_subscriptions_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_newsletter_subscriptions_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_newsletter_subscriptions_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_notifications_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_notifications_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_notifications_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_opportunities_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_opportunities_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_opportunities_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_organizations_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_organizations_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_organizations_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_package_features_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_package_features_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_package_features_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_package_history_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_package_history_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_package_history_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_packages_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_packages_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_packages_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_private_messages_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_private_messages_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_private_messages_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_profile_alerts_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_profile_alerts_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_profile_alerts_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_profiles_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_profiles_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_profiles_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_promo_code_uses_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_promo_code_uses_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_promo_code_uses_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_promo_codes_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_promo_codes_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_promo_codes_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_referrals_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_referrals_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_referrals_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_roles_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_roles_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_roles_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_shortlists_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_shortlists_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_shortlists_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_specialities_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_specialities_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_specialities_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_subscription_history_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_subscription_history_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_subscription_history_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_testimonials_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_testimonials_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_testimonials_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_transactions_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_transactions_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_transactions_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."_backup_users_20260422" TO "anon";
GRANT ALL ON TABLE "public"."_backup_users_20260422" TO "authenticated";
GRANT ALL ON TABLE "public"."_backup_users_20260422" TO "service_role";



GRANT ALL ON TABLE "public"."ad_placements" TO "anon";
GRANT ALL ON TABLE "public"."ad_placements" TO "authenticated";
GRANT ALL ON TABLE "public"."ad_placements" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."blocked_email_domains" TO "anon";
GRANT ALL ON TABLE "public"."blocked_email_domains" TO "authenticated";
GRANT ALL ON TABLE "public"."blocked_email_domains" TO "service_role";



GRANT ALL ON TABLE "public"."blog_posts" TO "anon";
GRANT ALL ON TABLE "public"."blog_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."blog_posts" TO "service_role";



GRANT ALL ON TABLE "public"."branches" TO "anon";
GRANT ALL ON TABLE "public"."branches" TO "authenticated";
GRANT ALL ON TABLE "public"."branches" TO "service_role";



GRANT ALL ON TABLE "public"."campaigns" TO "anon";
GRANT ALL ON TABLE "public"."campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."candidature_views" TO "anon";
GRANT ALL ON TABLE "public"."candidature_views" TO "authenticated";
GRANT ALL ON TABLE "public"."candidature_views" TO "service_role";



GRANT ALL ON TABLE "public"."candidatures" TO "anon";
GRANT ALL ON TABLE "public"."candidatures" TO "authenticated";
GRANT ALL ON TABLE "public"."candidatures" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."countries" TO "anon";
GRANT ALL ON TABLE "public"."countries" TO "authenticated";
GRANT ALL ON TABLE "public"."countries" TO "service_role";



GRANT ALL ON TABLE "public"."dashboard_stats" TO "anon";
GRANT ALL ON TABLE "public"."dashboard_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."dashboard_stats" TO "service_role";



GRANT ALL ON TABLE "public"."domain_configs" TO "anon";
GRANT ALL ON TABLE "public"."domain_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."domain_configs" TO "service_role";



GRANT ALL ON TABLE "public"."domains" TO "anon";
GRANT ALL ON TABLE "public"."domains" TO "authenticated";
GRANT ALL ON TABLE "public"."domains" TO "service_role";



GRANT ALL ON TABLE "public"."features" TO "anon";
GRANT ALL ON TABLE "public"."features" TO "authenticated";
GRANT ALL ON TABLE "public"."features" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON TABLE "public"."matches" TO "anon";
GRANT ALL ON TABLE "public"."matches" TO "authenticated";
GRANT ALL ON TABLE "public"."matches" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT UPDATE("read_at") ON TABLE "public"."messages" TO "authenticated";



GRANT ALL ON TABLE "public"."newsletter_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."newsletter_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."newsletter_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."organization_domains" TO "anon";
GRANT ALL ON TABLE "public"."organization_domains" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_domains" TO "service_role";



GRANT ALL ON TABLE "public"."organization_invitations" TO "anon";
GRANT ALL ON TABLE "public"."organization_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."organization_members" TO "anon";
GRANT ALL ON TABLE "public"."organization_members" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_members" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."package_features" TO "anon";
GRANT ALL ON TABLE "public"."package_features" TO "authenticated";
GRANT ALL ON TABLE "public"."package_features" TO "service_role";



GRANT ALL ON TABLE "public"."package_history" TO "anon";
GRANT ALL ON TABLE "public"."package_history" TO "authenticated";
GRANT ALL ON TABLE "public"."package_history" TO "service_role";



GRANT ALL ON TABLE "public"."packages" TO "anon";
GRANT ALL ON TABLE "public"."packages" TO "authenticated";
GRANT ALL ON TABLE "public"."packages" TO "service_role";



GRANT ALL ON TABLE "public"."profile_alerts" TO "anon";
GRANT ALL ON TABLE "public"."profile_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_alerts" TO "service_role";



GRANT ALL ON TABLE "public"."profile_educations" TO "anon";
GRANT ALL ON TABLE "public"."profile_educations" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_educations" TO "service_role";



GRANT ALL ON TABLE "public"."profile_experiences" TO "anon";
GRANT ALL ON TABLE "public"."profile_experiences" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_experiences" TO "service_role";



GRANT ALL ON TABLE "public"."profile_languages" TO "anon";
GRANT ALL ON TABLE "public"."profile_languages" TO "authenticated";
GRANT ALL ON TABLE "public"."profile_languages" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."promo_code_uses" TO "anon";
GRANT ALL ON TABLE "public"."promo_code_uses" TO "authenticated";
GRANT ALL ON TABLE "public"."promo_code_uses" TO "service_role";



GRANT ALL ON TABLE "public"."promo_codes" TO "anon";
GRANT ALL ON TABLE "public"."promo_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."promo_codes" TO "service_role";



GRANT ALL ON TABLE "public"."public_email_domains" TO "anon";
GRANT ALL ON TABLE "public"."public_email_domains" TO "authenticated";
GRANT ALL ON TABLE "public"."public_email_domains" TO "service_role";



GRANT ALL ON TABLE "public"."publications" TO "anon";
GRANT ALL ON TABLE "public"."publications" TO "authenticated";
GRANT ALL ON TABLE "public"."publications" TO "service_role";



GRANT ALL ON TABLE "public"."referrals" TO "anon";
GRANT ALL ON TABLE "public"."referrals" TO "authenticated";
GRANT ALL ON TABLE "public"."referrals" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON TABLE "public"."session_logs" TO "anon";
GRANT ALL ON TABLE "public"."session_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."session_logs" TO "service_role";



GRANT ALL ON TABLE "public"."specialities" TO "anon";
GRANT ALL ON TABLE "public"."specialities" TO "authenticated";
GRANT ALL ON TABLE "public"."specialities" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_history" TO "anon";
GRANT ALL ON TABLE "public"."subscription_history" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_history" TO "service_role";



GRANT ALL ON TABLE "public"."testimonials" TO "anon";
GRANT ALL ON TABLE "public"."testimonials" TO "authenticated";
GRANT ALL ON TABLE "public"."testimonials" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";



GRANT ALL ON TABLE "public"."translations" TO "anon";
GRANT ALL ON TABLE "public"."translations" TO "authenticated";
GRANT ALL ON TABLE "public"."translations" TO "service_role";



GRANT ALL ON TABLE "public"."user_section_visits" TO "anon";
GRANT ALL ON TABLE "public"."user_section_visits" TO "authenticated";
GRANT ALL ON TABLE "public"."user_section_visits" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."verification_attempts" TO "anon";
GRANT ALL ON TABLE "public"."verification_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."verification_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."verification_providers" TO "anon";
GRANT ALL ON TABLE "public"."verification_providers" TO "authenticated";
GRANT ALL ON TABLE "public"."verification_providers" TO "service_role";



GRANT ALL ON TABLE "public"."waitlist" TO "anon";
GRANT ALL ON TABLE "public"."waitlist" TO "authenticated";
GRANT ALL ON TABLE "public"."waitlist" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







