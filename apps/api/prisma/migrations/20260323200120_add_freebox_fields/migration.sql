-- DropIndex
DROP INDEX "Media_nasPath_key";

-- AlterTable
ALTER TABLE "CineClub" ADD COLUMN     "freeboxApiUrl" TEXT,
ADD COLUMN     "freeboxAppToken" TEXT;
