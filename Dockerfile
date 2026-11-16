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

CMD ["node", "server.js"]
