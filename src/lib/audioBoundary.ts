type BoundaryAudio = {
  readonly currentTime: number;
  readonly paused: boolean;
  readonly ended: boolean;
  pause: () => void;
  addEventListener: (event: string, listener: () => void) => void;
  removeEventListener: (event: string, listener: () => void) => void;
};
export type BoundaryFrames = {
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
};

// A media boundary must read the audio clock, not the slower transport display.
// Frame checks run only during playback; media events also cover paused seeks.
export function watchAudioBoundary(
  audio: BoundaryAudio,
  end: number,
  onReached: () => void,
  frames: BoundaryFrames = {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (id) => cancelAnimationFrame(id),
  },
) {
  if (!Number.isFinite(end) || end <= 0) return () => {};
  let frame: number | null = null,
    waiting = false,
    settled = false,
    disposed = false;
  const stop = () => {
    if (frame !== null) frames.cancel(frame);
    frame = null;
  };
  const check = () => {
    if (disposed || settled) return;
    if (audio.currentTime >= end) {
      settled = true;
      stop();
      audio.pause();
      onReached();
      return;
    }
    if (!audio.paused && !audio.ended && !waiting && frame === null)
      frame = frames.request(tick);
  };
  const tick = () => {
    frame = null;
    check();
  };
  const resume = () => {
    waiting = false;
    check();
  };
  const pause = () => {
    stop();
    check();
  };
  const buffer = () => {
    waiting = true;
    stop();
  };
  const fail = () => {
    settled = true;
    stop();
  };
  const events: [string, () => void][] = [
    ["play", resume],
    ["playing", resume],
    ["pause", pause],
    ["waiting", buffer],
    ["seeked", check],
    ["timeupdate", check],
    ["ended", pause],
    ["error", fail],
  ];
  for (const [event, listener] of events)
    audio.addEventListener(event, listener);
  check();
  return () => {
    disposed = true;
    stop();
    for (const [event, listener] of events)
      audio.removeEventListener(event, listener);
  };
}
