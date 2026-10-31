export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      account_opening_balances: {
        Row: {
          account_id: string
          adjustment_date: string
          adjustment_transaction_id: string | null
          created_at: string
          created_by: string | null
          notes: string | null
          target_balance: number
          updated_at: string
        }
        Insert: {
          account_id: string
          adjustment_date: string
          adjustment_transaction_id?: string | null
          created_at?: string
          created_by?: string | null
          notes?: string | null
          target_balance: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          adjustment_date?: string
          adjustment_transaction_id?: string | null
          created_at?: string
          created_by?: string | null
          notes?: string | null
          target_balance?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_opening_balances_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_opening_balances_adjustment_transaction_id_fkey"
            columns: ["adjustment_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_opening_balances_adjustment_transaction_id_fkey"
            columns: ["adjustment_transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transactions_tagged"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_closed_periods: {
        Row: {
          closed_at: string
          closed_by: string | null
          note: string | null
          period: string
        }
        Insert: {
          closed_at?: string
          closed_by?: string | null
          note?: string | null
          period: string
        }
        Update: {
          closed_at?: string
          closed_by?: string | null
          note?: string | null
          period?: string
        }
        Relationships: []
      }
      accounts: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          opening_balance: number
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          opening_balance?: number
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          opening_balance?: number
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      afip_ta_cache: {
        Row: {
          cached_at: string
          expiration_time: string
          service: string
          sign: string
          token: string
        }
        Insert: {
          cached_at?: string
          expiration_time: string
          service: string
          sign: string
          token: string
        }
        Update: {
          cached_at?: string
          expiration_time?: string
          service?: string
          sign?: string
          token?: string
        }
        Relationships: []
      }
      ai_chat_confirmations: {
        Row: {
          action: string
          created_at: string
          decided_at: string | null
          draft: Json
          error: string | null
          id: string
          labels: Json
          origin: string
          result_id: string | null
          revision: number
          revision_key: string
          session_id: string
          status: string
          summary: Json
          tool_call_id: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          decided_at?: string | null
          draft: Json
          error?: string | null
          id?: string
          labels?: Json
          origin?: string
          result_id?: string | null
          revision?: number
          revision_key: string
          session_id: string
          status?: string
          summary: Json
          tool_call_id: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          decided_at?: string | null
          draft?: Json
          error?: string | null
          id?: string
          labels?: Json
          origin?: string
          result_id?: string | null
          revision?: number
          revision_key?: string
          session_id?: string
          status?: string
          summary?: Json
          tool_call_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_confirmations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_messages: {
        Row: {
          content: Json
          created_at: string
          id: string
          role: string
          session_id: string
        }
        Insert: {
          content: Json
          created_at?: string
          id?: string
          role: string
          session_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          role?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_sessions: {
        Row: {
          created_at: string
          id: string
          message_count: number
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_count?: number
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_count?: number
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_document_extractions: {
        Row: {
          confidence: number | null
          created_at: string
          created_by: string | null
          created_entity: Json | null
          detected_type: string | null
          file_id: string
          id: string
          matches: Json
          payload: Json
          status: string
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          created_entity?: Json | null
          detected_type?: string | null
          file_id: string
          id?: string
          matches?: Json
          payload?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          created_entity?: Json | null
          detected_type?: string | null
          file_id?: string
          id?: string
          matches?: Json
          payload?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_document_extractions_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_insights: {
        Row: {
          created_at: string
          dismissed_at: string | null
          dismissed_by: string | null
          dismissed_reason: string | null
          finding: string
          fingerprint: string | null
          generated_at: string
          id: string
          kind: string
          metrics: Json
          period: string | null
          severity: string
          source_refs: Json
          status: string
          title: string
        }
        Insert: {
          created_at?: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          dismissed_reason?: string | null
          finding: string
          fingerprint?: string | null
          generated_at?: string
          id?: string
          kind: string
          metrics?: Json
          period?: string | null
          severity: string
          source_refs?: Json
          status?: string
          title: string
        }
        Update: {
          created_at?: string
          dismissed_at?: string | null
          dismissed_by?: string | null
          dismissed_reason?: string | null
          finding?: string
          fingerprint?: string | null
          generated_at?: string
          id?: string
          kind?: string
          metrics?: Json
          period?: string | null
          severity?: string
          source_refs?: Json
          status?: string
          title?: string
        }
        Relationships: []
      }
      ai_pinned_artifacts: {
        Row: {
          action: string
          config: Json
          created_at: string
          id: string
          input: Json
          kind: string
          title: string
          user_id: string
        }
        Insert: {
          action: string
          config: Json
          created_at?: string
          id?: string
          input?: Json
          kind: string
          title: string
          user_id: string
        }
        Update: {
          action?: string
          config?: Json
          created_at?: string
          id?: string
          input?: Json
          kind?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          cached_tokens: number | null
          completion_tokens: number | null
          cost_usd: number | null
          created_at: string
          id: string
          kind: string
          model: string | null
          prompt_tokens: number | null
          session_id: string | null
          tool_names: string[] | null
          user_id: string | null
        }
        Insert: {
          cached_tokens?: number | null
          completion_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          id?: string
          kind?: string
          model?: string | null
          prompt_tokens?: number | null
          session_id?: string | null
          tool_names?: string[] | null
          user_id?: string | null
        }
        Update: {
          cached_tokens?: number | null
          completion_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          id?: string
          kind?: string
          model?: string | null
          prompt_tokens?: number | null
          session_id?: string | null
          tool_names?: string[] | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_weekly_summaries: {
        Row: {
          content: string
          created_at: string
          id: string
          sources: string[]
          user_id: string
          week_start: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          sources?: string[]
          user_id: string
          week_start: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          sources?: string[]
          user_id?: string
          week_start?: string
        }
        Relationships: []
      }
      ai_workflow_runs: {
        Row: {
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          output: string | null
          previous_run_id: string | null
          scheduled_for: string
          skip_reason: string | null
          started_at: string | null
          status: string
          summary: string | null
          tool_names: string[] | null
          user_id: string
          workflow_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          output?: string | null
          previous_run_id?: string | null
          scheduled_for: string
          skip_reason?: string | null
          started_at?: string | null
          status?: string
          summary?: string | null
          tool_names?: string[] | null
          user_id: string
          workflow_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          output?: string | null
          previous_run_id?: string | null
          scheduled_for?: string
          skip_reason?: string | null
          started_at?: string | null
          status?: string
          summary?: string | null
          tool_names?: string[] | null
          user_id?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_workflow_runs_previous_run_id_fkey"
            columns: ["previous_run_id"]
            isOneToOne: false
            referencedRelation: "ai_workflow_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "ai_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_workflows: {
        Row: {
          cadence: string
          created_at: string
          id: string
          is_active: boolean
          month_day: number | null
          next_run_at: string
          prompt: string
          run_hour: number
          run_minute: number
          title: string
          updated_at: string
          user_id: string
          weekday: number | null
        }
        Insert: {
          cadence: string
          created_at?: string
          id?: string
          is_active?: boolean
          month_day?: number | null
          next_run_at: string
          prompt: string
          run_hour: number
          run_minute: number
          title: string
          updated_at?: string
          user_id: string
          weekday?: number | null
        }
        Update: {
          cadence?: string
          created_at?: string
          id?: string
          is_active?: boolean
          month_day?: number | null
          next_run_at?: string
          prompt?: string
          run_hour?: number
          run_minute?: number
          title?: string
          updated_at?: string
          user_id?: string
          weekday?: number | null
        }
        Relationships: []
      }
      attendance_records: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          employee_id: string
          hours_lost: number | null
          id: string
          kind: Database["public"]["Enums"]["attendance_kind"]
          notes: string | null
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date: string
          employee_id: string
          hours_lost?: number | null
          id?: string
          kind: Database["public"]["Enums"]["attendance_kind"]
          notes?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          employee_id?: string
          hours_lost?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["attendance_kind"]
          notes?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          actor_id: string | null
          actor_type: string
          event_type: string
          id: string
          ip_address: unknown
          payload: Json
          target_resource_id: string | null
          target_user_id: string | null
          ts: string
          user_agent: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string
          event_type: string
          id?: string
          ip_address?: unknown
          payload?: Json
          target_resource_id?: string | null
          target_user_id?: string | null
          ts?: string
          user_agent?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          event_type?: string
          id?: string
          ip_address?: unknown
          payload?: Json
          target_resource_id?: string | null
          target_user_id?: string | null
          ts?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      auto_journal_mapping: {
        Row: {
          account_role: Database["public"]["Enums"]["coa_system_role"] | null
          chart_of_accounts_id: string
          conditions: Json
          created_at: string
          event_type: string
          id: string
          is_active: boolean
          notes: string | null
          updated_at: string
        }
        Insert: {
          account_role?: Database["public"]["Enums"]["coa_system_role"] | null
          chart_of_accounts_id: string
          conditions?: Json
          created_at?: string
          event_type: string
          id?: string
          is_active?: boolean
          notes?: string | null
          updated_at?: string
        }
        Update: {
          account_role?: Database["public"]["Enums"]["coa_system_role"] | null
          chart_of_accounts_id?: string
          conditions?: Json
          created_at?: string
          event_type?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_journal_mapping_chart_of_accounts_id_fkey"
            columns: ["chart_of_accounts_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_journal_mapping_chart_of_accounts_id_fkey"
            columns: ["chart_of_accounts_id"]
            isOneToOne: false
            referencedRelation: "expense_leaf_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      business_units: {
        Row: {
          created_at: string
          cuit: string
          id: string
          iibb_number: string | null
          inicio_actividades: string | null
          is_active: boolean
          name: string
          tax_address: string | null
          tax_condition: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          cuit: string
          id: string
          iibb_number?: string | null
          inicio_actividades?: string | null
          is_active?: boolean
          name: string
          tax_address?: string | null
          tax_condition: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          cuit?: string
          id?: string
          iibb_number?: string | null
          inicio_actividades?: string | null
          is_active?: boolean
          name?: string
          tax_address?: string | null
          tax_condition?: string
          updated_at?: string
        }
        Relationships: []
      }
      caea_codes: {
        Row: {
          caea: string
          created_at: string
          fch_proceso: string | null
          fch_tope_inf: string
          fch_vig_desde: string
          fch_vig_hasta: string
          id: string
          no_movement_pvs: Json
          observaciones: Json | null
          orden: number
          periodo: number
        }
        Insert: {
          caea: string
          created_at?: string
          fch_proceso?: string | null
          fch_tope_inf: string
          fch_vig_desde: string
          fch_vig_hasta: string
          id?: string
          no_movement_pvs?: Json
          observaciones?: Json | null
          orden: number
          periodo: number
        }
        Update: {
          caea?: string
          created_at?: string
          fch_proceso?: string | null
          fch_tope_inf?: string
          fch_vig_desde?: string
          fch_vig_hasta?: string
          id?: string
          no_movement_pvs?: Json
          observaciones?: Json | null
          orden?: number
          periodo?: number
        }
        Relationships: []
      }
      chart_of_accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["coa_account_type"]
          code: string
          created_at: string
          created_by: string | null
          eerr_category: string | null
          id: string
          is_active: boolean
          level: number
          name: string
          parent_id: string | null
          system_role: Database["public"]["Enums"]["coa_system_role"] | null
          updated_at: string
        }
        Insert: {
          account_type: Database["public"]["Enums"]["coa_account_type"]
          code: string
          created_at?: string
          created_by?: string | null
          eerr_category?: string | null
          id?: string
          is_active?: boolean
          level: number
          name: string
          parent_id?: string | null
          system_role?: Database["public"]["Enums"]["coa_system_role"] | null
          updated_at?: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["coa_account_type"]
          code?: string
          created_at?: string
          created_by?: string | null
          eerr_category?: string | null
          id?: string
          is_active?: boolean
          level?: number
          name?: string
          parent_id?: string | null
          system_role?: Database["public"]["Enums"]["coa_system_role"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "expense_leaf_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channel_members: {
        Row: {
          channel_id: string
          is_muted: boolean
          joined_at: string
          last_read_at: string
          role: string
          user_id: string
        }
        Insert: {
          channel_id: string
          is_muted?: boolean
          joined_at?: string
          last_read_at?: string
          role?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          is_muted?: boolean
          joined_at?: string
          last_read_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channel_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channels: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          dm_pair_key: string | null
          id: string
          kind: Database["public"]["Enums"]["chat_channel_kind"]
          last_message_at: string | null
          name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          dm_pair_key?: string | null
          id?: string
          kind: Database["public"]["Enums"]["chat_channel_kind"]
          last_message_at?: string | null
          name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          dm_pair_key?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["chat_channel_kind"]
          last_message_at?: string | null
          name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      chat_message_mentions: {
        Row: {
          created_at: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_mentions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          body: string
          channel_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          reply_to_message_id: string | null
          sender_id: string
        }
        Insert: {
          body: string
          channel_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          reply_to_message_id?: string | null
          sender_id: string
        }
        Update: {
          body?: string
          channel_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          reply_to_message_id?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      check_movements: {
        Row: {
          check_id: string
          created_at: string
          created_by: string | null
          destination_account_id: string | null
          endorsed_to_cuit: string | null
          endorsed_to_name: string | null
          event: string
          event_date: string
          id: string
          notes: string | null
          transaction_id: string | null
        }
        Insert: {
          check_id: string
          created_at?: string
          created_by?: string | null
          destination_account_id?: string | null
          endorsed_to_cuit?: string | null
          endorsed_to_name?: string | null
          event: string
          event_date: string
          id?: string
          notes?: string | null
          transaction_id?: string | null
        }
        Update: {
          check_id?: string
          created_at?: string
          created_by?: string | null
          destination_account_id?: string | null
          endorsed_to_cuit?: string | null
          endorsed_to_name?: string | null
          event?: string
          event_date?: string
          id?: string
          notes?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "check_movements_check_id_fkey"
            columns: ["check_id"]
            isOneToOne: false
            referencedRelation: "checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_movements_check_id_fkey"
            columns: ["check_id"]
            isOneToOne: false
            referencedRelation: "v_rejected_check_open"
            referencedColumns: ["check_id"]
          },
          {
            foreignKeyName: "check_movements_destination_account_id_fkey"
            columns: ["destination_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_movements_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_movements_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transactions_tagged"
            referencedColumns: ["id"]
          },
        ]
      }
      checks: {
        Row: {
          amount: number
          bank_name: string
          cartera_account_id: string
          channel_id: string | null
          check_number: string
          created_at: string
          created_by: string | null
          currency: string
          drawer_cuit: string | null
          drawer_name: string
          due_date: string
          id: string
          issue_date: string
          kind: string
          notes: string | null
          source_client_id: string | null
          source_kind: string
          source_payment_line_id: string | null
          source_receipt_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          bank_name: string
          cartera_account_id: string
          channel_id?: string | null
          check_number: string
          created_at?: string
          created_by?: string | null
          currency: string
          drawer_cuit?: string | null
          drawer_name: string
          due_date: string
          id?: string
          issue_date: string
          kind: string
          notes?: string | null
          source_client_id?: string | null
          source_kind: string
          source_payment_line_id?: string | null
          source_receipt_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_name?: string
          cartera_account_id?: string
          channel_id?: string | null
          check_number?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          drawer_cuit?: string | null
          drawer_name?: string
          due_date?: string
          id?: string
          issue_date?: string
          kind?: string
          notes?: string | null
          source_client_id?: string | null
          source_kind?: string
          source_payment_line_id?: string | null
          source_receipt_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checks_cartera_account_id_fkey"
            columns: ["cartera_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checks_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checks_source_client_id_fkey"
            columns: ["source_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checks_source_payment_line_id_fkey"
            columns: ["source_payment_line_id"]
            isOneToOne: false
            referencedRelation: "receipt_payment_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checks_source_receipt_id_fkey"
            columns: ["source_receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checks_source_receipt_id_fkey"
            columns: ["source_receipt_id"]
            isOneToOne: false
            referencedRelation: "v_rejected_check_open"
            referencedColumns: ["source_receipt_id"]
          },
        ]
      }
      client_opening_balance_allocations: {
        Row: {
          amount_applied: number
          client_id: string
          created_at: string
          invoice_id: string
        }
        Insert: {
          amount_applied: number
          client_id: string
          created_at?: string
          invoice_id: string
        }
        Update: {
          amount_applied?: number
          client_id?: string
          created_at?: string
          invoice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_opening_balance_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_opening_balance_allocations_opening_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_opening_balances"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_opening_balances: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          notes: string | null
          opening_date: string
          target_balance: number
          total_settled: number
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          notes?: string | null
          opening_date: string
          target_balance: number
          total_settled: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          notes?: string | null
          opening_date?: string
          target_balance?: number
          total_settled?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_opening_balances_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          created_at: string
          created_by: string | null
          cuit: string
          display_name: string | null
          email: string | null
          id: string
          is_active: boolean
          iva_condition: string
          legal_name: string
          notes: string | null
          phone: string | null
          real_address: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          cuit: string
          display_name?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          iva_condition: string
          legal_name: string
          notes?: string | null
          phone?: string | null
          real_address?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          cuit?: string
          display_name?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          iva_condition?: string
          legal_name?: string
          notes?: string | null
          phone?: string | null
          real_address?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cost_centers: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      dashboard_layouts: {
        Row: {
          layout: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          layout: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          layout?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      drivers: {
        Row: {
          created_at: string
          created_by: string | null
          cuit: string | null
          employee_id: string | null
          full_name: string
          id: string
          is_active: boolean
          license_category: string | null
          license_number: string | null
          notes: string | null
          phone: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          cuit?: string | null
          employee_id?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          license_category?: string | null
          license_number?: string | null
          notes?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          cuit?: string | null
          employee_id?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          license_category?: string | null
          license_number?: string | null
          notes?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drivers_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          body: string | null
          created_at: string
          entity_id: string
          entity_type: string
          error: string | null
          id: string
          provider_message_id: string | null
          recipient: string
          sent_by: string | null
          status: string
          subject: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          error?: string | null
          id?: string
          provider_message_id?: string | null
          recipient: string
          sent_by?: string | null
          status: string
          subject: string
        }
        Update: {
          body?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          error?: string | null
          id?: string
          provider_message_id?: string | null
          recipient?: string
          sent_by?: string | null
          status?: string
          subject?: string
        }
        Relationships: []
      }
      employee_documents: {
        Row: {
          attachment_file_id: string | null
          created_at: string
          created_by: string | null
          employee_id: string
          expires_at: string
          id: string
          issued_at: string | null
          issuing_authority: string | null
          kind: Database["public"]["Enums"]["employee_document_kind"]
          notes: string | null
          notified_at: string | null
          number: string | null
          updated_at: string
        }
        Insert: {
          attachment_file_id?: string | null
          created_at?: string
          created_by?: string | null
          employee_id: string
          expires_at: string
          id?: string
          issued_at?: string | null
          issuing_authority?: string | null
          kind: Database["public"]["Enums"]["employee_document_kind"]
          notes?: string | null
          notified_at?: string | null
          number?: string | null
          updated_at?: string
        }
        Update: {
          attachment_file_id?: string | null
          created_at?: string
          created_by?: string | null
          employee_id?: string
          expires_at?: string
          id?: string
          issued_at?: string | null
          issuing_authority?: string | null
          kind?: Database["public"]["Enums"]["employee_document_kind"]
          notes?: string | null
          notified_at?: string | null
          number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_documents_attachment_file_id_fkey"
            columns: ["attachment_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_leaves: {
        Row: {
          created_at: string
          created_by: string | null
          days: number | null
          employee_id: string
          end_date: string
          id: string
          kind: Database["public"]["Enums"]["leave_kind"]
          notes: string | null
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          days?: number | null
          employee_id: string
          end_date: string
          id?: string
          kind: Database["public"]["Enums"]["leave_kind"]
          notes?: string | null
          start_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          days?: number | null
          employee_id?: string
          end_date?: string
          id?: string
          kind?: Database["public"]["Enums"]["leave_kind"]
          notes?: string | null
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_leaves_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_vacation_balances: {
        Row: {
          bonus_days: number
          carryover_days: number
          created_at: string
          created_by: string | null
          employee_id: string
          entitled_days: number
          expires_at: string
          granted_at: string
          id: string
          notes: string | null
          period_year: number
          status: string
          updated_at: string
          used_days: number
        }
        Insert: {
          bonus_days?: number
          carryover_days?: number
          created_at?: string
          created_by?: string | null
          employee_id: string
          entitled_days?: number
          expires_at: string
          granted_at: string
          id?: string
          notes?: string | null
          period_year: number
          status?: string
          updated_at?: string
          used_days?: number
        }
        Update: {
          bonus_days?: number
          carryover_days?: number
          created_at?: string
          created_by?: string | null
          employee_id?: string
          entitled_days?: number
          expires_at?: string
          granted_at?: string
          id?: string
          notes?: string | null
          period_year?: number
          status?: string
          updated_at?: string
          used_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_vacation_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          base_salary: number | null
          cbu: string | null
          created_at: string
          created_by: string | null
          cuil: string | null
          hire_date: string
          id: string
          is_active: boolean
          is_monotributo: boolean
          legal_name: string
          notes: string | null
          pay_frequency: string
          position: string | null
          termination_date: string | null
          updated_at: string
          viatico_monthly: number
        }
        Insert: {
          base_salary?: number | null
          cbu?: string | null
          created_at?: string
          created_by?: string | null
          cuil?: string | null
          hire_date: string
          id?: string
          is_active?: boolean
          is_monotributo?: boolean
          legal_name: string
          notes?: string | null
          pay_frequency: string
          position?: string | null
          termination_date?: string | null
          updated_at?: string
          viatico_monthly?: number
        }
        Update: {
          base_salary?: number | null
          cbu?: string | null
          created_at?: string
          created_by?: string | null
          cuil?: string | null
          hire_date?: string
          id?: string
          is_active?: boolean
          is_monotributo?: boolean
          legal_name?: string
          notes?: string | null
          pay_frequency?: string
          position?: string | null
          termination_date?: string | null
          updated_at?: string
          viatico_monthly?: number
        }
        Relationships: []
      }
      exchange_rates: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          id: string
          notes: string | null
          rate: number
          rate_date: string
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          notes?: string | null
          rate: number
          rate_date: string
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          notes?: string | null
          rate?: number
          rate_date?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      file_attachments: {
        Row: {
          ai_chat_message_id: string | null
          check_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          file_id: string
          id: string
          invoice_id: string | null
          issued_check_id: string | null
          kind: string
          payment_order_id: string | null
          purchase_invoice_id: string | null
          receipt_id: string | null
          supplier_id: string | null
          transaction_id: string | null
        }
        Insert: {
          ai_chat_message_id?: string | null
          check_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          file_id: string
          id?: string
          invoice_id?: string | null
          issued_check_id?: string | null
          kind: string
          payment_order_id?: string | null
          purchase_invoice_id?: string | null
          receipt_id?: string | null
          supplier_id?: string | null
          transaction_id?: string | null
        }
        Update: {
          ai_chat_message_id?: string | null
          check_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          file_id?: string
          id?: string
          invoice_id?: string | null
          issued_check_id?: string | null
          kind?: string
          payment_order_id?: string | null
          purchase_invoice_id?: string | null
          receipt_id?: string | null
          supplier_id?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "file_attachments_ai_chat_message_id_fkey"
            columns: ["ai_chat_message_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_attachments_check_id_fkey"
            columns: ["check_id"]
            isOneToOne: false
            referencedRelation: "checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_attachments_check_id_fkey"
            columns: ["check_id"]
            isOneToOne: false
            referencedRelation: "v_rejected_check_open"
            referencedColumns: ["check_id"]
          },
          {
            foreignKeyName: "file_attachments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_attachments_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_attachments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_attachments_issued_check_id_fkey"
            columns: ["issued_check_id"]
            isOneToOne: false
            referencedRelation: "issued_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_attachments_payment_order_id_fkey"
            columns: ["payment_order_id"]
            isOneToOne: false
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_attachments_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_attachments_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_invoice_open"
            referencedColumns: ["purchase_invoice_id"]
          },
          {
            foreignKeyName: "file_attachments_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_aging_documents"
            referencedColumns: ["purchase_invoice_id"]
          },
          {
            foreignKeyName: "file_attachments_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_attachments_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "v_rejected_check_open"
            referencedColumns: ["source_receipt_id"]
          },
          {
            foreignKeyName: "file_attachments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_attachments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transactions_tagged"
            referencedColumns: ["id"]
          },
        ]
      }
      files: {
        Row: {
          bucket: string
          bucket_path: string
          created_at: string
          file_size: number | null
          id: string
          metadata: Json
          mime_type: string | null
          original_filename: string
          quick_ocr: string | null
          source: string
          uploaded_by: string | null
        }
        Insert: {
          bucket?: string
          bucket_path: string
          created_at?: string
          file_size?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          original_filename: string
          quick_ocr?: string | null
          source: string
          uploaded_by?: string | null
        }
        Update: {
          bucket?: string
          bucket_path?: string
          created_at?: string
          file_size?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          original_filename?: string
          quick_ocr?: string | null
          source?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      fleet_documents: {
        Row: {
          attachment_file_id: string | null
          created_at: string
          created_by: string | null
          driver_id: string | null
          expires_at: string
          id: string
          issued_at: string | null
          kind: string
          notes: string | null
          notified_at: string | null
          number: string | null
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          attachment_file_id?: string | null
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          expires_at: string
          id?: string
          issued_at?: string | null
          kind: string
          notes?: string | null
          notified_at?: string | null
          number?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          attachment_file_id?: string | null
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          expires_at?: string
          id?: string
          issued_at?: string | null
          kind?: string
          notes?: string | null
          notified_at?: string | null
          number?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fleet_documents_attachment_file_id_fkey"
            columns: ["attachment_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_documents_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_documents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      fuel_loads: {
        Row: {
          amount: number
          card: string | null
          created_at: string
          created_by: string | null
          id: string
          liters: number
          load_date: string
          notes: string | null
          odometer_km: number | null
          purchase_invoice_id: string | null
          station: string | null
          transaction_id: string | null
          trip_id: string | null
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          amount: number
          card?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          liters: number
          load_date: string
          notes?: string | null
          odometer_km?: number | null
          purchase_invoice_id?: string | null
          station?: string | null
          transaction_id?: string | null
          trip_id?: string | null
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          amount?: number
          card?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          liters?: number
          load_date?: string
          notes?: string | null
          odometer_km?: number | null
          purchase_invoice_id?: string | null
          station?: string | null
          transaction_id?: string | null
          trip_id?: string | null
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fuel_loads_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_loads_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_invoice_open"
            referencedColumns: ["purchase_invoice_id"]
          },
          {
            foreignKeyName: "fuel_loads_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_aging_documents"
            referencedColumns: ["purchase_invoice_id"]
          },
          {
            foreignKeyName: "fuel_loads_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_loads_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transactions_tagged"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_loads_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_loads_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "v_trip_revenue"
            referencedColumns: ["trip_id"]
          },
          {
            foreignKeyName: "fuel_loads_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          name: string
          notes: string | null
          scope: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date: string
          name: string
          notes?: string | null
          scope?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          name?: string
          notes?: string | null
          scope?: string
        }
        Relationships: []
      }
      hr_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      inflation_adjustments: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          coefficient: number
          created_at: string
          id: string
          index_source: string | null
          journal_entry_id: string | null
          notes: string | null
          period: string
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          coefficient: number
          created_at?: string
          id?: string
          index_source?: string | null
          journal_entry_id?: string | null
          notes?: string | null
          period: string
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          coefficient?: number
          created_at?: string
          id?: string
          index_source?: string | null
          journal_entry_id?: string | null
          notes?: string | null
          period?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inflation_adjustments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          iva_rate_id: number | null
          line_iva: number
          line_neto: number
          line_total: number
          quantity: number
          sort_order: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          iva_rate_id?: number | null
          line_iva?: number
          line_neto: number
          line_total: number
          quantity: number
          sort_order?: number
          unit_price: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          iva_rate_id?: number | null
          line_iva?: number
          line_neto?: number
          line_total?: number
          quantity?: number
          sort_order?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          afip_attempted_numero: number | null
          afip_observaciones: Json | null
          cae: string | null
          cae_vencimiento: string | null
          caea_informed_at: string | null
          cbte_fch_hs_gen: string | null
          cbte_tipo_afip: number | null
          cbte_tipo_origen_afip: number | null
          channel_id: string
          client_id: string
          concepto: number
          cost_center_id: string | null
          cotizacion: number
          created_at: string
          created_by: string | null
          doc_nro: string
          doc_tipo: number
          emission_type: string
          emitted_at: string | null
          fch_serv_desde: string | null
          fch_serv_hasta: string | null
          fch_vto_pago: string | null
          fecha: string
          id: string
          idempotency_key: string
          imp_iva: number
          imp_neto: number
          imp_op_ex: number
          imp_tot_conc: number
          imp_total: number
          imp_trib: number
          invoice_origin_id: string | null
          iva_condition_receptor: number | null
          kind: string
          letter: string | null
          moneda: string
          motivo_nc_nd: string | null
          notified_at: string | null
          numero: number | null
          pdf_hash: string | null
          punto_venta: number
          status: string
          updated_at: string
        }
        Insert: {
          afip_attempted_numero?: number | null
          afip_observaciones?: Json | null
          cae?: string | null
          cae_vencimiento?: string | null
          caea_informed_at?: string | null
          cbte_fch_hs_gen?: string | null
          cbte_tipo_afip?: number | null
          cbte_tipo_origen_afip?: number | null
          channel_id: string
          client_id: string
          concepto: number
          cost_center_id?: string | null
          cotizacion?: number
          created_at?: string
          created_by?: string | null
          doc_nro: string
          doc_tipo: number
          emission_type?: string
          emitted_at?: string | null
          fch_serv_desde?: string | null
          fch_serv_hasta?: string | null
          fch_vto_pago?: string | null
          fecha: string
          id?: string
          idempotency_key: string
          imp_iva?: number
          imp_neto?: number
          imp_op_ex?: number
          imp_tot_conc?: number
          imp_total: number
          imp_trib?: number
          invoice_origin_id?: string | null
          iva_condition_receptor?: number | null
          kind: string
          letter?: string | null
          moneda?: string
          motivo_nc_nd?: string | null
          notified_at?: string | null
          numero?: number | null
          pdf_hash?: string | null
          punto_venta: number
          status?: string
          updated_at?: string
        }
        Update: {
          afip_attempted_numero?: number | null
          afip_observaciones?: Json | null
          cae?: string | null
          cae_vencimiento?: string | null
          caea_informed_at?: string | null
          cbte_fch_hs_gen?: string | null
          cbte_tipo_afip?: number | null
          cbte_tipo_origen_afip?: number | null
          channel_id?: string
          client_id?: string
          concepto?: number
          cost_center_id?: string | null
          cotizacion?: number
          created_at?: string
          created_by?: string | null
          doc_nro?: string
          doc_tipo?: number
          emission_type?: string
          emitted_at?: string | null
          fch_serv_desde?: string | null
          fch_serv_hasta?: string | null
          fch_vto_pago?: string | null
          fecha?: string
          id?: string
          idempotency_key?: string
          imp_iva?: number
          imp_neto?: number
          imp_op_ex?: number
          imp_tot_conc?: number
          imp_total?: number
          imp_trib?: number
          invoice_origin_id?: string | null
          iva_condition_receptor?: number | null
          kind?: string
          letter?: string | null
          moneda?: string
          motivo_nc_nd?: string | null
          notified_at?: string | null
          numero?: number | null
          pdf_hash?: string | null
          punto_venta?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_invoice_origin_id_fkey"
            columns: ["invoice_origin_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoicing_channels: {
        Row: {
          business_unit_id: string
          created_at: string
          display_color: string | null
          id: string
          is_active: boolean
          is_fiscal: boolean
          name: string
          updated_at: string
        }
        Insert: {
          business_unit_id: string
          created_at?: string
          display_color?: string | null
          id: string
          is_active?: boolean
          is_fiscal: boolean
          name: string
          updated_at?: string
        }
        Update: {
          business_unit_id?: string
          created_at?: string
          display_color?: string | null
          id?: string
          is_active?: boolean
          is_fiscal?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoicing_channels_business_unit_id_fkey"
            columns: ["business_unit_id"]
            isOneToOne: false
            referencedRelation: "business_units"
            referencedColumns: ["id"]
          },
        ]
      }
      issued_checks: {
        Row: {
          amount: number
          bank_account_id: string
          bank_name: string
          beneficiary_cuit: string | null
          beneficiary_name: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          cashed_at: string | null
          channel_id: string | null
          check_number: string
          created_at: string
          created_by: string | null
          currency: string
          due_date: string
          id: string
          issue_date: string
          kind: string
          notes: string | null
          payment_order_id: string | null
          rejected_at: string | null
          status: string
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          bank_account_id: string
          bank_name: string
          beneficiary_cuit?: string | null
          beneficiary_name?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cashed_at?: string | null
          channel_id?: string | null
          check_number: string
          created_at?: string
          created_by?: string | null
          currency: string
          due_date: string
          id?: string
          issue_date: string
          kind: string
          notes?: string | null
          payment_order_id?: string | null
          rejected_at?: string | null
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          bank_account_id?: string
          bank_name?: string
          beneficiary_cuit?: string | null
          beneficiary_name?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          cashed_at?: string | null
          channel_id?: string | null
          check_number?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          due_date?: string
          id?: string
          issue_date?: string
          kind?: string
          notes?: string | null
          payment_order_id?: string | null
          rejected_at?: string | null
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "issued_checks_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issued_checks_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issued_checks_payment_order_id_fkey"
            columns: ["payment_order_id"]
            isOneToOne: false
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issued_checks_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          accrual_period: string
          channel_id: string | null
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          description: string
          entry_date: string
          id: string
          is_reversal: boolean
          reversed_entry_id: string | null
          source_id: string | null
          source_table: string | null
        }
        Insert: {
          accrual_period: string
          channel_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          entry_date: string
          id?: string
          is_reversal?: boolean
          reversed_entry_id?: string | null
          source_id?: string | null
          source_table?: string | null
        }
        Update: {
          accrual_period?: string
          channel_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          entry_date?: string
          id?: string
          is_reversal?: boolean
          reversed_entry_id?: string | null
          source_id?: string | null
          source_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_reversed_entry_id_fkey"
            columns: ["reversed_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entry_lines: {
        Row: {
          chart_of_accounts_id: string
          credit: number
          debit: number
          description: string | null
          id: string
          journal_entry_id: string
          sort_order: number
        }
        Insert: {
          chart_of_accounts_id: string
          credit?: number
          debit?: number
          description?: string | null
          id?: string
          journal_entry_id: string
          sort_order?: number
        }
        Update: {
          chart_of_accounts_id?: string
          credit?: number
          debit?: number
          description?: string | null
          id?: string
          journal_entry_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_lines_chart_of_accounts_id_fkey"
            columns: ["chart_of_accounts_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_chart_of_accounts_id_fkey"
            columns: ["chart_of_accounts_id"]
            isOneToOne: false
            referencedRelation: "expense_leaf_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_installments: {
        Row: {
          amount: number
          created_at: string
          due_date: string
          id: string
          loan_id: string
          notes: string | null
          number: number
          paid_amount: number | null
          paid_date: string | null
          status: Database["public"]["Enums"]["loan_installment_status"]
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          due_date: string
          id?: string
          loan_id: string
          notes?: string | null
          number: number
          paid_amount?: number | null
          paid_date?: string | null
          status?: Database["public"]["Enums"]["loan_installment_status"]
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          due_date?: string
          id?: string
          loan_id?: string
          notes?: string | null
          number?: number
          paid_amount?: number | null
          paid_date?: string | null
          status?: Database["public"]["Enums"]["loan_installment_status"]
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_installments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_installments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_installments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transactions_tagged"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          channel_id: string
          created_at: string
          created_by: string | null
          currency: string
          description: string
          first_due_date: string
          id: string
          installments_count: number
          kind: Database["public"]["Enums"]["loan_kind"]
          lender: string | null
          notes: string | null
          principal: number
          status: Database["public"]["Enums"]["loan_status"]
          updated_at: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description: string
          first_due_date: string
          id?: string
          installments_count: number
          kind?: Database["public"]["Enums"]["loan_kind"]
          lender?: string | null
          notes?: string | null
          principal: number
          status?: Database["public"]["Enums"]["loan_status"]
          updated_at?: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string
          first_due_date?: string
          id?: string
          installments_count?: number
          kind?: Database["public"]["Enums"]["loan_kind"]
          lender?: string | null
          notes?: string | null
          principal?: number
          status?: Database["public"]["Enums"]["loan_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loans_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_records: {
        Row: {
          cost: number | null
          created_at: string
          created_by: string | null
          description: string
          id: string
          kind: string
          next_service_date: string | null
          next_service_km: number | null
          notes: string | null
          odometer_km: number | null
          provider: string | null
          purchase_invoice_id: string | null
          service_date: string
          transaction_id: string | null
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          cost?: number | null
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          kind: string
          next_service_date?: string | null
          next_service_km?: number | null
          notes?: string | null
          odometer_km?: number | null
          provider?: string | null
          purchase_invoice_id?: string | null
          service_date: string
          transaction_id?: string | null
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          cost?: number | null
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          kind?: string
          next_service_date?: string | null
          next_service_km?: number | null
          notes?: string | null
          odometer_km?: number | null
          provider?: string | null
          purchase_invoice_id?: string | null
          service_date?: string
          transaction_id?: string | null
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_records_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_records_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_invoice_open"
            referencedColumns: ["purchase_invoice_id"]
          },
          {
            foreignKeyName: "maintenance_records_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_aging_documents"
            referencedColumns: ["purchase_invoice_id"]
          },
          {
            foreignKeyName: "maintenance_records_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_records_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transactions_tagged"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_records_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          enabled: boolean
          notification_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          enabled?: boolean
          notification_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          enabled?: boolean
          notification_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          read_at: string | null
          recipient_id: string
          sender_id: string | null
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          read_at?: string | null
          recipient_id: string
          sender_id?: string | null
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          read_at?: string | null
          recipient_id?: string
          sender_id?: string | null
          type?: string
        }
        Relationships: []
      }
      padron_cache: {
        Row: {
          cached_at: string
          cuit: string
          data: Json
        }
        Insert: {
          cached_at?: string
          cuit: string
          data: Json
        }
        Update: {
          cached_at?: string
          cuit?: string
          data?: Json
        }
        Relationships: []
      }
      pallets: {
        Row: {
          client_id: string
          code: string
          created_at: string
          created_by: string | null
          entry_date: string
          exit_date: string | null
          id: string
          notes: string | null
          product_id: string | null
          quantity: number | null
          status: string
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          client_id: string
          code: string
          created_at?: string
          created_by?: string | null
          entry_date: string
          exit_date?: string | null
          id?: string
          notes?: string | null
          product_id?: string | null
          quantity?: number | null
          status?: string
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          client_id?: string
          code?: string
          created_at?: string
          created_by?: string | null
          entry_date?: string
          exit_date?: string | null
          id?: string
          notes?: string | null
          product_id?: string | null
          quantity?: number | null
          status?: string
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pallets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pallets_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pallets_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_order_allocations: {
        Row: {
          amount_applied: number
          created_at: string
          id: string
          payment_order_id: string
          purchase_invoice_id: string
          updated_at: string
        }
        Insert: {
          amount_applied: number
          created_at?: string
          id?: string
          payment_order_id: string
          purchase_invoice_id: string
          updated_at?: string
        }
        Update: {
          amount_applied?: number
          created_at?: string
          id?: string
          payment_order_id?: string
          purchase_invoice_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_order_allocations_payment_order_id_fkey"
            columns: ["payment_order_id"]
            isOneToOne: false
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_order_allocations_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_order_allocations_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_invoice_open"
            referencedColumns: ["purchase_invoice_id"]
          },
          {
            foreignKeyName: "payment_order_allocations_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_aging_documents"
            referencedColumns: ["purchase_invoice_id"]
          },
        ]
      }
      payment_order_payment_lines: {
        Row: {
          account_id: string
          amount: number
          created_at: string
          endorsed_check_id: string | null
          id: string
          issued_check_id: string | null
          payment_order_id: string
          reference: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          amount: number
          created_at?: string
          endorsed_check_id?: string | null
          id?: string
          issued_check_id?: string | null
          payment_order_id: string
          reference?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount?: number
          created_at?: string
          endorsed_check_id?: string | null
          id?: string
          issued_check_id?: string | null
          payment_order_id?: string
          reference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_order_payment_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_order_payment_lines_endorsed_check_id_fkey"
            columns: ["endorsed_check_id"]
            isOneToOne: false
            referencedRelation: "checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_order_payment_lines_endorsed_check_id_fkey"
            columns: ["endorsed_check_id"]
            isOneToOne: false
            referencedRelation: "v_rejected_check_open"
            referencedColumns: ["check_id"]
          },
          {
            foreignKeyName: "payment_order_payment_lines_issued_check_id_fkey"
            columns: ["issued_check_id"]
            isOneToOne: false
            referencedRelation: "issued_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_order_payment_lines_payment_order_id_fkey"
            columns: ["payment_order_id"]
            isOneToOne: false
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_orders: {
        Row: {
          canceled_at: string | null
          canceled_by: string | null
          channel_id: string
          cost_center_id: string | null
          cotizacion: number | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          notes: string | null
          numero: number
          payment_date: string
          punto_venta: number
          status: string
          supplier_id: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          canceled_at?: string | null
          canceled_by?: string | null
          channel_id: string
          cost_center_id?: string | null
          cotizacion?: number | null
          created_at?: string
          created_by?: string | null
          currency: string
          id?: string
          notes?: string | null
          numero: number
          payment_date: string
          punto_venta: number
          status?: string
          supplier_id: string
          total_amount: number
          updated_at?: string
        }
        Update: {
          canceled_at?: string | null
          canceled_by?: string | null
          channel_id?: string
          cost_center_id?: string | null
          cotizacion?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          notes?: string | null
          numero?: number
          payment_date?: string
          punto_venta?: number
          status?: string
          supplier_id?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_orders_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_orders_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_entries: {
        Row: {
          created_at: string
          created_by: string | null
          deudas: number
          employee_id: string
          id: string
          notes: string | null
          period_id: string
          sueldo_neto: number
          telefono: number
          updated_at: string
          vacaciones_monto: number
          viaticos: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deudas?: number
          employee_id: string
          id?: string
          notes?: string | null
          period_id: string
          sueldo_neto?: number
          telefono?: number
          updated_at?: string
          vacaciones_monto?: number
          viaticos?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deudas?: number
          employee_id?: string
          id?: string
          notes?: string | null
          period_id?: string
          sueldo_neto?: number
          telefono?: number
          updated_at?: string
          vacaciones_monto?: number
          viaticos?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_entry_extras: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          description: string
          entry_id: string
          id: string
          sort_order: number
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          description: string
          entry_id: string
          id?: string
          sort_order?: number
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string
          entry_id?: string
          id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_entry_extras_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "payroll_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entry_extras_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "v_payroll_entries_resolved"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entry_extras_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "v_payroll_entries_with_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_payments: {
        Row: {
          account_id: string
          amount: number
          channel_id: string
          created_at: string
          created_by: string | null
          entry_id: string
          id: string
          method: Database["public"]["Enums"]["payroll_payment_method"]
          notes: string | null
          paid_at: string
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          amount: number
          channel_id: string
          created_at?: string
          created_by?: string | null
          entry_id: string
          id?: string
          method: Database["public"]["Enums"]["payroll_payment_method"]
          notes?: string | null
          paid_at: string
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount?: number
          channel_id?: string
          created_at?: string
          created_by?: string | null
          entry_id?: string
          id?: string
          method?: Database["public"]["Enums"]["payroll_payment_method"]
          notes?: string | null
          paid_at?: string
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payments_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "payroll_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "v_payroll_entries_resolved"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "v_payroll_entries_with_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payments_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "v_transactions_tagged"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          id: string
          month: number
          notes: string | null
          status: string
          updated_at: string
          year: number
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          month: number
          notes?: string | null
          status?: string
          updated_at?: string
          year: number
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          month?: number
          notes?: string | null
          status?: string
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      products: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          sku: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          sku?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          sku?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_invoice_items: {
        Row: {
          created_at: string
          description: string
          id: string
          iva_rate_id: number | null
          line_iva: number
          line_neto: number
          line_total: number
          purchase_invoice_id: string
          quantity: number
          sort_order: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          iva_rate_id?: number | null
          line_iva?: number
          line_neto: number
          line_total: number
          purchase_invoice_id: string
          quantity: number
          sort_order?: number
          unit_price: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          iva_rate_id?: number | null
          line_iva?: number
          line_neto?: number
          line_total?: number
          purchase_invoice_id?: string
          quantity?: number
          sort_order?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoice_items_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoice_items_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_invoice_open"
            referencedColumns: ["purchase_invoice_id"]
          },
          {
            foreignKeyName: "purchase_invoice_items_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_aging_documents"
            referencedColumns: ["purchase_invoice_id"]
          },
        ]
      }
      purchase_invoices: {
        Row: {
          account_id: string | null
          cae_proveedor: string | null
          cae_vto_proveedor: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          channel_id: string
          cost_center_id: string | null
          cotizacion: number
          created_at: string
          created_by: string | null
          fch_vto_pago: string | null
          fecha: string
          id: string
          imp_iva: number
          imp_neto: number
          imp_total: number
          imp_trib: number
          invoice_origin_id: string | null
          kind: string
          letter: string | null
          moneda: string
          motivo_nc_nd: string | null
          notes: string | null
          numero: number
          punto_venta: number
          status: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          cae_proveedor?: string | null
          cae_vto_proveedor?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          channel_id: string
          cost_center_id?: string | null
          cotizacion?: number
          created_at?: string
          created_by?: string | null
          fch_vto_pago?: string | null
          fecha: string
          id?: string
          imp_iva?: number
          imp_neto?: number
          imp_total: number
          imp_trib?: number
          invoice_origin_id?: string | null
          kind: string
          letter?: string | null
          moneda?: string
          motivo_nc_nd?: string | null
          notes?: string | null
          numero: number
          punto_venta: number
          status?: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          cae_proveedor?: string | null
          cae_vto_proveedor?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          channel_id?: string
          cost_center_id?: string | null
          cotizacion?: number
          created_at?: string
          created_by?: string | null
          fch_vto_pago?: string | null
          fecha?: string
          id?: string
          imp_iva?: number
          imp_neto?: number
          imp_total?: number
          imp_trib?: number
          invoice_origin_id?: string | null
          kind?: string
          letter?: string | null
          moneda?: string
          motivo_nc_nd?: string | null
          notes?: string | null
          numero?: number
          punto_venta?: number
          status?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoices_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "expense_leaf_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_invoice_origin_id_fkey"
            columns: ["invoice_origin_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_invoice_origin_id_fkey"
            columns: ["invoice_origin_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_invoice_open"
            referencedColumns: ["purchase_invoice_id"]
          },
          {
            foreignKeyName: "purchase_invoices_invoice_origin_id_fkey"
            columns: ["invoice_origin_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_aging_documents"
            referencedColumns: ["purchase_invoice_id"]
          },
          {
            foreignKeyName: "purchase_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      rate_limit_buckets: {
        Row: {
          bucket_key: string
          count: number
          user_id: string
          window_start: string
        }
        Insert: {
          bucket_key: string
          count?: number
          user_id: string
          window_start: string
        }
        Update: {
          bucket_key?: string
          count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      receipt_allocations: {
        Row: {
          amount_applied: number
          created_at: string
          id: string
          invoice_id: string
          receipt_id: string
          updated_at: string
        }
        Insert: {
          amount_applied: number
          created_at?: string
          id?: string
          invoice_id: string
          receipt_id: string
          updated_at?: string
        }
        Update: {
          amount_applied?: number
          created_at?: string
          id?: string
          invoice_id?: string
          receipt_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_allocations_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_allocations_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "v_rejected_check_open"
            referencedColumns: ["source_receipt_id"]
          },
        ]
      }
      receipt_payment_lines: {
        Row: {
          account_id: string
          amount: number
          created_at: string
          id: string
          receipt_id: string
          reference: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          amount: number
          created_at?: string
          id?: string
          receipt_id: string
          reference?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount?: number
          created_at?: string
          id?: string
          receipt_id?: string
          reference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_payment_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_payment_lines_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_payment_lines_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "v_rejected_check_open"
            referencedColumns: ["source_receipt_id"]
          },
        ]
      }
      receipt_rejected_check_allocations: {
        Row: {
          amount_applied: number
          check_id: string
          created_at: string
          id: string
          receipt_id: string
          updated_at: string
        }
        Insert: {
          amount_applied: number
          check_id: string
          created_at?: string
          id?: string
          receipt_id: string
          updated_at?: string
        }
        Update: {
          amount_applied?: number
          check_id?: string
          created_at?: string
          id?: string
          receipt_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_rejected_check_allocations_check_id_fkey"
            columns: ["check_id"]
            isOneToOne: false
            referencedRelation: "checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_rejected_check_allocations_check_id_fkey"
            columns: ["check_id"]
            isOneToOne: false
            referencedRelation: "v_rejected_check_open"
            referencedColumns: ["check_id"]
          },
          {
            foreignKeyName: "receipt_rejected_check_allocations_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_rejected_check_allocations_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "v_rejected_check_open"
            referencedColumns: ["source_receipt_id"]
          },
        ]
      }
      receipt_retentions: {
        Row: {
          amount: number
          certificate_date: string
          certificate_number: string
          created_at: string
          id: string
          jurisdiction: string | null
          kind: string
          notes: string | null
          receipt_id: string
          tax_type: string
          updated_at: string
        }
        Insert: {
          amount: number
          certificate_date: string
          certificate_number: string
          created_at?: string
          id?: string
          jurisdiction?: string | null
          kind: string
          notes?: string | null
          receipt_id: string
          tax_type: string
          updated_at?: string
        }
        Update: {
          amount?: number
          certificate_date?: string
          certificate_number?: string
          created_at?: string
          id?: string
          jurisdiction?: string | null
          kind?: string
          notes?: string | null
          receipt_id?: string
          tax_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_retentions_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_retentions_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "v_rejected_check_open"
            referencedColumns: ["source_receipt_id"]
          },
        ]
      }
      receipts: {
        Row: {
          canceled_at: string | null
          canceled_by: string | null
          channel_id: string
          client_id: string
          cost_center_id: string | null
          cotizacion: number | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          notes: string | null
          notified_at: string | null
          numero: number
          punto_venta: number
          receipt_date: string
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          canceled_at?: string | null
          canceled_by?: string | null
          channel_id: string
          client_id: string
          cost_center_id?: string | null
          cotizacion?: number | null
          created_at?: string
          created_by?: string | null
          currency: string
          id?: string
          notes?: string | null
          notified_at?: string | null
          numero: number
          punto_venta: number
          receipt_date: string
          status?: string
          total_amount: number
          updated_at?: string
        }
        Update: {
          canceled_at?: string | null
          canceled_by?: string | null
          channel_id?: string
          client_id?: string
          cost_center_id?: string | null
          cotizacion?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          notes?: string | null
          notified_at?: string | null
          numero?: number
          punto_venta?: number
          receipt_date?: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_payments: {
        Row: {
          account_id: string | null
          amount: number
          category: string
          channel_id: string | null
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string
          end_date: string | null
          frequency: string
          id: string
          is_active: boolean
          next_due_date: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          category: string
          channel_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description: string
          end_date?: string | null
          frequency: string
          id?: string
          is_active?: boolean
          next_due_date: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          category?: string
          channel_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string
          end_date?: string | null
          frequency?: string
          id?: string
          is_active?: boolean
          next_due_date?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_payments_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_payments_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          display_name: string
          id: string
          rank: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_name: string
          id: string
          rank: number
        }
        Update: {
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          rank?: number
        }
        Relationships: []
      }
      sales_points: {
        Row: {
          channel_id: string | null
          created_at: string
          is_enabled: boolean
          last_known_blocked: boolean
          last_known_emission_type: string | null
          last_synced_at: string | null
          nickname: string | null
          numero: number
          updated_at: string
        }
        Insert: {
          channel_id?: string | null
          created_at?: string
          is_enabled?: boolean
          last_known_blocked?: boolean
          last_known_emission_type?: string | null
          last_synced_at?: string | null
          nickname?: string | null
          numero: number
          updated_at?: string
        }
        Update: {
          channel_id?: string | null
          created_at?: string
          is_enabled?: boolean
          last_known_blocked?: boolean
          last_known_emission_type?: string | null
          last_synced_at?: string | null
          nickname?: string | null
          numero?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_points_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      search_index_state: {
        Row: {
          dirty: boolean
          id: number
          last_refreshed: string
        }
        Insert: {
          dirty?: boolean
          id?: number
          last_refreshed?: string
        }
        Update: {
          dirty?: boolean
          id?: number
          last_refreshed?: string
        }
        Relationships: []
      }
      shipment_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          comment: string | null
          id: string
          new_status: string
          old_status: string | null
          shipment_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          comment?: string | null
          id?: string
          new_status: string
          old_status?: string | null
          shipment_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          comment?: string | null
          id?: string
          new_status?: string
          old_status?: string | null
          shipment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_status_history_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          channel_id: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          delivery_date: string | null
          description: string | null
          destination: string | null
          failure_reason: string | null
          freight_amount: number | null
          id: string
          invoice_id: string | null
          invoicing_claimed_at: string | null
          notes: string | null
          origin: string | null
          scheduled_date: string | null
          status: string
          trip_id: string | null
          updated_at: string
        }
        Insert: {
          channel_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          description?: string | null
          destination?: string | null
          failure_reason?: string | null
          freight_amount?: number | null
          id?: string
          invoice_id?: string | null
          invoicing_claimed_at?: string | null
          notes?: string | null
          origin?: string | null
          scheduled_date?: string | null
          status?: string
          trip_id?: string | null
          updated_at?: string
        }
        Update: {
          channel_id?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          delivery_date?: string | null
          description?: string | null
          destination?: string | null
          failure_reason?: string | null
          freight_amount?: number | null
          id?: string
          invoice_id?: string | null
          invoicing_claimed_at?: string | null
          notes?: string | null
          origin?: string | null
          scheduled_date?: string | null
          status?: string
          trip_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipments_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "v_trip_revenue"
            referencedColumns: ["trip_id"]
          },
        ]
      }
      storage_billing_runs: {
        Row: {
          applied_tariffs: Json
          channel_id: string | null
          client_id: string
          created_at: string
          created_by: string | null
          handling_in_total: number
          handling_out_total: number
          id: string
          invoice_id: string | null
          pending_since: string | null
          period_end: string
          period_start: string
          storage_total: number
          total: number
        }
        Insert: {
          applied_tariffs?: Json
          channel_id?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          handling_in_total?: number
          handling_out_total?: number
          id?: string
          invoice_id?: string | null
          pending_since?: string | null
          period_end: string
          period_start: string
          storage_total?: number
          total?: number
        }
        Update: {
          applied_tariffs?: Json
          channel_id?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          handling_in_total?: number
          handling_out_total?: number
          id?: string
          invoice_id?: string | null
          pending_since?: string | null
          period_end?: string
          period_start?: string
          storage_total?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "storage_billing_runs_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_billing_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_billing_runs_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_tariffs: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          handling_in: number
          handling_out: number
          id: string
          is_active: boolean
          notes: string | null
          period: string
          rate_per_pallet: number
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          handling_in?: number
          handling_out?: number
          id?: string
          is_active?: boolean
          notes?: string | null
          period?: string
          rate_per_pallet: number
          updated_at?: string
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          handling_in?: number
          handling_out?: number
          id?: string
          is_active?: boolean
          notes?: string | null
          period?: string
          rate_per_pallet?: number
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "storage_tariffs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      supplier_opening_balance_allocations: {
        Row: {
          amount_applied: number
          created_at: string
          purchase_invoice_id: string
          supplier_id: string
        }
        Insert: {
          amount_applied: number
          created_at?: string
          purchase_invoice_id: string
          supplier_id: string
        }
        Update: {
          amount_applied?: number
          created_at?: string
          purchase_invoice_id?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_opening_balance_allocations_header_fk"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier_opening_balances"
            referencedColumns: ["supplier_id"]
          },
          {
            foreignKeyName: "supplier_opening_balance_allocations_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: true
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_opening_balance_allocations_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: true
            referencedRelation: "v_purchase_invoice_open"
            referencedColumns: ["purchase_invoice_id"]
          },
          {
            foreignKeyName: "supplier_opening_balance_allocations_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: true
            referencedRelation: "v_supplier_aging_documents"
            referencedColumns: ["purchase_invoice_id"]
          },
        ]
      }
      supplier_opening_balances: {
        Row: {
          created_at: string
          created_by: string | null
          notes: string | null
          opening_date: string
          supplier_id: string
          target_balance: number
          total_settled: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          notes?: string | null
          opening_date: string
          supplier_id: string
          target_balance: number
          total_settled: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          notes?: string | null
          opening_date?: string
          supplier_id?: string
          target_balance?: number
          total_settled?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_opening_balances_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: true
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          category_id: string | null
          created_at: string
          created_by: string | null
          cuit: string
          default_channel_id: string | null
          default_payment_term_days: number | null
          display_name: string | null
          email: string | null
          id: string
          is_active: boolean
          iva_condition: string
          legal_name: string
          notes: string | null
          phone: string | null
          real_address: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          cuit: string
          default_channel_id?: string | null
          default_payment_term_days?: number | null
          display_name?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          iva_condition: string
          legal_name: string
          notes?: string | null
          phone?: string | null
          real_address?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          cuit?: string
          default_channel_id?: string | null
          default_payment_term_days?: number | null
          display_name?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          iva_condition?: string
          legal_name?: string
          notes?: string | null
          phone?: string | null
          real_address?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "supplier_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_default_channel_id_fkey"
            columns: ["default_channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string
          accrual_month: string
          amount: number
          channel_id: string
          cost_center_id: string | null
          counterparty_client_id: string | null
          counterparty_supplier_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          id: string
          invoice_id: string | null
          is_payroll: boolean
          issued_check_id: string | null
          kind: string
          payment_order_id: string | null
          receipt_id: string | null
          rejected_check_id: string | null
          transaction_date: string
          transfer_pair_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          accrual_month: string
          amount: number
          channel_id: string
          cost_center_id?: string | null
          counterparty_client_id?: string | null
          counterparty_supplier_id?: string | null
          created_at?: string
          created_by?: string | null
          currency: string
          description?: string | null
          id?: string
          invoice_id?: string | null
          is_payroll?: boolean
          issued_check_id?: string | null
          kind: string
          payment_order_id?: string | null
          receipt_id?: string | null
          rejected_check_id?: string | null
          transaction_date: string
          transfer_pair_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          accrual_month?: string
          amount?: number
          channel_id?: string
          cost_center_id?: string | null
          counterparty_client_id?: string | null
          counterparty_supplier_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          invoice_id?: string | null
          is_payroll?: boolean
          issued_check_id?: string | null
          kind?: string
          payment_order_id?: string | null
          receipt_id?: string | null
          rejected_check_id?: string | null
          transaction_date?: string
          transfer_pair_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_counterparty_client_id_fkey"
            columns: ["counterparty_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_counterparty_supplier_id_fkey"
            columns: ["counterparty_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_issued_check_id_fkey"
            columns: ["issued_check_id"]
            isOneToOne: false
            referencedRelation: "issued_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_payment_order_id_fkey"
            columns: ["payment_order_id"]
            isOneToOne: false
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "v_rejected_check_open"
            referencedColumns: ["source_receipt_id"]
          },
          {
            foreignKeyName: "transactions_rejected_check_id_fkey"
            columns: ["rejected_check_id"]
            isOneToOne: false
            referencedRelation: "checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_rejected_check_id_fkey"
            columns: ["rejected_check_id"]
            isOneToOne: false
            referencedRelation: "v_rejected_check_open"
            referencedColumns: ["check_id"]
          },
          {
            foreignKeyName: "transactions_transfer_pair_id_fkey"
            columns: ["transfer_pair_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_transfer_pair_id_fkey"
            columns: ["transfer_pair_id"]
            isOneToOne: false
            referencedRelation: "v_transactions_tagged"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          cargo_description: string | null
          channel_id: string | null
          cost: number | null
          created_at: string
          created_by: string | null
          destination: string | null
          driver_id: string | null
          id: string
          km: number | null
          notes: string | null
          origin: string | null
          revenue: number | null
          status: string
          trip_date: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          cargo_description?: string | null
          channel_id?: string | null
          cost?: number | null
          created_at?: string
          created_by?: string | null
          destination?: string | null
          driver_id?: string | null
          id?: string
          km?: number | null
          notes?: string | null
          origin?: string | null
          revenue?: number | null
          status?: string
          trip_date: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          cargo_description?: string | null
          channel_id?: string | null
          cost?: number | null
          created_at?: string
          created_by?: string | null
          destination?: string | null
          driver_id?: string | null
          id?: string
          km?: number | null
          notes?: string | null
          origin?: string | null
          revenue?: number | null
          status?: string
          trip_date?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trips_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permission_denies: {
        Row: {
          created_at: string
          created_by: string | null
          permission: string
          reason: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          permission: string
          reason?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          permission?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          avatar_color: string
          avatar_path: string | null
          created_at: string
          first_name: string | null
          last_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_color?: string
          avatar_path?: string | null
          created_at?: string
          first_name?: string | null
          last_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_color?: string
          avatar_path?: string | null
          created_at?: string
          first_name?: string | null
          last_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          role_id: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          role_id: string
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          alias: string | null
          brand: string | null
          capacity_kg: number | null
          created_at: string
          created_by: string | null
          fleet: string | null
          id: string
          is_active: boolean
          model: string | null
          notes: string | null
          patente: string
          updated_at: string
          vehicle_type: string
          year: number | null
        }
        Insert: {
          alias?: string | null
          brand?: string | null
          capacity_kg?: number | null
          created_at?: string
          created_by?: string | null
          fleet?: string | null
          id?: string
          is_active?: boolean
          model?: string | null
          notes?: string | null
          patente: string
          updated_at?: string
          vehicle_type: string
          year?: number | null
        }
        Update: {
          alias?: string | null
          brand?: string | null
          capacity_kg?: number | null
          created_at?: string
          created_by?: string | null
          fleet?: string | null
          id?: string
          is_active?: boolean
          model?: string | null
          notes?: string | null
          patente?: string
          updated_at?: string
          vehicle_type?: string
          year?: number | null
        }
        Relationships: []
      }
      warehouses: {
        Row: {
          address: string | null
          capacity_pallets: number | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          capacity_pallets?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          capacity_pallets?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      expense_leaf_accounts: {
        Row: {
          code: string | null
          id: string | null
          level: number | null
          name: string | null
        }
        Insert: {
          code?: string | null
          id?: string | null
          level?: number | null
          name?: string | null
        }
        Update: {
          code?: string | null
          id?: string | null
          level?: number | null
          name?: string | null
        }
        Relationships: []
      }
      search_index: {
        Row: {
          body: string | null
          channel_id: string | null
          entity_id: string | null
          entity_type: string | null
          subtitle: string | null
          title: string | null
          tsv: unknown
          url: string | null
        }
        Relationships: []
      }
      v_aging_documents: {
        Row: {
          amount_applied: number | null
          amount_credited_by_nc: number | null
          bucket: string | null
          channel_id: string | null
          channel_is_fiscal: boolean | null
          channel_name: string | null
          check_number: string | null
          client_id: string | null
          days_overdue: number | null
          document_id: string | null
          document_type: string | null
          fch_vto_pago: string | null
          fecha: string | null
          imp_total: number | null
          invoice_id: string | null
          kind: string | null
          letter: string | null
          moneda: string | null
          numero: number | null
          open_amount: number | null
          punto_venta: number | null
        }
        Relationships: []
      }
      v_attendance_records_resolved: {
        Row: {
          created_at: string | null
          date: string | null
          day_of_week: number | null
          employee_id: string | null
          employee_legal_name: string | null
          hours_lost: number | null
          id: string | null
          kind: Database["public"]["Enums"]["attendance_kind"] | null
          notes: string | null
          source: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      v_client_account_movements: {
        Row: {
          channel_id: string | null
          channel_is_fiscal: boolean | null
          channel_name: string | null
          client_id: string | null
          created_at: string | null
          currency: string | null
          gross_amount: number | null
          kind: string | null
          letter: string | null
          movement_date: string | null
          numero: number | null
          punto_venta: number | null
          signed_amount: number | null
          source_id: string | null
          source_type: string | null
          status: string | null
        }
        Relationships: []
      }
      v_client_aging: {
        Row: {
          ars_bucket_0_30: number | null
          ars_bucket_30_60: number | null
          ars_bucket_60_90: number | null
          ars_bucket_90_plus: number | null
          ars_rejected_checks_open: number | null
          ars_total_open: number | null
          client_id: string | null
          document_count: number | null
          oldest_days: number | null
          usd_bucket_0_30: number | null
          usd_bucket_30_60: number | null
          usd_bucket_60_90: number | null
          usd_bucket_90_plus: number | null
          usd_rejected_checks_open: number | null
          usd_total_open: number | null
          clients: {
            address: string | null
            created_at: string
            created_by: string | null
            cuit: string
            display_name: string | null
            email: string | null
            id: string
            is_active: boolean
            iva_condition: string
            legal_name: string
            notes: string | null
            phone: string | null
            real_address: string | null
            updated_at: string
          } | null
        }
        Relationships: []
      }
      v_client_aging_by_scope: {
        Row: {
          ars_bucket_0_30: number | null
          ars_bucket_30_60: number | null
          ars_bucket_60_90: number | null
          ars_bucket_90_plus: number | null
          ars_rejected_checks_open: number | null
          ars_total_open: number | null
          channel_is_fiscal: boolean | null
          client_id: string | null
          document_count: number | null
          oldest_days: number | null
          usd_bucket_0_30: number | null
          usd_bucket_30_60: number | null
          usd_bucket_60_90: number | null
          usd_bucket_90_plus: number | null
          usd_rejected_checks_open: number | null
          usd_total_open: number | null
          clients: {
            address: string | null
            created_at: string
            created_by: string | null
            cuit: string
            display_name: string | null
            email: string | null
            id: string
            is_active: boolean
            iva_condition: string
            legal_name: string
            notes: string | null
            phone: string | null
            real_address: string | null
            updated_at: string
          } | null
        }
        Relationships: []
      }
      v_documents_expiring: {
        Row: {
          days_until_expiry: number | null
          employee_id: string | null
          employee_is_active: boolean | null
          employee_name: string | null
          expires_at: string | null
          id: string | null
          kind: Database["public"]["Enums"]["employee_document_kind"] | null
          notified_at: string | null
          number: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      v_employee_vacation_balances: {
        Row: {
          bonus_days: number | null
          carryover_days: number | null
          created_at: string | null
          created_by: string | null
          employee_id: string | null
          entitled_days: number | null
          expires_at: string | null
          granted_at: string | null
          id: string | null
          notes: string | null
          period_year: number | null
          remaining_days: number | null
          status: string | null
          updated_at: string | null
          used_days: number | null
        }
        Insert: {
          bonus_days?: number | null
          carryover_days?: number | null
          created_at?: string | null
          created_by?: string | null
          employee_id?: string | null
          entitled_days?: number | null
          expires_at?: string | null
          granted_at?: string | null
          id?: string | null
          notes?: string | null
          period_year?: number | null
          remaining_days?: never
          status?: string | null
          updated_at?: string | null
          used_days?: number | null
        }
        Update: {
          bonus_days?: number | null
          carryover_days?: number | null
          created_at?: string | null
          created_by?: string | null
          employee_id?: string | null
          entitled_days?: number | null
          expires_at?: string | null
          granted_at?: string | null
          id?: string | null
          notes?: string | null
          period_year?: number | null
          remaining_days?: never
          status?: string | null
          updated_at?: string | null
          used_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_vacation_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      v_file_attachments_resolved: {
        Row: {
          attached_at: string | null
          attachment_id: string | null
          bucket: string | null
          bucket_path: string | null
          created_by: string | null
          file_id: string | null
          file_size: number | null
          kind: string | null
          mime_type: string | null
          original_filename: string | null
          quick_ocr: string | null
          target_id: string | null
          target_type: string | null
        }
        Relationships: []
      }
      v_files_hub: {
        Row: {
          entity_id: string | null
          entity_type: string | null
          file_id: string | null
          file_size: number | null
          kind: string | null
          link_id: string | null
          linked_at: string | null
          mime_type: string | null
          original_filename: string | null
          owner_id: string | null
          parent_id: string | null
          uploaded_at: string | null
          uploaded_by: string | null
          uploader_name: string | null
        }
        Relationships: []
      }
      v_payroll_entries_resolved: {
        Row: {
          created_at: string | null
          deudas: number | null
          employee_id: string | null
          extras_total: number | null
          id: string | null
          notes: string | null
          period_id: string | null
          sueldo_neto: number | null
          telefono: number | null
          total_a_pagar: number | null
          updated_at: string | null
          vacaciones_monto: number | null
          viaticos: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      v_payroll_entries_with_payments: {
        Row: {
          created_at: string | null
          deudas: number | null
          employee_id: string | null
          extras_total: number | null
          id: string | null
          notes: string | null
          paid_total: number | null
          payments_count: number | null
          period_id: string | null
          saldo: number | null
          sueldo_neto: number | null
          telefono: number | null
          total_a_pagar: number | null
          updated_at: string | null
          vacaciones_monto: number | null
          viaticos: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      v_purchase_invoice_open: {
        Row: {
          amount_credited_by_nc: number | null
          amount_opening_applied: number | null
          amount_paid: number | null
          channel_id: string | null
          imp_total: number | null
          invoice_origin_id: string | null
          kind: string | null
          moneda: string | null
          open_amount: number | null
          purchase_invoice_id: string | null
          status: string | null
          supplier_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoices_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_invoice_origin_id_fkey"
            columns: ["invoice_origin_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_invoice_origin_id_fkey"
            columns: ["invoice_origin_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_invoice_open"
            referencedColumns: ["purchase_invoice_id"]
          },
          {
            foreignKeyName: "purchase_invoices_invoice_origin_id_fkey"
            columns: ["invoice_origin_id"]
            isOneToOne: false
            referencedRelation: "v_supplier_aging_documents"
            referencedColumns: ["purchase_invoice_id"]
          },
          {
            foreignKeyName: "purchase_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_rejected_check_open: {
        Row: {
          amount: number | null
          amount_settled: number | null
          channel_id: string | null
          check_id: string | null
          check_number: string | null
          client_id: string | null
          currency: string | null
          numero: number | null
          open_amount: number | null
          punto_venta: number | null
          rejected_on: string | null
          source_receipt_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      v_supplier_account_movements: {
        Row: {
          channel_id: string | null
          channel_is_fiscal: boolean | null
          channel_name: string | null
          created_at: string | null
          currency: string | null
          gross_amount: number | null
          kind: string | null
          letter: string | null
          movement_date: string | null
          numero: number | null
          punto_venta: number | null
          signed_amount: number | null
          source_id: string | null
          source_type: string | null
          status: string | null
          supplier_id: string | null
        }
        Relationships: []
      }
      v_supplier_aging: {
        Row: {
          ars_bucket_0_30: number | null
          ars_bucket_30_60: number | null
          ars_bucket_60_90: number | null
          ars_bucket_90_plus: number | null
          ars_total_open: number | null
          document_count: number | null
          oldest_days: number | null
          supplier_id: string | null
          usd_bucket_0_30: number | null
          usd_bucket_30_60: number | null
          usd_bucket_60_90: number | null
          usd_bucket_90_plus: number | null
          usd_total_open: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_supplier_aging_by_scope: {
        Row: {
          ars_bucket_0_30: number | null
          ars_bucket_30_60: number | null
          ars_bucket_60_90: number | null
          ars_bucket_90_plus: number | null
          ars_total_open: number | null
          channel_is_fiscal: boolean | null
          document_count: number | null
          oldest_days: number | null
          supplier_id: string | null
          usd_bucket_0_30: number | null
          usd_bucket_30_60: number | null
          usd_bucket_60_90: number | null
          usd_bucket_90_plus: number | null
          usd_total_open: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_supplier_aging_documents: {
        Row: {
          amount_applied: number | null
          amount_credited_by_nc: number | null
          bucket: string | null
          channel_id: string | null
          channel_is_fiscal: boolean | null
          channel_name: string | null
          days_overdue: number | null
          fch_vto_pago: string | null
          fecha: string | null
          imp_total: number | null
          kind: string | null
          letter: string | null
          moneda: string | null
          numero: number | null
          open_amount: number | null
          punto_venta: number | null
          purchase_invoice_id: string | null
          supplier_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoices_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_transactions_tagged: {
        Row: {
          account_id: string | null
          account_name: string | null
          account_type: string | null
          accrual_month: string | null
          amount: number | null
          channel_id: string | null
          channel_is_fiscal: boolean | null
          channel_name: string | null
          counterparty_client_id: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          description: string | null
          id: string | null
          invoice_id: string | null
          is_payroll: boolean | null
          issued_check_id: string | null
          kind: string | null
          payment_order_id: string | null
          receipt_id: string | null
          rejected_check_id: string | null
          source_document: string | null
          transaction_date: string | null
          transfer_pair_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_counterparty_client_id_fkey"
            columns: ["counterparty_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_issued_check_id_fkey"
            columns: ["issued_check_id"]
            isOneToOne: false
            referencedRelation: "issued_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_payment_order_id_fkey"
            columns: ["payment_order_id"]
            isOneToOne: false
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "v_rejected_check_open"
            referencedColumns: ["source_receipt_id"]
          },
          {
            foreignKeyName: "transactions_rejected_check_id_fkey"
            columns: ["rejected_check_id"]
            isOneToOne: false
            referencedRelation: "checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_rejected_check_id_fkey"
            columns: ["rejected_check_id"]
            isOneToOne: false
            referencedRelation: "v_rejected_check_open"
            referencedColumns: ["check_id"]
          },
          {
            foreignKeyName: "transactions_transfer_pair_id_fkey"
            columns: ["transfer_pair_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_transfer_pair_id_fkey"
            columns: ["transfer_pair_id"]
            isOneToOne: false
            referencedRelation: "v_transactions_tagged"
            referencedColumns: ["id"]
          },
        ]
      }
      v_trip_revenue: {
        Row: {
          invoiced_revenue: number | null
          manual_revenue: number | null
          revenue: number | null
          revenue_source: string | null
          shipments: number | null
          trip_date: string | null
          trip_id: string | null
          uninvoiced_freight: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      account_movement_totals: {
        Args: { p_split: string; p_until: string }
        Returns: {
          account_id: string
          last_movement_date: string
          net_until: number
          net_until_split: number
        }[]
      }
      add_chat_channel_members: {
        Args: { p_channel: string; p_user_ids: string[] }
        Returns: number
      }
      aging_apply_credit: {
        Args: {
          p_b0: number
          p_b30: number
          p_b60: number
          p_b90: number
          p_credit: number
        }
        Returns: {
          b0: number
          b30: number
          b60: number
          b90: number
        }[]
      }
      ai_account_type_totals: {
        Args: {
          p_cost_center_id?: string
          p_period_end: string
          p_period_start?: string
        }
        Returns: {
          account_type: string
          accounts: number
          balance: number
          eerr_category: string
          total_credit: number
          total_debit: number
        }[]
      }
      ai_afip_last_numbers: {
        Args: never
        Returns: {
          channel_id: string
          is_enabled: boolean
          kind: string
          last_fecha: string
          last_numero: number
          letter: string
          nickname: string
          punto_venta: number
        }[]
      }
      ai_attendance_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          employee_id: string
          events: number
          hours_lost: number
          kind: string
          legal_name: string
        }[]
      }
      ai_client_sales_summary: {
        Args: {
          p_client_id?: string
          p_from: string
          p_is_fiscal?: boolean
          p_limit?: number
          p_to: string
        }
        Returns: {
          avg_days_to_pay: number
          client_id: string
          collected_ars: number
          collected_usd: number
          credit_notes: number
          invoiced_ars: number
          invoices: number
          legal_name: string
          open_ars: number
          open_foreign: number
          overdue_ars: number
          receipts: number
          total_clients: number
          total_collected_ars: number
          total_invoiced_ars: number
          total_open_ars: number
        }[]
      }
      ai_cost_center_breakdown: {
        Args: { p_period_end: string; p_period_start: string }
        Returns: {
          account_type: string
          balance: number
          cost_center_code: string
          cost_center_id: string
          cost_center_name: string
          total_credit: number
          total_debit: number
        }[]
      }
      ai_driver_extras: {
        Args: { p_from_period: string; p_to_period: string }
        Returns: {
          employee_id: string
          extras_count: number
          extras_total: number
          legal_name: string
          period: string
          sueldo_neto: number
          total_a_pagar: number
          viaticos: number
        }[]
      }
      ai_expense_by_category: {
        Args: { p_period_end: string; p_period_start: string }
        Returns: {
          amount: number
          category: string
          period: string
        }[]
      }
      ai_fleet_margin: {
        Args: {
          p_from: string
          p_group_by?: string
          p_is_fiscal?: boolean
          p_limit?: number
          p_to: string
        }
        Returns: {
          fuel_cost: number
          group_key: string
          invoiced_revenue: number
          label: string
          maintenance_cost: number
          manual_revenue: number
          margin_pct: number
          net: number
          revenue: number
          total_groups: number
          total_net: number
          total_revenue: number
          trip_cost: number
          trips: number
        }[]
      }
      ai_leaves_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          days: number
          employee_id: string
          kind: string
          leaves: number
          legal_name: string
        }[]
      }
      ai_pallets_summary: {
        Args: never
        Returns: {
          client_id: string
          client_name: string
          entered_30d: number
          exited_30d: number
          in_stock: number
          units_in_stock: number
          warehouse_id: string
          warehouse_name: string
        }[]
      }
      ai_payroll_concepts: {
        Args: {
          p_drivers_only?: boolean
          p_from_period: string
          p_to_period: string
        }
        Returns: {
          amount: number
          concept: string
          employees: number
          entries: number
          kind: string
        }[]
      }
      ai_payroll_summary: {
        Args: {
          p_employee_id?: string
          p_from_period: string
          p_group_by?: string
          p_is_fiscal?: boolean
          p_to_period: string
        }
        Returns: {
          deudas: number
          employees: number
          extras: number
          group_key: string
          label: string
          paid: number
          periods: number
          saldo: number
          sueldo_neto: number
          telefono: number
          total_a_pagar: number
          vacaciones: number
          viaticos: number
        }[]
      }
      ai_shipments_summary: {
        Args: { p_from: string; p_to: string }
        Returns: {
          client_id: string
          client_name: string
          freight: number
          invoiced: number
          shipments: number
          status: string
        }[]
      }
      ai_supplier_price_evolution: {
        Args: {
          p_category_id?: string
          p_from: string
          p_group_by?: string
          p_is_fiscal?: boolean
          p_item_query?: string
          p_limit?: number
          p_supplier_id?: string
          p_to: string
        }
        Returns: {
          avg_unit_price_ars: number
          dim_id: string
          dim_label: string
          documents: number
          item: string
          net_ars: number
          period: string
          quantity: number
        }[]
      }
      ai_supplier_purchases_summary: {
        Args: {
          p_category_id?: string
          p_from: string
          p_is_fiscal?: boolean
          p_limit?: number
          p_supplier_id?: string
          p_to: string
        }
        Returns: {
          category: string
          invoices: number
          legal_name: string
          net_ars: number
          next_due_date: string
          open_ars: number
          open_foreign: number
          overdue_ars: number
          paid_ars: number
          paid_usd: number
          purchased_ars: number
          supplier_id: string
          total_open_ars: number
          total_purchased_ars: number
          total_suppliers: number
        }[]
      }
      ai_supplier_upcoming_dues: {
        Args: {
          p_days?: number
          p_is_fiscal?: boolean
          p_limit?: number
          p_supplier_id?: string
        }
        Returns: {
          days_to_due: number
          due_date: string
          fecha: string
          kind: string
          legal_name: string
          letter: string
          moneda: string
          numero: number
          open_amount: number
          punto_venta: number
          purchase_invoice_id: string
          supplier_id: string
          total_documents: number
          total_open_ars: number
        }[]
      }
      ai_usage_today: {
        Args: never
        Returns: {
          cost_usd: number
          total_tokens: number
        }[]
      }
      ai_vacation_overview: {
        Args: { p_as_of?: string; p_expiring_days?: number }
        Returns: {
          employee_id: string
          entitled_days: number
          expiring_days: number
          legal_name: string
          next_expiry: string
          remaining_days: number
          taken_this_year: number
          used_days: number
        }[]
      }
      apply_account_opening_balance: {
        Args: {
          p_account_id: string
          p_adjustment_date: string
          p_channel_id: string
          p_notes?: string
          p_target_balance: number
        }
        Returns: undefined
      }
      apply_client_opening_balance: {
        Args: {
          p_client_id: string
          p_notes?: string
          p_opening_date: string
          p_target_balance: number
        }
        Returns: undefined
      }
      apply_supplier_opening_balance: {
        Args: {
          p_notes?: string
          p_opening_date: string
          p_supplier_id: string
          p_target_balance: number
        }
        Returns: undefined
      }
      apply_vacation_delta: {
        Args: { p_delta: number; p_employee_id: string }
        Returns: undefined
      }
      backfill_check_channels: { Args: never; Returns: undefined }
      bootstrap_first_owner: { Args: { p_user_id: string }; Returns: boolean }
      build_invoice_journal_lines: {
        Args: {
          p_description: string
          p_invoice: Database["public"]["Tables"]["invoices"]["Row"]
        }
        Returns: Json
      }
      build_payment_order_journal_lines: {
        Args: {
          p_description: string
          p_payment_order: Database["public"]["Tables"]["payment_orders"]["Row"]
        }
        Returns: Json
      }
      build_purchase_invoice_journal_lines: {
        Args: {
          p_description: string
          p_invoice: Database["public"]["Tables"]["purchase_invoices"]["Row"]
        }
        Returns: Json
      }
      build_receipt_journal_lines: {
        Args: {
          p_description: string
          p_receipt: Database["public"]["Tables"]["receipts"]["Row"]
        }
        Returns: Json
      }
      build_transaction_journal_lines: {
        Args: {
          p_description: string
          p_transaction: Database["public"]["Tables"]["transactions"]["Row"]
        }
        Returns: Json
      }
      bump_rate_limit_bucket: {
        Args: {
          p_bucket_key: string
          p_user_id: string
          p_window_start: string
        }
        Returns: number
      }
      checks_channel_mismatches: {
        Args: never
        Returns: {
          check_id: string
          check_number: string
          document_id: string
          journal_entry_id: string
          movement: string
          movement_channel_id: string
          receipt_channel_id: string
        }[]
      }
      claim_storage_billing_period: {
        Args: {
          p_channel_id: string
          p_client_id: string
          p_period_end: string
          p_period_start: string
        }
        Returns: string
      }
      cleanup_padron_cache: { Args: { p_older_than?: string }; Returns: number }
      cleanup_rate_limit_buckets: {
        Args: { p_older_than?: string }
        Returns: number
      }
      clear_account_opening_balance: {
        Args: { p_account_id: string }
        Returns: undefined
      }
      clear_client_opening_balance: {
        Args: { p_client_id: string }
        Returns: undefined
      }
      clear_supplier_opening_balance: {
        Args: { p_supplier_id: string }
        Returns: undefined
      }
      clients:
        | {
            Args: { "": Database["public"]["Views"]["v_client_aging"]["Row"] }
            Returns: {
              address: string | null
              created_at: string
              created_by: string | null
              cuit: string
              display_name: string | null
              email: string | null
              id: string
              is_active: boolean
              iva_condition: string
              legal_name: string
              notes: string | null
              phone: string | null
              real_address: string | null
              updated_at: string
            }
            SetofOptions: {
              from: "v_client_aging"
              to: "clients"
              isOneToOne: true
              isSetofReturn: true
            }
          }
        | {
            Args: {
              "": Database["public"]["Views"]["v_client_aging_by_scope"]["Row"]
            }
            Returns: {
              address: string | null
              created_at: string
              created_by: string | null
              cuit: string
              display_name: string | null
              email: string | null
              id: string
              is_active: boolean
              iva_condition: string
              legal_name: string
              notes: string | null
              phone: string | null
              real_address: string | null
              updated_at: string
            }
            SetofOptions: {
              from: "v_client_aging_by_scope"
              to: "clients"
              isOneToOne: true
              isSetofReturn: true
            }
          }
      coa_role_for_account: {
        Args: { p_account_id: string }
        Returns: Database["public"]["Enums"]["coa_system_role"]
      }
      create_chat_group: {
        Args: { p_description: string; p_member_ids: string[]; p_name: string }
        Returns: string
      }
      create_journal_entry: {
        Args: {
          p_accrual_period: string
          p_channel_id?: string
          p_description: string
          p_entry_date: string
          p_is_reversal?: boolean
          p_lines: Json
          p_reversed_entry_id?: string
          p_source_id?: string
          p_source_table?: string
        }
        Returns: string
      }
      create_manual_journal_entry: {
        Args: {
          p_channel_id?: string
          p_description: string
          p_entry_date: string
          p_lines: Json
        }
        Returns: string
      }
      create_payment_order: {
        Args: {
          p_allocations: Json
          p_channel_id: string
          p_cotizacion?: number
          p_currency: string
          p_notes: string
          p_numero: number
          p_payment_date: string
          p_payment_lines: Json
          p_punto_venta: number
          p_supplier_id: string
          p_total_amount: number
        }
        Returns: string
      }
      create_receipt: {
        Args: {
          p_allocations: Json
          p_channel_id: string
          p_client_id: string
          p_cotizacion?: number
          p_currency: string
          p_notes: string
          p_numero: number
          p_payment_lines: Json
          p_punto_venta: number
          p_recibo_date: string
          p_retentions: Json
          p_total_amount: number
        }
        Returns: string
      }
      create_transfer: {
        Args: {
          p_account_from_id: string
          p_account_to_id: string
          p_accrual_month: string
          p_amount: number
          p_channel_id: string
          p_currency: string
          p_description: string
          p_transaction_date: string
        }
        Returns: {
          transfer_in_id: string
          transfer_out_id: string
        }[]
      }
      credit_check: {
        Args: { p_check_id: string; p_event_date: string; p_notes: string }
        Returns: string
      }
      current_journal_entries: {
        Args: { p_id: string; p_source: string }
        Returns: string[]
      }
      delete_chat_draft_file: {
        Args: { p_file_id: string; p_user_id: string }
        Returns: {
          bucket: string
          bucket_path: string
        }[]
      }
      deposit_check: {
        Args: {
          p_account_id: string
          p_channel_id: string
          p_check_id: string
          p_description: string
          p_event_date: string
        }
        Returns: string
      }
      emit_caea_invoice: {
        Args: {
          p_afip_last: number
          p_cae_vencimiento: string
          p_caea: string
          p_invoice_id: string
        }
        Returns: number
      }
      emit_journal: {
        Args: { p_id: string; p_source: string }
        Returns: string
      }
      find_account_by_role: {
        Args: { p_role: Database["public"]["Enums"]["coa_system_role"] }
        Returns: string
      }
      find_orphan_files: {
        Args: { p_max_age?: string }
        Returns: {
          bucket: string
          bucket_path: string
          id: string
        }[]
      }
      get_account_balances: {
        Args: {
          p_cost_center_id?: string
          p_period_end: string
          p_period_start?: string
        }
        Returns: {
          account_code: string
          account_id: string
          account_name: string
          account_type: Database["public"]["Enums"]["coa_account_type"]
          balance: number
          eerr_category: string
          total_credit: number
          total_debit: number
        }[]
      }
      get_exchange_rate: {
        Args: { p_currency: string; p_date: string }
        Returns: number
      }
      get_ledger: {
        Args: { p_account_id: string; p_date_from?: string; p_date_to?: string }
        Returns: {
          accrual_period: string
          channel_id: string
          credit: number
          debit: number
          description: string
          entry_date: string
          entry_id: string
          is_reversal: boolean
          line_desc: string
          line_id: string
          running: number
          source_id: string
          source_table: string
        }[]
      }
      get_my_notification_settings: {
        Args: never
        Returns: {
          enabled: boolean
          notification_type: string
        }[]
      }
      get_my_unread_notification_count: { Args: never; Returns: number }
      get_or_create_self_channel: { Args: never; Returns: string }
      grant_vacation_balances: {
        Args: { p_carryover?: boolean; p_target_year?: number }
        Returns: {
          balance_id: string
          carryover_days: number
          employee_id: string
          entitled_days: number
        }[]
      }
      invoice_open_amount: { Args: { p_invoice_id: string }; Returns: number }
      is_channel_fiscal: { Args: { p_channel_id: string }; Returns: boolean }
      is_driver_employee: { Args: { p_employee_id: string }; Returns: boolean }
      is_employee_document_file: {
        Args: { p_file_id: string }
        Returns: boolean
      }
      is_fleet_document_file: { Args: { p_file_id: string }; Returns: boolean }
      journal_entry_status: {
        Args: { p_id: string; p_source: string }
        Returns: string
      }
      journal_expected_entry: {
        Args: { p_id: string; p_source: string }
        Returns: Json
      }
      journal_missing_entries: {
        Args: never
        Returns: {
          source_id: string
          source_table: string
          status: string
        }[]
      }
      journal_non_fiscal_entries: {
        Args: never
        Returns: {
          channel_id: string
          description: string
          entry_date: string
          entry_id: string
          source_id: string
          source_table: string
        }[]
      }
      libro_iva_compras: {
        Args: { p_channel_id?: string; p_period: string }
        Returns: {
          cae_proveedor: string
          cae_vto_proveedor: string
          channel_id: string
          channel_name: string
          cotizacion: number
          fecha: string
          has_items: boolean
          imp_total: number
          imp_total_orig: number
          imp_trib: number
          imp_trib_orig: number
          iva: number
          iva_orig: number
          iva_rate_id: number
          iva_rate_pct: number
          kind: string
          letter: string
          moneda: string
          neto: number
          neto_orig: number
          numero: number
          punto_venta: number
          purchase_invoice_id: string
          supplier_cuit: string
          supplier_legal_name: string
        }[]
      }
      libro_iva_ventas: {
        Args: { p_channel_id?: string; p_period: string }
        Returns: {
          cae: string
          cae_vencimiento: string
          cbte_tipo_afip: number
          channel_id: string
          channel_name: string
          client_legal_name: string
          cotizacion: number
          doc_nro: string
          doc_tipo: number
          fecha: string
          has_items: boolean
          imp_op_ex: number
          imp_op_ex_orig: number
          imp_tot_conc: number
          imp_tot_conc_orig: number
          imp_total: number
          imp_total_orig: number
          imp_trib: number
          imp_trib_orig: number
          invoice_id: string
          iva: number
          iva_orig: number
          iva_rate_id: number
          iva_rate_pct: number
          kind: string
          letter: string
          moneda: string
          neto: number
          neto_orig: number
          numero: number
          punto_venta: number
        }[]
      }
      list_chat_assignable_users: {
        Args: never
        Returns: {
          avatar_color: string
          avatar_path: string
          email: string
          first_name: string
          last_name: string
          user_id: string
        }[]
      }
      list_chat_channels_for_user: {
        Args: never
        Returns: {
          avatar_color: string
          avatar_path: string
          display_name: string
          id: string
          is_muted: boolean
          kind: Database["public"]["Enums"]["chat_channel_kind"]
          last_message_at: string
          last_message_preview: string
          last_message_sender_id: string
          member_count: number
          other_email: string
          other_first_name: string
          other_last_name: string
          other_user_id: string
          unread_count: number
        }[]
      }
      list_my_notifications: {
        Args: { p_filter?: string; p_limit?: number }
        Returns: {
          created_at: string
          id: string
          metadata: Json
          read_at: string
          recipient_id: string
          sender_avatar_color: string
          sender_avatar_path: string
          sender_email: string
          sender_first_name: string
          sender_id: string
          sender_last_name: string
          type: string
        }[]
      }
      mark_all_my_notifications_read: { Args: never; Returns: number }
      mark_chat_channel_read: {
        Args: { p_channel: string }
        Returns: undefined
      }
      next_internal_invoice_numero_atomic: {
        Args: {
          p_channel_id: string
          p_invoice_id: string
          p_kind: string
          p_punto_venta: number
        }
        Returns: number
      }
      next_internal_purchase_numero: {
        Args: { p_channel_id: string; p_supplier_id: string }
        Returns: number
      }
      notification_type_enabled: {
        Args: { p_type: string; p_user_id: string }
        Returns: boolean
      }
      open_or_create_dm: { Args: { p_other: string }; Returns: string }
      pay_loan_installment: {
        Args: {
          p_account_id: string
          p_amount: number
          p_installment_id: string
          p_paid_date: string
        }
        Returns: string
      }
      pick_default_avatar_color: {
        Args: { p_user_id: string }
        Returns: string
      }
      purchase_invoices_fiscal_without_letter: {
        Args: never
        Returns: {
          fecha: string
          numero: number
          punto_venta: number
          purchase_invoice_id: string
          status: string
          supplier_id: string
        }[]
      }
      refresh_search_index: { Args: never; Returns: undefined }
      refresh_search_index_if_dirty: { Args: never; Returns: boolean }
      reject_check: {
        Args: {
          p_account_id: string
          p_channel_id: string
          p_check_id: string
          p_event_date: string
          p_notes: string
        }
        Returns: string
      }
      replace_purchase_invoice_items: {
        Args: { p_invoice_id: string; p_items: Json }
        Returns: undefined
      }
      repost_journal: {
        Args: { p_id: string; p_source: string }
        Returns: undefined
      }
      reverse_journal_entry: { Args: { p_entry_id: string }; Returns: string }
      search_chat_messages: {
        Args: { p_channel?: string; p_limit?: number; p_query: string }
        Returns: {
          body: string
          channel_display_name: string
          channel_id: string
          channel_kind: Database["public"]["Enums"]["chat_channel_kind"]
          created_at: string
          id: string
          sender_avatar_color: string
          sender_avatar_path: string
          sender_email: string
          sender_first_name: string
          sender_id: string
          sender_last_name: string
        }[]
      }
      search_clients: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_only_active?: boolean
          p_query: string
        }
        Returns: {
          address: string | null
          created_at: string
          created_by: string | null
          cuit: string
          display_name: string | null
          email: string | null
          id: string
          is_active: boolean
          iva_condition: string
          legal_name: string
          notes: string | null
          phone: string | null
          real_address: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_employees: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_only_active?: boolean
          p_query: string
        }
        Returns: {
          base_salary: number | null
          cbu: string | null
          created_at: string
          created_by: string | null
          cuil: string | null
          hire_date: string
          id: string
          is_active: boolean
          is_monotributo: boolean
          legal_name: string
          notes: string | null
          pay_frequency: string
          position: string | null
          termination_date: string | null
          updated_at: string
          viatico_monthly: number
        }[]
        SetofOptions: {
          from: "*"
          to: "employees"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_global: {
        Args: { p_limit?: number; p_query: string; p_types?: string[] }
        Returns: {
          entity_id: string
          entity_type: string
          rank: number
          subtitle: string
          title: string
          url: string
        }[]
      }
      search_purchase_invoices: {
        Args: {
          p_channel_id?: string
          p_exclude_id?: string
          p_fecha_from?: string
          p_fecha_to?: string
          p_is_fiscal?: boolean
          p_kind?: string
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_status?: string
          p_supplier_id?: string
        }
        Returns: {
          cae_proveedor: string
          cae_vto_proveedor: string
          cancelled_at: string
          cancelled_by: string
          channel_id: string
          cotizacion: number
          created_at: string
          created_by: string
          fch_vto_pago: string
          fecha: string
          id: string
          imp_iva: number
          imp_neto: number
          imp_total: number
          imp_trib: number
          invoice_origin_id: string
          kind: string
          letter: string
          moneda: string
          motivo_nc_nd: string
          notes: string
          numero: number
          punto_venta: number
          status: string
          supplier_cuit: string
          supplier_id: string
          supplier_legal_name: string
          updated_at: string
        }[]
      }
      search_suppliers: {
        Args: {
          p_category_id?: string
          p_limit?: number
          p_offset?: number
          p_only_active?: boolean
          p_query: string
        }
        Returns: {
          address: string | null
          category_id: string | null
          created_at: string
          created_by: string | null
          cuit: string
          default_channel_id: string | null
          default_payment_term_days: number | null
          display_name: string | null
          email: string | null
          id: string
          is_active: boolean
          iva_condition: string
          legal_name: string
          notes: string | null
          phone: string | null
          real_address: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "suppliers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      seed_payroll_period: {
        Args: { p_month: number; p_year: number }
        Returns: string
      }
      set_user_access: {
        Args: {
          p_actor: string
          p_addable_roles?: string[]
          p_denied?: string[]
          p_expected_denied?: string[]
          p_expected_roles?: string[]
          p_removable_roles?: string[]
          p_roles?: string[]
          p_user_id: string
        }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      transaction_monthly_flows: {
        Args: { p_from: string; p_until: string }
        Returns: {
          account_id: string
          kind: string
          month: string
          scope: string
          total: number
        }[]
      }
      update_chat_channel: {
        Args: { p_channel: string; p_description: string; p_name: string }
        Returns: undefined
      }
      update_payment_order: {
        Args: {
          p_allocations: Json
          p_cotizacion?: number
          p_id: string
          p_notes: string
          p_payment_date: string
          p_payment_lines: Json
          p_total_amount: number
        }
        Returns: undefined
      }
      update_receipt: {
        Args: {
          p_allocations: Json
          p_cotizacion?: number
          p_id: string
          p_notes: string
          p_payment_lines: Json
          p_recibo_date: string
          p_retentions: Json
          p_total_amount: number
        }
        Returns: undefined
      }
      upsert_my_notification_setting: {
        Args: { p_enabled: boolean; p_type: string }
        Returns: undefined
      }
      user_has_role: { Args: { p_role_ids: string[] }; Returns: boolean }
      user_is_channel_member: { Args: { p_channel: string }; Returns: boolean }
      vacation_work_days: {
        Args: { p_employee_id: string; p_year: number }
        Returns: {
          effective_work_days: number
          employee_work_days: number
          year_work_days: number
        }[]
      }
    }
    Enums: {
      attendance_kind:
        | "absent_justified"
        | "absent_unjustified"
        | "late"
        | "early_leave"
        | "sick"
        | "leave"
        | "holiday"
      chat_channel_kind: "self" | "dm" | "group"
      coa_account_type:
        | "activo"
        | "pasivo"
        | "patrimonio"
        | "resultado_positivo"
        | "resultado_negativo"
        | "orden"
      coa_system_role:
        | "caja"
        | "banco"
        | "clientes"
        | "proveedores"
        | "iva_debito"
        | "iva_credito"
        | "iva_percibido"
        | "iva_retenido"
        | "percepciones_iibb_pagadas"
        | "percepciones_iibb_cobradas"
        | "retenciones_pagadas"
        | "retenciones_cobradas"
        | "ventas"
        | "compras"
        | "gastos"
        | "cheques_cartera"
        | "cheques_rechazados"
        | "cheques_diferidos_emitidos"
        | "caja_apertura"
        | "ajustes_caja"
        | "sueldos"
      employee_document_kind:
        | "licencia_conducir"
        | "lnh"
        | "libreta_sanitaria"
        | "curso_cargas_peligrosas"
        | "curso_mercaderias_peligrosas"
        | "aptitud_psicofisica"
        | "aptitud_visual"
        | "cedula_verde"
        | "cedula_azul"
        | "seguro_personal"
        | "arn"
        | "otro"
      leave_kind:
        | "vacaciones"
        | "enfermedad"
        | "franco"
        | "maternidad"
        | "paternidad"
        | "otro"
      loan_installment_status: "pendiente" | "pagada"
      loan_kind: "prestamo" | "leasing"
      loan_status: "active" | "paid" | "cancelled"
      payroll_payment_method: "transferencia" | "efectivo"
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
  public: {
    Enums: {
      attendance_kind: [
        "absent_justified",
        "absent_unjustified",
        "late",
        "early_leave",
        "sick",
        "leave",
        "holiday",
      ],
      chat_channel_kind: ["self", "dm", "group"],
      coa_account_type: [
        "activo",
        "pasivo",
        "patrimonio",
        "resultado_positivo",
        "resultado_negativo",
        "orden",
      ],
      coa_system_role: [
        "caja",
        "banco",
        "clientes",
        "proveedores",
        "iva_debito",
        "iva_credito",
        "iva_percibido",
        "iva_retenido",
        "percepciones_iibb_pagadas",
        "percepciones_iibb_cobradas",
        "retenciones_pagadas",
        "retenciones_cobradas",
        "ventas",
        "compras",
        "gastos",
        "cheques_cartera",
        "cheques_rechazados",
        "cheques_diferidos_emitidos",
        "caja_apertura",
        "ajustes_caja",
        "sueldos",
      ],
      employee_document_kind: [
        "licencia_conducir",
        "lnh",
        "libreta_sanitaria",
        "curso_cargas_peligrosas",
        "curso_mercaderias_peligrosas",
        "aptitud_psicofisica",
        "aptitud_visual",
        "cedula_verde",
        "cedula_azul",
        "seguro_personal",
        "arn",
        "otro",
      ],
      leave_kind: [
        "vacaciones",
        "enfermedad",
        "franco",
        "maternidad",
        "paternidad",
        "otro",
      ],
      loan_installment_status: ["pendiente", "pagada"],
      loan_kind: ["prestamo", "leasing"],
      loan_status: ["active", "paid", "cancelled"],
      payroll_payment_method: ["transferencia", "efectivo"],
    },
  },
} as const

