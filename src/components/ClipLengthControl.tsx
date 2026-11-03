import { Button } from "./ui";
import { clipLength, clipLengths } from "../lib/roundClip";
import "../round-clip.css";

export default function ClipLengthControl({
  value,
  onChange,
  disabled = false,
}: {
  value: unknown;
  onChange: (seconds: number) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="clip-length" disabled={disabled}>
      <legend>СКІЛЬКИ МУЗИКИ ДО ВІДПОВІДІ</legend>
      <div>
        {clipLengths.map((seconds) => (
          <Button
            key={seconds}
            className={clipLength(value) === seconds ? "selected" : ""}
            aria-pressed={clipLength(value) === seconds}
            aria-label={`Фрагмент ${seconds} секунд`}
            onClick={() => onChange(seconds)}
          >
            {seconds} с
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
