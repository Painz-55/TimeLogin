import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  set,
  onValue,
  runTransaction,
  serverTimestamp,
  onDisconnect
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* =========================
FIREBASE
========================= */

const firebaseConfig = {
  apiKey: "AIzaSyBtPHeua_gIhCpnGcP6SguY1ZiQQ6YuGfQ",
  authDomain: "timetrackerlogin-632a2.firebaseapp.com",
  databaseURL: "https://timetrackerlogin-632a2-default-rtdb.firebaseio.com",
  projectId: "timetrackerlogin-632a2",
  storageBucket: "timetrackerlogin-632a2.firebasestorage.app",
  messagingSenderId: "130743498609",
  appId: "1:130743498609:web:2e3e8a9e30ac909d7fa8d0",
  measurementId: "G-TXHCMSRBN7"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

/* =========================
SERVER TIME SYNC
========================= */

let serverOffset = 0;

const offsetRef = ref(db, ".info/serverTimeOffset");

onValue(offsetRef, (snap) => {
  serverOffset = snap.val() || 0;
});

function serverNow() {
  return Date.now() + serverOffset;
}

/* =========================
DATA
========================= */

let config = {
  timers: [],
  bosses: []
};

let intervals = [];
let activeTimers = {};
let timerDataCache = {};
let finishedTimerCache = {};
let timerReportFallbacks = {};
let timerListeners = [];
let finishedBlinkTimeouts = {};
let unsubscribeBosses = null;
let unsubscribeConfig = null;

const FINISHED_BLINK_MS = 10000;
const MIN_KILL_TIME_SECONDS = 30;

function getTimerBoss(i) {
  const bossId = config.timers[i]?.bossId ?? 0;
  return config.bosses[bossId] || null;
}

function getAlarmStorageKey(i) {
  const bossId = config.timers[i]?.bossId ?? 0;
  return "alarmEnabled_boss_" + bossId;
}

function isAlarmEnabled(i) {
  try {
    return localStorage.getItem(getAlarmStorageKey(i)) !== "false";
  } catch (e) {
    return true;
  }
}

function getTimerFinishedAt(data) {
  if (!data || typeof data.start !== "number" || typeof data.tempo !== "number") {
    return null;
  }

  return data.start + data.tempo * 1000;
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = safeSeconds % 60;

  if (h > 0) {
    return [
      String(h).padStart(2, "0"),
      String(m).padStart(2, "0"),
      String(s).padStart(2, "0")
    ].join(":");
  }

  return [
    String(m).padStart(2, "0"),
    String(s).padStart(2, "0")
  ].join(":");
}

function clearFinishedBlink(i) {
  if (finishedBlinkTimeouts[i]) {
    clearTimeout(finishedBlinkTimeouts[i]);
    delete finishedBlinkTimeouts[i];
  }

  document.querySelectorAll(".timer")[i]?.classList.remove("finished");
}

function setKillReport(i, seconds, bossName, recordSeconds) {
  const label = document.querySelectorAll(".timer")[i]?.querySelector(".killLabel");
  if (!label) return;

  const recordText = typeof recordSeconds === "number"
    ? `O Record \u00e9 de: ${formatDuration(recordSeconds)}`
    : "N\u00e3o h\u00e1 records ainda";

  label.textContent =
    `Voce demorou ${formatDuration(seconds)} para matar o ${bossName}. ${recordText}`;
}

function getKillReportTime(report) {
  if (!report || typeof report.delaySeconds !== "number") {
    return -Infinity;
  }

  if (typeof report.restartedAtMs === "number") {
    return report.restartedAtMs;
  }

  if (typeof report.restartedAt === "number") {
    return report.restartedAt;
  }

  if (typeof report.finishedAt === "number") {
    return report.finishedAt + report.delaySeconds * 1000;
  }

  return 0;
}

function pickLatestKillReport(reports) {
  return reports
    .filter((report) => report && typeof report.delaySeconds === "number")
    .sort((a, b) => getKillReportTime(b) - getKillReportTime(a))[0] || null;
}

function pickBestRecord(records) {
  return records
    .filter((record) => record && typeof record.delaySeconds === "number")
    .sort((a, b) => a.delaySeconds - b.delaySeconds)[0] || null;
}

function setEmptyKillReport(i) {
  const label = document.querySelectorAll(".timer")[i]?.querySelector(".killLabel");
  if (!label) return;

  label.textContent = "nenhum valor registrado ainda.";
}

function renderKillReport(i) {
  const bossId = config.timers[i]?.bossId ?? 0;
  const boss = config.bosses[bossId];
  const timerConfig = config.timers[i];
  const timerConfigReport =
    timerConfig?.lastKillReport?.bossId === bossId
      ? timerConfig.lastKillReport
      : null;
  const timerConfigRecord =
    timerConfig?.record?.bossId === bossId
      ? timerConfig.record
      : null;
  const fallback = timerReportFallbacks[i];
  const report = pickLatestKillReport([
    boss?.lastKillReport,
    timerConfigReport,
    fallback?.lastKillReport
  ]);
  const record = pickBestRecord([
    boss?.record,
    timerConfigRecord,
    fallback?.record
  ]);

  if (!report || typeof report.delaySeconds !== "number") {
    setEmptyKillReport(i);
    return;
  }

  const recordSeconds =
    record && typeof record.delaySeconds === "number"
      ? record.delaySeconds
      : null;

  setKillReport(
    i,
    report.delaySeconds,
    report.bossName || record?.bossName || "boss",
    recordSeconds
  );
}

function renderTimerPayloadKillReport(i, data) {
  if (!data?.lastKillReport || typeof data.lastKillReport.delaySeconds !== "number") {
    delete timerReportFallbacks[i];
    renderKillReport(i);
    return;
  }

  timerReportFallbacks[i] = {
    lastKillReport: data.lastKillReport,
    record: data.record || null
  };

  const recordSeconds =
    data.record && typeof data.record.delaySeconds === "number"
      ? data.record.delaySeconds
      : null;

  setKillReport(
    i,
    data.lastKillReport.delaySeconds,
    data.lastKillReport.bossName || data.bossName || "boss",
    recordSeconds
  );
}

function renderAllKillReports() {
  config.timers.forEach((t, i) => {
    renderKillReport(i);
  });
}

function setKillReportError(i, message) {
  const label = document.querySelectorAll(".timer")[i]?.querySelector(".killLabel");
  if (!label) return;

  label.textContent = message;
}

function stopAllTimerListeners() {
  timerListeners.forEach((unsub) => {
    if (unsub) unsub();
  });

  timerListeners = [];
}

function cleanupRealtimeListeners() {
  stopAllTimerListeners();

  if (unsubscribeBosses) {
    unsubscribeBosses();
    unsubscribeBosses = null;
  }

  if (unsubscribeConfig) {
    unsubscribeConfig();
    unsubscribeConfig = null;
  }

  stopWatchingOnlineUsers();
  stopPresenceTracking();
}

/* =========================
LOAD BOSSES
========================= */

function renderBossConfig() {
  let div = document.getElementById("bossConfig");
  div.innerHTML = "";

  config.bosses.forEach((b, i) => {
    let row = document.createElement("div");
    row.className = "bossRow";

    let nome = document.createElement("input");
    nome.value = b.nome;

    nome.onchange = () => {
      config.bosses[i].nome = nome.value;
      saveConfig();
      updateBossDropdowns();
    };

    let tempo = document.createElement("input");
    tempo.type = "number";
    tempo.value = b.tempo;
    tempo.style.width = "60px";

    tempo.onchange = () => {
      config.bosses[i].tempo = parseInt(tempo.value) || 0;
      saveConfig();
    };

    let del = document.createElement("button");
    del.textContent = "X";

    del.onclick = (e) => {
      e.stopPropagation();

      config.bosses.splice(i, 1);

      saveConfig();
      renderBossConfig();
      updateBossDropdowns();
    };

    let clearRecord = document.createElement("button");
    clearRecord.className = "clearRecord";
    clearRecord.textContent = "Limpar Record";

    clearRecord.onclick = (e) => {
      e.stopPropagation();
      clearBossRecord(i);
    };

    row.append(nome, tempo, clearRecord, del);
    div.appendChild(row);
  });
}

function updateBossDropdowns() {
  const selects = document.querySelectorAll(".timer select");

  selects.forEach((select, i) => {
    const current = config.timers[i]?.bossId ?? 0;

    select.innerHTML = "";

    config.bosses.forEach((b, index) => {
      let opt = document.createElement("option");
      opt.value = index;
      opt.textContent = b.nome;
      select.appendChild(opt);
    });

    select.value = current;
  });
}

document.getElementById("addBoss").onclick = () => {
  config.bosses.push({
    nome: "New Boss",
    tempo: 60
  });

  saveConfig();
};

function loadBosses() {
  const bossRef = ref(db, "config/bosses");

  if (unsubscribeBosses) {
    unsubscribeBosses();
  }

  unsubscribeBosses = onValue(bossRef, (snapshot) => {
    const data = snapshot.val();

    config.bosses = data || [];

    if (config.bosses.length === 0) {
      config.bosses.push({
        nome: "Boss Default",
        tempo: 60
      });
    }

    updateBossDropdowns();
    renderBossConfig();
    renderAllKillReports();
  });
}

/* =========================
LOAD TIMERS CONFIG
========================= */

function loadConfig() {
  const configRef = ref(db, "config/timers");

  if (unsubscribeConfig) {
    unsubscribeConfig();
  }

  unsubscribeConfig = onValue(configRef, (snapshot) => {
    const data = snapshot.val();

    config.timers = data || [];

    if (config.timers.length === 0) {
      config.timers.push({ bossId: 0 });
    }

    intervals.length = config.timers.length;

    createTimers();
    syncTimers();
    renderAllKillReports();
  });
}

/* =========================
SAVE GLOBAL
========================= */

function saveGlobal() {
  set(ref(db, "config/timers"), config.timers);
}

function saveConfig() {
  set(ref(db, "config/bosses"), config.bosses);
}

function clearBossRecord(bossId) {
  const updates = [
    set(ref(db, "config/bosses/" + bossId + "/record"), null)
  ];

  config.timers.forEach((timer, timerIndex) => {
    if ((timer?.bossId ?? 0) === bossId) {
      updates.push(set(ref(db, "config/timers/" + timerIndex + "/record"), null));
    }
  });

  Promise.all(updates)
    .then(() => {
      if (config.bosses[bossId]) {
        config.bosses[bossId].record = null;
      }

      config.timers.forEach((timer) => {
        if ((timer?.bossId ?? 0) === bossId) {
          timer.record = null;
        }
      });

      renderAllKillReports();
    })
    .catch((error) => {
      console.error("Erro ao limpar record do boss:", error);
    });
}

function saveTimerConfigKillFallback(i, report, record) {
  if (!config.timers[i]) {
    return Promise.resolve();
  }

  config.timers[i] = {
    ...config.timers[i],
    lastKillReport: report,
    record
  };

  return Promise.all([
    set(ref(db, "config/timers/" + i + "/lastKillReport"), report),
    set(ref(db, "config/timers/" + i + "/record"), record)
  ]).catch((error) => {
    console.warn("Fallback em config/timers nao foi salvo:", error);
  });
}

async function loadPreviousTimerData(i) {
  const candidates = [
    timerDataCache[i],
    finishedTimerCache[i]
  ];

  try {
    const snapshot = await get(ref(db, "timers/" + i));
    const data = snapshot.val();

    if (data) {
      timerDataCache[i] = data;
      candidates.push(data);
    }
  } catch (error) {
    console.warn("Nao foi possivel buscar timer anterior antes de reiniciar:", error);
  }

  return candidates
    .filter((data) => getTimerFinishedAt(data) !== null)
    .sort((a, b) => getTimerFinishedAt(b) - getTimerFinishedAt(a))[0] || null;
}

async function recordTimerRestartDelay(i, previousTimerData) {
  const user = auth.currentUser;
  const data = previousTimerData || timerDataCache[i] || finishedTimerCache[i];
  const finishedAt = getTimerFinishedAt(data);
  const now = serverNow();

  if (!user || !finishedAt || now < finishedAt) {
    console.warn("Registro ignorado: timer anterior ausente, usuario deslogado ou timer ainda nao acabou.", {
      timerIndex: i,
      hasUser: Boolean(user),
      data,
      finishedAt,
      now
    });
    return;
  }

  const bossId = data.bossId ?? config.timers[i]?.bossId ?? 0;
  const boss = config.bosses[bossId] || getTimerBoss(i);
  const bossName = data.bossName || boss?.nome || "Boss";
  const username = user.email?.split("@")[0].toLowerCase() || user.uid;
  const delaySeconds = Math.floor((now - finishedAt) / 1000);
  const historyKey = String(Math.round(now));

  if (delaySeconds <= MIN_KILL_TIME_SECONDS) {
    console.warn("Registro ignorado: tempo menor ou igual ao minimo.", {
      timerIndex: i,
      delaySeconds,
      minimo: MIN_KILL_TIME_SECONDS
    });
    return null;
  }

  const record = {
    uid: user.uid,
    username,
    email: user.email || "",
    bossId,
    bossName,
    timerIndex: i,
    finishedAt,
    restartedAtMs: now,
    restartedAt: serverTimestamp(),
    delaySeconds
  };
  const localRecord = config.bosses[bossId]?.record || null;
  const fallbackRecord =
    localRecord &&
    typeof localRecord.delaySeconds === "number" &&
    localRecord.delaySeconds <= delaySeconds
      ? localRecord
      : record;

  try {
    const recordRef = ref(db, "config/bosses/" + bossId + "/record");
    const recordResult = await runTransaction(recordRef, (currentRecord) => {
      if (
        !currentRecord ||
        typeof currentRecord.delaySeconds !== "number" ||
        delaySeconds < currentRecord.delaySeconds
      ) {
        return record;
      }

      return currentRecord;
    });
    const bossRecord = recordResult.snapshot.val();

    await set(ref(db, "config/bosses/" + bossId + "/lastKillReport"), record);

    config.bosses[bossId] = {
      ...config.bosses[bossId],
      lastKillReport: record,
      record: bossRecord
    };
    await saveTimerConfigKillFallback(i, record, bossRecord);
    renderAllKillReports();

    Promise.all([
      set(ref(db, "killTimes/" + bossId + "/" + user.uid), record),
      set(ref(db, "killTimeHistory/" + bossId + "/" + user.uid + "/" + historyKey), record)
    ]).catch((historyError) => {
      console.warn("Historico opcional nao foi salvo:", historyError);
    });

    return {
      report: record,
      record: bossRecord
    };
  } catch (error) {
    console.error("Erro ao salvar tempo de reinicio:", error);
    setKillReportError(i, "Nao foi possivel salvar o tempo. Verifique as regras do Firebase.");
    await saveTimerConfigKillFallback(i, record, fallbackRecord);
    renderAllKillReports();

    return {
      report: record,
      record: fallbackRecord
    };
  }
}

/* =========================
CREATE TIMERS UI
========================= */

function createTimers() {
  let container = document.getElementById("timers");
  container.innerHTML = "";

  config.timers.forEach((t, i) => {
    let div = document.createElement("div");
    div.className = "timer";

    let select = document.createElement("select");

    config.bosses.forEach((b, index) => {
      let opt = document.createElement("option");
      opt.value = index;
      opt.textContent = b.nome;
      select.appendChild(opt);
    });

    select.value = t.bossId || 0;

    select.onchange = () => {
      config.timers[i].bossId = parseInt(select.value);
      saveGlobal();
      updateIcon();
      renderKillReport(i);
    };

    let label = document.createElement("span");
    label.className = "timeLabel";
    label.textContent = "00:00";

    let progress = document.createElement("div");
    progress.className = "progress";

    let bar = document.createElement("div");
    bar.className = "bar";

    progress.appendChild(bar);

    // =========================
    // ðŸ”” BOTÃƒO DE ALARME (LOCAL)
    // =========================

    let alarmBtn = document.createElement("button");
    let enabled = true;

    

    function updateIcon() {
      enabled = isAlarmEnabled(i);
      alarmBtn.innerHTML = enabled ? "&#128276;" : "&#128277;";
      alarmBtn.style.opacity = enabled ? "1" : "0.4";
    }

    updateIcon();

    alarmBtn.onclick = () => {
      const enabled = !isAlarmEnabled(i);
      try {
        localStorage.setItem(getAlarmStorageKey(i), enabled);
      } catch (e) {}
      updateIcon();
    };

    alarmBtn.style.minWidth = "40px";
    alarmBtn.style.display = "inline-block";
    alarmBtn.style.textAlign = "center";
    alarmBtn.style.padding = "6px 10px";
    alarmBtn.style.fontSize = "16px";
    alarmBtn.title = "Ativar/Desativar Alarme";

    // =========================
    // BOTÃƒO START/STOP
    // =========================

    let btn = document.createElement("button");
    btn.className = "startBtn";
    btn.textContent = "Start";

    btn.onclick = () => toggleTimer(i);

    let killLabel = document.createElement("div");
    killLabel.className = "killLabel";
    killLabel.textContent = "nenhum valor registrado ainda.";

    div.append(select, label, progress, alarmBtn, btn, killLabel);
    container.appendChild(div);
  });
}

/* =========================
ADD TIMER
========================= */

document.getElementById("addTimer").onclick = () => {
  if (config.timers.length >= 8) return;

  config.timers.push({ bossId: 0 });
  saveGlobal();
};

/* =========================
REMOVE TIMER
========================= */

document.getElementById("removeTimer").onclick = () => {
  if (config.timers.length <= 1) return;

  let index = config.timers.length - 1;

  stopTimer(index);
  set(ref(db, "timers/" + index), null);

  config.timers.pop();

  saveGlobal();
};

/* =========================
START / STOP
========================= */

function toggleTimer(i) {
  stopAlarm();
  clearFinishedBlink(i);

  let timerDiv = document.querySelectorAll(".timer")[i];

  if (timerDiv) {
    timerDiv.classList.remove("finished");
  }

  if (intervals[i]) {
    stopTimer(i);
  } else {
    startTimer(i);
  }
}

/* =========================
START TIMER
========================= */

async function startTimer(i) {
  const boss = getTimerBoss(i);
  if (!boss) return;

  const previousTimerData = await loadPreviousTimerData(i);

  if (previousTimerData) {
    timerDataCache[i] = previousTimerData;
  }

  const killResult = await recordTimerRestartDelay(i, previousTimerData);

  const bossId = config.timers[i]?.bossId ?? 0;
  let total = boss.tempo * 60;
  const timerPayload = {
    start: serverTimestamp(),
    tempo: total,
    bossId,
    bossName: boss.nome
  };

  if (killResult?.report) {
    timerPayload.lastKillReport = killResult.report;
    timerPayload.record = killResult.record;
  }

  set(ref(db, "timers/" + i), timerPayload).catch((error) => {
    console.error("Erro ao iniciar timer com dados de kill:", error);

    set(ref(db, "timers/" + i), {
      start: serverTimestamp(),
      tempo: total,
      bossId,
      bossName: boss.nome
    }).catch((fallbackError) => {
      console.error("Erro ao iniciar timer:", fallbackError);
      setKillReportError(i, "Nao foi possivel iniciar/salvar o timer. Verifique as regras do Firebase.");
    });
  });
}

/* =========================
STOP TIMER
========================= */

function stopTimer(i) {
  clearInterval(intervals[i]);
  intervals[i] = null;

  delete activeTimers[i];
  delete timerDataCache[i];
  delete finishedTimerCache[i];
  delete timerReportFallbacks[i];
  clearFinishedBlink(i);

  updateBigTimer();

  let label = document.querySelectorAll(".timer")[i]?.querySelector(".timeLabel");
  let bar = document.querySelectorAll(".timer")[i]?.querySelector(".bar");
  let btn = document.querySelectorAll(".timer")[i]?.querySelector(".startBtn");

  if (label) {
    label.textContent = "00:00";
    bar.style.width = "0%";
    btn.textContent = "Start";
  }

  set(ref(db, "timers/" + i), null);
}

/* =========================
SYNC TIMERS
========================= */

function syncTimers() {
  stopAllTimerListeners();

  config.timers.forEach((t, i) => {
    const timerRef = ref(db, "timers/" + i);

    const unsubscribe = onValue(timerRef, (snapshot) => {
      const data = snapshot.val();

      const timerDiv = document.querySelectorAll(".timer")[i];
      const label = document.querySelectorAll(".timer")[i]?.querySelector(".timeLabel");
      const bar = document.querySelectorAll(".timer")[i]?.querySelector(".bar");
      const btn = document.querySelectorAll(".timer")[i]?.querySelector(".startBtn");

      if (!label || !bar || !btn) return;

      if (data === null) {
        clearInterval(intervals[i]);
        intervals[i] = null;

        delete activeTimers[i];
        delete timerDataCache[i];
        delete finishedTimerCache[i];
        delete timerReportFallbacks[i];
        updateBigTimer();

        clearFinishedBlink(i);
        label.textContent = "00:00";
        bar.style.width = "0%";
        btn.textContent = "Start";
        renderKillReport(i);

        return;
      }

      timerDataCache[i] = data;
      renderTimerPayloadKillReport(i, data);
      runTimer(i, data);
    });

    timerListeners.push(unsubscribe);
  });
}

/* =========================
RUN TIMER
========================= */

function runTimer(i, data) {
  let timerDiv = document.querySelectorAll(".timer")[i];
  let label = document.querySelectorAll(".timer")[i]?.querySelector(".timeLabel");
  let bar = document.querySelectorAll(".timer")[i]?.querySelector(".bar");
  let btn = document.querySelectorAll(".timer")[i]?.querySelector(".startBtn");
  const bossId = data.bossId ?? config.timers[i]?.bossId ?? 0;
  const boss = config.bosses[bossId] || getTimerBoss(i);

  if (!label || !bar || !btn || !boss) return;

  let total = data.tempo;

  clearInterval(intervals[i]);
  timerDiv?.classList.remove("finished");
  stopAlarm();

  intervals[i] = setInterval(() => {
    let elapsed = (serverNow() - data.start) / 1000;
    let remaining = Math.floor(total - elapsed);

    if (remaining < 0) remaining = 0;

    let m = Math.floor(remaining / 60);
    let s = remaining % 60;

    label.textContent =
      String(m).padStart(2, "0") + ":" +
      String(s).padStart(2, "0");

    bar.style.width = ((total - remaining) / total * 100) + "%";

    btn.textContent = "Stop";

    activeTimers[i] = {
      remaining: remaining,
      label: boss.nome
    };

    updateBigTimer();

    if (remaining <= 0) {
      remaining = 0;
      label.textContent = "00:00";
      triggerTimerFinished(i, data);
    }
  }, 1000);
}

/* =========================
TIMER FINISHED
========================= */

function triggerTimerFinished(i, data) {
  clearInterval(intervals[i]);
  intervals[i] = null;

  delete activeTimers[i];
  finishedTimerCache[i] = data;
  updateBigTimer();

  let timerDiv = document.querySelectorAll(".timer")[i];
  let label = document.querySelectorAll(".timer")[i]?.querySelector(".timeLabel");
  let btn = document.querySelectorAll(".timer")[i]?.querySelector(".startBtn");

  const finishedAt = getTimerFinishedAt(data);
  const blinkRemaining = finishedAt
    ? FINISHED_BLINK_MS - (serverNow() - finishedAt)
    : FINISHED_BLINK_MS;

  clearFinishedBlink(i);

  if (timerDiv && blinkRemaining > 0) {
    timerDiv.classList.add("finished");
    finishedBlinkTimeouts[i] = setTimeout(() => {
      timerDiv.classList.remove("finished");
      delete finishedBlinkTimeouts[i];
    }, blinkRemaining);
  }

  if (label) {
    label.textContent = "00:00";
  }

  if (btn) {
    btn.textContent = "Start";
  }

  if (isAlarmEnabled(i) && blinkRemaining > 0) {
    playAlarm();
  }
}

/* =========================
BIG TIMER
========================= */

function updateBigTimer() {
  let keys = Object.keys(activeTimers);

  if (keys.length === 0) {
    document.getElementById("bigTimer").textContent = "00:00";
    document.getElementById("bigLabel").textContent = "No Timer Running";
    return;
  }

  let lowest = null;
  let index = null;

  keys.forEach((k) => {
    if (lowest === null || activeTimers[k].remaining < lowest) {
      lowest = activeTimers[k].remaining;
      index = k;
    }
  });

  let remaining = activeTimers[index].remaining;

  let m = Math.floor(remaining / 60);
  let s = remaining % 60;

  document.getElementById("bigTimer").textContent =
    String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");

  document.getElementById("bigLabel").textContent =
    activeTimers[index].label;
}

/* =========================
ALARM
========================= */

function playAlarm() {
  let audio = document.getElementById("alarmSound");
  if (!audio) return;

  audio.currentTime = 0;
  audio.play();
}

function stopAlarm() {
  let audio = document.getElementById("alarmSound");
  if (!audio) return;

  audio.pause();
  audio.currentTime = 0;
}

/* =========================
OBS MODE
========================= */

const obsBtn = document.getElementById("obsBtn");
const exitObs = document.getElementById("exitObs");

obsBtn.onclick = () => {
  const rightPanel = document.querySelector(".rightPanel");
  const leftPanel = document.querySelector(".leftPanel");

  rightPanel.style.display = "none";
  leftPanel.style.width = "100%";

  obsBtn.style.display = "none";
  exitObs.classList.remove("hidden");
};

exitObs.onclick = () => {
  const rightPanel = document.querySelector(".rightPanel");
  const leftPanel = document.querySelector(".leftPanel");

  rightPanel.style.display = "";
  leftPanel.style.width = "40%";

  obsBtn.style.display = "inline-block";
  exitObs.classList.add("hidden");
};

/* =========================
ADMIN USERS PANEL
========================= */

const adminUsersBtn = document.getElementById("adminUsersBtn");
const adminUsersPanel = document.getElementById("adminUsersPanel");
const closeAdminUsers = document.getElementById("closeAdminUsers");
const adminUsersList = document.getElementById("adminUsersList");

let currentUserId = null;
let onlineUsersUnsubscribe = null;
let presenceUnsubscribe = null;

const ADMIN_USERS = [
  "pain",
  "dell",
  "million",
  "theuzin"
];

function isAdminUser(user) {
  if (!user?.email) return false;

  const username = user.email.split("@")[0].toLowerCase();
  return ADMIN_USERS.includes(username);
}

function openAdminUsersPanel() {
  if (!adminUsersPanel) return;
  adminUsersPanel.classList.remove("hidden");
}

function closeAdminUsersPanel() {
  if (!adminUsersPanel) return;
  adminUsersPanel.classList.add("hidden");
}

if (adminUsersBtn) {
  adminUsersBtn.onclick = (e) => {
    e.stopPropagation();
    openAdminUsersPanel();
  };
}

if (closeAdminUsers) {
  closeAdminUsers.onclick = (e) => {
    e.stopPropagation();
    closeAdminUsersPanel();
  };
}

document.addEventListener("click", (e) => {
  if (!adminUsersPanel || !adminUsersBtn) return;
  if (adminUsersPanel.classList.contains("hidden")) return;

  if (!adminUsersPanel.contains(e.target) && !adminUsersBtn.contains(e.target)) {
    closeAdminUsersPanel();
  }
});

function renderOnlineUsers(usersObj) {
  if (!adminUsersList) return;

  adminUsersList.innerHTML = "";

  if (!usersObj) {
    adminUsersList.innerHTML = "<div>Nenhum usuÃ¡rio logado.</div>";
    return;
  }

  const entries = Object.entries(usersObj);

  if (entries.length === 0) {
    adminUsersList.innerHTML = "<div>Nenhum usuÃ¡rio logado.</div>";
    return;
  }

  entries.forEach(([uid, data]) => {
    const row = document.createElement("div");
    row.className = "admin-user-row";

    const name = document.createElement("div");
    name.className = "admin-user-name";
    name.textContent = data?.username || data?.email || uid;

    const status = document.createElement("div");
    status.className = "admin-user-status";
    status.textContent = "Online";

    row.append(name, status);
    adminUsersList.appendChild(row);
  });
}

function watchOnlineUsers() {
  const usersRef = ref(db, "onlineUsers");

  if (onlineUsersUnsubscribe) {
    onlineUsersUnsubscribe();
  }

  onlineUsersUnsubscribe = onValue(
    usersRef,
    (snapshot) => {
      console.log("onlineUsers snapshot:", snapshot.val());
      renderOnlineUsers(snapshot.val());
    },
    (error) => {
      console.error("Erro ao ler onlineUsers:", error);
    }
  );
}

function stopWatchingOnlineUsers() {
  if (onlineUsersUnsubscribe) {
    onlineUsersUnsubscribe();
    onlineUsersUnsubscribe = null;
  }
}

function stopPresenceTracking() {
  if (presenceUnsubscribe) {
    presenceUnsubscribe();
    presenceUnsubscribe = null;
  }
}

function resetDashboardState() {
  intervals.forEach((interval) => clearInterval(interval));
  Object.keys(finishedBlinkTimeouts).forEach((key) => clearTimeout(finishedBlinkTimeouts[key]));
  intervals = [];
  activeTimers = {};
  timerDataCache = {};
  finishedTimerCache = {};
  timerReportFallbacks = {};
  finishedBlinkTimeouts = {};
  stopAlarm();

  const timersContainer = document.getElementById("timers");
  if (timersContainer) {
    timersContainer.innerHTML = "";
  }

  document.getElementById("bigTimer").textContent = "00:00";
  document.getElementById("bigLabel").textContent = "No Timer Running";
}

function markUserOnline(user) {
  if (!user?.email || !user?.uid) return;

  const username = user.email.split("@")[0].toLowerCase();
  currentUserId = user.uid;

  const userRef = ref(db, "onlineUsers/" + user.uid);
  const connectedRef = ref(db, ".info/connected");

  stopPresenceTracking();

  presenceUnsubscribe = onValue(connectedRef, (snap) => {
    if (snap.val() !== true) {
      console.log("Cliente ainda nÃ£o conectado ao Realtime Database.");
      return;
    }

    onDisconnect(userRef)
      .remove()
      .then(() => {
        console.log("onDisconnect registrado para:", username);
      })
      .catch((error) => {
        console.error("Erro ao registrar onDisconnect:", error);
      });

    set(userRef, {
      uid: user.uid,
      username,
      email: user.email,
      loginAt: serverTimestamp()
    })
      .then(() => {
        console.log("UsuÃ¡rio marcado online:", username);
      })
      .catch((error) => {
        console.error("Erro ao gravar onlineUsers:", error);
      });
  });
}

function markUserOffline() {
  if (!currentUserId) return;

  set(ref(db, "onlineUsers/" + currentUserId), null)
    .then(() => {
      console.log("UsuÃ¡rio removido de onlineUsers:", currentUserId);
    })
    .catch((error) => {
      console.error("Erro ao remover usuÃ¡rio de onlineUsers:", error);
    });

  currentUserId = null;
}

/* =========================
CONFIG PANEL
========================= */

document.getElementById("configBtn").onclick = (e) => {
  e.stopPropagation();
  document.getElementById("configPanel").classList.toggle("hidden");
};

document.getElementById("closeConfig").onclick = (e) => {
  e.stopPropagation();
  document.getElementById("configPanel").classList.add("hidden");
};

document.addEventListener("click", (e) => {
  const panel = document.getElementById("configPanel");
  const btn = document.getElementById("configBtn");

  if (panel.classList.contains("hidden")) return;

  if (!panel.contains(e.target) && !btn.contains(e.target)) {
    panel.classList.add("hidden");
  }
});

/* =========================
AUTH & LOGIN (MODO USUÃRIO)
========================= */

const loginScreen = document.getElementById("loginScreen");
const btnLogin = document.getElementById("btnLogin");
const logoutBtn = document.getElementById("logoutBtn");

if (logoutBtn) {
  logoutBtn.onclick = () => {
    signOut(auth).catch((error) => {
      console.error("Erro ao deslogar:", error);
    });
  };
}

btnLogin.onclick = () => {
  const userField = document.getElementById("loginUser").value.trim();
  const passField = document.getElementById("loginPassword").value;
  const errorMsg = document.getElementById("loginError");

  if (!userField || !passField) {
    errorMsg.textContent = "Preencha todos os campos.";
    return;
  }

  const internalEmail = `${userField.toLowerCase()}@timer.com`;

  signInWithEmailAndPassword(auth, internalEmail, passField)
    .then(() => {
      errorMsg.textContent = "";
    })
    .catch((error) => {
      errorMsg.textContent = "UsuÃ¡rio ou senha invÃ¡lidos.";
      console.error("Erro de login:", error.code);
    });
};

onAuthStateChanged(auth, (user) => {
  if (user) {
    cleanupRealtimeListeners();
    loginScreen.classList.remove("active");
    logoutBtn?.classList.remove("hidden");
    loadBosses();
    loadConfig();

    markUserOnline(user);

    if (isAdminUser(user)) {
      adminUsersBtn?.classList.remove("hidden");
      watchOnlineUsers();
    } else {
      adminUsersBtn?.classList.add("hidden");
      closeAdminUsersPanel();
      stopWatchingOnlineUsers();
    }
  } else {
    cleanupRealtimeListeners();
    resetDashboardState();
    loginScreen.classList.add("active");
    logoutBtn?.classList.add("hidden");
    adminUsersBtn?.classList.add("hidden");
    closeAdminUsersPanel();
    markUserOffline();
  }
});

window.addEventListener("beforeunload", () => {
  markUserOffline();
});
