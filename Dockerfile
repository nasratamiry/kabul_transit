# syntax=docker/dockerfile:1
# Kabul Cargo backend: Django + gunicorn, non-root, static files collected at build time.
# The runtime image holds Python code and production packages only: no compiler, no tests,
# no docs, no frontend (see .dockerignore).

# ---- build: compile the wheels (mysqlclient needs a compiler and the client headers)
FROM python:3.12-slim-bookworm AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential pkg-config default-libmysqlclient-dev \
 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /tmp/
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r /tmp/requirements.txt

# ---- runtime
FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    TZ=Asia/Kabul \
    DJANGO_SETTINGS_MODULE=kabulcargo_backend.settings_production
# libmariadb3: MySQL client library for mysqlclient; mariadb-client: mysqldump / mysql for
# backup_db and restore_db; tzdata: Kabul time for the backup schedule.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libmariadb3 mariadb-client tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app
COPY --from=build /wheels /wheels
RUN pip install --no-cache-dir /wheels/* && rm -rf /wheels

WORKDIR /app
COPY --chown=app:app . .
# collectstatic only reads the settings; these placeholder values never reach a running server.
RUN SECRET_KEY=collectstatic-only DB_NAME=x DB_USER=x DB_PASSWORD=x \
    DJANGO_SETTINGS_MODULE=kabulcargo_backend.settings \
    python manage.py collectstatic --noinput --verbosity 0 \
 && mkdir -p media logs backups /srv/static \
 && chown -R app:app media logs backups staticfiles /srv/static \
 && chmod +x deploy/docker/*.sh

USER app
EXPOSE 8000
ENTRYPOINT ["/app/deploy/docker/entrypoint.sh"]
CMD ["sh", "-c", "exec gunicorn kabulcargo_backend.wsgi:application --bind 0.0.0.0:8000 --workers ${GUNICORN_WORKERS:-3} --timeout 120 --graceful-timeout 30 --max-requests 2000 --max-requests-jitter 200 --access-logfile - --error-logfile -"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 CMD ["python", "/app/deploy/docker/healthcheck.py"]
