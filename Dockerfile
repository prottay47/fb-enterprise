FROM node:22-alpine

WORKDIR /app

# Website, dashboard and server (no npm packages needed)
COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

# Everything saved from the dashboard (products, banners, uploads, quotation
# requests, statistics) lives in /app/data. In Coolify, add Persistent Storage →
# Volume Mount with destination /app/data, or it is lost on every redeploy.
# (No VOLUME line here on purpose: it would silently create a new, empty,
# unnamed volume for each new container.)
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 3000

# Lets Coolify know when the site is up and answering
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3   CMD wget -qO /dev/null http://127.0.0.1:3000/robots.txt || exit 1

CMD ["node", "server.js"]
