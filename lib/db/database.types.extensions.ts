// Extensiones manuales de los tipos generados de Supabase.
//
// Las tablas / RPCs declaradas acá viven en el schema real pero todavía
// no se reflejaron en `database.types.ts`. Para regenerar:
//
//   pnpm dlx supabase start
//   pnpm db:types:generate
//
// Después de regenerar, **borrar este archivo** y revertir la mezcla en
// `lib/db/database.ts` para volver a usar el `Database` puro generado.
//
// El merge se hace en `lib/db/database.ts` con un intersection type:
//
//   type Database = Omit<Generated, "public"> & {
//     public: Generated["public"] & DatabaseExtensions["public"];
//   };

import type { Json } from "./database.types";

export type DatabaseExtensions = {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          user_id: string;
          first_name: string | null;
          last_name: string | null;
          avatar_path: string | null;
          avatar_color: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          first_name?: string | null;
          last_name?: string | null;
          avatar_path?: string | null;
          avatar_color?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          first_name?: string | null;
          last_name?: string | null;
          avatar_path?: string | null;
          avatar_color?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      chat_channels: {
        Row: {
          id: string;
          kind: "self" | "dm" | "group";
          name: string | null;
          description: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
          last_message_at: string | null;
          dm_pair_key: string | null;
        };
        Insert: {
          id?: string;
          kind: "self" | "dm" | "group";
          name?: string | null;
          description?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
          last_message_at?: string | null;
          dm_pair_key?: string | null;
        };
        Update: {
          id?: string;
          kind?: "self" | "dm" | "group";
          name?: string | null;
          description?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
          last_message_at?: string | null;
          dm_pair_key?: string | null;
        };
        Relationships: [];
      };
      chat_channel_members: {
        Row: {
          channel_id: string;
          user_id: string;
          role: string;
          joined_at: string;
          last_read_at: string;
          is_muted: boolean;
        };
        Insert: {
          channel_id: string;
          user_id: string;
          role?: string;
          joined_at?: string;
          last_read_at?: string;
          is_muted?: boolean;
        };
        Update: {
          channel_id?: string;
          user_id?: string;
          role?: string;
          joined_at?: string;
          last_read_at?: string;
          is_muted?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "chat_channel_members_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "chat_channels";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_messages: {
        Row: {
          id: string;
          channel_id: string;
          sender_id: string;
          reply_to_message_id: string | null;
          body: string;
          edited_at: string | null;
          deleted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          channel_id: string;
          sender_id: string;
          reply_to_message_id?: string | null;
          body: string;
          edited_at?: string | null;
          deleted_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          channel_id?: string;
          sender_id?: string;
          reply_to_message_id?: string | null;
          body?: string;
          edited_at?: string | null;
          deleted_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_messages_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "chat_channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chat_messages_reply_to_message_id_fkey";
            columns: ["reply_to_message_id"];
            isOneToOne: false;
            referencedRelation: "chat_messages";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_message_reactions: {
        Row: {
          message_id: string;
          user_id: string;
          emoji: string;
          created_at: string;
        };
        Insert: {
          message_id: string;
          user_id: string;
          emoji: string;
          created_at?: string;
        };
        Update: {
          message_id?: string;
          user_id?: string;
          emoji?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_message_reactions_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "chat_messages";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<never, never>;
    Functions: {
      get_or_create_self_channel: {
        Args: Record<string, never>;
        Returns: string;
      };
      open_or_create_dm: {
        Args: { p_other: string };
        Returns: string;
      };
      create_chat_group: {
        Args: {
          p_name: string;
          p_description: string | null;
          p_member_ids: string[];
        };
        Returns: string;
      };
      list_chat_channels_for_user: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          kind: "self" | "dm" | "group";
          display_name: string | null;
          other_user_id: string | null;
          avatar_path: string | null;
          avatar_color: string | null;
          last_message_at: string | null;
          last_message_preview: string | null;
          last_message_sender_id: string | null;
          unread_count: number;
          is_muted: boolean;
          member_count: number;
        }[];
      };
      list_chat_assignable_users: {
        Args: Record<string, never>;
        Returns: {
          user_id: string;
          email: string;
          first_name: string | null;
          last_name: string | null;
          avatar_path: string | null;
          avatar_color: string | null;
        }[];
      };
      mark_chat_channel_read: {
        Args: { p_channel: string };
        Returns: void;
      };
      user_is_channel_member: {
        Args: { p_channel: string };
        Returns: boolean;
      };
      pick_default_avatar_color: {
        Args: { p_user_id: string };
        Returns: string;
      };
    };
    Enums: {
      chat_channel_kind: "self" | "dm" | "group";
    };
    CompositeTypes: Record<never, never>;
  };
};

// Re-export Json para que los consumidores de extensions tengan acceso al
// mismo alias sin tener que importar de los tipos generados directamente.
export type { Json };
