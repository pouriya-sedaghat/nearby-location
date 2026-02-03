import { Request, Response } from "express";
import {
  upsertReqSchema,
  findNearbyReqSchema,
} from "../schemas/request.schema";
import Location from "../models/location.model";
import { timeAgo } from "../helpers/timeAgo.helper";

export const upsertLocation = async (req: Request, res: Response) => {
  try {
    const parse = upsertReqSchema.safeParse(req.body);

    if (!parse.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid request body",
        errors: parse.error.format(),
      });
    }

    const { userId, coordinate } = parse.data;

    await Location.findOneAndUpdate(
      { userId },
      {
        $set: {
          location: {
            type: "Point",
            coordinates: [coordinate.lng, coordinate.lat],
          },
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );

    return res
      .status(200)
      .json({ success: true, message: "Location upserted successfully" });
  } catch (err) {
    console.error("Upsert Location error", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

export const findNearby = async (req: Request, res: Response) => {
  try {
    const parse = findNearbyReqSchema.safeParse(req.body);

    if (!parse.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid request body",
        errors: parse.error.format(),
      });
    }

    const { coordinate } = parse.data;

    const nearbyUsers = await Location.aggregate([
      {
        $geoNear: {
          near: {
            type: "Point",
            coordinates: [coordinate.lng, coordinate.lat],
          },
          distanceField: "distance",
          spherical: true,
        },
      },
      { $limit: 10 },
      { $project: { userId: 1, distance: 1, updatedAt: 1 } },
    ]);

    const nearbyUsersWithStatus = nearbyUsers.map((u) => ({
      ...u,
      updateStatus: timeAgo(new Date(u.updatedAt)),
    }));

    return res.status(200).json({
      success: true,
      count: nearbyUsers.length,
      nearbyUsers: nearbyUsersWithStatus,
    });
  } catch (err) {
    console.error("Find Nearby error", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};
