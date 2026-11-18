/**
 * F B Group - Main JavaScript Logic
 * Clean, modular, standalone code for interactive features
 */

document.addEventListener('DOMContentLoaded', () => {
  // Hero banner slider (banners come from the dashboard at /admin)
  initHeroSlider();
  initLazyMedia();
  initStatSpin();
  initGroupReveal();
  initScrollReveal();

  // Header logo: smooth scroll back to the top of the page
  const logoTop = document.getElementById('logoTop');
  if (logoTop) {
    logoTop.addEventListener('click', (e) => {
      e.preventDefault();
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      // close the phone menu if it is open
      const list = document.getElementById('navlist');
      const toggle = document.getElementById('menuToggle');
      if (list && list.classList.contains('open') && toggle) toggle.click();
    });
  }

  // 1. Dynamic Copyright Year
  const yearElement = document.getElementById('year');
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  // 2. Mobile Menu Toggle & Navigation
  const menuToggle = document.getElementById('menuToggle');
  const navList = document.getElementById('navlist');

  if (menuToggle && navList) {
    menuToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = navList.classList.toggle('open');
      menuToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // Close mobile menu on clicking any navigation link
    navList.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        navList.classList.remove('open');
        menuToggle.setAttribute('aria-expanded', 'false');
      });
    });

    // Close mobile menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!navList.contains(e.target) && !menuToggle.contains(e.target)) {
        navList.classList.remove('open');
        menuToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // 3. Interactive Gallery Lightbox Modal
  const galleryItems = Array.from(document.querySelectorAll('.gallery-item'));
  const lightbox = document.getElementById('galleryLightbox');
  const lbImage = document.getElementById('lightboxImage');
  const lbVideo = document.getElementById('lightboxVideo');
  const lbCaption = document.getElementById('lightboxCaption');
  const lbClose = document.getElementById('lightboxClose');
  const lbPrev = document.getElementById('lightboxPrev');
  const lbNext = document.getElementById('lightboxNext');

  if (galleryItems.length && lightbox && lbImage && lbCaption) {
    const mediaList = galleryItems.map((item) => {
      const media = item.querySelector('img, video');
      return {
        src: media ? (media.getAttribute('data-full') || media.getAttribute('src')) : '',
        alt: item.getAttribute('data-alt') || (media ? media.getAttribute('alt') : '') || 'Gallery Media',
        type: item.getAttribute('data-type') || (media && media.tagName.toLowerCase() === 'video' ? 'video' : 'image')
      };
    });

    let currentIndex = 0;

    function renderMedia() {
      const item = mediaList[currentIndex];
      if (!item) return;

      if (item.type === 'video' && lbVideo) {
        lbImage.style.display = 'none';
        lbImage.removeAttribute('src');
        lbVideo.style.display = 'block';
        lbVideo.src = item.src;
        lbVideo.load();
        const playPromise = lbVideo.play();
        if (playPromise) playPromise.catch(() => {});
      } else {
        if (lbVideo) {
          lbVideo.pause();
          lbVideo.style.display = 'none';
          lbVideo.removeAttribute('src');
        }
        lbImage.style.display = 'block';
        lbImage.src = item.src;
        lbImage.alt = item.alt;
      }
      lbCaption.textContent = item.alt;
    }

    function openLightbox(index) {
      currentIndex = index;
      renderMedia();
      lightbox.classList.add('open');
      lightbox.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
      if (lbVideo) lbVideo.pause();
      lightbox.classList.remove('open');
      lightbox.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    function showNext() {
      currentIndex = (currentIndex + 1) % mediaList.length;
      renderMedia();
    }

    function showPrev() {
      currentIndex = (currentIndex - 1 + mediaList.length) % mediaList.length;
      renderMedia();
    }

    galleryItems.forEach((item, index) => {
      item.addEventListener('click', () => openLightbox(index));
    });

    if (lbClose) lbClose.addEventListener('click', closeLightbox);
    if (lbNext) lbNext.addEventListener('click', showNext);
    if (lbPrev) lbPrev.addEventListener('click', showPrev);

    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) closeLightbox();
    });

    document.addEventListener('keydown', (e) => {
      if (!lightbox.classList.contains('open')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') showNext();
      if (e.key === 'ArrowLeft') showPrev();
    });
  }

  // 4. Quotation form: sent to the server, read in the dashboard (/admin → Quotations)
  const quotationForm = document.getElementById('quotationForm');
  const formToast = document.getElementById('formToast');

  if (quotationForm) {
    // Fetch SweetAlert in the background once the visitor starts filling in the form
    quotationForm.addEventListener('focusin', () => { loadSwal(); }, { once: true });

    const showMessage = async (text, ok) => {
      const Swal = await Promise.race([loadSwal(), new Promise((r) => setTimeout(() => r(null), 2500))]);
      if (Swal) {
        Swal.fire({
          title: ok ? 'Thank you!' : 'Not sent',
          text,
          icon: ok ? 'success' : 'error',
          confirmButtonColor: '#0a1a3f'
        });
      } else if (formToast) {
        formToast.textContent = text;
        formToast.className = 'form-toast ' + (ok ? 'success' : 'error');
        if (ok) setTimeout(() => { formToast.className = 'form-toast'; }, 8000);
      } else {
        alert(text);
      }
    };

    quotationForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (formToast) formToast.className = 'form-toast';

      const fd = new FormData(quotationForm);
      const payload = {
        name: fd.get('Full_Name') || '',
        company: fd.get('Company') || '',
        email: fd.get('Email') || '',
        phone: fd.get('Phone') || '',
        product: fd.get('Product') || '',
        quantity: fd.get('Quantity') || '',
        port: fd.get('Port') || '',
        message: fd.get('Message') || '',
        website: fd.get('website') || ''
      };

      const fieldIds = { name: 'fname', email: 'email', product: 'product' };
      if (!payload.name.trim()) { showMessage('Please enter your name.', false); document.getElementById('fname').focus(); return; }
      if (!payload.email.trim()) { showMessage('Please enter your email address.', false); document.getElementById('email').focus(); return; }
      if (!payload.product) { showMessage('Please choose a product.', false); document.getElementById('product').focus(); return; }

      const submitBtn = quotationForm.querySelector('.form-submit');
      const originalText = submitBtn ? submitBtn.innerText : 'Send Enquiry';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Sending...';
      }

      try {
        const res = await fetch('/api/quotes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload)
        });
        let data = {};
        try { data = await res.json(); } catch (_) { /* empty reply */ }
        if (!res.ok) {
          showMessage(data.error || 'Something went wrong. Please try again, or email us directly.', false);
          const id = fieldIds[data.field];
          if (id) document.getElementById(id).focus();
          return;
        }
        showMessage('Your quotation request has been sent. Our trade desk will contact you soon.', true);
        quotationForm.reset();
      } catch (err) {
        showMessage('We could not send your request. Please check your internet connection and try again.', false);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = originalText;
        }
      }
    });
  }

  // 5. Sticky Header Enhanced Shadow on Scroll
  const header = document.querySelector('header');
  if (header) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 20) {
        header.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.08)';
      } else {
        header.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.03)';
      }
    });
  }
});


/**
 * Hero banner slider.
 * The page ships with the three default banners in its HTML. If the site
 * server has banners uploaded from the dashboard, they replace the defaults.
 */
function initHeroSlider() {
  const wrap = document.getElementById('heroSlides');
  const controls = document.getElementById('heroControls');
  const dotsEl = document.getElementById('heroDots');
  const pauseBtn = document.getElementById('heroPause');
  if (!wrap) return;

  const INTERVAL = 6000;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let slides = [];
  let current = 0;
  let timer = null;
  let paused = reduceMotion;

  // Phones get the portrait "phone version" of a banner when it has one
  const PHONE_MEDIA = '(max-width: 767px)';

  function render(list) {
    wrap.innerHTML = '';
    list.forEach((b, i) => {
      const pic = document.createElement('picture');
      pic.className = 'hero-slide' + (i === 0 ? ' is-active' : '');
      if (b.srcPhone) {
        const source = document.createElement('source');
        source.media = PHONE_MEDIA;
        source.srcset = b.srcPhone;
        pic.appendChild(source);
      }
      const img = document.createElement('img');
      img.src = b.src;
      if (b.srcSmall) {
        img.srcset = `${b.srcSmall} 1000w, ${b.src} 2000w`;
        img.sizes = '100vw';
      }
      img.alt = b.alt || '';
      img.decoding = 'async';
      if (i > 0) img.loading = 'lazy';
      img.style.objectPosition = `${b.focusX ?? 50}% ${b.focusY ?? 50}%`;
      pic.appendChild(img);
      wrap.appendChild(pic);
    });
  }

  function firstImageUrl(b) {
    if (b.srcPhone && window.matchMedia(PHONE_MEDIA).matches) return { src: b.srcPhone };
    return { src: b.src, srcset: b.srcSmall ? `${b.srcSmall} 1000w, ${b.src} 2000w` : '' };
  }

  function setup() {
    slides = Array.from(wrap.querySelectorAll('.hero-slide'));
    current = 0;
    dotsEl.innerHTML = '';
    if (slides.length < 2) {
      controls.hidden = true;
      return;
    }
    slides.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'hero-dot';
      dot.setAttribute('aria-label', `Show banner ${i + 1} of ${slides.length}`);
      dot.addEventListener('click', () => { show(i); restart(); });
      dotsEl.appendChild(dot);
    });
    controls.hidden = false;
    show(0);
    updatePauseButton();
    restart();
  }

  function show(i) {
    current = (i + slides.length) % slides.length;
    slides.forEach((s, n) => s.classList.toggle('is-active', n === current));
    dotsEl.querySelectorAll('.hero-dot').forEach((d, n) =>
      d.setAttribute('aria-current', n === current ? 'true' : 'false'));
    // make sure the next slide is loading before it is needed
    const next = slides[(current + 1) % slides.length];
    const nextImg = next && next.querySelector('img');
    if (nextImg) nextImg.loading = 'eager';
  }

  function restart() {
    clearInterval(timer);
    if (!paused && slides.length > 1) timer = setInterval(() => show(current + 1), INTERVAL);
  }

  function updatePauseButton() {
    pauseBtn.setAttribute('aria-label', paused ? 'Play banner slideshow' : 'Pause banner slideshow');
    pauseBtn.innerHTML = paused
      ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11a1 1 0 0 0 1.5.86l9-5.5a1 1 0 0 0 0-1.72l-9-5.5A1 1 0 0 0 4 2.5Z"/></svg>'
      : '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>';
  }

  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    updatePauseButton();
    restart();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInterval(timer);
    else restart();
  });

  setup();

  // Replace the defaults with dashboard banners, if any are uploaded.
  fetch('/api/banners', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data || data.source !== 'custom' || !Array.isArray(data.banners) || !data.banners.length) return;
      // Swap only once the first uploaded image has loaded, so the hero never flashes empty
      const first = data.banners[0];
      const pre = new Image();
      const firstUrl = firstImageUrl(first);
      if (firstUrl.srcset) {
        pre.srcset = firstUrl.srcset;
        pre.sizes = '100vw';
      }
      pre.src = firstUrl.src;
      const swap = () => {
        clearInterval(timer);
        render(data.banners);
        setup();
      };
      pre.onload = swap;
      pre.onerror = swap;
    })
    .catch(() => { /* static hosting or offline: keep the default banners */ });
}

/**
 * Speed: gallery video preview pictures load only when they are about to scroll
 * into view. Videos themselves download only when opened in the lightbox.
 */
function showLazy(el) {
  if (el.dataset.bg) el.style.backgroundImage = `url("${el.dataset.bg}")`;
  if (el.dataset.poster) el.poster = el.dataset.poster;
}

function initLazyMedia() {
  const bgEls = document.querySelectorAll('[data-bg], video[data-poster]');

  if (!('IntersectionObserver' in window)) {
    bgEls.forEach(showLazy);
    return;
  }

  const bgObserver = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      showLazy(entry.target);
      obs.unobserve(entry.target);
    });
  }, { rootMargin: '400px 0px' });
  bgEls.forEach((el) => bgObserver.observe(el));

}

/** SweetAlert is only needed after someone sends the quote form, so it loads then. */
let swalPromise = null;
function loadSwal() {
  if (window.Swal) return Promise.resolve(window.Swal);
  if (!swalPromise) {
    swalPromise = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/sweetalert2@11.10.5/dist/sweetalert2.all.min.js';
      s.async = true;
      s.onload = () => resolve(window.Swal || null);
      s.onerror = () => resolve(null);
      document.head.appendChild(s);
    });
  }
  return swalPromise;
}

/**
 * Hero stats: each digit spins like a slot-machine reel and settles on its value.
 * Runs once per page load, when the stats first scroll into view.
 */
function initStatSpin() {
  const box = document.querySelector('.hero-stats');
  if (!box) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // wait for the web fonts, so digit widths are measured in the final font
  const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  ready.then(() => buildStatSpin(box));
}

function buildStatSpin(box) {
  const LOOPS = 2; // full 0-9 turns before landing
  const nums = Array.from(box.querySelectorAll('.num'));
  const reels = [];

  nums.forEach((el) => {
    const text = el.textContent.trim();
    el.setAttribute('aria-label', text);
    el.textContent = '';
    Array.from(text).forEach((ch) => {
      if (!/[0-9]/.test(ch)) {
        const s = document.createElement('span');
        s.setAttribute('aria-hidden', 'true');
        s.textContent = ch;
        el.appendChild(s);
        return;
      }
      const reel = document.createElement('span');
      reel.className = 'reel';
      reel.setAttribute('aria-hidden', 'true');
      const strip = document.createElement('span');
      strip.className = 'reel-strip';
      for (let i = 0; i < (LOOPS + 1) * 10; i += 1) {
        const d = document.createElement('span');
        d.textContent = String(i % 10);
        strip.appendChild(d);
      }
      reel.appendChild(strip);
      // size the reel to its final digit, so spacing matches the plain number
      const probe = document.createElement('span');
      probe.textContent = ch;
      el.appendChild(probe);
      reel.style.width = `${probe.getBoundingClientRect().width}px`;
      el.replaceChild(reel, probe);
      reels.push({ strip, target: LOOPS * 10 + Number(ch) });
    });
  });

  const spin = () => {
    reels.forEach((r, i) => {
      r.strip.style.transitionDelay = `${(i % 6) * 90}ms`;
      r.strip.style.transform = `translateY(-${r.target * 1.2}em)`;
    });
  };

  if (!('IntersectionObserver' in window)) { spin(); return; }
  const io = new IntersectionObserver((entries, obs) => {
    if (entries.some((e) => e.isIntersecting)) {
      obs.disconnect();
      void box.offsetHeight; // make sure the starting position is painted first
      spin();
    }
  }, { threshold: 0.35 });
  io.observe(box);
}

/**
 * Our Group Companies: the tree and each company card animate in once,
 * the first time they scroll into view.
 */
function initGroupReveal() {
  const parts = Array.from(document.querySelectorAll('.group-tree, .group-card'));
  if (!parts.length || !('IntersectionObserver' in window)) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in-view');
      obs.unobserve(e.target);
    });
  }, { threshold: 0.2, rootMargin: '0px 0px -40px 0px' });

  parts.forEach((el) => {
    // already on screen when the page opens: just show it, no hidden flash
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) return;
    el.classList.add('anim-ready');
    io.observe(el);
  });
}

/**
 * Scroll reveal for the rest of the page. Each matched element fades in with a
 * small movement the first time it scrolls into view; items in the same
 * row or grid follow one after another. Runs once per page load.
 */
function initScrollReveal() {
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // [selector, effect] - effects: up, left, right, zoom
  const RULES = [
    ['.section-head', 'up'],
    ['.why-subhead', 'up'],
    ['.leader-card', 'up'],
    ['.about-img', 'left'],
    ['.about-content > .eyebrow, .about-content > h2, .about-content > p', 'right'],
    ['.about-feat', 'up'],
    ['.product-card', 'up'],
    ['.gallery-item', 'zoom'],
    ['.route-map', 'zoom'],
    ['.choose-card', 'up'],
    ['.yard-card', 'up'],
    ['.cap-item', 'up'],
    ['.cta-band .container', 'zoom'],
    ['.contact-info', 'left'],
    ['.contact-form', 'right'],
    ['.foot-grid > *', 'up'],
  ];

  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('rv-in');
      obs.unobserve(e.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  const seen = new Set();
  RULES.forEach(([selector, effect]) => {
    document.querySelectorAll(selector).forEach((el) => {
      if (seen.has(el) || el.closest('.group, .hero')) return;
      seen.add(el);
      // already on screen when the page opens: leave it as it is
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) return;
      // stagger items that share a parent (cards in a grid, lines in a block)
      const siblings = Array.from(el.parentElement.children).filter((c) => c.matches(selector));
      const i = Math.min(siblings.indexOf(el), 5);
      el.style.setProperty('--rv-delay', `${i * 90}ms`);
      el.classList.add('rv', `rv-${effect}`);
      io.observe(el);
    });
  });
}
