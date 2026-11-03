import {
  Children,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Check,
  Download,
  LoaderCircle,
  Package,
  Upload,
} from "lucide-react";
import { Button, Modal, Panel } from "./ui";
import { validProgramme, type Programme } from "../lib/programme";
import {
  readPreparedCollection,
  importPreparedBatch,
  type PreparedSong,
} from "../lib/preparedSongs";
import {
  buildShowPack,
  readShowPack,
  packFilename,
  type ShowPack,
  type PackProgress,
} from "../lib/showPack";
import "../show-pack.css";

const plurals = new Intl.PluralRules("uk");
const songCount = (count: number, accusative = false) => {
  const form = plurals.select(count);
  return `${count} ${form === "one" ? (accusative ? "пісню" : "пісня") : form === "few" ? "пісні" : "пісень"}`;
};
const size = (bytes: number) =>
  bytes >= 1_000_000
    ? `${new Intl.NumberFormat("uk", { maximumFractionDigits: 1 }).format(bytes / 1_000_000)} МБ`
    : `${Math.ceil(bytes / 1000)} КБ`;
const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && !(error instanceof DOMException)
    ? error.message
    : fallback;
function PackColumns({
  children,
  importFirst,
  reviewing,
}: {
  children: ReactNode;
  importFirst: boolean;
  reviewing: boolean;
}) {
  const sections = Children.toArray(children);
  return (
    <div className={`pack-columns ${reviewing ? "pack-columns-review" : ""}`}>
      {reviewing ? sections[1] : importFirst ? sections.reverse() : sections}
    </div>
  );
}
export default function ShowPackDialog({
  programme,
  allowed,
  onClose,
  onImported,
  onProgramme,
}: {
  programme: Programme;
  allowed: boolean;
  onClose: () => void;
  onImported: (songs: PreparedSong[], programme?: Programme) => Promise<void>;
  onProgramme: () => void;
}) {
  const [existing, setExisting] = useState<PreparedSong[] | null>(null);
  const [mode, setMode] = useState<"programme" | "library">("programme");
  const [parsed, setParsed] = useState<ShowPack | null>(null);
  const [busy, setBusy] = useState<"export" | "check" | "import" | null>(null);
  const [progress, setProgress] = useState<PackProgress | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [imported, setImported] = useState(false);
  const [hasOrder, setHasOrder] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    operation = useRef<AbortController | null>(null);
  useEffect(() => {
    let live = true;
    readPreparedCollection()
      .then((value) => {
        if (live) setExisting(value);
      })
      .catch(() => {
        if (live)
          setError(
            "Не вдалося прочитати бібліотеку. Закрий пакет і спробуй ще раз.",
          );
      });
    return () => {
      live = false;
      operation.current?.abort();
    };
  }, []);
  const hasProgramme =
    validProgramme(programme) &&
    programme.trackIds.every((id) =>
      existing?.some((song) => song.track.id === id),
    );
  const selectedMode =
    hasProgramme && mode === "programme" ? "programme" : "library";
  const songs =
    selectedMode === "programme"
      ? programme.trackIds.map((id) =>
          existing!.find((song) => song.track.id === id)!,
        )
      : (existing ?? []);
  const localCount = songs.filter((song) => song.file).length;
  const conflicts =
    parsed?.songs.filter((song) =>
      existing?.some((current) => current.track.id === song.track.id),
    ) ?? [];
  const close = () => {
    if (busy === "import") return;
    operation.current?.abort();
    onClose();
  };
  const begin = (kind: "export" | "check") => {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(kind);
    setProgress(null);
    setError("");
    setNotice("");
    if (kind === "check") setImported(false);
    return controller;
  };
  const finish = (controller: AbortController) => {
    if (operation.current === controller) {
      operation.current = null;
      setBusy(null);
    }
  };
  const exportPack = async () => {
    if (busy || !allowed || !songs.length) return;
    const controller = begin("export");
    try {
      const blob = await buildShowPack(
        { songs, ...(hasProgramme ? { programme } : {}) },
        controller.signal,
        (value) => {
          if (!controller.signal.aborted) setProgress(value);
        },
      );
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = packFilename(
        selectedMode === "programme"
          ? programme.title
          : "Моя музична бібліотека",
      );
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setNotice(
        "Пакет готовий до збереження. Перенеси файл .khz на інший пристрій і відкрий його тут.",
      );
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          errorText(
            e,
            "Не вдалося прочитати аудіо для пакета. Перевір файли й спробуй ще раз.",
          ),
        );
    } finally {
      finish(controller);
    }
  };
  const openPack = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy || !allowed) return;
    setParsed(null);
    setHasOrder(false);
    const controller = begin("check");
    try {
      const value = await readShowPack(file, controller.signal, (p) => {
        if (!controller.signal.aborted) setProgress(p);
      });
      const current = await readPreparedCollection();
      if (controller.signal.aborted) return;
      setExisting(current);
      setParsed(value);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          errorText(
            e,
            "Не вдалося прочитати пакет. Перевір файл і спробуй ще раз.",
          ),
        );
    } finally {
      finish(controller);
    }
  };
  const importPack = async () => {
    if (!parsed || !existing || busy || !allowed) return;
    setBusy("import");
    setError("");
    setNotice("");
    try {
      const replacements = new Map(
        conflicts.map((song) => [
          song.track.id,
          existing.find((s) => s.track.id === song.track.id)!.savedAt,
        ]),
      );
      await importPreparedBatch(parsed.songs, replacements);
      setImported(true);
      setHasOrder(!!parsed.programme);
      setNotice(
        `Збережено ${songCount(parsed.songs.length, true)}. ${parsed.programme ? "Порядок вечора готовий до перегляду." : "Можеш відкрити їх у бібліотеці й зібрати програму."}`,
      );
      const result = parsed;
      setParsed(null);
      const ids = new Set(result.songs.map((song) => song.track.id));
      setExisting((current) => [
        ...result.songs,
        ...(current ?? []).filter((song) => !ids.has(song.track.id)),
      ]);
      try {
        await onImported(result.songs, result.programme);
      } catch {
        setError(
          "Пісні збережено. Порядок не зберігся між сеансами: відкрий програму й збережи чернетку повторно.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Пакет не збережено.");
      setExisting(await readPreparedCollection().catch(() => existing));
    } finally {
      setBusy(null);
    }
  };
  const percent = progress?.total
    ? Math.min(100, Math.round((progress.bytes / progress.total) * 100))
    : 0;
  return (
    <Modal
      open
      onOpenChange={(open) => !open && close()}
      title="Пакет вечора"
      closeDisabled={busy === "import"}
      description="Перенеси підготовлені пісні та прив’язку на інший пристрій одним файлом."
      wide
    >
      <div className="show-pack">
        <Panel className="pack-hero">
          <div>
            <span className="section-label">
              <Package size={17} /> УСЕ ДЛЯ ТВОГО ШОУ
            </span>
            <h3>
              Твій вечір.
              <br />
              <span>Із собою.</span>
            </h3>
            <p>
              Власне аудіо, текст, мітки слів і порядок пісень. Відкрий пакет на
              іншому пристрої та перевір звук перед грою.
            </p>
          </div>
          <img src="/show-vinyl.webp" alt="" aria-hidden="true" />
        </Panel>
        <PackColumns importFirst={!existing?.length} reviewing={!!parsed}>
          <section
            key="export"
            className="pack-section"
            aria-label="Експорт пакета"
          >
            <div className="pack-section-title">
              <span>{existing?.length ? "01" : "02"}</span>
              <h3>Забрати із собою</h3>
            </div>
            <div
              className="pack-modes"
              role="group"
              aria-label="Що експортувати"
            >
              <Button
                aria-pressed={selectedMode === "programme"}
                disabled={!hasProgramme || !!busy}
                onClick={() => setMode("programme")}
              >
                Програма · {programme.trackIds.length}
              </Button>
              <Button
                aria-pressed={selectedMode === "library"}
                disabled={!!busy}
                onClick={() => setMode("library")}
              >
                Уся бібліотека · {existing?.length ?? 0}
              </Button>
            </div>
            <p>
              {songs.length
                ? `${songCount(songs.length)} · ${localCount} із власним аудіо · ${size(songs.reduce((sum, s) => sum + (s.file?.size ?? 0), 0))}`
                : "Спочатку збережи підготовку пісні або імпортуй готовий пакет."}
            </p>
            {songs.length > localCount && (
              <p className="pack-preview-note">
                Прев’ю Deezer потребуватимуть мережі. Для гри без неї додай
                власні файли перед експортом.
              </p>
            )}
            <Button
              variant="primary"
              disabled={!existing || !songs.length || !!busy || !allowed}
              onClick={() => void exportPack()}
            >
              <Download size={18} /> Зберегти пакет <ArrowRight size={18} />
            </Button>
          </section>
          <section
            key="import"
            className="pack-section"
            aria-label="Імпорт пакета"
          >
            <div className="pack-section-title">
              <span>{existing?.length ? "02" : "01"}</span>
              <h3>Відкрити тут</h3>
            </div>
            <p>
              Обери файл .khz до 1 ГБ. Спочатку перевіримо вміст і покажемо, що
              буде додано.
            </p>
            <input
              ref={input}
              type="file"
              accept=".khz"
              onChange={(e) => void openPack(e)}
              aria-label="Файл пакета вечора"
            />
            <Button
              disabled={!!busy || !allowed || !existing}
              onClick={() => input.current?.click()}
            >
              <Upload size={18} /> Обрати пакет
            </Button>
            {parsed && (
              <div className="pack-review">
                <h4>{parsed.programme?.title ?? "Підготовлені пісні"}</h4>
                <p>
                  {songCount(parsed.songs.length)} ·{" "}
                  {parsed.songs.filter((s) => s.file).length} із власним аудіо
                </p>
                {conflicts.length > 0 && (
                  <p className="pack-replacement">
                    Пакет замінить {songCount(conflicts.length, true)} у
                    місцевій бібліотеці разом із прив’язкою та аудіо. Перевір
                    позначені записи.
                  </p>
                )}
                <ol>
                  {parsed.songs.map((song) => (
                    <li key={song.track.id}>
                      <div>
                        <strong>{song.track.title}</strong>
                        <span>{song.track.artist}</span>
                      </div>
                      <small>
                        {conflicts.some((s) => s.track.id === song.track.id)
                          ? "Заміна"
                          : "Нова"}{" "}
                        · {song.file ? "Аудіо в пакеті" : "Прев’ю"}
                      </small>
                    </li>
                  ))}
                </ol>
                <Button
                  variant="primary"
                  disabled={!!busy || !allowed}
                  onClick={() => void importPack()}
                >
                  <Check size={18} />{" "}
                  {conflicts.length ? "Замінити та імпортувати" : "Імпортувати"}{" "}
                  {songCount(parsed.songs.length, true)}
                </Button>
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => {
                    setParsed(null);
                    setError("");
                  }}
                >
                  Залишити поточну бібліотеку
                </Button>
              </div>
            )}
          </section>
        </PackColumns>
        {busy && (
          <div className="pack-progress" role="status">
            <LoaderCircle className="spin" size={20} />
            <div>
              <strong>
                {busy === "export"
                  ? "Збираємо пакет…"
                  : busy === "check"
                    ? "Перевіряємо пакет…"
                    : "Зберігаємо пісні…"}
              </strong>
              {progress && (
                <>
                  <span>
                    Пісня {progress.song} з {progress.songs} · {percent}%
                  </span>
                  <div
                    className="pack-progress-track"
                    role="progressbar"
                    aria-label="Обробка аудіо"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                  >
                    <i style={{ width: `${percent}%` }} />
                  </div>
                </>
              )}
            </div>
            {busy !== "import" && (
              <Button
                variant="ghost"
                onClick={() => {
                  operation.current?.abort();
                  setNotice("Операцію скасовано.");
                }}
              >
                Скасувати
              </Button>
            )}
          </div>
        )}
        {!allowed && (
          <p className="pack-footnote">
            Заверши поточний раунд або дочекайся збереження підготовки, щоб працювати
            з пакетами.
          </p>
        )}
        {error && (
          <p className="pack-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="pack-notice" role="status">
            <Check size={18} />
            {notice}
          </p>
        )}
        {imported && hasOrder && (
          <Button variant="primary" onClick={onProgramme}>
            Переглянути програму <ArrowRight size={18} />
          </Button>
        )}
        <p className="pack-footnote">
          Пакет може містити повні власні аудіофайли. Рахунок поточної гри та
          доступи до кімнат до нього не входять.
        </p>
      </div>
    </Modal>
  );
}
