# OpsDesk

OpsDesk is an internal operations-work tracker built with MongoDB, Express, React, and Node.js. It gives a team a shared inbox for customer, engineering, payment, incident, compliance, and general operations work.

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

For a production UI build, run `npm run build`. Configure `MONGODB_URI` and a strong `JWT_SECRET` in the deployment environment, then start the API with `npm start`. If you deploy the frontend separately, also set `CLIENT_ORIGIN` to its exact HTTPS origin. For Render's single-service deployment below, the frontend and API share an origin and this setting is not needed.

## Deploy to Render + MongoDB Atlas

The repository includes a Render Blueprint in `render.yaml`. The Express service serves both the built React app and `/api` from the same origin, so production does not need a separate frontend service or a `CLIENT_ORIGIN` setting.

1. Push this repository to GitHub. Do not commit `.env`, Atlas credentials, or other secrets.
2. Create a MongoDB Atlas cluster and database user. Add the database to Atlas Network Access. Render's outbound addresses may vary, so use Atlas's documented network-access guidance for your plan; if you allow `0.0.0.0/0`, use a strong, unique database password.
3. In Render, choose **New → Blueprint**, connect the GitHub repository, and apply `render.yaml`.
4. In the Render service's environment settings, add `MONGODB_URI` using the Atlas connection string. Render generates `JWT_SECRET` from the Blueprint. Keep both values private.
5. Wait for the service to finish building and deploying. Open the `onrender.com` URL and verify `/api/health` responds with `{"status":"ok"}` and the root URL shows the sign-in screen.
6. Create your real account from the sign-up screen. Do not seed the demo account in production: its credentials are public.

The Blueprint uses `npm ci && npm run build` and `npm start`. Render's injected `PORT` is used automatically. Work-item changes and their audit events use MongoDB transactions; Atlas supports the replica-set transaction requirement.

For updates, push commits to the connected GitHub branch; Render will rebuild and redeploy automatically. To deploy another environment, create another Render service and database, and use a distinct `JWT_SECRET`.

To create and push a new GitHub repository from this folder, create an empty repository on GitHub first, then run:

```sh
git add .
git commit -m "Prepare OpsDesk for deployment"
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

Replace the URL with your repository URL. If Git requests your author identity, configure `git config --global user.name` and `git config --global user.email`, then retry the commit.

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

## Important deployment notes

Item changes and their corresponding activity records commit in one MongoDB transaction. MongoDB transactions require a replica set (or sharded cluster); a standalone `mongod` is not supported. The API deliberately returns errors when its persistence requirements are unmet rather than accepting a change without its audit record.

Authentication currently uses 12-hour bearer tokens stored in browser local storage for this MVP. Production deployments should serve over HTTPS, review token storage and session revocation requirements, configure trusted origins, and add operational monitoring/backups.
