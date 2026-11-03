import { useEffect, useState } from "react";
import {
  Check,
  CircleArrowUp,
  LoaderCircle,
  Monitor,
  RefreshCw,
} from "lucide-react";
import { Button, Modal } from "./ui";
import { usePWA } from "../lib/pwa";
import { version } from "../../package.json";

export function PWAUpdateControl({ compact = true }: { compact?: boolean }) {
  const { needsUpdate, openUpdate } = usePWA();
  return (
    <Button
      variant="ghost"
      className={`pwa-update-control ${compact ? "icon-button" : ""}`}
      aria-label="Оновлення застосунку"
      onClick={openUpdate}
    >
      <CircleArrowUp size={20} />
      {!compact && "Оновлення"}
      {needsUpdate && (
        <span className="pwa-update-dot" aria-label="Нова версія готова" />
      )}
    </Button>
  );
}

export function PWAUpdateDialog() {
  const {
    needsUpdate,
    busy,
    reloadPending,
    updateOpen,
    setUpdateOpen,
    checkForUpdate,
    applyUpdate,
    recoverWindow,
  } = usePWA();
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState("");
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  useEffect(() => {
    if (updateOpen) {
      setNotice("");
      setRecoveryAvailable(false);
    }
  }, [updateOpen]);
  const check = async () => {
    setChecking(true);
    setNotice("");
    try {
      const supported = await checkForUpdate();
      setNotice(
        supported
          ? "Перевірку завершено. Завантаження нової версії може тривати кілька секунд."
          : "Перевірка оновлень недоступна в цьому браузері.",
      );
    } catch {
      setNotice(
        "Не вдалося перевірити оновлення. Перевір з’єднання й спробуй ще раз.",
      );
    } finally {
      setChecking(false);
    }
  };
  return (
    <Modal
      open={updateOpen}
      onOpenChange={(open) => !applying && setUpdateOpen(open)}
      title={needsUpdate ? "Шоу має оновлення" : "Оновлення твого шоу"}
      description="Перевіряй та встановлюй оновлення між раундами, коли музика й відлік зупинені."
    >
      <p className="pwa-update-version">Твоя версія · {version}</p>
      <div className="pwa-update-state">
        <span className="pwa-update-symbol">
          <CircleArrowUp size={32} />
        </span>
        <div>
          <strong>
            {reloadPending
              ? "Оновлення вже завантажено"
              : needsUpdate
                ? "Нова версія готова"
                : "Готові перевірити?"}
          </strong>
          <p>
            {reloadPending
              ? "Онови це вікно після завершення гри або редагування."
              : needsUpdate
                ? "Перед встановленням перевіримо інші відкриті вікна гри на цьому пристрої."
                : "Нові функції та виправлення з’являться тут після завантаження."}
          </p>
        </div>
      </div>
      {busy && (
        <p className="pwa-update-notice" role="status">
          <Monitor size={20} />
          Тут ще триває гра, відтворення або редагування. Заверши дію й закрий
          редактор перед оновленням.
        </p>
      )}
      {notice && (
        <p className="pwa-update-notice" role="status">
          {notice}
        </p>
      )}
      <div className="pwa-update-actions">
        {needsUpdate ? (
          <Button
            variant="primary"
            disabled={busy || applying || checking}
            onClick={async () => {
              setApplying(true);
              setNotice("");
              setRecoveryAvailable(false);
              try {
                const result = await applyUpdate();
                if (!result)
                  setNotice(
                    "Готового оновлення ще немає. Перевір ще раз за кілька секунд.",
                  );
                else if (result.status === "blocked") {
                  setRecoveryAvailable(result.busy === 0);
                  setNotice(
                    result.busy
                      ? "В іншому вікні ще триває гра, музика або редагування. Заверши дію там і спробуй знову."
                      : "Не всі вікна гри відповіли. Закрий зайві вкладки цього сайту й спробуй ще раз.",
                  );
                }
              } catch (error) {
                setRecoveryAvailable(true);
                setNotice(
                  error instanceof Error
                    ? error.message
                    : "Оновлення не встановлено. Спробуй ще раз.",
                );
              } finally {
                setApplying(false);
              }
            }}
          >
            {applying ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <CircleArrowUp size={18} />
            )}
            {applying
              ? "Перевіряємо вікна…"
              : reloadPending
                ? "Оновити це вікно"
                : "Встановити оновлення"}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={checking}
            onClick={check}
          >
            <RefreshCw size={18} className={checking ? "spin" : ""} />
            {checking ? "Перевіряємо…" : "Перевірити оновлення"}
          </Button>
        )}
        {needsUpdate && (
          <Button disabled={checking || applying} onClick={check}>
            <RefreshCw size={18} className={checking ? "spin" : ""} />
            {checking ? "Перевіряємо…" : "Перевірити ще раз"}
          </Button>
        )}
        {recoveryAvailable && (
          <div className="pwa-recovery">
            <p>
              Можна завантажити свіжий інтерфейс тільки для цього вікна.
              Рахунок і підготовлені пісні залишаться на пристрої, інші екрани
              продовжать працювати. Потрібне з’єднання з інтернетом.
            </p>
            <Button
              disabled={busy || applying || checking}
              onClick={() => {
                if (!recoverWindow())
                  setNotice("Заверши дію в цьому вікні перед відновленням.");
              }}
            >
              <RefreshCw size={18} /> Відновити це вікно
            </Button>
          </div>
        )}
        <Button disabled={applying} onClick={() => setUpdateOpen(false)}>
          Повернутися до шоу
        </Button>
      </div>
      <p className="modal-footnote">
        <Check size={16} /> Після встановлення вікно перезавантажиться.
      </p>
    </Modal>
  );
}
