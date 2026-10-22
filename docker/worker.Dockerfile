# Garmin sync worker: python health.py serve
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never PYTHONUNBUFFERED=1
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY health.py ./
COPY db/ db/
COPY skills/ skills/
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
ENV PATH="/app/.venv/bin:$PATH"
USER nobody
ENTRYPOINT ["entrypoint.sh"]
CMD ["python", "health.py", "serve"]
