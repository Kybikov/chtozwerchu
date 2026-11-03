import { describe, expect, it, vi } from "vitest";
import { watchAudioBoundary, type BoundaryFrames } from "./audioBoundary";

class AudioFixture {
  currentTime = 0;
  paused = true;
  ended = false;
  listeners = new Map<string, Set<() => void>>();
  pause = vi.fn(() => {
    this.paused = true;
    this.emit("pause");
  });
  addEventListener(event: string, listener: () => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }
  removeEventListener(event: string, listener: () => void) {
    this.listeners.get(event)?.delete(listener);
  }
  emit(event: string) {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
  play() {
    this.paused = false;
    this.emit("play");
    this.emit("playing");
  }
}

function fixture() {
  const audio = new AudioFixture(),
    reached = vi.fn();
  let next = 0;
  const pending = new Map<number, FrameRequestCallback>();
  const frames: BoundaryFrames = {
    request: (callback) => {
      pending.set(++next, callback);
      return next;
    },
    cancel: (id) => {
      pending.delete(id);
    },
  };
  const tick = () => {
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks) callback(0);
  };
  return { audio, reached, pending, frames, tick };
}

describe("audio-clock cutoff", () => {
  it("stops at the real audio position even when the UI sample has not advanced", () => {
    const f = fixture();
    f.audio.play();
    const dispose = watchAudioBoundary(f.audio, 10, f.reached, f.frames);
    f.audio.currentTime = 9.999;
    f.tick();
    expect(f.reached).not.toHaveBeenCalled();
    f.audio.currentTime = 10.004;
    f.tick();
    expect(f.audio.paused).toBe(true);
    expect(f.reached).toHaveBeenCalledTimes(1);
    expect(f.pending.size).toBe(0);
    f.audio.emit("timeupdate");
    f.audio.emit("seeked");
    f.tick();
    expect(f.reached).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("does no frame work while paused, then follows pause and resume", () => {
    const f = fixture();
    const dispose = watchAudioBoundary(f.audio, 10, f.reached, f.frames);
    expect(f.pending.size).toBe(0);
    f.audio.play();
    expect(f.pending.size).toBe(1);
    f.audio.currentTime = 4;
    f.audio.pause();
    expect(f.pending.size).toBe(0);
    f.tick();
    expect(f.reached).not.toHaveBeenCalled();
    f.audio.play();
    f.audio.currentTime = 10;
    f.tick();
    expect(f.reached).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("resolves a seek past the answer even when playback is paused", () => {
    const f = fixture();
    const dispose = watchAudioBoundary(f.audio, 10, f.reached, f.frames);
    f.audio.currentTime = 11;
    f.audio.emit("seeked");
    expect(f.reached).toHaveBeenCalledTimes(1);
    expect(f.pending.size).toBe(0);
    dispose();
  });

  it("waits for buffered audio to resume instead of advancing by elapsed wall time", () => {
    const f = fixture();
    f.audio.play();
    const dispose = watchAudioBoundary(f.audio, 10, f.reached, f.frames);
    f.audio.currentTime = 2;
    f.audio.emit("waiting");
    expect(f.pending.size).toBe(0);
    f.tick();
    expect(f.reached).not.toHaveBeenCalled();
    f.audio.emit("playing");
    expect(f.pending.size).toBe(1);
    f.tick();
    expect(f.reached).not.toHaveBeenCalled();
    f.audio.currentTime = 10;
    f.tick();
    expect(f.reached).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("keeps checking buffered playback when network fetching stalls", () => {
    const f = fixture();
    f.audio.play();
    const dispose = watchAudioBoundary(f.audio, 10, f.reached, f.frames);
    f.audio.emit("stalled");
    f.audio.currentTime = 10;
    f.tick();
    expect(f.reached).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("cancels old work and ignores a frame already queued during cleanup", () => {
    const f = fixture();
    f.audio.play();
    const dispose = watchAudioBoundary(f.audio, 10, f.reached, f.frames);
    const queued = [...f.pending.values()][0];
    dispose();
    f.audio.currentTime = 12;
    queued(0);
    f.audio.emit("timeupdate");
    expect(f.reached).not.toHaveBeenCalled();
    expect(f.audio.pause).not.toHaveBeenCalled();
    expect(f.pending.size).toBe(0);
    expect([...f.audio.listeners.values()].every((set) => set.size === 0)).toBe(
      true,
    );
  });

  it("a replaced target cannot stop the next round at the old boundary", () => {
    const f = fixture();
    f.audio.play();
    watchAudioBoundary(f.audio, 10, f.reached, f.frames)();
    const dispose = watchAudioBoundary(f.audio, 20, f.reached, f.frames);
    f.audio.currentTime = 15;
    f.audio.emit("seeked");
    f.tick();
    expect(f.reached).not.toHaveBeenCalled();
    f.audio.currentTime = 20;
    f.tick();
    expect(f.reached).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("ignores invalid boundaries without changing audio", () => {
    for (const end of [0, -1, NaN, Infinity]) {
      const f = fixture();
      f.audio.play();
      watchAudioBoundary(f.audio, end, f.reached, f.frames)();
      expect(f.pending.size).toBe(0);
      expect(f.audio.pause).not.toHaveBeenCalled();
      expect(f.audio.listeners.size).toBe(0);
    }
  });

  it("stops monitoring after a media failure without inventing an answer", () => {
    const f = fixture();
    f.audio.play();
    const dispose = watchAudioBoundary(f.audio, 10, f.reached, f.frames);
    f.audio.emit("error");
    expect(f.pending.size).toBe(0);
    f.audio.currentTime = 12;
    f.audio.emit("timeupdate");
    f.audio.emit("playing");
    expect(f.reached).not.toHaveBeenCalled();
    expect(f.pending.size).toBe(0);
    dispose();
  });
});
