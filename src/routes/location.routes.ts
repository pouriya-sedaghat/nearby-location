import express from "express";
import { upsertLocation, findNearby } from "../controllers/location.controller";
import { admissionMiddleware } from "../middleware/admission.middleware";

const router = express.Router();

router.post("/upsert", admissionMiddleware("upsert", upsertLocation));

router.post("/nearby", admissionMiddleware("nearby", findNearby));

export default router;
