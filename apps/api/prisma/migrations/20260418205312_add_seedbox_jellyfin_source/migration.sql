-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('NAS', 'SEEDBOX');

-- AlterTable
ALTER TABLE "CineClub" ADD COLUMN     "jellyfinApiToken" TEXT,
ADD COLUMN     "jellyfinBaseUrl" TEXT;

-- AlterTable
ALTER TABLE "Episode" ADD COLUMN     "jellyfinItemId" TEXT,
ADD COLUMN     "sourceType" "SourceType" NOT NULL DEFAULT 'NAS';

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "jellyfinItemId" TEXT,
ADD COLUMN     "sourceType" "SourceType" NOT NULL DEFAULT 'NAS';
