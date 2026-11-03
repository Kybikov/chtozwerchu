// Media events can be queued before pause() or load(). Read the current
// element instead of treating a delayed event name as its present state.
export function watchMediaPlayback(
  audio: Pick<
    HTMLAudioElement,
    "paused" | "ended" | "error" | "addEventListener" | "removeEventListener"
  >,
  onChange: (playing: boolean) => void,
) {
  const update = () => onChange(!audio.paused && !audio.ended && !audio.error);
  const events = [
    "play",
    "playing",
    "pause",
    "ended",
    "emptied",
    "abort",
    "error",
  ];
  for (const event of events) audio.addEventListener(event, update);
  update();
  return () => {
    for (const event of events) audio.removeEventListener(event, update);
  };
}
