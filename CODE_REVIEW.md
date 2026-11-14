# Code review — p1Multijugador

Reviewed: `server/` (Express + Colyseus + SQLite), `client/` (Vite + PixiJS), Docker/Render config, Eta templates, tests.
Date: 2026-11-14 · HEAD `a08a252` ("añadido un 2FA")

Evidence gathered:
- `cd server && node --test tests/*.test.js` → **40 pass / 0 fail**
- `cd client && node --test tests/*.test.js` → **6 pass / 2 fail** (stale mocks, see M3)
- `cd client && npm run build` → succeeds (the broken global `axios` is a runtime, not build, failure)
- `sqlite3 server/db/data.db` → 6 real accounts, emails, Argon2 hashes, one live TOTP secret

Verdict: the game core is in good shape (server-authoritative, tested). The **auth/account side has two release blockers** (leaked credentials in git, broken Vite login) and a few security gaps. Fix C1–C3 before anything else.

---

## Quick scan

| # | Severity | Area | One-liner |
|---|----------|------|-----------|
| C1 | Critical | Secrets in git | `server/db/data.db` + `server/USERS.md` contain real emails, hashes, a live 2FA secret and plaintext passwords |
| C2 | Critical | Client auth | `client/src/main.js` uses global `axios` that is never loaded → login/2FA/register fail at runtime |
| C3 | Critical | Server auth | `/api/login`, `/api/register`, `/api/password` have no rate limiting |
| H1 | High | Game fairness | Dispute winner is decided by client-supplied `clickedAt`/RTT |
| H2 | High | Uploads | Stored extension comes from the user filename; mimetype only checked client-side → HTML upload on the API origin |
| H3 | High | Server pages | `/profile` 500s when the account was deleted but the JWT is still valid |
| H4 | High | Accounts | Email case is preserved and compared case-sensitively → duplicate accounts and impossible password resets |
| M1 | Medium | Config | `MIN_PLAYERS` is derived from `COOKIE_SECURE`, not `NODE_ENV` |
| M2 | Medium | Client | "Editar perfil" hardcodes the Render URL |
| M3 | Medium | Tests | Client tests mock `fetch` while the code uses `axios`; no `test` script in either package |
| M4 | Medium | SQLite | No `foreign_keys`, no WAL/busy timeout; prod error text tells users to close DB Browser |
| M5 | Medium | Sessions | Cookie 1 h vs JWT 2 h, no revocation on password change or ban |
| M6 | Medium | Headers | No CSP/helmet, `X-Powered-By` exposed |
| L1–L12 | Low | Cleanup/robustness | See below |

---

## Critical

### C1 — Real credentials committed to git
`git ls-files` includes `server/db/data.db`, `server/public/uploads/*.png`, `server/USERS.md`, and `README.md` documents the VM login.

`server/db/data.db` (committed, also in history) holds:
- 6 real emails (`@gmail`, `@proton.me`…), Argon2id hashes for all of them;
- `miki` with `totp_enabled = 1` **and the plaintext 32-char `totp_secret`**, i.e. the second factor is bypassable by anyone with the repo;
- ban reasons.

`server/USERS.md` lists passwords in clear text (`miki`, `xDemorn`, `adolf`). The root `.gitignore` is effectively empty (see L1), so nothing prevents this from recurring.

Fix: rotate every password, the TOTP secret, and `JWT_SECRET`; delete `USERS.md`; `git rm --cached server/db/data.db server/public/uploads/*`; rewrite history (or treat all secrets as public forever); make the DB path default to an ignored location (`server/db/data.db` is the default and is tracked).

### C2 — Vite client login is broken
`client/src/main.js:50` and `:71` call bare `axios.post(...)`, but `client/src/main.js` never imports it and `client/index.html` only loads `/config.js` + `main.js`. The server-rendered Eta pages load `/vendor/axios/axios.min.js`; the Vite bundle does not.

Result: clicking *Entrar* / *Registrarse* / the 2FA step throws `ReferenceError: axios is not defined`, shown as the error message in `#msg`. `npm run build` still succeeds, so this passes any build-only check. Regression from `85937f0` ("canviado el fetch nativo a axios") — `passwordRecovery.js` got the import, `main.js` did not.

Fix (one line): `import axios from "axios";` at the top of `client/src/main.js` (already a dependency). Guard it: the client tests should fail if a global like this is referenced.

### C3 — No rate limiting on the password endpoints
`server/index.js:173–193` (`/api/login`), `:138–171` (`/api/register`), `:213–236` (`/api/password`) have no limiter, while recovery and 2FA do (`createLimiter` in `server/passwordRecovery.js:13`). Consequences:
- unlimited online password guessing;
- each attempt runs Argon2 (`argon2.verify` / `argon2.hash`) → cheap CPU exhaustion / DoS;
- unlimited account creation and unlimited avatar uploads (H2).

Also: a missing user skips `argon2.verify` entirely, which leaks valid usernames through response timing.

Fix: reuse `createLimiter` per IP and per username on login; per IP on register/password; hash-check against a dummy hash when the user does not exist.

---

## High

### H1 — Clients decide who wins a disputed tile
`server/GameRoom.js:113–118` trusts `msg.clickedAt` if it falls inside a **5-second** window; `:212` sorts candidates by it. Any modified client sends `clickedAt: Date.now() - 4999` and wins every contest. `:148–149` also widens the arbitration window up to 1.5 s using the client-reported RTT from `:82–89` — one client sending `rtt: 5000` freezes arbitration for everybody.

Fix: order by server receive time. If you want latency compensation, subtract the RTT **you** measured in `ping`/`pong` (`serverTime - clientTime` round trip), never a number the client reports.

### H2 — Uploaded files can be served as HTML on the API origin
`server/index.js:45–52` keeps `path.extname(file.originalname)`, and `:111–118` only checks the multipart `Content-Type` (attacker-controlled). `POST /api/profile` with `filename="x.html"`, `Content-Type: image/png` stores `uploads/<uuid>.html`, served by `express.static` as `text/html` on the same origin as the session cookie and API.

Fix: map the allowed mimetypes to fixed extensions (`image/png → .png`, …) and ignore `originalname`'s extension; optionally check magic bytes. Also cap uploads per user/period.

### H3 — `/profile` crashes for a deleted account
`server/index.js:120–131` calls `getUser()` and immediately reads `user.email`. Every other handler guards (`:199`, `:247`); this one does not. A JWT valid for 1–2 h after `DELETE /api/delete` (or a stale cookie) yields an unhandled TypeError → Express default 500 page.

Fix: mirror `/delete` (`:84–89`): clear the cookie and redirect to `/login` when `!user`.

### H4 — Emails are case-sensitive
Registration stores `email` as typed (`server/utils.js:70–79`, `server/index.js:147`); the unique index (`server/db/create_db.sql:17`) is case-sensitive; password recovery looks up the exact string (`server/db/passwordResets.js:2`). So `A@x.com` and `a@x.com` are two accounts, and a user who types a different case never receives a reset link.

Fix: `.toLowerCase()` once at registration and recovery, and add a `UNIQUE` index on `lower(email)` (or store normalized). Same decision for `username`.

---

## Medium

### M1 — `MIN_PLAYERS` reads the wrong variable
`server/GameRoom.js:17`: `process.env.COOKIE_SECURE === 'production' ? 2 : 1`. `COOKIE_SECURE` is about TLS; unrelated to player count. A production deploy that sets `NODE_ENV=production` but not `COOKIE_SECURE` starts games with one player. On Render it works only because both are set to `production`. Also `MAX_PLAYERS` (`:18`) is configurable while the team list is hardcoded to 1–6 (`:93`) and the lobby text says "Needs 2+" (`client/src/main.js:225`). AGENTS.md still documents `MIN_PLAYERS = 1`.

Fix: `process.env.NODE_ENV === 'production' ? 2 : (Number(process.env.MIN_PLAYERS) || 1)`; drive both the client text and team range from server state/const.

### M2 — Hardcoded deployment URL
`client/index.html:75` links "Editar perfil" to `https://iso-server-t9m2.onrender.com/`. Breaks local dev, Docker, and any other deployment.

Fix: `` `${BASE}/profile` `` from `constants.js` (or a new tab on `BASE`).

### M3 — Client tests are stale and unrunnable by convention
`client/tests/password-recovery.test.js:31` mocks `globalThis.fetch`, but `client/src/passwordRecovery.js:53` now uses `axios` → the two recovery tests fail. Neither `package.json` has a `test` script, so `node --test tests/` is the only documented run (it does not work on Node 24 without the glob) and `AGENTS.md` still claims there are no tests.

Fix: mock `axios.post` (or `t.mock.method(axios, "post")`), add `"test": "node --test tests/*.test.js"` to both packages, and update `AGENTS.md`.

### M4 — SQLite is under-configured, and one error message is developer-only
- `server/db/utils.js:12`: `new Database(dbPath)` with no `pragma journal_mode = WAL`, no `busy_timeout`, no `foreign_keys = ON` — so the `ON DELETE CASCADE` at `server/db/create_db.sql:20` never fires (it is deleted by hand today, which hides the bug).
- `server/index.js:166–168` returns to production users: *"Guarda o revierte los cambios en DB Browser…"*. That is a local-dev hint.
- `server/db/create_db.js` runs twice at startup: once via `--import` (`package.json:11–13`) and once via `import "./create_db.js"` (`server/db/utils.js:6`); harmless but confusing, and it opens the DB with two connections.

Fix: set the pragmas once in `db/utils.js`; replace the BUSY text with a neutral 503; keep only one schema bootstrap.

### M5 — Session lifetime / revocation
`server/utils.js:57` sets a 1 h cookie around a 2 h JWT (`:15`). Changing a password or banning a user does not invalidate tokens (`README.md` acknowledges part of this). `GameRoom.onAuth` (`server/GameRoom.js:169–170`) trusts the JWT's `isBanned` claim, so a banned player keeps playing on the socket forever, and an *unbanned* user keeps a stale banned token until re-login.

Fix: one source of truth — align the maxAge with the JWT, and check the ban state from the DB in `onAuth` (it already has `getUser` imported in `index.js`, not in the room).

### M6 — No security headers
No `helmet`, no CSP, no `X-Content-Type-Options`, no `Referrer-Policy` at the HTTP level (`client/index.html` sets a referrer meta, which is good but client-only), and Express advertises `X-Powered-By`. The Eta pages rely on inline `onclick`, which blocks a strict CSP today.

Fix: `app.disable("x-powered-by")` + `helmet` with a CSP that allows the inline handlers you intend to remove later.

---

## Low / cleanup

- **L1 — Root `.gitignore` is broken.** `cat -A .gitignore` → `EXPLICACION_CAMBIOS.md`, an empty line, `code-php` with no trailing newline. No `node_modules`, no `.env`, no `*.db`; the subproject `.gitignore`s cover `node_modules`/`.env` only. This is how C1 happened.
- **L2 — Duplicate/unused dependencies.** `bcryptjs` (`server/package.json:22`) is never imported; argon2 is used. `cookie` is used only by `GameRoom.js`.
- **L3 — `selectTeam` can throw.** `server/GameRoom.js:96` does `this.state.players.get(client.sessionId).team = team` without a null guard (every other handler guards). Cheap to align.
- **L4 — `isBlocked` is linear.** `server/GameRoom.js:35` scans the whole `BLOCKED` array for every BFS neighbour (≈3 600 × N comparisons per click, plus the same BFS again on the client). Fine at this map size; a `Set` of `y*GRID+x` is a two-line change if the map grows.
- **L5 — Missing map layer warning.** `server/GameRoom.js:26` silently produces an empty `BLOCKED` if the `collision` layer is renamed. Fail fast at startup instead.
- **L6 — Player-less path in state.** `server/index.js:138` no longer redirects HTML form posts; with JavaScript disabled the server-rendered register form shows raw JSON. Either keep a redirect for `Accept: text/html` or document that JS is required.
- **L7 — No upload feedback.** `server/index.js:114–117` silently drops a bad file (`cb(null, false)`), and `server/public/js/profile.js:111–126` only `console.log`s success/failure, so "Actualitzar perfil" appears to do nothing. Also `console.log(data)` at `:119` leaks the FormData to the console.
- **L8 — Nickname is dead data.** It is stored (`server/db/utils.js:25`) and edited, but never shown in-game (`GameRoom.onJoin` uses `auth.username`) and has no server-side length limit (SQLite does not enforce `VARCHAR(150)`). Username length/charset is likewise only constrained by the HTML form.
- **L9 — Replay reuses the Pixi app by accident.** `started` (`client/src/main.js:230`, `:439`) is never reset, so "Jugar otra partida" falls into the `else` branch and reuses the old `Application`/`world` after `resetGameView()` stopped it. It works today because the map is constant; it will break the moment the map or scene setup depends on room state. Either reset `started` and rebuild, or comment that reuse is intentional.
- **L10 — TOTP hardening.** No replay protection inside the 30 s window, no recovery codes (losing the phone permanently locks the account, since password reset does not clear `totp_enabled`), and `/api/2fa/setup` (`server/twoFactor.js:33`) is not rate-limited.
- **L11 — Password policy is synchronous with an external service.** `server/passwordPolicy.js:12` adds up to 5 s to every register/password change and fails open on outage (documented). Acceptable, but the HIBP call is in the request path with no cache.
- **L12 — Repo hygiene.** `.idea/` is tracked (AGENTS.md says avoid), `informe/` is empty, `code-php/` is a whole previous project with its own `AGENTS.md`, `docs/` mixes instructions, and `README.md`/`AGENTS.md` drift from the code (tests exist, `MIN_PLAYERS` changed, 2FA/recovery are missing from AGENTS.md, Node "22+" vs `engines: >=20.11`).

---

## What is good (keep it)

- Movement is genuinely server-authoritative: bounds, collision, occupancy, BFS length and `moveRange` are all re-validated in `GameRoom.moveTo`; the client's `findPreviewPath` is only a preview.
- Contested destinations, rollback after a duel, trophy crossing and round reset are well modelled and covered (40 passing server tests, including a real two-client network test).
- Password recovery is the strongest part of the backend: only SHA-256 hashes stored, single-use consumption inside an `IMMEDIATE` transaction, generic response on both account paths, response sent before the email is attempted, per-IP/per-email limits, token in the URL fragment removed from history, safe error codes only.
- 2FA design is correct: scoped 5-minute challenge JWT that cannot authenticate (`utils.js:38`, `GameRoom.js:169`), `no-store` on secret routes, disable requires a current code, enable requires a confirmed secret.
- Eta `<%= %>` escaping is used for user-controlled values; avatar deletion uses `path.basename`; multer has a 2 MB cap; `trust proxy` is validated instead of blindly enabled.
- Client visuals are cleanly separated (`gameVisuals.js`, `characters.js`) and the camera/terrain/movement helpers have tests.

---

## Suggested fix order

1. Rotate secrets, purge `data.db`/`USERS.md`/uploads from git, repair `.gitignore` (C1).
2. `import axios` in `client/src/main.js` and smoke-test login + 2FA + register (C2).
3. Add the login/register/password limiters and the dummy-hash check (C3).
4. Fix `clickedAt`/RTT trust (H1) and upload extensions (H2).
5. Guard `/profile` and normalize emails (H3, H4).
6. `MIN_PLAYERS`, profile URL, test script + client test mocks (M1–M3).
7. Remaining medium/low items opportunistically.

Verification after the fixes: `cd server && node --test tests/*.test.js`, `cd client && node --test tests/*.test.js && npm run build`, then `docker compose up --build` and exercise login → lobby → contested move → trophy → replay with two browsers.

---

Not reviewed in depth: `client/public/assets/**` (art), `docs/` and `code-php/` (old PHP project), `styles.css`, PixiJS rendering internals, and the SQLite file schema beyond the columns the app reads. No code was changed; this is a report only.
