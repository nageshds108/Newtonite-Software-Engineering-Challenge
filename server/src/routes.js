import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { z } from "zod";
import { Activity, Team, User, WorkItem } from "./models.js";
import { authenticate, requireManager, requireTeamRole } from "./middleware.js";

export const router = express.Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid ID");
const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(128)
});
const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(128) });
const itemSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(10000).default(""),
  type: z.enum(["customer", "engineering", "payment", "incident", "compliance", "operations"]).default("operations"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  dueAt: z.string().datetime().nullable().optional()
});
const patchSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(10000).optional(),
  type: z.enum(["customer", "engineering", "payment", "incident", "compliance", "operations"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  status: z.enum(["open", "in_progress", "blocked", "resolved"]).optional(),
  assignee: z.union([objectId, z.null()]).optional(),
  dueAt: z.union([z.string().datetime(), z.null()]).optional(),
  expectedVersion: z.number().int().positive()
}).refine((value) => Object.keys(value).some((key) => key !== "expectedVersion"), "At least one field must be changed");

const publicUser = (user) => ({ id: user._id, name: user.name, email: user.email });
const itemPopulate = [
  { path: "assignee", select: "name email" },
  { path: "createdBy", select: "name email" }
];
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function signedIn(req, res, next) {
  return authenticate(req, res, next);
}
function serializeItem(item) {
  const value = item.toObject ? item.toObject() : item;
  return { ...value, id: value._id, teamId: value.team, assignee: value.assignee ? publicUser(value.assignee) : null, createdBy: publicUser(value.createdBy) };
}
async function writeActivity({ item, actor, kind, message, changes = {}, session }) {
  await Activity.create([{ workItem: item._id, team: item.team, actor, kind, message, changes }], { session });
}
function matchesCreateRequest(item, input) {
  const requestedDueAt = input.dueAt ? new Date(input.dueAt).getTime() : null;
  const existingDueAt = item.dueAt ? new Date(item.dueAt).getTime() : null;
  return item.title === input.title &&
    item.description === input.description &&
    item.type === input.type &&
    item.priority === input.priority &&
    existingDueAt === requestedDueAt;
}

router.post("/auth/register", async (req, res) => {
  const input = registerSchema.parse(req.body);
  const email = input.email.toLowerCase();
  if (await User.exists({ email })) return res.status(409).json({ error: "An account with that email already exists" });
  const user = await User.create({ name: input.name, email, passwordHash: await bcrypt.hash(input.password, 12) });
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "12h" });
  return res.status(201).json({ token, user: publicUser(user) });
});

router.post("/auth/login", async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await User.findOne({ email: input.email.toLowerCase() }).select("+passwordHash");
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) return res.status(401).json({ error: "Email or password is incorrect" });
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "12h" });
  return res.json({ token, user: publicUser(user) });
});

router.get("/auth/me", signedIn, async (req, res) => {
  const user = await User.findById(req.auth.userId);
  if (!user) return res.status(401).json({ error: "Account no longer exists" });
  return res.json({ user: publicUser(user) });
});

router.get("/teams", signedIn, async (req, res) => {
  const teams = await Team.find({ "members.user": req.auth.userId }).select("name members createdAt");
  return res.json({ teams: teams.map((team) => {
    const member = team.members.find((entry) => entry.user.toString() === req.auth.userId);
    return { id: team.id, name: team.name, role: member.role };
  }) });
});

router.post("/teams", signedIn, async (req, res) => {
  const input = z.object({ name: z.string().trim().min(2).max(80) }).parse(req.body);
  const team = await Team.create({
    name: input.name,
    inviteCode: randomBytes(18).toString("base64url"),
    members: [{ user: req.auth.userId, role: "owner" }]
  });
  return res.status(201).json({ team: { id: team.id, name: team.name, role: "owner", inviteCode: team.inviteCode } });
});

router.post("/teams/join", signedIn, async (req, res) => {
  const input = z.object({ inviteCode: z.string().min(8).max(100) }).parse(req.body);
  const team = await Team.findOneAndUpdate(
    { inviteCode: input.inviteCode, "members.user": { $ne: req.auth.userId } },
    { $push: { members: { user: req.auth.userId, role: "member" } } },
    { new: true }
  );
  if (!team) {
    const existing = await Team.findOne({ inviteCode: input.inviteCode, "members.user": req.auth.userId });
    if (existing) return res.status(409).json({ error: "You are already a member of this team" });
    return res.status(404).json({ error: "Invite code not found" });
  }
  return res.status(200).json({ team: { id: team.id, name: team.name, role: "member" } });
});

router.get("/teams/:teamId/members", signedIn, requireTeamRole, async (req, res) => {
  const team = await Team.findById(req.team.id).populate("members.user", "name email");
  return res.json({ members: team.members.map((entry) => ({ ...publicUser(entry.user), role: entry.role })) });
});

router.patch("/teams/:teamId/members/:userId/role", signedIn, requireTeamRole, requireManager, async (req, res) => {
  const targetId = objectId.parse(req.params.userId);
  const { role } = z.object({ role: z.enum(["admin", "member"]) }).parse(req.body);
  const member = req.team.members.find((entry) => entry.user.toString() === targetId);
  if (!member) return res.status(404).json({ error: "Team member not found" });
  if (member.role === "owner") return res.status(400).json({ error: "The team owner role cannot be changed" });
  member.role = role;
  await req.team.save();
  return res.json({ member: { id: targetId, role } });
});

router.get("/teams/:teamId/items", signedIn, requireTeamRole, async (req, res) => {
  const query = z.object({
    q: z.string().trim().max(120).optional(),
    status: z.enum(["open", "in_progress", "blocked", "resolved"]).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    mine: z.enum(["true", "false"]).optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  }).parse(req.query);
  const filter = { team: req.team.id };
  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.mine === "true") filter.assignee = req.auth.userId;
  if (query.q) {
    if (query.q.length < 3) filter.$or = [{ title: new RegExp(escapeRegExp(query.q), "i") }];
    else filter.$text = { $search: query.q };
  }
  if (query.cursor) {
    const cursorId = objectId.parse(query.cursor);
    const cursorItem = await WorkItem.findOne({ _id: cursorId, team: req.team.id }).select("createdAt");
    if (!cursorItem) return res.status(400).json({ error: "Invalid page cursor" });
    const cursorFilter = [
      { createdAt: { $lt: cursorItem.createdAt } },
      { createdAt: cursorItem.createdAt, _id: { $lt: cursorItem._id } }
    ];
    if (filter.$or) filter.$and = [{ $or: filter.$or }, { $or: cursorFilter }];
    else filter.$or = cursorFilter;
  }
  const docs = await WorkItem.find(filter).populate(itemPopulate).sort({ createdAt: -1, _id: -1 }).limit(query.limit + 1).lean();
  const hasMore = docs.length > query.limit;
  const items = docs.slice(0, query.limit);
  return res.json({ items: items.map(serializeItem), nextCursor: hasMore ? items.at(-1)._id : null });
});

router.post("/teams/:teamId/items", signedIn, requireTeamRole, async (req, res) => {
  const input = itemSchema.parse(req.body);
  const key = req.get("idempotency-key");
  if (!key || key.length > 100) return res.status(400).json({ error: "A valid Idempotency-Key header is required" });
  const prior = await WorkItem.findOne({ team: req.team.id, createdBy: req.auth.userId, idempotencyKey: key }).populate(itemPopulate);
  if (prior) {
    if (!matchesCreateRequest(prior, input)) return res.status(409).json({ error: "This idempotency key was already used for a different request" });
    return res.status(200).json({ item: serializeItem(prior), replayed: true });
  }
  const session = await mongoose.startSession();
  let created;
  try {
    await session.withTransaction(async () => {
      const [item] = await WorkItem.create([{
        ...input,
        team: req.team.id,
        createdBy: req.auth.userId,
        idempotencyKey: key,
        dueAt: input.dueAt ? new Date(input.dueAt) : null
      }], { session });
      await writeActivity({ item, actor: req.auth.userId, kind: "created", message: "created this work item", session });
      created = item;
    });
  } catch (error) {
    if (error.code === 11000) {
      const replay = await WorkItem.findOne({ team: req.team.id, createdBy: req.auth.userId, idempotencyKey: key }).populate(itemPopulate);
      if (replay) {
        if (!matchesCreateRequest(replay, input)) return res.status(409).json({ error: "This idempotency key was already used for a different request" });
        return res.status(200).json({ item: serializeItem(replay), replayed: true });
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }
  const item = await WorkItem.findById(created._id).populate(itemPopulate);
  return res.status(201).json({ item: serializeItem(item), replayed: false });
});

router.get("/teams/:teamId/items/:itemId", signedIn, requireTeamRole, async (req, res) => {
  const id = objectId.parse(req.params.itemId);
  const [item, activities] = await Promise.all([
    WorkItem.findOne({ _id: id, team: req.team.id }).populate(itemPopulate),
    Activity.find({ workItem: id, team: req.team.id }).populate("actor", "name email").sort({ createdAt: -1, _id: -1 }).limit(50).lean()
  ]);
  if (!item) return res.status(404).json({ error: "Work item not found" });
  return res.json({
    item: serializeItem(item),
    activities: activities.map((entry) => ({ id: entry._id, kind: entry.kind, message: entry.message, changes: entry.changes, createdAt: entry.createdAt, actor: publicUser(entry.actor) }))
  });
});

router.patch("/teams/:teamId/items/:itemId", signedIn, requireTeamRole, async (req, res) => {
  const input = patchSchema.parse(req.body);
  const id = objectId.parse(req.params.itemId);
  const { expectedVersion, ...fields } = input;
  if (fields.assignee && !req.team.members.some((entry) => entry.user.toString() === fields.assignee)) {
    return res.status(400).json({ error: "Assignee must belong to this team" });
  }
  if (fields.assignee !== undefined && !["owner", "admin"].includes(req.membership.role)) {
    if (fields.assignee !== null) return res.status(403).json({ error: "Only team administrators can assign work. Use Take ownership to claim an item." });
    const current = await WorkItem.findOne({ _id: id, team: req.team.id }).select("assignee");
    if (!current) return res.status(404).json({ error: "Work item not found" });
    if (current.assignee?.toString() !== req.auth.userId) return res.status(403).json({ error: "You can only release work assigned to you" });
  }
  const changes = {};
  for (const [field, value] of Object.entries(fields)) {
    const normalized = field === "dueAt" && value ? new Date(value) : value;
    changes[field] = normalized;
  }
  const session = await mongoose.startSession();
  let updated;
  try {
    await session.withTransaction(async () => {
      updated = await WorkItem.findOneAndUpdate(
        { _id: id, team: req.team.id, version: expectedVersion },
        { $set: changes, $inc: { version: 1 } },
        { new: true, runValidators: true, session }
      );
      if (!updated) {
        const current = await WorkItem.findOne({ _id: id, team: req.team.id }).session(session);
        if (!current) return;
        const error = new Error("This work item changed since you loaded it. Refresh and try again.");
        error.status = 409;
        error.currentVersion = current.version;
        throw error;
      }
      const labels = Object.keys(changes).join(", ");
      const message = changes.assignee !== undefined
        ? (changes.assignee ? "changed the assignee" : "unassigned this work item")
        : `updated ${labels}`;
      await writeActivity({ item: updated, actor: req.auth.userId, kind: changes.assignee !== undefined ? "assigned" : "updated", message, changes, session });
    });
  } catch (error) {
    if (error.status === 409) return res.status(409).json({ error: error.message, currentVersion: error.currentVersion });
    throw error;
  } finally {
    await session.endSession();
  }
  if (!updated) return res.status(404).json({ error: "Work item not found" });
  const populated = await WorkItem.findById(updated._id).populate(itemPopulate);
  return res.json({ item: serializeItem(populated) });
});

router.post("/teams/:teamId/items/:itemId/claim", signedIn, requireTeamRole, async (req, res) => {
  const id = objectId.parse(req.params.itemId);
  const session = await mongoose.startSession();
  let item;
  let alreadyClaimed = false;
  try {
    await session.withTransaction(async () => {
      item = await WorkItem.findOneAndUpdate(
        { _id: id, team: req.team.id, assignee: null },
        { $set: { assignee: req.auth.userId }, $inc: { version: 1 } },
        { new: true, session }
      );
      if (!item) {
        const current = await WorkItem.findOne({ _id: id, team: req.team.id }).session(session);
        if (!current) return;
        if (current.assignee?.toString() === req.auth.userId) {
          item = current;
          alreadyClaimed = true;
          return;
        }
        const error = new Error("This work item has already been claimed");
        error.status = 409;
        throw error;
      }
      await writeActivity({ item, actor: req.auth.userId, kind: "claimed", message: "claimed this work item", session });
    });
  } catch (error) {
    if (error.status === 409) return res.status(409).json({ error: error.message });
    throw error;
  } finally {
    await session.endSession();
  }
  if (!item) return res.status(404).json({ error: "Work item not found" });
  const populated = await WorkItem.findById(item._id).populate(itemPopulate);
  return res.json({ item: serializeItem(populated), alreadyClaimed });
});

router.post("/teams/:teamId/items/:itemId/comments", signedIn, requireTeamRole, async (req, res) => {
  const { message } = z.object({ message: z.string().trim().min(1).max(2000) }).parse(req.body);
  const id = objectId.parse(req.params.itemId);
  const session = await mongoose.startSession();
  let activity;
  try {
    await session.withTransaction(async () => {
      const item = await WorkItem.findOneAndUpdate({ _id: id, team: req.team.id }, { $inc: { version: 1 } }, { new: true, session });
      if (!item) return;
      activity = await Activity.create([{ workItem: id, team: req.team.id, actor: req.auth.userId, kind: "commented", message, changes: {} }], { session });
    });
  } finally {
    await session.endSession();
  }
  if (!activity) return res.status(404).json({ error: "Work item not found" });
  const populated = await Activity.findById(activity[0]._id).populate("actor", "name email").lean();
  return res.status(201).json({ activity: { id: populated._id, kind: populated.kind, message: populated.message, changes: populated.changes, createdAt: populated.createdAt, actor: publicUser(populated.actor) } });
});

router.get("/teams/:teamId/summary", signedIn, requireTeamRole, async (req, res) => {
  const [counts, urgent] = await Promise.all([
    WorkItem.aggregate([
      { $match: { team: req.team._id } },
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]),
    WorkItem.countDocuments({ team: req.team.id, priority: "urgent", status: { $ne: "resolved" } })
  ]);
  return res.json({ counts: Object.fromEntries(counts.map((entry) => [entry._id, entry.count])), urgent });
});
