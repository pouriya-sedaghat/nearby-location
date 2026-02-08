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

    if (!parse.success)
      return res.status(400).json({
        success: false,
        message: "Invalid request body",
        errors: parse.error.format(),
      });

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
    const params = { ...req.query, ...req.body };
    const parse = findNearbyReqSchema.safeParse(params);

    if (!parse.success)
      return res.status(400).json({
        success: false,
        message: "Invalid request body",
        errors: parse.error.format(),
      });

    const { coordinate, maxDistance, page = 1, pageSize = 5 } = parse.data;

    const skip = (page - 1) * pageSize;

    const result = await Location.aggregate([
      {
        $geoNear: {
          near: {
            type: "Point",
            coordinates: [coordinate.lng, coordinate.lat],
          },
          distanceField: "distance",
          spherical: true,
          ...(maxDistance ? { maxDistance } : {}),
        },
      },
      //   {
      //     $addFields: {
      //       score: {
      //         $add: [
      //           { $multiply: [-1, "$distance"] }, // closer = higher score
      //           { $multiply: [1000000, { $toLong: "$updatedAt" }] }, // newer = higher score
      //         ],
      //       },
      //     },
      //   },
      {
        $addFields: {
          score: {
            $add: [
              {
                $divide: [1, { $add: ["$distance", 1] }],
              },
              { $divide: [{ $toLong: "$updatedAt" }, 1e10] },
            ],
          },
        },
      },
      { $sort: { score: -1 } }, // sort by combined score
      {
        $facet: {
          data: [
            { $skip: skip },
            { $limit: pageSize },
            {
              $project: {
                userId: 1,
                distance: 1,
                updatedAt: 1,
              },
            },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ]);

    const data = result[0].data;
    const totalCount = result[0].totalCount[0]?.count ?? 0;
    const totalPages = Math.ceil(totalCount / pageSize);
    const hasMore = page < totalPages;

    return res.status(200).json({
      success: true,
      page,
      pageSize,
      totalCount,
      totalPages,
      hasMore,
      data: data.map((d: { updatedAt: Date }) => ({
        ...d,
        updateStatus: timeAgo(new Date(d.updatedAt)),
      })),
    });
  } catch (err) {
    console.error("Find Nearby error", err);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};
