import express, { Request, Response, NextFunction } from "express";
import locationRoutes from "./routes/location.routes";
import { setupSwagger } from "./config/swagger";

const app = express();
app.use(express.json());

// Routes
app.use("/location", locationRoutes);

// Swagger Documentation
if (process.env.NODE_ENV === "development") setupSwagger(app);

// Error handling middleware
const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.error(err.stack);

  res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
};
app.use(errorHandler);

export default app;
