-- CreateTable
CREATE TABLE "SubtitleImageCache" (
    "id" SERIAL NOT NULL,
    "mediaId" INTEGER,
    "episodeId" INTEGER,
    "trackIdx" INTEGER NOT NULL,
    "language" TEXT NOT NULL,
    "codec" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubtitleImageCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubtitleImageCache_mediaId_idx" ON "SubtitleImageCache"("mediaId");

-- CreateIndex
CREATE INDEX "SubtitleImageCache_episodeId_idx" ON "SubtitleImageCache"("episodeId");

