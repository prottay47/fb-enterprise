FROM nginx:alpine

# Copy custom nginx configuration supporting both port 80 and 3000
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy static website files to nginx html root
COPY . /usr/share/nginx/html

# Expose both standard web port and Coolify default port
EXPOSE 80 3000

CMD ["nginx", "-g", "daemon off;"]
