"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle } from "../Card/Card";
import { Button } from "../Button/Button";
import { FormField } from "../Form/FormField";
import { TextInput } from "../Form/Inputs";
import { apiFetch, ApiError } from "../../lib/apiClient";

// Ported from renderLogin(): username, password, one shared error line, and the
// first-time hint. Enter submits from either field.
export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      // refresh() re-runs the server layout, which now sees the session cookie.
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not reach the server. Check your connection and try again."
      );
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <Card style={{ maxWidth: 420, margin: "40px auto" }}>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
      </CardHeader>
      <CardBody>
        <FormField label="Username">
          <TextInput
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={onKey}
            autoComplete="username"
            autoFocus
          />
        </FormField>
        <FormField label="Password">
          <TextInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={onKey}
            autoComplete="current-password"
          />
        </FormField>
        {error && (
          <p role="alert" style={{ color: "var(--danger)", fontSize: 12.5 }}>
            {error}
          </p>
        )}
        <Button variant="primary" onClick={submit} disabled={busy} style={{ width: "100%", marginTop: 6 }}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 12 }}>
          First time? The default admin login is <b>admin</b> / the software password. Change it from the Admin panel
          after signing in.
        </p>
      </CardBody>
    </Card>
  );
}
