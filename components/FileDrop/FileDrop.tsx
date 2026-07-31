"use client";

import { DragEvent, ReactNode, useRef, useState } from "react";
import styles from "./FileDrop.module.css";

export interface FileDropProps {
  children: ReactNode;
  accept?: string;
  onFile: (file: File) => void;
}

// Ported from .drop (dashed dropzone with drag-over state) used for order/
// approval/challan attachment uploads.
export function FileDrop({ children, accept, onFile }: FileDropProps) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
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
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
    </div>
  );
}
