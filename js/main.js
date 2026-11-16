/**
 * F B Group - Main JavaScript Logic
 * Clean, modular, standalone code for interactive features
 */

document.addEventListener('DOMContentLoaded', () => {
  // Hero banner slider (banners come from the dashboard at /admin)
  initHeroSlider();

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
        src: media ? media.getAttribute('src') : '',
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

  // 4. Quotation & Contact Form Handling
  const quotationForm = document.getElementById('quotationForm');
  const formToast = document.getElementById('formToast');

  if (quotationForm) {
    quotationForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const submitBtn = quotationForm.querySelector('.form-submit');
      const originalText = submitBtn ? submitBtn.innerText : 'Send Enquiry';

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Sending...';
      }

      // Save inquiry to localStorage for record keeping and offline testing
      try {
        const formData = Object.fromEntries(new FormData(quotationForm).entries());
        const records = JSON.parse(localStorage.getItem('fb_quotation_enquiries') || '[]');
        records.push({
          ...formData,
          submittedAt: new Date().toISOString()
        });
        localStorage.setItem('fb_quotation_enquiries', JSON.stringify(records));
      } catch (err) {
        console.warn('localStorage write failed:', err);
      }

      setTimeout(() => {
        if (typeof Swal !== 'undefined') {
          Swal.fire({
            title: 'Success!',
            text: 'Thank you! Your quotation enquiry has been submitted successfully. Our trade desk will contact you soon.',
            icon: 'success',
            confirmButtonColor: '#0a1a3f'
          });
        } else if (formToast) {
          formToast.textContent = 'Thank you! Your quotation enquiry has been submitted successfully.';
          formToast.className = 'form-toast success';
          setTimeout(() => {
            formToast.className = 'form-toast';
          }, 6000);
        } else {
          alert('Thank you! Your quotation enquiry has been submitted successfully.');
        }

        quotationForm.reset();

        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = originalText;
        }
      }, 500);
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

  function render(list) {
    wrap.innerHTML = '';
    list.forEach((b, i) => {
      const img = document.createElement('img');
      img.className = 'hero-slide' + (i === 0 ? ' is-active' : '');
      img.src = b.src;
      if (b.srcSmall) {
        img.srcset = `${b.srcSmall} 1000w, ${b.src} 2000w`;
        img.sizes = '100vw';
      }
      img.alt = b.alt || '';
      img.decoding = 'async';
      if (i > 0) img.loading = 'lazy';
      img.style.objectPosition = `${b.focusX ?? 50}% ${b.focusY ?? 50}%`;
      wrap.appendChild(img);
    });
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
    if (next) next.loading = 'eager';
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
      if (first.srcSmall) {
        pre.srcset = `${first.srcSmall} 1000w, ${first.src} 2000w`;
        pre.sizes = '100vw';
      }
      pre.src = first.src;
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
