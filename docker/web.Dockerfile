# Web app + cloud MCP (Next.js standalone)
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# Placeholder secret only so the build runs; at runtime the random secret read by the entrypoint is used. Database connection errors (ECONNREFUSED) in the build log can be ignored
RUN BETTER_AUTH_SECRET=build-only-placeholder npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 AUTO_MIGRATE=1
COPY --from=build --chown=node /app/.next/standalone ./
COPY --from=build --chown=node /app/.next/static ./.next/static
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "server.js"]
