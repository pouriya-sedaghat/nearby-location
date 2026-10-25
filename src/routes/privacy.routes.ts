import express from "express";
import {
  deleteExactUserLocation,
  deleteUserLocation,
} from "../controllers/privacy.controller";

const router = express.Router();

router.post("/location/delete", deleteUserLocation);

router.post("/location/delete-exact", deleteExactUserLocation);

export default router;
