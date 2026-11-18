/**
 * Builds the product cards and the enquiry-form product list from product data. Used by server.js on every page request,
 * so the homepage always shows what was saved in the dashboard.
 */
'use strict';

/** Field layout per product type: the multi-value list and the optional rows. */
const PRODUCT_TYPES = {
  stone: {
    list: { key: 'sizes', label: 'Size' },
    fields: [
      { key: 'use', label: 'Use' },
      { key: 'origin', label: 'Origin' },
      { key: 'shape', label: 'Shape' },
    ],
  },
  sand: {
    list: { key: 'fm', label: 'FM' },
    fields: [
      { key: 'use', label: 'Use' },
      { key: 'source', label: 'Source' },
      { key: 'grade', label: 'Grade' },
    ],
  },
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Image URLs only ever come from our own folders. */
function imgUrl(src) {
  return /^\/(images|uploads)\//.test(src) ? encodeURI(src) : '';
}

function renderCards(type, products, indent = '        ') {
  const t = PRODUCT_TYPES[type];
  if (!products.length) {
    return `${indent}<p class="product-empty">Products will be listed here soon. Contact us for current availability.</p>`;
  }
  return products.map((p) => {
    const rows = [];
    const list = (p[t.list.key] || []).filter(Boolean);
    if (list.length) {
      rows.push(`<li>${t.list.label} <span>${list.map(esc).join(' · ')}</span></li>`);
    }
    for (const f of t.fields) {
      if (p[f.key]) rows.push(`<li>${f.label} <span>${esc(p[f.key])}</span></li>`);
    }
    const specs = rows.length
      ? `\n${indent}    <ul class="product-spec">\n${rows.map((r) => `${indent}      ${r}`).join('\n')}\n${indent}    </ul>`
      : '';
    const badge = p.label ? `<span class="product-tag">${esc(p.label)}</span>` : '';
    const src = imgUrl(p.image || '');
    const photo = src
      ? `<div class="product-img">
${indent}    <img src="${esc(src)}" alt="${esc(p.name)}" width="800" height="500" loading="lazy" decoding="async" />${badge}
${indent}  </div>`
      : `<div class="product-img product-img--empty">
${indent}    <span class="product-noimg" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 17 8 9l4 3 3-6 5 11Z"/><path d="M3 20h18"/></svg>Photo coming soon</span>${badge}
${indent}  </div>`;
    return `${indent}<div class="product-card">
${indent}  ${photo}
${indent}  <div class="product-body">
${indent}    <h3>${esc(p.name)}</h3>
${indent}    <p>${esc(p.description)}</p>${specs}
${indent}    <a href="#contact" class="product-link">Request Spec Sheet →</a>
${indent}  </div>
${indent}</div>`;
  }).join('\n\n');
}

function renderOptions(data, indent = '                ') {
  const stone = (data.stone || []).map((p) => `${indent}<option>${esc(p.name)}</option>`);
  const sand = (data.sand || []).map((p) => `${indent}  <option>${esc(p.name)}</option>`);
  const out = [];
  if (stone.length) out.push(`${indent}<optgroup label="Stone">`, ...stone.map((o) => `  ${o}`), `${indent}</optgroup>`);
  if (sand.length) out.push(`${indent}<optgroup label="Sand">`, ...sand, `${indent}</optgroup>`);
  return out.join('\n');
}

/** Our Operations: photo and video tiles uploaded in the dashboard. Videos load only when opened. */
function renderGallery(items, indent = '        ') {
  if (!items.length) {
    return `${indent}<p class="gallery-empty">Photos and videos of our operations will be shown here soon.</p>`;
  }
  return items.map((g, i) => {
    const title = g.title || 'F B Group operations';
    const src = imgUrl(g.src || '');
    const thumb = imgUrl(g.thumb || '');
    if (!src) return '';
    if (g.type === 'video') {
      const poster = thumb ? ` data-poster="${esc(thumb)}"` : '';
      return `${indent}<div class="gallery-item" data-gallery-index="${i}" data-type="video" data-alt="${esc(title)}">
${indent}  <video src="${esc(src)}"${poster} loop muted playsinline preload="none" aria-label="${esc(title)}"></video>
${indent}</div>`;
    }
    const size = g.width && g.height ? ` width="${Number(g.width)}" height="${Number(g.height)}"` : '';
    return `${indent}<div class="gallery-item" data-gallery-index="${i}" data-type="image" data-alt="${esc(title)}">
${indent}  <img src="${esc(thumb || src)}"${size} data-full="${esc(src)}" loading="lazy" decoding="async" alt="${esc(title)}" />
${indent}</div>`;
  }).filter(Boolean).join('\n');
}

/** Replaces each marked region of the page with freshly built HTML. */
function renderPage(html, data) {
  const regions = {
    'PRODUCTS:stone': renderCards('stone', data.stone || []),
    'PRODUCTS:sand': renderCards('sand', data.sand || []),
    'PRODUCT-OPTIONS': renderOptions(data),
    GALLERY: renderGallery(data.gallery || []),
  };
  let out = html;
  for (const [name, content] of Object.entries(regions)) {
    const re = new RegExp(`(<!-- ${name} -->)[\\s\\S]*?(\\n[ \\t]*<!-- /${name} -->)`);
    out = out.replace(re, (_, open, close) => `${open}\n${content}${close}`);
  }
  return out;
}

module.exports = { PRODUCT_TYPES, renderPage };
