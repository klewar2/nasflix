-- AlterTable
ALTER TABLE "CineClub" ADD COLUMN "webhookSecret" TEXT,
ADD COLUMN "nasWolMac" TEXT,
ADD COLUMN "nasWolHost" TEXT,
ADD COLUMN "nasWolPort" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "CineClub_webhookSecret_key" ON "CineClub"("webhookSecret");
