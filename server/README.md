# Servidor

Per generar un secret per posar-lo al `.env` a la variable `JWT_SECRET` podem fer servir aquesta comanda:

```sh
node -e "console.log(require('crypto').randomBytes(64).toString('base64url'))"
```

## Convencions

Respostes a la llista de `docs/MIGRATION-INSTRUCTIONS.md` (pas 2), perquè els mòduls que es migren del panell PHP segueixin el mateix estil:

- **Estructura:** no hi ha carpetes routes/controllers. `index.js` declara rutes i pàgines, `db/utils.js` fa de model (consultes), `passwordRecovery.js` és un router muntat a `/api` i `utils.js` conté JWT, `auth` i validacions compartides. Lògica de negoci petita viu a la ruta o al mòdul que la necessita.
- **Base de dades:** `better-sqlite3` amb SQL directe i consultes parametritzades; la connexió es crea a `db/utils.js` i l'esquema a `db/create_db.sql` (idempotent, s'executa a l'arrencada).
- **Validació:** manual, dins de la ruta o en un mòdul compartit (`passwordPolicy.js`, `ageFromBirthdate`, `EMAIL_RE`). No s'usa Zod ni cap ORM.
- **Errors:** les rutes `/api/*` responen JSON `{ error }` amb codi HTTP (400 validació, 401 sessió/contrasenya, 403 banejat, 429 límit, 5xx intern). Les pàgines HTML mostren plantilles Eta o redirigeixen.
- **UI:** dues superfícies. El lloc d'autenticació es renderitza al servidor amb Eta (`templates/*.eta`, dades `DATA_*`, autoescape); el joc Vite consumeix l'API JSON.
- **Auth:** JWT signat a `utils.js`, desat en cookie `token` (`httpOnly`, `sameSite=lax`, `secure` a producció). `attachUser` omple `req.user`; `auth` protegeix pàgines i rutes. El baneig es comprova en un middleware global.
- **Config:** `.env` carregat amb `--env-file`; `JWT_SECRET` és obligatori a producció.
- **Proves:** `node --test` des de `server/` (no hi ha script `npm test`). Les rutes s'exerciten amb `express` en memòria i SQLite `:memory:`, no amb el servidor real.
