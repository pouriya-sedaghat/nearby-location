import express from "express";
import { prometheusMetrics } from "../controllers/metrics.controller";

const router = express.Router();

router.get("/", prometheusMetrics);

export default router;
