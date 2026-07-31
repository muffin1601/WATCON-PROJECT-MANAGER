// Thin JSON fetch wrapper used by client-side mutations (New/Edit project,
// Sales Order item CRUD, Payments). Reads still happen server-side via
// Prisma directly in Server Components — this is only for writes.

export class ApiError extends Error {
  issues?: unknown;
  constructor(message: string, issues?: unknown) {
    super(message);
    this.issues = issues;
  }
}

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || "Request failed", data.issues);
  }
  return data as T;
}
