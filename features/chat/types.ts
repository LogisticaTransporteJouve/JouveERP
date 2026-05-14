export type ChannelKind = "self" | "dm" | "group";

export type ChannelListItem = {
  id: string;
  kind: ChannelKind;
  display_name: string;
  other_user_id: string | null;
  avatar_path: string | null;
  avatar_color: string | null;
  avatar_url: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_sender_id: string | null;
  unread_count: number;
  is_muted: boolean;
  member_count: number;
};

export type ChannelHeader = {
  id: string;
  kind: ChannelKind;
  name: string | null;
  description: string | null;
  created_by: string;
  created_at: string;
  display_name: string;
  members: ChannelMember[];
};

export type ChannelMember = {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  avatar_path: string | null;
  avatar_color: string | null;
  avatar_url: string | null;
  role: "member" | "admin";
};

export type Message = {
  id: string;
  channel_id: string;
  sender_id: string;
  sender_first_name: string | null;
  sender_last_name: string | null;
  sender_email: string | null;
  sender_avatar_path: string | null;
  sender_avatar_color: string | null;
  sender_avatar_url: string | null;
  reply_to_message_id: string | null;
  reply_to_body: string | null;
  reply_to_sender_first_name: string | null;
  reply_to_sender_last_name: string | null;
  reply_to_sender_email: string | null;
  reply_to_deleted: boolean;
  body: string;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

export type MessagesPage = {
  messages: Message[];
  nextCursor: string | null; // ISO timestamp del mensaje más viejo de esta página
};

export type Reaction = {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

export type AssignableUser = {
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  avatar_path: string | null;
  avatar_color: string | null;
  avatar_url: string | null;
};
