import dotenv from "dotenv";
import app from "./app";
import db from "./utils/db";

dotenv.config({ path: [`.env.${process.env.NODE_ENV}`, ".env"] });

const PORT = process.env.PORT ?? 3000;

const server = async () => {
  try {
    await db.connect();
    app.listen(PORT, () => {
      console.log(`Nearby Location Service running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

server();
