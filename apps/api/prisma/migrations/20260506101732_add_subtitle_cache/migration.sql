-- CreateTable
CREATE TABLE "SubtitleCache" (
    "id" SERIAL NOT NULL,
    "mediaId" INTEGER,
    "episodeId" INTEGER,
    "trackIdx" INTEGER NOT NULL,
    "language" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "codec" TEXT NOT NULL,
    "vttContent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubtitleCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubtitleCache_mediaId_idx" ON "SubtitleCache"("mediaId");

-- CreateIndex
CREATE INDEX "SubtitleCache_episodeId_idx" ON "SubtitleCache"("episodeId");
