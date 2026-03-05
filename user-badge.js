(function () {
  function injectStyles() {
    if (document.getElementById('user-badge-style')) return;
    const style = document.createElement('style');
    style.id = 'user-badge-style';
    style.textContent = `
      .user-badge { display: none; align-items: center; gap: 0.6rem; padding: 0.3rem 0.6rem; border-radius: 999px; background-color: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); }
      .user-badge .avatar { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; background: rgba(255,255,255,0.1); }
      .user-badge .user-text { display: flex; flex-direction: column; line-height: 1.1; }
      .user-badge .user-text .name { font-size: 0.9rem; font-weight: 600; }
      .user-badge .user-text .email { font-size: 0.75rem; opacity: 0.7; }
      @media (max-width: 480px) { .user-badge .user-text .email { display: none; } }
    `;
    document.head.appendChild(style);
  }

  function ensureBadge() {
    injectStyles();
    // If a side-nav profile exists, don't inject a separate header badge.
    if (document.getElementById('sideProfile')) {
      return null;
    }

    let badge = document.getElementById('userBadge');
    if (badge) return badge;

    const nav = document.querySelector('header .nav-links') || document.querySelector('header nav') || document.querySelector('nav');
    if (!nav) return null;

    badge = document.createElement('div');
    badge.id = 'userBadge';
    badge.className = 'user-badge';
    badge.innerHTML = `
      <img id="userAvatar" class="avatar" alt="avatar" />
      <div class="user-text">
        <span id="userName" class="name"></span>
        <span id="userEmail" class="email"></span>
      </div>
    `;
    nav.appendChild(badge);
    return badge;
  }

  function waitForFirebase(timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function poll() {
        try {
          // Prefer globals defined in pages
          const auth = window.auth || (window.firebase && window.firebase.auth && window.firebase.auth());
          const db = window.db || (window.firebase && window.firebase.firestore && window.firebase.firestore());
          if (auth && db) return resolve({ auth, db });
        } catch (_) {}
        if (Date.now() - start > timeoutMs) return reject(new Error('Firebase not available'));
        setTimeout(poll, 100);
      })();
    });
  }

  function getInitials(source) {
    if (!source) return 'U';
    const s = String(source).trim();
    if (!s) return 'U';
    // If it's an email, take first char before @
    if (s.includes('@')) return s[0].toUpperCase();
    const parts = s.split(/\s+/).filter(Boolean);
    const first = parts[0] ? parts[0][0] : '';
    const second = parts[1] ? parts[1][0] : '';
    return (first + second || first || 'U').toUpperCase();
  }

  async function populateFromFirestore({ auth, db }) {
    const badge = ensureBadge();

    auth.onAuthStateChanged(async (user) => {
      // Header badge handling (if present on pages without side-nav)
      if (badge) {
        if (!user) {
          badge.style.display = 'none';
        }
      }

      if (!user) {
        // If not signed in, leave existing side-nav placeholders intact
        return;
      }

      let name = (user.displayName || (user.email ? user.email.split('@')[0] : '') || 'Signed In');
      let email = user.email || '';
      let photo = user.photoURL || '';

      try {
        const docRef = db.collection('users').doc(user.uid);
        const snap = await docRef.get();
        if (snap.exists) {
          const data = snap.data();
          name = data.displayName || data.fullName || name;
          // Prefer explicit email fields if present, then fall back
          email = data.contactEmail || data.primaryEmail || data.displayEmail || data.email || email;
          photo = data.photoURL || data.avatarUrl || photo;
        }
      } catch (e) {
        // ignore and fall back to Auth
        console.debug('user-badge: Firestore fetch failed or not permitted', e);
      }

      // Populate header badge if it exists
      if (badge) {
        const nameEl = document.getElementById('userName');
        const emailEl = document.getElementById('userEmail');
        const avatarEl = document.getElementById('userAvatar');

        if (nameEl) nameEl.textContent = name;
        if (emailEl) emailEl.textContent = email;
        if (avatarEl) {
          if (photo) {
            avatarEl.src = photo;
            avatarEl.style.display = 'block';
          } else {
            avatarEl.style.display = 'none';
          }
        }
        badge.style.display = 'flex';
      }

      // Populate hamburger side-nav profile (use existing format)
      const sideNameEl = document.getElementById('profileName');
      const sideEmailEl = document.getElementById('profileEmail');
      const sideAvatarEl = document.getElementById('profileAvatar');
      if (sideNameEl) sideNameEl.textContent = name;
      if (sideEmailEl) sideEmailEl.textContent = email;
      if (sideAvatarEl) {
        // Keep the existing square tile with initials (do not switch to <img>)
        sideAvatarEl.textContent = getInitials(name || email || '');
        // Optionally, if a photo exists you could add it as a background without changing layout:
        // if (photo) { sideAvatarEl.style.backgroundImage = `url(${photo})`; sideAvatarEl.style.backgroundSize = 'cover'; sideAvatarEl.style.backgroundPosition = 'center'; }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    ensureBadge();
    waitForFirebase().then(populateFromFirestore).catch(() => {
      // Firebase not available on this page; leave badge hidden
    });
  });
})();
