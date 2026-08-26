FROM node:20-alpine AS build

WORKDIR /app

ARG DATABASE_URL=postgresql://placeholder:5432/placeholder
ENV DATABASE_URL=$DATABASE_URL

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json

RUN npm ci

COPY . .

RUN npm run prisma:generate -w server
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime

ENV NODE_ENV=production

RUN addgroup -g 10001 -S jwtapp && adduser -S -D -u 10001 -G jwtapp jwtapp

WORKDIR /app/server

COPY --from=build --chown=jwtapp:jwtapp /app/node_modules /app/node_modules
COPY --from=build --chown=jwtapp:jwtapp /app/server /app/server

USER jwtapp

CMD ["node", "src/index.js"]
