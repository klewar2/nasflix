-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('PAST', 'UPCOMING');

-- CreateEnum
CREATE TYPE "TmdbMediaType" AS ENUM ('MOVIE', 'TV');

-- CreateEnum
CREATE TYPE "FeedbackVote" AS ENUM ('LIKE', 'DISLIKE', 'SEEN');

-- AlterTable
ALTER TABLE "CineClub" ADD COLUMN     "anthropicApiKey" TEXT,
ADD COLUMN     "nasWakeInProgress" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nasWakeStartedAt" TIMESTAMP(3),
ADD COLUMN     "nasWakeStartedByUserId" INTEGER,
ADD COLUMN     "recommendationsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" SERIAL NOT NULL,
    "cineClubId" INTEGER NOT NULL,
    "batchId" TEXT NOT NULL,
    "type" "RecommendationType" NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "tmdbType" "TmdbMediaType" NOT NULL,
    "title" TEXT NOT NULL,
    "overview" TEXT,
    "posterUrl" TEXT,
    "backdropUrl" TEXT,
    "trailerUrl" TEXT,
    "releaseDate" TIMESTAMP(3),
    "voteAverage" DOUBLE PRECISION,
    "genres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reasonText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationFeedback" (
    "id" SERIAL NOT NULL,
    "recommendationId" INTEGER,
    "userId" INTEGER NOT NULL,
    "vote" "FeedbackVote" NOT NULL,
    "cineClubId" INTEGER NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "tmdbType" "TmdbMediaType" NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecommendationFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Recommendation_cineClubId_type_createdAt_idx" ON "Recommendation"("cineClubId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_cineClubId_batchId_tmdbId_tmdbType_key" ON "Recommendation"("cineClubId", "batchId", "tmdbId", "tmdbType");

-- CreateIndex
CREATE INDEX "RecommendationFeedback_cineClubId_vote_idx" ON "RecommendationFeedback"("cineClubId", "vote");

-- CreateIndex
CREATE INDEX "RecommendationFeedback_userId_idx" ON "RecommendationFeedback"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationFeedback_cineClubId_userId_tmdbId_tmdbType_key" ON "RecommendationFeedback"("cineClubId", "userId", "tmdbId", "tmdbType");

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_cineClubId_fkey" FOREIGN KEY ("cineClubId") REFERENCES "CineClub"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationFeedback" ADD CONSTRAINT "RecommendationFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
