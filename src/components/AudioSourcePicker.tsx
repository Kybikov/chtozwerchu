import { Disc3, LoaderCircle, Upload } from "lucide-react";
import { Button } from "./ui";
import "../audio-source.css";

export default function AudioSourcePicker({
  local,
  ownFile,
  busy,
  disabled,
  previewReady,
  error,
  onPreview,
  onLocal,
  onUpload,
}: {
  local: boolean;
  ownFile?: Blob;
  busy: boolean;
  disabled: boolean;
  previewReady: boolean;
  error: string;
  onPreview: () => void;
  onLocal: () => void;
  onUpload: () => void;
}) {
  const filename = ownFile instanceof File ? ownFile.name : "Власний аудіофайл";
  return (
    <div className="audio-source">
      <div
        className="source-options"
        role="group"
        aria-label="Джерело музики"
        aria-busy={busy}
      >
        <Button
          className={!local ? "selected" : ""}
          aria-pressed={!local}
          disabled={disabled || busy || (!local && previewReady)}
          onClick={onPreview}
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Disc3 size={16} />
          )}
          {busy ? "Чекай…" : "Прев’ю"}
        </Button>
        <Button
          className={local ? "selected" : ""}
          aria-pressed={local}
          disabled={disabled || busy || (local && !!ownFile)}
          onClick={ownFile ? onLocal : onUpload}
        >
          <Upload size={16} />
          {ownFile ? "Мій файл" : "Додати файл"}
        </Button>
      </div>
      {ownFile ? (
        <div className="audio-source-file">
          <div>
            <strong>{filename}</strong>
            <span>
              {local
                ? "Зараз звучатиме · з цього пристрою"
                : "Збережений на пристрої · можна повернутися"}
            </span>
          </div>
          <Button
            variant="ghost"
            className="icon-button"
            aria-label="Замінити власний аудіофайл"
            disabled={disabled || busy}
            onClick={onUpload}
          >
            <Upload size={18} />
          </Button>
        </div>
      ) : (
        <p className="audio-source-note">
          Прев’ю Deezer · до 30 секунд · потрібна мережа
        </p>
      )}
      {error && (
        <p className="audio-source-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
