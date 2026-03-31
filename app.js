import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, onValue, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


/* =========================
FIREBASE
========================= */

const firebaseConfig = {
  apiKey: "AIzaSyBtPHeua_gIhCpnGcP6SguY1ZiQQ6YuGfQ",
  authDomain: "timetrackerlogin-632a2.firebaseapp.com",
  // Adicione a linha abaixo (confirme se o ID do projeto está correto)
  databaseURL: "https://timetrackerlogin-632a2-default-rtdb.firebaseio.com", 
  projectId: "timetrackerlogin-632a2",
  storageBucket: "timetrackerlogin-632a2.firebasestorage.app",
  messagingSenderId: "130743498609",
  appId: "1:130743498609:web:2e3e8a9e30ac909d7fa8d0",
  measurementId: "G-TXHCMSRBN7"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app); // Inicializa o Auth

/* =========================
SERVER TIME SYNC
========================= */

let serverOffset = 0

const offsetRef = ref(db,".info/serverTimeOffset")

onValue(offsetRef,(snap)=>{
 serverOffset = snap.val() || 0
})

function serverNow(){
 return Date.now() + serverOffset
}

/* =========================
DATA
========================= */

let config={
 timers:[],
 bosses:[]
}

let intervals=[]
let activeTimers={}
let timerListeners=[]

/* =========================
LOAD BOSSES
========================= */

function renderBossConfig(){

 let div=document.getElementById("bossConfig")
 div.innerHTML=""

 config.bosses.forEach((b,i)=>{

  let row=document.createElement("div")
  row.className="bossRow"

  let nome=document.createElement("input")
  nome.value=b.nome

  nome.onchange=()=>{
   config.bosses[i].nome=nome.value
   saveConfig()
   updateBossDropdowns()
  }

  let tempo=document.createElement("input")
  tempo.type="number"
  tempo.value=b.tempo
  tempo.style.width="60px"

  tempo.onchange=()=>{
  config.bosses[i].tempo=parseInt(tempo.value)||0
  saveConfig()
  }

  let del=document.createElement("button")
  del.textContent="X"

  del.onclick=(e)=>{
   e.stopPropagation()

   config.bosses.splice(i,1)

   saveConfig()
   renderBossConfig()
   updateBossDropdowns()
  }

  row.append(nome,tempo,del)

  div.appendChild(row)

 })

}

function updateBossDropdowns(){

 const selects=document.querySelectorAll(".timer select")

 selects.forEach((select,i)=>{

  const current=config.timers[i]?.bossId ?? 0

  select.innerHTML=""

  config.bosses.forEach((b,index)=>{

   let opt=document.createElement("option")
   opt.value=index
   opt.textContent=b.nome

   select.appendChild(opt)

  })

  select.value=current

 })

}


document.getElementById("addBoss").onclick=()=>{

 config.bosses.push({
  nome:"New Boss",
  tempo:60
 })

 saveConfig()

}

function loadBosses(){

 const bossRef=ref(db,"config/bosses")

 onValue(bossRef,(snapshot)=>{

const data = snapshot.val()

config.bosses = data || []

if(config.bosses.length === 0){
  config.bosses.push({
    nome: "Boss Default",
    tempo: 60
  })
}

updateBossDropdowns()
renderBossConfig()

 })

}

/* =========================
LOAD TIMERS CONFIG
========================= */

function loadConfig(){

 const configRef=ref(db,"config/timers")

 onValue(configRef,(snapshot)=>{

const data = snapshot.val()

config.timers = data || []

if(config.timers.length === 0){
  config.timers.push({ bossId: 0 })
}

intervals.length = config.timers.length

createTimers()
syncTimers()

 })

}

/* =========================
SAVE GLOBAL
========================= */

function saveGlobal(){
 set(ref(db,"config/timers"),config.timers)
}

function saveConfig(){
 set(ref(db,"config/bosses"),config.bosses)
}

/* =========================
CREATE TIMERS UI
========================= */

function createTimers(){

 let container=document.getElementById("timers")
 container.innerHTML=""

 config.timers.forEach((t,i)=>{

  let div=document.createElement("div")
  div.className="timer"

  let select=document.createElement("select")

  config.bosses.forEach((b,index)=>{
   let opt=document.createElement("option")
   opt.value=index
   opt.textContent=b.nome
   select.appendChild(opt)
  })

  select.value=t.bossId || 0

  select.onchange=()=>{
   config.timers[i].bossId=parseInt(select.value)
   saveGlobal()
  }

let label=document.createElement("span")
label.className = "timeLabel"
  label.textContent="00:00"

  let progress=document.createElement("div")
  progress.className="progress"

  let bar=document.createElement("div")
  bar.className="bar"

  progress.appendChild(bar)

// =========================
// 🔔 BOTÃO DE ALARME (LOCAL)
// =========================

let alarmBtn = document.createElement("button")

let bossId = t?.bossId ?? 0
const storageKey = "alarmEnabled_boss_" + bossId

let enabled = true

try {
  enabled = localStorage.getItem(storageKey) !== "false"
} catch(e) {}

function updateIcon(){
  alarmBtn.innerHTML = enabled ? "🔔" : "🔕"
  alarmBtn.style.opacity = enabled ? "1" : "0.4"
}

updateIcon()

alarmBtn.onclick = () => {
  enabled = !enabled
  try {
    localStorage.setItem(storageKey, enabled)
  } catch(e){}
  updateIcon()
}

// garante visibilidade
alarmBtn.style.minWidth = "40px"
alarmBtn.style.display = "inline-block"
alarmBtn.style.textAlign = "center"
alarmBtn.style.padding = "6px 10px"
alarmBtn.style.fontSize = "16px"

alarmBtn.title = "Ativar/Desativar Alarme"

  // =========================
  // BOTÃO START/STOP
  // =========================

  let btn=document.createElement("button")
    btn.className = "startBtn"
  btn.textContent="Start"

  btn.onclick=()=>toggleTimer(i)

  div.append(select,label,progress,alarmBtn,btn)

  container.appendChild(div)

 })

}



/* =========================
ADD TIMER
========================= */

document.getElementById("addTimer").onclick=()=>{

 if(config.timers.length>=8) return

 config.timers.push({bossId:0})
 saveGlobal()

}

/* =========================
REMOVE TIMER
========================= */

document.getElementById("removeTimer").onclick=()=>{

 if(config.timers.length<=1) return

 let index=config.timers.length-1

 stopTimer(index)
 set(ref(db,"timers/"+index),null)

 config.timers.pop()

 saveGlobal()

}

/* =========================
START / STOP
========================= */

function toggleTimer(i){

 stopAlarm()

 let timerDiv=document.querySelectorAll(".timer")[i]

 if(timerDiv){
  timerDiv.classList.remove("finished")
 }

 if(intervals[i]){
  stopTimer(i)
 }else{
  startTimer(i)
 }

}

/* =========================
START TIMER
========================= */

function startTimer(i){

 let bossId=config.timers[i].bossId ?? 0
 if(!config.bosses[bossId]) return

 let total=config.bosses[bossId].tempo*60

 set(ref(db,"timers/"+i),{

  start: serverTimestamp(),
  tempo: total

 })

}

/* =========================
STOP TIMER
========================= */

function stopTimer(i){

 clearInterval(intervals[i])
 intervals[i]=null

 delete activeTimers[i]

 updateBigTimer()

 let label=document.querySelectorAll(".timer")[i]?.querySelector(".timeLabel")
 let bar=document.querySelectorAll(".timer")[i]?.querySelector(".bar")
 let btn=document.querySelectorAll(".timer")[i]?.querySelector(".startBtn")

 if(label){

  label.textContent="00:00"
  bar.style.width="0%"
  btn.textContent="Start"

 }

 set(ref(db,"timers/"+i),null)

}

/* =========================
SYNC TIMERS
========================= */

function syncTimers(){

 timerListeners.forEach(unsub=>{
  if(unsub) unsub()
 })

 timerListeners=[]

 config.timers.forEach((t,i)=>{

  const timerRef = ref(db,"timers/"+i)

  const unsubscribe = onValue(timerRef,(snapshot)=>{

   const data = snapshot.val()

   const label=document.querySelectorAll(".timer")[i]?.querySelector(".timeLabel")
   const bar=document.querySelectorAll(".timer")[i]?.querySelector(".bar")
   const btn=document.querySelectorAll(".timer")[i]?.querySelector(".startBtn")

   if(!label || !bar || !btn) return

   if(data===null){

    clearInterval(intervals[i])
    intervals[i]=null

    delete activeTimers[i]
    updateBigTimer()

    label.textContent="00:00"
    bar.style.width="0%"
    btn.textContent="Start"

    return
   }

   runTimer(i,data)

  })

  timerListeners.push(unsubscribe)

 })

}

/* =========================
RUN TIMER
========================= */

function runTimer(i,data){

 let label=document.querySelectorAll(".timer")[i]?.querySelector(".timeLabel")
 let bar=document.querySelectorAll(".timer")[i]?.querySelector(".bar")
 let btn=document.querySelectorAll(".timer")[i]?.querySelector(".startBtn")

 let total=data.tempo

 clearInterval(intervals[i])

 intervals[i]=setInterval(()=>{

  let elapsed=(serverNow()-data.start)/1000
  let remaining=Math.floor(total-elapsed)

  if(remaining<0) remaining=0

  let m=Math.floor(remaining/60)
  let s=remaining%60

  label.textContent =
   String(m).padStart(2,"0")+":"+
   String(s).padStart(2,"0")

  bar.style.width=((total-remaining)/total*100)+"%"

  btn.textContent="Stop"

  activeTimers[i]={

   remaining:remaining,
   label:config.bosses[config.timers[i].bossId].nome

  }

  updateBigTimer()

if(remaining<=0){

 remaining=0
 label.textContent="00:00"

 triggerTimerFinished(i)

}

},1000)

}

/* =========================
TIMER FINISHED
========================= */

function triggerTimerFinished(i){

 clearInterval(intervals[i])

 let timerDiv=document.querySelectorAll(".timer")[i]

 if(timerDiv){
  timerDiv.classList.add("finished")
 }

 // =========================
 // 🔔 VERIFICA SE ALARME ESTÁ ATIVO (LOCAL)
 // =========================

const bossId = config.timers[i]?.bossId ?? 0
const storageKey = "alarmEnabled_boss_" + bossId
 const enabled = localStorage.getItem(storageKey) !== "false"

 if(enabled){
  playAlarm()
 }

}

/* =========================
BIG TIMER
========================= */

function updateBigTimer(){

 let keys=Object.keys(activeTimers)

 if(keys.length===0){

  document.getElementById("bigTimer").textContent="00:00"
  document.getElementById("bigLabel").textContent="No Timer Running"

  return

 }

 let lowest=null
 let index=null

 keys.forEach(k=>{

  if(lowest===null || activeTimers[k].remaining<lowest){
   lowest=activeTimers[k].remaining
   index=k
  }

 })

 let remaining=activeTimers[index].remaining

 let m=Math.floor(remaining/60)
 let s=remaining%60

 document.getElementById("bigTimer").textContent =
  String(m).padStart(2,"0")+":"+String(s).padStart(2,"0")

 document.getElementById("bigLabel").textContent =
  activeTimers[index].label

}

/* =========================
ALARM
========================= */

function playAlarm(){

 let audio=document.getElementById("alarmSound")
 if(!audio) return

 audio.currentTime=0
 audio.play()

}

function stopAlarm(){

 let audio=document.getElementById("alarmSound")
 if(!audio) return

 audio.pause()
 audio.currentTime=0

}

/* =========================
OBS MODE
========================= */

const obsBtn = document.getElementById("obsBtn")
const exitObs = document.getElementById("exitObs")

obsBtn.onclick = ()=>{

 const rightPanel = document.querySelector(".rightPanel")
 const leftPanel = document.querySelector(".leftPanel")

 rightPanel.style.display = "none"
 leftPanel.style.width = "100%"

 obsBtn.style.display = "none"
 exitObs.classList.remove("hidden")

}

exitObs.onclick = ()=>{

 const rightPanel = document.querySelector(".rightPanel")
 const leftPanel = document.querySelector(".leftPanel")

 rightPanel.style.display = ""
 leftPanel.style.width = "40%"

 obsBtn.style.display = "inline-block"
 exitObs.classList.add("hidden")

}

/* =========================
CONFIG PANEL
========================= */

document.getElementById("configBtn").onclick=(e)=>{

 e.stopPropagation()

 document.getElementById("configPanel").classList.toggle("hidden")

}

document.getElementById("closeConfig").onclick=(e)=>{

 e.stopPropagation()

 document.getElementById("configPanel").classList.add("hidden")

}

document.addEventListener("click",(e)=>{

 const panel=document.getElementById("configPanel")
 const btn=document.getElementById("configBtn")

 if(panel.classList.contains("hidden")) return

 if(!panel.contains(e.target) && !btn.contains(e.target)){
  panel.classList.add("hidden")
 }

})

/* =========================
AUTH & LOGIN (MODO USUÁRIO)
========================= */

const loginScreen = document.getElementById("loginScreen");
const btnLogin = document.getElementById("btnLogin");

btnLogin.onclick = () => {
  const userField = document.getElementById("loginUser").value.trim();
  const passField = document.getElementById("loginPassword").value;
  const errorMsg = document.getElementById("loginError");

  if (!userField || !passField) {
    errorMsg.textContent = "Preencha todos os campos.";
    return;
  }

  // Transformamos "admin" em "admin@timer.com" apenas para o Firebase
  const internalEmail = `${userField.toLowerCase()}@timer.com`;

  signInWithEmailAndPassword(auth, internalEmail, passField)
    .then(() => {
       errorMsg.textContent = "";
       // O onAuthStateChanged cuidará do resto
    })
    .catch((error) => {
      errorMsg.textContent = "Usuário ou senha inválidos.";
      console.error("Erro de login:", error.code);
    });
};

// Mantenha o observador para liberar o app
onAuthStateChanged(auth, (user) => {
  if (user) {
    loginScreen.classList.remove("active");
    loadBosses();
    loadConfig();
  } else {
    loginScreen.classList.add("active");
  }
});