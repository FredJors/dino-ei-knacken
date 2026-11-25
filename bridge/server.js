/* ==========================================================================
   Dino-Ei-Bridge
   --------------------------------------------------------------------------
   Liest TikTok-LIVE-Events (tiktok-live-connector, inoffiziell!) und leitet
   sie per WebSocket an das Spiel weiter. Liefert außerdem das Spiel selbst
   unter http://localhost:8787/ aus (ideal für OBS-Browserquelle / LIVE Studio).

   Start:   npm start            (echter LIVE, Benutzername aus .env)
            npm run demo         (ohne TikTok: simulierte Events zum Testen)

   Protokoll (JSON über WebSocket):
     Bridge → Clients:  {type:'hello'} · {type:'tiktok', status, message, viewers, user}
                        {type:'event', event:{type, uid, name, nick, text, count, diamonds}}
                        {type:'relay', payload}   (Host-Panel ⇄ Spiel)
     Clients → Bridge:  {type:'hello', role:'game'|'panel'} · {type:'relay', payload} · {type:'ping'}
   ========================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });

/* ---------------------------- Konfiguration ---------------------------- */
const CFG = {
  user: String(process.env.TIKTOK_USERNAME || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?tiktok\.com\/@/, '').replace(/\/.*$/, ''),
  port: Number(process.env.PORT) || 8787,
  host: process.env.HOST || '127.0.0.1',            // nur lokal erreichbar
  signApiKey: process.env.SIGN_API_KEY || undefined,
  demo: process.argv.includes('--demo') || process.env.DEMO === '1',
  demoRate: Number(process.env.DEMO_RATE) || 2,      // Events pro Sekunde im Demo-Modus
  logToFile: process.env.LOG_FILE !== '0',
  retryMinMs: 5000, retryMaxMs: 120000,              // Reconnect-Backoff
  offlineRetryMs: Number(process.env.OFFLINE_RETRY_SEC || 30) * 1000,
  rateLimitRetryMs: 90000,
  gameDir: path.resolve(__dirname, '..', 'game'),
  extraOrigins: String(process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
};

/* ------------------------------- Logging ------------------------------- */
const LOG_DIR = path.join(__dirname, 'logs');
function stamp() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
function log(level, ...args) {
  const line = `[${stamp()}] ${level.padEnd(5)} ${args.map(a => (a instanceof Error ? (a.stack || a.message) : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`;
  (level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log)(line);
  if (!CFG.logToFile) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(path.join(LOG_DIR, `bridge-${new Date().toISOString().slice(0, 10)}.log`), line + '\n');
  } catch { /* Logdatei ist optional */ }
}
process.on('uncaughtException', err => log('ERROR', 'Unerwarteter Fehler (Bridge läuft weiter):', err));
process.on('unhandledRejection', err => log('ERROR', 'Unbehandeltes Promise (Bridge läuft weiter):', err));

/* ---------------------- HTTP: Spiel ausliefern ------------------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, tiktok, clients: clientCount(), demo: CFG.demo, avatars: { known: avatarUrls.size, cached: avatarCache.size } }));
    }
    if (url.pathname.startsWith('/avatar/') && req.method === 'GET') {
      let uid = ''; try { uid = decodeURIComponent(url.pathname.slice(8)).slice(0, 64); } catch { /* ungültig */ }
      return void serveAvatar(uid, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(CFG.gameDir, '.' + path.posix.normalize(rel));
    if (!file.startsWith(CFG.gameDir + path.sep) && file !== CFG.gameDir) { res.writeHead(403); return res.end('Verboten'); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Nicht gefunden'); }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': /^\.(jpe?g|webp|png)$/.test(ext) ? 'max-age=3600' : 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  } catch (err) {
    log('WARN', 'HTTP-Fehler:', err.message);
    try { res.writeHead(400); res.end(); } catch { /* egal */ }
  }
});

/* --------------------------- Profilbilder ------------------------------ */
// TikTok liefert pro Event Bild-Links des Nutzers. Die Links laufen ab und laden nicht
// immer direkt im Browser → die Bridge lädt das Bild selbst, hält es im Speicher und
// liefert es unter /avatar/<uid> aus. Es werden NUR Links aus TikTok-Events geladen.
const avatarUrls = new Map();    // uid → [https-Links]
const avatarCache = new Map();   // uid → { buf, type } oder { failAt }
const avatarPending = new Map(); // uid → Promise (doppelte Downloads vermeiden)
const AVATAR_MAX_BYTES = 600 * 1024;

function rememberAvatar(uid, user) {
  const pic = user && (user.avatarThumb || user.avatarMedium || user.profilePicture || user.avatarLarge);
  const list = pic && (pic.urlList || pic.url || pic.mUrls || pic.urls);
  const urls = (Array.isArray(list) ? list : []).filter(u => typeof u === 'string' && u.startsWith('https://')).slice(0, 4);
  if (!urls.length) return avatarUrls.has(uid);
  avatarUrls.delete(uid); avatarUrls.set(uid, urls);            // neuester Eintrag hinten (LRU)
  if (avatarUrls.size > 5000) avatarUrls.delete(avatarUrls.keys().next().value);
  return true;
}

function demoAvatarSvg(uid) {
  let h = 0; for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360, hair = (hue + 140) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
    `<rect width="96" height="96" fill="hsl(${hue},70%,72%)"/><circle cx="48" cy="104" r="40" fill="hsl(${hue},45%,40%)"/>` +
    `<circle cx="48" cy="46" r="22" fill="#f6d2b4"/><path d="M26 44 Q48 10 70 44 Q60 30 48 30 Q36 30 26 44Z" fill="hsl(${hair},55%,35%)"/>` +
    `<circle cx="40" cy="47" r="3" fill="#2b1d3a"/><circle cx="56" cy="47" r="3" fill="#2b1d3a"/>` +
    `<path d="M40 56 Q48 62 56 56" stroke="#2b1d3a" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`;
}

async function fetchAvatar(uid) {
  for (const link of avatarUrls.get(uid) || []) {
    try {
      const r = await fetch(link, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', Referer: 'https://www.tiktok.com/' }, signal: AbortSignal.timeout(6000) });
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !type.startsWith('image/')) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length || buf.length > AVATAR_MAX_BYTES) continue;
      return { buf, type };
    } catch { /* nächster Link */ }
  }
  return null;
}

async function serveAvatar(uid, res) {
  const head = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' };
  const notFound = () => { res.writeHead(404, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); res.end(); };
  try {
    if (!uid) return notFound();
    if (CFG.demo && uid.startsWith('demo')) { res.writeHead(200, { ...head, 'Content-Type': 'image/svg+xml' }); return res.end(demoAvatarSvg(uid)); }
    let c = avatarCache.get(uid);
    if (c && c.failAt && Date.now() - c.failAt > 5 * 60000) { avatarCache.delete(uid); c = null; }   // nach 5 min neu versuchen
    if (!c) {
      if (!avatarUrls.has(uid)) return notFound();
      let p = avatarPending.get(uid);
      if (!p) { p = fetchAvatar(uid).finally(() => avatarPending.delete(uid)); avatarPending.set(uid, p); }
      const got = await p;
      c = got || { failAt: Date.now() };
      avatarCache.set(uid, c);
      if (avatarCache.size > 600) avatarCache.delete(avatarCache.keys().next().value);
    }
    if (!c.buf) return notFound();
    res.writeHead(200, { ...head, 'Content-Type': c.type });
    res.end(c.buf);
  } catch (err) {
    log('WARN', 'Profilbild-Fehler:', err.message);
    try { notFound(); } catch { /* egal */ }
  }
}

/* ------------------------- WebSocket-Server ---------------------------- */
// Nur lokale Seiten, file:// und GitHub Pages dürfen sich verbinden (Schutz vor fremden Webseiten).
function originAllowed(origin) {
  if (!origin || origin === 'null' || origin.startsWith('file://')) return true;
  try {
    const u = new URL(origin);
    if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return true;
    if (u.hostname.endsWith('.github.io')) return true;
  } catch { return false; }
  return CFG.extraOrigins.includes(origin);
}
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 * 1024, verifyClient: info => {
  const ok = originAllowed(info.origin);
  if (!ok) log('WARN', 'Verbindung abgelehnt von Origin', info.origin);
  return ok;
} });
const clientCount = () => [...wss.clients].filter(c => c.readyState === 1).length;
function send(ws, obj) { if (ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (err) { log('WARN', 'Senden fehlgeschlagen:', err.message); } } }
function broadcast(obj, except) { const s = JSON.stringify(obj); for (const c of wss.clients) if (c !== except && c.readyState === 1) { try { c.send(s); } catch { /* egal */ } } }

wss.on('connection', (ws, req) => {
  ws.role = 'unbekannt'; ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  send(ws, { type: 'hello', server: 'dino-ei-bridge', demo: CFG.demo });
  send(ws, { type: 'tiktok', ...tiktok });
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello') { ws.role = msg.role === 'panel' ? 'panel' : 'game'; log('INFO', `Client verbunden: ${ws.role} (${clientCount()} aktiv)`); }
    else if (msg.type === 'relay' && msg.payload) broadcast({ type: 'relay', payload: msg.payload }, ws);
    else if (msg.type === 'ping') send(ws, { type: 'pong', t: Date.now() });
  });
  ws.on('close', () => log('INFO', `Client getrennt: ${ws.role} (${clientCount()} aktiv)`));
  ws.on('error', err => log('WARN', 'WebSocket-Fehler:', err.message));
});
// Tote Verbindungen aufräumen
setInterval(() => { for (const c of wss.clients) { if (!c.isAlive) { c.terminate(); continue; } c.isAlive = false; try { c.ping(); } catch { /* egal */ } } }, 30000).unref();

/* ----------------------------- Events ---------------------------------- */
const recentMsgIds = new Set();
function dedupe(d) {
  const id = d && d.common && (d.common.msgId || d.common.msg_id);
  if (!id) return false;
  const key = String(id);
  if (recentMsgIds.has(key)) return true;
  recentMsgIds.add(key);
  if (recentMsgIds.size > 2000) recentMsgIds.delete(recentMsgIds.values().next().value);
  return false;
}
// Feldnamen unterscheiden sich je nach Bibliotheks-/Protokollversion → mehrere Varianten prüfen
function userOf(d) {
  const u = (d && d.user) || {};
  const uniqueId = u.uniqueId || u.displayId || u.unique_id || '';
  const nick = u.nickname || u.nickName || '';
  const uid = String(u.userId || u.id || uniqueId || nick || '');
  return { uid, name: uniqueId || nick, nick };
}
let eventCount = 0;
function forward(type, d, extra = {}) {
  if (dedupe(d)) return;
  const u = userOf(d);
  if (!u.uid) return;
  eventCount++;
  const avatar = rememberAvatar(u.uid, d && d.user) ? 1 : 0;   // Spiel lädt Bild bei Bedarf über /avatar/<uid>
  broadcast({ type: 'event', event: { type, ...u, avatar, ...extra } });
}

/* ------------------------ TikTok-Verbindung ---------------------------- */
let tiktok = { status: CFG.demo ? 'Demo' : 'getrennt', message: '', viewers: null, user: CFG.user };
let conn = null, attempt = 0, retryTimer = null, connecting = false, shuttingDown = false, lastViewerBroadcast = 0;

function setStatus(status, message = '') {
  tiktok = { ...tiktok, status, message };
  broadcast({ type: 'tiktok', ...tiktok });
  log(status === 'verbunden' ? 'INFO' : 'WARN', `TikTok: ${status}${message ? ' – ' + message : ''}`);
}

function scheduleReconnect(reason, delayMs) {
  if (shuttingDown || retryTimer) return;
  attempt++;
  const backoff = Math.min(CFG.retryMaxMs, CFG.retryMinMs * Math.pow(2, attempt - 1));
  const delay = Math.round((delayMs != null ? delayMs : backoff) + Math.random() * 1500);
  setStatus(tiktok.status === 'verbunden' ? 'getrennt' : tiktok.status, `${reason} – neuer Versuch in ${Math.round(delay / 1000)} s`);
  retryTimer = setTimeout(() => { retryTimer = null; connectTikTok(); }, delay);
}

function disposeConnection() {
  if (!conn) return;
  const old = conn; conn = null;
  try { old.removeAllListeners(); } catch { /* egal */ }
  old.disconnect().catch(() => {});
}

async function connectTikTok() {
  if (shuttingDown || connecting) return;
  if (!CFG.user) { setStatus('kein Benutzername', 'TIKTOK_USERNAME in bridge/.env eintragen und Bridge neu starten'); return; }
  connecting = true;
  disposeConnection();
  setStatus('verbinde…', `@${CFG.user}`);
  try {
    conn = new TikTokLiveConnection(CFG.user, {
      signApiKey: CFG.signApiKey,
      processInitialData: false,          // keine alten Chat-Nachrichten nachspielen
      // AUS: die Geschenkliste braucht beim Signatur-Server einen kostenpflichtigen Plan und
      // ließ sonst die ganze Verbindung scheitern. Diamantwerte stecken ohnehin in jedem Gift-Event.
      enableExtendedGiftInfo: false,
      fetchRoomInfoOnConnect: true,
    });
    attachHandlers(conn);
    const state = await conn.connect();
    attempt = 0;
    setStatus('verbunden', `@${CFG.user} · Raum ${state.roomId}`);
  } catch (err) {
    handleConnectError(err);
  } finally {
    connecting = false;
  }
}

function handleConnectError(err) {
  const name = (err && (err.constructor && err.constructor.name)) || (err && err.name) || 'Error';
  const msg = (err && err.message) || String(err);
  log('WARN', `Verbindung fehlgeschlagen (${name}): ${msg}`);
  // Falls schon ein (allgemeiner) Retry durch "disconnected" geplant ist: durch den passenden ersetzen
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; attempt = Math.max(0, attempt - 1); }
  if (name === 'UserOfflineError' || /offline|not live|isn't online|LIVE has ended/i.test(msg)) {
    tiktok.status = 'nicht live';
    scheduleReconnect(`@${CFG.user} ist gerade nicht live`, CFG.offlineRetryMs);
  } else if (/room ?id/i.test(msg)) {
    // häufigster Fall vor dem Livegang: kein laufender LIVE gefunden
    tiktok.status = 'kein LIVE gefunden';
    scheduleReconnect(`Kein laufender LIVE von @${CFG.user} (noch nicht live oder Name falsch?)`, CFG.offlineRetryMs);
  } else if (name === 'SignatureRateLimitError' || /rate ?limit|too many requests|429/i.test(msg)) {
    tiktok.status = 'Rate-Limit';
    scheduleReconnect('Signatur-Server-Limit erreicht (ggf. SIGN_API_KEY eintragen)', CFG.rateLimitRetryMs);
  } else if (name === 'InvalidUniqueIdError') {
    tiktok.status = 'Name ungültig';
    scheduleReconnect('Benutzername ungültig – bitte .env prüfen', 5 * 60000);
  } else if (name === 'AlreadyConnectedError' || name === 'AlreadyConnectingError') {
    log('INFO', 'Verbindung besteht bereits.');
  } else {
    tiktok.status = 'Fehler';
    scheduleReconnect(msg.slice(0, 120));
  }
}

function attachHandlers(c) {
  c.on(ControlEvent.DISCONNECTED, info => {
    if (shuttingDown || c !== conn) return;
    tiktok.status = 'getrennt';
    scheduleReconnect(`Verbindung getrennt${info && info.reason ? ' (' + info.reason + ')' : ''}`);
  });
  c.on(ControlEvent.ERROR, e => log('WARN', 'TikTok-Fehler:', (e && e.info) || '', (e && e.exception && e.exception.message) || ''));
  c.on(WebcastEvent.STREAM_END, () => {
    if (c !== conn) return;
    tiktok.status = 'Stream beendet';
    disposeConnection();
    scheduleReconnect('LIVE wurde beendet', CFG.offlineRetryMs);
  });
  c.on(WebcastEvent.CHAT, d => forward('chat', d, { text: String((d && (d.comment != null ? d.comment : d.content)) || '').slice(0, 200) }));
  c.on(WebcastEvent.LIKE, d => forward('like', d, { count: Number(d && (d.likeCount != null ? d.likeCount : d.count)) || 1 }));
  c.on(WebcastEvent.FOLLOW, d => forward('follow', d));
  c.on(WebcastEvent.SHARE, d => forward('share', d));
  c.on(WebcastEvent.MEMBER, d => forward('member', d));
  c.on(WebcastEvent.GIFT, d => {
    const g = (d && d.giftDetails) || {};
    const giftType = g.giftType != null ? g.giftType : g.type;
    if (giftType === 1 && !d.repeatEnd) return;            // Serie läuft noch → erst das Ende zählen
    const repeat = Number(d.repeatCount) || 1;
    const per = Number(g.diamondCount != null ? g.diamondCount : (d.extendedGiftInfo && (d.extendedGiftInfo.diamond_count || d.extendedGiftInfo.diamondCount))) || 1;
    forward('gift', d, { diamonds: per * repeat, count: repeat });
  });
  c.on(WebcastEvent.ROOM_USER, d => {
    const v = Number(d && d.viewerCount);
    if (!isFinite(v)) return;
    tiktok.viewers = v;
    if (Date.now() - lastViewerBroadcast > 10000) { lastViewerBroadcast = Date.now(); broadcast({ type: 'tiktok', ...tiktok }); }
  });
}

/* ------------------------- Demo-Modus (ohne TikTok) -------------------- */
function startDemo() {
  const names = ['dino_fan', 'lena.live', 'max_123', 'rawr_tim', 'eiknacker', 'mia2010', 'spino_sam', 'trici_tina', 'paul_hh', 'zoe_offiziell', 'fuck_test99', 'nestbau_ben'];
  setStatus('Demo', 'simulierte Events – kein echter LIVE');
  setInterval(() => {
    const n = Math.random() < CFG.demoRate % 1 ? Math.ceil(CFG.demoRate) : Math.floor(CFG.demoRate);
    for (let i = 0; i < n; i++) {
      const k = Math.floor(Math.random() * names.length), r = Math.random();
      const base = { uid: 'demo' + k, name: names[k], nick: names[k], avatar: k % 4 === 3 ? 0 : 1 };   // jeder 4. ohne Bild (Fallback testen)
      const ev = r < 0.62 ? { type: 'chat', text: Math.random() < 0.2 ? String(1 + Math.floor(Math.random() * 2)) : 'hallo' }
        : r < 0.93 ? { type: 'like', count: 1 + Math.floor(Math.random() * 15) }
        : r < 0.96 ? { type: 'share' } : r < 0.985 ? { type: 'follow' } : { type: 'gift', diamonds: [1, 5, 10, 99][Math.floor(Math.random() * 4)] };
      eventCount++;
      broadcast({ type: 'event', event: { ...base, ...ev } });
    }
  }, 1000);
}

/* -------------------------------- Start -------------------------------- */
server.on('error', err => {
  if (err.code === 'EADDRINUSE') log('ERROR', `Port ${CFG.port} ist belegt – läuft die Bridge schon? Sonst PORT in .env ändern (und im Spiel ?bridge=ws://localhost:PORT anhängen).`);
  else log('ERROR', 'Serverfehler:', err);
  process.exit(1);
});
server.listen(CFG.port, CFG.host, () => {
  log('INFO', '──────────────────────────────────────────────');
  log('INFO', 'Dino-Ei-Bridge läuft');
  log('INFO', `Spiel:      http://localhost:${CFG.port}/`);
  log('INFO', `Host-Panel: http://localhost:${CFG.port}/?panel`);
  log('INFO', `WebSocket:  ws://localhost:${CFG.port}`);
  log('INFO', CFG.demo ? 'Modus:      DEMO (simulierte Events)' : `TikTok:     @${CFG.user || '(kein Name – .env prüfen!)'}`);
  log('INFO', '──────────────────────────────────────────────');
  if (CFG.demo) startDemo(); else connectTikTok();
});
setInterval(() => { if (eventCount) { log('INFO', `${eventCount} Events weitergeleitet (letzte Minute), ${clientCount()} Client(s)`); eventCount = 0; } }, 60000).unref();

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('INFO', 'Bridge wird beendet …');
  clearTimeout(retryTimer);
  disposeConnection();
  for (const c of wss.clients) { try { c.close(1001, 'Bridge beendet'); } catch { /* egal */ } }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
