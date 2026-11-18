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
const QUOTES_FILE = path.join(DATA_DIR, 'quotes.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const CONTENT_UPDATES_FILE = path.join(DATA_DIR, 'content-updates.json');
const GALLERY_FILE = path.join(DATA_DIR, 'gallery.json');
const CONTACT_FILE = path.join(DATA_DIR, 'contact.json');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
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
const MAX_CONTACT_ITEMS = 10;                // phone numbers / emails each
const MAX_GALLERY = 60;                     // photos + videos in Our Operations
const MAX_GALLERY_IMAGE = 5 * 1024 * 1024;   // decoded large gallery photo (already WebP)
const MAX_GALLERY_TILE = 2 * 1024 * 1024;    // decoded gallery tile
const MAX_VIDEO_UPLOAD = 500 * 1024 * 1024;  // original video before compression
const SESSION_TTL = 12 * 60 * 60 * 1000;    // 12 hours

/** Shown on the homepage whenever no banner has been uploaded. */
const DEFAULT_BANNERS = [
  { id: 'default-1', src: '/images/opt/default-1.webp', srcSmall: '/images/opt/default-1-1000.webp', srcPhone: '/images/banners/default-1-phone.webp', alt: 'Bulk carrier discharging stone aggregate into a lighter vessel', focusX: 55, focusY: 50 },
  { id: 'default-2', src: '/images/opt/default-2.webp', srcSmall: '/images/opt/default-2-1000.webp', srcPhone: '/images/banners/default-2-phone.webp', alt: 'Excavator unloading stone aggregate from a barge into a dump truck at a river ghat', focusX: 62, focusY: 50 },
  { id: 'default-3', src: '/images/opt/default-3.webp', srcSmall: '/images/opt/default-3-1000.webp', srcPhone: '/images/banners/default-3-phone.webp', alt: 'Floating crane transferring aggregate from a mother vessel to a lighter vessel', focusX: 58, focusY: 50 },
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
    const ok1 = /^[a-f0-9]{24}(-sm|-ph-[a-f0-9]{8}|-full|-tile|-poster)?\.(jpg|png|webp)$/.test(name)
      || /^[a-f0-9]{24}\.mp4$/.test(name);
    if (!ok1) return notFound(res);
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
  trackVisit(req);
  const [html, products, gallery] = await Promise.all([
    fsp.readFile(path.join(ROOT, 'index.html'), 'utf8'),
    readProducts(),
    readGallery(),
  ]);
  const ready = gallery.filter((g) => g.status === 'ready' && g.file).map(publicGalleryItem);
  const contact = await readContact();
  const body = Buffer.from(renderPage(html, { ...products, gallery: ready, contact }), 'utf8');
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

/* ---------- Contact details (Settings → Contact details) ---------- */

// Shown until the details are saved from the dashboard for the first time
const DEFAULT_CONTACT = {
  address: 'Plot-68, Level-08, Road-17, Block-E, Banani, Dhaka, Bangladesh',
  phones: ['01700000000'],
  emails: ['info@fbenterprise.online', 'fbholdingsltd@gmail.com'],
};

let contactWriteQueue = Promise.resolve();

async function readContact() {
  try {
    const data = JSON.parse(await fsp.readFile(CONTACT_FILE, 'utf8'));
    return {
      address: typeof data.address === 'string' ? data.address : '',
      phones: Array.isArray(data.phones) ? data.phones.filter((x) => typeof x === 'string') : [],
      emails: Array.isArray(data.emails) ? data.emails.filter((x) => typeof x === 'string') : [],
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { address: DEFAULT_CONTACT.address, phones: [...DEFAULT_CONTACT.phones], emails: [...DEFAULT_CONTACT.emails] };
    }
    throw err;
  }
}

function writeContact(contact) {
  contactWriteQueue = contactWriteQueue.then(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmp = CONTACT_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(contact, null, 2));
    await fsp.rename(tmp, CONTACT_FILE);
  });
  return contactWriteQueue;
}

/** Checks the dashboard form. Empty rows are dropped. Returns { contact } or { error, field }. */
function readContactFields(body) {
  const list = (v) => (Array.isArray(v) ? v : [])
    .map((x) => String(x ?? '').trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const address = String(body.address ?? '').replace(/\r/g, '').split('\n')
    .map((l) => l.trim()).filter(Boolean).join('\n');
  if (address.length > 300) return { error: 'The address is too long. Keep it under 300 characters.', field: 'address' };

  const phones = [...new Set(list(body.phones))];
  if (phones.length > MAX_CONTACT_ITEMS) return { error: `You can add up to ${MAX_CONTACT_ITEMS} phone numbers.`, field: 'phones' };
  const badPhone = phones.find((p) => !/^\+?[0-9][0-9 ()-]{4,24}$/.test(p));
  if (badPhone) return { error: `"${badPhone.slice(0, 30)}" is not a phone number. Use digits, with + - ( ) or spaces if you like.`, field: 'phones' };

  const emails = [...new Set(list(body.emails).map((e) => e.toLowerCase()))];
  if (emails.length > MAX_CONTACT_ITEMS) return { error: `You can add up to ${MAX_CONTACT_ITEMS} email addresses.`, field: 'emails' };
  const badEmail = emails.find((e) => e.length > 120 || !/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(e));
  if (badEmail) return { error: `"${badEmail.slice(0, 40)}" is not a valid email address.`, field: 'emails' };

  return { contact: { address, phones, emails } };
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

/* ---------- Gallery (Our Operations) ---------- */
/*
 * Photos are shrunk to WebP in the dashboard before upload (a large and a tile size).
 * Videos are uploaded as they are, then re-encoded here with ffmpeg: H.264, at most
 * 1280 px on the long side, 30 fps, no sound, quick-start for the web, plus a preview picture.
 */

const { spawn } = require('child_process');

let galleryWriteQueue = Promise.resolve();
const VIDEO_TMP_DIR = path.join(UPLOAD_DIR, 'incoming');

async function readGallery() {
  try {
    const data = JSON.parse(await fsp.readFile(GALLERY_FILE, 'utf8'));
    return Array.isArray(data.items) ? data.items : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function writeGallery(items) {
  galleryWriteQueue = galleryWriteQueue.catch(() => {}).then(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmp = GALLERY_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify({ items }, null, 2));
    await fsp.rename(tmp, GALLERY_FILE);
  });
  return galleryWriteQueue;
}

/** Changes one gallery item in place (re-reading the file first, so other edits are kept). */
async function updateGalleryItem(id, patch) {
  const items = await readGallery();
  const item = items.find((x) => x.id === id);
  if (!item) return null;
  Object.assign(item, patch);
  await writeGallery(items);
  return item;
}

function publicGalleryItem(g) {
  return {
    id: g.id,
    type: g.type,
    title: g.title,
    status: g.status,
    src: g.file ? `/uploads/${g.file}` : null,
    thumb: g.thumb ? `/uploads/${g.thumb}` : null,
    width: g.width || null,
    height: g.height || null,
    size: g.size || null,
    originalSize: g.originalSize || null,
    error: g.error || '',
  };
}

async function removeGalleryFiles(g) {
  for (const f of [g.file, g.thumb].filter(Boolean)) {
    await fsp.unlink(path.join(UPLOAD_DIR, f)).catch(() => {});
  }
  if (g.incoming) await fsp.unlink(path.join(VIDEO_TMP_DIR, g.incoming)).catch(() => {});
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let child;
    try {
      child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      return reject(err);
    }
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`))));
  });
}

let videoQueue = Promise.resolve();

/** Queues a freshly uploaded video for compression; videos are handled one at a time. */
function queueVideo(id) {
  videoQueue = videoQueue.catch(() => {}).then(() => compressVideo(id)).catch((err) => console.error('Video compression failed:', err));
  return videoQueue;
}

async function compressVideo(id) {
  const items = await readGallery();
  const g = items.find((x) => x.id === id);
  if (!g || g.status !== 'processing' || !g.incoming) return;
  const input = path.join(VIDEO_TMP_DIR, g.incoming);
  const file = `${id}.mp4`;
  const thumb = `${id}-poster.jpg`;
  const out = path.join(UPLOAD_DIR, file);
  try {
    await runFfmpeg([
      '-y', '-i', input,
      '-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1',
      '-vf', "scale='if(gte(iw,ih),min(1280,iw),-2)':'if(gte(iw,ih),-2,min(1280,ih))':flags=lanczos,format=yuv420p",
      '-fpsmax', '30',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '28', '-profile:v', 'high',
      '-movflags', '+faststart',
      out,
    ]);
    // Preview picture: a frame one second in (or the first frame for very short clips)
    const posterArgs = (seek) => ['-y', ...(seek ? ['-ss', '1'] : []), '-i', out, '-frames:v', '1',
      '-vf', "scale='if(gte(iw,ih),min(960,iw),-2)':'if(gte(iw,ih),-2,min(960,ih))',format=yuvj420p", '-q:v', '4', path.join(UPLOAD_DIR, thumb)];
    await runFfmpeg(posterArgs(true)).catch(() => {});
    const posterOk = await fsp.stat(path.join(UPLOAD_DIR, thumb)).then((s) => s.size > 0).catch(() => false);
    if (!posterOk) await runFfmpeg(posterArgs(false)).catch((err) => console.error(`No preview picture for video ${id}: ${err.message}`));
    const hasPoster = await fsp.stat(path.join(UPLOAD_DIR, thumb)).then((s) => s.size > 0).catch(() => false);
    const size = (await fsp.stat(out)).size;
    await fsp.unlink(input).catch(() => {});
    const still = await updateGalleryItem(id, { status: 'ready', file, thumb: hasPoster ? thumb : null, size, incoming: null, error: '' });
    if (!still) await removeGalleryFiles({ file, thumb }); // deleted while it was being compressed
  } catch (err) {
    await fsp.unlink(out).catch(() => {});
    await fsp.unlink(path.join(UPLOAD_DIR, thumb)).catch(() => {});
    await fsp.unlink(input).catch(() => {});
    const missing = err.code === 'ENOENT';
    console.error(missing ? `Video compression is not available: "${FFMPEG}" was not found.` : `Could not compress video ${id}: ${err.message}`);
    await updateGalleryItem(id, {
      status: 'failed',
      incoming: null,
      error: missing
        ? 'Video compression is not available on the server (ffmpeg is missing). Redeploy the latest version of the site, then upload the video again.'
        : 'This video could not be processed. Try exporting it again as MP4 and upload it again.',
    });
  }
}

/** After a restart, carry on with videos that were waiting for compression. */
async function resumeGalleryJobs() {
  const items = await readGallery();
  for (const g of items) {
    if (g.status !== 'processing') continue;
    const exists = g.incoming && await fsp.stat(path.join(VIDEO_TMP_DIR, g.incoming)).then(() => true).catch(() => false);
    if (exists) queueVideo(g.id);
    else await updateGalleryItem(g.id, { status: 'failed', incoming: null, error: 'The upload was interrupted. Please upload this video again.' });
  }
}

/** Streams a video upload to a temporary file, stopping if it is too large. */
function receiveFile(req, dest, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) {
      req.resume();
      return reject(Object.assign(new Error(`The video is too large. The limit is ${Math.round(limit / 1048576)} MB.`), { status: 413 }));
    }
    const ws = fs.createWriteStream(dest, { flags: 'wx' });
    let size = 0;
    let failed = false;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      req.unpipe(ws);
      ws.destroy();
      fsp.unlink(dest).catch(() => {});
      reject(err);
    };
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        fail(Object.assign(new Error(`The video is too large. The limit is ${Math.round(limit / 1048576)} MB.`), { status: 413 }));
        req.destroy();
      }
    });
    req.on('aborted', () => fail(Object.assign(new Error('The upload was interrupted.'), { status: 400 })));
    req.on('error', fail);
    ws.on('error', fail);
    ws.on('finish', () => { if (!failed) resolve(size); });
    req.pipe(ws);
  });
}

/* ---------- Quotation requests ---------- */

let quotesWriteQueue = Promise.resolve();
const quoteAttempts = new Map(); // ip -> { count, resetAt }

async function readQuotes() {
  try {
    const data = JSON.parse(await fsp.readFile(QUOTES_FILE, 'utf8'));
    return Array.isArray(data.quotes) ? data.quotes : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function writeQuotes(quotes) {
  quotesWriteQueue = quotesWriteQueue.catch(() => {}).then(async () => {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const tmp = QUOTES_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify({ quotes }, null, 2));
    await fsp.rename(tmp, QUOTES_FILE);
  });
  return quotesWriteQueue;
}

/** At most 5 requests per visitor every 10 minutes. */
function quoteAllowed(ip) {
  const now = Date.now();
  const entry = quoteAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    quoteAttempts.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 5;
}

function cleanMultiline(v, max) {
  return String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

function readQuoteFields(body) {
  const q = {
    name: cleanText(body.name, 100),
    company: cleanText(body.company, 120),
    email: cleanText(body.email, 120),
    phone: cleanText(body.phone, 40),
    product: cleanText(body.product, 100),
    quantity: cleanText(body.quantity, 60),
    port: cleanText(body.port, 80),
    message: cleanMultiline(body.message, 2000),
  };
  if (!q.name) return { error: 'Please enter your name.', field: 'name' };
  if (!q.email) return { error: 'Please enter your email address.', field: 'email' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.email)) return { error: 'Please enter a valid email address.', field: 'email' };
  if (!q.product) return { error: 'Please choose a product.', field: 'product' };
  return { quote: q };
}

/* ---------- One-time content updates ----------
 * Each update runs once, ever: its id is recorded in content-updates.json.
 * So anything it adds can be edited or deleted in the dashboard and will not come back.
 */
const SIZES_3 = ['5–10 mm', '10–20 mm', '20–40 mm'];
const CONTENT_UPDATES = [
  {
    id: '2026-11-18-stone-lineup-and-sand-fm',
    apply(data) {
      const add = [
        ['stone-uae-lime', 'UAE Lime Stone', 'Clean, durable limestone aggregate from the UAE for concrete, road base and general construction.', 'UAE'],
        ['stone-dubai-gabbro', 'Dubai Gabbro Stone', 'Hard, dense gabbro with high crushing strength, ideal for RCC, high-grade concrete and heavy-load works.', 'Dubai, UAE'],
        ['stone-oman-lime', 'Oman Lime Stone', 'Quality Omani limestone with consistent grading for concrete, block-making and road works.', 'Oman'],
        ['stone-india-pakur', 'Indian Pakur Stone', 'Strong black stone from Pakur, widely used for RCC, bridges and high-strength concrete.', 'Pakur, India'],
        ['stone-india-gujrat', 'Indian Gujrat Stone', 'Hard crushed stone from Gujarat for concrete, road construction and general building works.', 'Gujarat, India'],
        ['stone-china-lime', 'Chinese Lime Stone', 'Imported Chinese limestone aggregate with uniform sizing for concrete and road base.', 'China'],
        ['stone-bhutan-tosha', 'Bhutan Tosha Stone', 'Popular Bhutanese stone, washed and graded, for RCC, concrete and structural works.', 'Bhutan'],
        ['stone-india-black-lc', 'Indian Black LC Stone', 'Hard black stone chips from India, well graded for RCC and concrete works.', 'India'],
      ];
      const have = new Set(data.stone.map((x) => x.name.trim().toLowerCase()));
      const fresh = add
        .filter(([, name]) => !have.has(name.toLowerCase()))
        .map(([id, name, description, origin]) => ({
          id, name, label: '', description, sizes: [...SIZES_3], use: '', origin, shape: '', image: '',
        }));
      data.stone = [...fresh, ...data.stone];
      for (const sand of data.sand) sand.fm = [...SIZES_3];
      return `added ${fresh.length} stone products, set FM on ${data.sand.length} sand products`;
    },
  },
];

async function applyContentUpdates() {
  if (storage.writable === false) return;
  let applied = [];
  try {
    applied = JSON.parse(await fsp.readFile(CONTENT_UPDATES_FILE, 'utf8')).applied || [];
  } catch (err) {
    if (err.code !== 'ENOENT') { console.error('Could not read content updates:', err.message); return; }
  }
  for (const update of CONTENT_UPDATES) {
    if (applied.some((a) => a.id === update.id)) continue;
    const data = await readProducts();
    const result = update.apply(data);
    await writeProducts(data);
    applied.push({ id: update.id, appliedAt: new Date().toISOString(), result });
    await fsp.writeFile(CONTENT_UPDATES_FILE, JSON.stringify({ applied }, null, 2));
    console.log(`Content update ${update.id}: ${result}`);
  }
}

/* ---------- Storage check ----------
 * The dashboard warns when saved data would not survive a redeploy:
 * - "persistent": DATA_DIR (or a folder above it) is its own mount, i.e. a volume.
 *   Only checked on Linux (the live server); elsewhere it is reported as unknown.
 * - "writable": the server can actually save files there.
 */
const storage = { persistent: null, writable: null, checkedAt: null, error: '' };

async function checkStorage() {
  storage.checkedAt = new Date().toISOString();
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    const probe = path.join(DATA_DIR, '.write-test');
    await fsp.writeFile(probe, String(Date.now()));
    await fsp.unlink(probe);
    storage.writable = true;
  } catch (err) {
    storage.writable = false;
    storage.error = err.code || err.message;
  }
  if (process.platform === 'linux') {
    try {
      const mounts = (await fsp.readFile('/proc/self/mountinfo', 'utf8'))
        .split('\n').map((line) => line.split(' ')[4]).filter(Boolean);
      let dir = path.resolve(DATA_DIR);
      let found = false;
      while (dir && dir !== '/') {
        if (mounts.includes(dir)) { found = true; break; }
        dir = path.dirname(dir);
      }
      storage.persistent = found;
    } catch {
      storage.persistent = null;
    }
  }
  if (storage.persistent === false) {
    console.warn(`WARNING: ${DATA_DIR} is not a persistent volume. Dashboard changes will be LOST on the next redeploy.`);
  }
  if (storage.writable === false) {
    console.warn(`WARNING: cannot write to ${DATA_DIR} (${storage.error}). Dashboard changes cannot be saved.`);
  }
}

/* ---------- Visitor statistics ----------
 * Privacy-friendly counting, kept on this server only: no cookies, no IP addresses stored.
 * A visitor is counted once per day using a hash of (daily random salt + IP + browser);
 * the salt changes every day and is never shown, so visitors cannot be traced.
 * Bots, prefetches and signed-in admins are not counted. Days follow Bangladesh time (UTC+6).
 */
const BOT_UA = /bot|crawl|spider|slurp|preview|monitor|uptime|curl|wget|python|axios|node-fetch|go-http|java\/|headless|lighthouse|pagespeed|facebookexternalhit|whatsapp|telegram|discord|scanner|httpclient|okhttp/i;
let stats = null;
let statsDirty = false;

function dhakaDay(ts = Date.now()) {
  return new Date(ts + 6 * 3600 * 1000).toISOString().slice(0, 10);
}

async function loadStats() {
  try {
    const raw = JSON.parse(await fsp.readFile(STATS_FILE, 'utf8'));
    stats = {
      startedAt: raw.startedAt || new Date().toISOString(),
      days: raw.days || {},
      today: { date: raw.today?.date || '', salt: raw.today?.salt || '', seen: new Set(raw.today?.seen || []) },
    };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Could not read stats:', err.message);
    stats = { startedAt: new Date().toISOString(), days: {}, today: { date: '', salt: '', seen: new Set() } };
    statsDirty = true;
  }
}

async function flushStats() {
  if (!stats || !statsDirty) return;
  statsDirty = false;
  const out = { startedAt: stats.startedAt, days: stats.days, today: { ...stats.today, seen: [...stats.today.seen] } };
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.writeFile(STATS_FILE + '.tmp', JSON.stringify(out));
    await fsp.rename(STATS_FILE + '.tmp', STATS_FILE);
  } catch (err) {
    statsDirty = true;
    console.error('Could not save stats:', err.message);
  }
}

function trackVisit(req) {
  if (!stats || req.method !== 'GET') return;
  const ua = String(req.headers['user-agent'] || '');
  if (!ua || BOT_UA.test(ua)) return;
  const purpose = String(req.headers['sec-purpose'] || req.headers.purpose || '');
  if (/prefetch|prerender/i.test(purpose)) return;
  if (isLoggedIn(req)) return; // your own visits while signed in to the dashboard

  const day = dhakaDay();
  if (stats.today.date !== day) {
    stats.today = { date: day, salt: crypto.randomBytes(16).toString('hex'), seen: new Set() };
  }
  const d = stats.days[day] || (stats.days[day] = { visitors: 0, views: 0, mobile: 0, desktop: 0, sources: {} });
  d.views += 1;

  const id = crypto.createHash('sha256').update(`${stats.today.salt}|${clientIp(req)}|${ua}`).digest('hex').slice(0, 16);
  if (!stats.today.seen.has(id)) {
    stats.today.seen.add(id);
    d.visitors += 1;
    if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) d.mobile += 1; else d.desktop += 1;
    let source = 'Direct';
    try {
      const ref = new URL(req.headers.referer || req.headers.referrer || '');
      const host = ref.hostname.replace(/^www\./, '');
      const own = (req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].replace(/^www\./, '');
      if (host && host !== own) source = host;
    } catch { /* no or bad referrer: direct */ }
    d.sources[source] = (d.sources[source] || 0) + 1;
    const keys = Object.keys(d.sources);
    if (keys.length > 60) { // keep the per-day list small
      keys.sort((a, b) => d.sources[a] - d.sources[b]).slice(0, keys.length - 60).forEach((k) => delete d.sources[k]);
    }
  }
  statsDirty = true;
}

setInterval(() => { flushStats(); }, 30 * 1000).unref();
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    await flushStats();
    process.exit(0);
  });
}

async function statsSummary() {
  const today = dhakaDay();
  const dayAt = (n) => dhakaDay(Date.now() - n * 86400000);
  const get = (day) => stats.days[day] || { visitors: 0, views: 0, mobile: 0, desktop: 0, sources: {} };
  const sum = (from, to, key) => {
    let t = 0;
    for (let i = from; i <= to; i += 1) t += get(dayAt(i))[key] || 0;
    return t;
  };

  const series = [];
  for (let i = 29; i >= 0; i -= 1) {
    const day = dayAt(i);
    series.push({ date: day, visitors: get(day).visitors, views: get(day).views });
  }
  let allVisits = 0;
  for (const d of Object.values(stats.days)) allVisits += d.visitors;

  const sources = {};
  let mobile = 0;
  let desktop = 0;
  for (let i = 0; i < 30; i += 1) {
    const d = get(dayAt(i));
    mobile += d.mobile;
    desktop += d.desktop;
    for (const [k, v] of Object.entries(d.sources || {})) sources[k] = (sources[k] || 0) + v;
  }
  const topSources = Object.entries(sources).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, visitors]) => ({ name, visitors }));

  const [quotes, products, banners, gallery] = await Promise.all([readQuotes(), readProducts(), readBanners(), readGallery()]);
  const since30 = Date.now() - 30 * 86400000;

  return {
    today,
    startedAt: stats.startedAt,
    visitors: {
      today: get(today).visitors,
      yesterday: get(dayAt(1)).visitors,
      last7: sum(0, 6, 'visitors'),
      prev7: sum(7, 13, 'visitors'),
      last30: sum(0, 29, 'visitors'),
      allTime: allVisits,
    },
    views: { today: get(today).views, last30: sum(0, 29, 'views') },
    series,
    devices: { mobile, desktop },
    topSources,
    quotes: {
      total: quotes.length,
      new: quotes.filter((q) => q.status === 'new').length,
      last30: quotes.filter((q) => Date.parse(q.createdAt) >= since30).length,
      recent: quotes.slice(0, 5).map((q) => ({
        id: q.id, name: q.name, company: q.company, product: q.product, status: q.status, createdAt: q.createdAt,
      })),
    },
    content: {
      stone: products.stone.length,
      sand: products.sand.length,
      banners: banners.length,
      gallery: gallery.length,
    },
  };
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
  for (const [ip, e] of quoteAttempts) if (e.resetAt < now) quoteAttempts.delete(ip);
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

  // Public: the homepage quotation form
  if (pathname === '/api/quotes' && method === 'POST') {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Forbidden' });
    const body = await readJson(req);
    // Hidden "website" field: people never see it, spam bots fill it in. Pretend it worked.
    if (body.website) return sendJson(res, 201, { ok: true });
    if (!quoteAllowed(clientIp(req))) {
      return sendJson(res, 429, { error: 'You have sent several requests in a short time. Please wait a few minutes and try again.' });
    }
    const { quote, error, field } = readQuoteFields(body);
    if (error) return sendJson(res, 400, { error, field });
    const quotes = await readQuotes();
    quotes.unshift({ id: crypto.randomBytes(12).toString('hex'), ...quote, status: 'new', createdAt: new Date().toISOString() });
    await writeQuotes(quotes);
    return sendJson(res, 201, { ok: true });
  }

  if (!pathname.startsWith('/api/admin/')) return sendJson(res, 404, { error: 'Not found' });

  if (method !== 'GET' && !sameOrigin(req)) return sendJson(res, 403, { error: 'Forbidden' });

  if (pathname === '/api/admin/session' && method === 'GET') {
    const loggedIn = isLoggedIn(req);
    return sendJson(res, 200, {
      configured: Boolean(ADMIN_PASSWORD),
      loggedIn,
      storage: loggedIn ? { persistent: storage.persistent, writable: storage.writable, dir: DATA_DIR } : undefined,
    });
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

  /* ---------- Contact details ---------- */
  if (pathname === '/api/admin/contact' && method === 'GET') {
    return sendJson(res, 200, { max: MAX_CONTACT_ITEMS, contact: await readContact() });
  }

  if (pathname === '/api/admin/contact' && method === 'PUT') {
    const { contact, error, field } = readContactFields(await readJson(req));
    if (error) return sendJson(res, 400, { error, field });
    await writeContact(contact);
    return sendJson(res, 200, { contact });
  }

  if (pathname === '/api/admin/stats' && method === 'GET') {
    return sendJson(res, 200, await statsSummary());
  }

  /* ---------- Quotation requests ---------- */
  if (pathname === '/api/admin/quotes' && method === 'GET') {
    const quotes = await readQuotes();
    return sendJson(res, 200, { quotes, newCount: quotes.filter((q) => q.status === 'new').length });
  }

  const mQuote = /^\/api\/admin\/quotes\/([a-f0-9]{24})$/.exec(pathname);
  if (mQuote && (method === 'PATCH' || method === 'DELETE')) {
    const quotes = await readQuotes();
    const i = quotes.findIndex((q) => q.id === mQuote[1]);
    if (i === -1) return sendJson(res, 404, { error: 'Request not found. Reload the page and try again.' });
    if (method === 'DELETE') {
      quotes.splice(i, 1);
      await writeQuotes(quotes);
      return sendJson(res, 200, { ok: true });
    }
    const body = await readJson(req);
    if (!['new', 'contacted'].includes(body.status)) return sendJson(res, 400, { error: 'Unknown status.' });
    quotes[i].status = body.status;
    await writeQuotes(quotes);
    return sendJson(res, 200, { quote: quotes[i] });
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
    let image = '';
    if (body.image) {
      image = await saveProductImage(body.image);
      if (!image) return sendJson(res, 400, { error: 'Please add a JPG, PNG or WebP image under 4 MB.', field: 'image' });
    }
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

  /* ---------- Gallery (Our Operations) ---------- */
  if (pathname === '/api/admin/gallery' && method === 'GET') {
    const items = await readGallery();
    return sendJson(res, 200, { max: MAX_GALLERY, maxVideoMb: Math.round(MAX_VIDEO_UPLOAD / 1048576), items: items.map(publicGalleryItem) });
  }

  if (pathname === '/api/admin/gallery/image' && method === 'POST') {
    const items = await readGallery();
    if (items.length >= MAX_GALLERY) return sendJson(res, 400, { error: `The gallery can hold up to ${MAX_GALLERY} photos and videos. Delete one first.` });
    const body = await readJson(req);
    const full = decodeImage(body.image, MAX_GALLERY_IMAGE);
    const tile = decodeImage(body.tile, MAX_GALLERY_TILE);
    if (!full || !tile) return sendJson(res, 400, { error: 'Please upload a JPG, PNG or WebP photo.' });
    await fsp.mkdir(UPLOAD_DIR, { recursive: true });
    const id = crypto.randomBytes(12).toString('hex');
    const file = `${id}-full.${full.ext}`;
    const thumb = `${id}-tile.${tile.ext}`;
    await fsp.writeFile(path.join(UPLOAD_DIR, file), full.buf);
    await fsp.writeFile(path.join(UPLOAD_DIR, thumb), tile.buf);
    const item = {
      id, type: 'image', status: 'ready', file, thumb,
      title: cleanText(body.title, 100),
      width: Math.min(10000, Math.max(1, Math.round(Number(body.width) || 0))) || null,
      height: Math.min(10000, Math.max(1, Math.round(Number(body.height) || 0))) || null,
      size: full.buf.length,
      originalSize: Math.max(0, Math.round(Number(body.originalSize) || 0)) || null,
      createdAt: new Date().toISOString(),
    };
    const latest = await readGallery();
    latest.unshift(item);
    await writeGallery(latest);
    return sendJson(res, 201, { item: publicGalleryItem(item) });
  }

  if (pathname === '/api/admin/gallery/video' && method === 'POST') {
    if (!/^video\//.test(req.headers['content-type'] || '')) {
      req.resume();
      return sendJson(res, 415, { error: 'Please upload a video file (MP4, MOV, WebM…).' });
    }
    const items = await readGallery();
    if (items.length >= MAX_GALLERY) {
      req.resume();
      return sendJson(res, 400, { error: `The gallery can hold up to ${MAX_GALLERY} photos and videos. Delete one first.` });
    }
    await fsp.mkdir(VIDEO_TMP_DIR, { recursive: true });
    const id = crypto.randomBytes(12).toString('hex');
    const incoming = `${id}.upload`;
    const originalSize = await receiveFile(req, path.join(VIDEO_TMP_DIR, incoming), MAX_VIDEO_UPLOAD);
    if (!originalSize) {
      await fsp.unlink(path.join(VIDEO_TMP_DIR, incoming)).catch(() => {});
      return sendJson(res, 400, { error: 'The video file is empty.' });
    }
    const title = cleanText(new URL(req.url, 'http://x').searchParams.get('title'), 100);
    const item = {
      id, type: 'video', status: 'processing', incoming, file: null, thumb: null,
      title, size: null, originalSize, createdAt: new Date().toISOString(),
    };
    const latest = await readGallery();
    latest.unshift(item);
    await writeGallery(latest);
    queueVideo(id);
    return sendJson(res, 202, { item: publicGalleryItem(item) });
  }

  if (pathname === '/api/admin/gallery/order' && method === 'PUT') {
    const body = await readJson(req);
    const items = await readGallery();
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (ids.length !== items.length || !ids.every((id) => items.some((g) => g.id === id))) {
      return sendJson(res, 400, { error: 'The gallery changed. Reload the page and try again.' });
    }
    const sorted = ids.map((id) => items.find((g) => g.id === id));
    await writeGallery(sorted);
    return sendJson(res, 200, { items: sorted.map(publicGalleryItem) });
  }

  const mg = /^\/api\/admin\/gallery\/([a-f0-9]{24})$/.exec(pathname);
  if (mg && method === 'PATCH') {
    const body = await readJson(req);
    const item = await updateGalleryItem(mg[1], { title: cleanText(body.title, 100) });
    if (!item) return sendJson(res, 404, { error: 'Not found. Reload the page and try again.' });
    return sendJson(res, 200, { item: publicGalleryItem(item) });
  }

  if (mg && method === 'DELETE') {
    const items = await readGallery();
    const item = items.find((g) => g.id === mg[1]);
    if (!item) return sendJson(res, 404, { error: 'Not found. Reload the page and try again.' });
    await writeGallery(items.filter((g) => g !== item));
    await removeGalleryFiles(item);
    return sendJson(res, 200, { ok: true });
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

// Video uploads can be large and slow on mobile connections, so give requests up to an hour
server.requestTimeout = 60 * 60 * 1000;

Promise.all([checkStorage(), loadStats()])
  .then(() => applyContentUpdates())
  .then(() => resumeGalleryJobs())
  .catch((err) => console.error('Startup step failed:', err))
  .finally(() => server.listen(PORT, () => {
  console.log(`F B Group site running on http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/admin/`);
  if (!ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD is not set: the dashboard is locked.');
  console.log(`Banner data: ${DATA_DIR}`);
}));
