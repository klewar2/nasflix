-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('ADMIN', 'VIEWER');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CineClub" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nasBaseUrl" TEXT,
    "nasSharedFolders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tmdbApiKey" TEXT,
    "lastOnlineAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CineClub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CineClubMember" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "cineClubId" INTEGER NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'VIEWER',
    "nasUsername" TEXT,
    "nasPassword" TEXT,

    CONSTRAINT "CineClubMember_pkey" PRIMARY KEY ("id")
);

-- Drop old tables
DROP TABLE IF EXISTS "NasConfig" CASCADE;
DROP TABLE IF EXISTS "ApiConfig" CASCADE;

-- Add cineClubId to Media (nullable first, then fill, then set NOT NULL)
ALTER TABLE "Media" ADD COLUMN "cineClubId" INTEGER;

-- Add cineClubId to SyncLog
ALTER TABLE "SyncLog" ADD COLUMN "cineClubId" INTEGER;

-- Drop old unique constraint on nasPath
ALTER TABLE "Media" DROP CONSTRAINT IF EXISTS "Media_nasPath_key";

-- Create default CineClub
INSERT INTO "CineClub" ("name", "slug", "updatedAt") VALUES ('Nasflix', 'nasflix', CURRENT_TIMESTAMP);

-- Fill cineClubId in Media with the default club
UPDATE "Media" SET "cineClubId" = (SELECT id FROM "CineClub" WHERE slug = 'nasflix' LIMIT 1);

-- Now make cineClubId NOT NULL
ALTER TABLE "Media" ALTER COLUMN "cineClubId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "CineClub_slug_key" ON "CineClub"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "CineClubMember_userId_cineClubId_key" ON "CineClubMember"("userId", "cineClubId");

-- CreateIndex
CREATE UNIQUE INDEX "Media_cineClubId_nasPath_key" ON "Media"("cineClubId", "nasPath");

-- CreateIndex
CREATE INDEX "Media_cineClubId_type_idx" ON "Media"("cineClubId", "type");

-- CreateIndex
CREATE INDEX "Media_cineClubId_syncStatus_idx" ON "Media"("cineClubId", "syncStatus");

-- CreateIndex
CREATE INDEX "Media_cineClubId_titleVf_idx" ON "Media"("cineClubId", "titleVf");

-- CreateIndex
CREATE INDEX "Media_cineClubId_releaseYear_idx" ON "Media"("cineClubId", "releaseYear");

-- CreateIndex
CREATE INDEX "Media_cineClubId_createdAt_idx" ON "Media"("cineClubId", "createdAt");

-- Drop old indexes
DROP INDEX IF EXISTS "Media_type_idx";
DROP INDEX IF EXISTS "Media_syncStatus_idx";
DROP INDEX IF EXISTS "Media_titleVf_idx";
DROP INDEX IF EXISTS "Media_releaseYear_idx";
DROP INDEX IF EXISTS "Media_createdAt_idx";

-- AddForeignKey
ALTER TABLE "CineClubMember" ADD CONSTRAINT "CineClubMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CineClubMember" ADD CONSTRAINT "CineClubMember_cineClubId_fkey" FOREIGN KEY ("cineClubId") REFERENCES "CineClub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_cineClubId_fkey" FOREIGN KEY ("cineClubId") REFERENCES "CineClub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_cineClubId_fkey" FOREIGN KEY ("cineClubId") REFERENCES "CineClub"("id") ON DELETE SET NULL ON UPDATE CASCADE;
