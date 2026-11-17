/**
 * Builds the product cards, the enquiry-form product list and the footer
 * product links from product data. Used by server.js on every page request,
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
    return `${indent}<div class="product-card">
${indent}  <div class="product-img">
${indent}    <img src="${esc(imgUrl(p.image))}" alt="${esc(p.name)}" width="800" height="500" loading="lazy" decoding="async" />${badge}
${indent}  </div>
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

function renderFooter(data, indent = '            ') {
  const items = (data.stone || []).slice(0, 5)
    .map((p) => `${indent}<li><a href="#products">${esc(p.name)}</a></li>`);
  if ((data.sand || []).length) items.push(`${indent}<li><a href="#sand">Sand Products</a></li>`);
  return items.join('\n');
}

/** Replaces each marked region of the page with freshly built HTML. */
function renderPage(html, data) {
  const regions = {
    'PRODUCTS:stone': renderCards('stone', data.stone || []),
    'PRODUCTS:sand': renderCards('sand', data.sand || []),
    'PRODUCT-OPTIONS': renderOptions(data),
    'FOOTER-PRODUCTS': renderFooter(data),
  };
  let out = html;
  for (const [name, content] of Object.entries(regions)) {
    const re = new RegExp(`(<!-- ${name} -->)[\\s\\S]*?(\\n[ \\t]*<!-- /${name} -->)`);
    out = out.replace(re, (_, open, close) => `${open}\n${content}${close}`);
  }
  return out;
}

module.exports = { PRODUCT_TYPES, renderPage };
