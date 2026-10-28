# AGENTS.md

Isometric multiplayer game: PixiJS client + Express/Colyseus server. Two independent npm projects, no root `package.json`, no CI, no tests, lint, or typecheck.

## Layout

- `client/` — Vite + PixiJS game client (dev port 5173). Entry: `client/src/main.js`, markup in `client/index.html`.
- `server/` — Express + Colyseus + Eta server (port 2567). Entry: `server/index.js`, game logic in `server/GameRoom.js`.
- `server/` also serves a **separate** server-rendered site (home/login/register/profile) from `server/templates/*.eta` and `server/public/`. That is not the Vite game client; don't confuse the two.
- `tiled/` — Tiled project copy of the map; the server only loads `client/public/assets/map.tmj`.
- `.idea/` is tracked (WebStorm). Avoid committing incidental IDE changes.

## Commands

Requires Node ≥ 20.11 (`import.meta.dirname`, `--env-file` used by the scripts).

```bash
cd server && npm install && cp -n .env.example .env   # .env is gitignored and required
cd server && npm run dev      # nodemon, loads .env
cd server && npm start        # plain start, loads .env
cd server && npm run db       # create SQLite schema if missing (idempotent)
cd client && npm install && npm run dev
```

- Start the server before the client; login goes through it. Local client fallback is `http://<host>:2567`; production reads `window.__SERVER_URL__` from `/config.js`, which the client container generates from `SERVER_URL`.
- `DB_PATH`, `UPLOAD_DIR`, and `MAP_PATH` override the defaults (`server/db/data.db`, `server/public/uploads`, `client/public/assets/map.tmj`). Relative env paths resolve from the server cwd.
- `NODE_ENV=production` makes a missing `JWT_SECRET` a startup error.
- No test suite. Verification is `cd client && npm run build`, or the full stack with `docker compose up --build`; `npm run dev` is the way to exercise the server directly.

## Docker / Render

- `docker compose up --build` runs both images: client at `http://localhost:8080`, server at `http://localhost:2567`, data in the `iso-data` volume.
- `render.yaml` targets branch `mejoras-backend` with two Docker web services. Server is `starter` + 1 GB disk at `/data`; client is `free`. Update `branch` to `main` after merging.
- Server image uses the **repo root** as build context because it copies `client/public/assets/map.tmj`. Client context is `./client`.
- Shell scripts and YAML are pinned to LF in `.gitattributes`; keep entrypoints LF-only or the container fails with `bad interpreter`.

## Architecture notes

- Movement is server-authoritative: the client only sends `moveTo`; `GameRoom` validates bounds/collisions/occupied tiles, runs BFS, and broadcasts the path with `startTime`/`msPerTile` (300 ms). The client interpolates using a ping-derived clock offset. Don't add client-side movement prediction without changing both sides.
- Phases are `lobby` → `playing`; the room locks after start and holds max 6 players. Each player must pick a team (1–6) before the game starts. `MIN_PLAYERS` is 1 in `GameRoom.js` even though the lobby text in `main.js` says "Needs 2+"; team IDs/colors are hardcoded in both files.
- Auth: the Vite client gets a JWT from `/api/login` or `/api/register` and passes it to `joinOrCreate("game", { token })`; `GameRoom.onAuth` checks that option first, then falls back to the `token` cookie. The server-rendered site uses the httpOnly cookie via `server/utils.js` (`attachUser`, `auth`).
- `/api/register` returns `{ token }` for JSON requests and redirects to `/login` for the HTML form.
- Eta templates receive data as `DATA_*` keys through `render()` in `server/index.js`.

## Map / assets

- Live map is `client/public/assets/map.tmj`. `GameRoom.js` reads it once at module load, so **restart the server after every map change**.
- Layers must be named `ground` and `collision` (collision drives server blocking). The tmj tileset entry must be `{"firstgid":1,"source":"map_tiles.tsx"}`; tile art is external PNGs in `_tiles/`.
- Map is 60×60: the server derives `GRID` from the tmj width, while `client/src/utils/constants.js` hardcodes `GRID = 60`. Keep them in sync when resizing.
- Keep `tiled/map.tmx` and `client/public/assets/map.tmx` (plus `map_tiles.tsx`) in sync; they are duplicate copies today.
