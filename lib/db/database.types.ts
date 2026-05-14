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
            foreignKeyName: "client_opening_balance_allocations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_opening_balance_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_opening_balance_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "v_aging_documents"
            referencedColumns: ["invoice_id"]
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
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_aging_documents"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      invoices: {
        Row: {
          afip_observaciones: Json | null
          cae: string | null
          cae_vencimiento: string | null
          cbte_tipo_afip: number | null
          cbte_tipo_origen_afip: number | null
          channel_id: string
          client_id: string
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
          invoice_origin_id: string | null
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
          invoice_origin_id?: string | null
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
          invoice_origin_id?: string | null
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
            foreignKeyName: "invoices_invoice_origin_id_fkey"
            columns: ["invoice_origin_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_invoice_origin_id_fkey"
            columns: ["invoice_origin_id"]
            isOneToOne: false
            referencedRelation: "v_aging_documents"
            referencedColumns: ["invoice_id"]
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
      purchase_invoices: {
        Row: {
          cae_proveedor: string | null
          cae_vto_proveedor: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          channel_id: string
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
          cae_proveedor?: string | null
          cae_vto_proveedor?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          channel_id: string
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
          cae_proveedor?: string | null
          cae_vto_proveedor?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          channel_id?: string
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
            foreignKeyName: "receipt_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_aging_documents"
            referencedColumns: ["invoice_id"]
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
          created_at?: string
          created_by?: string | null
          currency: string
          id?: string
          notes?: string | null
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
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          notes?: string | null
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
      suppliers: {
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
      transactions: {
        Row: {
          account_id: string
          accrual_month: string
          amount: number
          channel_id: string
          counterparty_client_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          id: string
          invoice_id: string | null
          kind: string
          receipt_id: string | null
          transaction_date: string
          transfer_pair_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          accrual_month: string
          amount: number
          channel_id: string
          counterparty_client_id?: string | null
          created_at?: string
          created_by?: string | null
          currency: string
          description?: string | null
          id?: string
          invoice_id?: string | null
          kind: string
          receipt_id?: string | null
          transaction_date: string
          transfer_pair_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          accrual_month?: string
          amount?: number
          channel_id?: string
          counterparty_client_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          id?: string
          invoice_id?: string | null
          kind?: string
          receipt_id?: string | null
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
            foreignKeyName: "transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_aging_documents"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "transactions_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
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
    }
    Views: {
      v_aging_documents: {
        Row: {
          amount_applied: number | null
          bucket: string | null
          channel_id: string | null
          channel_is_fiscal: boolean | null
          channel_name: string | null
          client_id: string | null
          days_overdue: number | null
          fecha: string | null
          imp_total: number | null
          invoice_id: string | null
          kind: string | null
          letter: string | null
          numero: number | null
          open_amount: number | null
          punto_venta: number | null
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
        ]
      }
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
      v_client_aging: {
        Row: {
          bucket_0_30: number | null
          bucket_30_60: number | null
          bucket_60_90: number | null
          bucket_90_plus: number | null
          client_id: string | null
          document_count: number | null
          oldest_days: number | null
          total_open: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
          channel_division: string | null
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
            foreignKeyName: "transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_aging_documents"
            referencedColumns: ["invoice_id"]
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
      add_chat_channel_members: {
        Args: { p_channel: string; p_user_ids: string[] }
        Returns: number
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
      bump_rate_limit_bucket: {
        Args: {
          p_bucket_key: string
          p_user_id: string
          p_window_start: string
        }
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
      create_chat_group: {
        Args: { p_description: string; p_member_ids: string[]; p_name: string }
        Returns: string
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
      credit_check: {
        Args: { p_check_id: string; p_event_date: string; p_notes: string }
        Returns: string
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
      endorse_check: {
        Args: {
          p_channel_id: string
          p_check_id: string
          p_endorsed_to_cuit: string
          p_endorsed_to_name: string
          p_event_date: string
          p_notes: string
        }
        Returns: string
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
      notification_type_enabled: {
        Args: { p_type: string; p_user_id: string }
        Returns: boolean
      }
      open_or_create_dm: { Args: { p_other: string }; Returns: string }
      pick_default_avatar_color: {
        Args: { p_user_id: string }
        Returns: string
      }
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
      search_purchase_invoices: {
        Args: {
          p_channel_id?: string
          p_fecha_from?: string
          p_fecha_to?: string
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
          to: "suppliers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      update_chat_channel: {
        Args: { p_channel: string; p_description: string; p_name: string }
        Returns: undefined
      }
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
      upsert_my_notification_setting: {
        Args: { p_enabled: boolean; p_type: string }
        Returns: undefined
      }
      user_has_role: { Args: { p_role_ids: string[] }; Returns: boolean }
      user_is_channel_member: { Args: { p_channel: string }; Returns: boolean }
    }
    Enums: {
      chat_channel_kind: "self" | "dm" | "group"
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
      chat_channel_kind: ["self", "dm", "group"],
    },
  },
} as const

