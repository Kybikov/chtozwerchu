import { expect, it } from "vitest";
import { watchMediaPlayback } from "./mediaPlayback";

class Media extends EventTarget {
  paused = true;
  ended = false;
  error: MediaError | null = null;
}

it("does not treat a queued play event as playback after the unlock clip was reset", () => {
  const media = new Media(),
    states: boolean[] = [];
  const stop = watchMediaPlayback(media, (playing) => states.push(playing));
  media.paused = false;
  media.dispatchEvent(new Event("play"));
  media.paused = true;
  media.dispatchEvent(new Event("emptied"));
  media.dispatchEvent(new Event("play"));
  expect(states).toEqual([false, true, false, false]);
  stop();
  media.paused = false;
  media.dispatchEvent(new Event("play"));
  expect(states).toHaveLength(4);
});

it("reads current playback for delayed pause, ended and failed media", () => {
  const media = new Media(),
    states: boolean[] = [];
  const stop = watchMediaPlayback(media, (playing) => states.push(playing));
  media.paused = false;
  media.dispatchEvent(new Event("pause"));
  expect(states.at(-1)).toBe(true);
  media.ended = true;
  media.dispatchEvent(new Event("ended"));
  expect(states.at(-1)).toBe(false);
  media.ended = false;
  media.error = { code: 3 } as MediaError;
  media.dispatchEvent(new Event("error"));
  expect(states.at(-1)).toBe(false);
  media.error = null;
  media.dispatchEvent(new Event("playing"));
  expect(states.at(-1)).toBe(true);
  media.paused = true;
  media.dispatchEvent(new Event("abort"));
  expect(states.at(-1)).toBe(false);
  stop();
});
