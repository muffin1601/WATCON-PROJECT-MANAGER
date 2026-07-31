import { ButtonHTMLAttributes, forwardRef } from "react";
import styles from "./Button.module.css";

type ButtonVariant = "default" | "primary" | "danger" | "ghost";
type ButtonSize = "md" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClass: Record<ButtonVariant, string> = {
  default: "",
  primary: styles.p ?? "",
  danger: styles.d ?? "",
  ghost: styles.ghost ?? "",
};

// Ported from .btn / .btn.p / .btn.d / .btn.sm / .btn.ghost in the prototype.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", size = "md", className, ...rest }, ref) => {
    const classes = [styles.btn, variantClass[variant], size === "sm" ? styles.sm : "", className]
      .filter(Boolean)
      .join(" ");
    return <button ref={ref} className={classes} {...rest} />;
  }
);
Button.displayName = "Button";
