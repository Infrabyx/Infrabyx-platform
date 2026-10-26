// Circuit breaker (IPB-01 §01.4.4.1, IPB-01-18; PL2-D-22). Opens after `failure_threshold`
// consecutive failures, or when the error rate over `window_seconds` reaches
// `error_rate_threshold` with at least `failure_threshold` calls in the window; half-opens after
// `open_seconds` and lets `half_open_max_calls` trial calls through. State is per replica (PL2-D-33).

export interface BreakerSettings {
  failure_threshold: number;
  error_rate_threshold: number;
  window_seconds: number;
  open_seconds: number;
  half_open_max_calls: number;
}

export const DEFAULT_BREAKER: Readonly<BreakerSettings> = Object.freeze({
  failure_threshold: 5,
  error_rate_threshold: 0.5,
  window_seconds: 60,
  open_seconds: 30,
  half_open_max_calls: 3,
});

export type BreakerState = "closed" | "open" | "half_open";
export type BreakerTransition = "opened" | "half_opened" | "closed";

export class CircuitBreaker {
  private st: BreakerState = "closed";
  private consecutive = 0;
  private outcomes: Array<{ at: number; ok: boolean }> = [];
  private openedAt = 0;
  private trials = 0;
  readonly settings: BreakerSettings;

  constructor(
    settings: Partial<BreakerSettings> = {},
    private readonly now: () => number = Date.now,
  ) {
    this.settings = { ...DEFAULT_BREAKER, ...settings };
  }

  get state(): BreakerState {
    if (this.st === "open" && this.now() - this.openedAt >= this.settings.open_seconds * 1000) {
      this.st = "half_open";
      this.trials = 0;
    }
    return this.st;
  }

  /** Whether a call may go to this adapter now; counts a half-open trial when it may. */
  tryPass(): boolean {
    const s = this.state;
    if (s === "closed") return true;
    if (s === "open") return false;
    if (this.trials >= this.settings.half_open_max_calls) return false;
    this.trials++;
    return true;
  }

  onSuccess(): BreakerTransition | undefined {
    this.record(true);
    this.consecutive = 0;
    if (this.st === "half_open") {
      this.st = "closed";
      this.outcomes = [];
      return "closed";
    }
    return undefined;
  }

  onFailure(): BreakerTransition | undefined {
    this.record(false);
    this.consecutive++;
    if (this.st === "half_open") return this.open();
    if (this.st === "closed") {
      const n = this.outcomes.length;
      const failed = this.outcomes.filter((o) => !o.ok).length;
      if (
        this.consecutive >= this.settings.failure_threshold ||
        (n >= this.settings.failure_threshold && failed / n >= this.settings.error_rate_threshold)
      )
        return this.open();
    }
    return undefined;
  }

  private open(): BreakerTransition {
    this.st = "open";
    this.openedAt = this.now();
    this.trials = 0;
    return "opened";
  }

  private record(ok: boolean): void {
    const at = this.now();
    const from = at - this.settings.window_seconds * 1000;
    this.outcomes = this.outcomes.filter((o) => o.at > from);
    this.outcomes.push({ at, ok });
  }
}
