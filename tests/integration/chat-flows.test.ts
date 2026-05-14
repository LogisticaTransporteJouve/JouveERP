import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanupOrphanTestUsers,
  createTestUser,
  deleteTestUser,
  makeServiceClient,
  RUN_INTEGRATION,
  type TestUser,
} from "./_setup";

// Integration suite gated por RUN_INTEGRATION=1. Requiere supabase local
// corriendo. Corre con: `RUN_INTEGRATION=1 pnpm test`.

describe.skipIf(!RUN_INTEGRATION)("chat — RPCs y triggers contra Supabase local", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  beforeAll(async () => {
    await cleanupOrphanTestUsers();
    alice = await createTestUser("alice");
    bob = await createTestUser("bob");
    carol = await createTestUser("carol");
  }, 60_000);

  afterAll(async () => {
    await Promise.all([
      deleteTestUser(alice.id),
      deleteTestUser(bob.id),
      deleteTestUser(carol.id),
    ]);
  });

  it("get_or_create_self_channel es idempotente", async () => {
    const { data: first } = await alice.client.rpc("get_or_create_self_channel");
    const { data: second } = await alice.client.rpc("get_or_create_self_channel");
    expect(first).toBeTruthy();
    expect(first).toBe(second);
  });

  it("open_or_create_dm es idempotente y simétrico", async () => {
    const { data: ab } = await alice.client.rpc("open_or_create_dm", {
      p_other: bob.id,
    });
    const { data: ba } = await bob.client.rpc("open_or_create_dm", {
      p_other: alice.id,
    });
    expect(ab).toBeTruthy();
    expect(ab).toBe(ba);
  });

  it("RLS: bob no ve mensajes del self channel de alice", async () => {
    const { data: aliceSelf } = await alice.client.rpc(
      "get_or_create_self_channel",
    );
    await alice.client.from("chat_messages").insert({
      channel_id: aliceSelf,
      sender_id: alice.id,
      body: "nota privada",
    });
    const { data: bobsView } = await bob.client
      .from("chat_messages")
      .select("id")
      .eq("channel_id", aliceSelf);
    expect(bobsView ?? []).toHaveLength(0);
  });

  it("insertar mensaje genera notif a los otros miembros (no al sender)", async () => {
    const { data: dmId } = await alice.client.rpc("open_or_create_dm", {
      p_other: bob.id,
    });
    const service = makeServiceClient();
    const before = await service
      .from("notifications")
      .select("id, type, recipient_id, metadata")
      .eq("recipient_id", bob.id);
    const beforeCount = before.data?.length ?? 0;

    await alice.client.from("chat_messages").insert({
      channel_id: dmId,
      sender_id: alice.id,
      body: "hola bob",
    });

    // Esperar a que el trigger termine. Triggers son síncronos sobre
    // la transacción del INSERT así que ya deberían existir.
    const after = await service
      .from("notifications")
      .select("id, type, recipient_id, metadata")
      .eq("recipient_id", bob.id);
    const newNotifs = (after.data ?? []).slice(beforeCount);
    expect(newNotifs.length).toBeGreaterThanOrEqual(1);
    expect(newNotifs.find((n) => n.type === "chat_message")).toBeTruthy();
  });

  it("mention dedupe: mention reemplaza chat_message del mismo mensaje", async () => {
    const { data: groupId } = await alice.client.rpc("create_chat_group", {
      p_name: "Logística",
      p_description: null,
      p_member_ids: [bob.id, carol.id],
    });
    const service = makeServiceClient();

    const { data: msg } = await alice.client
      .from("chat_messages")
      .insert({
        channel_id: groupId,
        sender_id: alice.id,
        body: "@Bob mirá esto",
      })
      .select("id")
      .single();
    expect(msg).toBeTruthy();

    // Hasta acá bob debería tener chat_message.
    const beforeMention = await service
      .from("notifications")
      .select("id, type")
      .eq("recipient_id", bob.id)
      .eq("metadata->>message_id", msg!.id);
    expect(
      beforeMention.data?.some((n) => n.type === "chat_message"),
    ).toBe(true);

    // Insertar mention → trigger borra el chat_message y crea
    // chat_mention.
    await alice.client.from("chat_message_mentions").insert({
      message_id: msg!.id,
      user_id: bob.id,
    });

    const afterMention = await service
      .from("notifications")
      .select("id, type")
      .eq("recipient_id", bob.id)
      .eq("metadata->>message_id", msg!.id);
    expect(afterMention.data?.some((n) => n.type === "chat_message")).toBe(false);
    expect(afterMention.data?.some((n) => n.type === "chat_mention")).toBe(true);
  });

  it("solo-admin que se va auto-promueve al miembro más viejo", async () => {
    const { data: groupId } = await alice.client.rpc("create_chat_group", {
      p_name: "Operaciones",
      p_description: null,
      p_member_ids: [bob.id, carol.id],
    });
    const service = makeServiceClient();

    // Alice (admin) sale del grupo.
    await alice.client
      .from("chat_channel_members")
      .delete()
      .eq("channel_id", groupId)
      .eq("user_id", alice.id);

    const { data: members } = await service
      .from("chat_channel_members")
      .select("user_id, role")
      .eq("channel_id", groupId);

    expect(members?.find((m) => m.role === "admin")).toBeTruthy();
  });

  it("mark_chat_channel_read marca también las notifs del canal", async () => {
    const { data: dmId } = await alice.client.rpc("open_or_create_dm", {
      p_other: bob.id,
    });
    await alice.client.from("chat_messages").insert({
      channel_id: dmId,
      sender_id: alice.id,
      body: "uno mas",
    });

    const service = makeServiceClient();
    const unreadBefore = await service
      .from("notifications")
      .select("id")
      .eq("recipient_id", bob.id)
      .is("read_at", null);
    expect((unreadBefore.data?.length ?? 0)).toBeGreaterThan(0);

    await bob.client.rpc("mark_chat_channel_read", { p_channel: dmId });

    const unreadAfter = await service
      .from("notifications")
      .select("id, metadata, read_at")
      .eq("recipient_id", bob.id)
      .is("read_at", null)
      .eq("metadata->>channel_id", dmId);
    expect(unreadAfter.data ?? []).toHaveLength(0);
  });

  it("RLS: alguien que no es miembro no puede insertar mensajes", async () => {
    const { data: groupId } = await alice.client.rpc("create_chat_group", {
      p_name: "Privado AB",
      p_description: null,
      p_member_ids: [bob.id],
    });

    // Carol no fue agregada al grupo.
    const { error } = await carol.client.from("chat_messages").insert({
      channel_id: groupId,
      sender_id: carol.id,
      body: "no debería poder",
    });
    expect(error).toBeTruthy();
  });

  it("muted member no recibe notif", async () => {
    const { data: groupId } = await alice.client.rpc("create_chat_group", {
      p_name: "Silencio",
      p_description: null,
      p_member_ids: [bob.id],
    });

    // Bob mutea el canal.
    await bob.client
      .from("chat_channel_members")
      .update({ is_muted: true })
      .eq("channel_id", groupId)
      .eq("user_id", bob.id);

    const service = makeServiceClient();
    const before = await service
      .from("notifications")
      .select("id")
      .eq("recipient_id", bob.id);
    const beforeCount = before.data?.length ?? 0;

    await alice.client.from("chat_messages").insert({
      channel_id: groupId,
      sender_id: alice.id,
      body: "deberia silenciarse",
    });

    const after = await service
      .from("notifications")
      .select("id")
      .eq("recipient_id", bob.id);
    expect(after.data?.length).toBe(beforeCount);
  });
});
