# Admin Panel Migration: PHP → Node.js

This guide explains how to finish migrating the legacy **plain PHP admin panel** (CRUD operations) to Node.js.

| Folder | Contents |
|--------|----------|
| @code-php | Legacy admin panel (plain PHP, no framework). Being retired. |
| @server | New Node.js app. Part of the admin panel is already migrated here. |

**Goal:** port every remaining admin module from @code-php to @server, verify it behaves the same, then delete @code-php.

**Approach:** migrate **one module at a time** (e.g. users, products, orders). Each module is a complete vertical slice: list, create, edit, delete, validation, permissions. Never half-migrate a module.

---

## Table of Contents

1. [Rules of the Migration](#1-rules-of-the-migration)
2. [Step 1: Find Out What Is Already Migrated](#2-step-1-find-out-what-is-already-migrated)
3. [Step 2: Learn the Conventions Already in /server](#3-step-2-learn-the-conventions-already-in-server)
4. [Step 3: Run Both Apps Locally](#4-step-3-run-both-apps-locally)
5. [Step 4: Migrate One Module (The Recipe)](#5-step-4-migrate-one-module-the-recipe)
6. [PHP → Node Mapping for CRUD Code](#6-php--node-mapping-for-crud-code)
7. [Authentication and Sessions](#7-authentication-and-sessions)
8. [Testing and Parity Checks](#8-testing-and-parity-checks)
9. [Switching a Module Over](#9-switching-a-module-over)
10. [Final Cleanup](#10-final-cleanup)
11. [CRUD-Specific Pitfalls](#11-crud-specific-pitfalls)
12. [Migration Status Tracker](#12-migration-status-tracker)

---

## 1. Rules of the Migration

1. **Same database.** Both apps use the same database and schema. Do not change the schema as part of the migration.
2. **Follow the existing @server patterns.** Do not introduce a new framework, ORM or folder structure for the remaining modules. Consistency beats perfection.
3. **Same behavior first, improvements later.** Reproduce what the PHP does (URLs, validation rules, permissions, messages), even if it is ugly. Refactor after the module is switched over.
4. **One module at a time**, each with its own branch/PR and its own tests.
5. **Don't port dead code.** If a PHP page isn't linked from anywhere and nobody uses it, confirm with the team and skip it.
6. **Never run the same write path in both apps for the same module** at the same time without knowing why. Each module is served by exactly one app.

---

## 2. Step 1: Find Out What Is Already Migrated

Before writing code, build a list of what exists in @code-php and what already exists in @server.

### 2.1 List the PHP admin pages

```bash
# All PHP files in the legacy panel
find php -name "*.php" -not -path "*/vendor/*" | sort

# Group by "module": show top-level folders / file prefixes
ls php
```

### 2.2 List the tables each PHP file touches

```bash
# Which tables does each file query?
grep -rnoiE "(FROM|INTO|UPDATE|JOIN)\s+\`?[a-z_]+\`?" php --include=*.php | sort | uniq
```

### 2.3 List what @server already implements

```bash
# Look at the project setup and dependencies first
cat server/package.json
ls server server/src 2>/dev/null

# Find registered routes (adjust the pattern for your framework)
grep -rnE "\.(get|post|put|patch|delete)\(|router\.|@(Get|Post|Put|Delete)" server/src --include=*.js --include=*.ts
```

### 2.4 Compare and fill in the tracker

For each PHP module, check @server for the matching routes. A module is one of:

- **Done:** all of list/create/edit/delete exist in @server and match PHP behavior
- **Partial:** some actions are missing or differ (list this precisely)
- **Not started**
- **Dead / retire:** no longer used

Record the result in the [Migration Status Tracker](#12-migration-status-tracker) at the bottom of this file. This tracker is the source of truth for what is left.

> **Tip:** "Done" means verified, not "a file with the same name exists". Spot-check each already-migrated module against the PHP version (validation rules, permission checks, delete behavior) before trusting it.

---

## 3. Step 2: Learn the Conventions Already in /server

Open one fully migrated module in @server and note how it does each of these. New modules must copy the same approach:

- [ ] Folder structure (routes / controllers / services / models)
- [ ] How the database is accessed (ORM, query builder or raw driver) and where the connection is created
- [ ] How requests are validated (Zod, Joi, manual)
- [ ] How errors are returned and handled (error middleware, flash messages, JSON errors)
- [ ] How the UI is delivered: server-rendered templates (EJS, Handlebars, Nunjucks…) or JSON API consumed by a front end
- [ ] How authentication and permission checks are applied (middleware)
- [ ] How config and secrets are loaded (`.env`)
- [ ] How tests are written and run

Write a short note in `server/README.md` (or here) with the answers. Everything below assumes you follow these conventions.

> **Note:** add to the one that's already there

---

## 4. Step 3: Run Both Apps Locally

Run the PHP panel and the Node app against the **same local database** (a copy of production data, with sensitive data removed).

```bash
# Node app
cd server
cp .env.example .env     # fill in DB credentials
npm install
npm run dev

# PHP app (built-in server is fine for local testing)
cd ../php
php -S localhost:8080
```

---

## 5. Step 4: Migrate One Module (The Recipe)

Repeat these steps for every module marked **Not started** or **Partial**.

### 5.1 Document the PHP behavior

Open the module's PHP files and write down (in the PR description or `docs/modules/<name>.md`):

- **URLs and methods:** e.g. `GET users_list.php`, `POST users_add.php`
- **List page:** columns, search/filters, sorting, pagination size
- **Create/Edit forms:** each field, type, required/optional, default, validation rules, error messages
- **Delete:** hard or soft delete? Confirmation step? Cascading effects? (Check for related rows.)
- **Permissions:** who may view / edit / delete (roles, `if ($_SESSION['role'] != 'admin')`)
- **Side effects:** emails sent, logs written, files uploaded, other tables updated
- **SQL:** copy each query. These are your spec.

### 5.2 Data layer

Create the model/repository in @server following the existing convention. Port each SQL query:

```php
// PHP
$id   = (int) $_GET['id'];
$stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
$stmt->execute([$id]);
$user = $stmt->fetch(PDO::FETCH_ASSOC);
```

```js
// Node (raw driver example: adapt to your ORM/query builder)
const [rows] = await pool.execute("SELECT * FROM users WHERE id = ?", [id]);
const user = rows[0] ?? null;
```

If the PHP code builds SQL by string concatenation, **do not copy it**. Always use parameterized queries or the ORM.

### 5.3 Service layer (business logic)

Move logic out of the page scripts into functions that don't know about HTTP: `listUsers(filters)`, `createUser(data)`, `updateUser(id, data)`, `deleteUser(id)`.

### 5.4 Validation

Recreate every validation rule from the PHP form handler with the same constraints (lengths, formats, uniqueness checks):

```js
// Example with Zod: use whatever /server already uses
const userSchema = z.object({
  name:  z.string().trim().min(1).max(100),
  email: z.string().trim().email(),
  role:  z.enum(["admin", "editor"]),
  active: z.coerce.boolean().default(false), // unchecked checkboxes are not submitted
});
```

### 5.5 Routes / controllers

Create the five standard actions (adapt to REST or to form-based routes, depending on what @server already does):

| Action | PHP (typical) | Node route (example) |
|--------|---------------|----------------------|
| List | `users_list.php` | `GET /admin/users` |
| New form | `users_add.php` (GET) | `GET /admin/users/new` |
| Create | `users_add.php` (POST) | `POST /admin/users` |
| Edit form | `users_edit.php?id=1` | `GET /admin/users/:id/edit` |
| Update | `users_edit.php` (POST) | `PUT/POST /admin/users/:id` |
| Delete | `users_delete.php?id=1` | `DELETE/POST /admin/users/:id` |

Apply the **same auth/permission middleware** as the other migrated modules to every route.

> **Keep URLs compatible** if bookmarks, links or other pages point to the old ones. Either reproduce the old path or add a redirect.

### 5.6 Views (if the admin panel is server-rendered)

- Port each PHP view to a template in the engine @server already uses.
- Keep the same HTML structure and CSS classes so existing styles and JS keep working.
- Replace `<?= htmlspecialchars($x) ?>` with the template engine's escaped output (auto-escape on). Only use unescaped output for HTML you generated and trust.
- Replace `<?php foreach ... ?>` loops and `<?php if ... ?>` blocks with the template equivalents.

If the admin panel front end is a separate app, expose the same data as JSON instead and keep response shapes identical.

### 5.7 Side effects

Port emails, file uploads, audit logs and anything else the PHP code did on create/update/delete (see [mapping table](#6-php--node-mapping-for-crud-code)).

### 5.8 Write tests, then compare with PHP

See [Section 8](#8-testing-and-parity-checks). A module is not finished until it passes the parity checks.

### 5.9 Open a PR, get it reviewed, then switch over

See [Section 9](#9-switching-a-module-over).

---

## 6. PHP → Node Mapping for CRUD Code

### 6.1 Request handling

| PHP | Node (Express-style; adapt to your framework) |
|-----|-----------------------------------------------|
| `$_GET['q']` | `req.query.q` |
| `$_POST['name']` | `req.body.name` |
| `$_FILES['photo']` | `multer` → `req.file` |
| `$_SESSION['user']` | `req.session.user` |
| `$_SERVER['REQUEST_METHOD']` | `req.method` |
| `header("Location: x"); exit;` | `res.redirect("x")` |
| `http_response_code(404)` | `res.status(404)` |
| `echo json_encode($data)` | `res.json(data)` |
| `die("error")` | throw an error / return an error response |
| `include 'header.php'` | template layouts / partials |

### 6.2 Common CRUD helpers

| PHP | Node |
|-----|------|
| `(int) $_GET['id']` | `Number.parseInt(req.params.id, 10)` + validate it's not `NaN` |
| `htmlspecialchars($s)` | Template auto-escaping |
| `trim($s)` | `s.trim()` |
| `filter_var($e, FILTER_VALIDATE_EMAIL)` | Zod `.email()` / `validator` package |
| `password_hash($p, PASSWORD_DEFAULT)` | `bcrypt.hash(p, 10)` |
| `password_verify($p, $hash)` | `bcrypt.compare(p, hash)` |
| `date('Y-m-d H:i:s')` | `new Date()` + `date-fns`, or let the DB set it (`NOW()`) |
| `$pdo->lastInsertId()` | Insert result's `insertId` (or ORM return value) |
| `count($rows)` | `rows.length` |
| `in_array($x, $arr)` | `arr.includes(x)` |
| `mail()` / PHPMailer | Nodemailer |
| `move_uploaded_file()` | `multer` storage config (keep the same destination path) |
| `$_SESSION['flash']` | `connect-flash` / session-based flash (match existing approach) |

### 6.3 Pagination and search

PHP admin lists usually do this:

```php
$page   = max(1, (int)($_GET['page'] ?? 1));
$limit  = 20;
$offset = ($page - 1) * $limit;
$stmt = $pdo->prepare("SELECT * FROM users WHERE name LIKE ? ORDER BY id DESC LIMIT $limit OFFSET $offset");
$stmt->execute(['%' . ($_GET['q'] ?? '') . '%']);
```

Port it with the **same page size, ordering and filter semantics**:

```js
const page   = Math.max(1, Number.parseInt(req.query.page ?? "1", 10) || 1);
const limit  = 20;
const offset = (page - 1) * limit;
const q      = `%${req.query.q ?? ""}%`;
const [rows] = await pool.execute(
  "SELECT * FROM users WHERE name LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?",
  [q, String(limit), String(offset)] // some MySQL drivers need LIMIT/OFFSET as strings or numbers: test this
);
```

---

## 7. Authentication and Sessions

Already-migrated modules in @server must already deal with login. **Check how.** One of these is true:

1. **@server has its own login** and the PHP panel still has its own: users may have to log in twice while both exist. Acceptable if short-lived, but confirm it's intended.
2. **Sessions are shared** (e.g. a common session store or signed cookie): keep using that mechanism for new modules.
3. **Node already handles all auth**, and PHP pages trust it.

For new modules, simply use the existing auth middleware. Do **not** invent a new auth approach.

Things to verify:

- [ ] Existing PHP user passwords (`password_hash` / bcrypt `$2y$…`) validate in Node with `bcrypt.compare` (test with a real hash from the DB)
- [ ] Roles/permissions are enforced on **every** new route, including delete and update, not just on the menu links
- [ ] CSRF protection on all state-changing routes (PHP code often has none: add it)
- [ ] Session cookies use `httpOnly`, `secure` (in production) and `sameSite`

---

## 8. Testing and Parity Checks

### 8.1 Characterization tests

Capture what the PHP version actually does, then make Node match:

1. For each action (list, create, edit, delete), run the PHP version against the test database and note the result: status codes, redirects, validation errors, DB changes.
2. Write Node tests asserting the same outcomes (Supertest + Vitest/Jest, or whichever @server uses).

Minimum test cases per module:

- [ ] List: empty table, one page, multiple pages, search term, sort order
- [ ] Create: valid data, each required field missing, invalid formats, duplicate unique value
- [ ] Edit: valid change, nonexistent ID, invalid data
- [ ] Delete: existing record, nonexistent ID, record with related rows
- [ ] Permissions: logged out, logged in without the required role, allowed role
- [ ] Special characters: quotes, `<script>`, emoji, accented characters (e.g. `ñ`, `à`, `ç`)

### 8.2 Side-by-side data check

Run the same action in both apps on identical copies of the database and compare the resulting rows:

```bash
# Example: dump the table before and after, then diff
mysqldump --skip-comments app users > after_php.sql
mysqldump --skip-comments app users > after_node.sql
diff after_php.sql after_node.sql
```

Differences in columns like `updated_at` are expected; everything else should match (including `NULL` vs empty string, boolean values and date formats).

### 8.3 Manual smoke test

Click through the module in both apps using the same data and compare screens and messages. Test with a non-admin account too.

---

## 9. Switching a Module Over

Because the admin panel is split between two apps, route each module to exactly one of them.

### Option A: Reverse proxy (recommended if both apps run on the same domain)

```nginx
server {
    listen 80;

    # Modules already migrated → Node
    location /admin/users    { proxy_pass http://127.0.0.1:3000; }
    location /admin/products { proxy_pass http://127.0.0.1:3000; }

    # Everything else → legacy PHP
    location /admin          { proxy_pass http://127.0.0.1:8080; }
}
```

Switching a module = adding one `location` block. Rolling back = removing it.

### Option B: Update menu links

If the apps run on different hosts/ports, change the admin menu link for that module to point at the Node URL, and add a redirect from the old PHP URL to the new one:

```php
// php/users_list.php (after migration)
header("Location: https://admin.example.com/users", true, 301);
exit;
```

### Switch-over checklist (per module)

1. [ ] Tests pass and PR approved
2. [ ] Back up the database
3. [ ] Deploy @server with the new module
4. [ ] Route the module to Node
5. [ ] Smoke test in production (create, edit and delete a test record)
6. [ ] Watch logs and errors for 24–48 hours
7. [ ] Keep the PHP files for the module until the grace period ends (rollback = revert the route)
8. [ ] After the grace period, delete that module's PHP files and mark it **Done** in the tracker

---

## 10. Final Cleanup

When every module in the tracker is **Done** (or **Retired**):

- [ ] Remove the @code-php folder (tag the last commit that contains it, e.g. `git tag legacy-php-final`)
- [ ] Remove Nginx/Apache rules that point to PHP
- [ ] Remove PHP from Docker/CI/deployment scripts
- [ ] Remove any session or compatibility code that only existed for the transition
- [ ] Remove unused database tables/columns (only after a confirmed grace period and a backup)
- [ ] Update documentation (`server/README.md`, deployment notes)
- [ ] Remove any duplicate or temporary redirects once nobody uses the old URLs

---

## 11. CRUD-Specific Pitfalls

1. **Unchecked checkboxes aren't submitted.** In PHP you probably wrote `isset($_POST['active'])`. In Node, `req.body.active` is `undefined` when unchecked: treat that as `false`.
2. **Empty string vs `NULL`.** PHP forms often insert `''` where Node/ORMs expect `null` (or vice versa). Check each nullable column, and keep behavior consistent with existing data.
3. **Numeric IDs.** Validate that `:id` is a positive integer before querying. `Number("abc")` is `NaN`, and `Number("")` is `0`.
4. **`empty()` vs truthiness.** PHP's `empty("0")` is `true`; in JS `"0"` is truthy. Port every `empty()` call carefully.
5. **Delete via GET links.** Old panels often use `users_delete.php?id=5` links. Switch deletes to `POST`/`DELETE` with CSRF protection in the new app (and keep a redirect for the old URL that does *not* delete).
6. **Forgotten `await`.** Missing `await` on a DB call gives silent bugs (a Promise instead of rows). Turn on the ESLint rule `@typescript-eslint/no-floating-promises` (or equivalent).
7. **Shared state between requests.** PHP restarts per request; Node does not. Never store per-user or per-request data in module-level variables.
8. **Date and timezone handling.** MySQL `DATETIME` values and JS `Date` objects can shift by the server's timezone. Compare dates before and after a round trip in both apps, and check that the connection `timezone` setting matches.
9. **Invalid legacy data.** Old tables may contain `0000-00-00` dates, invalid UTF-8, or `NULL` where code assumes values. Make sure the list page doesn't crash on bad rows.
10. **Duplicate-key and constraint errors.** PHP code might catch `PDOException` and show a friendly message. Make sure the Node version catches the equivalent error (e.g. MySQL error code `ER_DUP_ENTRY`) and shows the same message.
11. **Related data on delete.** Check whether PHP deleted children manually, relied on `ON DELETE CASCADE`, or blocked the delete. Reproduce exactly that behavior (preferably in a transaction).
12. **Hard-coded values and "magic" includes.** Look for settings in `config.php`, global variables and included files that are quietly applied to every page (e.g. `session_start()`, permission checks in `header.php`). Make these explicit in Node middleware.
13. **File uploads.** Keep the same storage path and filename scheme so existing files keep working, and validate size and type by content, not only by extension.
14. **Security re-check.** Don't port insecure code faithfully: use parameterized SQL, escape output, check permissions on every route, and add CSRF protection.

---

## 12. Migration Status Tracker

Update this table as you go. Status values: `Done`, `Partial`, `Not started`, `Retired`.

| Module | PHP files | Node routes | Status | Owner | Switched over (date) | Notes |
|--------|-----------|-------------|--------|-------|----------------------|-------|
| `users` | `code-php/public/index.php` (`register`, `login`, `edit`, `delete`, `?page=logout`) | `POST /api/register`, `POST /api/login`, `POST /api/logout`, `PUT /api/profile`, `POST /api/delete`; pages `/register`, `/login`, `/profile`, `/delete` | `Done` | | 2026-11-13 | Argon2id instead of PHP `password_hash`; avatars stored with random filenames under `UPLOAD_DIR`; delete is `POST`, never `GET` |
| `passwords` | `code-php/public/index.php` (`change_password`) | `POST /api/password` | `Done` | | 2026-11-13 | Shares `passwordPolicy.js` with registration and recovery |
| `password recovery` | `code-php/public/index.php` (`forgot_password`, `reset_password`, `smtp_config.php`) | `POST /api/forgot-password`, `POST /api/reset-password`, `GET /forgot` | `Done` | | 2026-11-13 | Brevo API + `BREVO_API_KEY` instead of PHPMailer SMTP; token TTL 30 min (PHP: 15) |
| `smtp_config.php` | `code-php/private/smtp_config.php` | `server/email.js` (`.env`) | `Retired` | | 2026-11-13 | Hardcoded credentials replaced by environment variables; do not port them |

### Notes for this repository

- The PHP app is not an admin CRUD panel; its modules are the auth/profile pages above. There are no list/create/edit/delete admin screens to port.
- Both apps used the same SQLite schema shape, but column names differ (`user_name` → `username`, `user_password` → `hash`, `user_id` → `id`, `birth_date` → `birthdate`). The migration keeps the Node schema; no PHP code reads `server/db/data.db`.
- Auth during the transition: **separate logins** (PHP native sessions vs. Node JWT cookie). No session store is shared, and only Node serves these routes now.
- CSRF: state-changing routes are `POST`/`PUT` with JSON bodies, an `httpOnly` + `sameSite=lax` cookie and explicit CORS origins. No per-form token, matching the rest of the server.
- Password policy now matches PHP's 12-character minimum plus the existing Pwned Passwords check (`passwordPolicy.js`). Clients (Vite form, Eta templates) validate the same length.
- Permission checks: `auth` middleware on `/api/password`, `/api/profile`, `/api/delete` and the profile/delete pages; the banned-account middleware runs before all of them.

### Project details

- **PHP version:** `8.3.35` (bundled in `code-php/PHP`)
- **Node version:** `>=20.11`
- **Framework / ORM in @server:** Express 4 + Colyseus, Eta templates, raw SQL via `better-sqlite3`
- **Database:** SQLite (`server/db/data.db`, `DB_PATH` override)
- **Auth approach during the transition:** separate logins; Node JWT cookie
- **Target completion date:** _pending team decision on deleting `code-php/`_