import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

type PWA = ReturnType<typeof useRegisterSW> & { checkForUpdate: () => Promise<boolean> };
const Context = createContext<PWA | null>(null);
export function PWAProvider({ children }: { children: ReactNode }) {
  const current = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const registration = useRegisterSW({
    onRegisteredSW: (_url, worker) => { current.current = worker; },
  });
  const checkForUpdate = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const worker = current.current || await navigator.serviceWorker.getRegistration();
    if (!worker) return false;
    await worker.update();
    if (worker.waiting) registration.needRefresh[1](true);
    return true;
  }, [registration.needRefresh[1]]);
  return <Context.Provider value={{...registration, checkForUpdate}}>{children}</Context.Provider>;
}
export function usePWA() {
  const context = useContext(Context);
  if (!context) throw new Error("PWA provider missing");
  return context;
}
