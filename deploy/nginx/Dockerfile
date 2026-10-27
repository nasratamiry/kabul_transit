# syntax=docker/dockerfile:1
# Kabul Cargo web server: the React app built to static files, served by nginx, which also
# proxies /api/ and the admin path to gunicorn and sends document files for Django (X-Accel-Redirect).
# Build context: the repository root (see docker-compose.yml). The final image holds only the
# built dist/ and the nginx config: no sources, no node_modules, no test tools.

FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build \
 && find dist -name '*.map' -delete

FROM nginx:1.28-alpine
# Replace only ${ADMIN_URL} in the template (see default.conf.template).
ENV NGINX_ENVSUBST_FILTER=^ADMIN_URL$
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/nginx/snippets/ /etc/nginx/snippets/
COPY --from=build /src/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/nginx-health || exit 1
