# SurgeAPI backend (provider wallet + market + worker).
# Env (set as host secrets, never baked in): PROVIDER_KEY, optional PASS_TOKEN_ID, OVERLAY_URL.
# Mount a persistent volume at /app/.local: it holds the provider wallet database.
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
