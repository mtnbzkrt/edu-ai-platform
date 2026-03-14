FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN node backend/src/school/seed/seed.js
EXPOSE 3080
CMD ["node", "backend/server.js"]
