const jwt = require("jsonwebtoken");
const blocklist = require("../../services/blocklistService");

const VALID_ROLES = ["admin", "manager", "user"];

const isUUID = (id) =>
  /^[0-9a-fA-F-]{36}$/.test(id);

const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = header.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 🔥 Claims validation
    if (!decoded.userId || !isUUID(decoded.userId)) {
      return res.status(401).json({ error: "Invalid token" });
    }

    if (!VALID_ROLES.includes(decoded.role)) {
      return res.status(403).json({ error: "Invalid role" });
    }

    if (decoded.isActive !== true) {
      return res.status(403).json({ error: "User inactive" });
    }

    // 🔥 Blocklist check
    const blocked = await blocklist.isBlocked(decoded.jti);
    if (blocked) {
      return res.status(401).json({ error: "Token revoked" });
    }

    req.user = decoded;

    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

module.exports = authenticate;