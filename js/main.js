/**
 * FB Enterprise - Main JavaScript Logic
 * Clean, modular, standalone code for interactive features
 */

document.addEventListener('DOMContentLoaded', () => {
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
            confirmButtonColor: '#4a5a3a'
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
