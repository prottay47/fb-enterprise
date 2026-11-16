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
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
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
        const img = document.createElement('img');
        img.src = d.srcSmall || d.src;
        img.alt = d.alt;
        img.loading = 'lazy';
        const cap = document.createElement('figcaption');
        cap.textContent = `Default ${i + 1}`;
        fig.append(img, cap);
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
    node.querySelectorAll('.pv-frame img').forEach((img) => { img.src = b.srcSmall || b.src; });

    const dot = node.querySelector('.focus-dot');
    const saveState = node.querySelector('.save-state');

    function applyFocus(x, y) {
      dot.style.left = x + '%';
      dot.style.top = y + '%';
      node.querySelectorAll('.pv-frame img').forEach((img) => { img.style.objectPosition = `${x}% ${y}%`; });
    }
    applyFocus(b.focusX, b.focusY);

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

  function confirmDelete() {
    const dlg = $('confirmDialog');
    return new Promise((resolve) => {
      dlg.returnValue = '';
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'confirm'), { once: true });
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

  boot();
})();
