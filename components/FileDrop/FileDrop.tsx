"use client";

import { DragEvent, ReactNode, useRef, useState } from "react";
import { MAX_DOCUMENT_UPLOAD_BYTES, formatUploadLimit } from "../../modules/documents/uploadLimits";
import styles from "./FileDrop.module.css";

export interface FileDropProps {
  children: ReactNode;
  accept?: string;
  maxSizeBytes?: number;
  onFile: (file: File) => void;
}

// Ported from .drop (dashed dropzone with drag-over state) used for order/
// approval/challan attachment uploads.
export function FileDrop({ children, accept, maxSizeBytes = MAX_DOCUMENT_UPLOAD_BYTES, onFile }: FileDropProps) {
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = (file: File) => {
    if (file.size > maxSizeBytes) {
      setError(`File is larger than ${formatUploadLimit(maxSizeBytes)}.`);
      return;
    }
    setError(null);
    onFile(file);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) pickFile(file);
  };

  return (
    <div
      className={[styles.drop, over ? styles.over : ""].filter(Boolean).join(" ")}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      {children}
      {maxSizeBytes > 0 && <div className={styles.limit}>Maximum file size: {formatUploadLimit(maxSizeBytes)}</div>}
      {error && <div className={styles.error}>{error}</div>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) pickFile(file);
          e.currentTarget.value = "";
        }}
      />
    </div>
  );
}
