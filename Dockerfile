FROM node:22-bookworm-slim
WORKDIR /app

# Simple reverse proxy to host backend
RUN npm install express http-proxy-middleware

COPY frontend/ ./frontend/

# Proxy server
RUN cat > proxy.js << 'PROXYEOF'
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const path = require("path");

const app = express();
const HOST_BACKEND = process.env.HOST_BACKEND || "http://host.docker.internal:3081";

// Serve frontend static files
app.use(express.static(path.join(__dirname, "frontend")));

// Proxy API calls to host backend
app.use("/api", createProxyMiddleware({
  target: HOST_BACKEND,
  changeOrigin: true,
}));

app.listen(3080, "0.0.0.0", () => {
  console.log("Proxy running on :3080 -> " + HOST_BACKEND);
});
PROXYEOF

EXPOSE 3080
CMD ["node", "proxy.js"]
