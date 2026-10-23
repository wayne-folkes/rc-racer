// Tells when a screen has been left alone long enough to get out of the way. Times are in seconds, from
// any steady clock, so a tab that was busy or throttled still counts the real time that passed.

export class IdleWatch {
  private lastActivity = 0;
  private away = false;

  constructor(private readonly limit: number) {}

  /** Somebody did something. Returns true if the screen was away, so the caller can treat that input as waking it only. */
  poke(now: number): boolean {
    const wasAway = this.away;
    this.lastActivity = now;
    this.away = false;
    return wasAway;
  }

  /** True once nothing has happened for the limit. While `watching` is false the clock starts over and the screen is back. */
  update(now: number, watching: boolean): boolean {
    if (!watching) {
      this.lastActivity = now;
      this.away = false;
    } else if (now - this.lastActivity >= this.limit) {
      this.away = true;
    }
    return this.away;
  }
}
