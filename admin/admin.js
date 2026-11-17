/* F B Group — Dashboard */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const screens = { loading: $('screenLoading'), login: $('screenLogin'), app: $('screenApp') };

  let state = { max: 5, banners: [], defaults: [] };

  /* ---------------- helpers ---------------- */

  function show(name) {
    Object.entries(screens).forEach(([k, el]) => { el.hidden = k !== name; });
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401 && !path.endsWith('/login')) {
      show('login');
      throw new Error(data.error || 'Please sign in again.');
    }
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { field: data.field });
    return data;
  }

  let toastTimer;
  function toast(msg, isError = false) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('error', isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), isError ? 6000 : 3000);
  }

  /* ---------------- auth ---------------- */

  async function boot() {
    try {
      const s = await api('/api/admin/session');
      $('loginNotConfigured').hidden = s.configured;
      $('loginBtn').disabled = !s.configured;
      if (s.loggedIn) {
        await loadBanners();
        show('app');
        route();
      } else {
        show('login');
        if (s.configured) $('password').focus();
      }
    } catch (err) {
      screens.loading.textContent = 'The dashboard needs the site server. Start it with: node server.js';
    }
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('password').value;
    const err = $('loginError');
    err.textContent = '';
    if (!pw) { err.textContent = 'Enter the dashboard password.'; $('password').focus(); return; }
    $('loginBtn').disabled = true;
    $('loginBtn').textContent = 'Signing in…';
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: pw }) });
      $('password').value = '';
      await loadBanners();
      show('app');
      route();
    } catch (ex) {
      err.textContent = ex.message;
      $('password').select();
    } finally {
      $('loginBtn').disabled = false;
      $('loginBtn').textContent = 'Sign in';
    }
  });

  async function logout() {
    try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); } catch { /* ignore */ }
    show('login');
    $('password').focus();
  }
  $('logoutBtn').addEventListener('click', logout);
  $('logoutBtnTop').addEventListener('click', logout);

  /* ---------------- banners ---------------- */

  async function loadBanners() {
    const data = await api('/api/admin/banners');
    state = { max: data.max, banners: data.banners, defaults: data.defaults };
    render();
  }

  function render() {
    const { banners, defaults, max } = state;
    const pill = $('countPill');
    pill.textContent = `${banners.length} / ${max}`;
    pill.classList.toggle('is-full', banners.length >= max);

    const full = banners.length >= max;
    $('fileInput').disabled = full;
    $('dropzone').classList.toggle('is-disabled', full);
    $('dropzone').querySelector('.dz-main').innerHTML = full
      ? '<strong>All 5 slots are used.</strong> Delete a banner to add another.'
      : '<strong>Choose images</strong> or drag them here';

    // Defaults
    $('defaultsPanel').hidden = banners.length > 0;
    if (!banners.length) {
      $('defaultGrid').innerHTML = '';
      defaults.forEach((d, i) => {
        const fig = document.createElement('figure');
        const pair = document.createElement('div');
        pair.className = 'default-pair';
        const img = document.createElement('img');
        img.src = d.srcSmall || d.src;
        img.alt = d.alt;
        img.loading = 'lazy';
        pair.appendChild(img);
        if (d.srcPhone) {
          const ph = document.createElement('img');
          ph.src = d.srcPhone;
          ph.alt = '';
          ph.className = 'default-phone';
          ph.loading = 'lazy';
          pair.appendChild(ph);
        }
        const cap = document.createElement('figcaption');
        cap.textContent = d.srcPhone ? `Default ${i + 1} · computer and phone versions` : `Default ${i + 1}`;
        fig.append(pair, cap);
        $('defaultGrid').appendChild(fig);
      });
    }

    // Custom list
    $('listPanel').hidden = banners.length === 0;
    const list = $('bannerList');
    list.innerHTML = '';
    banners.forEach((b, i) => list.appendChild(bannerItem(b, i, banners.length)));
  }

  function bannerItem(b, index, total) {
    const node = $('bannerTpl').content.firstElementChild.cloneNode(true);
    node.dataset.id = b.id;
    node.querySelector('.banner-num').textContent = index + 1;

    const pickImg = node.querySelector('.focus-pick img');
    pickImg.src = b.srcSmall || b.src;
    const desktopPv = node.querySelector('.pv-desktop img');
    const phonePv = node.querySelector('.pv-mobile img');
    desktopPv.src = b.srcSmall || b.src;

    const dot = node.querySelector('.focus-dot');
    const saveState = node.querySelector('.save-state');

    function applyFocus(x, y) {
      dot.style.left = x + '%';
      dot.style.top = y + '%';
      desktopPv.style.objectPosition = `${x}% ${y}%`;
      // Without a phone version, phones show the main image cropped around the focus point
      if (!b.srcPhone) phonePv.style.objectPosition = `${x}% ${y}%`;
    }

    // Phone version
    const phoneRow = node.querySelector('.phone-version');
    const phoneInput = node.querySelector('.phone-input');
    function renderPhone() {
      const has = Boolean(b.srcPhone);
      phoneRow.classList.toggle('has-phone', has);
      node.querySelector('.pv-thumb img').src = has ? b.srcPhone : '';
      node.querySelector('.pv-status').textContent = has
        ? 'Added. Phones show this image.'
        : 'Not added. Phones show the main image, cropped around the focus point.';
      node.querySelector('.phone-add-text').textContent = has ? 'Replace' : 'Add phone version';
      phonePv.src = has ? b.srcPhone : (b.srcSmall || b.src);
      phonePv.style.objectPosition = has ? '50% 50%' : `${b.focusX}% ${b.focusY}%`;
    }
    renderPhone();
    applyFocus(b.focusX, b.focusY);

    phoneInput.addEventListener('change', async () => {
      const file = phoneInput.files[0];
      phoneInput.value = '';
      if (!file) return;
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast('Please choose a JPG, PNG or WebP image.', true); return; }
      phoneRow.classList.add('is-busy');
      saveState.className = 'save-state';
      saveState.textContent = 'Uploading phone version…';
      try {
        const img = await loadImage(file);
        const res = await api(`/api/admin/banners/${b.id}/phone`, {
          method: 'PUT',
          body: JSON.stringify({ image: encode(img, 1080, 0.82) }),
        });
        Object.assign(b, res.banner);
        renderPhone();
        saveState.className = 'save-state ok';
        saveState.textContent = 'Phone version saved';
        if (img.naturalWidth >= img.naturalHeight) {
          toast(`${file.name} is landscape. A tall portrait image (about 1080 × 2400 px) fills phone screens best.`, true);
        }
      } catch (err) {
        saveState.className = 'save-state err';
        saveState.textContent = err.message;
      } finally {
        phoneRow.classList.remove('is-busy');
      }
    });

    node.querySelector('.phone-remove').addEventListener('click', async () => {
      phoneRow.classList.add('is-busy');
      try {
        const res = await api(`/api/admin/banners/${b.id}/phone`, { method: 'DELETE' });
        Object.assign(b, res.banner);
        renderPhone();
        saveState.className = 'save-state ok';
        saveState.textContent = 'Phone version removed';
      } catch (err) {
        saveState.className = 'save-state err';
        saveState.textContent = err.message;
      } finally {
        phoneRow.classList.remove('is-busy');
      }
    });

    async function save(patch, label) {
      saveState.className = 'save-state';
      saveState.textContent = 'Saving…';
      try {
        const res = await api(`/api/admin/banners/${b.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
        Object.assign(b, res.banner);
        saveState.className = 'save-state ok';
        saveState.textContent = label;
      } catch (err) {
        saveState.className = 'save-state err';
        saveState.textContent = err.message;
      }
    }

    const pick = node.querySelector('.focus-pick');
    pick.addEventListener('click', (e) => {
      const r = pickImg.getBoundingClientRect();
      const x = Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
      const y = Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)));
      applyFocus(x, y);
      save({ focusX: x, focusY: y }, 'Focus point saved');
    });
    // Keyboard: arrow keys move the focus point
    pick.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 10 : 2;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (!moves[e.key]) return;
      e.preventDefault();
      b.focusX = Math.min(100, Math.max(0, b.focusX + moves[e.key][0]));
      b.focusY = Math.min(100, Math.max(0, b.focusY + moves[e.key][1]));
      applyFocus(b.focusX, b.focusY);
      clearTimeout(pick._t);
      pick._t = setTimeout(() => save({ focusX: b.focusX, focusY: b.focusY }, 'Focus point saved'), 500);
    });

    const alt = node.querySelector('.alt-input');
    alt.value = b.alt || '';
    alt.addEventListener('change', () => save({ alt: alt.value }, 'Description saved'));

    const up = node.querySelector('.move-up');
    const down = node.querySelector('.move-down');
    up.disabled = index === 0;
    down.disabled = index === total - 1;
    up.addEventListener('click', () => move(index, -1));
    down.addEventListener('click', () => move(index, 1));

    node.querySelector('.delete-btn').addEventListener('click', () => remove(b));
    return node;
  }

  async function move(index, dir) {
    const ids = state.banners.map((b) => b.id);
    const to = index + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    try {
      const res = await api('/api/admin/banners/order', { method: 'PUT', body: JSON.stringify({ ids }) });
      state.banners = res.banners;
      render();
      const btn = document.querySelector(`.banner[data-id="${ids[to]}"] ${dir < 0 ? '.move-up' : '.move-down'}`);
      (btn && !btn.disabled ? btn : document.querySelector(`.banner[data-id="${ids[to]}"] .alt-input`)).focus();
      toast('Order saved');
    } catch (err) {
      toast(err.message, true);
    }
  }

  function confirmDelete(title = 'Delete this banner?', button = 'Delete banner') {
    $('confirmTitle').textContent = title;
    $('confirmBtn').textContent = button;
    const dlg = $('confirmDialog');
    // Answer from the button clicks and Esc directly, with the close event only as a fallback,
    // so the answer never depends on one event firing.
    return new Promise((resolve) => {
      let done = false;
      const finish = (yes) => {
        if (done) return;
        done = true;
        dlg.removeEventListener('click', onClick);
        dlg.removeEventListener('cancel', onCancel);
        dlg.removeEventListener('close', onClose);
        if (dlg.open) dlg.close();
        resolve(yes);
      };
      const onClick = (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        e.preventDefault();
        finish(btn.value === 'confirm');
      };
      const onCancel = (e) => { e.preventDefault(); finish(false); };
      const onClose = () => finish(dlg.returnValue === 'confirm');
      dlg.returnValue = '';
      dlg.addEventListener('click', onClick);
      dlg.addEventListener('cancel', onCancel);
      dlg.addEventListener('close', onClose);
      dlg.showModal();
    });
  }

  async function remove(b) {
    const last = state.banners.length === 1;
    $('confirmText').textContent = last
      ? "This is your last uploaded banner. Once it's deleted, the homepage goes back to the 3 default banners."
      : "It will be removed from the homepage straight away. This can't be undone.";
    if (!(await confirmDelete())) return;
    try {
      await api(`/api/admin/banners/${b.id}`, { method: 'DELETE' });
      state.banners = state.banners.filter((x) => x.id !== b.id);
      render();
      toast(last ? 'Banner deleted. The homepage is using the default banners again.' : 'Banner deleted');
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ---------------- upload ---------------- */

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name} could not be read as an image.`)); };
      img.src = url;
    });
  }

  function encode(img, maxWidth, quality) {
    const scale = Math.min(1, maxWidth / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    let data = canvas.toDataURL('image/webp', quality);
    if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', quality);
    return data;
  }

  function altFromName(name) {
    return name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  }

  async function uploadFiles(fileList) {
    const files = Array.from(fileList).filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    const skippedType = fileList.length - files.length;
    const room = state.max - state.banners.length;
    if (room <= 0) { toast('All 5 slots are used. Delete a banner first.', true); return; }
    const batch = files.slice(0, room);
    const warnings = [];
    if (skippedType) warnings.push(`${skippedType} file(s) skipped: only JPG, PNG and WebP images can be used.`);
    if (files.length > room) warnings.push(`Only ${room} more banner(s) fit, so ${files.length - room} image(s) were not added.`);
    if (!batch.length) { toast(warnings.join(' ') || 'No images selected.', true); return; }

    const progress = $('uploadProgress');
    const bar = $('uploadBar');
    const text = $('uploadText');
    progress.hidden = false;
    $('fileInput').disabled = true;

    let done = 0;
    for (const file of batch) {
      text.textContent = `Uploading ${file.name} (${done + 1} of ${batch.length})…`;
      bar.style.width = `${(done / batch.length) * 100 + 10}%`;
      try {
        const img = await loadImage(file);
        if (img.naturalWidth < 1200) warnings.push(`${file.name} is only ${img.naturalWidth}px wide and may look blurry on large screens.`);
        if (img.naturalHeight > img.naturalWidth) warnings.push(`${file.name} is a portrait image. Landscape images fill the banner better on computers.`);
        const body = {
          alt: altFromName(file.name),
          focusX: 50,
          focusY: 50,
          image: encode(img, 2000, 0.82),
          imageSmall: encode(img, 1000, 0.8),
        };
        const res = await api('/api/admin/banners', { method: 'POST', body: JSON.stringify(body) });
        state.banners.push(res.banner);
        done += 1;
        render();
      } catch (err) {
        warnings.push(`${file.name}: ${err.message}`);
      }
      bar.style.width = `${(done / batch.length) * 100}%`;
    }

    progress.hidden = true;
    bar.style.width = '0';
    $('fileInput').value = '';
    render();
    if (done) toast(`${done} banner${done > 1 ? 's' : ''} added. Click each photo to set its focus point.`);
    if (warnings.length) setTimeout(() => toast(warnings.join(' '), true), done ? 3200 : 0);
  }

  $('fileInput').addEventListener('change', (e) => uploadFiles(e.target.files));

  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault();
    if (!$('fileInput').disabled) dz.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault();
    dz.classList.remove('is-over');
  }));
  dz.addEventListener('drop', (e) => {
    if ($('fileInput').disabled) return;
    if (e.dataTransfer && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });

  /* ================= Pages ================= */

  const VIEWS = ['banners', 'stone', 'sand'];

  function route() {
    let view = (location.hash || '#banners').slice(1);
    if (!VIEWS.includes(view)) view = 'banners';
    document.querySelectorAll('[data-view]').forEach((a) => {
      const on = a.dataset.view === view;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $('view-banners').hidden = view !== 'banners';
    $('view-products').hidden = view === 'banners';
    if (view !== 'banners') openProducts(view);
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => { if (!screens.app.hidden) route(); });

  /* ================= Products ================= */

  const PRODUCT_TYPES = {
    stone: {
      title: 'Stone products',
      singular: 'stone product',
      intro: 'The cards in the Products section of the homepage. They also fill the enquiry form’s product list and the footer.',
      list: { key: 'sizes', legend: 'Sizes', label: 'Size', hint: 'Up to 5 sizes, e.g. 10–20 mm. Shown together on the card.', placeholder: 'e.g. 10–20 mm', add: '+ Add size' },
      fields: [
        { key: 'use', label: 'Use', placeholder: 'e.g. Concrete / RCC' },
        { key: 'origin', label: 'Origin', placeholder: 'e.g. Oman' },
        { key: 'shape', label: 'Shape', placeholder: 'e.g. Cubical' },
      ],
    },
    sand: {
      title: 'Sand products',
      singular: 'sand product',
      intro: 'The cards in the Sand Products section of the homepage. They also fill the enquiry form’s product list.',
      list: { key: 'fm', legend: 'FM (fineness modulus)', label: 'FM', hint: 'Up to 5 FM values, e.g. 2.5+ or 1.8–2.2. Shown together on the card.', placeholder: 'e.g. 2.5+', add: '+ Add FM' },
      fields: [
        { key: 'use', label: 'Use', placeholder: 'e.g. Concrete / RCC' },
        { key: 'source', label: 'Source', placeholder: 'e.g. Sylhet' },
        { key: 'grade', label: 'Grade', placeholder: 'e.g. Screened' },
      ],
    },
  };

  const prod = { type: 'stone', max: 30, maxList: 5, items: [], editing: null, image: null, loaded: null };

  async function openProducts(type) {
    const t = PRODUCT_TYPES[type];
    prod.type = type;
    $('prodTitle').textContent = t.title;
    $('prodIntro').textContent = t.intro;
    $('prodAddBtn').textContent = `+ Add ${t.singular}`;
    closeEditor();
    $('prodList').innerHTML = '';
    $('prodEmpty').hidden = true;
    try {
      const data = await api(`/api/admin/products?type=${type}`);
      if (prod.type !== type) return; // user switched page meanwhile
      prod.max = data.max;
      prod.maxList = data.maxList;
      prod.items = data.products;
      renderProducts();
    } catch (err) {
      toast(err.message, true);
    }
  }

  function renderProducts() {
    const t = PRODUCT_TYPES[prod.type];
    const { items } = prod;
    $('prodCount').textContent = `${items.length} / ${prod.max}`;
    $('prodCount').classList.toggle('is-full', items.length >= prod.max);
    $('prodAddBtn').disabled = items.length >= prod.max;
    $('prodEmpty').hidden = items.length > 0;
    const list = $('prodList');
    list.innerHTML = '';
    items.forEach((p, i) => {
      const node = $('prodTpl').content.firstElementChild.cloneNode(true);
      node.dataset.id = p.id;
      if (prod.editing === p.id) node.classList.add('is-editing');
      const img = node.querySelector('.prod-thumb');
      img.src = p.image;
      node.querySelector('.prod-name').textContent = p.name;
      node.querySelector('.prod-desc').textContent = p.description;
      const specs = node.querySelector('.prod-specs');
      if (p.label) {
        const tag = document.createElement('span');
        tag.className = 'prod-label';
        tag.title = 'Label shown on the photo';
        tag.textContent = p.label;
        specs.appendChild(tag);
      }
      const chips = [];
      const values = p[t.list.key] || [];
      if (values.length) chips.push([t.list.label, values.join(' · ')]);
      t.fields.forEach((f) => { if (p[f.key]) chips.push([f.label, p[f.key]]); });
      chips.forEach(([label, value]) => {
        const chip = document.createElement('span');
        const b = document.createElement('b');
        b.textContent = `${label}: `;
        chip.append(b, document.createTextNode(value));
        specs.appendChild(chip);
      });
      const up = node.querySelector('.move-up');
      const down = node.querySelector('.move-down');
      up.disabled = i === 0;
      down.disabled = i === items.length - 1;
      up.addEventListener('click', () => moveProduct(i, -1));
      down.addEventListener('click', () => moveProduct(i, 1));
      node.querySelector('.edit-btn').addEventListener('click', () => openEditor(p));
      node.querySelector('.delete-btn').addEventListener('click', () => deleteProduct(p));
      list.appendChild(node);
    });
  }

  /* ---------- editor ---------- */

  function listInputs() {
    return Array.from($('pfList').querySelectorAll('input'));
  }

  function addListInput(value = '') {
    const t = PRODUCT_TYPES[prod.type];
    if (listInputs().length >= prod.maxList) return;
    const row = document.createElement('div');
    row.className = 'pf-list-item';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 30;
    input.value = value;
    input.placeholder = t.list.placeholder;
    input.setAttribute('aria-label', `${t.list.label} ${listInputs().length + 1}`);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn';
    del.setAttribute('aria-label', `Remove this ${t.list.label}`);
    del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    del.addEventListener('click', () => {
      row.remove();
      if (!listInputs().length) addListInput();
      updateListAdd();
    });
    row.append(input, del);
    $('pfList').appendChild(row);
    updateListAdd();
    return input;
  }

  function updateListAdd() {
    $('pfListAdd').hidden = listInputs().length >= prod.maxList;
  }

  function setImagePreview(src) {
    const box = $('pfImagePreview');
    box.style.backgroundImage = src ? `url("${src.replace(/"/g, '%22')}")` : '';
    box.classList.toggle('has-image', Boolean(src));
    $('pfImageBtnText').textContent = src ? 'Change image' : 'Choose image';
  }

  function clearErrors() {
    ['pfNameErr', 'pfDescErr', 'pfListErr', 'pfImageErr'].forEach((id) => { $(id).textContent = ''; });
    document.querySelectorAll('#prodForm .has-error').forEach((el) => el.classList.remove('has-error'));
    ['pfName', 'pfDesc'].forEach((id) => $(id).removeAttribute('aria-invalid'));
    $('prodState').textContent = '';
    $('prodState').className = 'save-state';
  }

  function showError(field, msg) {
    const map = {
      name: ['pfName', 'pfNameErr'],
      description: ['pfDesc', 'pfDescErr'],
      image: [null, 'pfImageErr'],
    };
    const t = PRODUCT_TYPES[prod.type];
    const [inputId, errId] = map[field] || (field === t.list.key ? [null, 'pfListErr'] : [null, null]);
    if (!errId) { toast(msg, true); return; }
    $(errId).textContent = msg;
    if (inputId) {
      $(inputId).closest('.pf-field').classList.add('has-error');
      $(inputId).setAttribute('aria-invalid', 'true');
      $(inputId).setAttribute('aria-describedby', errId);
      $(inputId).focus();
    } else if (field === 'image') {
      $('pfImageErr').closest('.pf-side').classList.add('has-error');
      $('pfImage').focus();
    }
  }

  function openEditor(p = null) {
    const t = PRODUCT_TYPES[prod.type];
    prod.editing = p ? p.id : null;
    prod.image = null;
    clearErrors();
    $('prodEditorTitle').textContent = p ? `Edit ${t.singular}` : `Add ${t.singular}`;
    $('prodSave').textContent = p ? 'Save changes' : `Add ${t.singular}`;
    $('pfName').value = p ? p.name : '';
    $('pfLabel').value = p ? (p.label || '') : '';
    $('pfDesc').value = p ? p.description : '';
    updateDescCount();
    $('pfListLegend').textContent = t.list.legend;
    $('pfListHint').textContent = t.list.hint;
    $('pfListAdd').textContent = t.list.add;
    $('pfList').innerHTML = '';
    const values = p ? (p[t.list.key] || []) : [];
    (values.length ? values : ['']).forEach((v) => addListInput(v));
    t.fields.forEach((f, i) => {
      $(`pfOpt${i}Label`).textContent = f.label;
      $(`pfOpt${i}`).placeholder = f.placeholder;
      $(`pfOpt${i}`).value = p ? (p[f.key] || '') : '';
    });
    setImagePreview(p ? p.image : '');
    $('prodEditor').hidden = false;
    renderProducts();
    $('prodEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => $('pfName').focus({ preventScroll: true }), 300);
  }

  function closeEditor() {
    prod.editing = null;
    prod.image = null;
    $('prodEditor').hidden = true;
    $('prodForm').reset();
    document.querySelectorAll('.prod-item.is-editing').forEach((el) => el.classList.remove('is-editing'));
  }

  function updateDescCount() {
    $('pfDescCount').textContent = `${$('pfDesc').value.length} / 240`;
  }

  $('pfDesc').addEventListener('input', updateDescCount);
  $('pfListAdd').addEventListener('click', () => { const input = addListInput(); if (input) input.focus(); });
  $('prodAddBtn').addEventListener('click', () => openEditor(null));
  $('prodCancel').addEventListener('click', () => {
    const editingId = prod.editing;
    closeEditor();
    const btn = editingId && document.querySelector(`.prod-item[data-id="${editingId}"] .edit-btn`);
    (btn || $('prodAddBtn')).focus();
  });

  $('pfImage').addEventListener('change', async () => {
    const file = $('pfImage').files[0];
    $('pfImage').value = '';
    if (!file) return;
    $('pfImageErr').textContent = '';
    $('pfImageErr').closest('.pf-side').classList.remove('has-error');
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { showError('image', 'Please choose a JPG, PNG or WebP image.'); return; }
    try {
      const img = await loadImage(file);
      prod.image = encode(img, 1200, 0.82);
      setImagePreview(prod.image);
      if (img.naturalWidth < 800) toast(`${file.name} is only ${img.naturalWidth}px wide and may look blurry.`, true);
      else if (img.naturalHeight > img.naturalWidth) toast(`${file.name} is portrait. The card shows it cropped to a landscape shape.`, true);
    } catch (err) {
      showError('image', err.message);
    }
  });

  $('prodForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    const t = PRODUCT_TYPES[prod.type];
    const body = {
      type: prod.type,
      name: $('pfName').value.trim(),
      label: $('pfLabel').value.trim(),
      description: $('pfDesc').value.trim(),
      [t.list.key]: listInputs().map((i) => i.value.trim()).filter(Boolean),
    };
    t.fields.forEach((f, i) => { body[f.key] = $(`pfOpt${i}`).value.trim(); });
    if (prod.image) body.image = prod.image;

    // Check in the browser first, so mistakes show at once
    if (!body.name) return showError('name', 'Please enter a product name.');
    if (!body.description) return showError('description', 'Please enter a short description.');
    if (!prod.editing && !body.image) return showError('image', 'Please add an image for this product.');

    const btn = $('prodSave');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      if (prod.editing) {
        const res = await api(`/api/admin/products/${prod.editing}`, { method: 'PUT', body: JSON.stringify(body) });
        prod.items = prod.items.map((p) => (p.id === res.product.id ? res.product : p));
        toast(`${res.product.name} saved`);
      } else {
        const res = await api('/api/admin/products', { method: 'POST', body: JSON.stringify(body) });
        prod.items.push(res.product);
        toast(`${res.product.name} added to the website`);
      }
      const savedId = prod.editing;
      closeEditor();
      renderProducts();
      const focusBtn = savedId && document.querySelector(`.prod-item[data-id="${savedId}"] .edit-btn`);
      (focusBtn || $('prodAddBtn')).focus();
    } catch (err) {
      const field = err.field;
      if (field) showError(field, err.message);
      else {
        $('prodState').className = 'save-state err';
        $('prodState').textContent = err.message;
      }
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  async function moveProduct(index, dir) {
    const ids = prod.items.map((p) => p.id);
    const to = index + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    try {
      const res = await api('/api/admin/products/order', { method: 'PUT', body: JSON.stringify({ type: prod.type, ids }) });
      prod.items = res.products;
      renderProducts();
      const btn = document.querySelector(`.prod-item[data-id="${ids[to]}"] ${dir < 0 ? '.move-up' : '.move-down'}`);
      (btn && !btn.disabled ? btn : document.querySelector(`.prod-item[data-id="${ids[to]}"] .edit-btn`)).focus();
      toast('Order saved');
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function deleteProduct(p) {
    $('confirmText').textContent = `${p.name} will be removed from the website straight away. This can't be undone.`;
    if (!(await confirmDelete('Delete this product?', 'Delete product'))) return;
    try {
      await api(`/api/admin/products/${p.id}`, { method: 'DELETE' });
      if (prod.editing === p.id) closeEditor();
      prod.items = prod.items.filter((x) => x.id !== p.id);
      renderProducts();
      toast(`${p.name} deleted`);
    } catch (err) {
      toast(err.message, true);
    }
  }

  boot();
})();
