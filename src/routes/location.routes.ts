import express from "express";
import { upsertLocation, findNearby } from "../controllers/location.controller";

const router = express.Router();

/**
 * @swagger
 * /location/upsert:
 *   post:
 *     summary: Upsert user location
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userId:
 *                 type: string
 *               coordinate:
 *                 type: object
 *                 properties:
 *                   lat:
 *                     type: number
 *                   lng:
 *                     type: number
 *     responses:
 *       200:
 *         description: Location upserted successfully
 */
router.post("/upsert", upsertLocation);

/**
 * @swagger
 * /location/nearby:
 *   post:
 *     summary: Find nearby users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               coordinate:
 *                 type: object
 *                 properties:
 *                   lat:
 *                     type: number
 *                   lng:
 *                     type: number
 *     responses:
 *       200:
 *         description: List of nearby users
 */
router.post("/nearby", findNearby);

export default router;
