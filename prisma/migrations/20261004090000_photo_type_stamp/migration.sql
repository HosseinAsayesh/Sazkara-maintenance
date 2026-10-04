-- The store's stamped consent form gets its own photo slot. Kept alone in its own
-- migration: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "PhotoType" ADD VALUE IF NOT EXISTS 'STAMP';
