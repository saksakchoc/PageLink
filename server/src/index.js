import express from "express";
import cors from "cors";
import crypto from "crypto";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || "./data/app.db";

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

function migrateUsersIfNeeded() {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  if (cols.length === 0) return; // table not created yet
  const hasUsername = cols.some((c) => c.name === "username");
  const emailNotNull = cols.find((c) => c.name === "email")?.notnull === 1;
  if (hasUsername && !emailNotNull) return;

  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        username TEXT UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );
    `);
    db.exec(`
      INSERT INTO users_new (id, email, username, display_name, password_hash)
      SELECT id, email, COALESCE(username, replace(email, '@', '_')), display_name, password_hash FROM users;
    `);
    db.exec("DROP TABLE users;");
    db.exec("ALTER TABLE users_new RENAME TO users;");
  });
  tx();
}

function migrateUserBooksIfNeeded() {
  const cols = db.prepare("PRAGMA table_info(user_books)").all();
  if (cols.length === 0) return;
  const hasReadingMode = cols.some((c) => c.name === "reading_mode");
  if (!hasReadingMode) {
    db.exec("ALTER TABLE user_books ADD COLUMN reading_mode TEXT NOT NULL DEFAULT 'percent'");
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  language TEXT,
  total_pages_isbn INTEGER
);
CREATE TABLE IF NOT EXISTS user_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  total_pages_user INTEGER NOT NULL,
  status TEXT NOT NULL,
  latest_progress_percent INTEGER NOT NULL DEFAULT 0,
  reading_mode TEXT NOT NULL DEFAULT 'percent'
);
CREATE TABLE IF NOT EXISTS reading_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  progress_percent INTEGER NOT NULL,
  content TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reading_log_id INTEGER NOT NULL REFERENCES reading_logs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
`);

// add username column/index if missing
const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userCols.includes("username")) {
  db.exec("ALTER TABLE users ADD COLUMN username TEXT");
}
// migrate email NOT NULL -> NULL if必要
migrateUsersIfNeeded();
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)");
migrateUserBooksIfNeeded();

// seed data
const seedUserCount = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
if (seedUserCount === 0) {
  const pw = crypto.createHash("sha256").update("password").digest("hex");
  db.prepare("INSERT INTO users (email, username, display_name, password_hash) VALUES (?, ?, ?, ?)").run(
    "demo@example.com",
    "demo",
    "デモユーザー",
    pw,
  );
}
// backfill username if null
db.exec("UPDATE users SET username = COALESCE(username, replace(email, '@', '_'))");

const insertBook = db.prepare(
  "INSERT OR IGNORE INTO books (id, title, author, language, total_pages_isbn) VALUES (?, ?, ?, ?, ?)",
);
insertBook.run(101, "\u7363\u306e\u594f\u8005 I \u95d8\u86c7\u7de8", "\u4e0a\u6a4b\u83dc\u7a42\u5b50", "ja", 432);
insertBook.run(102, "\u7363\u306e\u594f\u8005 II \u738b\u7363\u7de8", "\u4e0a\u6a4b\u83dc\u7a42\u5b50", "ja", 456);
insertBook.run(103, "\u7363\u306e\u594f\u8005 III \u63a2\u6c42\u7de8", "\u4e0a\u6a4b\u83dc\u7a42\u5b50", "ja", 480);
insertBook.run(104, "\u7363\u306e\u594f\u8005 IV \u5b8c\u7d50\u7de8", "\u4e0a\u6a4b\u83dc\u7a42\u5b50", "ja", 520);
insertBook.run(105, "\u7363\u306e\u594f\u8005 \u5916\u4f1d \u5239\u90a3", "\u4e0a\u6a4b\u83dc\u7a42\u5b50", "ja", 240);


const tokens = new Map(); // token -> userId

const demoUser = db.prepare("SELECT id FROM users WHERE username = ?").get("demo");
if (demoUser) {
  db.prepare(
    "INSERT OR IGNORE INTO user_books (user_id, book_id, total_pages_user, status, latest_progress_percent, reading_mode) VALUES (?, ?, ?, 'reading', 0, 'percent')",
  ).run(demoUser.id, 101, 432);
}

function hashPassword(pw) {
  return crypto.createHash("sha256").update(pw).digest("hex");
}

function issueToken(userId) {
  const token = crypto.randomUUID();
  tokens.set(token, userId);
  return token;
}

function findUserByUsername(username) {
  return db.prepare("SELECT id, username, email, display_name, password_hash FROM users WHERE username = ?").get(username);
}

function getUserFromToken(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const uid = tokens.get(token);
  if (!uid) return null;
  return db.prepare("SELECT id, username, display_name FROM users WHERE id = ?").get(uid) || null;
}

function authMiddleware(req, res, next) {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  req.user = user;
  next();
}

function computeSpoilerWindowPercent(bookId) {
  const basePercent = 5;
  const minPages = 5;
  const maxPages = 20;
  const book = db.prepare("SELECT total_pages_isbn FROM books WHERE id = ?").get(bookId);
  const fallback = db.prepare("SELECT total_pages_user FROM user_books WHERE book_id = ? LIMIT 1").get(bookId);
  const totalPages = (book?.total_pages_isbn || fallback?.total_pages_user);
  if (!totalPages || totalPages <= 0) return basePercent;
  const basePages = totalPages * (basePercent / 100);
  if (basePages < minPages) return Math.ceil((minPages / totalPages) * 100);
  if (basePages > maxPages) return Math.floor((maxPages / totalPages) * 100);
  return basePercent;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Auth
app.post("/api/auth/signup", (req, res) => {
  const { userId, password, displayName } = req.body || {};
  if (!userId || !password || !displayName)
    return res.status(400).json({ error: "userId, password, displayName are required" });
  const exists = findUserByUsername(userId);
  if (exists) return res.status(409).json({ error: "userId already exists" });
  try {
    const passwordHash = hashPassword(password);
    const result = db
      .prepare("INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)")
      .run(userId, displayName, passwordHash);
    const user = { id: result.lastInsertRowid, userId, displayName };
    const token = issueToken(user.id);
    res.status(201).json({ token, user });
  } catch (err) {
    console.error("signup error", err);
    res.status(500).json({ error: "failed to signup" });
  }
});

app.post("/api/auth/login", (req, res) => {
  const { userId, password } = req.body || {};
  if (!userId || !password) return res.status(400).json({ error: "userId and password are required" });
  const userRow = findUserByUsername(userId);
  if (!userRow || userRow.password_hash !== hashPassword(password)) return res.status(401).json({ error: "invalid credentials" });
  const user = { id: userRow.id, userId: userRow.username, displayName: userRow.display_name };
  const token = issueToken(user.id);
  res.json({ token, user });
});

app.get("/api/auth/me", (req, res) => {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: "unauthorized" });
  res.json({ id: user.id, userId: user.username, displayName: user.display_name || user.displayName });
});

// Users
app.get("/api/users", (_req, res) => {
  const rows = db.prepare("SELECT id, username, display_name FROM users").all();
  res.json(rows.map((u) => ({ id: u.id, userId: u.username, displayName: u.display_name })));
});

// Books
app.get("/api/books", (_req, res) => {
  res.json(db.prepare("SELECT * FROM books").all());
});

app.get("/api/books/:id", (req, res) => {
  const book = db.prepare("SELECT * FROM books WHERE id = ?").get(Number(req.params.id));
  if (!book) return res.status(404).json({ error: "book not found" });
  res.json(book);
});

app.post("/api/books", (req, res) => {
  const { id, title, author, language, total_pages_isbn } = req.body || {};
  if (!title || !author) return res.status(400).json({ error: "title and author are required" });
  const result = db
    .prepare("INSERT INTO books (id, title, author, language, total_pages_isbn) VALUES (?, ?, ?, ?, ?)")
    .run(id || null, title, author, language, total_pages_isbn || null);
  const book = db.prepare("SELECT * FROM books WHERE rowid = ?").get(result.lastInsertRowid);
  res.status(201).json(book);
});

// UserBooks
app.get("/api/user-books", (req, res) => {
  const userId = Number(req.query.userId);
  const stmt = userId
    ? db.prepare("SELECT * FROM user_books WHERE user_id = ?")
    : db.prepare("SELECT * FROM user_books");
  res.json(userId ? stmt.all(userId) : stmt.all());
});

app.post("/api/user-books", authMiddleware, (req, res) => {
  const { book_id, total_pages_user, status = "reading", reading_mode = "percent" } = req.body || {};
  if (!book_id || !total_pages_user) {
    return res.status(400).json({ error: "book_id and total_pages_user are required" });
  }
  const result = db
    .prepare(
      "INSERT INTO user_books (user_id, book_id, total_pages_user, status, latest_progress_percent, reading_mode) VALUES (?, ?, ?, ?, 0, ?)",
    )
    .run(req.user.id, book_id, total_pages_user, status, reading_mode);
  const ub = db.prepare("SELECT * FROM user_books WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(ub);
});

app.patch("/api/user-books/:id", authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const ub = db.prepare("SELECT * FROM user_books WHERE id = ?").get(id);
  if (!ub) return res.status(404).json({ error: "userBook not found" });
  if (ub.user_id !== req.user.id) return res.status(403).json({ error: "forbidden" });
  const { status, latest_progress_percent, total_pages_user, reading_mode } = req.body || {};
  const newStatus = status || ub.status;
  const newProgress = Number.isFinite(latest_progress_percent)
    ? latest_progress_percent
    : ub.latest_progress_percent;
  const newTotal = Number.isFinite(total_pages_user) ? total_pages_user : ub.total_pages_user;
  const newMode = reading_mode || ub.reading_mode;
  db.prepare(
    "UPDATE user_books SET status = ?, latest_progress_percent = ?, total_pages_user = ?, reading_mode = ? WHERE id = ?",
  ).run(newStatus, newProgress, newTotal, newMode, id);
  const updated = db.prepare("SELECT * FROM user_books WHERE id = ?").get(id);
  res.json(updated);
});

// ReadingLogs
app.get("/api/reading-logs", (req, res) => {
  const userId = req.query.userId ? Number(req.query.userId) : null;
  const bookId = req.query.bookId ? Number(req.query.bookId) : null;
  const viewerUserId = req.query.viewerUserId ? Number(req.query.viewerUserId) : null;

  let query = "SELECT * FROM reading_logs WHERE 1=1";
  const params = [];
  if (userId) {
    query += " AND user_id = ?";
    params.push(userId);
  }
  if (bookId) {
    query += " AND book_id = ?";
    params.push(bookId);
  }
  query += " ORDER BY created_at DESC";
  let result = db.prepare(query).all(...params);

  if (viewerUserId && bookId) {
    const spoiler = computeSpoilerWindowPercent(bookId);
    const progressEntry = db
      .prepare("SELECT latest_progress_percent FROM user_books WHERE user_id = ? AND book_id = ?")
      .get(viewerUserId, bookId);
    const viewerProgress = progressEntry ? progressEntry.latest_progress_percent : null;
    const allowedMax =
      viewerProgress !== null && viewerProgress !== undefined ? Math.max(viewerProgress - spoiler, 0) : null;

    result = result.filter((l) => {
      if (l.book_id !== bookId) return false;
      if (l.user_id === viewerUserId) return true;
      if (l.visibility !== "public") return false;
      if (allowedMax === null) return false;
      return l.progress_percent <= allowedMax;
    });
  }

  res.json(result);
});

app.post("/api/reading-logs", authMiddleware, (req, res) => {
  const { book_id, progress_percent, content, visibility = "public" } = req.body || {};
  if (!book_id || progress_percent === undefined || progress_percent === null) {
    return res.status(400).json({ error: "book_id and progress_percent are required" });
  }
  const progress = Math.max(0, Math.min(100, Math.trunc(progress_percent)));
  const createdAt = new Date().toISOString();
  const result = db
    .prepare(
      "INSERT INTO reading_logs (user_id, book_id, progress_percent, content, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(req.user.id, book_id, progress, content || "", visibility, createdAt);
  const log = db.prepare("SELECT * FROM reading_logs WHERE id = ?").get(result.lastInsertRowid);

  // update/create user_book progress
  const ub = db
    .prepare("SELECT * FROM user_books WHERE user_id = ? AND book_id = ?")
    .get(req.user.id, book_id);
  if (ub) {
    db.prepare("UPDATE user_books SET latest_progress_percent = ? WHERE id = ?").run(progress, ub.id);
  } else {
    const book = db.prepare("SELECT total_pages_isbn FROM books WHERE id = ?").get(book_id);
    const totalPages = book?.total_pages_isbn || 100;
    db.prepare(
      "INSERT INTO user_books (user_id, book_id, total_pages_user, status, latest_progress_percent, reading_mode) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(req.user.id, book_id, totalPages, "reading", progress, "percent");
  }

  res.status(201).json(log);
});

// Likes
app.get("/api/likes", (req, res) => {
  const userId = req.query.userId ? Number(req.query.userId) : null;
  const stmt = userId
    ? db.prepare("SELECT * FROM likes WHERE user_id = ?")
    : db.prepare("SELECT * FROM likes");
  res.json(userId ? stmt.all(userId) : stmt.all());
});

app.post("/api/likes", authMiddleware, (req, res) => {
  const { reading_log_id } = req.body || {};
  if (!reading_log_id) return res.status(400).json({ error: "reading_log_id is required" });
  const exists = db
    .prepare("SELECT * FROM likes WHERE user_id = ? AND reading_log_id = ?")
    .get(req.user.id, reading_log_id);
  if (exists) return res.status(200).json(exists);
  const createdAt = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO likes (user_id, reading_log_id, created_at) VALUES (?, ?, ?)")
    .run(req.user.id, reading_log_id, createdAt);
  const like = db.prepare("SELECT * FROM likes WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(like);
});

app.delete("/api/likes/:id", authMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const like = db.prepare("SELECT * FROM likes WHERE id = ?").get(id);
  if (!like) return res.status(404).json({ error: "like not found" });
  if (like.user_id !== req.user.id) return res.status(403).json({ error: "forbidden" });
  db.prepare("DELETE FROM likes WHERE id = ?").run(id);
  res.status(204).end();
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API server listening on port ${PORT}`);
});
