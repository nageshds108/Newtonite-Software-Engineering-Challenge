import cors from "cors";
import express from "express";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { errorHandler } from "./middleware.js";
import { router } from "./routes.js";

export const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com", "data:"]
    }
  }
}));
app.use(cors(process.env.CLIENT_ORIGIN ? { origin: process.env.CLIENT_ORIGIN } : { origin: false }));
app.use(express.json({ limit: "32kb" }));
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 60 }));
app.use("/api", router);
app.use("/api", (_req, res) => res.status(404).json({ error: "Route not found" }));

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const clientBuild = resolve(currentDirectory, "../../client/dist");
app.use(express.static(clientBuild, { index: false, maxAge: "1h" }));
app.get(/.*/, (_req, res, next) => {
  res.sendFile(resolve(clientBuild, "index.html"), (error) => {
    if (error) next(error);
  });
});
app.use(errorHandler);
