import { InvalidQueueOptionsError } from "@flowmind/channel-core";
import type {
  MessageQueue,
  QueueErrorHandler,
  QueueOfferResult,
  QueueWorker,
} from "@flowmind/channel-core";

export interface BoundedQueueOptions<T> {
  readonly capacity: number;
  readonly concurrency?: number;
  readonly onError?: QueueErrorHandler<T>;
}

export class BoundedQueue<T> implements MessageQueue<T> {
  private readonly pending: T[] = [];
  private readonly concurrency: number;
  private readonly onError: QueueErrorHandler<T> | undefined;
  private readonly idleWaiters = new Set<() => void>();
  private active = 0;
  private accepting = false;
  private started = false;

  public readonly capacity: number;

  public constructor(
    private readonly worker: QueueWorker<T>,
    options: BoundedQueueOptions<T>,
  ) {
    if (!Number.isInteger(options.capacity) || options.capacity < 1) {
      throw new InvalidQueueOptionsError("Queue capacity must be a positive integer");
    }
    const concurrency = options.concurrency ?? 1;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > options.capacity) {
      throw new InvalidQueueOptionsError(
        "Queue concurrency must be a positive integer within capacity",
      );
    }
    this.capacity = options.capacity;
    this.concurrency = concurrency;
    this.onError = options.onError;
  }

  public get size(): number {
    return this.pending.length + this.active;
  }

  public start(): void {
    if (this.started) return;
    this.started = true;
    this.accepting = true;
    this.pump();
  }

  public enqueue(item: T): QueueOfferResult {
    if (!this.accepting || this.size >= this.capacity) {
      return { accepted: false, size: this.size };
    }
    this.pending.push(item);
    this.pump();
    return { accepted: true, size: this.size };
  }

  public onIdle(): Promise<void> {
    if (this.size === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.idleWaiters.add(resolve);
    });
  }

  public async stop(): Promise<void> {
    this.accepting = false;
    await this.onIdle();
  }

  private pump(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const item = this.pending.shift() as T;
      this.active += 1;
      void this.run(item);
    }
  }

  private async run(item: T): Promise<void> {
    try {
      await this.worker(item);
    } catch (error) {
      try {
        await this.onError?.(error, item);
      } catch {
        // Error reporting must not poison the queue.
      }
    } finally {
      this.active -= 1;
      this.pump();
      if (this.size === 0) {
        for (const resolve of this.idleWaiters) resolve();
        this.idleWaiters.clear();
      }
    }
  }
}
