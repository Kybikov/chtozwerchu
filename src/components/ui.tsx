import type { ComponentProps, ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import SpecularButton from "./react-bits/SpecularButton";
import SpotlightCard from "./react-bits/SpotlightCard";

export function Button({
  children,
  variant = "soft",
  className = "",
  shine = false,
  ...props
}: ComponentProps<"button"> & {
  variant?: "soft" | "primary" | "ghost" | "danger";
  shine?: boolean;
}) {
  return (
    <SpecularButton
      effects={shine}
      autoAnimate={false}
      followMouse={shine}
      radius={14}
      tint="#ffffff"
      tintOpacity={0.035}
      blur={0}
      textColor="currentColor"
      className={`button button-${variant} ${className}`}
      {...props}
    >
      {children}
    </SpecularButton>
  );
}
export function Panel({
  children,
  className = "",
  ...props
}: ComponentProps<typeof SpotlightCard>) {
  return (
    <SpotlightCard
      spotlightColor="#b695ff"
      spotlightSize={500}
      intensity={0.12}
      grain={0.04}
      className={`panel ${className}`}
      {...props}
    >
      {children}
    </SpotlightCard>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
  className = "",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal-content ${wide ? "modal-wide" : ""} ${className}`}
          aria-describedby={description ? "modal-description" : undefined}
        >
          <div className="modal-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {description && (
                <Dialog.Description id="modal-description">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                className="icon-button"
                aria-label="Закрити"
              >
                <X size={20} />
              </Button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
