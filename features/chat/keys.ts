export const chatKeys = {
  all: ["chat"] as const,
  channels: () => [...chatKeys.all, "channels"] as const,
  channel: (id: string) => [...chatKeys.all, "channel", id] as const,
  messages: (channelId: string) =>
    [...chatKeys.all, "messages", channelId] as const,
  reactions: (channelId: string) =>
    [...chatKeys.all, "reactions", channelId] as const,
  assignableUsers: () => [...chatKeys.all, "assignable-users"] as const,
};

export const CHAT_MESSAGES_PAGE_SIZE = 50;
