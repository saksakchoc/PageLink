// Reading progress SNS frontend (API first, no IndexedDB persistence)
const API_BASE = "http://localhost:3000";
const API_AUTH_TOKEN_KEY = "apiAuthToken";
const CURRENT_BOOK_STORAGE_KEY = "currentBookId";
let apiUsers = [];
let apiBooks = [];
let apiUserBooks = [];
let apiReadingLogs = [];
let currentUser = null;
let currentUserBook = null;
let currentBookId = null;
let tempReadingMode = null;
const DEMO_USER_ID = "demo";
const DEMO_PASSWORD = "password";
function qs(selector) {
    const el = document.querySelector(selector);
    if (!el)
        throw new Error(`Element not found: ${selector}`);
    return el;
}
function formatDate(iso) {
    const date = new Date(iso);
    return date.toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}
function setActiveView(viewId) {
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === viewId));
    document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === viewId));
}
function getAuthToken() {
    const token = localStorage.getItem(API_AUTH_TOKEN_KEY);
    return token || null;
}
function setAuthToken(token) {
    if (token)
        localStorage.setItem(API_AUTH_TOKEN_KEY, token);
    else
        localStorage.removeItem(API_AUTH_TOKEN_KEY);
}
function getCurrentBookId() {
    if (currentBookId)
        return currentBookId;
    const stored = Number(localStorage.getItem(CURRENT_BOOK_STORAGE_KEY) || "");
    if (!Number.isNaN(stored) && stored > 0) {
        currentBookId = stored;
        return stored;
    }
    return null;
}
function setCurrentBookId(id) {
    currentBookId = id;
    if (id)
        localStorage.setItem(CURRENT_BOOK_STORAGE_KEY, String(id));
    else
        localStorage.removeItem(CURRENT_BOOK_STORAGE_KEY);
}
async function apiGet(path, withAuth = false) {
    const headers = {};
    if (withAuth) {
        const token = getAuthToken();
        if (token)
            headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${API_BASE}${path}`, { headers });
    if (!res.ok)
        throw new Error(`GET ${path} failed: ${res.status}`);
    return (await res.json());
}
async function apiPost(path, body, withAuth = false) {
    const headers = { "Content-Type": "application/json" };
    if (withAuth) {
        const token = getAuthToken();
        if (token)
            headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${API_BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok)
        throw new Error(`POST ${path} failed: ${res.status}`);
    return (await res.json());
}
async function apiPatch(path, body, withAuth = false) {
    const headers = { "Content-Type": "application/json" };
    if (withAuth) {
        const token = getAuthToken();
        if (token)
            headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${API_BASE}${path}`, { method: "PATCH", headers, body: JSON.stringify(body) });
    if (!res.ok)
        throw new Error(`PATCH ${path} failed: ${res.status}`);
    return (await res.json());
}
function renderUserArea() {
    const el = qs("#current-user-name");
    el.textContent = currentUser ? `${currentUser.displayName} (@${currentUser.userId})` : "-";
}
function renderSearchResults(keyword) {
    const list = qs("#search-results");
    list.innerHTML = "";
    const normalized = keyword.trim().toLowerCase();
    const beastVolumes = [
        { id: 101, title: "獣の奏者 I 闘蛇編", author: "上橋菜穂子", language: "ja", total_pages_isbn: 432 },
        { id: 102, title: "獣の奏者 II 王獣編", author: "上橋菜穂子", language: "ja", total_pages_isbn: 456 },
        { id: 103, title: "獣の奏者 III 探求編", author: "上橋菜穂子", language: "ja", total_pages_isbn: 480 },
        { id: 104, title: "獣の奏者 IV 完結編", author: "上橋菜穂子", language: "ja", total_pages_isbn: 520 },
        { id: 105, title: "獣の奏者 外伝 刹那", author: "上橋菜穂子", language: "ja", total_pages_isbn: 240 },
    ];
    const shouldShowBeast = normalized === "" || normalized.includes("獣の奏者") || normalized.includes("kemono") || normalized.includes("beast");
    const merged = shouldShowBeast ? [...beastVolumes] : [];
    const filtered = merged.filter((b) => {
        if (!normalized)
            return true;
        return b.title.toLowerCase().includes(normalized) || b.author.toLowerCase().includes(normalized);
    });
    if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "該当する本が見つかりませんでした";
        list.appendChild(empty);
        return;
    }
    filtered.forEach((b) => {
        var _a;
        const card = document.createElement("article");
        card.className = "card";
        const title = document.createElement("div");
        title.className = "username";
        title.textContent = b.title;
        const author = document.createElement("div");
        author.className = "muted";
        author.textContent = b.author;
        const meta = document.createElement("div");
        meta.className = "muted";
        meta.textContent = `言語: ${b.language || "不明"} / 総ページ数: ${(_a = b.total_pages_isbn) !== null && _a !== void 0 ? _a : "-"}p`;
        const actions = document.createElement("div");
        actions.className = "actions";
        actions.style.justifyContent = "flex-start";
        const startBtn = document.createElement("button");
        startBtn.type = "button";
        startBtn.textContent = "この本を読み始める";
        startBtn.addEventListener("click", async () => {
            if (!currentUser) {
                alert("ログインしてください");
                return;
            }
            const pages = b.total_pages_isbn || 100;
            try {
                const existing = apiUserBooks.find((ub) => ub.user_id === currentUser.id && ub.book_id === b.id);
                if (existing) {
                    await apiPatch(`/api/user-books/${existing.id}`, { status: "reading" }, true);
                    setCurrentBookId(b.id);
                }
                else {
                    await apiPost("/api/user-books", { book_id: b.id, total_pages_user: pages, status: "reading", reading_mode: "percent" }, true);
                    setCurrentBookId(b.id);
                }
                await loadApiData();
                renderAllViews();
                setActiveView("my-reading-view");
            }
            catch (err) {
                alert("読書開始に失敗しました");
                console.error(err);
            }
        });
        actions.appendChild(startBtn);
        card.appendChild(title);
        card.appendChild(author);
        card.appendChild(meta);
        card.appendChild(actions);
        list.appendChild(card);
    });
}
function renderUserBookList(status, targetElId) {
    const container = qs(`#${targetElId}`);
    container.innerHTML = "";
    const targets = apiUserBooks.filter((ub) => ub.status === status);
    if (targets.length === 0) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = status === "reading" ? "読書中の本がありません" : "読み終わった本がありません";
        container.appendChild(empty);
        return;
    }
    targets.forEach((ub) => {
        var _a;
        const book = apiBooks.find((b) => b.id === ub.book_id);
        const card = document.createElement("article");
        card.className = "card";
        const top = document.createElement("div");
        top.className = "card-top";
        const title = document.createElement("div");
        title.className = "username";
        title.textContent = book ? book.title : "不明な本";
        const progress = document.createElement("div");
        progress.className = "pill";
        progress.textContent = `${ub.latest_progress_percent}%`;
        top.appendChild(title);
        top.appendChild(progress);
        const meta = document.createElement("div");
        meta.className = "muted";
        meta.textContent = `著者: ${(_a = book === null || book === void 0 ? void 0 : book.author) !== null && _a !== void 0 ? _a : "-"} / 総ページ: ${ub.total_pages_user}p`;
        card.appendChild(top);
        card.appendChild(meta);
        if (status === "reading") {
            const actions = document.createElement("div");
            actions.className = "actions";
            actions.style.justifyContent = "flex-start";
            const detailBtn = document.createElement("button");
            detailBtn.type = "button";
            detailBtn.textContent = "この本の詳細";
            detailBtn.addEventListener("click", async () => {
                setCurrentBookId(ub.book_id);
                await loadApiData();
                renderAllViews();
                setActiveView("book-detail-view");
            });
            const setCurrentBtn = document.createElement("button");
            setCurrentBtn.type = "button";
            setCurrentBtn.textContent = "今読んでいる本に設定";
            setCurrentBtn.addEventListener("click", async () => {
                setCurrentBookId(ub.book_id);
                await loadApiData();
                renderAllViews();
                setActiveView("book-page");
            });
            actions.appendChild(detailBtn);
            actions.appendChild(setCurrentBtn);
            card.appendChild(actions);
        }
        container.appendChild(card);
    });
}
function renderProfileCard() {
    const card = qs("#profile-card");
    card.innerHTML = "";
    const name = document.createElement("div");
    name.className = "username";
    name.textContent = currentUser ? currentUser.displayName : "未ログイン";
    const idText = document.createElement("div");
    idText.className = "muted";
    idText.textContent = currentUser ? `@${currentUser.userId}` : "ログインしてください";
    const bio = document.createElement("div");
    bio.style.marginTop = "6px";
    bio.textContent = "本とコーヒーが好きなデザイナー";
    card.appendChild(name);
    card.appendChild(idText);
    card.appendChild(bio);
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.style.justifyContent = "flex-start";
    const logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.textContent = "ログアウト";
    logoutBtn.disabled = !currentUser;
    logoutBtn.addEventListener("click", async () => {
        setAuthToken(null);
        currentUser = null;
        await loadApiData();
        renderAllViews();
        setActiveView("login-view");
    });
    actions.appendChild(logoutBtn);
    card.appendChild(actions);
}
function renderApiTimeline() {
    const container = qs("#timeline");
    container.innerHTML = "";
    if (!currentUser) {
        container.textContent = "ログインしてください";
        return;
    }
    const filtered = [...apiReadingLogs].sort((a, b) => {
        if (b.progress_percent !== a.progress_percent)
            return b.progress_percent - a.progress_percent;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = "投稿がまだありません。最初の感想を残しましょう";
        empty.style.color = "#6b665d";
        empty.style.fontSize = "0.95rem";
        container.appendChild(empty);
        return;
    }
    filtered.forEach((log) => {
        const card = document.createElement("article");
        card.className = "card";
        if (log.user_id === currentUser.id)
            card.classList.add("mine");
        const top = document.createElement("div");
        top.className = "card-top";
        const prog = document.createElement("div");
        prog.className = "progress";
        prog.textContent = `${log.progress_percent}%`;
        const time = document.createElement("div");
        time.className = "timestamp";
        time.textContent = formatDate(log.created_at);
        top.appendChild(prog);
        top.appendChild(time);
        const userName = document.createElement("div");
        userName.className = "username";
        const user = apiUsers.find((u) => u.id === log.user_id);
        userName.textContent = user ? user.displayName : "ユーザー";
        const tags = document.createElement("div");
        tags.className = "tag-row";
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = log.visibility === "private" ? "非公開" : "公開";
        tags.appendChild(tag);
        const content = document.createElement("div");
        content.className = "content";
        content.textContent = log.content;
        card.appendChild(top);
        card.appendChild(userName);
        card.appendChild(content);
        card.appendChild(tags);
        container.appendChild(card);
    });
}
function renderBookSettings() {
    const pagesInput = qs("#total-pages");
    const pagesRow = qs("#total-pages-row");
    const modeSelect = qs("#reading-mode");
    const modeLabel = qs('label[for="progress"]');
    const latestLabel = qs("#progress-helper");
    const progressInput = qs("#progress");
    const mode = (tempReadingMode ||
        (currentUserBook === null || currentUserBook === void 0 ? void 0 : currentUserBook.reading_mode) ||
        modeSelect.value ||
        "percent");
    modeSelect.value = mode;
    pagesInput.value = currentUserBook ? String(currentUserBook.total_pages_user) : "";
    pagesInput.disabled = mode !== "pages";
    pagesRow.style.display = mode === "pages" ? "grid" : "none";
    progressInput.min = "0";
    if (mode === "pages") {
        const total = currentUserBook === null || currentUserBook === void 0 ? void 0 : currentUserBook.total_pages_user;
        progressInput.max = total ? String(total) : "";
        progressInput.placeholder = total ? `0〜${total} ページ` : "ページ数を入力";
    }
    else {
        progressInput.max = "100";
        progressInput.placeholder = "0〜100";
    }
    if (mode === "pages") {
        modeLabel.textContent = "進度 (ページ)";
        latestLabel.textContent =
            currentUserBook && currentUserBook.latest_progress_percent >= 0
                ? `現在: 約 ${(currentUserBook.total_pages_user * currentUserBook.latest_progress_percent) / 100} / ${currentUserBook.total_pages_user} ページ`
                : "";
    }
    else {
        modeLabel.textContent = "進度 (%)";
        latestLabel.textContent =
            currentUserBook && currentUserBook.latest_progress_percent >= 0
                ? `現在: ${currentUserBook.latest_progress_percent}%`
                : "";
    }
}
function renderDetailProgress() {
    const input = qs("#detail-progress");
    const helper = qs("#detail-progress-helper");
    const mode = (currentUserBook === null || currentUserBook === void 0 ? void 0 : currentUserBook.reading_mode) || "percent";
    const total = currentUserBook === null || currentUserBook === void 0 ? void 0 : currentUserBook.total_pages_user;
    input.min = "0";
    if (mode === "pages") {
        input.max = total ? String(total) : "";
        input.placeholder = total ? `0〜${total} ページ` : "ページ数を入力";
        input.value =
            currentUserBook && total
                ? String(Math.round((total * currentUserBook.latest_progress_percent) / 100))
                : "";
        helper.textContent =
            currentUserBook && total
                ? `現在: 約 ${(total * currentUserBook.latest_progress_percent) / 100} / ${total} ページ`
                : "総ページ数を設定してください";
    }
    else {
        input.max = "100";
        input.placeholder = "0〜100";
        input.value = currentUserBook ? String(currentUserBook.latest_progress_percent) : "";
        helper.textContent =
            currentUserBook && currentUserBook.latest_progress_percent >= 0
                ? `現在: ${currentUserBook.latest_progress_percent}%`
                : "";
    }
}
function renderCurrentBookSubtitle() {
    const subtitle = document.querySelector("#current-book-subtitle");
    if (!subtitle)
        return;
    const current = getCurrentBookId();
    const book = current ? apiBooks.find((b) => b.id === current) : null;
    const progress = currentUserBook === null || currentUserBook === void 0 ? void 0 : currentUserBook.latest_progress_percent;
    const progressText = typeof progress === "number" && Number.isFinite(progress) ? `（進度: ${progress}%）` : "";
    subtitle.textContent = book ? `いま読んでいる本：${book.title}${progressText}` : "いま読んでいる本：なし";
}
function renderBookMeta() {
    const meta = qs("#book-meta");
    meta.innerHTML = "";
    const current = getCurrentBookId();
    const book = current ? apiBooks.find((b) => b.id === current) : null;
    const title = document.createElement("div");
    title.className = "username";
    title.textContent = book ? book.title : "未設定の本";
    const author = document.createElement("div");
    author.className = "muted";
    author.textContent = book ? `著者: ${book.author}` : "";
    const mode = document.createElement("div");
    mode.className = "muted";
    mode.textContent = `入力モード: ${(currentUserBook === null || currentUserBook === void 0 ? void 0 : currentUserBook.reading_mode) === "pages" ? "ページ" : "パーセンテージ"}`;
    const pages = document.createElement("div");
    pages.className = "muted";
    pages.textContent = currentUserBook ? `総ページ: ${currentUserBook.total_pages_user}p` : "総ページ未設定";
    meta.appendChild(title);
    meta.appendChild(author);
    meta.appendChild(mode);
    meta.appendChild(pages);
}
function renderAllViews() {
    renderUserArea();
    renderUserBookList("reading", "reading-list");
    renderUserBookList("finished", "finished-list");
    renderProfileCard();
    renderApiTimeline();
    updateProgressInput();
    renderCurrentBookSubtitle();
    renderBookMeta();
    renderDetailProgress();
}
function setupSearchHandlers() {
    const form = qs("#search-form");
    const input = qs("#search-input");
    form.addEventListener("submit", (e) => {
        e.preventDefault();
        renderSearchResults(input.value);
    });
}
function setupAuthHandlers() {
    const form = qs("#login-form");
    const emailInput = qs("#login-email");
    const passwordInput = qs("#login-password");
    const errorEl = qs("#login-error");
    const signupForm = qs("#signup-form");
    const signupDisplay = qs("#signup-display-name");
    const signupEmail = qs("#signup-email");
    const signupPassword = qs("#signup-password");
    const signupError = qs("#signup-error");
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        errorEl.textContent = "";
        try {
            const result = await apiPost("/api/auth/login", {
                userId: emailInput.value.trim(),
                password: passwordInput.value,
            });
            setAuthToken(result.token);
            currentUser = result.user;
            await loadApiData();
            renderAllViews();
            setActiveView("book-page");
        }
        catch (err) {
            errorEl.textContent = "ログインに失敗しました。ユーザーIDとパスワードを確認してください。";
            console.error(err);
        }
    });
    signupForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        signupError.textContent = "";
        try {
            const result = await apiPost("/api/auth/signup", {
                displayName: signupDisplay.value.trim(),
                userId: signupEmail.value.trim(),
                password: signupPassword.value,
            });
            setAuthToken(result.token);
            currentUser = result.user;
            setCurrentBookId(null);
            await loadApiData();
            renderAllViews();
            setActiveView("search-view");
        }
        catch (err) {
            signupError.textContent = "登録に失敗しました。入力内容を確認してください。";
            console.error(err);
        }
    });
}
function setupFormHandlers() {
    const form = qs("#log-form");
    const progressInput = qs("#progress");
    const contentInput = qs("#content");
    const visibilityInput = qs("#visibility");
    const errorEl = qs("#error");
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!currentUser) {
            alert("先にログインしてください");
            return;
        }
        if (!currentUserBook || !getCurrentBookId()) {
            errorEl.textContent = "本の設定を先に行ってください";
            return;
        }
        const rawProgress = Number(progressInput.value);
        const mode = (currentUserBook === null || currentUserBook === void 0 ? void 0 : currentUserBook.reading_mode) || "percent";
        const totalPages = (currentUserBook === null || currentUserBook === void 0 ? void 0 : currentUserBook.total_pages_user) || 0;
        let progressVal = rawProgress;
        if (mode === "pages") {
            if (!totalPages || totalPages <= 0) {
                errorEl.textContent = "ページ数を先に設定してください";
                return;
            }
            progressVal = Math.floor((rawProgress / totalPages) * 100);
        }
        const contentVal = contentInput.value;
        if (!Number.isInteger(progressVal) || progressVal < 0 || progressVal > 100) {
            errorEl.textContent = "進度は0〜100の整数で入力してください";
            return;
        }
        errorEl.textContent = "";
        try {
            await apiPost("/api/reading-logs", {
                book_id: getCurrentBookId(),
                progress_percent: progressVal,
                content: contentVal.trim(),
                visibility: visibilityInput.value,
            }, true);
            contentInput.value = "";
            await loadApiData();
            renderAllViews();
        }
        catch (err) {
            alert("保存中にエラーが発生しました");
            console.error(err);
        }
    });
}
function updateProgressInput() {
    const progressInput = qs("#progress");
    if (!currentUser) {
        progressInput.value = "";
        return;
    }
    const current = getCurrentBookId();
    const entry = current
        ? apiUserBooks.find((ub) => ub.user_id === currentUser.id && ub.book_id === current)
        : undefined;
    currentUserBook = entry || null;
    if (entry) {
        if (entry.reading_mode === "pages") {
            const pages = Math.round((entry.total_pages_user * entry.latest_progress_percent) / 100);
            progressInput.value = String(pages);
        }
        else {
            progressInput.value = String(entry.latest_progress_percent);
        }
    }
    else {
        progressInput.value = "";
    }
    const submitBtn = document.querySelector("#log-form button[type='submit']");
    if (submitBtn)
        submitBtn.disabled = !currentUserBook;
    renderBookSettings();
}
async function restoreSession() {
    const token = getAuthToken();
    if (token) {
        try {
            const me = await apiGet("/api/auth/me", true);
            currentUser = me;
            return;
        }
        catch (err) {
            console.warn("token invalid, clearing", err);
            setAuthToken(null);
            currentUser = null;
        }
    }
    try {
        const result = await apiPost("/api/auth/login", {
            userId: DEMO_USER_ID,
            password: DEMO_PASSWORD,
        });
        setAuthToken(result.token);
        currentUser = result.user;
    }
    catch (err) {
        console.error("auto demo login failed", err);
        currentUser = null;
    }
}
async function loadApiData() {
    await restoreSession();
    apiUsers = await apiGet("/api/users");
    apiBooks = await apiGet("/api/books");
    if (!currentBookId) {
        const stored = Number(localStorage.getItem(CURRENT_BOOK_STORAGE_KEY) || "");
        if (!Number.isNaN(stored) && stored > 0)
            currentBookId = stored;
    }
    if (!currentUser && apiUsers.length > 0) {
        currentUser = apiUsers[0];
    }
    if (currentUser) {
        apiUserBooks = await apiGet(`/api/user-books?userId=${currentUser.id}`);
        const currentBook = getCurrentBookId();
        currentUserBook = currentBook ? apiUserBooks.find((ub) => ub.book_id === currentBook) || null : null;
        apiReadingLogs = currentBook
            ? await apiGet(`/api/reading-logs?bookId=${currentBook}&viewerUserId=${currentUser.id}`)
            : [];
    }
    else {
        apiUserBooks = [];
        apiReadingLogs = [];
        currentUserBook = null;
    }
    tempReadingMode = null;
}
function renderBookSettingsHandlers() {
    const form = qs("#book-settings-form");
    const pagesInput = qs("#total-pages");
    const modeSelect = qs("#reading-mode");
    const helper = qs("#settings-helper");
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!currentUser) {
            helper.textContent = "先にログインしてください";
            return;
        }
        const totalPages = Number(pagesInput.value);
        const mode = modeSelect.value;
        if (!Number.isFinite(totalPages) || totalPages <= 0) {
            helper.textContent = "ページ数を正しく入力してください";
            return;
        }
        if (!getCurrentBookId()) {
            helper.textContent = "先に本を選んでください";
            return;
        }
        try {
            if (currentUserBook) {
                await apiPatch(`/api/user-books/${currentUserBook.id}`, { total_pages_user: totalPages, reading_mode: mode }, true);
            }
            else {
                await apiPost("/api/user-books", { book_id: getCurrentBookId(), total_pages_user: totalPages, status: "reading", reading_mode: mode }, true);
            }
            helper.textContent = "保存しました";
            await loadApiData();
            renderAllViews();
        }
        catch (err) {
            helper.textContent = "保存に失敗しました";
            console.error(err);
        }
    });
    modeSelect.addEventListener("change", () => {
        tempReadingMode = modeSelect.value;
        renderBookSettings();
        renderDetailProgress();
    });
}
function setupDetailProgressHandlers() {
    const form = qs("#book-progress-form");
    const input = qs("#detail-progress");
    const helper = qs("#detail-progress-helper");
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!currentUser) {
            helper.textContent = "先にログインしてください";
            return;
        }
        const mode = (currentUserBook === null || currentUserBook === void 0 ? void 0 : currentUserBook.reading_mode) || "percent";
        const total = (currentUserBook === null || currentUserBook === void 0 ? void 0 : currentUserBook.total_pages_user) || Number(qs("#total-pages").value) || 0;
        const raw = Number(input.value);
        let percent = raw;
        if (mode === "pages") {
            if (!total || total <= 0) {
                helper.textContent = "先に総ページ数を設定してください";
                return;
            }
            percent = Math.floor((raw / total) * 100);
        }
        if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
            helper.textContent = "進捗は0〜100の整数で入力してください";
            return;
        }
        try {
            if (!currentUserBook) {
                helper.textContent = "先に本の設定を保存してください";
                return;
            }
            await apiPatch(`/api/user-books/${currentUserBook.id}`, { latest_progress_percent: percent }, true);
            helper.textContent = "進捗を保存しました";
            await loadApiData();
            renderAllViews();
        }
        catch (err) {
            helper.textContent = "進捗の保存に失敗しました";
            console.error(err);
        }
    });
}
document.addEventListener("DOMContentLoaded", async () => {
    try {
        await loadApiData();
    }
    catch (err) {
        alert("API への接続に失敗しました。Docker が起動しているか確認してください。");
        console.error(err);
        return;
    }
    document.querySelectorAll(".nav-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.view;
            if (target)
                setActiveView(target);
        });
    });
    setActiveView("book-page");
    const switchBtn = qs("#switch-user-btn");
    switchBtn.addEventListener("click", () => {
        setActiveView("login-view");
    });
    renderSearchResults("");
    renderAllViews();
    setupSearchHandlers();
    setupAuthHandlers();
    renderBookSettingsHandlers();
    setupDetailProgressHandlers();
    setupFormHandlers();
});
