// 複数ユーザー対応の読書ログアプリ（IndexedDB + localStorage）

interface User {
  id: number;
  name: string;
  createdAt: string;
}

interface LogEntry {
  id?: number;
  progress: number;
  content: string;
  createdAt: string;
  userId: number;
}

const DB_NAME = "reading_pomodoro_db";
const LOG_STORE = "logs";
const USER_STORE = "users";
const DB_VERSION = 2;

const CURRENT_USER_KEY = "pomologCurrentUserId";
const SPOILER_MARGIN = 5; // ネタバレ余白(%)

let db: IDBDatabase | null = null;

// ユーザー名をキャッシュ（タイムライン描画用）
const userCache = new Map<number, string>();

// -------------------------------
// IndexedDB 周り
// -------------------------------
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      // logs ストアが無ければ作成
      if (!database.objectStoreNames.contains(LOG_STORE)) {
        database.createObjectStore(LOG_STORE, { keyPath: "id", autoIncrement: true });
      }
      // users ストアを追加
      if (!database.objectStoreNames.contains(USER_STORE)) {
        database.createObjectStore(USER_STORE, { keyPath: "id", autoIncrement: true });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

function getAllUsers(): Promise<User[]> {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error("DB not initialized"));
    const tx = db.transaction(USER_STORE, "readonly");
    const store = tx.objectStore(USER_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as User[]) || []);
    req.onerror = () => reject(req.error);
  });
}

function getUserById(id: number): Promise<User | null> {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error("DB not initialized"));
    const tx = db.transaction(USER_STORE, "readonly");
    const store = tx.objectStore(USER_STORE);
    const req = store.get(id);
    req.onsuccess = () => resolve((req.result as User) || null);
    req.onerror = () => reject(req.error);
  });
}

function createUser(name: string): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error("DB not initialized"));
    const tx = db.transaction(USER_STORE, "readwrite");
    const store = tx.objectStore(USER_STORE);
    const createdAt = new Date().toISOString();
    const req = store.add({ name, createdAt });
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

function setCurrentUser(id: number) {
  localStorage.setItem(CURRENT_USER_KEY, String(id));
}

async function getCurrentUser(): Promise<User | null> {
  const idStr = localStorage.getItem(CURRENT_USER_KEY);
  if (!idStr) return null;
  const id = Number(idStr);
  if (Number.isNaN(id)) return null;
  return await getUserById(id);
}

function getAllLogs(): Promise<LogEntry[]> {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error("DB not initialized"));
    const tx = db.transaction(LOG_STORE, "readonly");
    const store = tx.objectStore(LOG_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as LogEntry[]) || []);
    req.onerror = () => reject(req.error);
  });
}

function addLog(progress: number, content: string, userId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error("DB not initialized"));
    const tx = db.transaction(LOG_STORE, "readwrite");
    const store = tx.objectStore(LOG_STORE);
    const createdAt = new Date().toISOString();
    store.add({ progress, content, createdAt, userId });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getLatestProgressForUser(userId: number): Promise<number | null> {
  const logs = await getAllLogs();
  const target = logs
    .filter((l) => l.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  return target ? target.progress : null;
}

// 既存ログに userId が無い場合、指定ユーザーに紐づける簡易マイグレーション
async function migrateExistingLogs(defaultUserId: number) {
  if (!db) return;
  const logs = await getAllLogs();
  const needUpdate = logs.filter((l) => l.userId === undefined || l.userId === null);
  if (needUpdate.length === 0) return;

  const tx = db.transaction(LOG_STORE, "readwrite");
  const store = tx.objectStore(LOG_STORE);
  needUpdate.forEach((log) => {
    store.put({ ...log, userId: defaultUserId });
  });
}

// -------------------------------
// UI ヘルパー
// -------------------------------
function qs<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  return el as T;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderUserArea(currentUser: User | null, users: User[]) {
  const el = qs<HTMLSpanElement>("#current-user-name");
  el.textContent = currentUser ? currentUser.name : "-";
  // 一覧のためにキャッシュ
  users.forEach((u) => userCache.set(u.id, u.name));
}

function resolveUserName(userId: number): string {
  const name = userCache.get(userId);
  return name || "ユーザー";
}

// タイムライン描画
function renderTimeline(logs: LogEntry[], currentUser: User | null, currentProgress: number | null) {
  const container = qs<HTMLDivElement>("#timeline");
  container.innerHTML = "";

  if (!currentUser) {
    container.textContent = "ユーザーを選択してください。";
    return;
  }

  const allowedMax = Math.max((currentProgress ?? 0) - SPOILER_MARGIN, 0);

  const filtered = logs.filter((log) => {
    if (log.userId === currentUser.id) return true; // 自分のログは全表示
    if (currentProgress === null) return false; // 自分の進捗なしなら他人は表示しない
    return log.progress <= allowedMax;
  });

  filtered.sort((a, b) => {
    if (b.progress !== a.progress) return b.progress - a.progress;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.textContent =
      currentProgress === null
        ? "まだ投稿がありません。まずは自分の一件目を記録しましょう！"
        : "ネタバレを防ぐため、表示できる投稿がありません。";
    empty.style.color = "#6b665d";
    empty.style.fontSize = "0.95rem";
    container.appendChild(empty);
    return;
  }

  filtered.forEach((log) => {
    const card = document.createElement("article");
    card.className = "card";
    if (log.userId === currentUser.id) card.classList.add("mine");

    const top = document.createElement("div");
    top.className = "card-top";

    const prog = document.createElement("div");
    prog.className = "progress";
    prog.textContent = `${log.progress}%`;

    const time = document.createElement("div");
    time.className = "timestamp";
    time.textContent = formatDate(log.createdAt);

    top.appendChild(prog);
    top.appendChild(time);

    const userName = document.createElement("div");
    userName.className = "username";
    userName.textContent = resolveUserName(log.userId);

    const content = document.createElement("div");
    content.className = "content";
    content.textContent = log.content;

    card.appendChild(top);
    card.appendChild(userName);
    card.appendChild(content);

    container.appendChild(card);
  });
}

// 入力バリデーション
function validate(progressVal: number, contentVal: string): boolean {
  const errorEl = qs<HTMLDivElement>("#error");
  errorEl.textContent = "";
  if (contentVal.trim().length === 0) {
    errorEl.textContent = "感想を入力してください。";
    return false;
  }
  if (!Number.isInteger(progressVal) || progressVal < 0 || progressVal > 100) {
    errorEl.textContent = "進度は0〜100の整数で入力してください。";
    return false;
  }
  return true;
}

// モーダル表示/非表示
function showUserModal(force = false) {
  const modal = qs<HTMLDivElement>("#user-modal");
  modal.classList.add("show");
  if (force) modal.dataset.force = "true";
}

function hideUserModal(forceClose = false) {
  const modal = qs<HTMLDivElement>("#user-modal");
  if (modal.dataset.force === "true" && !forceClose) return; // 初回強制時は閉じさせない
  modal.classList.remove("show");
  modal.dataset.force = "";
}

// ユーザー一覧を再生成
async function rebuildUserList() {
  const list = qs<HTMLDivElement>("#user-list");
  list.innerHTML = "";
  const users = await getAllUsers();
  if (users.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "まだユーザーがいません。下のフォームから登録してください。";
    empty.className = "muted";
    list.appendChild(empty);
    return;
  }
  const current = await getCurrentUser();
  users.forEach((u) => {
    userCache.set(u.id, u.name);
    const item = document.createElement("div");
    item.className = "user-chip";
    const name = document.createElement("div");
    name.textContent = u.name;
    const meta = document.createElement("div");
    meta.className = "muted";
    meta.textContent = current && current.id === u.id ? "選択中" : "選択";
    item.appendChild(name);
    item.appendChild(meta);
    item.addEventListener("click", async () => {
      setCurrentUser(u.id);
      renderUserArea(u, users);
      await refreshTimeline();
      await updateProgressInput();
      hideUserModal();
    });
    list.appendChild(item);
  });
}

// ユーザー切り替え/新規のイベント設置
function setupUserModalHandlers() {
  const switchBtn = qs<HTMLButtonElement>("#switch-user-btn");
  const closeBtn = qs<HTMLButtonElement>("#close-modal");
  const newUserForm = qs<HTMLFormElement>("#new-user-form");

  switchBtn.addEventListener("click", async () => {
    await rebuildUserList();
    showUserModal();
  });

  closeBtn.addEventListener("click", () => hideUserModal());

  newUserForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = qs<HTMLInputElement>("#new-user-name");
    const name = input.value.trim();
    if (!name) return;
    try {
      const id = await createUser(name);
      userCache.set(id, name);
      setCurrentUser(id);
      await rebuildUserList();
      await refreshTimeline();
      renderUserArea({ id, name, createdAt: new Date().toISOString() }, await getAllUsers());
      await updateProgressInput();
      input.value = "";
      hideUserModal(true);
    } catch (err) {
      alert("ユーザー作成に失敗しました。");
    }
  });
}

// 投稿フォームイベント
function setupFormHandlers() {
  const form = qs<HTMLFormElement>("#log-form");
  const progressInput = qs<HTMLInputElement>("#progress");
  const contentInput = qs<HTMLTextAreaElement>("#content");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      alert("先にユーザーを選択してください。");
      return;
    }
    const progressVal = Number(progressInput.value);
    const contentVal = contentInput.value;
    if (!validate(progressVal, contentVal)) return;
    try {
      await addLog(progressVal, contentVal.trim(), currentUser.id);
      contentInput.value = ""; // 感想のみリセット
      await refreshTimeline();
    } catch (err) {
      alert("保存中にエラーが発生しました。");
    }
  });
}

// ユーザー切り替え後に最新進度を反映
async function updateProgressInput() {
  const progressInput = qs<HTMLInputElement>("#progress");
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    progressInput.value = "";
    return;
  }
  const latest = await getLatestProgressForUser(currentUser.id);
  progressInput.value = latest !== null && latest !== undefined ? String(latest) : "";
}

// タイムラインを最新状態で描画
async function refreshTimeline() {
  const currentUser = await getCurrentUser();
  const users = await getAllUsers();
  renderUserArea(currentUser, users);
  if (!currentUser) {
    renderTimeline([], null, null);
    return;
  }
  const logs = await getAllLogs();
  const latest = await getLatestProgressForUser(currentUser.id);
  renderTimeline(logs, currentUser, latest);
  await updateProgressInput();
}

// 初期化
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await openDatabase();
  } catch (err) {
    alert("IndexedDB の初期化に失敗しました。ブラウザ設定をご確認ください。");
    return;
  }

  const logs = await getAllLogs();
  let users = await getAllUsers();
  let currentUser = await getCurrentUser();

  // 既存ログがあるのにユーザーがいない場合はデフォルトユーザーを作成して紐づけ
  if (users.length === 0 && logs.length > 0) {
    const defaultId = await createUser("デフォルトユーザー");
    await migrateExistingLogs(defaultId);
    users = await getAllUsers();
    currentUser = await getCurrentUser();
    if (!currentUser) {
      const created = users.find((u) => u.id === defaultId) || null;
      if (created) {
        setCurrentUser(created.id);
        currentUser = created;
      }
    }
  }

  // ユーザーがまだいない場合はモーダルを強制表示
  if (users.length === 0) {
    setupUserModalHandlers();
    setupFormHandlers();
    showUserModal(true);
    await rebuildUserList();
    return;
  }

  // localStorage にユーザーが無ければ先頭をセット
  if (!currentUser) {
    currentUser = users[0];
    setCurrentUser(currentUser.id);
  }

  // キャッシュに投入
  users.forEach((u) => userCache.set(u.id, u.name));

  // 既存ログのマイグレーション（userId 無しにデフォルトを付与）
  if (users.length > 0) {
    await migrateExistingLogs(users[0].id);
  }

  setupUserModalHandlers();
  setupFormHandlers();
  await rebuildUserList();
  await refreshTimeline();
});
