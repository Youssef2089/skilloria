export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      _backup_ad_placements_20260422: {
        Row: {
          created_at: string | null
          description: string | null
          ends_at: string | null
          id: string | null
          is_active: boolean | null
          position: string | null
          starts_at: string | null
          title: string | null
          url: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string | null
          is_active?: boolean | null
          position?: string | null
          starts_at?: string | null
          title?: string | null
          url?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string | null
          is_active?: boolean | null
          position?: string | null
          starts_at?: string | null
          title?: string | null
          url?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _backup_applications_20260422: {
        Row: {
          created_at: string | null
          id: string | null
          message: string | null
          opportunity_id: string | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          message?: string | null
          opportunity_id?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          message?: string | null
          opportunity_id?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _backup_audit_logs_20260422: {
        Row: {
          action: string | null
          created_at: string | null
          details: Json | null
          id: string | null
          record_id: string | null
          table_name: string | null
          user_id: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string | null
          record_id?: string | null
          table_name?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string | null
          record_id?: string | null
          table_name?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _backup_blog_posts_20260422: {
        Row: {
          author_id: string | null
          content: string | null
          created_at: string | null
          id: string | null
          published_at: string | null
          slug: string | null
          status: string | null
          title: string | null
        }
        Insert: {
          author_id?: string | null
          content?: string | null
          created_at?: string | null
          id?: string | null
          published_at?: string | null
          slug?: string | null
          status?: string | null
          title?: string | null
        }
        Update: {
          author_id?: string | null
          content?: string | null
          created_at?: string | null
          id?: string | null
          published_at?: string | null
          slug?: string | null
          status?: string | null
          title?: string | null
        }
        Relationships: []
      }
      _backup_branches_20260422: {
        Row: {
          created_at: string | null
          domain_id: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          slug: string | null
        }
        Insert: {
          created_at?: string | null
          domain_id?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          slug?: string | null
        }
        Update: {
          created_at?: string | null
          domain_id?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      _backup_campaigns_20260422: {
        Row: {
          budget: number | null
          created_at: string | null
          end_date: string | null
          id: string | null
          name: string | null
          start_date: string | null
          status: string | null
          type: string | null
        }
        Insert: {
          budget?: number | null
          created_at?: string | null
          end_date?: string | null
          id?: string | null
          name?: string | null
          start_date?: string | null
          status?: string | null
          type?: string | null
        }
        Update: {
          budget?: number | null
          created_at?: string | null
          end_date?: string | null
          id?: string | null
          name?: string | null
          start_date?: string | null
          status?: string | null
          type?: string | null
        }
        Relationships: []
      }
      _backup_conversations_20260422: {
        Row: {
          created_at: string | null
          id: string | null
          opportunity_id: string | null
          receiver_id: string | null
          sender_id: string | null
          subject: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          opportunity_id?: string | null
          receiver_id?: string | null
          sender_id?: string | null
          subject?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          opportunity_id?: string | null
          receiver_id?: string | null
          sender_id?: string | null
          subject?: string | null
        }
        Relationships: []
      }
      _backup_dashboard_stats_20260422: {
        Row: {
          applications_sent: number | null
          created_at: string | null
          id: string | null
          messages_received: number | null
          opportunity_views: number | null
          profile_views: number | null
          stat_date: string | null
          user_id: string | null
        }
        Insert: {
          applications_sent?: number | null
          created_at?: string | null
          id?: string | null
          messages_received?: number | null
          opportunity_views?: number | null
          profile_views?: number | null
          stat_date?: string | null
          user_id?: string | null
        }
        Update: {
          applications_sent?: number | null
          created_at?: string | null
          id?: string | null
          messages_received?: number | null
          opportunity_views?: number | null
          profile_views?: number | null
          stat_date?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _backup_domain_configs_20260422: {
        Row: {
          config_key: string | null
          config_value: string | null
          created_at: string | null
          domain_id: string | null
          id: string | null
        }
        Insert: {
          config_key?: string | null
          config_value?: string | null
          created_at?: string | null
          domain_id?: string | null
          id?: string | null
        }
        Update: {
          config_key?: string | null
          config_value?: string | null
          created_at?: string | null
          domain_id?: string | null
          id?: string | null
        }
        Relationships: []
      }
      _backup_domains_20260422: {
        Row: {
          created_at: string | null
          description: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          slug: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          slug?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      _backup_features_20260422: {
        Row: {
          created_at: string | null
          description: string | null
          id: string | null
          name: string | null
          slug: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string | null
          name?: string | null
          slug?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string | null
          name?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      _backup_leads_20260422: {
        Row: {
          campaign_id: string | null
          created_at: string | null
          email: string | null
          first_name: string | null
          id: string | null
          last_name: string | null
          source: string | null
          status: string | null
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          id?: string | null
          last_name?: string | null
          source?: string | null
          status?: string | null
        }
        Update: {
          campaign_id?: string | null
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          id?: string | null
          last_name?: string | null
          source?: string | null
          status?: string | null
        }
        Relationships: []
      }
      _backup_newsletter_subscriptions_20260422: {
        Row: {
          created_at: string | null
          email: string | null
          id: string | null
          is_active: boolean | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string | null
          is_active?: boolean | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string | null
          is_active?: boolean | null
        }
        Relationships: []
      }
      _backup_notifications_20260422: {
        Row: {
          content: string | null
          created_at: string | null
          id: string | null
          is_read: boolean | null
          type: string | null
          user_id: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          id?: string | null
          is_read?: boolean | null
          type?: string | null
          user_id?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          id?: string | null
          is_read?: boolean | null
          type?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _backup_opportunities_20260422: {
        Row: {
          branch_id: string | null
          created_at: string | null
          daily_rate_max: number | null
          daily_rate_min: number | null
          description: string | null
          domain_id: string | null
          duration: string | null
          id: string | null
          is_active: boolean | null
          location: string | null
          remote_allowed: boolean | null
          speciality_id: string | null
          start_date: string | null
          status: string | null
          title: string | null
          type: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string | null
          daily_rate_max?: number | null
          daily_rate_min?: number | null
          description?: string | null
          domain_id?: string | null
          duration?: string | null
          id?: string | null
          is_active?: boolean | null
          location?: string | null
          remote_allowed?: boolean | null
          speciality_id?: string | null
          start_date?: string | null
          status?: string | null
          title?: string | null
          type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string | null
          daily_rate_max?: number | null
          daily_rate_min?: number | null
          description?: string | null
          domain_id?: string | null
          duration?: string | null
          id?: string | null
          is_active?: boolean | null
          location?: string | null
          remote_allowed?: boolean | null
          speciality_id?: string | null
          start_date?: string | null
          status?: string | null
          title?: string | null
          type?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _backup_organizations_20260422: {
        Row: {
          billing_address: string | null
          billing_city: string | null
          billing_country: string | null
          billing_zip: string | null
          created_at: string | null
          id: string | null
          logo_url: string | null
          name: string | null
          sector: string | null
          siret: string | null
          size: string | null
          user_id: string | null
          vat_number: string | null
          website: string | null
        }
        Insert: {
          billing_address?: string | null
          billing_city?: string | null
          billing_country?: string | null
          billing_zip?: string | null
          created_at?: string | null
          id?: string | null
          logo_url?: string | null
          name?: string | null
          sector?: string | null
          siret?: string | null
          size?: string | null
          user_id?: string | null
          vat_number?: string | null
          website?: string | null
        }
        Update: {
          billing_address?: string | null
          billing_city?: string | null
          billing_country?: string | null
          billing_zip?: string | null
          created_at?: string | null
          id?: string | null
          logo_url?: string | null
          name?: string | null
          sector?: string | null
          siret?: string | null
          size?: string | null
          user_id?: string | null
          vat_number?: string | null
          website?: string | null
        }
        Relationships: []
      }
      _backup_package_features_20260422: {
        Row: {
          created_at: string | null
          feature_id: string | null
          id: string | null
          limit_value: number | null
          package_id: string | null
        }
        Insert: {
          created_at?: string | null
          feature_id?: string | null
          id?: string | null
          limit_value?: number | null
          package_id?: string | null
        }
        Update: {
          created_at?: string | null
          feature_id?: string | null
          id?: string | null
          limit_value?: number | null
          package_id?: string | null
        }
        Relationships: []
      }
      _backup_package_history_20260422: {
        Row: {
          changed_at: string | null
          id: string | null
          new_package_id: string | null
          old_package_id: string | null
          reason: string | null
          user_id: string | null
        }
        Insert: {
          changed_at?: string | null
          id?: string | null
          new_package_id?: string | null
          old_package_id?: string | null
          reason?: string | null
          user_id?: string | null
        }
        Update: {
          changed_at?: string | null
          id?: string | null
          new_package_id?: string | null
          old_package_id?: string | null
          reason?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _backup_packages_20260422: {
        Row: {
          created_at: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          price_monthly: number | null
          price_yearly: number | null
          role_id: string | null
          slug: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          price_monthly?: number | null
          price_yearly?: number | null
          role_id?: string | null
          slug?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          price_monthly?: number | null
          price_yearly?: number | null
          role_id?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      _backup_private_messages_20260422: {
        Row: {
          content: string | null
          conversation_id: string | null
          created_at: string | null
          id: string | null
          is_read: boolean | null
          sender_id: string | null
        }
        Insert: {
          content?: string | null
          conversation_id?: string | null
          created_at?: string | null
          id?: string | null
          is_read?: boolean | null
          sender_id?: string | null
        }
        Update: {
          content?: string | null
          conversation_id?: string | null
          created_at?: string | null
          id?: string | null
          is_read?: boolean | null
          sender_id?: string | null
        }
        Relationships: []
      }
      _backup_profile_alerts_20260422: {
        Row: {
          created_at: string | null
          filters: Json | null
          id: string | null
          is_active: boolean | null
          type: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          filters?: Json | null
          id?: string | null
          is_active?: boolean | null
          type?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          filters?: Json | null
          id?: string | null
          is_active?: boolean | null
          type?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _backup_profiles_20260422: {
        Row: {
          availability: string | null
          avatar_url: string | null
          billing_address: string | null
          billing_city: string | null
          billing_country: string | null
          billing_zip: string | null
          bio: string | null
          branch_id: string | null
          created_at: string | null
          daily_rate: number | null
          domain_id: string | null
          first_name: string | null
          id: string | null
          last_name: string | null
          linkedin_url: string | null
          location: string | null
          phone: string | null
          score: number | null
          speciality_id: string | null
          updated_at: string | null
          user_id: string | null
          vat_number: string | null
          website_url: string | null
          years_experience: number | null
        }
        Insert: {
          availability?: string | null
          avatar_url?: string | null
          billing_address?: string | null
          billing_city?: string | null
          billing_country?: string | null
          billing_zip?: string | null
          bio?: string | null
          branch_id?: string | null
          created_at?: string | null
          daily_rate?: number | null
          domain_id?: string | null
          first_name?: string | null
          id?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          location?: string | null
          phone?: string | null
          score?: number | null
          speciality_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          vat_number?: string | null
          website_url?: string | null
          years_experience?: number | null
        }
        Update: {
          availability?: string | null
          avatar_url?: string | null
          billing_address?: string | null
          billing_city?: string | null
          billing_country?: string | null
          billing_zip?: string | null
          bio?: string | null
          branch_id?: string | null
          created_at?: string | null
          daily_rate?: number | null
          domain_id?: string | null
          first_name?: string | null
          id?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          location?: string | null
          phone?: string | null
          score?: number | null
          speciality_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          vat_number?: string | null
          website_url?: string | null
          years_experience?: number | null
        }
        Relationships: []
      }
      _backup_promo_code_uses_20260422: {
        Row: {
          id: string | null
          promo_code_id: string | null
          used_at: string | null
          user_id: string | null
        }
        Insert: {
          id?: string | null
          promo_code_id?: string | null
          used_at?: string | null
          user_id?: string | null
        }
        Update: {
          id?: string | null
          promo_code_id?: string | null
          used_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _backup_promo_codes_20260422: {
        Row: {
          code: string | null
          created_at: string | null
          discount_amount: number | null
          discount_percent: number | null
          expires_at: string | null
          id: string | null
          is_active: boolean | null
          max_uses: number | null
          uses_count: number | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          discount_amount?: number | null
          discount_percent?: number | null
          expires_at?: string | null
          id?: string | null
          is_active?: boolean | null
          max_uses?: number | null
          uses_count?: number | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          discount_amount?: number | null
          discount_percent?: number | null
          expires_at?: string | null
          id?: string | null
          is_active?: boolean | null
          max_uses?: number | null
          uses_count?: number | null
        }
        Relationships: []
      }
      _backup_referrals_20260422: {
        Row: {
          created_at: string | null
          id: string | null
          referred_email: string | null
          referrer_id: string | null
          reward_granted: boolean | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          referred_email?: string | null
          referrer_id?: string | null
          reward_granted?: boolean | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          referred_email?: string | null
          referrer_id?: string | null
          reward_granted?: boolean | null
          status?: string | null
        }
        Relationships: []
      }
      _backup_roles_20260422: {
        Row: {
          created_at: string | null
          description: string | null
          id: string | null
          is_active: boolean | null
          is_multi_domain: boolean | null
          name: string | null
          slug: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string | null
          is_active?: boolean | null
          is_multi_domain?: boolean | null
          name?: string | null
          slug?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string | null
          is_active?: boolean | null
          is_multi_domain?: boolean | null
          name?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      _backup_shortlists_20260422: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string | null
          opportunity_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          opportunity_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          opportunity_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _backup_specialities_20260422: {
        Row: {
          branch_id: string | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          slug: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          slug?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      _backup_subscription_history_20260422: {
        Row: {
          created_at: string | null
          ended_at: string | null
          id: string | null
          package_id: string | null
          started_at: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          ended_at?: string | null
          id?: string | null
          package_id?: string | null
          started_at?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          ended_at?: string | null
          id?: string | null
          package_id?: string | null
          started_at?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _backup_testimonials_20260422: {
        Row: {
          content: string | null
          created_at: string | null
          id: string | null
          is_published: boolean | null
          rating: number | null
          user_id: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          id?: string | null
          is_published?: boolean | null
          rating?: number | null
          user_id?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          id?: string | null
          is_published?: boolean | null
          rating?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      _backup_transactions_20260422: {
        Row: {
          amount: number | null
          created_at: string | null
          currency: string | null
          id: string | null
          package_id: string | null
          status: string | null
          stripe_payment_id: string | null
          user_id: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          currency?: string | null
          id?: string | null
          package_id?: string | null
          status?: string | null
          stripe_payment_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          currency?: string | null
          id?: string | null
          package_id?: string | null
          status?: string | null
          stripe_payment_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _backup_users_20260422: {
        Row: {
          created_at: string | null
          domain_id: string | null
          email: string | null
          first_name: string | null
          id: string | null
          is_active: boolean | null
          is_verified: boolean | null
          language: string | null
          last_name: string | null
          package_id: string | null
          phone: string | null
          role: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          domain_id?: string | null
          email?: string | null
          first_name?: string | null
          id?: string | null
          is_active?: boolean | null
          is_verified?: boolean | null
          language?: string | null
          last_name?: string | null
          package_id?: string | null
          phone?: string | null
          role?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          domain_id?: string | null
          email?: string | null
          first_name?: string | null
          id?: string | null
          is_active?: boolean | null
          is_verified?: boolean | null
          language?: string | null
          last_name?: string | null
          package_id?: string | null
          phone?: string | null
          role?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ad_placements: {
        Row: {
          active: boolean
          content_type: string | null
          created_at: string
          domain_id: string
          entity_id: string | null
          id: string
          image_url: string | null
          position: string
          target_url: string | null
          title: string | null
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          active?: boolean
          content_type?: string | null
          created_at?: string
          domain_id: string
          entity_id?: string | null
          id?: string
          image_url?: string | null
          position: string
          target_url?: string | null
          title?: string | null
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          active?: boolean
          content_type?: string | null
          created_at?: string
          domain_id?: string
          entity_id?: string | null
          id?: string
          image_url?: string | null
          position?: string
          target_url?: string | null
          title?: string | null
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_placements_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          detail: Json | null
          domain_id: string
          entity_id: string
          entity_type: string
          id: string
          ip_address: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          detail?: Json | null
          domain_id: string
          entity_id: string
          entity_type: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          detail?: Json | null
          domain_id?: string
          entity_id?: string
          entity_type?: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_email_domains: {
        Row: {
          active: boolean
          added_by: string | null
          created_at: string
          email_domain: string
          id: string
          reason: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          added_by?: string | null
          created_at?: string
          email_domain: string
          id?: string
          reason?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          added_by?: string | null
          created_at?: string
          email_domain?: string
          id?: string
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocked_email_domains_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_posts: {
        Row: {
          author_id: string | null
          content: string
          cover_url: string | null
          created_at: string
          domain_id: string | null
          excerpt: string | null
          id: string
          published_at: string | null
          slug: string
          status: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          content: string
          cover_url?: string | null
          created_at?: string
          domain_id?: string | null
          excerpt?: string | null
          id?: string
          published_at?: string | null
          slug: string
          status?: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          content?: string
          cover_url?: string | null
          created_at?: string
          domain_id?: string | null
          excerpt?: string | null
          id?: string
          published_at?: string | null
          slug?: string
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_posts_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          domain_id: string
          icon_url: string | null
          id: string
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          domain_id: string
          icon_url?: string | null
          id?: string
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          domain_id?: string
          icon_url?: string | null
          id?: string
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          active: boolean
          budget: number | null
          channel: string | null
          created_at: string
          domain_id: string | null
          end_date: string | null
          id: string
          name: string
          start_date: string | null
          target_role: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          budget?: number | null
          channel?: string | null
          created_at?: string
          domain_id?: string | null
          end_date?: string | null
          id?: string
          name: string
          start_date?: string | null
          target_role?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          budget?: number | null
          channel?: string | null
          created_at?: string
          domain_id?: string | null
          end_date?: string | null
          id?: string
          name?: string
          start_date?: string | null
          target_role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      candidatures: {
        Row: {
          ai_match_score: number | null
          cover_message: string | null
          created_at: string
          domain_id: string
          id: string
          match_id: string | null
          preview: Json | null
          profile_id: string
          publication_id: string
          status: string
          status_reason: string | null
          unlocked_at: string | null
          updated_at: string
        }
        Insert: {
          ai_match_score?: number | null
          cover_message?: string | null
          created_at?: string
          domain_id: string
          id?: string
          match_id?: string | null
          preview?: Json | null
          profile_id: string
          publication_id: string
          status?: string
          status_reason?: string | null
          unlocked_at?: string | null
          updated_at?: string
        }
        Update: {
          ai_match_score?: number | null
          cover_message?: string | null
          created_at?: string
          domain_id?: string
          id?: string
          match_id?: string | null
          preview?: Json | null
          profile_id?: string
          publication_id?: string
          status?: string
          status_reason?: string | null
          unlocked_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidatures_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidatures_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidatures_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidatures_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: false
            referencedRelation: "publications"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          candidature_id: string | null
          created_at: string
          domain_id: string
          expires_at: string | null
          id: string
          last_message_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          candidature_id?: string | null
          created_at?: string
          domain_id: string
          expires_at?: string | null
          id?: string
          last_message_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          candidature_id?: string | null
          created_at?: string
          domain_id?: string
          expires_at?: string | null
          id?: string
          last_message_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_candidature_id_fkey"
            columns: ["candidature_id"]
            isOneToOne: true
            referencedRelation: "candidatures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      countries: {
        Row: {
          active: boolean
          code: string
          created_at: string
          flag_emoji: string
          name_de: string
          name_en: string
          name_es: string
          name_fr: string
          phone_code: string | null
          region: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          flag_emoji: string
          name_de: string
          name_en: string
          name_es: string
          name_fr: string
          phone_code?: string | null
          region?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          flag_emoji?: string
          name_de?: string
          name_en?: string
          name_es?: string
          name_fr?: string
          phone_code?: string | null
          region?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      dashboard_stats: {
        Row: {
          created_at: string
          domain_id: string
          id: string
          metric_key: string
          metric_value: number
          period: string
          period_date: string
        }
        Insert: {
          created_at?: string
          domain_id: string
          id?: string
          metric_key: string
          metric_value: number
          period: string
          period_date: string
        }
        Update: {
          created_at?: string
          domain_id?: string
          id?: string
          metric_key?: string
          metric_value?: number
          period?: string
          period_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_stats_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_configs: {
        Row: {
          cms_content: Json | null
          created_at: string
          domain_id: string
          ecosystem_community_label: string
          ecosystem_domain_search_label: string
          ecosystem_expert_label: string
          ecosystem_speciality_label: string
          favicon_url: string | null
          featured_products: Json
          id: string
          logo_url: string | null
          primary_color: string
          secondary_color: string
          seo_meta: Json | null
          tags: string[]
          updated_at: string
        }
        Insert: {
          cms_content?: Json | null
          created_at?: string
          domain_id: string
          ecosystem_community_label?: string
          ecosystem_domain_search_label?: string
          ecosystem_expert_label?: string
          ecosystem_speciality_label?: string
          favicon_url?: string | null
          featured_products?: Json
          id?: string
          logo_url?: string | null
          primary_color?: string
          secondary_color?: string
          seo_meta?: Json | null
          tags?: string[]
          updated_at?: string
        }
        Update: {
          cms_content?: Json | null
          created_at?: string
          domain_id?: string
          ecosystem_community_label?: string
          ecosystem_domain_search_label?: string
          ecosystem_expert_label?: string
          ecosystem_speciality_label?: string
          favicon_url?: string | null
          featured_products?: Json
          id?: string
          logo_url?: string | null
          primary_color?: string
          secondary_color?: string
          seo_meta?: Json | null
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_configs_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: true
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      domains: {
        Row: {
          active: boolean
          created_at: string | null
          description: string | null
          id: string
          launch_date: string | null
          name: string
          slug: string
          tagline: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string | null
          description?: string | null
          id?: string
          launch_date?: string | null
          name: string
          slug: string
          tagline?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string | null
          description?: string | null
          id?: string
          launch_date?: string | null
          name?: string
          slug?: string
          tagline?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      features: {
        Row: {
          active: boolean
          category: string
          code: string
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
          value_type: string
        }
        Insert: {
          active?: boolean
          category: string
          code: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          value_type: string
        }
        Update: {
          active?: boolean
          category?: string
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          value_type?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          campaign_id: string | null
          created_at: string
          domain_id: string | null
          email: string
          first_name: string | null
          id: string
          last_name: string | null
          source: string | null
          status: string
          updated_at: string
          utm_json: Json | null
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          domain_id?: string | null
          email: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          utm_json?: Json | null
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          domain_id?: string | null
          email?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          utm_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          created_at: string
          domain_id: string
          explanation: Json | null
          id: string
          profile_id: string
          publication_id: string
          score: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          domain_id: string
          explanation?: Json | null
          id?: string
          profile_id: string
          publication_id: string
          score: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          domain_id?: string
          explanation?: Json | null
          id?: string
          profile_id?: string
          publication_id?: string
          score?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: false
            referencedRelation: "publications"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          domain_id: string
          id: string
          read_at: string | null
          sender_id: string
          updated_at: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          domain_id: string
          id?: string
          read_at?: string | null
          sender_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          domain_id?: string
          id?: string
          read_at?: string | null
          sender_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_subscriptions: {
        Row: {
          confirmed: boolean
          created_at: string
          domain_id: string | null
          email: string
          id: string
          unsubscribed_at: string | null
        }
        Insert: {
          confirmed?: boolean
          created_at?: string
          domain_id?: string | null
          email: string
          id?: string
          unsubscribed_at?: string | null
        }
        Update: {
          confirmed?: boolean
          created_at?: string
          domain_id?: string | null
          email?: string
          id?: string
          unsubscribed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "newsletter_subscriptions_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          channel: string
          created_at: string
          domain_id: string
          entity_id: string | null
          id: string
          link_url: string | null
          read_at: string | null
          sent_at: string | null
          status: string
          title: string | null
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          channel?: string
          created_at?: string
          domain_id: string
          entity_id?: string | null
          id?: string
          link_url?: string | null
          read_at?: string | null
          sent_at?: string | null
          status?: string
          title?: string | null
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          channel?: string
          created_at?: string
          domain_id?: string
          entity_id?: string | null
          id?: string
          link_url?: string | null
          read_at?: string | null
          sent_at?: string | null
          status?: string
          title?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_domains: {
        Row: {
          activated_at: string
          active: boolean
          created_at: string
          domain_id: string
          id: string
          organization_id: string
          package_id: string | null
          updated_at: string
        }
        Insert: {
          activated_at?: string
          active?: boolean
          created_at?: string
          domain_id: string
          id?: string
          organization_id: string
          package_id?: string | null
          updated_at?: string
        }
        Update: {
          activated_at?: string
          active?: boolean
          created_at?: string
          domain_id?: string
          id?: string
          organization_id?: string
          package_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_domains_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_domains_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_domains_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          domain_validation_passed: boolean
          email: string
          email_already_exists: boolean
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          role_in_org: string
          status: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          domain_validation_passed?: boolean
          email: string
          email_already_exists?: boolean
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role_in_org?: string
          status?: string
          token: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          domain_validation_passed?: boolean
          email?: string
          email_already_exists?: boolean
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role_in_org?: string
          status?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string
          organization_id: string
          role_in_org: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          organization_id: string
          role_in_org?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          organization_id?: string
          role_in_org?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          company_name: string
          country: string
          created_at: string
          description: string | null
          email_domain: string | null
          id: string
          is_verified: boolean
          logo_url: string | null
          org_type: string
          review_reason: string | null
          sector: string | null
          setup_completed_at: string | null
          siren: string | null
          size: string | null
          updated_at: string
          vat_number: string | null
          verification_data: Json | null
          verification_method: string | null
          verification_notes: string | null
          verification_status: string | null
          verified_at: string | null
          verified_by: string | null
          website_url: string | null
        }
        Insert: {
          company_name: string
          country?: string
          created_at?: string
          description?: string | null
          email_domain?: string | null
          id?: string
          is_verified?: boolean
          logo_url?: string | null
          org_type: string
          review_reason?: string | null
          sector?: string | null
          setup_completed_at?: string | null
          siren?: string | null
          size?: string | null
          updated_at?: string
          vat_number?: string | null
          verification_data?: Json | null
          verification_method?: string | null
          verification_notes?: string | null
          verification_status?: string | null
          verified_at?: string | null
          verified_by?: string | null
          website_url?: string | null
        }
        Update: {
          company_name?: string
          country?: string
          created_at?: string
          description?: string | null
          email_domain?: string | null
          id?: string
          is_verified?: boolean
          logo_url?: string | null
          org_type?: string
          review_reason?: string | null
          sector?: string | null
          setup_completed_at?: string | null
          siren?: string | null
          size?: string | null
          updated_at?: string
          vat_number?: string | null
          verification_data?: Json | null
          verification_method?: string | null
          verification_notes?: string | null
          verification_status?: string | null
          verified_at?: string | null
          verified_by?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      package_features: {
        Row: {
          created_at: string
          feature_code: string
          id: string
          package_id: string
          reset_period: string | null
          value: string
        }
        Insert: {
          created_at?: string
          feature_code: string
          id?: string
          package_id: string
          reset_period?: string | null
          value: string
        }
        Update: {
          created_at?: string
          feature_code?: string
          id?: string
          package_id?: string
          reset_period?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_features_feature_code_fkey"
            columns: ["feature_code"]
            isOneToOne: false
            referencedRelation: "features"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "package_features_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_history: {
        Row: {
          change_reason: string | null
          changed_by: string | null
          created_at: string
          id: string
          package_id: string
          snapshot: Json
        }
        Insert: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          id?: string
          package_id: string
          snapshot: Json
        }
        Update: {
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          id?: string
          package_id?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "package_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_history_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          active: boolean
          created_at: string
          currency: string
          description: string | null
          domain_id: string | null
          id: string
          included_domain_ids: string[] | null
          is_default: boolean
          max_seats: number | null
          name: string
          price_monthly: number | null
          price_yearly: number | null
          scope: string
          slug: string
          stripe_price_id_monthly: string | null
          stripe_price_id_yearly: string | null
          stripe_product_id: string | null
          target_role: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          currency?: string
          description?: string | null
          domain_id?: string | null
          id?: string
          included_domain_ids?: string[] | null
          is_default?: boolean
          max_seats?: number | null
          name: string
          price_monthly?: number | null
          price_yearly?: number | null
          scope?: string
          slug: string
          stripe_price_id_monthly?: string | null
          stripe_price_id_yearly?: string | null
          stripe_product_id?: string | null
          target_role: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          currency?: string
          description?: string | null
          domain_id?: string | null
          id?: string
          included_domain_ids?: string[] | null
          is_default?: boolean
          max_seats?: number | null
          name?: string
          price_monthly?: number | null
          price_yearly?: number | null
          scope?: string
          slug?: string
          stripe_price_id_monthly?: string | null
          stripe_price_id_yearly?: string | null
          stripe_product_id?: string | null
          target_role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packages_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_alerts: {
        Row: {
          accept_direct_message: boolean
          active: boolean
          branch_id: string | null
          created_at: string
          domain_id: string
          frequency: string
          id: string
          location: string | null
          seniority: string | null
          speciality_id: string | null
          updated_at: string
          user_id: string
          work_mode: string | null
        }
        Insert: {
          accept_direct_message?: boolean
          active?: boolean
          branch_id?: string | null
          created_at?: string
          domain_id: string
          frequency?: string
          id?: string
          location?: string | null
          seniority?: string | null
          speciality_id?: string | null
          updated_at?: string
          user_id: string
          work_mode?: string | null
        }
        Update: {
          accept_direct_message?: boolean
          active?: boolean
          branch_id?: string | null
          created_at?: string
          domain_id?: string
          frequency?: string
          id?: string
          location?: string | null
          seniority?: string | null
          speciality_id?: string | null
          updated_at?: string
          user_id?: string
          work_mode?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profile_alerts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_alerts_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_alerts_speciality_id_fkey"
            columns: ["speciality_id"]
            isOneToOne: false
            referencedRelation: "specialities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_educations: {
        Row: {
          created_at: string
          degree: string
          domain_id: string
          end_year: number | null
          field: string | null
          id: string
          location: string | null
          profile_id: string
          school: string
          start_year: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          degree: string
          domain_id: string
          end_year?: number | null
          field?: string | null
          id?: string
          location?: string | null
          profile_id: string
          school: string
          start_year?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          degree?: string
          domain_id?: string
          end_year?: number | null
          field?: string | null
          id?: string
          location?: string | null
          profile_id?: string
          school?: string
          start_year?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_educations_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_educations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_experiences: {
        Row: {
          client_name: string | null
          created_at: string
          description: string | null
          domain_id: string
          employer: string | null
          end_date: string | null
          experience_type: string
          id: string
          is_current: boolean
          profile_id: string
          role: string
          sector: string | null
          sort_order: number
          start_date: string
          updated_at: string
        }
        Insert: {
          client_name?: string | null
          created_at?: string
          description?: string | null
          domain_id: string
          employer?: string | null
          end_date?: string | null
          experience_type?: string
          id?: string
          is_current?: boolean
          profile_id: string
          role: string
          sector?: string | null
          sort_order?: number
          start_date: string
          updated_at?: string
        }
        Update: {
          client_name?: string | null
          created_at?: string
          description?: string | null
          domain_id?: string
          employer?: string | null
          end_date?: string | null
          experience_type?: string
          id?: string
          is_current?: boolean
          profile_id?: string
          role?: string
          sector?: string | null
          sort_order?: number
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_experiences_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_experiences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_languages: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          language: string
          level: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          language: string
          level: string
          profile_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          language?: string
          level?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_languages_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address_line: string | null
          ai_consent_at: string | null
          availability_date: string | null
          availability_status: string | null
          birth_year: number | null
          branch_id: string | null
          cdi_availability_date: string | null
          cdi_benefits: string[] | null
          cdi_career_goals: string | null
          cdi_company_size: string[] | null
          cdi_confidential_mode: boolean | null
          cdi_contract_types: string[] | null
          cdi_geo_mobility: string | null
          cdi_motivations: string | null
          cdi_notice_period: string | null
          cdi_salary_max: number | null
          cdi_salary_min: number | null
          cdi_sectors: string[] | null
          cdi_status: string | null
          cdi_variable_pct: number | null
          certifications: Json
          city: string | null
          country: string | null
          created_at: string
          cv_file_path: string | null
          cv_hash: string | null
          cv_parsed_at: string | null
          cv_parsing_count_24h: number | null
          cv_parsing_error: string | null
          cv_parsing_reset_at: string | null
          cv_parsing_status: string | null
          cv_uploaded_at: string | null
          cv_url: string | null
          deletion_scheduled_at: string | null
          domain_id: string
          expert_type: string | null
          id: string
          languages: string[]
          pre_deletion_visible: boolean | null
          linkedin_url: string | null
          location: string | null
          mobility: string | null
          phone: string | null
          photo_url: string | null
          postal_code: string | null
          profile_score: number
          salary_max: number | null
          salary_min: number | null
          seniority: string | null
          skills: string[]
          speciality_id: string | null
          summary: string | null
          title: string | null
          tjm_max: number | null
          tjm_min: number | null
          updated_at: string
          user_id: string
          visible: boolean
          work_modes: string[]
          years_experience: number | null
          years_total_experience: number | null
        }
        Insert: {
          address_line?: string | null
          ai_consent_at?: string | null
          availability_date?: string | null
          availability_status?: string | null
          birth_year?: number | null
          branch_id?: string | null
          cdi_availability_date?: string | null
          cdi_benefits?: string[] | null
          cdi_career_goals?: string | null
          cdi_company_size?: string[] | null
          cdi_confidential_mode?: boolean | null
          cdi_contract_types?: string[] | null
          cdi_geo_mobility?: string | null
          cdi_motivations?: string | null
          cdi_notice_period?: string | null
          cdi_salary_max?: number | null
          cdi_salary_min?: number | null
          cdi_sectors?: string[] | null
          cdi_status?: string | null
          cdi_variable_pct?: number | null
          certifications?: Json
          city?: string | null
          country?: string | null
          created_at?: string
          cv_file_path?: string | null
          cv_hash?: string | null
          cv_parsed_at?: string | null
          cv_parsing_count_24h?: number | null
          cv_parsing_error?: string | null
          cv_parsing_reset_at?: string | null
          cv_parsing_status?: string | null
          cv_uploaded_at?: string | null
          cv_url?: string | null
          deletion_scheduled_at?: string | null
          domain_id: string
          expert_type?: string | null
          id?: string
          languages?: string[]
          linkedin_url?: string | null
          location?: string | null
          mobility?: string | null
          phone?: string | null
          photo_url?: string | null
          postal_code?: string | null
          pre_deletion_visible?: boolean | null
          profile_score?: number
          salary_max?: number | null
          salary_min?: number | null
          seniority?: string | null
          skills?: string[]
          speciality_id?: string | null
          summary?: string | null
          title?: string | null
          tjm_max?: number | null
          tjm_min?: number | null
          updated_at?: string
          user_id: string
          visible?: boolean
          work_modes?: string[]
          years_experience?: number | null
          years_total_experience?: number | null
        }
        Update: {
          address_line?: string | null
          ai_consent_at?: string | null
          availability_date?: string | null
          availability_status?: string | null
          birth_year?: number | null
          branch_id?: string | null
          cdi_availability_date?: string | null
          cdi_benefits?: string[] | null
          cdi_career_goals?: string | null
          cdi_company_size?: string[] | null
          cdi_confidential_mode?: boolean | null
          cdi_contract_types?: string[] | null
          cdi_geo_mobility?: string | null
          cdi_motivations?: string | null
          cdi_notice_period?: string | null
          cdi_salary_max?: number | null
          cdi_salary_min?: number | null
          cdi_sectors?: string[] | null
          cdi_status?: string | null
          cdi_variable_pct?: number | null
          certifications?: Json
          city?: string | null
          country?: string | null
          created_at?: string
          cv_file_path?: string | null
          cv_hash?: string | null
          cv_parsed_at?: string | null
          cv_parsing_count_24h?: number | null
          cv_parsing_error?: string | null
          cv_parsing_reset_at?: string | null
          cv_parsing_status?: string | null
          cv_uploaded_at?: string | null
          cv_url?: string | null
          deletion_scheduled_at?: string | null
          domain_id?: string
          expert_type?: string | null
          id?: string
          languages?: string[]
          linkedin_url?: string | null
          location?: string | null
          mobility?: string | null
          phone?: string | null
          photo_url?: string | null
          postal_code?: string | null
          pre_deletion_visible?: boolean | null
          profile_score?: number
          salary_max?: number | null
          salary_min?: number | null
          seniority?: string | null
          skills?: string[]
          speciality_id?: string | null
          summary?: string | null
          title?: string | null
          tjm_max?: number | null
          tjm_min?: number | null
          updated_at?: string
          user_id?: string
          visible?: boolean
          work_modes?: string[]
          years_experience?: number | null
          years_total_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_speciality_id_fkey"
            columns: ["speciality_id"]
            isOneToOne: false
            referencedRelation: "specialities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_code_uses: {
        Row: {
          created_at: string
          id: string
          promo_code_id: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          promo_code_id: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          promo_code_id?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_code_uses_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_code_uses_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_code_uses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          discount_type: string
          discount_value: number
          domain_id: string | null
          id: string
          max_uses: number | null
          updated_at: string
          used_count: number
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          discount_type: string
          discount_value: number
          domain_id?: string | null
          id?: string
          max_uses?: number | null
          updated_at?: string
          used_count?: number
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          discount_type?: string
          discount_value?: number
          domain_id?: string | null
          id?: string
          max_uses?: number | null
          updated_at?: string
          used_count?: number
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promo_codes_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      public_email_domains: {
        Row: {
          active: boolean
          added_by: string | null
          created_at: string
          email_domain: string
          id: string
          reason: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          added_by?: string | null
          created_at?: string
          email_domain: string
          id?: string
          reason?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          added_by?: string | null
          created_at?: string
          email_domain?: string
          id?: string
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_email_domains_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      publications: {
        Row: {
          branch_id: string | null
          budget_max: number | null
          budget_min: number | null
          confidential: boolean
          created_at: string
          created_by: string | null
          description: string
          domain_id: string
          duration: string | null
          expires_at: string | null
          id: string
          location: string | null
          organization_id: string
          published_at: string | null
          review_reason: string | null
          seniority: string | null
          skills_required: string[]
          speciality_id: string | null
          start_date: string | null
          status: string
          title: string
          type: string
          updated_at: string
          verification_data: Json | null
          verification_method: string | null
          verification_score: number | null
          verified_at: string | null
          verified_by: string | null
          work_mode: string | null
        }
        Insert: {
          branch_id?: string | null
          budget_max?: number | null
          budget_min?: number | null
          confidential?: boolean
          created_at?: string
          created_by?: string | null
          description: string
          domain_id: string
          duration?: string | null
          expires_at?: string | null
          id?: string
          location?: string | null
          organization_id: string
          published_at?: string | null
          review_reason?: string | null
          seniority?: string | null
          skills_required?: string[]
          speciality_id?: string | null
          start_date?: string | null
          status?: string
          title: string
          type: string
          updated_at?: string
          verification_data?: Json | null
          verification_method?: string | null
          verification_score?: number | null
          verified_at?: string | null
          verified_by?: string | null
          work_mode?: string | null
        }
        Update: {
          branch_id?: string | null
          budget_max?: number | null
          budget_min?: number | null
          confidential?: boolean
          created_at?: string
          created_by?: string | null
          description?: string
          domain_id?: string
          duration?: string | null
          expires_at?: string | null
          id?: string
          location?: string | null
          organization_id?: string
          published_at?: string | null
          review_reason?: string | null
          seniority?: string | null
          skills_required?: string[]
          speciality_id?: string | null
          start_date?: string | null
          status?: string
          title?: string
          type?: string
          updated_at?: string
          verification_data?: Json | null
          verification_method?: string | null
          verification_score?: number | null
          verified_at?: string | null
          verified_by?: string | null
          work_mode?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "publications_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publications_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publications_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publications_speciality_id_fkey"
            columns: ["speciality_id"]
            isOneToOne: false
            referencedRelation: "specialities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "publications_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          referral_code: string
          referred_id: string | null
          referrer_id: string
          reward_value: number | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          referral_code: string
          referred_id?: string | null
          referrer_id: string
          reward_value?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          referral_code?: string
          referred_id?: string | null
          referrer_id?: string
          reward_value?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      session_logs: {
        Row: {
          created_at: string
          id: string
          ip_address: unknown
          login_at: string
          session_token: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip_address?: unknown
          login_at?: string
          session_token?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ip_address?: unknown
          login_at?: string
          session_token?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      specialities: {
        Row: {
          active: boolean
          branch_id: string
          created_at: string
          domain_id: string
          id: string
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          branch_id: string
          created_at?: string
          domain_id: string
          id?: string
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          branch_id?: string
          created_at?: string
          domain_id?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "specialities_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "specialities_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_history: {
        Row: {
          change_reason: string | null
          created_at: string
          domain_id: string
          id: string
          package_from: string | null
          package_to: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          change_reason?: string | null
          created_at?: string
          domain_id: string
          id?: string
          package_from?: string | null
          package_to: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          change_reason?: string | null
          created_at?: string
          domain_id?: string
          id?: string
          package_from?: string | null
          package_to?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_history_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_history_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      testimonials: {
        Row: {
          author_name: string | null
          author_role: string | null
          content: string
          created_at: string
          domain_id: string | null
          id: string
          published: boolean
          rating: number | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          author_name?: string | null
          author_role?: string | null
          content: string
          created_at?: string
          domain_id?: string | null
          id?: string
          published?: boolean
          rating?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          author_name?: string | null
          author_role?: string | null
          content?: string
          created_at?: string
          domain_id?: string | null
          id?: string
          published?: boolean
          rating?: number | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "testimonials_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "testimonials_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          billing_period: string | null
          created_at: string
          currency: string
          domain_id: string
          id: string
          invoice_url: string | null
          package_id: string | null
          period_end: string | null
          period_start: string | null
          status: string
          stripe_customer_id: string | null
          stripe_payment_intent_id: string | null
          stripe_subscription_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          billing_period?: string | null
          created_at?: string
          currency?: string
          domain_id: string
          id?: string
          invoice_url?: string | null
          package_id?: string | null
          period_end?: string | null
          period_start?: string | null
          status: string
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          billing_period?: string | null
          created_at?: string
          currency?: string
          domain_id?: string
          id?: string
          invoice_url?: string | null
          package_id?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      translations: {
        Row: {
          created_at: string
          field: string
          locale: string
          row_id: string
          table_name: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          field: string
          locale: string
          row_id: string
          table_name: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          field?: string
          locale?: string
          row_id?: string
          table_name?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          anonymized_at: string | null
          civility: string | null
          created_at: string
          deletion_scheduled_at: string | null
          domain_id: string
          email: string
          email_verified: boolean
          first_name: string | null
          id: string
          is_verified: boolean
          job_title: string | null
          last_login_at: string | null
          last_name: string | null
          last_session_token: string | null
          linkedin_url: string | null
          locale: string
          phone: string | null
          phone_verified: boolean
          role_id: string
          status: string
          updated_at: string
          user_type: string
        }
        Insert: {
          anonymized_at?: string | null
          civility?: string | null
          created_at?: string
          deletion_scheduled_at?: string | null
          domain_id: string
          email: string
          email_verified?: boolean
          first_name?: string | null
          id: string
          is_verified?: boolean
          job_title?: string | null
          last_login_at?: string | null
          last_name?: string | null
          last_session_token?: string | null
          linkedin_url?: string | null
          locale?: string
          phone?: string | null
          phone_verified?: boolean
          role_id: string
          status?: string
          updated_at?: string
          user_type: string
        }
        Update: {
          anonymized_at?: string | null
          civility?: string | null
          created_at?: string
          deletion_scheduled_at?: string | null
          domain_id?: string
          email?: string
          email_verified?: boolean
          first_name?: string | null
          id?: string
          is_verified?: boolean
          job_title?: string | null
          last_login_at?: string | null
          last_name?: string | null
          last_session_token?: string | null
          linkedin_url?: string | null
          locale?: string
          phone?: string | null
          phone_verified?: boolean
          role_id?: string
          status?: string
          updated_at?: string
          user_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_domain_id_fkey"
            columns: ["domain_id"]
            isOneToOne: false
            referencedRelation: "domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_attempts: {
        Row: {
          attempt_at: string
          confidence_score: number | null
          created_at: string
          id: string
          organization_id: string
          provider_used: string
          raw_response: Json | null
          result: string
          triggered_admin_review: boolean
        }
        Insert: {
          attempt_at?: string
          confidence_score?: number | null
          created_at?: string
          id?: string
          organization_id: string
          provider_used: string
          raw_response?: Json | null
          result: string
          triggered_admin_review?: boolean
        }
        Update: {
          attempt_at?: string
          confidence_score?: number | null
          created_at?: string
          id?: string
          organization_id?: string
          provider_used?: string
          raw_response?: Json | null
          result?: string
          triggered_admin_review?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "verification_attempts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_providers: {
        Row: {
          api_endpoint: string | null
          api_key_secret_ref: string | null
          confidence_threshold: number
          country_code: string
          created_at: string
          id: string
          is_active: boolean
          priority: number
          provider_name: string
          provider_type: string
          updated_at: string
        }
        Insert: {
          api_endpoint?: string | null
          api_key_secret_ref?: string | null
          confidence_threshold?: number
          country_code: string
          created_at?: string
          id?: string
          is_active?: boolean
          priority?: number
          provider_name: string
          provider_type: string
          updated_at?: string
        }
        Update: {
          api_endpoint?: string | null
          api_key_secret_ref?: string | null
          confidence_threshold?: number
          country_code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          priority?: number
          provider_name?: string
          provider_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          created_at: string | null
          email: string
          first_name: string | null
          id: string
          role_interest: string | null
          source: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          first_name?: string | null
          id?: string
          role_interest?: string | null
          source?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          first_name?: string | null
          id?: string
          role_interest?: string | null
          source?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_active_admin_of_org: { Args: { p_org_id: string }; Returns: boolean }
      is_active_member_of_org: { Args: { p_org_id: string }; Returns: boolean }
    }
    Enums: {
      organization_role: "admin" | "editor" | "viewer"
      package_scope: "organization" | "user" | "organization_per_seat"
      verification_status_enum:
        | "pending_provider_check"
        | "pending_admin_review"
        | "approved"
        | "rejected"
        | "requires_more_info"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      organization_role: ["admin", "editor", "viewer"],
      package_scope: ["organization", "user", "organization_per_seat"],
      verification_status_enum: [
        "pending_provider_check",
        "pending_admin_review",
        "approved",
        "rejected",
        "requires_more_info",
      ],
    },
  },
} as const
