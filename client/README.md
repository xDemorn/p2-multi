# Client

Joc per navegador, fet amb Vite i PixiJS. Les instruccions per executar-lo en
local són al README principal.

## Fitxers

- `index.html`: totes les pantalles (accés, menú, perfil, sala i partida) en un
  sol document; `src/main.js` les activa i les connecta amb la sala.
- `src/auth.js`: login, registre, 2FA i recuperació de contrasenya.
- `src/menu.js`, `lobby.js`, `profile.js`: menú principal, tria de les sis cases
  a la sala i perfil (avatar, sobrenom, contrasenya, esborrar compte).
- `src/session.js`: el JWT a `sessionStorage` i el client axios amb
  `Authorization: Bearer`.
- `src/settings.js`, `audio.js`: panell d'ajustos (Esc) i botó de música, amb
  els volums desats a `localStorage`; el panell no atura la partida.
- `src/passwordHelp.js`, `playerPings.js`: força de la contrasenya i taula de
  pings dels jugadors (Tab durant la partida).
- `src/game/connection.js`: la sala per HTTP: consulta l'estat cada 100 ms,
  calcula el ping i la diferència de rellotge amb el servidor i avisa amb
  `sendBeacon` en tancar la pestanya.
- `src/game/GameView.js`: el mapa isomètric amb PixiJS: mags, previsualització
  del camí, animacions, disputes i boles.
- `src/gameVisuals.js`: terreny, boles i l'emblema de la copa.
- `src/utils/`: `constants.js` (URL del servidor i mides del mapa),
  `functions.js` (pantalles i coordenades isomètriques), `movement.js` (BFS de
  camins i abast), `characters.js` (sprites dels mags) i `camera.js` (zoom).
- `public/`: `config.js` (URL del servidor en desplegament) i `assets/` (mapa
  Tiled, personatges, interfície i àudio).
- `tests/`: càmera, moviment i terreny.
- `Dockerfile`, `nginx.conf.template`, `docker-entrypoint.d/`: build amb Vite i
  nginx; en arrencar el contenidor, `SERVER_URL` s'escriu a `config.js`.

## Notes

- No hi ha framework d'interfície: les pantalles són seccions d'`index.html`
  que `show()` activa.
- L'adreça del servidor surt de `window.__SERVER_URL__`; si és buida (en local),
  es fa servir `http://<host>:2567`.
- El token aguanta recàrregues però no tancar la pestanya (`sessionStorage`).
- El clic es prediu en local i es confirma amb la resposta del servidor; les
  animacions van amb el rellotge sincronitzat perquè tothom vegi el mateix.
- El mapa es carrega de `public/assets/map.tmj` amb pixi-tiledmap; el servidor
  llegeix el mateix fitxer (vegeu «Mapa» al README principal).
- Les proves corren en Node, sense navegador: `node --test tests/*.test.js`
  (cal `npm install` abans). El build és `npm run build` i deixa `dist/`.
