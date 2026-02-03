import mongoose, { Document } from "mongoose";

interface ILocation extends Document {
  userId: string;
  location: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  };
  updatedAt: Date;
}

const locationSchema = new mongoose.Schema<ILocation>({
  userId: { type: String, required: true, unique: true },
  location: {
    type: {
      type: String,
      enum: ["Point"],
      required: true,
    },
    coordinates: {
      type: [Number], // [lng, lat]
      required: true,
    },
  },
  updatedAt: { type: Date, default: Date.now },
});

// Indexes
locationSchema.index({ location: "2dsphere" });
locationSchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60 }, // 7 days
);

const Location =
  mongoose.models.Location ??
  mongoose.model<ILocation>("Location", locationSchema);

export default Location;
