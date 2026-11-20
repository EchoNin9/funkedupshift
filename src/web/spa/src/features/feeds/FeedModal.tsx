import React, { useEffect, useId, useRef } from "react";
import { X } from "@phosphor-icons/react";
import { focusRing } from "../../components/buttonClasses";

export interface FeedModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  closedBy?: "any" | "closerequest" | "none";
  className?: string;
  children: React.ReactNode;
}

/**
 * Native top-layer modal built on `<dialog>.showModal()`.
 * Browser handles Esc, modal backdrop inertness, and `role`/`aria-modal` natively.
 */
export const FeedModal: React.FC<FeedModalProps> = ({
  open,
  onClose,
  title,
  closedBy = "closerequest",
  className,
  children,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      const frame = requestAnimationFrame(() => {
        if (!dialog.open) return;
        const preferred = dialog.querySelector<HTMLElement>("[data-autofocus]");
        preferred?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = "";
      onCloseRef.current();
    };

    const handleCancel = (e: Event) => {
      if (closedBy === "none") {
        e.preventDefault();
      }
    };

    dialog.addEventListener("close", handleClose);
    dialog.addEventListener("cancel", handleCancel);

    let cleanupPointer: (() => void) | undefined;
    if (closedBy === "any" && !("closedBy" in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (ev: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return (
          ev.clientX < r.left ||
          ev.clientX > r.right ||
          ev.clientY < r.top ||
          ev.clientY > r.bottom
        );
      };
      const onDown = (ev: PointerEvent) => {
        if (dialog.open) pressedOutside = isOutside(ev);
      };
      const onUp = (ev: PointerEvent) => {
        if (dialog.open && pressedOutside && isOutside(ev)) {
          dialog.close();
        }
        pressedOutside = false;
      };
      dialog.addEventListener("pointerdown", onDown);
      dialog.addEventListener("pointerup", onUp);
      cleanupPointer = () => {
        dialog.removeEventListener("pointerdown", onDown);
        dialog.removeEventListener("pointerup", onUp);
      };
    }

    return () => {
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("cancel", handleCancel);
      cleanupPointer?.();
    };
  }, [closedBy]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className={className ? `feeds-dialog ${className}` : "feeds-dialog"}
      {...({ closedby: closedBy } as any)}
    >
      <div className="feeds-dialog-header">
        <h2 id={titleId} className="feeds-dialog-title">
          {title}
        </h2>
        <button
          type="button"
          className={`feeds-dialog-close ${focusRing}`}
          disabled={closedBy === "none"}
          onClick={() => {
            if (closedBy !== "none") dialogRef.current?.close();
          }}
          aria-label="Close"
        >
          <X size={18} weight="bold" aria-hidden="true" />
        </button>
      </div>
      <div className="feeds-dialog-body">{open && children}</div>
    </dialog>
  );
};

export default FeedModal;
