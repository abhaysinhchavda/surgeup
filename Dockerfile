# SurgeAPI backend (provider wallet + market + worker).
# Env (set as host secrets, never baked in): PROVIDER_KEY, optional PASS_TOKEN_ID, OVERLAY_URL.
# Mount a persistent volume at /app/.local: it holds the provider wallet database.
FROM node:24-slim
WORKDIR /app
# better-sqlite3 compiles from source when no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
