FROM node:22-bookworm-slim
WORKDIR /app
RUN npm install express http-proxy-middleware
COPY frontend/ ./frontend/
COPY proxy.js ./proxy.js
EXPOSE 3080
CMD ["node", "proxy.js"]
