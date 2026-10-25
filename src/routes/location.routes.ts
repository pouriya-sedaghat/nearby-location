import { Router } from "express";
import { createLocationController } from "../controllers/location.controller";

export const createLocationRoutes = (controller: ReturnType<typeof createLocationController>) => {
  const router = Router();
  router.post("/upsert", controller.upsertLocation);
  router.post("/nearby", controller.findNearby);
  return router;
};
