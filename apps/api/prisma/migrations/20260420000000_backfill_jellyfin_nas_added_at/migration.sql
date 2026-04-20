-- Backfill nasAddedAt for Jellyfin items that were imported before the fix.
-- Uses createdAt as a fallback so they appear correctly in "recently added" lists.
UPDATE "Media"
SET "nasAddedAt" = "createdAt"
WHERE "nasAddedAt" IS NULL AND "sourceType" = 'SEEDBOX';
