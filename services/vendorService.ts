import { prisma } from "../lib/prisma";
import type { VendorInput, VendorUpdateInput } from "../modules/purchase/schema";

// Suppliers — ported from the prototype's vendorFormModal / the Suppliers card
// on renderPurchase(). Same fields, same actions (add, edit); the prototype has
// no supplier deletion, so neither does this.

export class VendorValidationError extends Error {}

export interface VendorDto {
  id: string;
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
}

const blankToNull = (v: string | undefined) => (v === undefined ? undefined : v.trim() === "" ? null : v.trim());

export async function listVendors(): Promise<VendorDto[]> {
  return prisma.vendor.findMany({
    select: { id: true, name: true, contact: true, phone: true, email: true, gstin: true, address: true },
    orderBy: { name: "asc" },
  });
}

export async function createVendor(input: VendorInput): Promise<VendorDto> {
  const name = input.name.trim();
  if (!name) throw new VendorValidationError("Supplier name is required");
  return prisma.vendor.create({
    data: {
      name,
      contact: blankToNull(input.contact) ?? null,
      phone: blankToNull(input.phone) ?? null,
      email: blankToNull(input.email) ?? null,
      gstin: blankToNull(input.gstin) ?? null,
      address: blankToNull(input.address) ?? null,
    },
    select: { id: true, name: true, contact: true, phone: true, email: true, gstin: true, address: true },
  });
}

export async function updateVendor(id: string, input: VendorUpdateInput): Promise<VendorDto> {
  if (input.name !== undefined && !input.name.trim()) {
    throw new VendorValidationError("Supplier name is required");
  }
  return prisma.vendor.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      contact: blankToNull(input.contact),
      phone: blankToNull(input.phone),
      email: blankToNull(input.email),
      gstin: blankToNull(input.gstin),
      address: blankToNull(input.address),
    },
    select: { id: true, name: true, contact: true, phone: true, email: true, gstin: true, address: true },
  });
}
