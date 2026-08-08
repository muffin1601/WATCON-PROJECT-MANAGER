"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Chip } from "../Chip/Chip";
import { Button } from "../Button/Button";
import { Select } from "../Form/Inputs";
import { DeleteProjectModal } from "./DeleteProjectModal";
import { PROJECT_STATUS_LABEL, PROJECT_TYPE_LABEL } from "../../modules/projects/data";
import { apiFetch } from "../../lib/apiClient";
import { useToast } from "../Toast/ToastProvider";
import type { ProjectViewModel } from "../../modules/projects/viewModel";
import styles from "./ProjectHeader.module.css";

const APPROVAL_LABEL: Record<string, string> = {
  PURCHASE_ORDER: "Purchase Order",
  QUOTE_EMAIL: "Quote — Email approval",
  QUOTE_WHATSAPP: "Quote — WhatsApp approval",
  QUOTE_VERBAL: "Quote — Verbal approval",
};

// Ported from the project detail page header block in renderProject().
export function ProjectHeader({ project }: { project: ProjectViewModel }) {
  const router = useRouter();
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      apiFetch(`/api/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => router.refresh(),
    onError: () => toast("Failed to update status"),
  });

  return (
    <div className={styles.head}>
      <div className={styles.titleBlock}>
        <h2>{project.name}</h2>
        <div className={styles.sub}>
          {project.client} · {project.site || ""} <Chip tone="teal">{PROJECT_TYPE_LABEL[project.type] ?? project.type}</Chip> ·
          Approval: <b>{APPROVAL_LABEL[project.approvalMode] ?? project.approvalMode}</b>
          {project.poNumber ? ` · Ref: ${project.poNumber}` : ""}
        </div>
      </div>
      <div className={styles.actions}>
        <Select
          className={styles.statusSelect}
          defaultValue={project.status}
          onChange={(e) => statusMutation.mutate(e.target.value)}
        >
          {Object.entries(PROJECT_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        {/* Visible but not adjacent to any routine control, and it opens a
            two-step confirmation — a single click can never delete anything. */}
        <Button variant="danger" className={styles.deleteBtn} onClick={() => setDeleting(true)}>
          <Trash2 size={15} aria-hidden />
          Delete Full Project
        </Button>
      </div>
      {deleting && (
        <DeleteProjectModal
          projectId={project.id}
          projectName={project.name}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
