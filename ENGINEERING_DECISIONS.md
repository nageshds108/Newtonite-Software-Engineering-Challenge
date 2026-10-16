# Engineering decisions

OpsDesk is the first usable replacement for coordinating operational work in chat, spreadsheets, and email. The product target is a company with hundreds of employees, thousands of registered users, many teams, tens of thousands of active items, and a continually growing activity history. The five decisions below are the ones that most affect correctness under concurrent use, not the visual layout.

## 1. A work item is a team-owned record, not a message

The brief’s failure mode is work disappearing inside threads and two people acting on different copies of the same request. The data model treats a request as a durable document: title, description, type (customer, engineering, payment, incident, compliance, operations), status, priority, assignee, due date, and a monotonically increasing `version`.

Identity is a user account. Access is a membership on a team with one of `owner`, `admin`, or `member`. Every item and activity event stores `team`. List, read, and write queries always include that team id after membership is confirmed. A user who is not on the team receives `404` for that team’s routes, the same as a missing team, so item ids from one team cannot be probed from another.

**Trade-off.** One role per membership is enough to separate “can assign and change roles” from “can claim, comment, and move work I can see.” It is not a per-item ACL or a permission matrix (for example, compliance-only editors). Embedding `members[]` on the team document is acceptable while a team is tens to a few hundred people; it would need to become a separate membership collection if a single team approached thousands of members.

## 2. Authorization is enforced on the write, not only in the UI

Hiding a control is not enough when several hundred people share a browser app and the API is callable directly. The server checks:

- a valid session on every non-public route;
- team membership before any item or member operation;
- `owner` / `admin` for assigning someone else and for changing another member’s role;
- a member may claim unassigned work, or release work assigned to themselves, but cannot reassign it to a colleague.

Assignees must already belong to the same team. The owner role cannot be rewritten through the role endpoint.

**Trade-off.** Any member of the team can still edit title, priority, and status on items they can see. That matches “several people collaborate on the same request” better than locking edits to the assignee, at the cost of needing version checks (decision 3) so those edits do not silently collide.

## 3. Concurrent ownership and stale screens are resolved by conditional writes

The brief calls out two people taking the same issue, one person editing an older version, and a user repeating an action because they are unsure it succeeded. Those are handled as three separate server rules:

**Claim.** `POST .../claim` updates the item only when `assignee` is still `null`. Concurrent claims produce one `200` and one `409`. If the winner retries, the handler treats “already assigned to me” as success (`alreadyClaimed: true`) and does not write a second claim event.

**Stale edit.** `PATCH` requires `expectedVersion` from the copy the client loaded. The update is `findOneAndUpdate({ _id, team, version: expectedVersion }, { $set, $inc: { version: 1 } })`. A mismatch returns `409` with the current version. The UI reloads the item instead of merging field-by-field. Comments also increment `version`, so a comment posted while someone has the editor open invalidates that edit.

**Repeated create.** Create requires an `Idempotency-Key` scoped to `(team, createdBy, key)`. A retry with the same body returns the existing item (`200`, `replayed: true`). The same key with a different body returns `409`. A unique index makes two in-flight creates with the same key collapse to one document; the loser reads the winner. The create modal keeps one key for its lifetime and ignores extra submits while the request is in flight, so a double-click or a retry after a timeout does not open a second item.

**Trade-off.** Viewers who leave a detail panel open do not receive a live push; they see the newer state when they act or refresh. That is enough to stop lost updates. It does not replace a notification channel for “this just became urgent while you were looking at the list.”

## 4. History is append-only and committed with the mutation

Important actions must not vanish the way a decision in a long Slack thread does. Activity lives in its own collection, indexed by `(workItem, createdAt, _id)`, so history can grow without embedding an unbounded array on the item. Each create, field change, claim, assignment, and comment writes the item change and the activity row in one MongoDB transaction. If the activity insert fails, the item change does not commit.

The item detail endpoint returns the latest 50 events. The list endpoint never loads activity.

**Trade-off.** Transactions require a replica set (or Atlas). A standalone `mongod` is rejected rather than recording a change without its explanation. Full activity pagination and an export of “why this decision was made” across a team are left for later; the first version answers that question on a single item.

## 5. The browser never holds the team’s entire backlog

At tens of thousands of active items, listing “everything” in the client would recreate the spreadsheet problem. Item lists filter in MongoDB (`status`, `priority`, `assignee = me`, text search), sort by `(createdAt, _id)`, and paginate with a cursor of those two immutable fields (page size 20, hard cap 50). Compound indexes match those access patterns. Dashboard numbers come from a `$group` by status plus a count of unresolved urgent items for the selected team, not from summing rows already in memory.

Search uses a text index when the query is at least three characters, and a bounded case-insensitive title regex for shorter queries so a one-letter filter cannot scan the whole collection.

**Trade-off.** There is no saved view, relevance ranking, or cross-team search. Cross-team work is reached by switching team context. That keeps every query constrained by `team`, which is the isolation boundary we actually enforce.

Synchronous versus asynchronous: assignment, claims, edits, and activity writes are synchronous because the user needs a definite owner and a definite version before they continue. Email, push, and “enrich this incident” jobs were not added. An unreliable outbox would have been a fourth concurrency problem without changing the core workflow. If notifications are added later, they should read from the same activity collection (at-least-once consumers, idempotent per `activity._id`) rather than being folded into the request that already committed the item.

## Intentionally not built

The brief prefers a smaller system with considered behaviour over many incomplete features. This version does not include:

- a configurable approval graph (status is a constrained enum: `open` → `in_progress` → `blocked` → `resolved`, but transitions are not gated on a named approver);
- websocket fan-out of list changes;
- file attachments or inbound email/Slack intake;
- session revocation beyond 12-hour JWTs in local storage (acceptable for an internal MVP; production needs HTTPS, rotation, and a revocation path).

The three correctness cases the API tests cover are: outsider/member authorization, duplicate-safe and concurrent creates, and first-claim-wins plus stale `expectedVersion` edits.
