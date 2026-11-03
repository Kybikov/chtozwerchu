export type ScreenAwakeStatus = "idle" | "requesting" | "active" | "denied";
type Sentinel = Pick<
  WakeLockSentinel,
  "released" | "release" | "addEventListener" | "removeEventListener"
>;

/** One visible scene owns one lock. Late requests cannot outlive the scene. */
export function keepScreenAwake({
  request,
  visibility,
  visible,
  onStatus,
}: {
  request: () => Promise<Sentinel>;
  visibility: EventTarget;
  visible: () => boolean;
  onStatus: (status: ScreenAwakeStatus) => void;
}) {
  let disposed = false;
  let pending = false;
  let retry = false;
  let lastVisible = visible();
  let lock: Sentinel | null = null;
  const status = (next: ScreenAwakeStatus) => {
    if (!disposed) onStatus(next);
  };
  const release = (item: Sentinel) => {
    void item.release().catch(() => {});
  };
  const released = () => {
    lock?.removeEventListener("release", released);
    lock = null;
    // A system release (battery saver, for example) must not cause a retry loop.
    status("idle");
  };
  const drop = () => {
    const item = lock;
    lock = null;
    if (item) {
      item.removeEventListener("release", released);
      release(item);
    }
  };
  const acquire = async () => {
    if (disposed || !visible() || lock) return;
    if (pending) {
      retry = true;
      return;
    }
    pending = true;
    status("requesting");
    try {
      const item = await request();
      if (disposed || !visible()) release(item);
      else if (item.released) status("idle");
      else {
        lock = item;
        item.addEventListener("release", released);
        status("active");
      }
    } catch {
      status(visible() ? "denied" : "idle");
    } finally {
      pending = false;
      if (retry) {
        retry = false;
        void acquire();
      }
    }
  };
  const change = () => {
    const current = visible();
    if (current === lastVisible) return;
    lastVisible = current;
    if (current) void acquire();
    else {
      drop();
      status("idle");
    }
  };
  visibility.addEventListener("visibilitychange", change);
  void acquire();
  return () => {
    disposed = true;
    visibility.removeEventListener("visibilitychange", change);
    drop();
  };
}
