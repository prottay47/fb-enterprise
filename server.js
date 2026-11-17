/**
 * F B Group website server
 * ------------------------
 * Serves the public website, the admin dashboard (/admin) and a small JSON
 * API for managing the homepage banner slider. No npm packages needed.
 *
 * Environment variables
 *   PORT            Port to listen on (default 3000)
 *   ADMIN_USERNAME  Dashboard username (default: admin)
 *   ADMIN_PASSWORD  Dashboard password. The dashboard stays locked until set.
 *   DATA_DIR        Where uploaded banners are kept (default ./data).
 *                   Mount this as a persistent volume in production.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { PRODUCT_TYPES, renderPage } = require('./product-render');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const BANNERS_FILE = path.join(DATA_DIR, 'banners.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const PRODUCTS_SEED = path.join(ROOT, 'products.seed.json');
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const MAX_BANNERS = 5;
const MAX_PRODUCTS = 30;                     // per type (stone, sand)
const MAX_LIST_ITEMS = 5;                    // sizes / FM values per product
const MAX_PRODUCT_IMAGE = 4 * 1024 * 1024;
const MAX_BODY = 14 * 1024 * 1024;          // JSON body with two base64 images
const MAX_IMAGE = 8 * 1024 * 1024;          // decoded large image
const MAX_IMAGE_SMALL = 3 * 1024 * 1024;    // decoded mobile image
const MAX_IMAGE_PHONE = 4 * 1024 * 1024;    // decoded portrait phone version
const SESSION_TTL = 12 * 60 * 60 * 1000;    // 12 hours

/** Shown on the homepage whenever no banner has been uploaded. */
const DEFAULT_BANNERS = [
  { id: 'default-1', src: '/images/banners/default-1.jpg', srcSmall: '/images/banners/default-1-1000.jpg', srcPhone: '/images/banners/default-1-phone.webp', alt: 'Bulk carrier discharging stone aggregate into a lighter vessel', focusX: 55, focusY: 50 },
  { id: 'default-2', src: '/images/banners/default-2.jpg', srcSmall: '/images/banners/default-2-1000.jpg', srcPhone: '/images/banners/default-2-phone.webp', alt: 'Excavator unloading stone aggregate from a barge into a dump truck at a river ghat', focusX: 62, focusY: 50 },
  { id: 'default-3', src: '/images/banners/default-3.jpg', srcSmall: '/images/banners/default-3-1000.jpg', srcPhone: '/images/banners/default-3-phone.webp', alt: 'Floating crane transferring aggregate from a mother vessel to a lighter vessel', focusX: 58, focusY: 50 },
];

/* ------------------------------------------------------------------ */
/* Static files                                                        */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.txt', '.xml', '.svg']);

// Only these parts of the project are public. Server code, data and config are never served.
const PUBLIC_DIRS = ['css/', 'js/', 'images/', 'admin/'];
const PUBLIC_FILES = new Set(['index.html', 'robots.txt', 'sitemap.xml']);

function isPublic(rel) {
  if (rel.split('/').some((part) => part.startsWith('.'))) return false;
  return PUBLIC_FILES.has(rel) || PUBLIC_DIRS.some((d) => rel.startsWith(d));
}

function baseHeaders(extra) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    ...extra,
  };
}

async function sendFile(req, res, filePath, cacheControl, extraHeaders = {}) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers = baseHeaders({
    'Content-Type': type,
    'Cache-Control': cacheControl,
    'Last-Modified': stat.mtime.toUTCString(),
    ETag: etag,
    'Accept-Ranges': 'bytes',
    ...extraHeaders,
  });

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }

  // Byte ranges (needed for video playback, especially on iOS)
  const range = req.headers.range;
  if (range && /^bytes=\d*-\d*$/.test(range)) {
    let [start, end] = range.slice(6).split('-');
    start = start === '' ? null : Number(start);
    end = end === '' ? null : Number(end);
    if (start === null) { start = Math.max(stat.size - end, 0); end = stat.size - 1; }
    if (end === null || end >= stat.size) end = stat.size - 1;
    if (start > end || start >= stat.size) {
      res.writeHead(416, baseHeaders({ 'Content-Range': `bytes */${stat.size}` }));
      res.end();
      return true;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') { res.end(); return true; }
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return true;
  }

  const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (gzip) {
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  } else {
    headers['Content-Length'] = stat.size;
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  const stream = fs.createReadStream(filePath);
  (gzip ? stream.pipe(zlib.createGzip({ level: 6 })) : stream).pipe(res);
  return true;
}

async function serveStatic(req, res, pathname) {
  // Admin dashboard
  if (pathname === '/admin' ) {
    res.writeHead(301, baseHeaders({ Location: '/admin/' }));
    return res.end();
  }
  const adminHeaders = { 'X-Robots-Tag': 'noindex, nofollow' };
  if (pathname === '/admin/') {
    return sendFile(req, res, path.join(ROOT, 'admin', 'index.html'), 'no-store', adminHeaders);
  }

  // Uploaded banners
  if (pathname.startsWith('/uploads/')) {
    const name = pathname.slice('/uploads/'.length);
    if (!/^[a-f0-9]{24}(-sm|-ph-[a-f0-9]{8})?\.(jpg|png|webp)$/.test(name)) return notFound(res);
    const ok = await sendFile(req, res, path.join(UPLOAD_DIR, name), 'public, max-age=31536000, immutable');
    return ok || notFound(res);
  }

  let rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!isPublic(rel)) {
    // Unknown page-like paths fall back to the homepage (as the old nginx setup did)
    if (!path.extname(rel)) rel = 'index.html';
    else return notFound(res);
  }

  if (rel === 'index.html') return serveHome(req, res);

  const filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT + path.sep)) return notFound(res);

  const ext = path.extname(filePath).toLowerCase();
  const isAdmin = rel.startsWith('admin/');
  // HTML, CSS and JS are revalidated on every visit (cheap 304s via ETag) so site updates show up at once;
  // images, video and fonts are cached for 30 days.
  const cache = isAdmin ? 'no-store'
    : ['.html', '.css', '.js'].includes(ext) ? 'no-cache'
    : 'public, max-age=2592000';
  const ok = await sendFile(req, res, filePath, cache, isAdmin ? adminHeaders : {});
  return ok || notFound(res);
}

/** The homepage, with product cards, form options and footer links built from saved products. */
async function serveHome(req, res) {
  const [html, products] = await Promise.all([
    fsp.readFile(path.join(ROOT, 'index.html'), 'utf8'),
    readProducts(),
  ]);
  const body = Buffer.from(renderPage(html, products), 'utf8');
  const etag = `W/"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 20)}"`;
  const headers = baseHeaders({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    ETag: etag,
    Vary: 'Accept-Encoding',
  });
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const out = gzip ? zlib.gzipSync(body, { level: 6 }) : body;
  if (gzip) headers['Content-Encoding'] = 'gzip';
  headers['Content-Length'] = out.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : out);
}

function notFound(res) {
  res.writeHead(404, baseHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
  res.end('Not found');
}

/* ------------------------------------------------------------------ */
/* Banner storage                                                      */
/* ------------------------------------------------------------------ */

let writeQueue = Promise.resolve();

async function readBanners() {
  try {
    const data = JSON.parse(await fsp.readFile(BANNERS_FILE, 'utf8'));
    return Array.isArray(data.banners) ? data.banners : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function writeBanners(banners) {
  writeQueue = writeQueue.then(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmp = BANNERS_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify({ banners }, null, 2));
    await fsp.rename(tmp, BANNERS_FILE);
  });
  return writeQueue;
}

/* ---------- Products ---------- */

let productsWriteQueue = Promise.resolve();

async function readProducts() {
  let data;
  try {
    data = JSON.parse(await fsp.readFile(PRODUCTS_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // Nothing saved yet: start from the products that shipped with the site
    data = JSON.parse(await fsp.readFile(PRODUCTS_SEED, 'utf8'));
  }
  return { stone: Array.isArray(data.stone) ? data.stone : [], sand: Array.isArray(data.sand) ? data.sand : [] };
}

function writeProducts(data) {
  productsWriteQueue = productsWriteQueue.catch(() => {}).then(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmp = PRODUCTS_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
    await fsp.rename(tmp, PRODUCTS_FILE);
  });
  return productsWriteQueue;
}

function cleanText(v, max) {
  return String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Checks and tidies the product fields for a type. Returns { product } or { error }. */
function readProductFields(type, body) {
  const t = PRODUCT_TYPES[type];
  const name = cleanText(body.name, 80);
  const description = cleanText(body.description, 240);
  if (!name) return { error: 'Please enter a product name.', field: 'name' };
  if (!description) return { error: 'Please enter a short description.', field: 'description' };
  const rawList = Array.isArray(body[t.list.key]) ? body[t.list.key] : [];
  const list = rawList.map((v) => cleanText(v, 30)).filter(Boolean);
  if (list.length > MAX_LIST_ITEMS) return { error: `Add at most ${MAX_LIST_ITEMS} ${t.list.label} values.`, field: t.list.key };
  const label = cleanText(body.label, 24);
  const product = { name, label, description, [t.list.key]: list };
  for (const f of t.fields) product[f.key] = cleanText(body[f.key], 60);
  return { product };
}

async function saveProductImage(dataUrl) {
  const img = decodeImage(dataUrl, MAX_PRODUCT_IMAGE);
  if (!img) return null;
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  const file = `${crypto.randomBytes(12).toString('hex')}.${img.ext}`;
  await fsp.writeFile(path.join(UPLOAD_DIR, file), img.buf);
  return `/uploads/${file}`;
}

async function removeUploaded(src) {
  if (typeof src === 'string' && src.startsWith('/uploads/')) {
    await fsp.unlink(path.join(UPLOAD_DIR, path.basename(src))).catch(() => {});
  }
}

function findProduct(data, id) {
  for (const type of Object.keys(PRODUCT_TYPES)) {
    const i = data[type].findIndex((p) => p.id === id);
    if (i !== -1) return { type, index: i, product: data[type][i] };
  }
  return null;
}

function publicBanner(b) {
  return {
    id: b.id,
    src: `/uploads/${b.file}`,
    srcSmall: b.fileSmall ? `/uploads/${b.fileSmall}` : null,
    srcPhone: b.filePhone ? `/uploads/${b.filePhone}` : null,
    alt: b.alt,
    focusX: b.focusX,
    focusY: b.focusY,
  };
}

function decodeImage(dataUrl, limit) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > limit) return null;
  // Check the file really is the image type it claims to be
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  const ext = isJpeg ? 'jpg' : isPng ? 'png' : isWebp ? 'webp' : null;
  if (!ext) return null;
  return { buf, ext };
}

function clampPct(v, fallback = 50) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
}

function cleanAlt(v) {
  return String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 160);
}

/* ------------------------------------------------------------------ */
/* Sessions & security                                                 */
/* ------------------------------------------------------------------ */

const sessions = new Map(); // token -> expiry
const loginAttempts = new Map(); // ip -> { count, resetAt }

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function isLoggedIn(req) {
  const token = parseCookies(req).fb_admin;
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}

function isHttps(req) {
  return req.socket.encrypted || (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function sessionCookie(req, token, maxAgeSec) {
  return `fb_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`;
}

function sameText(input, expected) {
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Username is not case-sensitive; password is. Both are always checked, so timing reveals nothing. */
function credentialsMatch(username, password) {
  const userOk = sameText(String(username || '').trim().toLowerCase(), ADMIN_USERNAME.toLowerCase());
  const passOk = passwordMatches(password);
  return userOk && passOk;
}

function passwordMatches(input) {
  if (!ADMIN_PASSWORD) return false;
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}

function loginAllowed(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 8;
}

/** Blocks cross-site form posts: admin changes must be same-origin JSON requests. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  try { return new URL(origin).host === host; } catch { return false; }
}

setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of sessions) if (exp < now) sessions.delete(t);
  for (const [ip, e] of loginAttempts) if (e.resetAt < now) loginAttempts.delete(ip);
}, 10 * 60 * 1000).unref();

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

function sendJson(res, status, body, extra = {}) {
  res.writeHead(status, baseHeaders({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }));
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) {
      return reject(Object.assign(new Error('Expected JSON'), { status: 415 }));
    }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('The image is too large.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, pathname) {
  const method = req.method;

  // Public: banners for the homepage
  if (pathname === '/api/banners' && (method === 'GET' || method === 'HEAD')) {
    const banners = await readBanners();
    return banners.length
      ? sendJson(res, 200, { source: 'custom', banners: banners.map(publicBanner) })
      : sendJson(res, 200, { source: 'default', banners: DEFAULT_BANNERS });
  }

  if (!pathname.startsWith('/api/admin/')) return sendJson(res, 404, { error: 'Not found' });

  if (method !== 'GET' && !sameOrigin(req)) return sendJson(res, 403, { error: 'Forbidden' });

  if (pathname === '/api/admin/session' && method === 'GET') {
    return sendJson(res, 200, { configured: Boolean(ADMIN_PASSWORD), loggedIn: isLoggedIn(req) });
  }

  if (pathname === '/api/admin/login' && method === 'POST') {
    if (!ADMIN_PASSWORD) return sendJson(res, 503, { error: 'Sign-in is not available right now. Please try again later.' });
    if (!loginAllowed(clientIp(req))) return sendJson(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const body = await readJson(req);
    if (!credentialsMatch(body.username, body.password)) return sendJson(res, 401, { error: 'Incorrect username or password.' });
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL);
    loginAttempts.delete(clientIp(req));
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, token, SESSION_TTL / 1000) });
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    const token = parseCookies(req).fb_admin;
    if (token) sessions.delete(token);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  // Everything below needs a signed-in admin
  if (!isLoggedIn(req)) return sendJson(res, 401, { error: 'Please sign in again.' });

  if (pathname === '/api/admin/banners' && method === 'GET') {
    const banners = await readBanners();
    return sendJson(res, 200, {
      max: MAX_BANNERS,
      banners: banners.map(publicBanner),
      defaults: DEFAULT_BANNERS,
    });
  }

  if (pathname === '/api/admin/banners' && method === 'POST') {
    const banners = await readBanners();
    if (banners.length >= MAX_BANNERS) return sendJson(res, 400, { error: `You can have up to ${MAX_BANNERS} banners. Delete one first.` });
    const body = await readJson(req);
    const large = decodeImage(body.image, MAX_IMAGE);
    if (!large) return sendJson(res, 400, { error: 'Please upload a JPG, PNG or WebP image under 8 MB.' });
    const small = body.imageSmall ? decodeImage(body.imageSmall, MAX_IMAGE_SMALL) : null;

    await fsp.mkdir(UPLOAD_DIR, { recursive: true });
    const id = crypto.randomBytes(12).toString('hex');
    const file = `${id}.${large.ext}`;
    await fsp.writeFile(path.join(UPLOAD_DIR, file), large.buf);
    let fileSmall = null;
    if (small) {
      fileSmall = `${id}-sm.${small.ext}`;
      await fsp.writeFile(path.join(UPLOAD_DIR, fileSmall), small.buf);
    }
    const banner = {
      id, file, fileSmall,
      alt: cleanAlt(body.alt),
      focusX: clampPct(body.focusX),
      focusY: clampPct(body.focusY),
      createdAt: new Date().toISOString(),
    };
    banners.push(banner);
    await writeBanners(banners);
    return sendJson(res, 201, { banner: publicBanner(banner) });
  }

  if (pathname === '/api/admin/banners/order' && method === 'PUT') {
    const body = await readJson(req);
    const banners = await readBanners();
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (ids.length !== banners.length || !ids.every((id) => banners.some((b) => b.id === id))) {
      return sendJson(res, 400, { error: 'The banner list changed. Reload the page and try again.' });
    }
    const sorted = ids.map((id) => banners.find((b) => b.id === id));
    await writeBanners(sorted);
    return sendJson(res, 200, { banners: sorted.map(publicBanner) });
  }

  /* ---------- Products ---------- */
  if (pathname === '/api/admin/products' && method === 'GET') {
    const type = new URL(req.url, 'http://x').searchParams.get('type');
    if (!PRODUCT_TYPES[type]) return sendJson(res, 400, { error: 'Unknown product type.' });
    const data = await readProducts();
    return sendJson(res, 200, { type, max: MAX_PRODUCTS, maxList: MAX_LIST_ITEMS, products: data[type] });
  }

  if (pathname === '/api/admin/products' && method === 'POST') {
    const body = await readJson(req);
    const type = body.type;
    if (!PRODUCT_TYPES[type]) return sendJson(res, 400, { error: 'Unknown product type.' });
    const data = await readProducts();
    if (data[type].length >= MAX_PRODUCTS) return sendJson(res, 400, { error: `You can have up to ${MAX_PRODUCTS} products here.` });
    const { product, error, field } = readProductFields(type, body);
    if (error) return sendJson(res, 400, { error, field });
    const image = await saveProductImage(body.image);
    if (!image) return sendJson(res, 400, { error: 'Please add a JPG, PNG or WebP image under 4 MB.', field: 'image' });
    const saved = { id: crypto.randomBytes(12).toString('hex'), ...product, image };
    data[type].push(saved);
    await writeProducts(data);
    return sendJson(res, 201, { product: saved });
  }

  if (pathname === '/api/admin/products/order' && method === 'PUT') {
    const body = await readJson(req);
    const type = body.type;
    if (!PRODUCT_TYPES[type]) return sendJson(res, 400, { error: 'Unknown product type.' });
    const data = await readProducts();
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const list = data[type];
    if (ids.length !== list.length || !ids.every((id) => list.some((p) => p.id === id))) {
      return sendJson(res, 400, { error: 'The product list changed. Reload the page and try again.' });
    }
    data[type] = ids.map((id) => list.find((p) => p.id === id));
    await writeProducts(data);
    return sendJson(res, 200, { products: data[type] });
  }

  const mProd = /^\/api\/admin\/products\/([a-z0-9-]{1,40})$/.exec(pathname);
  if (mProd && (method === 'PUT' || method === 'DELETE')) {
    const data = await readProducts();
    const found = findProduct(data, mProd[1]);
    if (!found) return sendJson(res, 404, { error: 'Product not found. Reload the page and try again.' });
    const { type, index, product: current } = found;

    if (method === 'DELETE') {
      data[type].splice(index, 1);
      await writeProducts(data);
      await removeUploaded(current.image);
      return sendJson(res, 200, { ok: true });
    }

    const body = await readJson(req);
    const { product, error, field } = readProductFields(type, body);
    if (error) return sendJson(res, 400, { error, field });
    let image = current.image;
    if (body.image) {
      image = await saveProductImage(body.image);
      if (!image) return sendJson(res, 400, { error: 'Please add a JPG, PNG or WebP image under 4 MB.', field: 'image' });
    }
    const updated = { id: current.id, ...product, image };
    data[type][index] = updated;
    await writeProducts(data);
    if (image !== current.image) await removeUploaded(current.image);
    return sendJson(res, 200, { product: updated });
  }

  // Phone version (portrait image shown on screens up to 767px wide)
  const mp = /^\/api\/admin\/banners\/([a-f0-9]{24})\/phone$/.exec(pathname);
  if (mp && (method === 'PUT' || method === 'DELETE')) {
    const banners = await readBanners();
    const banner = banners.find((b) => b.id === mp[1]);
    if (!banner) return sendJson(res, 404, { error: 'Banner not found.' });
    const old = banner.filePhone;
    if (method === 'PUT') {
      const body = await readJson(req);
      const img = decodeImage(body.image, MAX_IMAGE_PHONE);
      if (!img) return sendJson(res, 400, { error: 'Please upload a JPG, PNG or WebP image under 4 MB.' });
      await fsp.mkdir(UPLOAD_DIR, { recursive: true });
      // A new name on every upload, so browsers never show a cached older version
      const file = `${banner.id}-ph-${crypto.randomBytes(4).toString('hex')}.${img.ext}`;
      await fsp.writeFile(path.join(UPLOAD_DIR, file), img.buf);
      banner.filePhone = file;
    } else {
      banner.filePhone = null;
    }
    await writeBanners(banners);
    if (old) await fsp.unlink(path.join(UPLOAD_DIR, old)).catch(() => {});
    return sendJson(res, 200, { banner: publicBanner(banner) });
  }

  const m = /^\/api\/admin\/banners\/([a-f0-9]{24})$/.exec(pathname);
  if (m && method === 'PATCH') {
    const body = await readJson(req);
    const banners = await readBanners();
    const banner = banners.find((b) => b.id === m[1]);
    if (!banner) return sendJson(res, 404, { error: 'Banner not found.' });
    if ('alt' in body) banner.alt = cleanAlt(body.alt);
    if ('focusX' in body) banner.focusX = clampPct(body.focusX, banner.focusX);
    if ('focusY' in body) banner.focusY = clampPct(body.focusY, banner.focusY);
    await writeBanners(banners);
    return sendJson(res, 200, { banner: publicBanner(banner) });
  }

  if (m && method === 'DELETE') {
    const banners = await readBanners();
    const banner = banners.find((b) => b.id === m[1]);
    if (!banner) return sendJson(res, 404, { error: 'Banner not found.' });
    await writeBanners(banners.filter((b) => b !== banner));
    for (const f of [banner.file, banner.fileSmall, banner.filePhone].filter(Boolean)) {
      await fsp.unlink(path.join(UPLOAD_DIR, f)).catch(() => {});
    }
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return notFound(res);
  }
  if (pathname.includes('\0') || pathname.includes('..')) return notFound(res);

  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, baseHeaders({ Allow: 'GET, HEAD' }));
      return res.end();
    }
    return await serveStatic(req, res, pathname);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Something went wrong on the server.' : err.message });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`F B Group site running on http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/admin/`);
  if (!ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD is not set: the dashboard is locked.');
  console.log(`Banner data: ${DATA_DIR}`);
});
