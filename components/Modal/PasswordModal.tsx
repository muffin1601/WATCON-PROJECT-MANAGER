"use client";

import { useRef, useState } from "react";
import { Modal } from "./Modal";
import { Button } from "../Button/Button";
import { TextInput } from "../Form/Inputs";

export interface PasswordModalProps {
  action: string;
  expectedPassword: string;
  onCancel: () => void;
  onSuccess: () => void;
}

// Ported from pwdModal(action, onOk) — protects destructive/edit actions on
// challans, same as the prototype's APP_PWD gate.
export function PasswordModal({ action, expectedPassword, onCancel, onSuccess }: PasswordModalProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const go = () => {
    if (value === expectedPassword) {
      onSuccess();
    } else {
      setError(true);
      inputRef.current?.select();
    }
  };

  return (
    <Modal
      title="Password required"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={go}>
            Continue
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>
        Enter the password to <b>{action}</b> this challan.
      </p>
      <TextInput
        ref={inputRef}
        type="password"
        placeholder="Password"
        autoComplete="off"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
      {error && (
        <p style={{ fontSize: 12.5, color: "var(--danger)", marginTop: 8 }}>Incorrect password.</p>
      )}
    </Modal>
  );
}
