// Função de segurança para persistência
function salvarDados() {
    try {
        // ... (seu código atual de coleta de dados)
        const dados = { /* ... */ }; 
        localStorage.setItem("agenda-data", JSON.stringify(dados));
    } catch (e) {
        console.error("Erro ao salvar dados no localStorage:", e);
    }
}

// Melhoria: carregamento seguro
function carregarDados() {
    try {
        const dados = localStorage.getItem("agenda-data");
        return dados ? JSON.parse(dados) : null;
    } catch (e) {
        console.error("Erro ao ler dados, limpando cache corrompido.");
        localStorage.removeItem("agenda-data");
        return null;
    }
}

let tokenClient;
let gapiInited   = false;
let gisInited    = false;
let isGoogleAuth = false;
let isDemoMode   = false;

(function () {
  // Tema fixo monocromático — sem picker de temas no guaxinin
  const saved = "mono";
})();

// Tema fixo mono — sem troca de temas



/* ============================================================
   HELPER DE PREFIXO — separa dados demo dos dados Google
   Chave demo:   "demo_kanbanTasks", "demo_agendaItems", etc.
   Chave google: "kanbanTasks",      "agendaItems",      etc.
   ============================================================ */
let googleUserEmail = "";  // será preenchido após login

function storageKey(base) {
  if (isDemoMode)   return "guaxinin_" + base;
  if (isGoogleAuth) return "google_" + googleUserEmail + "_" + base;
  return base;
}

function salvarDados() {
  try {
    localStorage.setItem(storageKey("kanbanTasks"), JSON.stringify(kanbanTasks || []));
    localStorage.setItem(storageKey("agendaItems"), JSON.stringify(agendaItems || []));

    const role = document.getElementById("avatar-role");
    const name = document.getElementById("avatar-name");
    const avatarPreview = document.getElementById("avatar-preview");

    if (role) localStorage.setItem(storageKey("avatarRole"),  role.textContent);
    if (name) localStorage.setItem(storageKey("avatarName"),  name.textContent);

    if (
      avatarPreview &&
      avatarPreview.src &&
      avatarPreview.src !== window.location.href
    ) {
      localStorage.setItem(storageKey("avatarImage"), avatarPreview.src);
    }
  } catch (error) {
    console.warn("Erro ao salvar dados:", error);
  }
}

function carregarDados(nomeAutenticado = null) {
  try {
    const kanbanSalvo = localStorage.getItem(storageKey("kanbanTasks"));
    const agendaSalva = localStorage.getItem(storageKey("agendaItems"));
    const roleSalva   = localStorage.getItem(storageKey("avatarRole"));
    const nomeSalvo   = localStorage.getItem(storageKey("avatarName"));
    const avatarSalvo = localStorage.getItem(storageKey("avatarImage"));

    if (kanbanSalvo) kanbanTasks = JSON.parse(kanbanSalvo);
    if (agendaSalva) agendaItems = JSON.parse(agendaSalva);

    const roleEl = document.getElementById("avatar-role");
    const nameEl = document.getElementById("avatar-name");

    if (roleSalva && roleEl) roleEl.textContent = roleSalva;
    // Só aplica nome do localStorage se não houver nome autenticado (Google/prompt)
    if (!nomeAutenticado && nomeSalvo && nameEl) nameEl.textContent = nomeSalvo;

    if (avatarSalvo) {
      const avatarPreview  = document.getElementById("avatar-preview");
      const avatarInitials = document.getElementById("avatar-initials");

      if (avatarPreview) {
        avatarPreview.src          = avatarSalvo;
        avatarPreview.style.display = "block";
      }
      if (avatarInitials) avatarInitials.style.display = "none";
    }
  } catch (error) {
    console.warn("Erro ao carregar dados:", error);
  }
}

async function onGapiLoad() {
  const apiKey = window.CONFIG ? window.CONFIG.GOOGLE_API_KEY : "";

  gapi.load("client", async () => {
    try {
      const initConfig = {
        discoveryDocs: [
          "https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest",
          "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest",
        ],
      };

      if (apiKey) initConfig.apiKey = apiKey;

      await gapi.client.init(initConfig);
      gapiInited = true;
      verificarPronto();
    } catch (e) {
      console.warn("Erro ao inicializar gapi.client:", e);
    }
  });
}

function onGisLoad() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES,
    callback: handleTokenResponse,
  });
  gisInited = true;
  verificarPronto();
}

// Quando ambos estiverem prontos, limpa qualquer mensagem de "aguarde"
function verificarPronto() {
  if (gapiInited && gisInited) {
    const statusEl = document.getElementById("auth-status");
    if (statusEl.textContent.includes("Aguarde")) {
      statusEl.textContent = "✅ Pronto! Clique novamente para entrar.";
    }
  }
}

/* ============================================================
   HANDLER DO TOKEN GOOGLE
   ============================================================ */
async function handleTokenResponse(resp) {
  if (resp.error) {
    document.getElementById("auth-status").textContent =
      "❌ Erro ao autenticar com Google.";
    return;
  }
  isGoogleAuth = true;

  // Pega nome real do perfil Google via userinfo
  try {
    const userinfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${gapi.client.getToken().access_token}` }
    });
    const userinfo = await userinfoRes.json();
    googleUserEmail = (userinfo.email || "user").replace(/[^a-z0-9]/gi, "_");

    // Prioridade: nome completo → primeiro nome → email formatado
    const emailPrefix = (userinfo.email || "dev@dev.com").split("@")[0];
    const name = userinfo.name || userinfo.given_name ||
      emailPrefix
        .split(/[\._\s]+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");

    iniciarDashboard(name);
    fetchGmailUnread();
    fetchCalendarEvents();
  } catch (e) {
    iniciarDashboard("Dev");
  }
}

/* ============================================================
   BOTÃO: LOGIN GOOGLE REAL
   ============================================================ */
document.getElementById("btn-google-login").addEventListener("click", () => {
  const statusEl = document.getElementById("auth-status");

  if (GOOGLE_CLIENT_ID === "SEU_CLIENT_ID_AQUI.apps.googleusercontent.com") {
    statusEl.textContent =
      "⚠️ Configure o CLIENT_ID no script.js para usar o Google.";
    return;
  }

  if (!gapiInited || !gisInited) {
    statusEl.textContent = "⏳ Aguarde, as bibliotecas ainda estão carregando...";
    let attempts = 0;
    const waitInterval = setInterval(() => {
      attempts++;
      if (gapiInited && gisInited) {
        clearInterval(waitInterval);
        statusEl.textContent = "";
        tokenClient.requestAccessToken({ prompt: "consent" });
      } else if (attempts >= 10) {
        clearInterval(waitInterval);
        statusEl.textContent = "❌ Não foi possível carregar as bibliotecas do Google. Recarregue a página.";
      }
    }, 500);
    return;
  }

  statusEl.textContent = "";
  tokenClient.requestAccessToken({ prompt: "consent" });
});

/* ============================================================
   BOTÃO: MODO DEMO (sem Google)
   Persiste dados com prefixo "demo_" no localStorage.
   Se já existir sessão demo salva, recarrega sem pedir nome.
   ============================================================ */
document.getElementById("btn-mock-login").addEventListener("click", () => {
  isDemoMode = true;

  const nomeSalvo = localStorage.getItem("guaxinin_avatarName");

  let userName;
  if (nomeSalvo && nomeSalvo.trim() !== "") {
    userName = nomeSalvo;
  } else {
    userName = prompt("Qual é o teu nome, artista?", "Artista");
    if (!userName || userName.trim() === "") userName = "Artista";
  }

  // Zera métricas que dependem do Google (sem API no modo demo)
  document.getElementById("metric-emails").textContent = "--";
  document.getElementById("metric-study").textContent  = "0h";
  totalStudyMinutes = 0;

  // Zera os arrays em memória antes de carregar — assim dados de exemplo
  // do modo Google não "vazam" para o demo quando não há nada salvo ainda
  kanbanTasks = [];
  agendaItems = [];

  iniciarDashboard(userName);
  buildChartMock(true);
});

function iniciarDashboard(userName) {
  const first    = userName.charAt(0).toUpperCase() + userName.slice(1);
  const initials = userName.slice(0, 2).toUpperCase();

  document.getElementById("username-display").textContent = first;
  document.getElementById("avatar-initials").textContent  = initials;
  document.getElementById("avatar-name").textContent      = first;

  document.getElementById("welcome").style.display   = "none";
  document.getElementById("dashboard").style.display = "block";

  // No modo demo, garante que o avatar começa pelas iniciais (sem foto do Google)
  if (isDemoMode) {
    const ap = document.getElementById("avatar-preview");
    const ai = document.getElementById("avatar-initials");
    if (ap)  { ap.src = ""; ap.style.display = "none"; }
    if (ai)  { ai.style.display = "block"; }
  }

  // Carrega dados salvos (kanban, agenda, avatar image, cargo)
  carregarDados(first);

  // Sobrescreve o nome com o que veio do Google/login (tem precedência sobre localStorage)
  document.getElementById("avatar-name").textContent      = first;
  document.getElementById("username-display").textContent = first;
  document.getElementById("avatar-initials").textContent  = initials;
  localStorage.setItem(storageKey("avatarName"), first);

  // Se não há profissão salva para este modo, limpa o campo para não mostrar dado do outro modo
  const roleKey = storageKey("avatarRole");
  if (!localStorage.getItem(roleKey)) {
    document.getElementById("avatar-role").textContent = "Artista & Músico";
  }

  // Recupera minutos de estudo salvos (Pomodoro acumulado) — sempre zera antes de carregar
  totalStudyMinutes = 0;
  document.getElementById("metric-study").textContent = "0min";
  const savedStudy = parseInt(localStorage.getItem(storageKey("studyMinutes")) || "0");
  if (savedStudy > 0) {
    totalStudyMinutes = savedStudy;
    const h = Math.floor(totalStudyMinutes / 60);
    const m = totalStudyMinutes % 60;
    document.getElementById("metric-study").textContent =
      h > 0 ? (m > 0 ? `${h}h${m}m` : `${h}h`) : `${m}min`;
  }

  renderKanban();
  renderAgenda();
  updateClock();
  rotateInspiration();
  fetchTechNews();
}

/* ============================================================
   BOTÃO SAIR — volta para a tela de boas-vindas
   ============================================================ */
document.getElementById("btn-logout").addEventListener("click", () => {
  const confirmSair = confirm("Tem certeza que deseja sair?");
  if (!confirmSair) return;

  // Salva tudo antes de sair — usa ainda o prefixo correto do modo atual
  salvarDados();
  // Persiste minutos de estudo do Pomodoro com o prefixo correto
  localStorage.setItem(storageKey("studyMinutes"), totalStudyMinutes);

  // Reseta estado DEPOIS de salvar
  isGoogleAuth = false;
  isDemoMode   = false;

  // Destroi gráfico se existir
  if (typeof emailChartInstance !== "undefined" && emailChartInstance) {
    emailChartInstance.destroy();
    emailChartInstance = null;
  }

  // Reseta pomodoro
  clearInterval(pomoTimerId);
  pomoTimerId = null;
  pomoTimeLeft = 25 * 60;

  // Reseta variáveis de estado em memória para a próxima sessão não herdar dados
  kanbanTasks       = [];
  agendaItems       = [];
  totalStudyMinutes = 0;

  // Limpa o avatar do DOM para não vazar foto do Google para o modo demo
  const avatarPreviewEl  = document.getElementById("avatar-preview");
  const avatarInitialsEl = document.getElementById("avatar-initials");
  if (avatarPreviewEl)  { avatarPreviewEl.src = ""; avatarPreviewEl.style.display = "none"; }
  if (avatarInitialsEl) { avatarInitialsEl.style.display = "block"; avatarInitialsEl.textContent = "--"; }

  // Esconde dashboard, mostra welcome
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("welcome").style.display = "flex";

  // Foco de volta no botão de login (acessibilidade)
  document.getElementById("btn-google-login").focus();

  // Limpa status
  document.getElementById("auth-status").textContent = "";
});

const dateEl = document.getElementById("today-date");
const now = new Date();
dateEl.textContent = now.toLocaleDateString("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/* ============================================================
   RELÓGIO DINÂMICO INTERNACIONAL
   ============================================================ */
const globalTimeEl = document.getElementById("global-time");
const timezoneSelector = document.getElementById("timezone-selector");

function updateClock() {
  const selectedZone = timezoneSelector.value;
  const timeOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit" };
  if (selectedZone !== "local") timeOptions.timeZone = selectedZone;
  globalTimeEl.textContent = new Date().toLocaleTimeString(
    "pt-BR",
    timeOptions,
  );
}
setInterval(updateClock, 1000);
timezoneSelector.addEventListener("change", updateClock);

/* ============================================================
   EDITAR CARGO / PROFISSÃO
   ============================================================ */
document.getElementById("btn-edit-role").addEventListener("click", () => {
  const current = document.getElementById("avatar-role").textContent;
  const newRole = prompt("Altere sua profissão/classe:", current);
  if (newRole && newRole.trim() !== "") {
    document.getElementById("avatar-role").textContent = newRole;
    salvarDados();
  }
});

document.getElementById("btn-edit-name").addEventListener("click", () => {
  const current = document.getElementById("avatar-name").textContent;
  const newName = prompt("Altere seu nome:", current);
  if (newName && newName.trim() !== "") {
    const formatted = newName.trim().charAt(0).toUpperCase() + newName.trim().slice(1);
    document.getElementById("avatar-name").textContent = formatted;
    document.getElementById("username-display").textContent = formatted;
    document.getElementById("avatar-initials").textContent = formatted.slice(0, 2).toUpperCase();
    salvarDados();
  }
});

/* ============================================================
   GMAIL API — buscar não-lidos
   ============================================================ */
async function fetchGmailUnread() {
  try {
    const emailEl = document.getElementById("metric-emails");
    emailEl.textContent = "...";
    const res = await gapi.client.gmail.users.messages.list({
      userId: "me",
      q: "is:unread",
      maxResults: 50,
    });
    const count = res.result.resultSizeEstimate || 0;
    emailEl.textContent = count;
    buildChartFromGmail(count);
  } catch (e) {
    document.getElementById("metric-emails").textContent = "--";
    buildChartMock();
  }
}

// Atualiza e-mails ao clicar no card de métricas (modo Google)
document.addEventListener("DOMContentLoaded", () => {
  const emailCard = document.getElementById("metric-emails");
  if (emailCard) {
    emailCard.style.cursor = "pointer";
    emailCard.title = "Clique para atualizar";
    emailCard.addEventListener("click", () => {
      if (isGoogleAuth) fetchGmailUnread();
    });
  }
});

/* ============================================================
   GOOGLE CALENDAR API — buscar eventos do mês atual
   ============================================================ */
async function fetchCalendarEvents() {
  try {
    const hoje = new Date();
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    inicioMes.setHours(0, 0, 0, 0);
    const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
    fimMes.setHours(23, 59, 59, 999);

    const res = await gapi.client.calendar.events.list({
      calendarId: "primary",
      timeMin: inicioMes.toISOString(),
      timeMax: fimMes.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    });

    const events = res.result.items || [];
    if (events.length > 0) {
      agendaItems = events.map((ev) => {
        const start = ev.start.dateTime
          ? new Date(ev.start.dateTime)
          : new Date(ev.start.date);
        const time = ev.start.dateTime
          ? start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
          : "D/T";
        const date = start.toLocaleDateString("pt-BR");
        const dateISO = start.toISOString().split("T")[0]; // para ordenar

        let type = "type-foco";
        const summary = (ev.summary || "").toLowerCase();
        if (summary.includes("reunião") || summary.includes("reuniao") || summary.includes("meeting") || summary.includes("compromisso"))
          type = "type-reuniao";
        else if (summary.includes("arte") || summary.includes("desenho") || summary.includes("pintura") || summary.includes("estudo"))
          type = "type-estudo";

        return {
          id: ev.id,
          time,
          date,
          dateISO,
          title: ev.summary || "Sem título",
          type,
          badge: { "type-foco": "Violão", "type-estudo": "Arte", "type-reuniao": "Compromisso" }[type],
          duration: "",
          obs: ev.description || "",
          gcalId: ev.id,
        };
      });

      // Ordena por data e horário
      agendaItems.sort((a, b) => {
        if (a.dateISO !== b.dateISO) return a.dateISO.localeCompare(b.dateISO);
        return a.time.localeCompare(b.time);
      });

      renderAgenda();
      salvarDados();
    }
  } catch (e) {
    console.warn("Calendar API não disponível:", e);
  }
}
/* ============================================================
   CRIAR EVENTO NO GOOGLE CALENDAR
   ============================================================ */
async function createCalendarEvent(item) {
  if (!isGoogleAuth) return null;
  try {
    const [hours, minutes] = item.time.split(":").map(Number);
    // Prefer dateISO (YYYY-MM-DD), fallback to item.date
    const isoDate = item.dateISO || item.date;
    const dateParts = isoDate ? isoDate.split("-") : null;

    const startDate = dateParts && dateParts.length === 3
      ? new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]), hours, minutes)
      : new Date();

    if (!dateParts) {
      startDate.setHours(hours, minutes, 0, 0);
    }

    // Parse duração (ex: "1h 30min" → 90 minutos)
    let durationMinutes = 60;
    if (item.duration) {
      const hMatch = item.duration.match(/(\d+)\s*h/i);
      const mMatch = item.duration.match(/(\d+)\s*min/i);
      durationMinutes =
        (hMatch ? parseInt(hMatch[1]) * 60 : 0) +
        (mMatch ? parseInt(mMatch[1]) : 0);
      if (durationMinutes === 0) durationMinutes = 60;
    }

    const endDate = new Date(startDate.getTime() + durationMinutes * 60000);

    const event = {
      summary: item.title,
      description: item.obs || "",
      start: { dateTime: startDate.toISOString() },
      end: { dateTime: endDate.toISOString() },
    };

    const res = await gapi.client.calendar.events.insert({
      calendarId: "primary",
      resource: event,
    });
    return res.result.id;
  } catch (e) {
    console.warn("Erro ao criar evento no Calendar:", e);
    return null;
  }
}

/* ============================================================
   WIDGET: POMODORO TIMER
   ============================================================ */
let pomoTimeLeft = 25 * 60;
let pomoTimerId = null;

const pomoDisplay = document.getElementById("pomo-display");
const pomoStartBtn = document.getElementById("pomo-start");
const pomoResetBtn = document.getElementById("pomo-reset");

function updatePomoDisplay() {
  const m = Math.floor(pomoTimeLeft / 60);
  const s = pomoTimeLeft % 60;
  pomoDisplay.textContent = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

pomoStartBtn.addEventListener("click", () => {
  if (pomoTimerId === null) {
    pomoStartBtn.textContent = "PAUSE";
    pomoTimerId = setInterval(() => {
      if (pomoTimeLeft > 0) {
        pomoTimeLeft--;
        updatePomoDisplay();
        // Atualiza métrica a cada minuto completo gasto
        if (pomoTimeLeft % 60 === 0 && pomoTimeLeft < 25 * 60) {
          updateStudyMetric(1);
          localStorage.setItem(storageKey("studyMinutes"), totalStudyMinutes);
        }
      } else {
        clearInterval(pomoTimerId);
        pomoTimerId = null;
        alert("Pomodoro finalizado! Hora de uma pausa, guaxinin. 🦝☕");
        pomoTimeLeft = 25 * 60;
        pomoStartBtn.textContent = "START";
        updatePomoDisplay();
        localStorage.setItem(storageKey("studyMinutes"), totalStudyMinutes);
      }
    }, 1000);
  } else {
    clearInterval(pomoTimerId);
    pomoTimerId = null;
    pomoStartBtn.textContent = "START";
  }
});

pomoResetBtn.addEventListener("click", () => {
  clearInterval(pomoTimerId);
  pomoTimerId = null;
  pomoTimeLeft = 25 * 60;
  pomoStartBtn.textContent = "START";
  updatePomoDisplay();
});

document.getElementById("pomo-zero-day").addEventListener("click", () => {
  if (confirm("Zerar as horas de estudo do dia?")) {
    totalStudyMinutes = 0;
    localStorage.setItem(storageKey("studyMinutes"), 0);
    document.getElementById("metric-study").textContent = "0h";
  }
});

let totalStudyMinutes = 0;
function updateStudyMetric(minutes) {
  totalStudyMinutes += minutes;
  const h = Math.floor(totalStudyMinutes / 60);
  const m = totalStudyMinutes % 60;
  document.getElementById("metric-study").textContent =
    h > 0 ? (m > 0 ? `${h}h${m}m` : `${h}h`) : `${m}min`;
}

/* ============================================================
   WIDGET: KANBAN — CHECKLIST COM EDIÇÃO
   ============================================================ */
let kanbanTasks = []; // sempre começa vazio; carregarDados() popula se houver dados salvos

let kanbanEditingId = null;

const kanbanListEl = document.getElementById("kanban-task-list");
const kanbanInput = document.getElementById("kanban-input");
const kanbanAddBtn = document.getElementById("kanban-add-btn");
const kanbanModal = document.getElementById("kanban-modal");
const kanbanEditIn = document.getElementById("kanban-edit-input");
const kanbanSaveBtn = document.getElementById("kanban-save-btn");
const kanbanCancelB = document.getElementById("kanban-cancel-btn");

function renderKanban() {
  kanbanListEl.innerHTML = "";
  let doneCount = 0;

  kanbanTasks.forEach((task) => {
    if (task.checked) doneCount++;

    const item = document.createElement("div");
    item.className = "kanban-item";
    item.setAttribute("role", "listitem");

    // Checkbox
    const checkbox = document.createElement("div");
    checkbox.className = `kanban-checkbox ${task.checked ? "checked" : ""}`;
    checkbox.title = task.checked ? "Desmarcar" : "Marcar como feito";
    checkbox.setAttribute("role", "checkbox");
    checkbox.setAttribute("aria-checked", task.checked ? "true" : "false");
    checkbox.setAttribute("tabindex", "0");
    checkbox.setAttribute(
      "aria-label",
      `Tarefa: ${task.text}. ${task.checked ? "Concluída" : "Pendente"}`,
    );
    checkbox.addEventListener("click", () => {
      task.checked = !task.checked;
      renderKanban();
      salvarDados();
    });
    checkbox.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        task.checked = !task.checked;
        renderKanban();
        salvarDados();
      }
    });

    // Texto
    const textSpan = document.createElement("span");
    textSpan.className = `kanban-text ${task.checked ? "done" : ""}`;
    textSpan.textContent = task.text;

    // Ações
    const actions = document.createElement("div");
    actions.className = "kanban-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "kanban-action-btn";
    editBtn.title = "Editar";
    editBtn.setAttribute("aria-label", `Editar tarefa: ${task.text}`);
    editBtn.textContent = "✏️";
    editBtn.addEventListener("click", () => openKanbanEdit(task.id));

    const delBtn = document.createElement("button");
    delBtn.className = "kanban-action-btn delete";
    delBtn.title = "Excluir";
    delBtn.setAttribute("aria-label", `Excluir tarefa: ${task.text}`);
    delBtn.textContent = "🗑";
    delBtn.addEventListener("click", () => {
      kanbanTasks = kanbanTasks.filter((t) => t.id !== task.id);

      renderKanban();
      salvarDados();
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    item.appendChild(checkbox);
    item.appendChild(textSpan);
    item.appendChild(actions);
    kanbanListEl.appendChild(item);
  });

  // Atualiza métrica "Tarefas Feitas"
  document.getElementById("metric-tasks").textContent =
    `${doneCount}/${kanbanTasks.length}`;
}

// Abrir modal de edição do kanban
function openKanbanEdit(id) {
  kanbanEditingId = id;
  const task = kanbanTasks.find((t) => t.id === id);
  if (task) {
    kanbanEditIn.value = task.text;
    kanbanModal.style.display = "flex";
    kanbanEditIn.focus();
  }
}

kanbanSaveBtn.addEventListener("click", () => {
  const newText = kanbanEditIn.value.trim();
  if (newText !== "") {
    const task = kanbanTasks.find((t) => t.id === kanbanEditingId);
    if (task) task.text = newText;
    renderKanban();
    salvarDados();
  }
  kanbanModal.style.display = "none";
  kanbanEditingId = null;
  kanbanInput.focus();
});

kanbanCancelB.addEventListener("click", () => {
  kanbanModal.style.display = "none";
  kanbanEditingId = null;
  kanbanInput.focus();
});

// Enter no input do kanban
kanbanEditIn.addEventListener("keydown", (e) => {
  if (e.key === "Enter") kanbanSaveBtn.click();
  if (e.key === "Escape") kanbanCancelB.click();
});

// Adicionar nova tarefa
kanbanAddBtn.addEventListener("click", () => {
  const text = kanbanInput.value.trim();
  if (text !== "") {
    kanbanTasks.push({ id: Date.now(), text, checked: false });
    kanbanInput.value = "";
    renderKanban();
    salvarDados();
  }
});

kanbanInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") kanbanAddBtn.click();
});

/* ============================================================
   WIDGET: AGENDA — CRIAR / EDITAR / EXCLUIR
   ============================================================ */
let agendaItems = []; // sempre começa vazio; carregarDados() ou fetchCalendarEvents() popula

function getTodayISO() {
  return new Date().toISOString().split("T")[0];
}

const agendaContainer = document.getElementById("agenda-container");
const editModal = document.getElementById("edit-modal");
const editTitleInput = document.getElementById("edit-title");
const editTimeInput = document.getElementById("edit-time");
const editDateInput = document.getElementById("edit-date");
const editDurationInput = document.getElementById("edit-duration");
const editTypeSelect = document.getElementById("edit-type");
const editObsInput = document.getElementById("edit-obs");
const syncGcal = document.getElementById("sync-gcal");
const modalSyncStatus = document.getElementById("modal-sync-status");

let editingAgendaId = null;
let modoModal = "create";

const badgeMap = {
  "type-foco": "Violão",
  "type-estudo": "Arte",
  "type-reuniao": "Compromisso",
};

function renderAgenda() {
  agendaContainer.innerHTML = "";

  const sorted = [...agendaItems].sort((a, b) => {
    const dateA = a.dateISO || (a.date && a.date.includes("/")
      ? a.date.split("/").reverse().join("-") : a.date) || "";
    const dateB = b.dateISO || (b.date && b.date.includes("/")
      ? b.date.split("/").reverse().join("-") : b.date) || "";
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return a.time.localeCompare(b.time);
  });

  if (sorted.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText =
      "font-size:0.55rem; color:var(--text-soft); text-align:center; padding:1rem;";
    empty.textContent = "Nenhum item na agenda. Clique em + NOVO para adicionar! 🦝";
    agendaContainer.appendChild(empty);
    return;
  }

  sorted.forEach((item) => {
    const div = document.createElement("div");
    div.className = `agenda-item ${item.type}`;

    // Formata data para exibição
let dateDisplay = "";
if (item.dateISO) {
  const d = new Date(item.dateISO + "T00:00:00");
  dateDisplay = d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
} else if (item.date) {
  // fallback para itens criados manualmente
  const parts = item.date.split("/");
  if (parts.length === 3) {
    const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T00:00:00`);
    dateDisplay = d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
    });
  }
}

    // Duração com ícone de relógio
    const durationText = item.duration ? `⏱ ${item.duration}` : "";

    // Observação
    const obsHtml = item.obs
      ? `<div class="agenda-obs">💬 ${item.obs}</div>`
      : "";

    div.innerHTML = `
            <span class="agenda-time">${item.time}</span>
            <div class="agenda-center">
                <div class="agenda-icon-title">
                    <span class="agenda-dot"></span>
                    <span class="agenda-title">${item.title}</span>
                </div>
                ${dateDisplay ? `<div class="agenda-date-tag">📅 ${dateDisplay}</div>` : ""}
                ${durationText ? `<span class="agenda-duration">${durationText}</span>` : ""}
                ${obsHtml}
            </div>
            <div class="agenda-actions">
                <span class="agenda-badge">${item.badge}</span>
                <div style="display:flex; gap:3px; margin-top:4px;">
                    <button class="btn-enter btn-small edit-btn-trigger" data-id="${item.id}"
                        style="font-size:6px; padding:2px 5px;">✏️</button>
                    <button class="btn-enter btn-small delete-btn-trigger" data-id="${item.id}"
                        style="font-size:6px; padding:2px 5px; background:var(--pink-mid); color:var(--text);">🗑</button>
                </div>
            </div>
        `;

    agendaContainer.appendChild(div);
  });

  // Eventos de editar
  document.querySelectorAll(".edit-btn-trigger").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = Number(e.currentTarget.getAttribute("data-id"));
      const item = agendaItems.find((i) => i.id === id);
      if (item) openAgendaModal("edit", item);
    });
  });

 // Eventos de excluir
  document.querySelectorAll(".delete-btn-trigger").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const idRaw = e.currentTarget.getAttribute("data-id");
      const id = isNaN(Number(idRaw)) ? idRaw : Number(idRaw);
      if (confirm("Excluir esta atividade?")) {
        const item = agendaItems.find((i) => String(i.id) === String(id));
        // Deleta no Google Calendar se o item veio de lá
        if (isGoogleAuth && item && item.gcalId) {
          try {
            await gapi.client.calendar.events.delete({
              calendarId: "primary",
              eventId: item.gcalId,
            });
          } catch (e) {
            console.warn("Erro ao deletar evento no Calendar:", e);
          }
        }
        agendaItems = agendaItems.filter((i) => i.id !== id);
        renderAgenda();
        salvarDados();
      }
    });
  });
}

/* Abrir modal da agenda */
function openAgendaModal(modo, item = null) {
  modoModal = modo;
  modalSyncStatus.textContent = "";
  syncGcal.checked = isGoogleAuth;

  if (modo === "edit" && item) {
    editingAgendaId = item.id;
    document.getElementById("modal-title").textContent = "// Editar Atividade";
    editTitleInput.value = item.title;
    editTimeInput.value = item.time;
    editDateInput.value = item.dateISO || item.date || getTodayISO();
    editDurationInput.value = item.duration || "";
    editTypeSelect.value = item.type;
    editObsInput.value = item.obs || "";
  } else {
    editingAgendaId = null;
    document.getElementById("modal-title").textContent = "// Nova Atividade";
    editTitleInput.value = "";
    editTimeInput.value = "12:00";
    editDateInput.value = getTodayISO();
    editDurationInput.value = "";
    editTypeSelect.value = "type-foco";
    editObsInput.value = "";
  }

  editModal.style.display = "flex";
  setTimeout(() => editTitleInput.focus(), 50);
}

/* Fechar modal com Escape */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (editModal.style.display === "flex") {
      editModal.style.display = "none";
      document.getElementById("agenda-add-trigger").focus();
    }
    if (kanbanModal.style.display === "flex") {
      kanbanModal.style.display = "none";
      kanbanInput.focus();
    }
  }
});

/* Trap de foco no modal da agenda */
editModal.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const focusable = editModal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

/* Trap de foco no modal do kanban */
kanbanModal.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const focusable = kanbanModal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

/* Botão + NOVO da agenda ← aqui estava o bug! */
document.getElementById("agenda-add-trigger").addEventListener("click", () => {
  openAgendaModal("create");
});

/* Fechar modal */
document.getElementById("edit-cancel-btn").addEventListener("click", () => {
  editModal.style.display = "none";
  document.getElementById("agenda-add-trigger").focus();
});

/* Clicar fora do modal fecha */
editModal.addEventListener("click", (e) => {
  if (e.target === editModal) editModal.style.display = "none";
});

/* Salvar agenda */
document.getElementById("edit-save-btn").addEventListener("click", async () => {
  const title = editTitleInput.value.trim() || "Nova Atividade";
  const time = editTimeInput.value || "12:00";
  const date = editDateInput.value || getTodayISO();
  const duration = editDurationInput.value.trim();
  const type = editTypeSelect.value;
  const obs = editObsInput.value.trim();
  const badge = badgeMap[type];
  const doSync = syncGcal.checked && isGoogleAuth;

  if (modoModal === "edit") {
    const item = agendaItems.find((i) => i.id === editingAgendaId);
    if (item) {
      Object.assign(item, { title, time, date, dateISO: date, duration, type, badge, obs });
    }
  } else {
    const newItem = {
      id: Date.now(),
      time,
      date,
      dateISO: date, // input type="date" already returns YYYY-MM-DD
      title,
      type,
      badge,
      duration,
      obs,
    };
    agendaItems.push(newItem);

    // Sincronizar com Google Calendar
    if (doSync) {
      modalSyncStatus.textContent = "⏳ Sincronizando com Google Calendar...";
      const gcalId = await createCalendarEvent(newItem);
      if (gcalId) {
        newItem.gcalId = gcalId;
        modalSyncStatus.textContent = "✅ Evento criado no Google Calendar!";
        setTimeout(() => {
          editModal.style.display = "none";
        }, 1200);
        renderAgenda();
        salvarDados();
        return;
      } else {
        modalSyncStatus.textContent =
          "⚠️ Salvo localmente (sem acesso ao Calendar).";
      }
    }
  }

  editModal.style.display = "none";
  renderAgenda();
  salvarDados();
});

/* Enter no título abre próximo campo */
editTitleInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") editTimeInput.focus();
});

/* ============================================================
   GRÁFICO: EMAILS (mock ou real)
   ============================================================ */
let emailChartInstance = null;

function buildChartFromGmail(todayCount) {
  // Com dados reais só temos hoje; os outros dias são estimados
  const emailData = [12, 5, 8, 20, 3, 15, todayCount];
  buildChart(emailData);
}

function buildChartMock(demoMode = false) {
  if (demoMode) {
    // Modo demo sem Google: gráfico zerado, sem dados fictícios de email
    const emailData = [0, 0, 0, 0, 0, 0, 0];
    document.getElementById("metric-emails").textContent = "--";
    buildChart(emailData, true);
    return;
  }
  const emailData = [12, 5, 8, 20, 3, 15, 14];
  document.getElementById("metric-emails").textContent =
    emailData[emailData.length - 1];
  buildChart(emailData);
}

function buildChart(emailData, demoMode = false) {
  const today = emailData[emailData.length - 1];
  const avg = Math.round(
    emailData.reduce((a, b) => a + b, 0) / emailData.length,
  );
  const labels = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    labels.push(
      d.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric" }),
    );
  }

  const styles = getComputedStyle(document.documentElement);

  const primaryColor = styles.getPropertyValue("--green-dark").trim();
  const secondaryColor = styles.getPropertyValue("--green-mid").trim();
  const borderPrimary = styles.getPropertyValue("--text").trim();
  const borderSecondary = styles.getPropertyValue("--text-soft").trim();

  const barColors = emailData.map((_, i) =>
    i === emailData.length - 1 ? primaryColor : secondaryColor,
  );

  const borderColors = emailData.map((_, i) =>
    i === emailData.length - 1 ? borderPrimary : borderSecondary,
  );

  const badge = document.getElementById("insight-badge");
  const footer = document.getElementById("chart-footer");

  if (demoMode) {
    badge.textContent = "🎸 Sem dados";
    badge.className = "insight-badge";
    footer.textContent =
      "Registre suas práticas no Pomodoro para ver o gráfico da semana!";
  } else if (today >= avg) {
    badge.textContent = "🎵 Semana cheia";
    badge.className = "insight-badge busy";
    footer.textContent = `Hoje praticou ${today}min — acima da média de ${avg}min.`;
  } else {
    badge.textContent = "🦝 Tranquilo";
    badge.className = "insight-badge calm";
    footer.textContent = `Hoje praticou ${today}min — abaixo da média de ${avg}min.`;
  }

  const ctx = document.getElementById("emailChart").getContext("2d");

  // Destroi gráfico anterior se existir
  if (emailChartInstance) {
    emailChartInstance.destroy();
  }

  emailChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Emails",
          data: emailData,
          backgroundColor: barColors,
          borderColor: borderColors,
          borderWidth: 2,
          borderRadius: 0,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#6d597a", font: { size: 9 } },
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(43,30,58,0.05)" },
          ticks: { color: "#6d597a", font: { size: 9 }, stepSize: 5 },
        },
      },
    },
  });
}

/* ============================================================
   WIDGET: MOOD / SÍNDROME DO IMPOSTOR
   ============================================================ */
const compliments = [
  '"Sua criatividade é única! Continue criando, o mundo precisa da sua arte."',
  '"Cada acorde praticado é um passo mais perto do seu som perfeito. Vai lá! 🎸"',
  '"Artistas não têm dias ruins, têm dias de processo. Este é um deles!"',
  '"Seu traço tem personalidade. Não pare de criar."',
  '"O violão fica mais fácil a cada dia que você toca. Você está evoluindo!"',
  '"Criatividade é coragem. E você tem de sobra. 🦝"',
];

const moodMessages = [
  compliments, // 🎨
  [
    '"Pausa com café também é parte do processo criativo. ☕"',
    '"Respira. Às vezes descansar é a coisa mais produtiva."',
    '"O guaxinin descansa para vasculhar melhor depois. 🦝"',
  ],
  [
    '"Você está inspirado! É hora de criar algo incrível! ✨"',
    '"Essa energia criativa não se desperdiça. Vai para a tela ou para as cordas!"',
    '"Inspiração bateu? Registra antes que o guaxinin some com ela. 🦝"',
  ],
];

let activeMood = -1;

document.querySelectorAll(".mood-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mood = parseInt(btn.getAttribute("data-mood"));
    activeMood = mood;

    document.querySelectorAll(".mood-btn").forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-pressed", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-pressed", "true");

    const pool = moodMessages[mood];
    const msg = pool[Math.floor(Math.random() * pool.length)];
    document.getElementById("compliment-text").textContent = msg;
  });
});

/* ============================================================
   TECH INSPIRATIONS — rotação automática (mulheres + ícones tech)
   ============================================================ */
const inspirations = [
  // Artistas Visuais
  { name: "Frida Kahlo", role: "Pintora surrealista mexicana", quote: '"Pinto flores para que não morram."' },
  { name: "Picasso", role: "Fundador do cubismo", quote: '"A inspiração existe, mas ela te encontra trabalhando."' },
  { name: "Van Gogh", role: "Pós-impressionista holandês", quote: '"Grandes coisas não são feitas por impulso, mas por uma série de pequenas coisas reunidas."' },
  { name: "Banksy", role: "Artista urbano anônimo", quote: '"A arte deve confortar os perturbados e perturbar os confortáveis."' },
  { name: "Salvador Dalí", role: "Mestre do surrealismo", quote: '"Não tenha medo da perfeição, você nunca a alcançará."' },
  { name: "Tarsila do Amaral", role: "Modernismo brasileiro", quote: '"Arte é a expressão mais alta da civilização."' },
  { name: "Mondrian", role: "Fundador do neoplasticismo", quote: '"A arte é mais elevada que a realidade."' },
  { name: "Basquiat", role: "Pioneiro da street art", quote: '"Eu não penso sobre arte quando trabalho. Tento pensar sobre a vida."' },
  { name: "Cândido Portinari", role: "Pintor do povo brasileiro", quote: '"Pintar é amar novamente."' },
  { name: "Leonarda da Vinci", role: "Artista e inventor renascentista", quote: '"A simplicidade é o máximo da sofisticação."' },
  // Músicos e Compositores
  { name: "Heitor Villa-Lobos", role: "Maior compositor brasileiro", quote: '"A música é a linguagem das emoções."' },
  { name: "Baden Powell", role: "Violonista brasileiro", quote: '"O violão é a alma da música brasileira."' },
  { name: "João Gilberto", role: "Pai da bossa nova", quote: '"A música é o silêncio entre as notas."' },
  { name: "Beethoven", role: "Compositor clássico alemão", quote: '"A música é uma revelação mais elevada que toda a sabedoria e filosofia."' },
  { name: "Miles Davis", role: "Ícone do jazz", quote: '"Tempo não é sua inimiga. O silêncio também é música."' },
  { name: "Caetano Veloso", role: "Tropicalismo brasileiro", quote: '"A música não explica, a música revela."' },
  { name: "Chico Buarque", role: "Poeta e compositor", quote: '"A canção é a coisa mais curta que existe."' },
  { name: "Hermeto Pascoal", role: "Gênio da música experimental", quote: '"Tudo que vibra pode ser música."' },
  { name: "Paco de Lucía", role: "Mestre do flamenco", quote: '"O violão é um instrumento que nunca termina de ser aprendido."' },
  { name: "Bob Dylan", role: "Poeta do rock", quote: '"Não seja preso pelo passado; ele é apenas um reflexo do que foi."' },
];


let inspirationIndex = Math.floor(Math.random() * inspirations.length);

function rotateInspiration() {
  // Card 1
  const item1 = inspirations[inspirationIndex % inspirations.length];
  document.getElementById("inspiration-name").textContent  = item1.name;
  document.getElementById("inspiration-role").textContent  = item1.role;
  document.getElementById("inspiration-quote").textContent = item1.quote;
  // Card 2 — próximo da lista
  const item2 = inspirations[(inspirationIndex + 1) % inspirations.length];
  document.getElementById("inspiration-name2").textContent  = item2.name;
  document.getElementById("inspiration-role2").textContent  = item2.role;
  document.getElementById("inspiration-quote2").textContent = item2.quote;
}

function nextInspiration() {
  inspirationIndex = (inspirationIndex + 2) % inspirations.length;
  rotateInspiration();
}

document.addEventListener("DOMContentLoaded", () => {
  const nextBtn = document.getElementById("inspiration-next-btn");
  if (nextBtn) nextBtn.addEventListener("click", nextInspiration);
});

/* ============================================================
   ASSUNTOS DA SEMANA — notícias de tech via Anthropic API
   lista com scroll vertical e fonte clicável
   ============================================================ */
let newsTickerInterval = null;

function startNewsTicker(newsItems) {
  const container = document.getElementById("news-container");
  if (!container || newsItems.length === 0) return;

  if (newsTickerInterval) { clearInterval(newsTickerInterval); newsTickerInterval = null; }

  container.innerHTML = newsItems.map((item, idx) => `
    <div class="news-ticker-item" style="margin-bottom: 12px; padding-bottom: 12px; ${idx < newsItems.length - 1 ? 'border-bottom: 2px dashed var(--text-soft);' : ''}">
      <div class="news-ticker-header">
        <span class="brag-date">${item.emoji} ${item.titulo}</span>
        <span class="news-counter">${idx + 1}/${newsItems.length}</span>
      </div>
      <p class="brag-text" style="margin-top:6px; font-size:8px; line-height:1.7;">${item.resumo}</p>
      <div class="news-fonte">
        📰 ${item.url
          ? `<a href="${item.url}" target="_blank" rel="noopener" style="color:var(--green-dark); text-decoration:underline; font-family:'Press Start 2P',monospace; font-size:7px;">${item.fonte}</a>`
          : item.fonte}
      </div>
    </div>
  `).join("");
}

async function fetchTechNews() {
  const container = document.getElementById("news-container");
  if (!container) return;

  if (newsTickerInterval) { clearInterval(newsTickerInterval); newsTickerInterval = null; }

  container.innerHTML = `
    <div class="brag-entry" style="text-align:center; padding:8px 0;">
      <span class="brag-date" style="font-size:9px;">⏳ Buscando notícias...</span>
    </div>`;

  try {
    const today = new Date().toLocaleDateString("pt-BR", {
      day: "numeric", month: "long", year: "numeric"
    });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{
          role: "user",
          content: `Hoje é ${today}. Busque as 6 principais notícias do mundo das artes e da música desta semana (exposições, lançamentos de álbuns, festivais, artistas em destaque, curiosidades sobre arte, música brasileira, violão). Responda SOMENTE em JSON válido, sem markdown, neste formato exato:\n[\n  {"titulo": "...", "resumo": "...", "emoji": "🎨", "fonte": "Nome do veículo", "url": "https://link-da-noticia.com"},\n  ...\n]\nResumo máximo 100 caracteres. Use emojis temáticos (🎸🎨🖼️🎵🦝✨). Inclua o URL real da notícia no campo url.`
        }]
      })
    });

    const data = await response.json();
    const fullText = (data.content || [])
      .map(item => item.type === "text" ? item.text : "")
      .filter(Boolean)
      .join("\n");

    const clean = fullText.replace(/```json|```/g, "").trim();
    const jsonMatch = clean.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("JSON não encontrado");

    const news = JSON.parse(jsonMatch[0]);
    startNewsTicker(news);

  } catch (err) {
    console.warn("Erro ao buscar notícias tech:", err);
    const fallback = [
      { emoji: "🎸", titulo: "Violão em alta", resumo: "Festivais de violão clássico e popular aquecen a cena musical em 2025.", fonte: "Música & Cia", url: "https://cifraclub.com.br" },
      { emoji: "🖼️", titulo: "Arte contemporânea", resumo: "Galerias internacionais debatem o futuro da arte digital e física.", fonte: "Artsy", url: "https://artsy.net" },
      { emoji: "🎵", titulo: "Bossa Nova 66 anos", resumo: "Brasil celebra décadas de um dos ritmos mais influentes do mundo.", fonte: "Folha de SP", url: "https://folha.uol.com.br" },
      { emoji: "🎨", titulo: "Tendências visuais", resumo: "O expressionismo abstrato volta a ganhar espaço em exposições globais.", fonte: "Behance Blog", url: "https://behance.net" },
      { emoji: "🎸", titulo: "Novos violonistas", resumo: "Jovens artistas brasileiros conquistam palcos internacionais com o violão.", fonte: "G1 Música", url: "https://g1.globo.com/musica" },
      { emoji: "✨", titulo: "Arte e tecnologia", resumo: "IA como ferramenta criativa: como artistas estão explorando novas fronteiras.", fonte: "Arte & Cultura", url: "https://hypeness.com.br" },
    ];
    startNewsTicker(fallback);
  }
}

/* ============================================================
   DEV TIP DO DIA — dicas técnicas via Anthropic API
   ============================================================ */
const devTipsLocal = [
  { categoria: "Violão", tip: "Pratique os acordes difíceis lentamente antes de aumentar a velocidade. A memória muscular é construída com precisão." },
  { categoria: "Arte", tip: "Desenhe com a mão não-dominante de vez em quando — libera bloqueios criativos e estimula novas conexões." },
  { categoria: "Violão", tip: "O dedilhado fingerstyle começa sempre com polegar no baixo (E, A, D) e dedos (i, m, a) nas cordas agudas." },
  { categoria: "Criatividade", tip: "Crie um caderno de esboços sem compromisso. Não julgue o que sai — só deixe a mão se mover." },
  { categoria: "Teoria", tip: "Aprender a cifra Am, C, G e F abre centenas de músicas. Comece com essas quatro e você terá um repertório enorme." },
  { categoria: "Arte", tip: "Estude obras dos artistas que admira: tente copiar o estilo deles para entender como pensam." },
  { categoria: "Violão", tip: "Treinar 20 minutos por dia é mais eficaz que treinar 2 horas de vez em quando. Consistência vence intensidade." },
  { categoria: "Composição", tip: "Quando tiver um riff interessante, grave imediatamente no celular. Boas ideias desaparecem rápido." },
  { categoria: "Arte", tip: "A regra dos terços funciona em pintura, fotografia e design. Divide a cena em 9 partes iguais e posicione os elementos nos cruzamentos." },
  { categoria: "Guaxinin", tip: "Guaxinins são curiosos, persistentes e adaptáveis. Você também é! Continue explorando. 🦝" },
];

let devTipIndex = Math.floor(Math.random() * devTipsLocal.length);

function showDevTip(tip) {
  const container = document.getElementById("devtip-container");
  if (!container) return;
  container.innerHTML = `
    <div style="background: var(--orange); border: 2px dashed var(--orange-dark); padding: 10px;">
      <div style="font-size: 8px; color: var(--orange-dark); margin-bottom: 6px; font-family:'Press Start 2P',monospace;">[ ${tip.categoria} ]</div>
      <p style="font-size: 9px; line-height: 1.8; margin: 0; font-family:'Press Start 2P',monospace;">${tip.tip}</p>
    </div>`;
}

function nextDevTip() {
  devTipIndex = (devTipIndex + 1) % devTipsLocal.length;
  showDevTip(devTipsLocal[devTipIndex]);
}

document.addEventListener("DOMContentLoaded", () => {
  const tipBtn = document.getElementById("devtip-next-btn");
  if (tipBtn) tipBtn.addEventListener("click", nextDevTip);
  showDevTip(devTipsLocal[devTipIndex]);
});


const avatarInput = document.getElementById("avatar-input");
const avatarPreview = document.getElementById("avatar-preview");
const avatarInitials = document.getElementById("avatar-initials");

avatarInput.addEventListener("change", function () {
  const file = this.files[0];

  if (file) {
    const reader = new FileReader();

    reader.onload = function (e) {
      avatarPreview.src = e.target.result;
      avatarPreview.style.display = "block";

      avatarInitials.style.display = "none";
      salvarDados();
    };

    reader.readAsDataURL(file);
  }
});

// Troca a cada 60 segundos
setInterval(rotateInspiration, 60000);

/* ============================================================
   PERSISTÊNCIA AUTOMÁTICA
   Salva ao fechar/recarregar e a cada 30 segundos.
   storageKey() garante que demo e Google usam chaves separadas.
   ============================================================ */
window.addEventListener("beforeunload", () => salvarDados());
setInterval(() => salvarDados(), 30_000);

/* ============================================================
   BOTÃO "LIMPAR DEMO" — aparece na welcome se há sessão demo
   ============================================================ */
(function iniciarBotaoLimparDemo() {
  const btn = document.getElementById("btn-clear-demo");
  if (!btn) return;

  function atualizarBotaoLimpar() {
    const temSessao = localStorage.getItem("guaxinin_avatarName");
    btn.style.display = temSessao ? "block" : "none";
    if (temSessao) {
      btn.textContent = "🗑️ Limpar sessão demo (" + temSessao + ")";
    }
  }

  atualizarBotaoLimpar();

  btn.addEventListener("click", () => {
    if (!confirm("Apagar todos os dados da sessão demo?")) return;
    ["kanbanTasks", "agendaItems", "avatarRole", "avatarName", "avatarImage", "studyMinutes"].forEach(
      (k) => localStorage.removeItem("guaxinin_" + k)
    );
    atualizarBotaoLimpar();
  });
})();