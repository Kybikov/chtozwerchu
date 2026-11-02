// A presentation clock. It follows server samples using monotonic elapsed time,
// then freezes on a known disconnect until a new authoritative sample arrives.
export class RoomClock {
  private sample = 0;
  private sampledAt = 0;
  private running = false;

  sync(serverTime: number, monotonicTime: number) {
    if (!Number.isFinite(serverTime) || !Number.isFinite(monotonicTime)) return;
    this.sample = serverTime;
    this.sampledAt = monotonicTime;
    this.running = true;
  }

  read(monotonicTime: number) {
    return (
      this.sample +
      (this.running ? Math.max(0, monotonicTime - this.sampledAt) : 0)
    );
  }

  freeze(monotonicTime: number) {
    this.sample = this.read(monotonicTime);
    this.sampledAt = monotonicTime;
    this.running = false;
  }
}
