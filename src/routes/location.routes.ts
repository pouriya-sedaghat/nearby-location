import express from "express";
import { upsertLocation, findNearby } from "../controllers/location.controller";

const router = express.Router();

/**
 * @swagger
 * /location/upsert:
 *   post:
 *     tags:
 *       - Location
 *     summary: Upsert user location
 *     description: Create or update user location using userId and coordinate
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - coordinate
 *             properties:
 *               userId:
 *                 type: string
 *                 example: user_123
 *               coordinate:
 *                 type: object
 *                 required:
 *                   - lat
 *                   - lng
 *                 properties:
 *                   lat:
 *                     type: number
 *                     example: 35.6892
 *                   lng:
 *                     type: number
 *                     example: 51.3890
 *     responses:
 *       200:
 *         description: Location upserted successfully
 *       400:
 *         description: Invalid request body
 *       500:
 *         description: Internal server error
 */
router.post("/upsert", upsertLocation);

/**
 * @swagger
 * /location/nearby:
 *   post:
 *     tags:
 *       - Location
 *     summary: Find nearby users
 *     description: Find nearby users based on coordinate with pagination
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *           minimum: 1
 *         required: false
 *         description: Page number
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *         required: false
 *         description: Number of items per page
 *       - in: query
 *         name: maxDistance
 *         schema:
 *           type: number
 *         required: false
 *         description: Maximum distance in meters
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - coordinate
 *             properties:
 *               coordinate:
 *                 type: object
 *                 required:
 *                   - lat
 *                   - lng
 *                 properties:
 *                   lat:
 *                     type: number
 *                     example: 35.6892
 *                   lng:
 *                     type: number
 *                     example: 51.3890
 *     responses:
 *       200:
 *         description: Nearby users fetched successfully
 *       400:
 *         description: Invalid request data
 *       500:
 *         description: Internal server error
 */
router.post("/nearby", findNearby);

export default router;
