-- Full-project deletion password. Stores a scrypt hash only; the plaintext is
-- never written to the database and never sent to the browser.
ALTER TABLE "settings" ADD COLUMN "deletePasswordHash" TEXT;
