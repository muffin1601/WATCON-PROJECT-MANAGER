import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

// Prisma throws P2025 ("Record to update/delete does not exist") for any
// PATCH/DELETE against an id that isn't there, and P2003 (foreign key
// violation) when a CREATE references a parent id that doesn't exist
// (e.g. POSTing a Sales Order item for a projectId that was never real).
// Every mutation route needs to map both to a clean 404 instead of letting
// them fall through to a raw 500. Centralized so every route handler's
// catch block behaves the same way.
export function isNotFoundError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2025" || err.code === "P2003");
}

// P2002 = unique constraint violation (e.g. two challans with the same
// number on the same project) — a client error (409 Conflict), not a
// server fault.
export function isConflictError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export function apiErrorResponse(
  err: unknown,
  notFoundMessage: string,
  genericMessage: string,
  conflictMessage?: string
) {
  if (isNotFoundError(err)) {
    return NextResponse.json({ error: notFoundMessage }, { status: 404 });
  }
  if (conflictMessage && isConflictError(err)) {
    return NextResponse.json({ error: conflictMessage }, { status: 409 });
  }
  console.error(err);
  return NextResponse.json({ error: genericMessage }, { status: 500 });
}
