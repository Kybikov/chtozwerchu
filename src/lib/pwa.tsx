import { createContext, useContext, type ReactNode } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

const Context = createContext<ReturnType<typeof useRegisterSW> | null>(null);
export function PWAProvider({ children }: { children: ReactNode }) {
  const registration = useRegisterSW();
  return <Context.Provider value={registration}>{children}</Context.Provider>;
}
export function usePWA() {
  const context = useContext(Context);
  if (!context) throw new Error("PWA provider missing");
  return context;
}
