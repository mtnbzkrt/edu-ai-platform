const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const path = require("path");

const app = express();
const HOST_BACKEND = process.env.HOST_BACKEND || "http://host.docker.internal:3081";

app.use(express.static(path.join(__dirname, "frontend")));

app.use("/api", createProxyMiddleware({
  target: HOST_BACKEND,
  changeOrigin: true,
}));

app.listen(3080, "0.0.0.0", () => {
  console.log("Proxy running on :3080 -> " + HOST_BACKEND);
});
