import { forwardRef, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import styles from "./Inputs.module.css";

// Ported from input[type=text|number|date], select, textarea shared rule set.

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => (
    <input ref={ref} className={[styles.control, className].filter(Boolean).join(" ")} {...rest} />
  )
);
TextInput.displayName = "TextInput";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...rest }, ref) => (
    <select ref={ref} className={[styles.control, className].filter(Boolean).join(" ")} {...rest} />
  )
);
Select.displayName = "Select";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...rest }, ref) => (
    <textarea ref={ref} className={[styles.control, className].filter(Boolean).join(" ")} {...rest} />
  )
);
Textarea.displayName = "Textarea";
