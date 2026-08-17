"use client";

import { useState } from "react";
import { Modal } from "../Modal/Modal";
import { Button } from "../Button/Button";
import { FormField, FormRow } from "../Form/FormField";
import { TextInput, Select } from "../Form/Inputs";
import { Table, TableWrap, Td, Th } from "../Table/Table";
import { useToast } from "../Toast/ToastProvider";
import { apiFetch, ApiError } from "../../lib/apiClient";
import { ACTIONS, MODULES, type ActionKey, type ModuleKey, type PermissionMap } from "../../modules/auth/permissions";
import type { UserDto } from "../../services/userService";

// Ported from userModal(): identity fields, role, status, and the
// module × action permission grid with per-row / per-column / everything
// toggles. The grid hides for admins, who always have full access.
export function UserModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: UserDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!initial;
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "USER">(initial?.role ?? "USER");
  const [active, setActive] = useState(initial?.active ?? true);
  const [perms, setPerms] = useState<PermissionMap>(initial?.perms ?? {});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isOn = (mod: ModuleKey, act: ActionKey) => !!perms[mod]?.[act];

  const setOne = (mod: ModuleKey, act: ActionKey, on: boolean) =>
    setPerms((prev) => {
      const next = { ...prev, [mod]: { ...(prev[mod] ?? {}) } };
      if (on) next[mod]![act] = true;
      else delete next[mod]![act];
      if (!Object.keys(next[mod]!).length) delete next[mod];
      return next;
    });

  const setRow = (mod: ModuleKey, on: boolean) =>
    setPerms((prev) => {
      const next = { ...prev };
      if (on) next[mod] = Object.fromEntries(ACTIONS.map(([a]) => [a, true]));
      else delete next[mod];
      return next;
    });

  const setColumn = (act: ActionKey, on: boolean) =>
    setPerms((prev) => {
      const next: PermissionMap = { ...prev };
      for (const [mod] of MODULES) {
        const cur = { ...(next[mod] ?? {}) };
        if (on) cur[act] = true;
        else delete cur[act];
        if (Object.keys(cur).length) next[mod] = cur;
        else delete next[mod];
      }
      return next;
    });

  const setEverything = (on: boolean) =>
    setPerms(
      on ? Object.fromEntries(MODULES.map(([m]) => [m, Object.fromEntries(ACTIONS.map(([a]) => [a, true]))])) : {}
    );

  const save = async () => {
    if (busy) return;
    if (!name.trim() || !username.trim()) {
      setError("Name and username are required");
      return;
    }
    if (!editing && !password) {
      setError("Password is required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload: Record<string, unknown> = { name, username, role, active, perms };
      // Blank on edit means "keep the current password".
      if (password) payload.password = password;
      await apiFetch(editing ? `/api/users/${initial!.id}` : "/api/users", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      toast("User saved");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? `Edit user — ${initial!.name}` : "Add user"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save user"}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>
          {error}
        </p>
      )}
      <FormRow>
        <FormField label="Full name *">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </FormField>
        <FormField label="Username *">
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField label={editing ? "New password (leave blank to keep)" : "Password *"}>
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </FormField>
        <FormField label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "USER")}>
            <option value="USER">User (permissions below)</option>
            <option value="ADMIN">Admin (full access)</option>
          </Select>
        </FormField>
        <FormField label="Status">
          <Select value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
            <option value="1">Active</option>
            <option value="0">Inactive (cannot sign in)</option>
          </Select>
        </FormField>
      </FormRow>

      {role !== "ADMIN" && (
        <>
          <h4 style={{ fontSize: 13, margin: "6px 0 8px" }}>Permissions</h4>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Module</Th>
                  {ACTIONS.map(([, label]) => (
                    <Th key={label} style={{ textAlign: "center" }}>
                      {label}
                    </Th>
                  ))}
                  <Th style={{ textAlign: "center" }}>All</Th>
                </tr>
              </thead>
              <tbody>
                {MODULES.map(([mod, label]) => {
                  const rowAll = ACTIONS.every(([act]) => isOn(mod, act));
                  return (
                    <tr key={mod}>
                      <Td>{label}</Td>
                      {ACTIONS.map(([act, actLabel]) => (
                        <Td key={act} style={{ textAlign: "center" }}>
                          <input
                            type="checkbox"
                            aria-label={`${actLabel} — ${label}`}
                            checked={isOn(mod, act)}
                            onChange={(e) => setOne(mod, act, e.target.checked)}
                          />
                        </Td>
                      ))}
                      <Td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          aria-label={`All actions — ${label}`}
                          title="Toggle all for this module"
                          checked={rowAll}
                          onChange={(e) => setRow(mod, e.target.checked)}
                        />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <Td>
                    <b>Everything</b>
                  </Td>
                  {ACTIONS.map(([act, actLabel]) => (
                    <Td key={act} style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        aria-label={`${actLabel} — all modules`}
                        title="Toggle this action for all modules"
                        checked={MODULES.every(([mod]) => isOn(mod, act))}
                        onChange={(e) => setColumn(act, e.target.checked)}
                      />
                    </Td>
                  ))}
                  <Td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      aria-label="Grant everything"
                      checked={MODULES.every(([mod]) => ACTIONS.every(([act]) => isOn(mod, act)))}
                      onChange={(e) => setEverything(e.target.checked)}
                    />
                  </Td>
                </tr>
              </tfoot>
            </Table>
          </TableWrap>
        </>
      )}
    </Modal>
  );
}
