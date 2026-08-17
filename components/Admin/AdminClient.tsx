"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle } from "../Card/Card";
import { Table, TableWrap, Td, Th } from "../Table/Table";
import { Button } from "../Button/Button";
import { Chip } from "../Chip/Chip";
import { ConfirmModal } from "../Modal/ConfirmModal";
import { UserModal } from "./UserModal";
import { useToast } from "../Toast/ToastProvider";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { accessSummary } from "../../modules/auth/permissions";
import type { UserDto } from "../../services/userService";

// Ported from renderAdmin() — users, their access summary, and the legend.
export function AdminClient({ users, currentUserId }: { users: UserDto[]; currentUserId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<UserDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<UserDto | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async (u: UserDto) => {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch(`/api/users/${u.id}`, { method: "DELETE" });
      toast("User deleted");
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
      setConfirmDelete(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Admin — Users &amp; Permissions</CardTitle>
          <Button variant="primary" size="sm" style={{ marginLeft: "auto" }} onClick={() => setCreating(true)}>
            + Add user
          </Button>
        </CardHeader>
        <CardBody>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>
            Each user gets View / Create / Amend / Delete rights per module. Admins have full access everywhere. This
            controls what staff can do in the app; keep regular backups from Settings.
          </p>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Username</Th>
                  <Th>Role</Th>
                  <Th>Access summary</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <Td>
                      <b>{u.name}</b>
                    </Td>
                    <Td>{u.username}</Td>
                    <Td>
                      <Chip tone={u.role === "ADMIN" ? "teal" : "grey"}>{u.role === "ADMIN" ? "admin" : "user"}</Chip>
                    </Td>
                    <Td style={{ fontSize: 12.5, maxWidth: 420 }}>{accessSummary(u)}</Td>
                    <Td>
                      {u.active ? <Chip tone="green">active</Chip> : <Chip tone="red">inactive</Chip>}
                    </Td>
                    <Td style={{ whiteSpace: "nowrap" }}>
                      <Button size="sm" onClick={() => setEditing(u)}>
                        Edit
                      </Button>{" "}
                      {u.id !== currentUserId && (
                        <Button size="sm" variant="danger" onClick={() => setConfirmDelete(u)} disabled={busy}>
                          Delete
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12 }}>
            Legend in access summary: V = view, C = create, A = amend, D = delete.
          </p>
        </CardBody>
      </Card>

      {(creating || editing) && (
        <UserModal
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          message={`Delete the user "${confirmDelete.name}"? They will be signed out immediately and will not be able to sign in again.`}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void remove(confirmDelete)}
        />
      )}
    </>
  );
}
