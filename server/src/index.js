import "dotenv/config";
import mongoose from "mongoose";
import { app } from "./app.js";

const port = Number(process.env.PORT || 4000);
if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters long");

await mongoose.connect(process.env.MONGODB_URI);
app.listen(port, () => console.log(`OpsDesk API listening on http://localhost:${port}`));
