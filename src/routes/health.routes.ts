import express from "express";
import { liveness, readiness } from "../controllers/health.controller";

const router = express.Router();

router.get("/live", liveness);

router.get("/ready", readiness);

export default router;
