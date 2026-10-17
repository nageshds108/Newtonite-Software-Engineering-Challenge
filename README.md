# Newtonite Software Engineering Challenge

Newtonite Software Engineering Challenge is an internal operations-work tracker built with MongoDB, Express, React, and Node.js. It gives a team a shared inbox for customer, engineering, payment, incident, compliance, and general operations work.

## Features

- Register and sign in; create a team or join using an invitation code.
- Team-scoped work items with status, priority, due date, description, and assignee.
- Dashboard counts for active, urgent, blocked, and resolved work.
- Server-side indexed search, status/priority filters, and cursor pagination (20 per page, maximum 50).
- Team roles: owner, admin, and member. Only team managers can assign other people or change roles.
- Atomic first-claim-wins ownership, optimistic version checks for edits, idempotent item creation, and a durable activity history.
- Responsive React interface with item details, comments, and stale-edit feedback.

## Run locally

Requirements: Node.js 20+, npm, and MongoDB running as a **replica set** (single-node replica sets are suitable for local development).

1. Copy `.env.example` to `.env` and set `JWT_SECRET` to a random value of at least 32 characters. Set `MONGODB_URI` to your MongoDB replica-set URL.
2. Install dependencies from the project root:

   ```sh
   npm install
   ```

3. (Optional) Add sample work and a demo account:

   ```sh
   npm run seed
   ```

   Demo login: `demo@opsdesk.local` / `DemoPassword123!`. Change or remove this account outside local development.
4. Start the API and UI:

   ```sh
   npm run dev
   ```

   Open `http://localhost:5173`. The API listens on `http://localhost:4000`.
5. Run the API workflow tests against a MongoDB replica set on `127.0.0.1:27018` named `opsdesk-rs`:

   ```sh
   npm test
   ```

For the Render deployment, connect the repository as a Blueprint using `render.yaml`. It creates a free Node web service for the API and a static site for the frontend. Set `MONGODB_URI` on the API service, set `CLIENT_ORIGIN` to the frontend's exact HTTPS origin, and set `VITE_API_URL` on the static site to the API's HTTPS origin. The two origins should be the service URLs shown by Render, without trailing slashes. The API service also needs a strong `JWT_SECRET`.

## API outline

All routes are under `/api`. Except health and the two authentication routes, they require `Authorization: Bearer <token>`.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/auth/register`, `/auth/login` | Create account / obtain token |
| `GET` | `/auth/me`, `/teams` | Current user / memberships |
| `POST` | `/teams`, `/teams/join` | Create team / join by invite code |
| `GET` | `/teams/:teamId/members` | List team members |
| `PATCH` | `/teams/:teamId/members/:userId/role` | Manager changes member/admin role |
| `GET` | `/teams/:teamId/items` | Filtered, cursor-paginated list (`q`, `status`, `priority`, `mine`, `limit`, `cursor`) |
| `POST` | `/teams/:teamId/items` | Create with required `Idempotency-Key` header |
| `GET` | `/teams/:teamId/items/:itemId` | Item and latest 50 activity events |
| `PATCH` | `/teams/:teamId/items/:itemId` | Version-checked edit; include `expectedVersion` |
| `POST` | `/teams/:teamId/items/:itemId/claim` | Atomically take unassigned work |
| `POST` | `/teams/:teamId/items/:itemId/comments` | Add a comment to the activity history |
| `GET` | `/teams/:teamId/summary` | Status totals and unresolved urgent count |
