# El torneig dels mags

Joc multijugador per navegador per a l'assignatura de Sistemes Multijugador (UdG).
Fins a sis mags surten del mateix racó d'un laberint isomètric de 60 × 60 caselles i
competeixen per arribar primer a la copa, que és a la cantonada oposada.

Autors: Gerard Casacuberta, Juan Diego Suárez i Mikolaj Jaworski.

## Jugar

El joc ja està publicat i no cal instal·lar res:

- **Joc:** https://iso-client.onrender.com/
- **Servidor:** https://iso-server-t9m2.onrender.com/

Està allotjat al pla gratuït de Render: si fa estona que ningú hi entra, la primera
càrrega pot trigar uns segons mentre el servei es desperta.

Crea un compte des de la pantalla d'inici (o entra amb un dels usuaris de prova de
`server/USERS.md`) i, des del menú, inicia una partida o uneix-te a la sala d'un
company amb el seu codi.

## Estructura

```
client/   joc (Vite + PixiJS): login, menú, perfil, sala i partida.
server/   API i lògica del joc (Node.js + Express + SQLite).
tiled/    còpia del mapa per editar-lo amb Tiled.
scripts/  scripts de Python per generar el laberint i una vista prèvia.
informe/  informe del projecte en LaTeX.
```

El servidor també té unes pàgines antigues fetes amb Eta (`server/templates`). Si es
defineix `CLIENT_URL`, totes redirigeixen al client, que és l'única entrada.

## Com funciona

### Comptes

Tot es fa des del client: registre, inici de sessió, verificació en dos passos (TOTP),
recuperació de contrasenya per correu, perfil amb avatar i sobrenom, canvi de
contrasenya i eliminació del compte. En iniciar sessió, el servidor retorna un JWT que
el client desa a `sessionStorage` i envia com a `Authorization: Bearer`.

Les contrasenyes es desen amb Argon2id i han de tenir com a mínim 12 caràcters. Es
comprova que no apareguin en filtracions conegudes (Pwned Passwords). Els usuaris
banejats no poden entrar ni jugar.

### Menú i sales

Després del login apareix el menú principal: iniciar partida, crear sala, unir-se a
una sala amb el seu codi i veure el perfil, on es mostren les copes guanyades. Cada
sala té un codi de 6 lletres que es pot copiar i compartir. Ara mateix «Iniciar
partida» i «Crear sala» obren totes dues una sala nova.

A la sala cada jugador tria una de les sis cases. La partida comença quan tothom ha
triat (mínim 2 jugadors en producció i 1 en local, per poder provar-ho sol).

### Partida

La partida va per HTTP, sense WebSockets:

| Petició | Per a què |
|---|---|
| `POST /api/game/join` | entrar en una sala (amb `roomId`) o obrir-ne una de nova |
| `GET /api/game/:roomId?since=N` | estat de la sala i esdeveniments des de `N` |
| `POST /api/game/:roomId/team` | triar equip |
| `POST /api/game/:roomId/move` | moure's a una casella |
| `POST /api/game/:roomId/leave` | sortir |

El client consulta l'estat cada 100 ms i, amb aquestes respostes, calcula el ping i la
diferència de rellotge amb el servidor. En tancar la pestanya avisa amb
`navigator.sendBeacon`; si no pot, el servidor el treu després de 15 s sense consultes.

El servidor és qui mana: valida cada moviment (abast, murs, caselles ocupades), calcula
el camí i el reparteix amb l'hora d'inici perquè tothom vegi la mateixa animació. Si
dos jugadors van a la mateixa casella alhora, guanya qui ha fet clic abans segons el
rellotge sincronitzat; l'altre es queda una casella abans i retrocedeix una mica.

Es comença movent 3 caselles per clic. Hi ha 8 boles pel camí que sumen +1 cadascuna,
fins a un màxim de 7. Qui arriba a la copa guanya i se li suma una copa al perfil.

### So

Hi ha una música per als menús i una altra per a la partida, un efecte als duels, un
altre en guanyar i un altre en canviar de pantalla. El botó ♪ i el panell d'ajustos
(tecla Esc dins la sala) permeten abaixar el volum o treure la música. El panell no
atura la partida.

## Executar-lo en local (opcional)

Només cal si es vol provar o modificar el codi. Cal Node.js 22 o superior. Primer el
servidor i després el client, cadascun en un terminal:

```bash
cd server
npm install
npm run dev        # o npm start, sense recàrrega automàtica
```

```bash
cd client
npm install
npm run dev
```

El joc queda a http://localhost:5173 i el servidor a http://localhost:2567.

La primera vegada, el servidor crea `server/.env` a partir de `.env.example` i prepara
la base de dades SQLite (`server/db/data.db`). Si és buida, hi carrega els usuaris de
prova de `server/db/seed.sql`. També es pot crear a mà amb `npm run db`.

A Windows, si PowerShell bloqueja `npm`, fes servir `npm.cmd`.

Per jugar des d'un altre ordinador de la mateixa xarxa, entra amb la IP del teu equip
(per exemple `http://192.168.1.20:5173`) i afegeix aquesta adreça a `CLIENT_ORIGIN` a
`server/.env`; si no, el servidor rebutja el login per CORS.

### Proves

```bash
cd server && node --test tests/*.test.js
cd client && node --test tests/*.test.js
cd client && npm run build
```

### Docker

```bash
docker compose up --build
```

Client a http://localhost:8080 i servidor a http://localhost:2567. La base de dades i
els avatars es desen al volum `iso-data`. Per enviar correus, passa les variables de
Brevo amb `docker compose --env-file server/.env up --build`.

## Mapa

El mapa s'edita amb [Tiled](https://www.mapeditor.org/) a `client/public/assets/map.tmx`
(`tiled/map.tmx` n'és una còpia; cal mantenir-les iguals). Després cal:

1. Exportar-lo com a JSON (*File > Export*) a `client/public/assets/map.tmj`.
2. Comprovar que al `.tmj` el tileset queda així:

   ```json
   "tilesets": [{ "firstgid": 1, "source": "map_tiles.tsx" }]
   ```
3. Reiniciar el servidor, que llegeix el mapa en arrencar.

La capa `collision` marca les caselles per on no es pot passar; si se'n canvia el nom,
també s'ha de canviar a `server/game/map.js`. Les propietats del mapa `spawnPositions`,
`trophyPosition` i `boostPositions` indiquen on surten els jugadors, on és la copa i on
són les boles.

`python scripts/generate_maze.py` torna a generar el laberint original (sobreescriu els
dos `.tmx` i el `.tmj`). `python scripts/preview_maze.py` dibuixa una vista des de dalt
a `docs/maze-preview.png` i necessita Pillow.

## Recuperar la contrasenya (Brevo)

Els correus s'envien amb l'API de [Brevo](https://www.brevo.com/). Perquè arribin, cal
omplir a `server/.env` (o a les variables del servidor publicat):

```dotenv
BREVO_API_KEY=           # API key de Brevo (no la clau SMTP)
BREVO_SENDER_EMAIL=      # remitent verificat a Brevo
SERVER_URL=http://localhost:2567
```

Sense la clau, el servidor no envia res i ho indica a la seva consola amb
`BREVO_NOT_CONFIGURED`. La resposta a l'usuari és sempre la mateixa, existeixi o no el
correu, per no revelar quins comptes hi ha. L'enllaç caduca en 30 minuts i només
serveix una vegada.

## Desplegament a Render

`render.yaml` crea dos serveis: el servidor (pla `starter`, amb un disc d'1 GB a
`/data` per a la base de dades i els avatars) i el client (pla `free`, que s'adorm si
no s'utilitza). Es desplega des de la branca `main`.

Després de crear el *Blueprint*, cal posar a mà `BREVO_API_KEY` i `BREVO_SENDER_EMAIL`
al servei del servidor. `/healthz` serveix per comprovar que el servidor respon.

## Crèdits

Música i efectes de [Pixabay](https://pixabay.com/), sota la Pixabay Content License:

- Menús: *Magic Fantasy Fairy Tale Music*, de solarflex
- Partida: *Motions to Dark Mystery*, de leberch
- Duel: *Magical Spell Cast*, de daviddumaisaudio
- Victòria: *Winning*, de pw23check
- Canvi de pantalla: *Wind Magic 2*, de yodguard

## Si alguna cosa falla

- El login diu que no pot connectar: comprova que el servidor està en marxa i que
  l'adreça del client és a `CLIENT_ORIGIN`.
- Errors estranys en instal·lar: esborra `node_modules` i `package-lock.json` i torna a
  fer `npm install`.
