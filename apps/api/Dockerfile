FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN cd apps/api && pnpm build

FROM node:20-alpine

RUN apk add --no-cache ffmpeg

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile --prod

# Generate Prisma client for the target platform
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
RUN ./apps/api/node_modules/.bin/prisma generate --schema=./apps/api/prisma/schema.prisma

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/shared ./packages/shared

EXPOSE 4000

CMD ["sh", "-c", "./apps/api/node_modules/.bin/prisma migrate deploy --schema=./apps/api/prisma/schema.prisma && node apps/api/dist/main"]
