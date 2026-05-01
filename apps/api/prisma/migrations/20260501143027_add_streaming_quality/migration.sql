-- CreateEnum
CREATE TYPE "StreamingQuality" AS ENUM ('NATIVE', 'DIRECT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "streamingQuality" "StreamingQuality" NOT NULL DEFAULT 'NATIVE';
