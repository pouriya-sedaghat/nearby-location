export type LifecycleState = "starting" | "ready" | "draining" | "stopped";

export interface LifecycleSnapshot {
  state: LifecycleState;
  activeRequests: number;
  drainStartedAtMs: number | null;
  drainReason: string | null;
}

/**
 * Small process-lifecycle state machine kept dependency-free for deterministic
 * tests. Runtime wrappers are responsible for exporting metrics/logs.
 */
export class LifecycleController {
  private state: LifecycleState = "starting";
  private activeRequests = 0;
  private drainStartedAtMs: number | null = null;
  private drainReason: string | null = null;

  markReady(): boolean {
    if (this.state !== "starting") return false;
    this.state = "ready";
    return true;
  }

  startDraining(reason: string, nowMs = Date.now()): boolean {
    if (this.state === "draining" || this.state === "stopped") return false;
    this.state = "draining";
    this.drainStartedAtMs = nowMs;
    this.drainReason = reason;
    return true;
  }

  markStopped(): void {
    this.state = "stopped";
  }

  beginRequest(): () => void {
    this.activeRequests += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeRequests = Math.max(0, this.activeRequests - 1);
    };
  }

  isReady(): boolean {
    return this.state === "ready";
  }

  isDraining(): boolean {
    return this.state === "draining";
  }

  snapshot(): LifecycleSnapshot {
    return {
      state: this.state,
      activeRequests: this.activeRequests,
      drainStartedAtMs: this.drainStartedAtMs,
      drainReason: this.drainReason,
    };
  }
}
