# Iso Game (PixiJS + Colyseus)

## Màquina virtual

- **Usuari:** *multi*
- **Contrasenya:** *patata1234*

## Engegar servidor i client

### Servidor (port 2567)

1. `cd server`
2. `cp .env.example .env` (només el primer cop)
3. `npm start` (o `npm run dev` per reiniciar automàticament en canviar fitxers)

#### Crear base de dades

Nomes cal executar `npm run db`.

### Client (port 5173)

1. `cd client`
2. `npm run dev`

## Crear mapes isometrics

Fet amb el programa [Tiled](https://thorbjorn.itch.io/tiled). El projecte del mapa esta a `client/public/assets/map.tmx`.

La capa principal es diu `ground` i despres hi ha la capa `collision` que determina les caselles que tindran col·lisions i que per tant el jugador no podra passar.

> La capa de col·lisions s'ha d'anomenar `collision`, si no tambe s'hauria de canviar en el codi.

## Actualitzar el mapa del joc

Hi ha 2 passos importants a fer:

1. Exportar el mapa **(File > Export > JSON map files (\*.tmj, \*.json))** a `client/public/assets/map.tmj`.
2. Obrir el fitxer exportat (`client/public/assets/map.tmj`) i canviar el parametre `source` del que hi hagi a **"map_tiles.tsx"**.

L'aparta de **tilesets** hauria de quedar aixi:

```json
...
"tilesets":[
    {
        "firstgid":1,
        "source":"map_tiles.tsx"
    }
],
...
```

## Docker (local)

Cal tenir Docker amb Compose.

```bash
docker compose up --build
```

- Client: http://localhost:8080
- Servidor: http://localhost:2567
- SQLite i avatars: volum `iso-data`, muntat a `/data` del servidor

## Desplegar a Render

`render.yaml` defineix dos serveis web (client i servidor) i un disc persistent d'1 GB pel servidor. Tots dos estan a `region: frankfurt`; canvia-ho abans del primer desplegament si vols una altra regió.

1. Puja els canvis al repositori.
2. A Render, crea un **Blueprint** i selecciona la branca `mejoras-backend`.
3. Comprova que `https://<servidor>.onrender.com/healthz` respon correctament.
4. Quan fusionis a `main`, canvia el camp `branch` de `render.yaml` (o la configuració dels serveis a Render).

Variables principals del servidor: `JWT_SECRET` (la genera Render), `COOKIE_SECURE=production`, `DB_PATH=/data/data.db`, `UPLOAD_DIR=/data/uploads`. El blueprint connecta `CLIENT_ORIGIN` i `SERVER_URL` entre els dos serveis.

> El pla `free` del client s'atura per inactivitat. El servidor necessita el pla `starter` per poder tenir disc persistent.

## Problemes alhora d'executar

Si hi ha qualsevol problema el millor es eliminar la carpeta `node_modules` i el fitxer `package-lock.json`.