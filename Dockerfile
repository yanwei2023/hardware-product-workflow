FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN npm ci

COPY apps ./apps
COPY schemas ./schemas
COPY templates ./templates

RUN npm run web:build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV HARDWARE_FLOW_STORE_PATH=/app/data/demo-store.json

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /app/apps ./apps
COPY --from=build /app/schemas ./schemas
COPY --from=build /app/templates ./templates

RUN addgroup -S hardware-flow && adduser -S hardware-flow -G hardware-flow \
  && mkdir -p /app/data \
  && chown -R hardware-flow:hardware-flow /app

USER hardware-flow

EXPOSE 3001

CMD ["npm", "start"]
