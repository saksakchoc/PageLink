"use strict";
// Reading progress SNS frontend (API first, no IndexedDB persistence)
const API_BASE = "/api";
const API_AUTH_TOKEN_KEY = "apiAuthToken";
const CURRENT_BOOK_STORAGE_KEY = "currentBookId";
const LAST_VIEW_KEY = "lastViewId";
let apiUsers = [];
let apiBooks = [];
let apiUserBooks = [];
let apiReadingLogs = [];
let apiActivityLogs = [];
let currentUser = null;
let currentUserBook = null;
let currentBookId = null;
let tempReadingMode = null;
let pendingIconData = undefined;
let profileViewUserId = null;
let shelfMode = "reading";
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
    localStorage.setItem(LAST_VIEW_KEY, viewId);
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
function clampPercent(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
}
function clampInt(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.max(0, Math.round(value));
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
    const avatarImg = document.querySelector("#nav-avatar-img");
    const fallback = document.querySelector("#nav-avatar-fallback");
    const btn = document.querySelector("#nav-profile-btn");
    if (!avatarImg || !fallback || !btn)
        return;
    if (currentUser?.iconUrl) {
        avatarImg.src = currentUser.iconUrl;
        avatarImg.style.display = "block";
        fallback.style.display = "none";
    }
    else {
        avatarImg.removeAttribute("src");
        avatarImg.style.display = "none";
        const initial = currentUser ? currentUser.displayName.trim().charAt(0) : "?";
        fallback.textContent = initial || "?";
        fallback.style.display = "inline";
    }
    btn.title = currentUser ? `${currentUser.displayName}のプロフィール` : "ログインしてください";
}
function updateShelfDisplay() {
    const readingList = document.querySelector("#reading-list");
    const finishedList = document.querySelector("#finished-list");
    if (readingList)
        readingList.style.display = shelfMode === "reading" ? "" : "none";
    if (finishedList)
        finishedList.style.display = shelfMode === "finished" ? "" : "none";
    document.querySelectorAll(".shelf-tab").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.mode === shelfMode);
    });
}
function setShelfMode(mode) {
    shelfMode = mode;
    updateShelfDisplay();
}
function openProfileView(userId) {
    if (typeof userId === "number")
        profileViewUserId = userId;
    else
        profileViewUserId = currentUser?.id ?? null;
    renderAllViews();
    setActiveView("profile-view");
}
function renderSearchResults(keyword) {
    const list = qs("#search-results");
    list.innerHTML = "";
    const normalized = keyword.trim().toLowerCase();
    const beastVolumes = [
        { id: 101, title: "獣の奏者 I 闘蛇編", author: "上橋菜穂子", total_pages_isbn: 432 },
        { id: 102, title: "獣の奏者 II 王獣編", author: "上橋菜穂子", total_pages_isbn: 456 },
        { id: 103, title: "獣の奏者 III 探求編", author: "上橋菜穂子", total_pages_isbn: 480 },
        { id: 104, title: "獣の奏者 IV 完結編", author: "上橋菜穂子", total_pages_isbn: 520 },
        { id: 105, title: "獣の奏者 外伝 刹那", author: "上橋菜穂子", total_pages_isbn: 240 },
    ];
    const shouldShowBeast = normalized === "" || normalized.includes("獣の奏者") || normalized.includes("kemono") || normalized.includes("beast");
    const merged = [...apiBooks];
    const existingIds = new Set(merged.map((b) => b.id));
    if (shouldShowBeast) {
        beastVolumes.forEach((b) => {
            if (!existingIds.has(b.id))
                merged.push(b);
        });
    }
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
    }
    else {
        filtered.forEach((b) => {
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
            meta.textContent = `総ページ数: ${b.total_pages_isbn ?? "-"}p`;
            const actions = document.createElement("div");
            actions.className = "actions";
            actions.style.justifyContent = "flex-start";
            const startBtn = document.createElement("button");
            startBtn.type = "button";
            startBtn.textContent = "積読に入れる";
            const existing = apiUserBooks.find((ub) => ub.user_id === currentUser?.id && ub.book_id === b.id);
            if (existing && (existing.status === "reading" || existing.status === "finished")) {
                startBtn.disabled = true;
                startBtn.textContent = existing.status === "finished" ? "読了済み" : "読書中";
                startBtn.style.background = "#d1d5db";
                startBtn.style.color = "#555";
                startBtn.style.cursor = "not-allowed";
            }
            else {
                startBtn.addEventListener("click", async () => {
                    if (!currentUser) {
                        alert("ログインしてください");
                        return;
                    }
                    const pages = b.total_pages_isbn || 100;
                    try {
                        if (existing) {
                            await apiPatch(`/api/user-books/${existing.id}`, { status: "reading" }, true);
                        }
                        else {
                            await apiPost("/api/user-books", { book_id: b.id, total_pages_user: pages, status: "reading", reading_mode: "percent" }, true);
                        }
                        await loadApiData();
                        renderAllViews();
                        location.reload(); // 要望: 積読に入れる押下後ページ再読み込み
                    }
                    catch (err) {
                        alert("読書開始に失敗しました");
                        console.error(err);
                    }
                });
            }
            actions.appendChild(startBtn);
            card.appendChild(title);
            card.appendChild(author);
            card.appendChild(meta);
            card.appendChild(actions);
            list.appendChild(card);
        });
    }
    const addCard = document.createElement("article");
    addCard.className = "card";
    addCard.style.display = "grid";
    addCard.style.gap = "8px";
    const titleLabel = document.createElement("label");
    titleLabel.textContent = "新しい本を追加";
    titleLabel.style.fontWeight = "700";
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.placeholder = "タイトル";
    titleInput.value = keyword.trim();
    const authorInput = document.createElement("input");
    authorInput.type = "text";
    authorInput.placeholder = "著者";
    const pagesInput = document.createElement("input");
    pagesInput.type = "number";
    pagesInput.placeholder = "総ページ数 (任意)";
    pagesInput.min = "1";
    const helper = document.createElement("div");
    helper.className = "muted";
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.textContent = "この内容で追加";
    addButton.addEventListener("click", async () => {
        if (!currentUser) {
            alert("ログインしてください");
            return;
        }
        const title = titleInput.value.trim();
        const author = authorInput.value.trim();
        const pagesVal = Number(pagesInput.value);
        const totalPages = Number.isFinite(pagesVal) && pagesVal > 0 ? Math.round(pagesVal) : null;
        if (!title || !author) {
            helper.textContent = "タイトルと著者を入力してください";
            return;
        }
        helper.textContent = "追加中...";
        try {
            await apiPost("/api/books", { title, author, total_pages_isbn: totalPages ?? undefined }, true);
            helper.textContent = "追加しました。検索結果を更新します。";
            titleInput.value = "";
            authorInput.value = "";
            pagesInput.value = "";
            await loadApiData();
            renderSearchResults(keyword);
        }
        catch (err) {
            helper.textContent = "追加に失敗しました。入力を確認してください。";
            console.error(err);
        }
    });
    addCard.appendChild(titleLabel);
    addCard.appendChild(titleInput);
    addCard.appendChild(authorInput);
    addCard.appendChild(pagesInput);
    addCard.appendChild(addButton);
    addCard.appendChild(helper);
    list.appendChild(addCard);
}
function renderUserBookList(status, targetElId) {
    const container = qs(`#${targetElId}`);
    container.innerHTML = "";
    const user = currentUser;
    if (!user) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "ログインしてください";
        container.appendChild(empty);
        return;
    }
    const targets = apiUserBooks.filter((ub) => ub.status === status && ub.user_id === user.id);
    if (targets.length === 0) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = status === "reading" ? "積読の本がありません" : "読み終わった本がありません";
        container.appendChild(empty);
        return;
    }
    targets.forEach((ub) => {
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
        meta.textContent = `著者: ${book?.author ?? "-"} / 総ページ: ${ub.total_pages_user}p`;
        card.appendChild(top);
        card.appendChild(meta);
        if (status === "reading") {
            const actions = document.createElement("div");
            actions.className = "actions";
            actions.style.justifyContent = "flex-start";
            // オプション: 詳細・設定ページへ遷移
            const optionsBtn = document.createElement("button");
            optionsBtn.type = "button";
            optionsBtn.textContent = "オプション";
            optionsBtn.addEventListener("click", async () => {
                setCurrentBookId(ub.book_id);
                await loadApiData();
                renderAllViews();
                setActiveView("book-detail-view");
            });
            const toggleBtn = document.createElement("button");
            toggleBtn.type = "button";
            const isCurrent = getCurrentBookId() === ub.book_id;
            toggleBtn.textContent = isCurrent ? "今読んでいる本を解除" : "今読んでいる本に登録";
            toggleBtn.style.background = isCurrent ? "#ea580c" : ""; // 解除オレンジ、登録は緑
            toggleBtn.addEventListener("click", async () => {
                const isCurrentNow = getCurrentBookId() === ub.book_id;
                setCurrentBookId(isCurrentNow ? null : ub.book_id);
                await apiPatch(`/api/user-books/${ub.id}`, { status: "reading" }, true);
                await loadApiData();
                renderAllViews();
            });
            actions.appendChild(optionsBtn);
            actions.appendChild(toggleBtn);
            if (getCurrentBookId() !== ub.book_id) {
                const removeBtn = document.createElement("button");
                removeBtn.type = "button";
                removeBtn.textContent = "積読から外す";
                removeBtn.addEventListener("click", async () => {
                    try {
                        await apiPatch(`/api/user-books/${ub.id}`, { status: "on_hold", latest_progress_percent: ub.latest_progress_percent }, true);
                        await loadApiData();
                        renderAllViews();
                    }
                    catch (err) {
                        alert("積読から外す処理でエラーが発生しました");
                        console.error(err);
                    }
                });
                actions.appendChild(removeBtn); // 最後に追加して右寄せ
            }
            card.appendChild(actions);
        }
        if (status === "finished") {
            const actions = document.createElement("div");
            actions.className = "actions";
            actions.style.justifyContent = "flex-start";
            const backBtn = document.createElement("button");
            backBtn.type = "button";
            backBtn.textContent = "積読に戻す";
            backBtn.addEventListener("click", async () => {
                try {
                    await apiPatch(`/api/user-books/${ub.id}`, { status: "reading", latest_progress_percent: 0 }, true);
                    setCurrentBookId(ub.book_id);
                    await loadApiData();
                    renderAllViews();
                    setShelfMode("reading");
                    setActiveView("my-shelf-view");
                }
                catch (err) {
                    alert("積読に戻す処理でエラーが発生しました");
                    console.error(err);
                }
            });
            actions.appendChild(backBtn);
            card.appendChild(actions);
        }
        container.appendChild(card);
    });
}
function renderProfileCard() {
    const card = qs("#profile-card");
    card.innerHTML = "";
    const targetUser = (profileViewUserId && apiUsers.find((u) => u.id === profileViewUserId)) || currentUser || null;
    if (!targetUser) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "プロフィールを表示できるユーザーがいません。";
        card.appendChild(empty);
        return;
    }
    const isOwnProfile = currentUser?.id === targetUser.id;
    const header = document.createElement("div");
    header.className = "profile-header";
    const avatar = document.createElement("div");
    avatar.className = "profile-avatar";
    if (targetUser.iconUrl) {
        const img = document.createElement("img");
        img.src = targetUser.iconUrl;
        img.alt = "プロフィールアイコン";
        avatar.appendChild(img);
    }
    else {
        avatar.classList.add("fallback");
        const initials = targetUser.displayName.trim().charAt(0);
        avatar.textContent = initials || "?";
    }
    const textWrap = document.createElement("div");
    const name = document.createElement("div");
    name.className = "username";
    name.textContent = targetUser.displayName;
    const idText = document.createElement("div");
    idText.className = "muted";
    idText.textContent = `@${targetUser.userId}`;
    textWrap.appendChild(name);
    textWrap.appendChild(idText);
    header.appendChild(avatar);
    header.appendChild(textWrap);
    card.appendChild(header);
    const bio = document.createElement("div");
    bio.className = "profile-bio";
    bio.textContent = targetUser.bio ? targetUser.bio : "自己紹介はまだ設定されていません。";
    card.appendChild(bio);
    if (!isOwnProfile) {
        const note = document.createElement("div");
        note.className = "muted";
        note.style.marginTop = "8px";
        note.textContent = "このユーザーのプロフィールを表示中";
        card.appendChild(note);
    }
    if (isOwnProfile) {
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
            profileViewUserId = null;
            await loadApiData();
            renderAllViews();
            setActiveView("login-view");
        });
        actions.appendChild(logoutBtn);
        card.appendChild(actions);
    }
}
function updateProfileIconPreview(src) {
    const preview = document.querySelector("#profile-icon-preview");
    const emptyState = document.querySelector("#profile-icon-empty");
    if (!preview || !emptyState)
        return;
    if (src) {
        preview.src = src;
        preview.style.display = "block";
        emptyState.style.display = "none";
    }
    else {
        preview.removeAttribute("src");
        preview.style.display = "none";
        emptyState.style.display = "flex";
    }
}
function renderProfileForm() {
    const form = document.querySelector("#profile-form");
    if (!form)
        return;
    const nameInput = qs("#profile-display-name");
    const bioInput = qs("#profile-bio");
    const fileInput = qs("#profile-icon-input");
    const clearBtn = qs("#profile-icon-clear");
    const submitBtn = form.querySelector('button[type="submit"]');
    const messageEl = qs("#profile-form-message");
    const targetUser = (profileViewUserId && apiUsers.find((u) => u.id === profileViewUserId)) || currentUser || null;
    const isLoggedIn = Boolean(currentUser);
    const isOwnProfile = Boolean(targetUser && currentUser && targetUser.id === currentUser.id);
    form.style.display = isOwnProfile ? "grid" : "none";
    if (!isOwnProfile) {
        messageEl.textContent = targetUser ? `${targetUser.displayName}のプロフィールです` : "";
        return;
    }
    nameInput.disabled = !isLoggedIn;
    bioInput.disabled = !isLoggedIn;
    fileInput.disabled = !isLoggedIn;
    clearBtn.disabled = !isLoggedIn;
    if (submitBtn)
        submitBtn.disabled = !isLoggedIn;
    if (!isLoggedIn || !targetUser) {
        nameInput.value = "";
        bioInput.value = "";
        fileInput.value = "";
        pendingIconData = undefined;
        updateProfileIconPreview(null);
        messageEl.textContent = "プロフィールを編集するにはログインしてください";
        return;
    }
    nameInput.value = targetUser.displayName;
    bioInput.value = targetUser.bio || "";
    fileInput.value = "";
    pendingIconData = undefined;
    updateProfileIconPreview(targetUser.iconUrl || null);
}
function setupProfileForm() {
    const form = qs("#profile-form");
    const nameInput = qs("#profile-display-name");
    const bioInput = qs("#profile-bio");
    const fileInput = qs("#profile-icon-input");
    const clearBtn = qs("#profile-icon-clear");
    const messageEl = qs("#profile-form-message");
    const MAX_FILE_SIZE = 2 * 1024 * 1024;
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!currentUser) {
            messageEl.textContent = "ログインしてください";
            return;
        }
        const displayName = nameInput.value.trim();
        if (!displayName) {
            messageEl.textContent = "表示名を入力してください";
            return;
        }
        const payload = { displayName, bio: bioInput.value.trim() };
        if (pendingIconData !== undefined)
            payload.iconData = pendingIconData;
        messageEl.textContent = "保存中...";
        try {
            const updated = await apiPatch("/api/users/me", payload, true);
            pendingIconData = undefined;
            currentUser = updated;
            apiUsers = apiUsers.map((u) => (u.id === updated.id ? { ...u, ...updated } : u));
            renderAllViews();
            messageEl.textContent = "プロフィールを更新しました";
        }
        catch (err) {
            messageEl.textContent = "プロフィールの更新に失敗しました";
            console.error(err);
        }
    });
    fileInput.addEventListener("change", () => {
        messageEl.textContent = "";
        if (!currentUser) {
            fileInput.value = "";
            messageEl.textContent = "ログインしてください";
            return;
        }
        const file = fileInput.files?.[0];
        if (!file) {
            pendingIconData = undefined;
            updateProfileIconPreview(currentUser.iconUrl || null);
            return;
        }
        if (file.size > MAX_FILE_SIZE) {
            messageEl.textContent = "ファイルサイズは2MB以下にしてください";
            fileInput.value = "";
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            pendingIconData = reader.result;
            updateProfileIconPreview(pendingIconData);
        };
        reader.onerror = () => {
            messageEl.textContent = "画像の読み込みに失敗しました";
            fileInput.value = "";
        };
        reader.readAsDataURL(file);
    });
    clearBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (!currentUser) {
            messageEl.textContent = "ログインしてください";
            return;
        }
        fileInput.value = "";
        pendingIconData = null;
        updateProfileIconPreview(null);
        messageEl.textContent = "アイコンをリセットします";
    });
}
function renderReadingLogTimeline() {
    const container = document.querySelector("#reading-log-timeline");
    if (!container)
        return;
    container.innerHTML = "";
    if (!currentUser) {
        container.textContent = "ログインしてください";
        return;
    }
    const logs = [...apiReadingLogs].sort((a, b) => {
        if (b.progress_percent !== a.progress_percent)
            return b.progress_percent - a.progress_percent;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    if (logs.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = "投稿がまだありません。最初の感想を残しましょう";
        empty.style.color = "#6b665d";
        empty.style.fontSize = "0.95rem";
        container.appendChild(empty);
        return;
    }
    logs.forEach((log) => {
        const card = document.createElement("article");
        card.className = "card";
        if (currentUser && log.user_id === currentUser.id)
            card.classList.add("mine");
        const top = document.createElement("div");
        top.className = "card-top";
        const user = apiUsers.find((u) => u.id === log.user_id);
        const userBookForUser = apiUserBooks.find((ub) => ub.user_id === log.user_id && ub.book_id === log.book_id);
        const prog = document.createElement("div");
        prog.className = "progress";
        const percentText = `${log.progress_percent}%`;
        const usePages = user?.id === currentUser?.id && userBookForUser?.reading_mode === "pages";
        if (usePages && log.progress_unit === "pages") {
            const value = log.progress_value ?? Math.round(log.progress_percent);
            prog.textContent = `${percentText} (${value}ページ)`;
        }
        else {
            prog.textContent = percentText;
        }
        const time = document.createElement("div");
        time.className = "timestamp";
        time.textContent = formatDate(log.created_at);
        top.appendChild(prog);
        top.appendChild(time);
        const userInfo = document.createElement("div");
        userInfo.className = "timeline-user";
        const avatar = document.createElement("div");
        avatar.className = "timeline-avatar";
        if (user?.iconUrl) {
            const img = document.createElement("img");
            img.src = user.iconUrl;
            img.alt = `${user.displayName}のアイコン`;
            avatar.appendChild(img);
        }
        else {
            const initial = user?.displayName?.trim().charAt(0) || "?";
            avatar.textContent = initial;
        }
        const userText = document.createElement("div");
        const userName = document.createElement("div");
        userName.className = "username";
        userName.textContent = user ? user.displayName : "ユーザー";
        const userId = document.createElement("div");
        userId.className = "muted";
        userId.textContent = user ? `@${user.userId}` : "";
        userText.appendChild(userName);
        if (user)
            userText.appendChild(userId);
        userInfo.appendChild(avatar);
        userInfo.appendChild(userText);
        if (user) {
            userInfo.style.cursor = "pointer";
            userInfo.addEventListener("click", () => openProfileView(user.id));
            userInfo.tabIndex = 0;
            userInfo.addEventListener("keypress", (ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    openProfileView(user.id);
                }
            });
        }
        else {
            userInfo.style.cursor = "default";
        }
        const content = document.createElement("div");
        content.className = "content";
        content.textContent = log.content;
        const tags = document.createElement("div");
        tags.className = "tag-row";
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = log.visibility === "private" ? "非公開" : "公開";
        tags.appendChild(tag);
        card.appendChild(top);
        card.appendChild(userInfo);
        card.appendChild(content);
        card.appendChild(tags);
        container.appendChild(card);
    });
}
function renderActivityTimeline() {
    const container = document.querySelector("#activity-timeline");
    if (!container)
        return;
    container.innerHTML = "";
    if (!currentUser) {
        container.textContent = "ログインしてください";
        return;
    }
    const items = [...apiActivityLogs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (items.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = "まだアクティビティがありません。";
        empty.style.color = "#6b665d";
        empty.style.fontSize = "0.95rem";
        container.appendChild(empty);
        return;
    }
    items.forEach((activity) => {
        const card = document.createElement("article");
        card.className = "card";
        const top = document.createElement("div");
        top.className = "card-top";
        const status = document.createElement("div");
        status.className = "pill";
        status.textContent = activity.type === "start" ? "読み始め" : "読了";
        const time = document.createElement("div");
        time.className = "timestamp";
        time.textContent = formatDate(activity.created_at);
        top.appendChild(status);
        top.appendChild(time);
        const userInfo = document.createElement("div");
        userInfo.className = "timeline-user";
        const avatar = document.createElement("div");
        avatar.className = "timeline-avatar";
        const user = apiUsers.find((u) => u.id === activity.user_id);
        if (user?.iconUrl) {
            const img = document.createElement("img");
            img.src = user.iconUrl;
            img.alt = `${user.displayName}のアイコン`;
            avatar.appendChild(img);
        }
        else {
            const initial = user?.displayName?.trim().charAt(0) || "?";
            avatar.textContent = initial;
        }
        const userText = document.createElement("div");
        const userName = document.createElement("div");
        userName.className = "username";
        userName.textContent = user ? user.displayName : "ユーザー";
        const userId = document.createElement("div");
        userId.className = "muted";
        userId.textContent = user ? `@${user.userId}` : "";
        userText.appendChild(userName);
        if (user)
            userText.appendChild(userId);
        userInfo.appendChild(avatar);
        userInfo.appendChild(userText);
        if (user) {
            userInfo.style.cursor = "pointer";
            userInfo.addEventListener("click", () => openProfileView(user.id));
            userInfo.tabIndex = 0;
            userInfo.addEventListener("keypress", (ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    openProfileView(user.id);
                }
            });
        }
        const book = apiBooks.find((b) => b.id === activity.book_id);
        const message = document.createElement("div");
        message.className = "content";
        const verb = activity.type === "start" ? "読み始めました" : "読了しました";
        message.textContent = `${book ? book.title : "本"}を${verb}`;
        card.appendChild(top);
        card.appendChild(userInfo);
        card.appendChild(message);
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
        currentUserBook?.reading_mode ||
        modeSelect.value ||
        "percent");
    modeSelect.value = mode;
    pagesInput.value = currentUserBook ? String(currentUserBook.total_pages_user) : "";
    pagesInput.disabled = mode !== "pages";
    pagesRow.style.display = mode === "pages" ? "grid" : "none";
    progressInput.min = "0";
    if (mode === "pages") {
        const total = currentUserBook?.total_pages_user;
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
                ? `現在: ${currentUserBook.latest_progress_value || 0} / ${currentUserBook.total_pages_user} ページ`
                : "";
    }
    else {
        modeLabel.textContent = "進度 (%)";
        latestLabel.textContent =
            currentUserBook && currentUserBook.latest_progress_percent >= 0
                ? `現在: ${clampPercent(currentUserBook.latest_progress_percent)}%`
                : "";
    }
}
function renderDetailProgress() {
    const input = qs("#detail-progress");
    const helper = qs("#detail-progress-helper");
    const mode = currentUserBook?.reading_mode || "percent";
    const total = currentUserBook?.total_pages_user;
    input.min = "0";
    if (mode === "pages") {
        input.max = total ? String(total) : "";
        input.placeholder = total ? `0〜${total} ページ` : "ページ数を入力";
        input.value = currentUserBook && total ? String(currentUserBook.latest_progress_value || 0) : "";
        helper.textContent =
            currentUserBook && total
                ? `現在: ${currentUserBook.latest_progress_value || 0} / ${total} ページ`
                : "総ページ数を設定してください";
    }
    else {
        input.max = "100";
        input.placeholder = "0〜100";
        input.value = currentUserBook ? String(clampPercent(currentUserBook.latest_progress_percent)) : "";
        helper.textContent =
            currentUserBook && currentUserBook.latest_progress_percent >= 0
                ? `現在: ${clampPercent(currentUserBook.latest_progress_percent)}%`
                : "";
    }
}
function renderCurrentBookSubtitle() {
    const subtitle = document.querySelector("#current-book-subtitle");
    if (!subtitle)
        return;
    const current = getCurrentBookId();
    const book = current ? apiBooks.find((b) => b.id === current) : null;
    const progress = currentUserBook?.latest_progress_percent;
    let progressText = "";
    if (currentUserBook) {
        if (currentUserBook.reading_mode === "pages") {
            progressText = `（進度: ${currentUserBook.latest_progress_value || 0}ページ）`;
        }
        else if (typeof progress === "number" && Number.isFinite(progress)) {
            progressText = `（進度: ${clampPercent(progress)}%）`;
        }
    }
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
    mode.textContent = `入力モード: ${currentUserBook?.reading_mode === "pages" ? "ページ" : "パーセンテージ"}`;
    const pages = document.createElement("div");
    pages.className = "muted";
    pages.textContent = currentUserBook ? `総ページ: ${currentUserBook.total_pages_user}p` : "総ページ未設定";
    meta.appendChild(title);
    meta.appendChild(author);
    meta.appendChild(mode);
    meta.appendChild(pages);
}
function updateNavVisibility() {
    const loggedIn = Boolean(getAuthToken());
    document.querySelectorAll(".nav-btn").forEach((btn) => {
        const view = btn.dataset.view;
        const shouldShow = loggedIn ? view !== "login-view" : view === "login-view";
        btn.style.display = shouldShow ? "" : "none";
    });
}
function renderAllViews() {
    renderUserArea();
    renderUserBookList("reading", "reading-list");
    renderUserBookList("finished", "finished-list");
    updateShelfDisplay();
    renderReadingLogTimeline();
    renderActivityTimeline();
    renderProfileCard();
    renderProfileForm();
    updateProgressInput();
    renderCurrentBookSubtitle();
    renderBookMeta();
    renderDetailProgress();
    updateNavVisibility();
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
        const mode = currentUserBook?.reading_mode || "percent";
        const totalPages = currentUserBook?.total_pages_user || 0;
        let progressPercent = clampPercent(rawProgress);
        let progressValue = clampInt(rawProgress);
        let progressUnit = "percent";
        if (mode === "pages") {
            if (!totalPages || totalPages <= 0) {
                errorEl.textContent = "ページ数を先に設定してください";
                return;
            }
            progressUnit = "pages";
            progressValue = clampInt(rawProgress);
            progressPercent = clampPercent((progressValue / totalPages) * 100);
        }
        if (!Number.isInteger(progressPercent) || progressPercent < 0 || progressPercent > 100) {
            errorEl.textContent = "進度は0〜100の整数で入力してください";
            return;
        }
        const contentVal = contentInput.value;
        if (progressPercent === 100) {
            const ok = confirm("進捗が100%です。読了ステータスに変更しますか？");
            if (ok) {
                try {
                    await apiPatch(`/api/user-books/${currentUserBook.id}`, {
                        status: "finished",
                        latest_progress_percent: 100,
                        latest_progress_value: currentUserBook.total_pages_user,
                    }, true);
                }
                catch (err) {
                    alert("読了への更新に失敗しました");
                    console.error(err);
                    return;
                }
            }
        }
        errorEl.textContent = "";
        try {
            await apiPost("/api/reading-logs", {
                book_id: getCurrentBookId(),
                progress_percent: progressPercent,
                progress_value: progressValue,
                progress_unit: progressUnit,
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
    const user = currentUser;
    if (!user) {
        progressInput.value = "";
        return;
    }
    const current = getCurrentBookId();
    const entry = current
        ? apiUserBooks.find((ub) => ub.user_id === user.id && ub.book_id === current)
        : undefined;
    currentUserBook = entry || null;
    if (entry) {
        if (entry.reading_mode === "pages") {
            const pages = entry.latest_progress_value || Math.round((entry.total_pages_user * entry.latest_progress_percent) / 100);
            progressInput.value = String(pages);
        }
        else {
            progressInput.value = String(clampPercent(entry.latest_progress_percent));
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
    currentUser = null;
}
async function loadApiData() {
    await restoreSession();
    apiUsers = await apiGet("/api/users");
    if (profileViewUserId) {
        const exists = apiUsers.some((u) => u.id === profileViewUserId);
        if (!exists)
            profileViewUserId = currentUser?.id ?? null;
    }
    else if (profileViewUserId === null) {
        profileViewUserId = currentUser?.id ?? null;
    }
    apiBooks = await apiGet("/api/books");
    if (!currentBookId) {
        const stored = Number(localStorage.getItem(CURRENT_BOOK_STORAGE_KEY) || "");
        if (!Number.isNaN(stored) && stored > 0)
            currentBookId = stored;
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
    apiActivityLogs = await apiGet("/api/activity-logs");
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
    const finishBtn = document.querySelector("#finish-btn");
    finishBtn?.addEventListener("click", async () => {
        if (!currentUser) {
            alert("先にログインしてください");
            return;
        }
        if (!currentUserBook) {
            helper.textContent = "先に本の設定を保存してください";
            return;
        }
        try {
            await apiPatch(`/api/user-books/${currentUserBook.id}`, { status: "finished" }, true);
            helper.textContent = "読了に変更しました";
            await loadApiData();
            renderAllViews();
            setShelfMode("finished");
            setActiveView("my-shelf-view");
        }
        catch (err) {
            helper.textContent = "読了への変更に失敗しました";
            console.error(err);
        }
    });
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!currentUser) {
            helper.textContent = "先にログインしてください";
            return;
        }
        const mode = currentUserBook?.reading_mode || "percent";
        const total = currentUserBook?.total_pages_user || Number(qs("#total-pages").value) || 0;
        const raw = Number(input.value);
        let percent = raw;
        let rawValue = clampInt(raw);
        let unit = mode === "pages" ? "pages" : "percent";
        if (mode === "pages") {
            if (!total || total <= 0) {
                helper.textContent = "先に総ページ数を設定してください";
                return;
            }
            percent = clampPercent((rawValue / total) * 100);
        }
        else {
            percent = clampPercent(raw);
            rawValue = percent;
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
            await apiPatch(`/api/user-books/${currentUserBook.id}`, { latest_progress_percent: percent, latest_progress_value: rawValue }, true);
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
    document.querySelectorAll(".shelf-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
            const mode = btn.dataset.mode === "finished" ? "finished" : "reading";
            setShelfMode(mode);
        });
    });
    const navProfileBtn = document.querySelector("#nav-profile-btn");
    if (navProfileBtn) {
        navProfileBtn.addEventListener("click", () => {
            openProfileView();
        });
    }
    const hasSession = Boolean(getAuthToken());
    const lastView = hasSession ? localStorage.getItem(LAST_VIEW_KEY) || "book-page" : "login-view";
    setActiveView(lastView);
    if (!hasSession)
        updateNavVisibility();
    renderSearchResults("");
    renderAllViews();
    setupSearchHandlers();
    setupAuthHandlers();
    renderBookSettingsHandlers();
    setupDetailProgressHandlers();
    setupFormHandlers();
    setupProfileForm();
});
