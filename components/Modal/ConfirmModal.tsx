"use client";

import { Modal } from "./Modal";
import { Button } from "../Button/Button";

export interface ConfirmModalProps {
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}

// Ported from confirmModal(msg, onYes)
export function ConfirmModal({ message, onCancel, onConfirm }: ConfirmModalProps) {
  return (
    <Modal
      title="Please confirm"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="danger"
            style={{ background: "var(--danger)", color: "#fff", borderColor: "var(--danger)" }}
            onClick={onConfirm}
          >
            Yes, continue
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 14 }}>{message}</p>
    </Modal>
  );
}
