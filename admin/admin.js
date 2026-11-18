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

  /** Red warning at the top of every page if saved data would not survive a redeploy. */
  function showStorageWarning(st) {
    const box = $('storageAlert');
    if (!st) { box.hidden = true; return; }
    if (st.writable === false) {
      $('storageAlertTitle').textContent = 'The website cannot save changes';
      $('storageAlertText').innerHTML = 'The server is not allowed to write to its data folder (<code></code>). In Coolify, use <b>Persistent Storage → Volume Mount</b> (not a directory mount) with destination <code>/app/data</code>, then redeploy.';
    } else if (st.persistent === false) {
      $('storageAlertTitle').textContent = 'Changes will be lost on the next redeploy';
      $('storageAlertText').innerHTML = 'Products, banners, quotation requests and statistics are saved in <code></code>, but that folder is not permanent storage. In Coolify open this app → <b>Persistent Storage</b> → <b>+ Add</b> → <b>Volume Mount</b>, destination <code>/app/data</code>, then redeploy. Until then, avoid adding content.';
    } else {
      box.hidden = true;
      return;
    }
    box.querySelector('code').textContent = st.dir;
    box.hidden = false;
  }

  async function boot() {
    try {
      const s = await api('/api/admin/session');
      if (s.loggedIn) {
        showStorageWarning(s.storage);
        await loadBanners();
        show('app');
        route();
      } else {
        show('login');
        $('username').focus();
      }
    } catch (err) {
      screens.loading.textContent = 'The dashboard needs the site server. Start it with: node server.js';
    }
  }

  // Show / hide the password
  $('pwToggle').addEventListener('click', () => {
    const input = $('password');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('pwToggle').setAttribute('aria-pressed', String(show));
    $('pwToggle').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    input.focus();
  });

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = $('username').value.trim();
    const pw = $('password').value;
    const err = $('loginError');
    err.textContent = '';
    if (!user) { err.textContent = 'Enter your username.'; $('username').focus(); return; }
    if (!pw) { err.textContent = 'Enter your password.'; $('password').focus(); return; }
    $('loginBtn').disabled = true;
    $('loginBtn').textContent = 'Signing in…';
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: user, password: pw }) });
      api('/api/admin/session').then((s) => showStorageWarning(s.storage)).catch(() => {});
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
    $('username').focus();
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
    const { banners, max } = state;
    const pill = $('countPill');
    pill.textContent = `${banners.length} / ${max}`;
    pill.classList.toggle('is-full', banners.length >= max);

    const full = banners.length >= max;
    $('fileInput').disabled = full;
    $('dropzone').classList.toggle('is-disabled', full);
    $('dropzone').querySelector('.dz-main').innerHTML = full
      ? '<strong>All 5 slots are used.</strong> Delete a banner to add another.'
      : '<strong>Choose images</strong> or drag them here';


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

  const VIEWS = ['overview', 'stone', 'sand', 'quotes', 'settings'];

  function route() {
    let view = (location.hash || '#overview').slice(1);
    if (view === 'banners') view = 'settings'; // old address
    if (!VIEWS.includes(view)) view = 'overview';
    document.querySelectorAll('[data-view]').forEach((a) => {
      const on = a.dataset.view === view;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $('view-overview').hidden = view !== 'overview';
    $('view-settings').hidden = view !== 'settings';
    $('view-products').hidden = view !== 'stone' && view !== 'sand';
    $('view-quotes').hidden = view !== 'quotes';
    if (view === 'stone' || view === 'sand') openProducts(view);
    if (view === 'quotes') loadQuotes();
    else refreshQuoteBadge();
    if (view === 'overview') loadOverview();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => { if (!screens.app.hidden) route(); });

  /* ================= Products ================= */

  const PRODUCT_TYPES = {
    stone: {
      title: 'Stone products',
      singular: 'stone product',
      intro: 'The cards in the Products section of the homepage. They also fill the enquiry form’s product list.',
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

  /* ================= Quotation requests ================= */

  const quotes = { items: [], filter: 'all' };

  function setNewCount(n) {
    document.querySelectorAll('[data-new-count]').forEach((el) => {
      el.textContent = n > 99 ? '99+' : String(n);
      el.hidden = n === 0;
      el.setAttribute('aria-label', `${n} new`);
    });
  }

  async function refreshQuoteBadge() {
    try {
      const data = await api('/api/admin/quotes');
      quotes.items = data.quotes;
      setNewCount(data.newCount);
    } catch { /* badge only */ }
  }

  async function loadQuotes() {
    try {
      const data = await api('/api/admin/quotes');
      quotes.items = data.quotes;
      renderQuotes();
    } catch (err) {
      toast(err.message, true);
    }
  }

  function formatWhen(iso) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function renderQuotes() {
    const all = quotes.items;
    const counts = {
      all: all.length,
      new: all.filter((q) => q.status === 'new').length,
      contacted: all.filter((q) => q.status === 'contacted').length,
    };
    setNewCount(counts.new);
    document.querySelectorAll('[data-count]').forEach((el) => { el.textContent = `(${counts[el.dataset.count]})`; });
    document.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === quotes.filter)));

    const shown = quotes.filter === 'all' ? all : all.filter((q) => q.status === quotes.filter);
    const list = $('quoteList');
    list.innerHTML = '';
    const empty = $('quoteEmpty');
    empty.hidden = shown.length > 0;
    empty.textContent = all.length === 0
      ? 'No quotation requests yet. They appear here as soon as someone sends the Request a Quote form on the homepage.'
      : 'No requests in this list.';

    shown.forEach((q) => list.appendChild(quoteItem(q)));
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function quoteItem(q) {
    const li = el('li', 'quote' + (q.status === 'new' ? ' is-new' : ''));
    li.dataset.id = q.id;

    const head = el('div', 'quote-head');
    const who = el('div', 'quote-who');
    who.append(el('strong', '', q.name));
    if (q.company) who.append(el('span', '', q.company));
    const meta = el('div', 'quote-meta');
    meta.append(el('time', '', formatWhen(q.createdAt)));
    meta.lastChild.dateTime = q.createdAt;
    meta.append(el('span', `quote-status ${q.status}`, q.status === 'new' ? 'New' : 'Contacted'));
    head.append(who, meta);

    const dl = el('dl', 'quote-details');
    const add = (label, value, href) => {
      if (!value) return;
      const row = el('div');
      row.append(el('dt', '', label));
      const dd = el('dd');
      if (href) {
        const a = el('a', '', value);
        a.href = href;
        dd.append(a);
      } else dd.textContent = value;
      row.append(dd);
      dl.append(row);
    };
    add('Product', q.product);
    add('Quantity', q.quantity);
    add('Discharge port', q.port);
    add('Email', q.email, `mailto:${encodeURIComponent(q.email).replace(/%40/g, '@')}`);
    add('Phone', q.phone, `tel:${q.phone.replace(/[^\d+]/g, '')}`);

    li.append(head, dl);
    if (q.message) li.append(el('p', 'quote-message', q.message));

    const actions = el('div', 'quote-actions');
    const reply = el('a', 'btn btn-primary btn-sm', 'Reply by email');
    const subject = `Your quotation request${q.product ? ` – ${q.product}` : ''} | F B Group`;
    reply.href = `mailto:${encodeURIComponent(q.email).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}`;
    const toggle = el('button', 'btn btn-ghost btn-sm', q.status === 'new' ? 'Mark as contacted' : 'Mark as new');
    toggle.type = 'button';
    toggle.addEventListener('click', () => setQuoteStatus(q, q.status === 'new' ? 'contacted' : 'new'));
    const del = el('button', 'btn btn-danger btn-sm delete-btn', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => deleteQuote(q));
    actions.append(reply, toggle, del);
    li.append(actions);
    return li;
  }

  async function setQuoteStatus(q, status) {
    try {
      const res = await api(`/api/admin/quotes/${q.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      quotes.items = quotes.items.map((x) => (x.id === q.id ? res.quote : x));
      renderQuotes();
      toast(status === 'contacted' ? 'Marked as contacted' : 'Marked as new');
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function deleteQuote(q) {
    $('confirmText').textContent = `The request from ${q.name} will be deleted permanently. This can't be undone.`;
    if (!(await confirmDelete('Delete this request?', 'Delete request'))) return;
    try {
      await api(`/api/admin/quotes/${q.id}`, { method: 'DELETE' });
      quotes.items = quotes.items.filter((x) => x.id !== q.id);
      renderQuotes();
      toast('Request deleted');
    } catch (err) {
      toast(err.message, true);
    }
  }

  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
    quotes.filter = b.dataset.filter;
    renderQuotes();
  }));

  /* ================= Dashboard overview ================= */

  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const dayLabel = (iso, opts = { day: 'numeric', month: 'short' }) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', opts);

  function statTile(label, value, sub) {
    const d = el('div', 'stat');
    d.append(el('span', 'stat-label', label), el('strong', 'stat-value', fmt(value)));
    if (sub) {
      const s = el('p', 'stat-sub');
      if (sub instanceof Node) s.append(sub); else s.textContent = sub;
      d.append(s);
    }
    return d;
  }

  function change(now, before, period) {
    const span = document.createElement('span');
    if (!before && !now) { span.textContent = `No visits ${period} either`; return span; }
    if (!before) { span.textContent = `Up from 0 ${period}`; return span; }
    const pct = Math.round(((now - before) / before) * 100);
    const b = el('span', pct >= 0 ? 'up' : 'down', `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}%`);
    span.append(b, document.createTextNode(` vs ${period}`));
    return span;
  }

  let chartTip = null;
  function showTip(target, html) {
    if (!chartTip) { chartTip = el('div', 'chart-tip'); chartTip.setAttribute('role', 'presentation'); document.body.append(chartTip); }
    chartTip.innerHTML = html;
    const r = target.getBoundingClientRect();
    chartTip.style.left = `${Math.min(window.innerWidth - 80, Math.max(80, r.left + r.width / 2))}px`;
    chartTip.style.top = `${r.top + r.height - (target.firstChild ? target.firstChild.getBoundingClientRect().height : 0)}px`;
    chartTip.hidden = false;
  }
  function hideTip() { if (chartTip) chartTip.hidden = true; }

  /** A round top for the y-axis whose half is also a whole number (people can't be fractional). */
  function niceMax(v) {
    if (v <= 4) return 4;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 2, 4, 6, 8, 10]) {
      const top = m * p;
      if (top >= v && Number.isInteger(top / 2)) return top;
    }
    return 10 * p;
  }

  function renderChart(series) {
    const box = $('ovChart');
    box.innerHTML = '';
    const max = niceMax(Math.max(...series.map((d) => d.visitors), 0));
    const total = series.reduce((t, d) => t + d.visitors, 0);

    const y = el('div', 'vchart-y');
    [max, max / 2, 0].forEach((v) => y.append(el('span', '', fmt(v))));
    const plot = el('div', 'vchart-plot');
    [0, 50].forEach((pct) => { const g = el('div', 'vchart-grid'); g.style.top = `${pct}%`; plot.append(g); });
    const bars = el('div', 'vchart-bars');
    bars.setAttribute('role', 'list');
    bars.setAttribute('aria-label', `Visitors per day, last 30 days. ${fmt(total)} in total.`);
    series.forEach((d) => {
      const hit = el('div', 'vbar-hit');
      hit.tabIndex = 0;
      hit.setAttribute('role', 'listitem');
      const label = `${dayLabel(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}: ${fmt(d.visitors)} visitors, ${fmt(d.views)} page views`;
      hit.setAttribute('aria-label', label);
      const bar = el('div', 'vbar' + (d.visitors ? '' : ' is-zero'));
      bar.style.height = `${(d.visitors / max) * 100}%`;
      hit.append(bar);
      const tip = `<strong>${fmt(d.visitors)} visitors</strong>${dayLabel(d.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${fmt(d.views)} views`;
      hit.addEventListener('mouseenter', () => showTip(hit, tip));
      hit.addEventListener('focus', () => showTip(hit, tip));
      hit.addEventListener('mouseleave', hideTip);
      hit.addEventListener('blur', hideTip);
      bars.append(hit);
    });
    plot.append(bars);
    if (!total) plot.append(el('div', 'vchart-empty', 'No visits recorded yet. Visitors appear here as soon as people open the website.'));

    const x = el('div', 'vchart-x');
    [series[0], series[14], series[29]].forEach((d) => x.append(el('span', '', dayLabel(d.date))));
    box.append(y, plot, x);
    $('ovChartNote').textContent = `${fmt(total)} visitors`;

    const tbody = $('ovTable').querySelector('tbody');
    tbody.innerHTML = '';
    [...series].reverse().forEach((d) => {
      const tr = document.createElement('tr');
      tr.append(el('td', '', dayLabel(d.date, { weekday: 'short', day: 'numeric', month: 'short' })), el('td', '', fmt(d.visitors)), el('td', '', fmt(d.views)));
      tbody.append(tr);
    });
  }

  function renderSources(list) {
    const ul = $('ovSources');
    ul.innerHTML = '';
    if (!list.length) { ul.append(el('li', 'muted-note', 'No visits in the last 30 days yet.')); return; }
    const max = list[0].visitors;
    list.forEach((s) => {
      const li = el('li', 'hbar-row');
      const name = s.name === 'Direct' ? 'Direct / typed address' : s.name;
      li.append(el('span', 'name', name), el('span', 'num', fmt(s.visitors)));
      const track = el('div', 'hbar-track');
      const fill = el('div', 'hbar-fill');
      fill.style.width = `${Math.max(2, (s.visitors / max) * 100)}%`;
      track.append(fill);
      li.append(track);
      ul.append(li);
    });
  }

  function renderDevices({ mobile, desktop }) {
    const box = $('ovDevices');
    box.innerHTML = '';
    const total = mobile + desktop;
    if (!total) { box.append(el('p', 'muted-note', 'No visits in the last 30 days yet.')); return; }
    const pm = Math.round((mobile / total) * 100);
    const wrap = el('div', 'devices');
    const bar = el('div', 'split-bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `Phones and tablets ${pm}%, computers ${100 - pm}%`);
    const a = el('span'); a.style.width = `${pm}%`;
    const b = el('span'); b.style.width = `${100 - pm}%`;
    bar.append(a, b);
    const legend = el('div', 'split-legend');
    const item = (color, label, pct, n) => {
      const s = el('span');
      const i = el('i'); i.style.background = color;
      s.append(i, document.createTextNode(`${label} `), el('b', '', `${pct}%`), document.createTextNode(` (${fmt(n)})`));
      return s;
    };
    legend.append(item('var(--blue)', 'Phones & tablets', pm, mobile), item('var(--green)', 'Computers', 100 - pm, desktop));
    wrap.append(bar, legend);
    box.append(wrap);
  }

  function renderQuotesPanel(q) {
    const box = $('ovQuoteStats');
    box.innerHTML = '';
    [['New', q.new], ['Last 30 days', q.last30], ['Total', q.total]].forEach(([label, n]) => {
      const d = el('div');
      d.append(el('b', '', fmt(n)), el('span', '', label));
      box.append(d);
    });
    const ul = $('ovRecent');
    ul.innerHTML = '';
    if (!q.recent.length) { ul.append(el('li', 'muted-note', 'No requests yet.')); return; }
    q.recent.forEach((r) => {
      const li = el('li');
      const who = el('div', 'who');
      who.append(el('strong', '', r.name), el('span', '', [r.product, r.company].filter(Boolean).join(' · ')));
      const t = el('time', '', formatWhen(r.createdAt));
      t.dateTime = r.createdAt;
      li.append(who, t);
      ul.append(li);
    });
  }

  function renderContent(c) {
    const ul = $('ovContent');
    ul.innerHTML = '';
    [
      ['#stone', 'Stone products', c.stone],
      ['#sand', 'Sand products', c.sand],
      ['#settings', 'Hero banners', c.banners ? c.banners : 'Default (3)'],
    ].forEach(([href, label, n]) => {
      const li = el('li');
      const a = el('a');
      a.href = href;
      a.append(el('span', '', label), el('b', '', typeof n === 'number' ? fmt(n) : n));
      li.append(a);
      ul.append(li);
    });
  }

  async function loadOverview() {
    try {
      const s = await api('/api/admin/stats');
      const started = new Date(s.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      $('ovIntro').textContent = `Website activity at a glance. Visitor counting started on ${started}; each person is counted once per day.`;
      const stats = $('ovStats');
      stats.innerHTML = '';
      stats.append(
        statTile('Visitors today', s.visitors.today, change(s.visitors.today, s.visitors.yesterday, 'yesterday')),
        statTile('Last 7 days', s.visitors.last7, change(s.visitors.last7, s.visitors.prev7, 'the 7 days before')),
        statTile('Last 30 days', s.visitors.last30, `${fmt(s.views.last30)} page views`),
        statTile('All-time visits', s.visitors.allTime, `Since ${started}`),
      );
      renderChart(s.series);
      renderSources(s.topSources);
      renderDevices(s.devices);
      renderQuotesPanel(s.quotes);
      renderContent(s.content);
      setNewCount(s.quotes.new);
    } catch (err) {
      toast(err.message, true);
    }
  }
  $('ovRefresh').addEventListener('click', loadOverview);

  boot();
})();
