import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/auth";
import { sanitizePerms, type PermissionMap } from "../modules/auth/permissions";
import type { UserInput, UserUpdateInput } from "../modules/auth/schema";

// Admin panel — user accounts and their per-module permissions.

export class UserValidationError extends Error {}
export class UserConflictError extends Error {}

export interface UserDto {
  id: string;
  name: string;
  username: string;
  role: "ADMIN" | "USER";
  active: boolean;
  perms: PermissionMap;
  createdAt: string;
}

// passwordHash is never selected — it must not reach any payload.
const userSelect = {
  id: true,
  name: true,
  username: true,
  role: true,
  active: true,
  perms: true,
  createdAt: true,
} as const;

function toDto(u: {
  id: string;
  name: string;
  username: string;
  role: "ADMIN" | "USER";
  active: boolean;
  perms: unknown;
  createdAt: Date;
}): UserDto {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    role: u.role,
    active: u.active,
    perms: (u.perms as PermissionMap) ?? {},
    createdAt: u.createdAt.toISOString(),
  };
}

export async function listUsers(): Promise<UserDto[]> {
  const rows = await prisma.user.findMany({ select: userSelect, orderBy: { createdAt: "asc" } });
  return rows.map(toDto);
}

export async function createUser(input: UserInput): Promise<UserDto> {
  const norm = input.username.trim().toLowerCase();
  if (!norm) throw new UserValidationError("Username is required");
  if (!input.password) throw new UserValidationError("Password is required");

  const clash = await prisma.user.findUnique({ where: { normUsername: norm } });
  if (clash) throw new UserConflictError("That username is already taken.");

  const created = await prisma.user.create({
    data: {
      name: input.name.trim(),
      username: input.username.trim(),
      normUsername: norm,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      active: input.active,
      // Admins carry no permission map: can() short-circuits for them, and
      // storing one would imply it could be narrowed, which it cannot.
      perms: input.role === "ADMIN" ? {} : sanitizePerms(input.perms),
    },
    select: userSelect,
  });
  return toDto(created);
}

export async function updateUser(id: string, input: UserUpdateInput): Promise<UserDto> {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new UserValidationError("User not found");

  if (input.username !== undefined) {
    const norm = input.username.trim().toLowerCase();
    if (!norm) throw new UserValidationError("Username is required");
    const clash = await prisma.user.findUnique({ where: { normUsername: norm } });
    if (clash && clash.id !== id) throw new UserConflictError("That username is already taken.");
  }

  const nextRole = input.role ?? existing.role;

  // Guard rail the prototype had implicitly by making the seeded admin
  // read-only: never let the last active administrator be demoted or
  // deactivated, which would lock everyone out of the Admin panel for good.
  const losingAdmin =
    (existing.role === "ADMIN" && nextRole !== "ADMIN") ||
    (existing.role === "ADMIN" && input.active === false);
  if (losingAdmin) {
    const otherActiveAdmins = await prisma.user.count({
      where: { role: "ADMIN", active: true, id: { not: id } },
    });
    if (otherActiveAdmins === 0) {
      throw new UserValidationError(
        "This is the only active administrator. Promote another user to admin first."
      );
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.username !== undefined
        ? { username: input.username.trim(), normUsername: input.username.trim().toLowerCase() }
        : {}),
      // A blank password field means "keep the current password", exactly as
      // the prototype's Admin form behaved.
      ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.perms !== undefined || input.role !== undefined
        ? { perms: nextRole === "ADMIN" ? {} : sanitizePerms(input.perms ?? existing.perms) }
        : {}),
    },
    select: userSelect,
  });
  return toDto(updated);
}

export async function deleteUser(id: string, currentUserId: string): Promise<void> {
  if (id === currentUserId) {
    throw new UserValidationError("You cannot delete the account you are signed in with.");
  }
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new UserValidationError("User not found");

  if (user.role === "ADMIN") {
    const otherActiveAdmins = await prisma.user.count({
      where: { role: "ADMIN", active: true, id: { not: id } },
    });
    if (otherActiveAdmins === 0) {
      throw new UserValidationError("This is the only active administrator and cannot be deleted.");
    }
  }
  // Sessions cascade, so deleting a user signs them out everywhere at once.
  await prisma.user.delete({ where: { id } });
}
