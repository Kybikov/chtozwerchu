import { afterEach, expect, it, vi } from "vitest";
import { inspectMedia } from "./mediaProbe";

class AudioProbe extends EventTarget {
  duration = 30;
  readyState = 1;
  seeking = false;
  preload = "";
  muted = false;
  src = "";
  at = 0;
  seeks: number[] = [];
  get currentTime() {
    return this.at;
  }
  set currentTime(value: number) {
    this.at = value;
    this.seeks.push(value);
    this.seeking = true;
    this.readyState = 1;
  }
  load = vi.fn();
  play = vi.fn();
  removeAttribute = vi.fn(() => {
    this.src = "";
  });
  playable() {
    this.seeking = false;
    this.readyState = 4;
    this.dispatchEvent(new Event("seeked"));
    this.dispatchEvent(new Event("canplay"));
  }
}
afterEach(() => vi.useRealTimers());

it("requires data at both selected positions, without playing, and releases the decoder", async () => {
  const audio = new AudioProbe(),
    settled = vi.fn();
  const promise = inspectMedia("blob:fixture", new AbortController().signal, {
    create: () => audio as unknown as HTMLAudioElement,
    positions: (duration) => {
      expect(duration).toBe(30);
      return [3, 9.9];
    },
  }).then(settled);
  audio.dispatchEvent(new Event("loadedmetadata"));
  audio.dispatchEvent(new Event("canplay"));
  expect(settled).not.toHaveBeenCalled();
  expect(audio.seeks).toEqual([3]);
  audio.playable();
  expect(audio.seeks).toEqual([3, 9.9]);
  expect(audio.src).toBe("blob:fixture");
  audio.playable();
  await promise;
  expect(settled).toHaveBeenCalledWith(30);
  expect(audio.src).toBe("");
  expect(audio.load).toHaveBeenCalledTimes(2);
  expect(audio.play).not.toHaveBeenCalled();
  audio.dispatchEvent(new Event("error"));
  expect(audio.load).toHaveBeenCalledTimes(2);
});

it("rejects a fragment outside the actual media duration and keeps the calibration error", async () => {
  const audio = new AudioProbe();
  audio.duration = 6;
  const promise = inspectMedia("blob:short", new AbortController().signal, {
    create: () => audio as unknown as HTMLAudioElement,
    positions: () => {
      throw new Error("Рядок поза аудіо");
    },
  });
  const rejection = expect(promise).rejects.toThrow("Рядок поза аудіо");
  audio.dispatchEvent(new Event("loadedmetadata"));
  await rejection;
  expect(audio.seeks).toEqual([]);
  expect(audio.src).toBe("");
});

it("cancels during a seek, times out stalled media and releases invalid ranges", async () => {
  vi.useFakeTimers();
  for (const outcome of ["abort", "timeout", "error", "invalid"]) {
    const audio = new AudioProbe(),
      controller = new AbortController();
    const promise = inspectMedia("blob:fixture", controller.signal, {
      create: () => audio as unknown as HTMLAudioElement,
      positions: () => (outcome === "invalid" ? [Infinity] : [3, 9.9]),
    });
    const rejection = expect(promise).rejects.toThrow();
    audio.dispatchEvent(new Event("loadedmetadata"));
    if (outcome === "abort") controller.abort();
    else if (outcome === "timeout") await vi.advanceTimersByTimeAsync(12000);
    else if (outcome === "error") audio.dispatchEvent(new Event("error"));
    await rejection;
    expect(audio.src).toBe("");
    expect(audio.play).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  }
});
