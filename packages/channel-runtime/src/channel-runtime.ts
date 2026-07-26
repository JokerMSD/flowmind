import type {
  ChannelConnection,
  ChannelConnectionRepository,
  ChannelConnectionStatusEvent,
  InboundMessage,
  QueueErrorHandler,
} from "@flowmind/channel-core";
import type { ConversationProcessor } from "./conversation-processor.js";
import { BoundedQueue } from "./bounded-queue.js";
import type { ChannelProviderRegistry } from "./provider-registry.js";

export interface ChannelRuntimeOptions {
  readonly queueCapacity?: number;
  readonly queueConcurrency?: number;
  readonly onError?: QueueErrorHandler<InboundMessage>;
  readonly onDropped?: (message: InboundMessage) => void | Promise<void>;
}

export class ChannelRuntime {
  private readonly queue: BoundedQueue<InboundMessage>;
  private readonly activeConnections = new Map<string, ChannelConnection>();

  public constructor(
    private readonly connections: ChannelConnectionRepository,
    private readonly providers: ChannelProviderRegistry,
    processor: ConversationProcessor,
    private readonly options: ChannelRuntimeOptions = {},
  ) {
    this.queue = new BoundedQueue(
      async (message) => {
        await processor.process(message);
      },
      {
        capacity: options.queueCapacity ?? 100,
        concurrency: options.queueConcurrency ?? 1,
        ...(options.onError === undefined ? {} : { onError: options.onError }),
      },
    );
  }

  public async start(): Promise<void> {
    this.queue.start();
    for (const connection of await this.connections.list()) {
      if (!connection.enabled) continue;
      const provider = this.providers.resolve(connection.providerId);
      this.activeConnections.set(connection.id, connection);
      try {
        await provider.connect(connection, {
          onMessage: async (message) => {
            const offered = this.queue.enqueue(message);
            if (!offered.accepted) await this.options.onDropped?.(message);
          },
          onStatus: (event) => this.updateStatus(connection, event),
        });
      } catch (error) {
        this.activeConnections.delete(connection.id);
        throw error;
      }
    }
  }

  public async stop(): Promise<void> {
    await this.queue.stop();
    const connections = [...this.activeConnections.values()];
    this.activeConnections.clear();
    await Promise.all(
      connections.map(async (connection) => {
        await this.providers.resolve(connection.providerId).disconnect(connection.id);
      }),
    );
  }

  public onIdle(): Promise<void> {
    return this.queue.onIdle();
  }

  private async updateStatus(
    initial: ChannelConnection,
    event: ChannelConnectionStatusEvent,
  ): Promise<void> {
    const current =
      this.activeConnections.get(event.connectionId) ??
      (await this.connections.findById(event.connectionId)) ??
      initial;
    const next: ChannelConnection = {
      ...current,
      status: event.status,
      updatedAt: event.occurredAt,
    };
    await this.connections.save(next);
    this.activeConnections.set(next.id, next);
  }
}
