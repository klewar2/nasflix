-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('DOWNLOAD_TO_NAS', 'DELETE_FROM_SEEDBOX', 'DELETE_FROM_JELLYFIN');

-- CreateEnum
CREATE TYPE "JobSource" AS ENUM ('RADARR', 'SONARR', 'MANUAL', 'NAS_SYNC');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'AWAITING_NAS', 'AWAITING_SEEDBOX', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "CineClub" ADD COLUMN     "gmailAppPassword" TEXT,
ADD COLUMN     "gmailEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gmailFrom" TEXT,
ADD COLUMN     "nasSshHost" TEXT,
ADD COLUMN     "nasSshPort" INTEGER NOT NULL DEFAULT 22,
ADD COLUMN     "nasSshUser" TEXT,
ADD COLUMN     "nasTargetMovieDir" TEXT,
ADD COLUMN     "nasTargetSeriesDir" TEXT,
ADD COLUMN     "nasWolWaitSeconds" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "radarrApiKey" TEXT,
ADD COLUMN     "radarrBaseUrl" TEXT,
ADD COLUMN     "seedboxDeleteGraceHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "seedboxSshHost" TEXT,
ADD COLUMN     "seedboxSshPassphrase" TEXT,
ADD COLUMN     "seedboxSshPort" INTEGER NOT NULL DEFAULT 22,
ADD COLUMN     "seedboxSshPrivateKey" TEXT,
ADD COLUMN     "seedboxSshUser" TEXT,
ADD COLUMN     "sonarrApiKey" TEXT,
ADD COLUMN     "sonarrBaseUrl" TEXT;

-- AlterTable
ALTER TABLE "Episode" ADD COLUMN     "nasDeletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "nasDeletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Job" (
    "id" SERIAL NOT NULL,
    "cineClubId" INTEGER NOT NULL,
    "kind" "JobKind" NOT NULL,
    "source" "JobSource" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "tmdbId" INTEGER,
    "tmdbType" TEXT,
    "mediaId" INTEGER,
    "episodeId" INTEGER,
    "seasonNumber" INTEGER,
    "episodeNumber" INTEGER,
    "sourcePath" TEXT,
    "fileName" TEXT,
    "fileSize" BIGINT,
    "targetPath" TEXT,
    "jellyfinItemId" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "errorDetails" JSONB,
    "progressPercent" INTEGER,
    "triggeredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_cineClubId_kind_status_idx" ON "Job"("cineClubId", "kind", "status");

-- CreateIndex
CREATE INDEX "Job_status_scheduledFor_idx" ON "Job"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "Job_createdAt_idx" ON "Job"("createdAt");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_cineClubId_fkey" FOREIGN KEY ("cineClubId") REFERENCES "CineClub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
