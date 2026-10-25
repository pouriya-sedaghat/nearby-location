// Captured pre-fix 2.13.5 erasure behavior, isolated from current schemas.
// It intentionally strips unknown fields and has no exact-erasure route.
const express = require("express");
const { verifyBearerAuthorization } = require("../../dist/utils/auth-core");
exports.createLegacyPrivacyApp = (pool, token) => {
  const app = express();
  app.use((req, res, next) => verifyBearerAuthorization(req.header("authorization"), token).authorized
    ? next() : res.status(401).json({ success: false, message: "Unauthorized" }));
  app.use(express.json({ limit: "32kb" }));
  app.post("/privacy/location/delete", async (req, res, next) => {
    const id = req.body?.userId;
    if (typeof id !== "string" || !id.trim() || id.trim().length > 255) return res.sendStatus(400);
    try { await pool.query("DELETE FROM locations WHERE user_id = $1", [id.trim()]); res.status(204).end(); }
    catch (error) { next(error); }
  });
  return app;
};
