import type {
  Reminder,
  ReminderDeliveryProvider,
  ReminderOccurrence,
  ReminderOccurrenceRepository,
} from "@flowmind/agent-core";
import { WHATSAPP_CHANNEL_ID } from "@flowmind/channel-core";
import type {
  ChannelConnectionRepository,
  ChannelConversationRepository,
  ChannelProviderRegistry,
  ChannelSettingsRepository,
} from "@flowmind/channel-core";

export interface WhatsAppWebReminderDeliveryProviderDependencies {
  readonly connections: ChannelConnectionRepository;
  readonly conversations: ChannelConversationRepository;
  readonly settings: ChannelSettingsRepository;
  readonly providers: ChannelProviderRegistry;
  readonly occurrences: ReminderOccurrenceRepository;
  readonly now?: () => Date;
}

export class WhatsAppWebReminderDeliveryProvider implements ReminderDeliveryProvider {
  public readonly id = "whatsapp-web";
  private readonly now: () => Date;

  public constructor(
    private readonly dependencies: WhatsAppWebReminderDeliveryProviderDependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date());
  }

  public async deliver(occurrence: ReminderOccurrence, reminder: Reminder): Promise<void> {
    const target = reminder.target;
    if (!target || target.channelId !== WHATSAPP_CHANNEL_ID) {
      throw new Error("Reminder does not target WhatsApp.");
    }

    const [settings, connection, conversation] = await Promise.all([
      this.dependencies.settings.get(),
      this.dependencies.connections.findById(target.connectionId),
      this.dependencies.conversations.findById(target.conversationId),
    ]);
    if (!settings.enabled || settings.pauseAll) {
      throw new Error("WhatsApp reminders are disabled.");
    }
    if (
      !connection ||
      connection.channelId !== WHATSAPP_CHANNEL_ID ||
      !connection.enabled ||
      connection.status !== "connected"
    ) {
      throw new Error("WhatsApp connection is not available.");
    }
    if (
      !conversation ||
      conversation.channelId !== WHATSAPP_CHANNEL_ID ||
      conversation.connectionId !== connection.id ||
      conversation.automationMode === "blocked" ||
      (conversation.type === "group" && !settings.allowGroups)
    ) {
      throw new Error("WhatsApp conversation is not eligible for reminders.");
    }

    await this.dependencies.providers.resolve(connection.providerId).send({
      connectionId: connection.id,
      conversationAddress: {
        channelId: WHATSAPP_CHANNEL_ID,
        externalId: conversation.externalConversationId,
      },
      content: reminder.message,
    });
    await this.dependencies.occurrences.save({
      ...occurrence,
      status: "delivered",
      deliveredAt: this.now().toISOString(),
    });
  }
}
