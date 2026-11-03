import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LogOut,
  Mail,
  Music2,
  Trophy,
  UserRound,
} from "lucide-react";
import { Button, Modal, Panel } from "../components/ui";
import type { Session } from "./music";
import { usePWAActivity } from "./pwa";

export type User = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};
type Identity = {
  user: User | null;
  checking: boolean;
  available: boolean | null;
  openAccount: (mode?: "login" | "register" | "profile") => void;
};
const Context = createContext<Identity>({
  user: null,
  checking: true,
  available: null,
  openAccount: () => {},
});
export const useIdentity = () => useContext(Context);

export class AccountError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function accountAPI<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "X-KHZ-Client": "studio" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
        : AbortSignal.timeout(12000),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new AccountError(
      "Немає зв’язку із сервером. Перевір мережу та спробуй ще раз.",
      0,
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new AccountError(
      "Сервер не відповів. Спробуй ще раз.",
      response.status,
    );
  }
  if (!response.ok)
    throw new AccountError(
      data.error || "Не вдалося виконати запит.",
      response.status,
    );
  return data;
}

export function AccountButton() {
  const { user, checking, openAccount } = useIdentity();
  return (
    <Button
      className="account-button"
      onClick={() => openAccount(user ? "profile" : "login")}
      disabled={checking}
    >
      {checking ? (
        <LoaderCircle size={18} className="spin" />
      ) : (
        <UserRound size={18} />
      )}
      <span>{user?.displayName || (checking ? "Зачекай…" : "Увійти")}</span>
    </Button>
  );
}

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"login" | "register" | "profile" | null>(
    null,
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  usePWAActivity(busy || mode === "login" || mode === "register");
  const [error, setError] = useState<{
    message: string;
    field?: "name" | "email" | "password";
  } | null>(null);
  const formId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const fieldError = (field: "name" | "email" | "password") =>
    error?.field === field ? (
      <p
        className="account-field-error"
        id={`${formId}-${field}-error`}
        role="alert"
      >
        {error.message}
      </p>
    ) : null;
  const invalidField = (
    field: "name" | "email" | "password",
    message: string,
  ) => {
    setError({ field, message });
    ({ name: nameInput, email: emailInput, password: passwordInput })[
      field
    ].current?.focus();
  };
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const status = await accountAPI<{ available: boolean }>(
          "/api/auth/status",
          undefined,
          controller.signal,
        );
        setAvailable(status.available);
        if (status.available) {
          try {
            setUser(
              (
                await accountAPI<{ user: User }>(
                  "/api/me",
                  undefined,
                  controller.signal,
                )
              ).user,
            );
          } catch (e) {
            if (!(e instanceof AccountError) || e.status !== 401) throw e;
          }
        }
      } catch {
        /* Guest play stays available when the account service is offline. */
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    })();
    return () => controller.abort();
  }, []);
  const openAccount = (next: "login" | "register" | "profile" = "login") => {
    setError(null);
    setPassword("");
    setVisible(false);
    setMode(next === "profile" && !user ? "login" : next);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const cleanEmail = email.trim().toLowerCase();
    if (
      mode === "register" &&
      (Array.from(name.trim()).length < 2 ||
        Array.from(name.trim()).length > 32)
    ) {
      invalidField("name", "Ім’я має містити від 2 до 32 символів.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      invalidField("email", "Вкажи коректну електронну пошту.");
      return;
    }
    if (
      !password ||
      (mode === "register" && Array.from(password).length < 10)
    ) {
      invalidField(
        "password",
        mode === "register"
          ? "Додай пароль щонайменше з 10 символів."
          : "Вкажи свій пароль.",
      );
      return;
    }
    if (new TextEncoder().encode(password).length > 72) {
      invalidField("password", "Пароль надто довгий. Спробуй коротший.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await accountAPI<{ user: User }>(`/api/auth/${mode}`, {
        email: cleanEmail,
        password,
        ...(mode === "register" ? { displayName: name.trim() } : {}),
      });
      setUser(result.user);
      setAvailable(true);
      setPassword("");
      setMode("profile");
    } catch (e) {
      setError({ message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    setBusy(true);
    setError(null);
    try {
      await accountAPI("/api/auth/logout", {});
      sessionStorage.removeItem("khz:party:access");
      sessionStorage.removeItem("khz:network-room");
      location.assign("/");
    } catch (e) {
      setError({ message: (e as Error).message });
      setBusy(false);
    }
  };
  const sessionExpired = useCallback(() => {
    setUser(null);
    setPassword("");
    setVisible(false);
    setMode("login");
    setError({
      message: "Сеанс завершився. Увійди ще раз або продовжуй гостем.",
    });
  }, []);
  return (
    <Context.Provider value={{ user, checking, available, openAccount }}>
      {children}
      <Modal
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setMode(null);
            setPassword("");
          }
        }}
        title={
          mode === "profile"
            ? "Твій простір"
            : mode === "register"
              ? "Збирай свою історію"
              : "З поверненням"
        }
        description={
          mode === "profile"
            ? "Акаунт, завершені ігри та результати твоїх вечорів."
            : "Грати можна й без акаунта. Вхід додає особисту історію ігор."
        }
        wide={mode === "profile"}
        className={`account-modal ${mode === "profile" ? "account-profile-modal" : ""}`}
      >
        {mode === "profile" && user ? (
          <>
            <div className="profile-identity">
              <div className="profile-avatar">
                {Array.from(user.displayName)[0]?.toUpperCase()}
              </div>
              <div>
                <h3>{user.displayName}</h3>
                <p>{user.email}</p>
              </div>
              <Button variant="ghost" onClick={logout} disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <LogOut size={18} />
                )}{" "}
                Вийти
              </Button>
            </div>
            <ProfileHistory
              userId={user.id}
              onSessionExpired={sessionExpired}
            />
          </>
        ) : (
          <>
            <div
              className="account-tabs"
              role="group"
              aria-label="Спосіб входу"
            >
              <Button
                className={mode === "login" ? "selected" : ""}
                aria-pressed={mode === "login"}
                onClick={() => openAccount("login")}
                disabled={busy}
              >
                Вхід
              </Button>
              <Button
                className={mode === "register" ? "selected" : ""}
                aria-pressed={mode === "register"}
                onClick={() => openAccount("register")}
                disabled={busy}
              >
                Реєстрація
              </Button>
            </div>
            {available === false && (
              <p className="account-notice">
                Акаунти зараз недоступні. Закрий це вікно та продовжуй грати
                гостем.
              </p>
            )}
            <form className="account-form" noValidate onSubmit={submit}>
              {mode === "register" && (
                <div className="field-label">
                  <label htmlFor={`${formId}-name`}>Як тебе називати</label>
                  <input
                    id={`${formId}-name`}
                    ref={nameInput}
                    aria-invalid={error?.field === "name" || undefined}
                    aria-describedby={
                      error?.field === "name"
                        ? `${formId}-name-error`
                        : undefined
                    }
                    autoComplete="nickname"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ім’я або сценічний псевдонім"
                    disabled={busy}
                  />
                  {fieldError("name")}
                </div>
              )}
              <div className="field-label">
                <label htmlFor={`${formId}-email`}>Електронна пошта</label>
                <div className="field-with-icon">
                  <Mail size={19} aria-hidden="true" />
                  <input
                    id={`${formId}-email`}
                    ref={emailInput}
                    aria-invalid={error?.field === "email" || undefined}
                    aria-describedby={
                      error?.field === "email"
                        ? `${formId}-email-error`
                        : undefined
                    }
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    disabled={busy}
                  />
                </div>
                {fieldError("email")}
              </div>
              <div className="field-label">
                <label htmlFor={`${formId}-password`}>Пароль</label>
                <div className="password-field">
                  <input
                    id={`${formId}-password`}
                    ref={passwordInput}
                    aria-invalid={error?.field === "password" || undefined}
                    aria-describedby={
                      error?.field === "password"
                        ? `${formId}-password-error`
                        : mode === "register"
                          ? `${formId}-password-hint`
                          : undefined
                    }
                    type={visible ? "text" : "password"}
                    autoComplete={
                      mode === "register" ? "new-password" : "current-password"
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      mode === "register"
                        ? "Щонайменше 10 символів"
                        : "Твій пароль"
                    }
                    disabled={busy}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="icon-button"
                    aria-label={
                      visible ? "Приховати пароль" : "Показати пароль"
                    }
                    aria-pressed={visible}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? <EyeOff size={19} /> : <Eye size={19} />}
                  </Button>
                </div>
                {fieldError("password") ||
                  (mode === "register" && (
                    <p
                      className="account-field-hint"
                      id={`${formId}-password-hint`}
                    >
                      Щонайменше 10 символів.
                    </p>
                  ))}
              </div>
              {error && !error.field && (
                <p className="form-error" role="alert">
                  {error.message}
                </p>
              )}
              <Button
                type="submit"
                variant="primary"
                className="account-submit"
                disabled={busy || available === false}
              >
                {busy ? (
                  <LoaderCircle size={20} className="spin" />
                ) : (
                  <ArrowRight size={20} />
                )}
                {busy
                  ? "Зачекай…"
                  : mode === "register"
                    ? "Створити акаунт"
                    : "Увійти та продовжити"}
              </Button>
            </form>
            <Button
              className="account-guest"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setMode(null);
                setPassword("");
                setError(null);
              }}
            >
              Продовжити гостем
            </Button>
          </>
        )}
        {mode === "profile" && error && (
          <p className="form-error" role="alert">
            {error.message}
          </p>
        )}
      </Modal>
    </Context.Provider>
  );
}

type SavedShow = {
  id: string;
  code: string;
  mode: string;
  snapshot: Session;
  endedAt: string;
};
type SavedMatch = {
  code: string;
  winner: string;
  team: string;
  score: number;
  won: boolean;
  endedAt: string;
};
function ProfileHistory({
  userId,
  onSessionExpired,
}: {
  userId: string;
  onSessionExpired: () => void;
}) {
  const [data, setData] = useState<{
    shows: SavedShow[];
    matches: SavedMatch[];
  } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    void Promise.all([
      accountAPI<{ shows: SavedShow[] }>(
        "/api/me/shows",
        undefined,
        controller.signal,
      ),
      accountAPI<{ matches: SavedMatch[] }>(
        "/api/me/history",
        undefined,
        controller.signal,
      ),
    ])
      .then(([shows, matches]) => {
        if (!controller.signal.aborted)
          setData({ shows: shows.shows, matches: matches.matches || [] });
      })
      .catch((e: Error) => {
        if (controller.signal.aborted) return;
        if (e instanceof AccountError && e.status === 401) onSessionExpired();
        else setError(e.message);
      });
    return () => controller.abort();
  }, [userId, retry, onSessionExpired]);
  if (error)
    return (
      <div className="history-empty">
        <p role="alert">{error}</p>
        <Button onClick={() => setRetry((r) => r + 1)}>
          Спробувати ще раз
        </Button>
      </div>
    );
  if (!data)
    return (
      <div className="history-empty" role="status">
        <LoaderCircle className="spin" size={26} />
        <p>Завантажуємо твою історію…</p>
      </div>
    );
  const items = [
    ...data.shows.map((show) => ({
      id: show.id,
      date: show.endedAt,
      show,
      match: null,
    })),
    ...data.matches.map((match, i) => ({
      id: `${match.code}-${match.endedAt}-${i}`,
      date: match.endedAt,
      match,
      show: null,
    })),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  if (!items.length)
    return (
      <Panel className="history-empty">
        <Trophy size={36} />
        <h3>Перший вечір ще попереду</h3>
        <p>
          Завершені ігри з’являться тут. Локальну музичну партію можна зберегти
          з її фінального екрана.
        </p>
      </Panel>
    );
  return (
    <div className="profile-history">
      <div className="section-label">
        <Trophy size={17} /> ЗАВЕРШЕНІ ІГРИ <span>{items.length}</span>
      </div>
      {items.map(({ id, date, show, match }) => (
        <Panel key={id} className="saved-show">
          <div className="saved-show-heading">
            <span className="saved-show-icon">
              {show ? <Music2 size={22} /> : <Trophy size={22} />}
            </span>
            <div>
              <h3>{show ? "Продовж пісню" : "Вечір конкурсів"}</h3>
              <p>
                {new Date(date).toLocaleDateString("uk-UA", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}{" "}
                ·{" "}
                {show?.mode === "local"
                  ? "На одному екрані"
                  : `Кімната ${show?.code || match?.code}`}
              </p>
            </div>
            {show ? (
              <strong className="saved-score">
                <span>{show.snapshot.scores.girls}</span>
                <i>:</i>
                <span>{show.snapshot.scores.boys}</span>
              </strong>
            ) : (
              <strong className="saved-score">
                {match?.score} <small>{pointWord(match?.score ?? 0)}</small>
              </strong>
            )}
          </div>
          {show ? (
            <>
              <div className="saved-team-names">
                {show.snapshot.names.girls} / {show.snapshot.names.boys}
                <Button
                  variant="ghost"
                  onClick={() => setExpanded(expanded === id ? null : id)}
                  aria-expanded={expanded === id}
                >
                  {expanded === id ? "Сховати" : "Усі раунди"}
                  <ArrowRight size={16} />
                </Button>
              </div>
              {expanded === id && (
                <ol className="saved-rounds">
                  {show.snapshot.history.map((r) => (
                    <li key={r.round}>
                      <b>{String(r.round).padStart(2, "0")}</b>
                      <div>
                        <strong>{r.track}</strong>
                        <p>{r.line}</p>
                      </div>
                      <span>
                        {r.awarded
                          ? `${show.snapshot.names[r.awarded]} +3`
                          : "Без балів"}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : (
            <p className="saved-match-result">
              {match?.won
                ? "Твоя команда перемогла"
                : match?.winner
                  ? "Цього разу сильніші суперники"
                  : "Нічия"}
            </p>
          )}
        </Panel>
      ))}
    </div>
  );
}

const pointForms = new Intl.PluralRules("uk");
function pointWord(score: number) {
  const form = pointForms.select(score);
  return form === "one" ? "бал" : form === "few" ? "бали" : "балів";
}
