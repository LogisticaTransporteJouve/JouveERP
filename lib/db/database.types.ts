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
      audit_events: {
        Row: {
          actor_id: string | null
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
      comprobante_items: {
        Row: {
          comprobante_id: string
          created_at: string
          description: string
          id: string
          iva_rate_id: number | null
          line_iva: number
          line_neto: number
          line_total: number
          quantity: number
          sort_order: number
          unit_price: number
        }
        Insert: {
          comprobante_id: string
          created_at?: string
          description: string
          id?: string
          iva_rate_id?: number | null
          line_iva?: number
          line_neto: number
          line_total: number
          quantity: number
          sort_order?: number
          unit_price: number
        }
        Update: {
          comprobante_id?: string
          created_at?: string
          description?: string
          id?: string
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
            foreignKeyName: "comprobante_items_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
        ]
      }
      comprobantes: {
        Row: {
          afip_observaciones: Json | null
          cae: string | null
          cae_vencimiento: string | null
          cbte_tipo_afip: number | null
          cbte_tipo_origen_afip: number | null
          channel_id: string
          client_id: string
          comprobante_origen_id: string | null
          concepto: number
          cotizacion: number
          created_at: string
          created_by: string | null
          doc_nro: string
          doc_tipo: number
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
          iva_condition_receptor: number | null
          kind: string
          letter: string | null
          moneda: string
          motivo_nc_nd: string | null
          notified_at: string | null
          numero: number | null
          pdf_url: string | null
          punto_venta: number
          status: string
          updated_at: string
        }
        Insert: {
          afip_observaciones?: Json | null
          cae?: string | null
          cae_vencimiento?: string | null
          cbte_tipo_afip?: number | null
          cbte_tipo_origen_afip?: number | null
          channel_id: string
          client_id: string
          comprobante_origen_id?: string | null
          concepto: number
          cotizacion?: number
          created_at?: string
          created_by?: string | null
          doc_nro: string
          doc_tipo: number
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
          iva_condition_receptor?: number | null
          kind: string
          letter?: string | null
          moneda?: string
          motivo_nc_nd?: string | null
          notified_at?: string | null
          numero?: number | null
          pdf_url?: string | null
          punto_venta: number
          status?: string
          updated_at?: string
        }
        Update: {
          afip_observaciones?: Json | null
          cae?: string | null
          cae_vencimiento?: string | null
          cbte_tipo_afip?: number | null
          cbte_tipo_origen_afip?: number | null
          channel_id?: string
          client_id?: string
          comprobante_origen_id?: string | null
          concepto?: number
          cotizacion?: number
          created_at?: string
          created_by?: string | null
          doc_nro?: string
          doc_tipo?: number
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
          iva_condition_receptor?: number | null
          kind?: string
          letter?: string | null
          moneda?: string
          motivo_nc_nd?: string | null
          notified_at?: string | null
          numero?: number | null
          pdf_url?: string | null
          punto_venta?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comprobantes_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprobantes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprobantes_comprobante_origen_id_fkey"
            columns: ["comprobante_origen_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
        ]
      }
      invoicing_channels: {
        Row: {
          business_unit_id: string
          created_at: string
          display_color: string | null
          division: string
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
          division: string
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
          division?: string
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
      puntos_de_venta: {
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
            foreignKeyName: "puntos_de_venta_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "invoicing_channels"
            referencedColumns: ["id"]
          },
        ]
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
          comprobante_id: string
          created_at: string
          id: string
          receipt_id: string
          updated_at: string
        }
        Insert: {
          amount_applied: number
          comprobante_id: string
          created_at?: string
          id?: string
          receipt_id: string
          updated_at?: string
        }
        Update: {
          amount_applied?: number
          comprobante_id?: string
          created_at?: string
          id?: string
          receipt_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_allocations_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_allocations_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
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
        ]
      }
      receipts: {
        Row: {
          canceled_at: string | null
          canceled_by: string | null
          channel_id: string
          client_id: string
          created_at: string
          created_by: string | null
          currency: string
          id: string
          notes: string | null
          numero: number
          punto_venta: number
          recibo_date: string
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          canceled_at?: string | null
          canceled_by?: string | null
          channel_id: string
          client_id: string
          created_at?: string
          created_by?: string | null
          currency: string
          id?: string
          notes?: string | null
          numero: number
          punto_venta: number
          recibo_date: string
          status?: string
          total_amount: number
          updated_at?: string
        }
        Update: {
          canceled_at?: string | null
          canceled_by?: string | null
          channel_id?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          notes?: string | null
          numero?: number
          punto_venta?: number
          recibo_date?: string
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
      transactions: {
        Row: {
          account_id: string
          accrual_month: string
          amount: number
          channel_id: string
          comprobante_id: string | null
          counterparty_client_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          id: string
          kind: string
          transaction_date: string
          transfer_pair_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          accrual_month: string
          amount: number
          channel_id: string
          comprobante_id?: string | null
          counterparty_client_id?: string | null
          created_at?: string
          created_by?: string | null
          currency: string
          description?: string | null
          id?: string
          kind: string
          transaction_date: string
          transfer_pair_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          accrual_month?: string
          amount?: number
          channel_id?: string
          comprobante_id?: string | null
          counterparty_client_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          kind?: string
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
            foreignKeyName: "transactions_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
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
    }
    Views: {
      v_client_account_movements: {
        Row: {
          channel_division: string | null
          channel_id: string | null
          channel_is_fiscal: boolean | null
          channel_name: string | null
          client_id: string | null
          created_at: string | null
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
      v_transactions_tagged: {
        Row: {
          account_id: string | null
          account_name: string | null
          account_type: string | null
          accrual_month: string | null
          amount: number | null
          channel_division: string | null
          channel_id: string | null
          channel_is_fiscal: boolean | null
          channel_name: string | null
          comprobante_id: string | null
          counterparty_client_id: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          description: string | null
          id: string | null
          kind: string | null
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
            foreignKeyName: "transactions_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
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
    }
    Functions: {
      bump_rate_limit_bucket: {
        Args: {
          p_bucket_key: string
          p_user_id: string
          p_window_start: string
        }
        Returns: number
      }
      create_receipt: {
        Args: {
          p_allocations: Json
          p_channel_id: string
          p_client_id: string
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      update_receipt: {
        Args: {
          p_allocations: Json
          p_id: string
          p_notes: string
          p_payment_lines: Json
          p_recibo_date: string
          p_retentions: Json
          p_total_amount: number
        }
        Returns: undefined
      }
      user_has_role: { Args: { p_role_ids: string[] }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const

