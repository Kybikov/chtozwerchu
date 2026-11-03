import { useState } from "react";
import { Check, Headphones, Pause, Play, Scissors } from "lucide-react";
import { Button, Modal } from "./ui";
import WakeSlider from "./react-bits/WakeSlider";
import ClipLengthControl from "./ClipLengthControl";
import { clipLength, roundClip } from "../lib/roundClip";
import { useAudioExcerpt } from "../lib/useAudioExcerpt";
import { preciseTime } from "../lib/wordTiming";
import type { Cue } from "../lib/music";
import type { usePlayer } from "../lib/usePlayer";

export default function RoundClipEditor({
  cue,
  offset,
  seconds,
  player,
  onSave,
  onClose,
}: {
  cue: Cue;
  offset: number;
  seconds: unknown;
  player: ReturnType<typeof usePlayer>;
  onSave: (seconds: number) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(clipLength(seconds));
  const excerpt = useAudioExcerpt(player, `${draft}:${offset}:${cue.startMs}`);
  const range = roundClip(cue, offset, player.duration, draft);
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Задай темп раунду"
      description="Обери довжину музичного фрагмента й перевір, де музика стихне. Перевірка не запускає раунд і не розкриває відповідь на сцені."
      wide
    >
      <div className="round-clip-editor">
        <ClipLengthControl value={draft} onChange={setDraft} />
        {range ? (
          <div className="round-clip-player">
            <div className="round-clip-heading">
              <span>
                <Headphones size={19} /> ПЕРЕВІРКА ФРАГМЕНТА
              </span>
              <strong>
                {Number(range.seconds.toFixed(1))} <small>с</small>
              </strong>
            </div>
            <div className="round-clip-boundaries">
              <span>
                Початок <time>{preciseTime(range.start * 1000)}</time>
              </span>
              <span>
                Музика стихне <time>{preciseTime(range.end * 1000)}</time>
              </span>
            </div>
            <WakeSlider
              value={Math.min(
                range.end,
                Math.max(range.start, player.position),
              )}
              min={range.start}
              max={range.end}
              step={0.01}
              onChange={(position) => {
                excerpt.stop();
                player.seek(position);
              }}
              bars={80}
              gap={2}
              height={64}
              restHeight={12}
              fillColor="#d7b7ff"
              trackColor="#3d304e"
              ariaLabel="Позиція у фрагменті раунду"
              formatValue={(value) => preciseTime(value * 1000)}
              disabled={!player.ready}
            />
            <Button
              variant="primary"
              aria-label={
                excerpt.active === null
                  ? "Прослухати фрагмент"
                  : "Зупинити фрагмент"
              }
              disabled={!player.ready}
              onClick={() => void excerpt.play(0, range)}
            >
              {excerpt.active === null ? (
                <Play size={19} />
              ) : (
                <Pause size={19} />
              )}
              {excerpt.active === null ? "Прослухати" : "Зупинити"}
            </Button>
            {range.seconds < draft && (
              <p className="round-clip-note">
                До цього рядка є лише {Number(range.seconds.toFixed(1))} с
                аудіо. Фрагмент почнеться з початку файлу.
              </p>
            )}
          </div>
        ) : (
          <p className="round-clip-note">
            Цей рядок поза межами аудіо. Повернись до прив’язки або обери іншу
            відповідь.
          </p>
        )}
        <div className="round-clip-answer">
          <span>
            <Scissors size={18} /> ТУТ ПРОДОВЖИТЬ КОМАНДА
          </span>
          <p>{cue.text}</p>
        </div>
        <div className="round-clip-footer">
          <Button variant="ghost" onClick={onClose}>
            Скасувати
          </Button>
          <Button
            variant="primary"
            disabled={!range}
            onClick={() => {
              excerpt.stop();
              onSave(draft);
            }}
          >
            <Check size={18} /> Застосувати
          </Button>
        </div>
      </div>
    </Modal>
  );
}
