FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN node backend/src/school/seed/seed.js
EXPOSE 3080
CMD ["node", "backend/server.js"]
