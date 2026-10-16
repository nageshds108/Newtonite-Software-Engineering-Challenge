import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { Activity, Team, User, WorkItem } from "../src/models.js";

process.env.JWT_SECRET = "opsdesk-test-secret-with-at-least-32-characters";
const database = `opsdesk_test_${process.pid}_${Date.now()}`;
const uri = `mongodb://127.0.0.1:27018/${database}?replicaSet=opsdesk-rs`;
let server;
let baseUrl;

before(async () => {
  await mongoose.connect(uri);
  await Promise.all([User.init(), Team.init(), WorkItem.init(), Activity.init()]);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

async function request(path, { token, ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  return { status: response.status, body: await response.json() };
}

async function register(name, email) {
  const result = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password: "LongEnoughPassword123!" })
  });
  assert.equal(result.status, 201);
  return result.body;
}

test("authorization, duplicate-safe creation, atomic claims, and stale-edit handling", async () => {
  const owner = await register("Olivia Owner", "olivia@example.test");
  const member = await register("Mina Member", "mina@example.test");
  const outsider = await register("Omar Outside", "omar@example.test");

  assert.equal((await request("/teams")).status, 401);
  const createdTeam = await request("/teams", { token: owner.token, method: "POST", body: JSON.stringify({ name: "Payments" }) });
  assert.equal(createdTeam.status, 201);
  const teamId = createdTeam.body.team.id;

  assert.equal((await request("/teams/join", { token: member.token, method: "POST", body: JSON.stringify({ inviteCode: createdTeam.body.team.inviteCode }) })).status, 200);
  assert.equal((await request(`/teams/${teamId}/items`, { token: outsider.token })).status, 404);
  assert.equal((await request(`/teams/${teamId}/members/${member.user.id}/role`, {
    token: member.token,
    method: "PATCH",
    body: JSON.stringify({ role: "admin" })
  })).status, 403);

  const payload = { title: "Investigate duplicate capture", description: "Compare gateway records", type: "payment", priority: "urgent" };
  const firstCreate = await request(`/teams/${teamId}/items`, {
    token: owner.token,
    method: "POST",
    headers: { "Idempotency-Key": "same-create-request" },
    body: JSON.stringify(payload)
  });
  assert.equal(firstCreate.status, 201);
  const retryCreate = await request(`/teams/${teamId}/items`, {
    token: owner.token,
    method: "POST",
    headers: { "Idempotency-Key": "same-create-request" },
    body: JSON.stringify(payload)
  });
  assert.equal(retryCreate.status, 200);
  assert.equal(retryCreate.body.item.id, firstCreate.body.item.id);
  const reusedKey = await request(`/teams/${teamId}/items`, {
    token: owner.token,
    method: "POST",
    headers: { "Idempotency-Key": "same-create-request" },
    body: JSON.stringify({ ...payload, title: "A different request" })
  });
  assert.equal(reusedKey.status, 409);
  const concurrentCreates = await Promise.all([
    request(`/teams/${teamId}/items`, { token: owner.token, method: "POST", headers: { "Idempotency-Key": "concurrent-create" }, body: JSON.stringify(payload) }),
    request(`/teams/${teamId}/items`, { token: owner.token, method: "POST", headers: { "Idempotency-Key": "concurrent-create" }, body: JSON.stringify(payload) })
  ]);
  assert.ok(concurrentCreates.every((result) => [200, 201].includes(result.status)));
  assert.equal(concurrentCreates[0].body.item.id, concurrentCreates[1].body.item.id);

  const itemId = firstCreate.body.item.id;
  const claims = await Promise.all([
    request(`/teams/${teamId}/items/${itemId}/claim`, { token: owner.token, method: "POST" }),
    request(`/teams/${teamId}/items/${itemId}/claim`, { token: member.token, method: "POST" })
  ]);
  assert.deepEqual(claims.map((result) => result.status).sort(), [200, 409]);
  const winner = claims.find((result) => result.status === 200);
  const winnerToken = winner.body.item.assignee.id === owner.user.id ? owner.token : member.token;

  const staleEdit = await request(`/teams/${teamId}/items/${itemId}`, {
    token: winnerToken,
    method: "PATCH",
    body: JSON.stringify({ status: "in_progress", expectedVersion: 1 })
  });
  assert.equal(staleEdit.status, 409);

  const current = await request(`/teams/${teamId}/items/${itemId}`, { token: winnerToken });
  const edit = await request(`/teams/${teamId}/items/${itemId}`, {
    token: winnerToken,
    method: "PATCH",
    body: JSON.stringify({ status: "in_progress", expectedVersion: current.body.item.version })
  });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.item.status, "in_progress");

  const comment = await request(`/teams/${teamId}/items/${itemId}/comments`, {
    token: member.token,
    method: "POST",
    body: JSON.stringify({ message: "I checked the provider logs." })
  });
  assert.equal(comment.status, 201);
  const detail = await request(`/teams/${teamId}/items/${itemId}`, { token: owner.token });
  assert.ok(detail.body.activities.some((event) => event.message === "I checked the provider logs."));
  assert.ok(detail.body.activities.some((event) => event.kind === "claimed"));

  const list = await request(`/teams/${teamId}/items?mine=true&limit=1`, { token: owner.token });
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].assignee.id, detail.body.item.assignee.id);
});
