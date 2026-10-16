import mongoose from "mongoose";

const { Schema, model } = mongoose;

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false }
}, { timestamps: true });

const teamSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  inviteCode: { type: String, required: true, unique: true, select: false },
  members: [{
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["owner", "admin", "member"], default: "member" }
  }]
}, { timestamps: true });
teamSchema.index({ "members.user": 1 });

const workItemSchema = new Schema({
  team: { type: Schema.Types.ObjectId, ref: "Team", required: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 10000, default: "" },
  type: { type: String, enum: ["customer", "engineering", "payment", "incident", "compliance", "operations"], default: "operations" },
  priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
  status: { type: String, enum: ["open", "in_progress", "blocked", "resolved"], default: "open" },
  assignee: { type: Schema.Types.ObjectId, ref: "User", default: null },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  dueAt: { type: Date, default: null },
  version: { type: Number, default: 1 },
  idempotencyKey: { type: String, required: true, maxlength: 100 }
}, { timestamps: true });
workItemSchema.index({ team: 1, createdAt: -1, _id: -1 });
workItemSchema.index({ team: 1, status: 1, priority: 1, createdAt: -1 });
workItemSchema.index({ team: 1, assignee: 1, createdAt: -1 });
workItemSchema.index({ team: 1, createdBy: 1, idempotencyKey: 1 }, { unique: true });
workItemSchema.index({ team: 1, title: "text", description: "text" });

const activitySchema = new Schema({
  workItem: { type: Schema.Types.ObjectId, ref: "WorkItem", required: true },
  team: { type: Schema.Types.ObjectId, ref: "Team", required: true },
  actor: { type: Schema.Types.ObjectId, ref: "User", required: true },
  kind: { type: String, enum: ["created", "updated", "claimed", "assigned", "commented"], required: true },
  message: { type: String, required: true, maxlength: 2000 },
  changes: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true });
activitySchema.index({ workItem: 1, createdAt: -1, _id: -1 });
activitySchema.index({ team: 1, createdAt: -1 });

export const User = model("User", userSchema);
export const Team = model("Team", teamSchema);
export const WorkItem = model("WorkItem", workItemSchema);
export const Activity = model("Activity", activitySchema);
