"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { TextInput } from "../Form/Inputs";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { useToast } from "../Toast/ToastProvider";
import styles from "./DeleteProjectModal.module.css";

interface DeletionSummary {
  projectName: string;
  challans: number;
  bills: number;
  documents: number;
  filesFailed: number;
}

/**
 * Two-step gate for deleting an entire project.
 *
 * Step 1 states exactly what will be destroyed; step 2 asks for the deletion
 * password. Two steps rather than one because a single dialog with a password
 * field trains people to type the password reflexively — separating "do you
 * mean this?" from "prove you may" makes the irreversible half a deliberate
 * second decision.
 *
 * The password is never checked here. It is posted to the delete endpoint,
 * which verifies it server-side before touching anything; this component
 * cannot tell a correct password from an incorrect one except by the reply it
 * gets back.
 */
export function DeleteProjectModal({
  projectId,
  projectName,
  onClose,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<"confirm" | "password">("confirm");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const deletion = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: true; summary: DeletionSummary }>(`/api/projects/${projectId}`, {
        method: "DELETE",
        body: JSON.stringify({ password }),
      }),
    onSuccess: (data) => {
      const s = data.summary;
      toast(
        s.filesFailed > 0
          ? `"${s.projectName}" was deleted. ${s.filesFailed} uploaded file(s) could not be removed from storage.`
          : `"${s.projectName}" and all its data were permanently deleted.`
      );
      // replace(), not push(): the deleted project's page must not be
      // reachable with the browser Back button.
      router.replace("/");
      router.refresh();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "The project could not be deleted. Please try again.");
      setPassword("");
      inputRef.current?.focus();
    },
  });

  const submit = () => {
    if (!password.trim()) {
      setError("Enter the deletion password to continue.");
      inputRef.current?.focus();
      return;
    }
    setError(null);
    deletion.mutate();
  };

  if (step === "confirm") {
    return (
      <Modal
        title="Delete entire project?"
        onClose={onClose}
        footer={
          <>
            <Button className={styles.footBtn} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className={`${styles.destructive} ${styles.footBtn}`}
              onClick={() => setStep("password")}
            >
              Yes, delete this project
            </Button>
          </>
        }
      >
        <div className={styles.warn}>
          <AlertTriangle size={20} aria-hidden />
          <div>
            <p className={styles.lead}>
              This will permanently delete <b>{projectName}</b> and all associated project data.
            </p>
            <p className={styles.body}>
              Documents, sales order items, uploaded files, extracted data, challans, BOQ/PO records, running bills,
              payments, transport records, discounts and amendments belonging to this project will be removed.
            </p>
            <p className={styles.body}>
              Shared data — vendors, the items &amp; stocks master and company settings — is not affected, and no other
              project is touched.
            </p>
            <p className={styles.cannot}>This action cannot be undone.</p>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Password required"
      onClose={onClose}
      footer={
        <>
          <Button className={styles.footBtn} onClick={onClose} disabled={deletion.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className={`${styles.destructive} ${styles.footBtn}`}
            onClick={submit}
            disabled={deletion.isPending}
          >
            {deletion.isPending ? "Deleting…" : "Delete project permanently"}
          </Button>
        </>
      }
    >
      <p className={styles.body}>
        Enter the deletion password to permanently delete <b>{projectName}</b>.
      </p>
      <TextInput
        ref={inputRef}
        type="password"
        placeholder="Deletion password"
        autoComplete="off"
        autoFocus
        value={password}
        disabled={deletion.isPending}
        onChange={(e) => {
          setPassword(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && !deletion.isPending && submit()}
      />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
