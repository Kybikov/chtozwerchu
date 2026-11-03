import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  requestPWAUpdate,
  watchPWAController,
  type UpdateResult,
} from "./pwaUpdate";

type PWA = {
  needsUpdate: boolean;
  offlineReady: boolean;
  busy: boolean;
  reloadPending: boolean;
  updateOpen: boolean;
  setUpdateOpen: (open: boolean) => void;
  openUpdate: () => void;
  checkForUpdate: () => Promise<boolean>;
  applyUpdate: () => Promise<UpdateResult | null>;
  activity: (id: string, busy: boolean, screen: boolean) => () => void;
};
const Context = createContext<PWA | null>(null);
export function PWAProvider({ children }: { children: ReactNode }) {
  const activities = useRef(
    new Map<string, { busy: boolean; screen: boolean }>(),
  );
  const busyNow = useRef(true);
  const applying = useRef(false);
  const [busy, setBusy] = useState(true);
  const [reloadPending, setReloadPending] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const registration = useRegisterSW({
    onNeedReload: () => {
      // Older windows can still activate a worker without our new guard.
      if (busyNow.current) setReloadPending(true);
      else location.reload();
    },
  });
  const setNeedsUpdate = registration.needRefresh[1];
  const activity = useCallback(
    (id: string, active: boolean, screen: boolean) => {
      const publish = () => {
        const states = [...activities.current.values()];
        busyNow.current =
          !states.some((state) => state.screen) ||
          states.some((state) => state.busy);
        setBusy(busyNow.current);
      };
      activities.current.set(id, { busy: active, screen });
      publish();
      return () => {
        activities.current.delete(id);
        publish();
      };
    },
    [],
  );
  const openUpdate = useCallback(() => setUpdateOpen(true), []);
  const checkForUpdate = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const worker = await navigator.serviceWorker.getRegistration();
    if (!worker) {
      setNeedsUpdate(false);
      return false;
    }
    await worker.update();
    setNeedsUpdate(!!worker.waiting);
    return true;
  }, [setNeedsUpdate]);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const respond = (event: MessageEvent) => {
      const source = event.source as ServiceWorker | null;
      if (
        event.data?.type !== "KHZ_PWA_ACTIVITY" ||
        event.data.protocol !== 1 ||
        !event.ports[0] ||
        !source?.scriptURL
      )
        return;
      const url = new URL(source.scriptURL);
      if (url.origin !== location.origin || url.pathname !== "/sw.js") return;
      event.ports[0].postMessage({ protocol: 1, busy: busyNow.current });
      event.ports[0].close();
    };
    navigator.serviceWorker.addEventListener("message", respond);
    const stopWatching = watchPWAController(navigator.serviceWorker, () =>
      setReloadPending(true),
    );
    let lastCheck = Date.now();
    const check = () => {
      if (
        document.visibilityState !== "visible" ||
        !navigator.onLine ||
        Date.now() - lastCheck < 60_000
      )
        return;
      lastCheck = Date.now();
      void checkForUpdate().catch(() => {});
    };
    const timer = setInterval(check, 60_000);
    window.addEventListener("online", check);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      navigator.serviceWorker.removeEventListener("message", respond);
      stopWatching();
      window.removeEventListener("online", check);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [checkForUpdate]);
  const applyUpdate = useCallback(async () => {
    if (busyNow.current)
      throw new Error("Заверши дію в цьому вікні перед оновленням.");
    if (applying.current) return null;
    if (reloadPending) {
      location.reload();
      return null;
    }
    if (!("serviceWorker" in navigator)) return null;
    const worker = await navigator.serviceWorker.getRegistration();
    if (!worker?.waiting) {
      setNeedsUpdate(false);
      return null;
    }
    applying.current = true;
    try {
      return await requestPWAUpdate(worker.waiting);
    } finally {
      applying.current = false;
    }
  }, [reloadPending, setNeedsUpdate]);
  return (
    <Context.Provider
      value={{
        needsUpdate: registration.needRefresh[0] || reloadPending,
        offlineReady: registration.offlineReady[0],
        busy,
        reloadPending,
        updateOpen,
        setUpdateOpen,
        openUpdate,
        checkForUpdate,
        applyUpdate,
        activity,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function usePWAActivity(busy: boolean, screen = false) {
  const { activity } = usePWA();
  const id = useId();
  useLayoutEffect(
    () => activity(id, busy, screen),
    [activity, id, busy, screen],
  );
}
export function usePWA() {
  const context = useContext(Context);
  if (!context) throw new Error("PWA provider missing");
  return context;
}
