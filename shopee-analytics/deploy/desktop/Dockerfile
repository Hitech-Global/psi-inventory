FROM node:22.22.2-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY shopee-analytics ./shopee-analytics
COPY skills/shopee-gmv-max ./skills/shopee-gmv-max

ENV NODE_ENV=production

CMD ["node", "shopee-analytics/src/standalone-server.js"]
