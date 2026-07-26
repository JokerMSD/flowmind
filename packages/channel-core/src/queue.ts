export interface QueueOfferResult {
  readonly accepted: boolean;
  readonly size: number;
}

export interface MessageQueue<T> {
  readonly size: number;
  readonly capacity: number;
  start(): void;
  enqueue(item: T): QueueOfferResult;
  onIdle(): Promise<void>;
  stop(): Promise<void>;
}

export type QueueErrorHandler<T> = (error: unknown, item: T) => void | Promise<void>;
export type QueueWorker<T> = (item: T) => void | Promise<void>;
