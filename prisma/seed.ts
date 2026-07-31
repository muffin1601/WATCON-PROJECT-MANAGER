import { PrismaClient, ProjectType, ProjectStatus, ApprovalMode, TermsGst, TermsTransport } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.setting.upsert({
    where: { key: "default" },
    update: {},
    create: {
      key: "default",
      companyName: "Watcon International",
      address: "S-36, Okhla Phase 2, New Delhi 110020",
      phone: "9999969661",
      email: "info@watcon.net",
      gstRatePct: 18,
      challanPrefix: "WC/CH/",
      challanNext: 1,
      billPrefix: "RA-",
    },
  });

  const project = await prisma.project.upsert({
    where: { id: "seed-project-1" },
    update: {},
    create: {
      id: "seed-project-1",
      name: "DLF Camellias — Pool & Spa",
      client: "DLF Camellias RWA",
      site: "Gurugram, Sector 42",
      type: ProjectType.SWIMMING_POOL,
      status: ProjectStatus.IN_PROGRESS,
      approvalMode: ApprovalMode.PURCHASE_ORDER,
      poNumber: "PO/2026/0142",
      poDate: new Date("2026-06-15"),
      termsGst: TermsGst.EXTRA,
      termsTransport: TermsTransport.EXTRA,
      paymentTerms: "50% advance, 40% on delivery, 10% on completion",
      items: {
        create: [
          { description: "Filtration equipment — sand filter 24 inch", unit: "Nos", qty: 2, rate: 45000, sortOrder: 1 },
          { description: "Pool tiles — vitrified anti-skid", unit: "Sqft", qty: 1800, rate: 165, sortOrder: 2 },
          { description: "Underwater LED lights", unit: "Nos", qty: 10, rate: 3200, sortOrder: 3 },
        ],
      },
    },
  });

  console.log("Seeded settings and project:", project.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
