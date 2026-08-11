-- Chunked extraction state: a long PDF is read one page-range per invocation,
-- so the partial results and the slice locations must survive between calls.
ALTER TABLE "extraction_jobs" ADD COLUMN "totalChunks" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "extraction_jobs" ADD COLUMN "chunksDone" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "extraction_jobs" ADD COLUMN "chunkPaths" JSONB;
ALTER TABLE "extraction_jobs" ADD COLUMN "chunkResults" JSONB;
ALTER TABLE "extraction_jobs" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
