import { Router } from "express";
import { createHealthController } from "../controllers/health.controller";

export const createHealthRoutes = (controller: ReturnType<typeof createHealthController>) => {
  const router = Router();
  router.get("/live", controller.liveness);
  router.get("/ready", controller.readiness);
  return router;
};
