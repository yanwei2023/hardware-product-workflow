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

RUN apk add --no-cache postgresql-client

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

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/ready').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
