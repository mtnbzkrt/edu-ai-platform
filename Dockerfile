FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY frontend/ ./frontend/
ENV PORT=3080
EXPOSE 3080
CMD ["node", "server.js"]
