"use strict";

// ---- state ----
const state = {
  ws: null,
  meta: { roundTypes: [], presets: [] },
  session: loadSession(), // { code, token, name, team } persisted per tab
  playerId: null,
  isHost: false,
  room: null,
  reconnectTimer: null,
  intended: false, // user intentionally in a room
  timerInterval: null,
  celebrated: false,
  lastSfxRound: null,
};

function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem("khz:session") || "null");
  } catch {
    return null;
  }
}
function saveSession(s) {
  state.session = s;
  if (s) sessionStorage.setItem("khz:session", JSON.stringify(s));
  else sessionStorage.removeItem("khz:session");
}

// ---- dom helpers ----
const $ = (id) => document.getElementById(id);
function show(id, on) {
  const node = $(id);
  if (node) node.classList.toggle("hidden", !on);
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}
let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

// ---- websocket ----
function wsURL() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}
function connect() {
  const ws = new WebSocket(wsURL());
  state.ws = ws;
  ws.onopen = () => {
    $("connBanner").hidden = true;
    if (state.session && state.intended) {
      sendRaw("join", {
        code: state.session.code,
        name: state.session.name,
        team: state.session.team,
        token: state.session.token,
      });
    }
  };
  ws.onmessage = (ev) => handleMessage(JSON.parse(ev.data));
  ws.onclose = () => {
    state.ws = null;
    if (state.intended) {
      $("connBanner").hidden = false;
      scheduleReconnect();
    }
  };
  ws.onerror = () => ws.close();
}
function scheduleReconnect() {
  if (state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, 1500);
}
function sendRaw(type, payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return false;
  state.ws.send(JSON.stringify({ type, payload }));
  return true;
}
function action(name, payload) {
  sendRaw("action", { name, payload: payload || {} });
}

function handleMessage(msg) {
  switch (msg.type) {
    case "you_are":
      state.playerId = msg.playerId;
      state.isHost = msg.host;
      state.intended = true;
      saveSession({
        code: msg.code,
        token: msg.token,
        name: state.session ? state.session.name : "",
        team: state.session ? state.session.team : "girls",
      });
      break;
    case "state":
      state.room = msg;
      render();
      break;
    case "chat":
      appendChat(msg);
      break;
    case "error":
      toast(msg.message || "Помилка");
      break;
  }
}

// ---- chat ----
function appendChat(m) {
  const list = $("chatMsgs");
  if (!list) return;
  const li = document.createElement("li");
  li.className = "chat-msg " + (m.team === "boys" ? "boys" : "girls");
  const mine = state.room && state.room.you && m.from === state.room.you.name;
  li.innerHTML = `<b>${esc(m.from)}</b> ${esc(m.text)}`;
  if (mine) li.classList.add("mine");
  list.appendChild(li);
  while (list.children.length > 60) list.removeChild(list.firstChild);
  list.scrollTop = list.scrollHeight;
}
function sendChat() {
  const input = $("chatInput");
  const text = input.value.trim();
  if (!text) return;
  sendRaw("chat", { text });
  input.value = "";
}

// ---- meta / presets / round types ----
async function loadMeta() {
  try {
    const res = await fetch("/api/meta");
    state.meta = await res.json();
  } catch {
    state.meta = { roundTypes: [], presets: [] };
  }
  fillPresets($("presetSelect"));
  fillPresets($("lobbyPresetSelect"));
  fillRoundTypes($("roundTypesPick"));
  fillRoundTypes($("lobbyRoundTypesPick"));
}
function fillPresets(select) {
  if (!select) return;
  select.innerHTML = "";
  (state.meta.presets || []).forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = `${p.name} (${p.count})`;
    select.appendChild(o);
  });
}
function fillRoundTypes(container) {
  if (!container) return;
  container.innerHTML = "";
  (state.meta.roundTypes || []).forEach((t, i) => {
    const id = `${container.id}-${t.id}`;
    const label = document.createElement("label");
    label.className = "round-chip";
    label.innerHTML = `<input type="checkbox" value="${esc(t.id)}" ${i < 5 ? "checked" : ""}/><span>${esc(t.name)}</span>`;
    container.appendChild(label);
  });
}
function pickedTypes(container) {
  return Array.from(container.querySelectorAll("input:checked")).map((i) => i.value);
}

// ---- create / join ----
function createRoom() {
  state.intended = true;
  const name = $("hostNameInput").value.trim() || "Ведучий";
  const team = $("hostTeamSelect").value;
  saveSession({ code: "", token: "", name, team });
  ensureOpen(() =>
    sendRaw("create_room", {
      hostName: name,
      hostTeam: team,
      girlsName: $("girlsNameInput").value.trim(),
      boysName: $("boysNameInput").value.trim(),
      rounds: Number($("roundsInput").value) || 10,
      roundTypes: pickedTypes($("roundTypesPick")),
      preset: $("presetSelect").value,
      authToken: authToken(),
    })
  );
  playIntro();
}
function joinRoom() {
  const code = $("roomCodeInput").value.trim().toUpperCase();
  if (!code) return toast("Введи код кімнати");
  const name = $("playerNameInput").value.trim() || "Гравець";
  const team = $("playerTeamSelect").value;
  state.intended = true;
  saveSession({ code, token: "", name, team });
  ensureOpen(() => sendRaw("join", { code, name, team, authToken: authToken() }));
  playIntro();
}
function ensureOpen(fn) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) return fn();
  connect();
  const iv = setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      clearInterval(iv);
      fn();
    }
  }, 150);
  setTimeout(() => clearInterval(iv), 6000);
}

// ---- render ----
function render() {
  const r = state.room;
  if (!r) {
    showScreen("home");
    show("chatBox", false);
    return;
  }
  show("chatBox", true);
  const stage = r.stage;
  // score bar
  $("scoreBar").hidden = stage === "lobby" ? false : false;
  updateScore(r);

  if (stage === "lobby") {
    showScreen("lobby");
    renderLobby(r);
  } else if (stage === "final") {
    showScreen("final");
    renderFinal(r);
  } else {
    showScreen("game");
    renderGame(r);
  }
  $("modeBadge").textContent = state.isHost ? "Ведучий" : "Гравець";
}
function showScreen(name) {
  show("homeScreen", name === "home");
  show("lobbyScreen", name === "lobby");
  show("gameScreen", name === "game");
  show("finalScreen", name === "final");
  $("scoreBar").hidden = name === "home";
  if (name !== "game") {
    clearInterval(state.timerInterval);
    const t = $("roundTimer");
    if (t) t.classList.add("hidden");
  }
  if (name !== "final") state.celebrated = false;
  if (name !== "game") state.lastSfxRound = null;
}
function updateScore(r) {
  const g = r.teams.girls, b = r.teams.boys;
  $("girlsScoreName").textContent = g.name;
  $("boysScoreName").textContent = b.name;
  $("girlsScore").textContent = g.score;
  $("boysScore").textContent = b.score;
  $("girlsCard").classList.toggle("active", r.activeTeam === "girls" && r.stage !== "lobby");
  $("boysCard").classList.toggle("active", r.activeTeam === "boys" && r.stage !== "lobby");
}

function renderLobby(r) {
  $("lobbyCode").textContent = r.code;
  $("inviteLink").value = `${location.origin}/?room=${r.code}`;
  const list = $("playersList");
  list.innerHTML = "";
  r.players.forEach((p) => {
    const li = document.createElement("li");
    li.className = `player ${p.team}${p.connected ? "" : " off"}`;
    li.innerHTML = `<b>${esc(p.name)}</b><span>${p.host ? "ведучий" : p.team === "girls" ? "дівчата" : "хлопці"}</span>`;
    list.appendChild(li);
  });
  // team switch highlight
  const myTeam = state.room.you ? state.room.you.team : null;
  $("myTeamSwitch").querySelectorAll(".team-btn").forEach((b) =>
    b.classList.toggle("on", b.dataset.team === myTeam)
  );
  // host-only controls
  const controls = $("lobbyControls");
  controls.style.display = state.isHost ? "" : "none";
  $("startGameButton").style.display = state.isHost ? "" : "none";
  $("lobbyHint").textContent = state.isHost
    ? "Обери раунди й тисни «Почати гру»."
    : "Чекаємо, поки ведучий почне гру…";
  if (state.isHost && !controls.dataset.init) {
    $("lobbyRoundsInput").value = r.config.rounds;
    // reflect chosen types
    const chosen = new Set(r.config.roundTypes || []);
    $("lobbyRoundTypesPick").querySelectorAll("input").forEach((i) => {
      i.checked = chosen.has(i.value);
    });
    controls.dataset.init = "1";
  }
}

function pushConfig() {
  sendRaw("set_config", {
    rounds: Number($("lobbyRoundsInput").value) || 10,
    roundTypes: pickedTypes($("lobbyRoundTypesPick")),
    preset: $("lobbyPresetSelect").value,
  });
}

function renderFinal(r) {
  const g = r.teams.girls, b = r.teams.boys;
  let title = "Нічия!";
  if (r.winner === "girls") title = `Перемогли ${g.name}! 💖`;
  else if (r.winner === "boys") title = `Перемогли ${b.name}! 💙`;
  $("winnerTitle").textContent = title;
  $("winnerText").textContent = `${g.name}: ${g.score} — ${b.name}: ${b.score}`;
  $("backLobbyButton").style.display = state.isHost ? "" : "none";
  if (!state.celebrated) {
    state.celebrated = true;
    celebrate(r.winner);
  }
}

// ---- victory celebration ----
function celebrate(winner) {
  const colors =
    winner === "girls" ? ["#ff2fa7", "#ff5cc4", "#fff246"]
    : winner === "boys" ? ["#16b7ff", "#1555ff", "#fff246"]
    : ["#ff2fa7", "#16b7ff", "#fff246"];
  const host = $("finalScreen");
  const layer = document.createElement("div");
  layer.className = "confetti";
  for (let i = 0; i < 90; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "%";
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 0.8 + "s";
    p.style.animationDuration = 1.8 + Math.random() * 1.6 + "s";
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.appendChild(p);
  }
  host.appendChild(layer);
  setTimeout(() => layer.remove(), 4200);
  playFanfare();
}

// short win/lose cue on result
function playSfx(won) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const seq = won ? [659.25, 987.77] : [311.13, 207.65];
    seq.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = won ? "square" : "sawtooth";
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.26);
    });
    setTimeout(() => ctx.close(), 900);
  } catch {}
}

function playFanfare() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C E G C
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const gain = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.14;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(gain).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch {}
}

// ---- game / rounds ----
function renderGame(r) {
  $("roundLabel").textContent = `Раунд ${r.roundIndex}/${r.rounds}`;
  const activeName = r.teams[r.activeTeam] ? r.teams[r.activeTeam].name : "";
  $("activeTeamName").textContent = activeName;
  const typeName = (state.meta.roundTypes.find((t) => t.id === r.roundType) || {}).name || r.roundType;
  $("roundTypeBadge").textContent = typeName;
  updateTimer(r);

  const stage = $("roundStage");
  const renderer = ROUND_RENDERERS[r.roundType];
  stage.innerHTML = renderer ? renderer(r) : `<div class="pad">Раунд ${esc(r.roundType)}</div>`;
  if (r.stage === "result") stage.insertAdjacentHTML("beforeend", resultFooter(r));
  wireRound(r);

  if (r.stage === "result" && state.lastSfxRound !== r.roundIndex) {
    state.lastSfxRound = r.roundIndex;
    playSfx(!!(r.round && r.round.result && r.round.result.won));
  }
}

function updateTimer(r) {
  clearInterval(state.timerInterval);
  const el = $("roundTimer");
  if (!r.deadlineMs || r.stage !== "playing") {
    el.classList.add("hidden");
    return;
  }
  const tick = () => {
    const rem = Math.max(0, Math.round((r.deadlineMs - Date.now()) / 1000));
    el.textContent = "⏱ " + rem + "с";
    el.classList.remove("hidden");
    el.classList.toggle("low", rem <= 10);
    if (rem <= 0) clearInterval(state.timerInterval);
  };
  tick();
  state.timerInterval = setInterval(tick, 400);
}

function myTurn(r) {
  return state.isHost || (state.room && state.room.you && state.room.you.team === r.activeTeam);
}
function amHost() {
  return state.isHost;
}

function resultFooter(r) {
  const res = r.round && r.round.result;
  if (!amHost()) return `<div class="result-footer"><p class="wait">Ведучий обирає наступний крок…</p></div>`;
  return `
    <div class="result-footer">
      <button class="primary pink" data-act="next">Наступний раунд</button>
      <button class="ghost" data-act="finish">Фінал</button>
    </div>`;
}

const ROUND_RENDERERS = {
  five_words: renderFiveWords,
  melody: renderMelody,
  alias: renderAlias,
  crocodile: renderCrocodile,
  truth_lie: renderTruthLie,
};

function renderFiveWords(r) {
  const d = r.round || {};
  const done = r.stage === "result";
  const tiles = (d.slots || [])
    .map((s, i) => {
      if (s.revealed) return `<div class="word-tile open">${esc(s.word)}</div>`;
      const clickable = !done && myTurn(r);
      return `<button class="word-tile closed" data-reveal="${i}" ${clickable ? "" : "disabled"}>?</button>`;
    })
    .join("");
  let head = `<div class="round-head"><span class="pot">${d.potential ?? 0}</span> балів за пісню</div>`;
  let board = `<div class="word-board">${tiles}</div>`;
  let controls = "";
  if (!done && myTurn(r)) {
    controls = `
      <div class="guess-panel">
        <input id="guessInput" placeholder="Назви пісню" autocomplete="off" />
        <button class="primary blue" data-act="guess">Відповісти</button>
      </div>
      <div class="host-actions">
        <button class="secondary" data-act="revealRandom">Відкрити слово</button>
        ${amHost() ? '<button class="ghost good" data-act="force" data-won="1">Зарахувати</button><button class="ghost bad" data-act="force" data-won="0">Спалити</button>' : ""}
      </div>`;
  }
  if (done && d.song) {
    board += songReveal(d.song, d.phrase);
  }
  return head + board + controls;
}

function renderMelody(r) {
  const d = r.round || {};
  const done = r.stage === "result";
  let audio = d.previewUrl
    ? `<audio class="mel-audio" src="${esc(d.previewUrl)}" controls autoplay></audio>`
    : `<div class="mel-live">🎤 Прев'ю недоступне — ведучий наспівує наживо!</div>`;
  let hints = (d.hints || []).map((h) => `<li>${esc(h)}</li>`).join("");
  let head = `<div class="round-head"><span class="pot">${d.potential ?? 0}</span> балів</div>`;
  let controls = "";
  if (!done && myTurn(r)) {
    controls = `
      <div class="guess-panel">
        <input id="guessInput" placeholder="Назва пісні або виконавець" autocomplete="off" />
        <button class="primary blue" data-act="guess">Відповісти</button>
      </div>
      <div class="host-actions">
        <button class="secondary" data-act="hint">Підказка</button>
        ${amHost() ? '<button class="ghost good" data-act="force" data-won="1">Зарахувати</button><button class="ghost bad" data-act="force" data-won="0">Спалити</button>' : ""}
      </div>`;
  }
  let reveal = done && d.song ? songReveal(d.song) : "";
  return `${head}<div class="mel-card">${audio}<ul class="hints">${hints}</ul></div>${controls}${reveal}`;
}

function renderAlias(r) {
  const d = r.round || {};
  const done = r.stage === "result";
  const iAmExplainer = state.room.you && state.room.you.playerId === d.explainerId;
  const head = `<div class="round-head"><span class="pot">${d.scored ?? 0}</span> / ${d.total ?? 0} слів · пропущено ${d.skipped ?? 0}</div>`;
  if (done) {
    const words = (d.cards || []).map((w) => `<li>${esc(w)}</li>`).join("");
    return `${head}<div class="alias-summary"><p>Слова раунду:</p><ul class="alias-words">${words}</ul></div>`;
  }
  if (iAmExplainer || amHost()) {
    // explainer/host see the word
    if (d.current) {
      const taboo = (d.current.taboo || []).map((t) => `<span>${esc(t)}</span>`).join("");
      return `${head}
        <div class="alias-card explain">
          <p class="alias-role">Ти пояснюєш:</p>
          <h2 class="alias-word">${esc(d.current.word)}</h2>
          <div class="taboo">не можна казати: ${taboo}</div>
        </div>
        <div class="host-actions">
          <button class="primary blue" data-act="correct">Вгадали ✓</button>
          <button class="secondary" data-act="skip">Пропустити</button>
          <button class="ghost" data-act="end">Стоп</button>
        </div>`;
    }
    return `${head}<div class="alias-card"><p>Слова закінчились.</p><button class="primary pink" data-act="end">Завершити</button></div>`;
  }
  // guessers
  const explainerName = esc(d.explainerName || "гравець");
  let guess = "";
  if (myTurn(r)) {
    guess = `<div class="guess-panel"><input id="guessInput" placeholder="Ваш варіант" autocomplete="off" /><button class="primary blue" data-act="guess">Сказати</button></div>`;
  }
  return `${head}<div class="alias-card wait"><p><b>${explainerName}</b> пояснює слово вашій команді.</p></div>${guess}`;
}

function renderCrocodile(r) {
  const d = r.round || {};
  const done = r.stage === "result";
  let controls = "";
  if (!done && myTurn(r)) {
    controls = `
      <div class="guess-panel">
        <input id="guessInput" placeholder="Що це?" autocomplete="off" />
        <button class="primary blue" data-act="guess">Відповісти</button>
      </div>
      <div class="host-actions">
        <button class="secondary" data-act="hint">Підказка</button>
        ${amHost() ? '<button class="ghost good" data-act="force" data-won="1">Зарахувати</button><button class="ghost bad" data-act="force" data-won="0">Спалити</button>' : ""}
      </div>`;
  }
  const hint = d.hint ? `<p class="croc-hint">${esc(d.hint)}</p>` : "";
  const answer = done && d.answer ? `<div class="croc-answer">Відповідь: <b>${esc(d.answer)}</b></div>` : "";
  return `<div class="round-head"><span class="pot">${d.potential ?? 0}</span> балів</div>
    <div class="croc-card"><div class="croc-emoji">${esc(d.emoji)}</div>${hint}${answer}</div>${controls}`;
}

function renderTruthLie(r) {
  const d = r.round || {};
  const done = r.stage === "result";
  let controls = "";
  if (!done && myTurn(r)) {
    controls = `<div class="tl-buttons">
      <button class="primary pink big" data-act="vote" data-truth="1">Правда</button>
      <button class="primary blue big" data-act="vote" data-truth="0">Брехня</button>
    </div>`;
  }
  let verdict = "";
  if (done) {
    const correct = d.truth ? "Правда" : "Брехня";
    verdict = `<div class="tl-verdict ${r.round.result && r.round.result.won ? "good" : "bad"}">
      Це <b>${correct}</b>. ${esc(d.fact || "")}</div>`;
  }
  return `<div class="round-head">Правда чи брехня? <span class="pot">${d.points ?? 0}</span> балів</div>
    <div class="tl-card"><p class="tl-statement">${esc(d.statement)}</p></div>${controls}${verdict}`;
}

function songReveal(song, phrase) {
  const yt = song.youtube
    ? `<a class="youtube" href="${esc(song.youtube)}" target="_blank" rel="noreferrer">Відкрити на YouTube</a>`
    : "";
  const audio = song.previewUrl ? `<audio class="mel-audio" src="${esc(song.previewUrl)}" controls autoplay></audio>` : "";
  const ph = phrase ? `<p class="phrase-full">${esc(phrase.join(" "))}</p>` : "";
  return `<div class="song-reveal"><strong>${esc(song.title)}</strong><span>${esc(song.artist)}</span>${ph}${audio}${yt}</div>`;
}

// ---- wire per-round buttons ----
function wireRound(r) {
  const stage = $("roundStage");
  stage.querySelectorAll("[data-reveal]").forEach((b) =>
    b.addEventListener("click", () => action("reveal", { index: Number(b.dataset.reveal) }))
  );
  stage.querySelectorAll("[data-act]").forEach((b) => {
    b.addEventListener("click", () => {
      const act = b.dataset.act;
      if (act === "guess") return submitGuess();
      if (act === "next") return action("next");
      if (act === "finish") return action("finish");
      if (act === "force") return action("force", { won: b.dataset.won === "1", text: guessValue() });
      if (act === "vote") return action("vote", { truth: b.dataset.truth === "1" });
      action(act);
    });
  });
  const gi = $("guessInput");
  if (gi) gi.addEventListener("keydown", (e) => { if (e.key === "Enter") submitGuess(); });
}
function guessValue() {
  const gi = $("guessInput");
  return gi ? gi.value.trim() : "";
}
function submitGuess() {
  const text = guessValue();
  if (!text) return;
  action("guess", { text });
  const gi = $("guessInput");
  if (gi) gi.value = "";
}

// ---- accounts ----
function authToken() {
  return state.auth && state.auth.token ? state.auth.token : "";
}
async function loadAuth() {
  const token = localStorage.getItem("khz:auth");
  if (!token) return renderAccount();
  try {
    const res = await fetch("/api/me", { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) throw new Error("bad");
    const data = await res.json();
    state.auth = { token, user: data.user, stats: data.stats };
  } catch {
    localStorage.removeItem("khz:auth");
    state.auth = null;
  }
  renderAccount();
}
async function authRequest(path) {
  const body = {
    email: $("authEmail").value.trim(),
    password: $("authPassword").value,
    displayName: $("authName").value.trim(),
  };
  if (!body.email || !body.password) return toast("Введи email і пароль");
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return toast(data.error || "Помилка");
    localStorage.setItem("khz:auth", data.token);
    state.auth = { token: data.token, user: data.user, stats: { matches: 0, wins: 0, points: 0 } };
    $("authPassword").value = "";
    toast("Вітаємо, " + data.user.displayName + "!");
    loadAuth();
  } catch {
    toast("Сервер недоступний");
  }
}
function logout() {
  localStorage.removeItem("khz:auth");
  state.auth = null;
  renderAccount();
}
function renderAccount() {
  const guest = !state.auth;
  show("accountGuest", guest);
  show("accountUser", !guest);
  $("historyList").classList.add("hidden");
  if (!guest) {
    const u = state.auth.user, s = state.auth.stats || {};
    $("accountName").textContent = "Привіт, " + u.displayName;
    $("accountStats").textContent = `${s.matches || 0} ігор · ${s.wins || 0} перемог · ${s.points || 0} балів`;
    if ($("hostNameInput") && !$("hostNameInput").value) $("hostNameInput").value = u.displayName;
  }
}
async function loadHistory() {
  const list = $("historyList");
  if (!list.classList.contains("hidden")) { list.classList.add("hidden"); return; }
  if (!state.auth) return;
  try {
    const res = await fetch("/api/me/history", { headers: { Authorization: "Bearer " + state.auth.token } });
    const data = await res.json();
    const items = data.matches || [];
    list.innerHTML = items.length
      ? items.map((m) => {
          const d = new Date(m.endedAt).toLocaleDateString("uk-UA");
          return `<li class="${m.won ? "won" : "lost"}"><b>${m.won ? "🏆 Перемога" : "Поразка"}</b><span>${m.score} балів · ${d}</span></li>`;
        }).join("")
      : '<li class="empty">Ще немає зіграних ігор</li>';
    list.classList.remove("hidden");
  } catch {
    toast("Не вдалося завантажити історію");
  }
}

// ---- audio / misc ----
function playIntro() {
  const a = $("introAudio");
  if (a) a.play().catch(() => {});
}

// ---- boot ----
function boot() {
  loadMeta();
  loadAuth();
  $("loginButton").addEventListener("click", () => authRequest("/api/auth/login"));
  $("registerButton").addEventListener("click", () => authRequest("/api/auth/register"));
  $("logoutButton").addEventListener("click", logout);
  $("historyButton").addEventListener("click", loadHistory);
  $("createRoomButton").addEventListener("click", createRoom);
  $("joinButton").addEventListener("click", joinRoom);
  $("startGameButton").addEventListener("click", () => sendRaw("start_game", {}));
  $("myTeamSwitch").querySelectorAll(".team-btn").forEach((b) =>
    b.addEventListener("click", () => sendRaw("set_team", { team: b.dataset.team }))
  );
  $("chatSend").addEventListener("click", sendChat);
  $("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
  $("chatHead").addEventListener("click", () => $("chatBox").classList.toggle("min"));
  $("backLobbyButton").addEventListener("click", () => action("lobby"));
  $("copyInviteButton").addEventListener("click", () => {
    navigator.clipboard.writeText($("inviteLink").value).then(() => toast("Скопійовано"));
  });
  ["lobbyRoundsInput", "lobbyPresetSelect"].forEach((id) => {
    const n = $(id);
    if (n) n.addEventListener("change", pushConfig);
  });
  $("lobbyRoundTypesPick").addEventListener("change", pushConfig);
  const vol = $("volumeSlider");
  const applyVol = () => { const a = $("introAudio"); if (a) a.volume = (Number(vol.value) || 0) / 100; };
  vol.addEventListener("input", applyVol);
  applyVol();

  // prefill join code from ?room=
  const params = new URLSearchParams(location.search);
  const room = params.get("room");
  if (room) $("roomCodeInput").value = room.toUpperCase();

  // resume a live session on this tab
  if (state.session && state.session.code) {
    state.intended = true;
    connect();
  } else {
    connect();
  }
}
document.addEventListener("DOMContentLoaded", boot);
