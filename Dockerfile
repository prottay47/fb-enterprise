FROM node:22-alpine

WORKDIR /app

# Website, dashboard and server (no npm packages needed)
COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

# Uploaded banners live here. Mount a persistent volume on /app/data
# so they survive redeploys. Set ADMIN_PASSWORD in the hosting panel.
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000

# Lets Coolify know when the site is up and answering
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3   CMD wget -qO /dev/null http://127.0.0.1:3000/robots.txt || exit 1

CMD ["node", "server.js"]
