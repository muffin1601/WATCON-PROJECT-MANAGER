import styles from "./Tabs.module.css";

export interface TabDef<T extends string> {
  key: T;
  label: string;
}

export interface TabsProps<T extends string> {
  tabs: TabDef<T>[];
  active: T;
  onChange: (key: T) => void;
}

// Ported from .tabs button.on
export function Tabs<T extends string>({ tabs, active, onChange }: TabsProps<T>) {
  return (
    <div className={styles.tabs} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={t.key === active}
          className={t.key === active ? styles.on : ""}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
