# Servidor

API del joc i dels comptes, feta amb Express i SQLite. Les instruccions per
executar-lo en local són al README principal.

## Fitxers

- `index.js`: arrenca Express i munta les rutes.
- `routes/`: `auth.js` (registre, login, logout), `account.js` (perfil, avatar,
  contrasenya, esborrar compte), `game.js` (API de la partida) i `pages.js` (pàgines
  Eta antigues, que redirigeixen al client si hi ha `CLIENT_URL`).
- `GameRoom.js`: una sala: jugadors, equips, moviment, disputes, boles i victòria.
- `game/rooms.js`: les sales obertes (en memòria) i els seus codis.
- `game/map.js`: llegeix `map.tmj` i calcula camins (BFS).
- `twoFactor.js`, `passwordRecovery.js`, `passwordPolicy.js`, `email.js`: 2FA,
  recuperació de contrasenya i enviament de correus amb Brevo.
- `utils.js`: JWT, middleware de sessió i validacions.
- `db/`: esquema (`create_db.sql`), creació i migracions (`create_db.js`), consultes
  (`utils.js`) i usuaris de prova (`seed.sql`).

## Notes

- Les rutes `/api/*` responen JSON amb `{ error }` i el codi HTTP que toqui
  (400 dades, 401 sessió, 403 banejat, 404, 409, 429 massa intents).
- El JWT dura 2 hores. El client l'envia a `Authorization: Bearer`; les pàgines Eta
  fan servir la cookie `token`.
- Les sales viuen en memòria: si es reinicia el servidor es perden les partides, però
  no els comptes ni les copes.
- `JWT_SECRET` és obligatori en producció. Per generar-ne un:

  ```sh
  node -e "console.log(require('crypto').randomBytes(64).toString('base64url'))"
  ```

- Les proves fan servir SQLite en memòria i no envien correus:
  `node --test tests/*.test.js`.
