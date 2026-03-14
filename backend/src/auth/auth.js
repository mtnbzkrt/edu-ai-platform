const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const SECRET = process.env.JWT_SECRET || "edu-ai-secret-key-2026";

function generateToken(user, actorId, permissions) {
  return jwt.sign({
    user_id: user.id,
    role: user.role,
    school_id: user.school_id,
    actor_id: actorId,
    full_name: user.full_name,
    permissions
  }, SECRET, { expiresIn: "24h" });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Missing or invalid token" } });
  }
  try {
    req.auth = verifyToken(header.slice(7));
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Token expired or invalid" } });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: `Role '${req.auth.role}' not allowed` } });
    }
    next();
  };
}

module.exports = { generateToken, verifyToken, authMiddleware, requireRole, SECRET, bcrypt };
