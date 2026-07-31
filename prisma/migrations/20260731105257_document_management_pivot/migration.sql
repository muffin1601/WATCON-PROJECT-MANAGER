-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentKind" ADD VALUE 'PURCHASE_ORDER';
ALTER TYPE "DocumentKind" ADD VALUE 'BOQ';
ALTER TYPE "DocumentKind" ADD VALUE 'DRAWING';
ALTER TYPE "DocumentKind" ADD VALUE 'INVOICE';
ALTER TYPE "DocumentKind" ADD VALUE 'VENDOR_DOCUMENT';
ALTER TYPE "DocumentKind" ADD VALUE 'RUNNING_BILL_COPY';
ALTER TYPE "DocumentKind" ADD VALUE 'PHOTO';

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "rootDocumentId" TEXT,
ADD COLUMN     "versionNumber" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "document_texts" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "rawText" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_texts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_texts_documentId_idx" ON "document_texts"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "document_texts_documentId_pageNumber_key" ON "document_texts"("documentId", "pageNumber");

-- CreateIndex
CREATE INDEX "documents_rootDocumentId_idx" ON "documents"("rootDocumentId");

-- CreateIndex
CREATE INDEX "documents_checksum_idx" ON "documents"("checksum");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_rootDocumentId_fkey" FOREIGN KEY ("rootDocumentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_texts" ADD CONSTRAINT "document_texts_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
