import {
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { X } from "lucide-react";

export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  onOpen,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onOpen?: () => void;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const el = dialog.current!;
    el.showModal();
    onOpen?.();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal ${className}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) {
          const rect = dialog.current!.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      {children}
    </dialog>
  );
}
export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="Close" onClick={onClick}>
      <X size={20} />
    </IconButton>
  );
}
