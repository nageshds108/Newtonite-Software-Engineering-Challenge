import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { Activity, Team, User, WorkItem } from "./models.js";

if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
await mongoose.connect(process.env.MONGODB_URI);
const email = "demo@opsdesk.local";
let owner = await User.findOne({ email }).select("+passwordHash");
if (!owner) owner = await User.create({ name: "Alex Morgan", email, passwordHash: await bcrypt.hash("DemoPassword123!", 12) });
let team = await Team.findOne({ "members.user": owner._id });
if (!team) team = await Team.create({ name: "Operations", inviteCode: "opsdesk-demo-team", members: [{ user: owner._id, role: "owner" }] });
if (await WorkItem.countDocuments({ team: team._id }) === 0) {
  const examples = [
    ["Investigate duplicate card capture", "Customer reported two charges after checkout. Confirm gateway events and coordinate the reversal.", "payment", "urgent", "in_progress"],
    ["Review elevated API error rate", "The customer API has had a sustained increase in 5xx responses. Identify the affected route and owner.", "incident", "high", "open"],
    ["Approve updated data retention policy", "Legal review is complete; operational approval is still needed before rollout.", "compliance", "normal", "blocked"],
    ["Reproduce intermittent checkout failure", "Several customers saw a timeout on the final checkout step. Check recent deploys and payment-provider latency.", "engineering", "high", "open"],
    ["Follow up on delayed customer export", "Confirm the export completed and send the customer an update.", "customer", "low", "resolved"]
  ];
  for (const [title, description, type, priority, status] of examples) {
    const item = await WorkItem.create({ team: team._id, title, description, type, priority, status, createdBy: owner._id, assignee: status === "in_progress" ? owner._id : null, idempotencyKey: `seed-${title}` });
    await Activity.create({ workItem: item._id, team: team._id, actor: owner._id, kind: "created", message: "created this work item" });
  }
}
console.log("Demo account: demo@opsdesk.local / DemoPassword123!");
console.log(`Demo team invite code: ${team.inviteCode}`);
await mongoose.disconnect();
