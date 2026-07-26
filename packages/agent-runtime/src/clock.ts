import type { Clock } from "@flowmind/agent-core";

export class SystemClock implements Clock {
  public now(): Date { return new Date(); }
}

export class FixedClock implements Clock {
  public constructor(private current: Date) {}
  public now(): Date { return new Date(this.current); }
  public set(value: Date): void { this.current = new Date(value); }
}
