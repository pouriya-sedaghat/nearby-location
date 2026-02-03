import mongoose from "mongoose";

const MONGO_URL =
  process.env.MONGO_URL ?? "mongodb://127.0.0.1:27017/nearby-location";

const connect = async () => {
  try {
    await mongoose.connect(MONGO_URL);
    console.log("Mongodb connected");
  } catch (err) {
    console.error("Mongodb connection error", err);
    process.exit(1);
  }
};

const db = { connect };

export default db;
