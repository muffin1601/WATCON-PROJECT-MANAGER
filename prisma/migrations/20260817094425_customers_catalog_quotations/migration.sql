-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "ChargeMode" AS ENUM ('INCLUDED', 'EXTRA');

-- CreateEnum
CREATE TYPE "InstallBasis" AS ENUM ('PERCENT', 'LUMPSUM', 'PER_UNIT');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "refBy" TEXT,
ADD COLUMN     "salesPerson" TEXT;

-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "quoteNext" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "quotePrefix" TEXT NOT NULL DEFAULT 'WI/QTN/';

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normName" TEXT NOT NULL,
    "billing" TEXT,
    "delivery" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gstin" TEXT,
    "refBy" TEXT,
    "salesPerson" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normName" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'Nos',
    "category" TEXT,
    "hsn" TEXT,
    "details" TEXT,
    "makes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sellPrice" DECIMAL(14,2),
    "discountPct" DECIMAL(5,2),
    "purchasePrice" DECIMAL(14,2),
    "purchaseDiscPct" DECIMAL(5,2),
    "imagePath" TEXT,
    "imageMime" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_components" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "make" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT 'Nos',
    "qty" DECIMAL(14,3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "catalog_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT,
    "client" TEXT NOT NULL,
    "billing" TEXT,
    "delivery" TEXT,
    "title" TEXT NOT NULL,
    "refBy" TEXT,
    "salesPerson" TEXT,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "validityDays" INTEGER NOT NULL DEFAULT 30,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "installMode" "ChargeMode" NOT NULL DEFAULT 'INCLUDED',
    "installBasis" "InstallBasis" NOT NULL DEFAULT 'PERCENT',
    "installValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "transportMode" "ChargeMode" NOT NULL DEFAULT 'INCLUDED',
    "transportAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gstMode" "ChargeMode" NOT NULL DEFAULT 'EXTRA',
    "gstPct" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "roundTo" DECIMAL(14,2),
    "note" TEXT,
    "terms" TEXT,
    "showDetails" BOOLEAN NOT NULL DEFAULT false,
    "areaTotalsWithGst" BOOLEAN NOT NULL DEFAULT false,
    "sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "installAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "roundedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "convertedProjectId" TEXT,
    "convertedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "section" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL,
    "makes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "unit" TEXT NOT NULL DEFAULT 'Nos',
    "qty" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "discPct" DECIMAL(5,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_normName_key" ON "customers"("normName");

-- CreateIndex
CREATE INDEX "customers_archivedAt_idx" ON "customers"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_normName_key" ON "catalog_items"("normName");

-- CreateIndex
CREATE INDEX "catalog_items_category_idx" ON "catalog_items"("category");

-- CreateIndex
CREATE INDEX "catalog_items_archivedAt_idx" ON "catalog_items"("archivedAt");

-- CreateIndex
CREATE INDEX "catalog_components_catalogItemId_idx" ON "catalog_components"("catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_ref_key" ON "quotations"("ref");

-- CreateIndex
CREATE INDEX "quotations_customerId_idx" ON "quotations"("customerId");

-- CreateIndex
CREATE INDEX "quotations_status_idx" ON "quotations"("status");

-- CreateIndex
CREATE INDEX "quotations_date_idx" ON "quotations"("date");

-- CreateIndex
CREATE INDEX "quotation_items_quotationId_idx" ON "quotation_items"("quotationId");

-- CreateIndex
CREATE INDEX "projects_customerId_idx" ON "projects"("customerId");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_components" ADD CONSTRAINT "catalog_components_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_convertedProjectId_fkey" FOREIGN KEY ("convertedProjectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Data backfill (additive only — nothing is deleted or overwritten).
--
-- Until now a project's customer was a free-text `client` string. Create one
-- Customer row per distinct client name and link the existing projects to it,
-- so the new Customers screen opens with real history instead of being empty
-- and every existing project keeps its exact client name (projects.client is
-- left untouched and stays the rendered value).
-- ---------------------------------------------------------------------------
INSERT INTO "customers" ("id", "name", "normName", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    -- Keep the first-seen spelling as the display name.
    MIN(p."client"),
    lower(regexp_replace(btrim(p."client"), '\s+', ' ', 'g')),
    NOW(),
    NOW()
FROM "projects" p
WHERE btrim(COALESCE(p."client", '')) <> ''
GROUP BY lower(regexp_replace(btrim(p."client"), '\s+', ' ', 'g'))
ON CONFLICT ("normName") DO NOTHING;

UPDATE "projects" p
SET "customerId" = c."id"
FROM "customers" c
WHERE p."customerId" IS NULL
  AND lower(regexp_replace(btrim(p."client"), '\s+', ' ', 'g')) = c."normName";
