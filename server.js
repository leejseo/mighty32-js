const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const RECORDS_FILE = path.join(DATA_DIR, "games.jsonl");
const PORT = Number(process.env.PORT || 4173);
const MAX_BODY_BYTES = 128 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
};

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(RECORDS_FILE)) {
  fs.writeFileSync(RECORDS_FILE, "");
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/records") {
      await handleRecords(request, response);
      return;
    }
    serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, 500, { error: "internal_error", message: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Mighty32 Lite server: http://127.0.0.1:${PORT}/`);
  console.log(`Records file: ${path.relative(ROOT, RECORDS_FILE)}`);
});

async function handleRecords(request, response) {
  if (request.method === "GET") {
    sendJson(response, 200, { records: readRecords() });
    return;
  }

  if (request.method === "POST") {
    const body = await readBody(request);
    const record = JSON.parse(body || "{}");
    const normalized = normalizeRecord(record);
    fs.appendFileSync(RECORDS_FILE, `${JSON.stringify(normalized)}\n`);
    sendJson(response, 201, { ok: true, record: normalized });
    return;
  }

  if (request.method === "DELETE") {
    fs.writeFileSync(RECORDS_FILE, "");
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 405, { error: "method_not_allowed" });
}

function readRecords() {
  const content = fs.readFileSync(RECORDS_FILE, "utf8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt))
    .slice(0, 100);
}

function normalizeRecord(record) {
  return {
    endedAt: String(record.endedAt || new Date().toISOString()),
    declarer: String(record.declarer || ""),
    declarerIndex: Number(record.declarerIndex ?? -1),
    humanDeclarer: Boolean(record.humanDeclarer),
    friend: String(record.friend || ""),
    friendCard: String(record.friendCard || ""),
    trump: String(record.trump || ""),
    target: Number(record.target || 0),
    points: Number(record.points || 0),
    success: Boolean(record.success),
    humanSideWon: Boolean(record.humanSideWon),
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error("request_body_too_large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function serveStatic(pathname, response) {
  const safePath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(ROOT, safePath));
  if (!filePath.startsWith(ROOT)) {
    sendText(response, 403, "Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(response, 404, "Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(response);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, status, text) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(text);
}
