# syntax=docker/dockerfile:1
# Kabul Cargo web server: the React app built to static files, served by nginx, which also
# proxies /api/ and /admin/ to gunicorn and sends document files for Django (X-Accel-Redirect).
# Build context: the repository root (see docker-compose.yml).

FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM nginx:1.28-alpine
COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/snippets/ /etc/nginx/snippets/
COPY --from=build /src/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/nginx-health || exit 1
