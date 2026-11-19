import React, { useEffect, useId, useRef } from "react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  closedBy?: "any" | "closerequest" | "none";
  className?: string;
  children: React.ReactNode;
}

const Dialog: React.FC<DialogProps> = ({
  open,
  onClose,
  title,
  closedBy = "closerequest",
  className,
  children,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      const frame = requestAnimationFrame(() => {
        if (!el.open) return;
        const preferred = el.querySelector<HTMLElement>("[data-autofocus]");
        preferred?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
    if (!open && el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    const handleClose = () => {
      el.returnValue = "";
      onCloseRef.current();
    };

    const handleCancel = (e: Event) => {
      if (closedBy === "none") {
        e.preventDefault();
      }
    };

    el.addEventListener("close", handleClose);
    el.addEventListener("cancel", handleCancel);

    let cleanupPointer: (() => void) | undefined;
    if (closedBy === "any" && !("closedBy" in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (ev: PointerEvent) => {
        const r = el.getBoundingClientRect();
        return (
          ev.clientX < r.left ||
          ev.clientX > r.right ||
          ev.clientY < r.top ||
          ev.clientY > r.bottom
        );
      };
      const onDown = (ev: PointerEvent) => {
        if (el.open) pressedOutside = isOutside(ev);
      };
      const onUp = (ev: PointerEvent) => {
        if (el.open && pressedOutside && isOutside(ev)) {
          el.close();
        }
        pressedOutside = false;
      };
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointerup", onUp);
      cleanupPointer = () => {
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointerup", onUp);
      };
    }

    return () => {
      el.removeEventListener("close", handleClose);
      el.removeEventListener("cancel", handleCancel);
      cleanupPointer?.();
    };
  }, [closedBy]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      className={className ? `modal-dialog ${className}` : "modal-dialog"}
      {...({ closedby: closedBy } as Record<string, unknown>)}
    >
      <div className="modal-header">
        <h2 id={headingId} className="modal-title">
          {title}
        </h2>
        <button
          type="button"
          className="btn-icon"
          disabled={closedBy === "none"}
          onClick={() => {
            if (closedBy !== "none") dialogRef.current?.close();
          }}
          aria-label="Close dialog"
        >
          ×
        </button>
      </div>
      <div className="modal-body">{open && children}</div>
    </dialog>
  );
};

export default Dialog;
