import { useEffect, useRef, useState } from "react";
import { Check, CloudUpload, LoaderCircle } from "lucide-react";
import { accountAPI, useIdentity } from "../lib/identity";
import { Button } from "./ui";
import type { Session } from "../lib/music";

export default function LocalArchive({
  session,
  onClaim,
}: {
  session: Session;
  onClaim: (id: string) => void;
}) {
  const { user, checking, openAccount } = useIdentity();
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const done = useRef("");
  useEffect(() => {
    if (!user || session.ownerAccountId !== user.id || !session.finished)
      return;
    const key = `${user.id}:${session.matchId}`;
    if (done.current === key) {
      setStatus("saved");
      return;
    }
    let live = true;
    setStatus("saving");
    setError("");
    void accountAPI("/api/me/shows", { session })
      .then(() => {
        done.current = key;
        if (live) setStatus("saved");
      })
      .catch((e: Error) => {
        if (live) {
          setError(e.message);
          setStatus("error");
        }
      });
    return () => {
      live = false;
    };
  }, [
    user?.id,
    session.matchId,
    session.ownerAccountId,
    session.finished,
    retry,
  ]);
  return (
    <div className="local-archive">
      {status === "saved" ? (
        <>
          <span className="archive-done">
            <Check size={18} />
            Збережено у твоєму профілі
          </span>
          <Button variant="ghost" onClick={() => openAccount("profile")}>
            Відкрити профіль
          </Button>
        </>
      ) : status === "saving" ? (
        <span className="archive-done" role="status">
          <LoaderCircle size={18} className="spin" />
          Зберігаємо гру…
        </span>
      ) : (
        <>
          <p>
            {error ||
              (user
                ? "Збережи підсумки цього вечора у своєму профілі."
                : "Результати вже на пристрої. Увійди, щоб додати цю гру до профілю.")}
          </p>
          <Button
            disabled={checking}
            onClick={() => {
              if (!user) openAccount("login");
              else if (session.ownerAccountId !== user.id) onClaim(user.id);
              else setRetry((r) => r + 1);
            }}
          >
            <CloudUpload size={18} />
            {status === "error"
              ? "Повторити збереження"
              : user
                ? "Зберегти у профілі"
                : "Увійти та зберегти"}
          </Button>
        </>
      )}
    </div>
  );
}
