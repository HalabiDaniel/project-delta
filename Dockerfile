# The paperwars.io game server (v0.0.14), as Railway builds and runs it. Railway finds this file
# and uses it on its own; the same image also runs the daily backup job (npm run db:backup), which
# is why it carries the PostgreSQL client tools. See docs/SERVER_SETUP.md.
#
#   docker build -t paperwars-server .
#   docker run -p 2567:2567 -e PORT=2567 paperwars-server          # memory store, open access
FROM node:22-bookworm-slim

# pg_dump / pg_restore / psql from the PostgreSQL project's own repository: version 18 reads and
# writes every server version up to 18, whichever one Railway's database runs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-18 \
 && apt-get purge -y curl && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# The server runs its TypeScript through tsx (a dev dependency), so dev dependencies are installed.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund

COPY tsconfig.json ./
COPY server ./server
COPY src ./src

ENV NODE_ENV=production
# Railway sets PORT; 2567 when run elsewhere.
ENV PORT=2567
EXPOSE 2567
# node directly (not npm), so Railway's SIGTERM reaches the server and the graceful shutdown runs.
CMD ["node", "--import", "tsx", "server/index.ts"]
