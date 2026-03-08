-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "audioFormat" TEXT,
ADD COLUMN     "dolbyAtmos" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dolbyVision" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hdr" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nasAddedAt" TIMESTAMP(3),
ADD COLUMN     "videoQuality" TEXT;
