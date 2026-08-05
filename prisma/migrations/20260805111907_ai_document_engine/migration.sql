-- CreateEnum
CREATE TYPE "ExtractionStage" AS ENUM ('UPLOADING', 'READING', 'OCR', 'EXTRACTING', 'VALIDATING', 'GENERATING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ExtractionJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExtractionJobKind" AS ENUM ('ORDER', 'CHALLAN', 'CLASSIFY');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "extraction_jobs" (
    "id" TEXT NOT NULL,
    "kind" "ExtractionJobKind" NOT NULL,
    "status" "ExtractionJobStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" "ExtractionStage" NOT NULL DEFAULT 'UPLOADING',
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "projectId" TEXT,
    "documentId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "sourceKind" TEXT,
    "detectedType" TEXT,
    "modelUsed" TEXT,
    "result" JSONB,
    "usage" JSONB,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "extraction_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" TEXT NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'RUNNING',
    "fileName" TEXT,
    "sizeBytes" INTEGER,
    "destination" TEXT NOT NULL DEFAULT 'google-drive',
    "remoteFileId" TEXT,
    "projectCount" INTEGER,
    "checksum" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "extraction_jobs_projectId_idx" ON "extraction_jobs"("projectId");

-- CreateIndex
CREATE INDEX "extraction_jobs_status_createdAt_idx" ON "extraction_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "backup_runs_status_startedAt_idx" ON "backup_runs"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "extraction_jobs" ADD CONSTRAINT "extraction_jobs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_jobs" ADD CONSTRAINT "extraction_jobs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
