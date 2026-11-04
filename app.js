/* ============================================================
   AmeriTranslate — Telegram Mini App Frontend Logic
   ============================================================
   Invariants enforced:
   - Server-owned authoritative state (frontend never determines XP/rewards)
   - HMAC-SHA256 initData sent via Authorization header
   - No window.alert() — glassmorphism toasts only
   - tg.disableVerticalSwipes() with version check (v7.7+)
   - SWR offline caching pattern (hydrate from localStorage, revalidate)
   ============================================================ */

// === Telegram WebApp SDK reference ===
const tg = window.Telegram?.WebApp;

// === Override window.alert — no blocking dialogs ever ===
window.alert = function (msg) {
  showToast(String(msg), 'info');
};

// === Application state ===
// Profile is server-authoritative; local copy is for SWR display only.
let currentUser = null;

// ============================================================
//  Boot sequence
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  // --- Telegram SDK initialisation ---
  if (tg) {
    tg.ready();
    tg.expand();

    // Disable vertical swipes to prevent accidental Mini App dismissal (v7.7+)
    if (
      typeof tg.disableVerticalSwipes === 'function' &&
      tg.isVersionAtLeast &&
      tg.isVersionAtLeast('7.7')
    ) {
      tg.disableVerticalSwipes();
    }
  }

  // --- Initialize visual theme ---
  initTheme();

  // --- Bind UI events ---
  document.getElementById('sourceText').addEventListener('input', onTextInput);
  document.getElementById('btnClear').addEventListener('click', onClearInput);
  document.getElementById('btnTranslate').addEventListener('click', onTranslate);
  document.getElementById('btnCopy').addEventListener('click', onCopy);
  document.getElementById('btnShare').addEventListener('click', onShare);
  document.getElementById('offlineBanner').addEventListener('click', loadProfile);

  const sampleChip = document.getElementById('sampleChip');
  if (sampleChip) {
    sampleChip.addEventListener('click', onSampleClick);
  }

  // --- SWR: hydrate instantly from cache, then revalidate ---
  hydrateFromCache();
  await loadProfile();
});

// ============================================================
//  Visual Design Theme Switcher
// ============================================================

const THEMES = ['cyber', 'manhattan', 'miami'];

/** Initialize active theme from storage or default to Cyber. */
function initTheme() {
  const savedTheme = localStorage.getItem('ameritranslate_theme') || 'cyber';
  setTheme(savedTheme, false);

  // Bind clicks on all theme pills
  document.querySelectorAll('.theme-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const themeId = btn.getAttribute('data-theme');
      if (themeId && THEMES.includes(themeId)) {
        setTheme(themeId, true);
      }
    });
  });
}

/**
 * Apply selected theme across document and update switcher UI.
 * @param {string} themeName - 'cyber' | 'manhattan' | 'miami'
 * @param {boolean} triggerHaptic - whether to fire selection haptic
 */
function setTheme(themeName, triggerHaptic = true) {
  document.documentElement.setAttribute('data-theme', themeName);
  try {
    localStorage.setItem('ameritranslate_theme', themeName);
  } catch (_) {
    /* Non-critical storage error */
  }

  // Update pills UI state
  document.querySelectorAll('.theme-pill').forEach((pill) => {
    const isTarget = pill.getAttribute('data-theme') === themeName;
    pill.classList.toggle('active', isTarget);
    pill.setAttribute('aria-checked', isTarget ? 'true' : 'false');
  });

  // Haptic feedback
  if (triggerHaptic && tg?.HapticFeedback) {
    tg.HapticFeedback.selectionChanged();
  }
}

// ============================================================
//  SWR Cache helpers
// ============================================================

/** Hydrate UI from localStorage (stale-while-revalidate, instant boot). */
function hydrateFromCache() {
  try {
    const cached = localStorage.getItem('ameritranslate_profile');
    if (cached) {
      currentUser = JSON.parse(cached);
      renderProfile(currentUser);
    }
  } catch (_) {
    /* Corrupted cache — ignore and wait for network */
  }
}

/** Persist server profile to localStorage for SWR. */
function cacheProfile(profile) {
  try {
    localStorage.setItem('ameritranslate_profile', JSON.stringify(profile));
  } catch (_) {
    /* Storage full or unavailable — non-critical */
  }
}

// ============================================================
//  API helper
// ============================================================

/**
 * Authenticated fetch wrapper.
 * Sends Telegram initData in the Authorization header for HMAC-SHA256
 * verification on the backend.
 *
 * @param {string} path - API endpoint (e.g. '/api/profile')
 * @param {RequestInit} options - Fetch options (method, body, etc.)
 * @returns {Promise<Object>} Parsed JSON response
 * @throws {Error} On non-2xx responses
 */
async function api(path, options = {}) {
  const initData = tg?.initData || '';
  const headers = {
    'Authorization': 'tma ' + initData,
    'Content-Type': 'application/json',
  };

  // In standalone browser dev previews where initData is empty, provide fallback test id
  if (!initData) {
    headers['X-Test-User-Id'] = '10001';
  }

  const resp = await fetch(path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'network_error' }));
    throw new Error(err.error || 'request_failed');
  }

  return resp.json();
}

// ============================================================
//  Profile loading & rendering
// ============================================================

/** Fetch fresh profile from server; fall back to offline banner on failure. */
async function loadProfile() {
  try {
    const data = await api('/api/profile');
    if (data.ok) {
      currentUser = data.profile;
      cacheProfile(currentUser);
      renderProfile(currentUser);
      document.getElementById('offlineBanner').style.display = 'none';
    }
  } catch (_) {
    // Network unavailable — show offline banner so user can retry
    document.getElementById('offlineBanner').style.display = 'block';
  }
}

/**
 * Render the profile state into the UI.
 * All values (XP, level, badges) are server-authoritative.
 */
function renderProfile(profile) {
  // --- Streak & XP counters ---
  document.getElementById('streakDays').textContent = profile.streak_days || 0;
  document.getElementById('totalXp').textContent = profile.xp || 0;

  // --- Level label ---
  const levelNames = {
    1: 'Beginner',
    2: 'Casual Translator',
    3: 'Polyglot',
    4: 'Ambassador',
    5: 'Master Linguist',
  };
  const levelThresholds = { 1: 0, 2: 100, 3: 500, 4: 2000, 5: 5000 };
  const level = profile.level || 1;
  document.getElementById('levelLabel').textContent =
    `Level ${level} — ${levelNames[level] || 'Beginner'}`;

  // --- Progress bar (percentage toward next level) ---
  const currentThreshold = levelThresholds[level] || 0;
  const nextThreshold = levelThresholds[level + 1] || levelThresholds[5];
  const progress =
    level >= 5
      ? 100
      : Math.min(
          100,
          ((profile.xp - currentThreshold) / (nextThreshold - currentThreshold)) * 100
        );
  document.getElementById('progressFill').style.width = progress + '%';
  const progressBar = document.getElementById('progressBar');
  if (progressBar) {
    progressBar.setAttribute('aria-valuenow', Math.round(progress));
  }

  // --- Badges ---
  renderBadges(profile.badges || []);
}

// ============================================================
//  Badge definitions & rendering
// ============================================================

/** Map of badge IDs → display metadata. */
const BADGE_META = {
  first_translation: { emoji: '🎖️', label: 'First Translation' },
  streak_7:          { emoji: '🔥', label: '7-Day Streak' },
  streak_30:         { emoji: '🌟', label: '30-Day Streak' },
  languages_5:       { emoji: '🌍', label: '5 Languages' },
  languages_10:      { emoji: '🗺️', label: '10 Languages' },
  translations_100:  { emoji: '💯', label: '100 Translations' },
  translations_500:  { emoji: '🏆', label: '500 Translations' },
};

/**
 * Populate the badges row. Hidden when the user has no badges.
 * @param {string[]} badges - Array of badge ID strings from the server.
 */
function renderBadges(badges) {
  const row = document.getElementById('badgesRow');
  if (!badges || badges.length === 0) {
    row.style.display = 'none';
    return;
  }
  row.style.display = 'flex';
  row.innerHTML = badges
    .map((id) => {
      const meta = BADGE_META[id] || { emoji: '🏅', label: id };
      return `<div class="badge">${meta.emoji} ${meta.label}</div>`;
    })
    .join('');
}

// ============================================================
//  Input handling
// ============================================================

/** Update live character count and Clear button visibility; mark output as stale. */
function onTextInput(e) {
  const len = e.target.value.length;
  document.getElementById('charCount').textContent = len;
  const btnClear = document.getElementById('btnClear');
  if (btnClear) {
    btnClear.style.display = len > 0 ? 'inline-block' : 'none';
  }

  // If output card is already rendered, mark as stale to alert user of modification
  const outputCard = document.getElementById('outputCard');
  if (outputCard && outputCard.style.display !== 'none') {
    outputCard.classList.add('stale');
  }
}

/** One-tap clear of source text field and reset output card. */
function onClearInput() {
  const input = document.getElementById('sourceText');
  input.value = '';
  document.getElementById('charCount').textContent = '0';
  document.getElementById('btnClear').style.display = 'none';

  // Clear and hide output card
  const outputCard = document.getElementById('outputCard');
  if (outputCard) {
    outputCard.style.display = 'none';
    outputCard.classList.remove('stale');
  }
  document.getElementById('outputText').textContent = '';
  document.getElementById('detectedLang').textContent = '';
  input.focus();
}

/** Populate sample text and immediately translate it. */
function onSampleClick() {
  const input = document.getElementById('sourceText');
  input.value = "I'm utterly knackered after queuing for petrol, put the biscuits in the boot.";
  document.getElementById('charCount').textContent = input.value.length;
  document.getElementById('btnClear').style.display = 'inline-block';
  onTranslate();
}

// ============================================================
//  Translation
// ============================================================

/**
 * Send source text to the server for translation.
 * Server determines XP earned and returns updated profile.
 */
async function onTranslate() {
  const textInput = document.getElementById('sourceText');
  const text = textInput.value.trim();
  if (!text) {
    showToast('Please enter some text to translate', 'error');
    return;
  }

  // Dismiss mobile keyboard on submission
  textInput.blur();

  const btn = document.getElementById('btnTranslate');
  btn.disabled = true;
  btn.querySelector('.btn-text').style.display = 'none';
  btn.querySelector('.btn-loading').style.display = 'inline';

  try {
    const data = await api('/api/translate', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });

    if (data.ok) {
      // --- Show translated output ---
      const outputCard = document.getElementById('outputCard');
      outputCard.classList.remove('stale');
      document.getElementById('outputText').textContent = data.translation;
      document.getElementById('detectedLang').textContent = data.detected_lang
        ? `Detected: ${data.detected_lang}`
        : '';
      outputCard.style.display = 'block';

      // Smooth scroll output into visible viewport on mobile
      outputCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // --- XP pop animation (server-determined value) ---
      showXpToast(data.xp_earned);

      // --- Haptic feedback on success ---
      if (tg?.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('light');
      }

      // --- Update profile from server response ---
      if (data.profile) {
        currentUser = data.profile;
        cacheProfile(currentUser);
        renderProfile(currentUser);
      }
    }
  } catch (e) {
    showToast('Translation failed: ' + e.message, 'error');
    if (tg?.HapticFeedback) {
      tg.HapticFeedback.notificationOccurred('error');
    }
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').style.display = 'inline';
    btn.querySelector('.btn-loading').style.display = 'none';
  }
}

// ============================================================
//  XP toast animation
// ============================================================

/**
 * Show a centered XP pop animation (only when XP > 0).
 * @param {number} xp - Amount of XP earned (server-authoritative).
 */
function showXpToast(xp) {
  if (!xp || xp <= 0) return;
  const toast = document.getElementById('xpToast');
  toast.textContent = `+${xp} XP ⭐`;
  toast.style.display = 'block';

  // Restart CSS animation by forcing reflow
  toast.style.animation = 'none';
  toast.offsetHeight; // Force reflow
  toast.style.animation = '';

  setTimeout(() => {
    toast.style.display = 'none';
  }, 1200);
}

// ============================================================
//  Copy & Share actions
// ============================================================

/** Copy translated text to clipboard with haptic + toast feedback. */
function onCopy() {
  const text = document.getElementById('outputText').textContent;
  if (!text) return;
  navigator.clipboard
    .writeText(text)
    .then(() => {
      showToast('✓ Copied to clipboard', 'success');
      if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    })
    .catch(() => showToast('Copy failed', 'error'));
}

/**
 * Share translated text.
 * Priority: Telegram inline query → Web Share API → clipboard fallback with visual toast.
 */
function onShare() {
  const text = document.getElementById('outputText').textContent;
  if (!text) return;
  if (tg?.switchInlineQuery) {
    tg.switchInlineQuery(text);
  } else if (navigator.share) {
    navigator.share({ title: 'AmeriTranslate', text })
      .then(() => showToast('Shared successfully!', 'success'))
      .catch((err) => {
        if (err.name !== 'AbortError') {
          onCopy();
          showToast('✓ Copied to clipboard (Share fallback)', 'info');
        }
      });
  } else {
    onCopy();
    showToast('✓ Copied to clipboard (Share fallback)', 'info');
  }
}

// ============================================================
//  Glassmorphism toast (non-blocking notification)
// ============================================================

/**
 * Show a glassmorphism toast notification. Replaces window.alert().
 *
 * @param {string} message - Toast text
 * @param {'success'|'error'|'info'} type - Semantic type for styling
 */
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');

  const icons = { success: '✓', error: '✕', info: '⚡' };
  toast.className = `toast ${type}`;
  toast.textContent = `${icons[type] || '⚡'} ${message}`;
  container.appendChild(toast);

  // Haptic feedback on error toasts
  if (type === 'error' && tg?.HapticFeedback) {
    tg.HapticFeedback.notificationOccurred('error');
  }

  // Auto-dismiss after 3.2 seconds with fade-out
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-12px)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}
