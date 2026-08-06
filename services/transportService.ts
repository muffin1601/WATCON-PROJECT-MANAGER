import { prisma } from "../lib/prisma";
import type { TransportInput, TransportUpdateInput } from "../modules/projects/schema";

// Transport bills against a project (prototype's tabTransport /
// transportModal, plus the optional transport section of challanModal).

export async function addTransport(projectId: string, input: TransportInput) {
  return prisma.transport.create({
    data: {
      projectId,
      date: new Date(input.date),
      amount: input.amount,
      transporter: input.transporter || null,
      ref: input.ref || null,
      vehicle: input.vehicle || null,
      challanId: input.challanId || null,
    },
  });
}

export async function updateTransport(transportId: string, input: TransportUpdateInput) {
  return prisma.transport.update({
    where: { id: transportId },
    data: {
      ...(input.date !== undefined && { date: new Date(input.date) }),
      ...(input.amount !== undefined && { amount: input.amount }),
      ...(input.transporter !== undefined && { transporter: input.transporter || null }),
      ...(input.ref !== undefined && { ref: input.ref || null }),
      ...(input.vehicle !== undefined && { vehicle: input.vehicle || null }),
      ...(input.challanId !== undefined && { challanId: input.challanId || null }),
    },
  });
}

export async function deleteTransport(transportId: string) {
  return prisma.transport.delete({ where: { id: transportId } });
}
