"use client";

import { useMemo, useState } from "react";
import { Card, CardHeader, CardBody } from "../Card/Card";
import { TextInput } from "../Form/Inputs";
import { EmptyState } from "../Table/Table";
import { ProjectListItem, ProjectListItemProps } from "../ProjectListItem/ProjectListItem";
import styles from "./Dashboard.module.css";

export function DashboardClient({ projects }: { projects: ProjectListItemProps[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      `${p.name} ${p.client} ${p.site ?? ""}`.toLowerCase().includes(q)
    );
  }, [projects, query]);

  return (
    <Card>
      <CardHeader>
        <h3>Projects</h3>
        <TextInput
          type="text"
          placeholder="Search client / site / project…"
          style={{ maxWidth: 280, marginLeft: "auto" }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </CardHeader>
      <CardBody>
        <div className={styles.plist}>
          {filtered.length === 0 ? (
            <EmptyState>
              {projects.length === 0
                ? "No projects yet. Click + New Project to add your first project."
                : "No projects match your search."}
            </EmptyState>
          ) : (
            filtered.map((p) => <ProjectListItem key={p.id} {...p} />)
          )}
        </div>
      </CardBody>
    </Card>
  );
}
