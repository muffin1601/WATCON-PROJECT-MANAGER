import { ComponentPropsWithoutRef, ElementType, HTMLAttributes, ReactNode } from "react";
import styles from "./Card.module.css";

type CardProps<T extends ElementType> = { as?: T; className?: string; children?: ReactNode } & Omit<
  ComponentPropsWithoutRef<T>,
  "as" | "className" | "children"
>;

// Polymorphic so a project list card can render as a Next.js <Link> (the
// prototype's .pitem is a clickable card) while still using .card styling.
export function Card<T extends ElementType = "div">({ as, className, children, ...rest }: CardProps<T>) {
  const Component = as || "div";
  return (
    <Component className={[styles.card, className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </Component>
  );
}

export function CardHeader({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={[styles.hd, className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h3 className={styles.title}>{children}</h3>;
}

export function CardBody({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={[styles.bd, className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}
