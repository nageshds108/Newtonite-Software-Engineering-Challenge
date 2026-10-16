import jwt from "jsonwebtoken";
import { Team } from "./models.js";

export function authenticate(req, res, next) {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.auth = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}

export async function requireTeamRole(req, res, next) {
  try {
    const team = await Team.findOne({ _id: req.params.teamId, "members.user": req.auth.userId });
    if (!team) return res.status(404).json({ error: "Team not found" });
    req.team = team;
    req.membership = team.members.find((member) => member.user.toString() === req.auth.userId);
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireManager(req, res, next) {
  if (!["owner", "admin"].includes(req.membership.role)) {
    return res.status(403).json({ error: "Team administrator permission required" });
  }
  return next();
}

export function errorHandler(error, req, res, _next) {
  if (error?.name === "ZodError") {
    return res.status(400).json({ error: "Invalid request", details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
  }
  if (error?.code === 11000) return res.status(409).json({ error: "This operation has already been applied" });
  if (error?.name === "ValidationError" || error?.name === "CastError") {
    return res.status(400).json({ error: "Invalid request data" });
  }
  console.error(error);
  return res.status(500).json({ error: "An unexpected server error occurred" });
}
