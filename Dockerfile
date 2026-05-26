FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV HARDWARE_FLOW_STORE_PATH=/app/data/demo-store.json

COPY package.json ./
COPY apps ./apps
COPY schemas ./schemas
COPY templates ./templates

RUN addgroup -S hardware-flow && adduser -S hardware-flow -G hardware-flow \
  && mkdir -p /app/data \
  && chown -R hardware-flow:hardware-flow /app

USER hardware-flow

EXPOSE 3001

CMD ["npm", "start"]
