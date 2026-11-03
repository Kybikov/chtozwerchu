import { useEffect, useRef, useState, type ReactNode } from "react";
import ScreenAwakeButton from "./ScreenAwakeButton";

/** Keep scene utilities reachable without leaving them over the show. */
export default function StageControls({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    let hovered = false;
    let lastMove = 0;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const active = document.activeElement;
        if (
          !hovered &&
          !(element.contains(active) && active?.matches(":focus-visible"))
        )
          setVisible(false);
      }, 3000);
    };
    const reveal = () => {
      setVisible(true);
      schedule();
    };
    const move = () => {
      const now = performance.now();
      if (now - lastMove < 200) return;
      lastMove = now;
      reveal();
    };
    const enter = (event: PointerEvent) => {
      if (event.pointerType === "mouse") hovered = true;
      reveal();
    };
    const leave = () => {
      hovered = false;
      schedule();
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", reveal, { passive: true });
    window.addEventListener("keydown", reveal);
    window.addEventListener("blur", leave);
    element.addEventListener("pointerenter", enter);
    element.addEventListener("pointerleave", leave);
    element.addEventListener("focusin", reveal);
    element.addEventListener("focusout", schedule);
    schedule();
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", reveal);
      window.removeEventListener("keydown", reveal);
      window.removeEventListener("blur", leave);
      element.removeEventListener("pointerenter", enter);
      element.removeEventListener("pointerleave", leave);
      element.removeEventListener("focusin", reveal);
      element.removeEventListener("focusout", schedule);
    };
  }, []);

  return (
    <div
      ref={root}
      role="group"
      aria-label="Керування сценою"
      className={`stage-exit stage-controls ${className}`}
      data-visible={visible}
    >
      {children}
      <ScreenAwakeButton />
    </div>
  );
}
