const $ = (selector) => document.querySelector(selector);

const state = {
  presets: [],
  songs: [],
  room: null,
  hostToken: localStorage.getItem("fw_hostToken") || "",
  playerId: localStorage.getItem("fw_playerId") || "",
  code: new URLSearchParams(location.search).get("room") || new URLSearchParams(location.search).get("host") || "",
  pollTimer: null,
  lastPreviewFor: "",
  inviteUrl: "",
  publicUrl: "",
  audioEnabled: true,
  audioCtx: null,
  mediaUnlocked: false,
  introWanted: true,
  beatTimer: null,
  beatStep: 0,
  lastResultSoundAt: 0,
  lobbyPresetDraft: "",
  lobbyRoundsDraft: ""
};

const el = {
  app: $("#app"),
  modeBadge: $("#modeBadge"),
  volumeSlider: $("#volumeSlider"),
  introAudio: $("#introAudio"),
  hostSetup: $("#hostSetup"),
  joinSetup: $("#joinSetup"),
  lobby: $("#lobby"),
  game: $("#game"),
  result: $("#result"),
  final: $("#final"),
  presetSelect: $("#presetSelect"),
  presetInfo: $("#presetInfo"),
  roundsInput: $("#roundsInput"),
  hostNameInput: $("#hostNameInput"),
  hostTeamSelect: $("#hostTeamSelect"),
  girlsNameInput: $("#girlsNameInput"),
  boysNameInput: $("#boysNameInput"),
  createRoomButton: $("#createRoomButton"),
  quickLocalButton: $("#quickLocalButton"),
  roomCodeInput: $("#roomCodeInput"),
  playerNameInput: $("#playerNameInput"),
  playerTeamSelect: $("#playerTeamSelect"),
  joinButton: $("#joinButton"),
  lobbyCode: $("#lobbyCode"),
  inviteLink: $("#inviteLink"),
  copyInviteButton: $("#copyInviteButton"),
  playersList: $("#playersList"),
  lobbyControls: $("#lobbyControls"),
  lobbyPresetSelect: $("#lobbyPresetSelect"),
  lobbyRoundsInput: $("#lobbyRoundsInput"),
  lobbyPresetInfo: $("#lobbyPresetInfo"),
  startGameButton: $("#startGameButton"),
  roundLabel: $("#roundLabel"),
  activeTeamName: $("#activeTeamName"),
  girlsScoreName: $("#girlsScoreName"),
  boysScoreName: $("#boysScoreName"),
  girlsScore: $("#girlsScore"),
  boysScore: $("#boysScore"),
  girlsCard: $("#girlsCard"),
  boysCard: $("#boysCard"),
  wordBoard: $("#wordBoard"),
  potentialPoints: $("#potentialPoints"),
  openRandomButton: $("#openRandomButton"),
  guessInput: $("#guessInput"),
  submitGuessButton: $("#submitGuessButton"),
  hostCorrectButton: $("#hostCorrectButton"),
  hostWrongButton: $("#hostWrongButton"),
  resultTitle: $("#resultTitle"),
  resultText: $("#resultText"),
  answerTitle: $("#answerTitle"),
  answerArtist: $("#answerArtist"),
  audioPlayer: $("#audioPlayer"),
  previewStatus: $("#previewStatus"),
  youtubeLink: $("#youtubeLink"),
  stealSongButton: $("#stealSongButton"),
  nextRoundButton: $("#nextRoundButton"),
  finishButton: $("#finishButton"),
  resultFinishButton: $("#resultFinishButton"),
  winnerTitle: $("#winnerTitle"),
  winnerText: $("#winnerText"),
  backLobbyButton: $("#backLobbyButton")
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

async function init() {
  const meta = await api("/api/meta");
  state.publicUrl = clean(meta.publicUrl);
  const data = await api("/api/presets");
  state.presets = data.presets;
  state.songs = data.songs;
  renderPresets();
  wireEvents();

  if (state.code) {
    el.roomCodeInput.value = state.code.toUpperCase();
    await tryLoadExistingRoom();
  } else {
    show("hostSetup");
  }
  requestIntroPlayback();
}

function renderPresets() {
  const options = state.presets.map((preset) => `<option value="${preset.id}">${escapeHtml(preset.name)} (${preset.count})</option>`).join("");
  el.presetSelect.innerHTML = options;
  el.lobbyPresetSelect.innerHTML = options;
  updatePresetInfo();
  updateLobbyPresetInfo();
}

function updatePresetInfo() {
  const preset = findPreset(el.presetSelect.value);
  el.presetInfo.textContent = preset ? preset.description : "";
}

function updateLobbyPresetInfo() {
  const preset = findPreset(el.lobbyPresetSelect.value);
  el.lobbyPresetInfo.textContent = preset ? preset.description : "";
}

function findPreset(id) {
  return state.presets.find((item) => item.id === id);
}

function lobbyPresetValue() {
  return state.lobbyPresetDraft || el.lobbyPresetSelect.value || el.presetSelect.value;
}

function lobbyRoundsValue() {
  return Number(state.lobbyRoundsDraft || el.lobbyRoundsInput.value || el.roundsInput.value);
}

async function createRoom(options = {}) {
  const payload = await api("/api/rooms", {
    method: "POST",
    body: {
      preset: el.presetSelect.value,
      rounds: Number(el.roundsInput.value),
      hostName: el.hostNameInput.value,
      hostTeam: el.hostTeamSelect.value,
      localMode: Boolean(options.localMode),
      girlsName: el.girlsNameInput.value,
      boysName: el.boysNameInput.value
    }
  });
  state.code = payload.code;
  state.hostToken = payload.hostToken;
  state.playerId = "";
  localStorage.setItem("fw_hostToken", state.hostToken);
  localStorage.removeItem("fw_playerId");
  setRoom(payload.room);
  history.replaceState(null, "", `/?host=${state.code}`);
  startPolling();
}

async function quickLocal() {
  await createRoom({ localMode: true });
  await action("start", {
    preset: el.presetSelect.value,
    rounds: Number(el.roundsInput.value),
    hostName: el.hostNameInput.value,
    hostTeam: el.hostTeamSelect.value,
    localMode: true,
    girlsName: el.girlsNameInput.value,
    boysName: el.boysNameInput.value
  });
}

async function tryLoadExistingRoom() {
  try {
    const payload = await api(roomStatePath());
    if (!payload.isHost && !payload.viewerTeam) {
      state.playerId = "";
      localStorage.removeItem("fw_playerId");
      show("joinSetup");
      return;
    }
    setRoom(payload);
    startPolling();
  } catch {
    show("joinSetup");
  }
}

async function joinRoom() {
  const roomCode = clean(el.roomCodeInput.value).toUpperCase();
  if (!roomCode) return;
  const payload = await api(`/api/rooms/${roomCode}/join`, {
    method: "POST",
    body: {
      name: clean(el.playerNameInput.value) || "Гравець",
      team: el.playerTeamSelect.value
    }
  });
  state.code = roomCode;
  state.playerId = payload.playerId;
  state.hostToken = "";
  localStorage.setItem("fw_playerId", state.playerId);
  localStorage.removeItem("fw_hostToken");
  history.replaceState(null, "", `/?room=${state.code}`);
  setRoom(payload.room);
  startPolling();
}

async function poll() {
  if (!state.code) return;
  try {
    const payload = await api(roomStatePath());
    setRoom(payload);
  } catch (error) {
    console.warn(error.message);
  }
}

function roomStatePath() {
  const params = new URLSearchParams();
  if (state.hostToken) params.set("hostToken", state.hostToken);
  if (state.playerId) params.set("playerId", state.playerId);
  return `/api/rooms/${state.code.toUpperCase()}?${params.toString()}`;
}

function startPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(poll, 900);
}

async function action(type, extra = {}) {
  if (!state.code) return;
  unlockMedia();
  if (type === "start" || type === "next") {
    stopIntro();
    stopSongPreview();
  } else {
    requestIntroPlayback();
  }
  const payload = await api(`/api/rooms/${state.code}/action`, {
    method: "POST",
    body: {
      type,
      hostToken: state.hostToken,
      playerId: state.playerId,
      ...extra
    }
  });
  if (type === "open" || type === "openRandom") playRevealSound();
  if (type === "start" || type === "next") playRoundSound();
  setRoom(payload.room);
}

function setRoom(room) {
  state.room = room;
  state.inviteUrl = `${state.publicUrl || location.origin}/?room=${room.code}`;
  render();
}

function render() {
  if (!state.room) return;
  el.modeBadge.textContent = state.room.localMode ? "1 екран" : (state.room.isHost ? "Ведучий" : "Гравець");
  el.app.dataset.host = state.room.isHost ? "true" : "false";
  renderScore();

  if (state.room.stage === "lobby") renderLobby();
  if (state.room.stage === "playing") renderGame();
  if (state.room.stage === "result") renderResult();
  if (state.room.stage === "final") renderFinal();
}

function renderLobby() {
  show("lobby");
  state.introWanted = true;
  stopSongPreview();
  requestIntroPlayback();
  el.lobbyCode.textContent = state.room.code;
  el.inviteLink.value = state.inviteUrl;
  el.playersList.innerHTML = state.room.players.length
    ? state.room.players.map((player) => `<li><span>${escapeHtml(player.name)}</span><b>${teamName(player.team)}</b></li>`).join("")
    : `<li><span>Поки нікого немає</span><b>Кинь лінк</b></li>`;
  el.lobbyControls.hidden = !state.room.isHost;
  if (state.room.isHost) {
    el.lobbyPresetSelect.value = state.lobbyPresetDraft || state.room.preset || el.presetSelect.value;
    el.lobbyRoundsInput.value = state.lobbyRoundsDraft || state.room.rounds || el.roundsInput.value;
    updateLobbyPresetInfo();
  }
  el.startGameButton.hidden = !state.room.isHost;
}

function renderScore() {
  const girls = state.room.teams.girls;
  const boys = state.room.teams.boys;
  el.girlsScoreName.textContent = girls.name;
  el.boysScoreName.textContent = boys.name;
  el.girlsScore.textContent = girls.score;
  el.boysScore.textContent = boys.score;
  el.girlsCard.classList.toggle("active", state.room.activeTeam === "girls");
  el.boysCard.classList.toggle("active", state.room.activeTeam === "boys");
}

function renderGame() {
  show("game");
  state.introWanted = false;
  stopIntro();
  stopSongPreview();
  el.app.dataset.turn = state.room.activeTeam;
  state.lastPreviewFor = "";
  el.roundLabel.textContent = `Раунд ${state.room.roundIndex}/${state.room.rounds}`;
  el.activeTeamName.textContent = teamName(state.room.activeTeam);
  el.potentialPoints.textContent = state.room.current.points;
  const canPlay = Boolean(state.room.canPlay);
  el.wordBoard.innerHTML = state.room.current.words.map((word, index) => {
    const isOpen = state.room.current.revealed[index];
    return `
      <button class="word-tile ${isOpen ? "open" : ""}" type="button" data-word="${index}" ${isOpen || !canPlay ? "disabled" : ""}>
        <span>${index + 1}</span>
        <strong>${isOpen ? escapeHtml(word) : ""}</strong>
      </button>
    `;
  }).join("");
  el.wordBoard.querySelectorAll("[data-word]").forEach((button) => {
    button.addEventListener("click", () => action("open", { index: Number(button.dataset.word) }));
  });

  const canGuess = canPlay && state.room.current.revealed.some(Boolean);
  el.guessInput.disabled = !canPlay;
  el.submitGuessButton.disabled = !canGuess;
  el.openRandomButton.hidden = false;
  el.openRandomButton.disabled = !canPlay;
  el.hostCorrectButton.hidden = !state.room.isHost;
  el.hostWrongButton.hidden = !state.room.isHost;
  el.finishButton.hidden = !state.room.isHost;
}

function renderResult() {
  show("result");
  state.introWanted = false;
  stopIntro();
  const result = state.room.current.result;
  const song = state.room.current.song;
  const team = teamName(result.team);
  el.resultTitle.textContent = result.won ? "Вгадали" : "Згоріло";
  el.resultTitle.className = result.won ? "win" : "lose";
  const correctedText = result.correctedBy
    ? ` ${teamName(result.correctedBy)} підтвердила відповідь.`
    : "";
  el.resultText.textContent = result.won
    ? `${team} вгадала "${result.answer}" і бере ${result.points} ${wordForm(result.points, "бал", "бали", "балів")}.${correctedText}`
    : `${team} сказала "${result.guess || "пас"}". Правильно: "${result.answer}". 0 балів.`;
  el.answerTitle.textContent = song.title;
  el.answerArtist.textContent = song.artist;
  el.stealSongButton.hidden = !state.room.canSteal;
  el.nextRoundButton.hidden = !(state.room.isHost || state.room.canAdvance);
  el.resultFinishButton.hidden = !state.room.isHost;
  el.youtubeLink.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${song.title} ${song.artist}`)}`;
  if (result.at && result.at !== state.lastResultSoundAt) {
    state.lastResultSoundAt = result.at;
    if (result.won) playCorrectSound();
    else playWrongSound();
  }
  loadPreview(song);
}

function renderFinal() {
  show("final");
  state.introWanted = false;
  stopIntro();
  stopSongPreview();
  const girls = state.room.teams.girls;
  const boys = state.room.teams.boys;
  if (girls.score === boys.score) {
    el.winnerTitle.textContent = "Нічия";
    el.winnerText.textContent = `${girls.name}: ${girls.score}. ${boys.name}: ${boys.score}.`;
  } else {
    const winner = girls.score > boys.score ? girls : boys;
    const loser = girls.score > boys.score ? boys : girls;
    el.winnerTitle.textContent = `Перемогли ${winner.name}`;
    el.winnerText.textContent = `${winner.score} проти ${loser.score}.`;
  }
  el.backLobbyButton.hidden = !state.room.isHost;
}

async function loadPreview(song) {
  const key = `${song.title}-${song.artist}`;
  if (state.lastPreviewFor === key) return;
  state.lastPreviewFor = key;
  el.previewStatus.textContent = "Шукаю превʼю пісні...";
  el.audioPlayer.removeAttribute("src");
  try {
    const payload = state.room.current.preview || await api(`/api/preview?title=${encodeURIComponent(song.title)}&artist=${encodeURIComponent(song.artist)}`);
    if (payload.previewUrl) {
      stopIntro();
      el.audioPlayer.autoplay = true;
      el.audioPlayer.loop = true;
      el.audioPlayer.src = payload.previewUrl;
      el.audioPlayer.load();
      const source = payload.source ? ` (${payload.source})` : "";
      const match = payload.matchedTitle ? `: ${payload.matchedTitle} — ${payload.matchedArtist || ""}` : "";
      el.previewStatus.textContent = `Превʼю готове${source}${match}. Якщо браузер не стартував сам, натисни Play.`;
      el.audioPlayer.play().catch(() => {});
    } else {
      el.previewStatus.textContent = "Превʼю не знайшлося, відкрий пошук на YouTube.";
    }
  } catch {
    el.previewStatus.textContent = "Не вдалося знайти превʼю, відкрий пошук на YouTube.";
  }
}

function show(name) {
  [el.hostSetup, el.joinSetup, el.lobby, el.game, el.result, el.final].forEach((node) => node.classList.add("hidden"));
  el[name].classList.remove("hidden");
}

function teamName(team) {
  return state.room?.teams?.[team]?.name || (team === "girls" ? "Дівчата" : "Хлопці");
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function wordForm(number, one, few, many) {
  const absolute = Math.abs(number);
  const last = absolute % 10;
  const lastTwo = absolute % 100;
  if (last === 1 && lastTwo !== 11) return one;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function copyInvite() {
  navigator.clipboard.writeText(state.inviteUrl).then(() => {
    el.copyInviteButton.textContent = "Скопійовано";
    setTimeout(() => {
      el.copyInviteButton.textContent = "Скопіювати";
    }, 1400);
  });
}

function ensureAudio() {
  if (!state.audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    state.audioCtx = new AudioContextClass();
  }
  if (state.audioCtx.state === "suspended") state.audioCtx.resume();
  return state.audioCtx;
}

function unlockMedia() {
  if (state.mediaUnlocked) return;
  state.mediaUnlocked = true;
  ensureAudio();
  requestIntroPlayback();
}

function setIntroVolume() {
  const value = Number(el.volumeSlider.value || 6);
  const volume = Math.max(0, Math.min(1, value / 100));
  el.introAudio.volume = volume;
  el.audioPlayer.volume = volume;
}

function requestIntroPlayback() {
  setIntroVolume();
  if (!state.introWanted || !introAllowed()) {
    stopIntro();
    return;
  }
  el.introAudio.play().catch(() => {});
}

function resumeIntroOnInteraction() {
  state.introWanted = introAllowed();
  unlockMedia();
  requestIntroPlayback();
}

function introAllowed() {
  return !state.room || state.room.stage === "lobby";
}

function stopIntro() {
  state.introWanted = false;
  el.introAudio.pause();
  el.introAudio.currentTime = 0;
}

function stopSongPreview() {
  el.audioPlayer.pause();
  el.audioPlayer.loop = false;
  el.audioPlayer.removeAttribute("src");
  el.audioPlayer.load();
}

function tone(frequency, duration, options = {}) {
  if (!state.audioEnabled) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = ctx.currentTime + (options.delay || 0);
  const end = start + duration;
  oscillator.type = options.type || "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  if (options.slideTo) oscillator.frequency.exponentialRampToValueAtTime(options.slideTo, end);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(options.volume || 0.08, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(end + 0.02);
}

function drum(frequency, duration, delay = 0) {
  if (!state.audioEnabled) return;
  tone(frequency, duration, { type: "sine", volume: 0.13, delay, slideTo: Math.max(42, frequency * 0.28) });
}

function playRevealSound() {
  tone(740, 0.08, { type: "square", volume: 0.045 });
  tone(1120, 0.1, { type: "triangle", volume: 0.055, delay: 0.06 });
}

function playRoundSound() {
  [392, 523.25, 659.25, 880].forEach((note, index) => {
    tone(note, 0.11, { type: "triangle", volume: 0.055, delay: index * 0.055 });
  });
}

function playCorrectSound() {
  [523.25, 659.25, 783.99, 1046.5].forEach((note, index) => {
    tone(note, 0.16, { type: "triangle", volume: 0.07, delay: index * 0.075 });
  });
}

function playWrongSound() {
  tone(220, 0.18, { type: "sawtooth", volume: 0.06, slideTo: 130 });
  tone(164.81, 0.2, { type: "sawtooth", volume: 0.055, delay: 0.09, slideTo: 92 });
}

function tickBeat() {
  if (!state.audioEnabled) return;
  const step = state.beatStep % 8;
  if (step === 0 || step === 4) drum(95, 0.12);
  if (step === 2 || step === 6) tone(185, 0.06, { type: "square", volume: 0.035 });
  tone(step % 2 === 0 ? 1480 : 1760, 0.025, { type: "triangle", volume: 0.018 });
  if (step === 7) {
    tone(660, 0.08, { type: "square", volume: 0.025 });
    tone(990, 0.08, { type: "square", volume: 0.02, delay: 0.05 });
  }
  state.beatStep += 1;
}

function startBeat() {
  clearInterval(state.beatTimer);
  tickBeat();
  state.beatTimer = setInterval(tickBeat, 240);
}

function stopBeat() {
  clearInterval(state.beatTimer);
  state.beatTimer = null;
}

function wireEvents() {
  el.volumeSlider.addEventListener("input", setIntroVolume);
  document.addEventListener("pointerdown", resumeIntroOnInteraction, { once: true });
  document.addEventListener("keydown", resumeIntroOnInteraction, { once: true });
  el.presetSelect.addEventListener("change", updatePresetInfo);
  el.lobbyPresetSelect.addEventListener("change", () => {
    state.lobbyPresetDraft = el.lobbyPresetSelect.value;
    updateLobbyPresetInfo();
  });
  el.lobbyRoundsInput.addEventListener("input", () => {
    state.lobbyRoundsDraft = el.lobbyRoundsInput.value;
  });
  el.createRoomButton.addEventListener("click", createRoom);
  el.quickLocalButton.addEventListener("click", quickLocal);
  el.joinButton.addEventListener("click", joinRoom);
  el.copyInviteButton.addEventListener("click", copyInvite);
  el.startGameButton.addEventListener("click", () => action("start", {
    preset: lobbyPresetValue(),
    rounds: lobbyRoundsValue(),
    hostName: el.hostNameInput.value,
    hostTeam: el.hostTeamSelect.value,
    localMode: Boolean(state.room?.localMode),
    girlsName: el.girlsNameInput.value,
    boysName: el.boysNameInput.value
  }));
  el.openRandomButton.addEventListener("click", () => action("openRandom"));
  el.submitGuessButton.addEventListener("click", () => {
    const guess = clean(el.guessInput.value);
    if (!guess) return;
    el.guessInput.value = "";
    action("guess", { guess });
  });
  el.guessInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") el.submitGuessButton.click();
  });
  el.hostCorrectButton.addEventListener("click", () => action("forceCorrect", { guess: clean(el.guessInput.value) }));
  el.hostWrongButton.addEventListener("click", () => action("forceWrong", { guess: clean(el.guessInput.value) }));
  el.stealSongButton.addEventListener("click", () => action("stealSong"));
  el.nextRoundButton.addEventListener("click", () => action("next"));
  el.finishButton.addEventListener("click", () => action("finish"));
  el.resultFinishButton.addEventListener("click", () => action("finish"));
  el.backLobbyButton.addEventListener("click", () => action("lobby"));
}

init().catch((error) => {
  console.error(error);
  alert(error.message);
});
