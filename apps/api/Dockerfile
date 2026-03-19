FROM node:20-alpine

RUN apk add --no-cache ffmpeg

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN cd apps/api && pnpm build

EXPOSE 4000

CMD ["sh", "-c", "./apps/api/node_modules/.bin/prisma migrate deploy --schema=./apps/api/prisma/schema.prisma && node apps/api/dist/main"]
