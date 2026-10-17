# syntax=docker/dockerfile:1
FROM node:22-alpine AS web
WORKDIR /build/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
ARG APP_VERSION=development
ARG APP_REVISION=unknown
ARG APP_UPDATE_REPOSITORY=shelton-hu/bookmark-app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/data PORT=8000
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 10001 bookmark \
    && useradd --uid 10001 --gid bookmark --no-create-home bookmark \
    && mkdir -p /data && chown bookmark:bookmark /data
COPY backend/ ./backend/
RUN python -c 'import json,sys; from pathlib import Path; Path("backend/_build.json").write_text(json.dumps(dict(zip(("version","revision","repository"), sys.argv[1:]))))' "$APP_VERSION" "$APP_REVISION" "$APP_UPDATE_REPOSITORY"
COPY --from=web /build/web/dist ./web/dist
RUN chmod -R a+rX /app/backend /app/web
USER bookmark
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
