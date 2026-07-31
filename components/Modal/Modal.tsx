"use client";

import { MouseEvent, ReactNode, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import styles from "./Modal.module.css";

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

// Ported from the prototype's modal(title, bodyHTML, footHTML) helper —
// same markup shape: .modal-bg > .modal > .hd/.bd/.ft. Adds standard dialog
// a11y semantics (role="dialog", aria-modal, labelled by the title, initial
// focus placed inside the dialog) without altering the visual design.
export function Modal({ title, onClose, children, footer }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onBgClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.modalBg} onClick={onBgClick}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={dialogRef}>
        <div className={styles.hd}>
          <h3 id={titleId}>{title}</h3>
          <button aria-label="Close dialog" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className={styles.bd}>{children}</div>
        {footer && <div className={styles.ft}>{footer}</div>}
      </div>
    </div>
  );
}
