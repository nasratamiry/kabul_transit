# syntax=docker/dockerfile:1
# Kabul Cargo database: the official MySQL 8.4 image plus our first-start script, built into the
# image so the stack needs no bind mount from the repository (Coolify deploys from a build, not a
# checked-out folder). The official entrypoint already loads the time-zone tables (CONVERT_TZ to
# Asia/Kabul) when the data volume is first created.
# Build context: the repository root (see docker-compose.yml).
FROM mysql:8.4
COPY deploy/mysql/init/ /docker-entrypoint-initdb.d/
