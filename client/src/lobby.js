import { COLORS } from "./utils/constants.js";
import { characterNameForTeam } from "./utils/characters.js";
import { $ } from "./utils/functions.js";

const TEAM_NAMES = ["Gryffindor", "Ravenclaw", "Slytherin", "Hufflepuff", "Beauxbatons", "Durmstrang"];

export function buildLobby(room) {
  $("teams").innerHTML = "";
  for (let team = 1; team <= 6; team++) {
    const button = document.createElement("button");
    button.className = "team";
    button.id = `team${team}`;
    const color = `#${COLORS[team - 1].toString(16).padStart(6, "0")}`;
    button.style.borderColor = color;
    button.style.setProperty("--team-color", color);
    button.onclick = () => room.send("selectTeam", team);

    const avatar = document.createElement("img");
    avatar.className = "team-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.alt = "";
    avatar.src = `/assets/interfaz/${characterNameForTeam(team)}.png`;
    const platform = document.createElement("span");
    platform.className = "team-platform";
    platform.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "team-name";
    const owner = document.createElement("span");
    owner.className = "team-owner";
    button.append(avatar, platform, name, owner);
    $("teams").appendChild(button);
  }
}

export function renderLobby(state, sessionId) {
  const owners = {};
  state.players.forEach((player, id) => {
    if (player.team) owners[player.team] = { name: player.name, mine: id === sessionId };
  });

  for (let team = 1; team <= 6; team++) {
    const button = $(`team${team}`);
    const owner = owners[team];
    button.querySelector(".team-name").textContent = TEAM_NAMES[team - 1];
    button.querySelector(".team-owner").textContent = owner
      ? (owner.mine ? "Tu personaje" : owner.name)
      : "Disponible";
    button.disabled = Boolean(owner && !owner.mine);
    button.classList.toggle("mine", Boolean(owner?.mine));
  }

  const waiting = [...state.players.values()].filter((player) => !player.team).length;
  $("lobbyInfo").textContent = `${state.players.size} player(s) in lobby, ${waiting} still choosing. Needs 2+ players.`;
}
