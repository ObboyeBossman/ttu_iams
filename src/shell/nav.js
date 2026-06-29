// =============================================================================
// IAMS — shell/nav.js
// Shell renderer + all shell-level behaviour.
//
// Exports:
//   renderShell(role, activePage, userInfo) → Promise<void>
//   navigateTo(page)                        → void
//   setTabs(tabs, activePage?)              → void
//   showToast(message, kind)                → void
//
// Contract:
//   • Does NOT call Supabase directly — auth is done upstream by the page script.
//   • Does NOT call requireRole() — that is the page script's responsibility.
//   • Does NOT own or render page content — only sidebar, topbar, and overlays.
//   • Does NOT import from shared/utils.js (clean dependency graph).
//   • The sub-nav tab row is OPT-IN per page, not config-driven. The shell
//     renders it empty/hidden on init; a page calls setTabs([...]) whenever
//     it wants the row, and it auto-hides again on navigation away from a
//     page in the current tab set, unless the new page calls setTabs again.
//     Example, inside a page script after renderShell() resolves:
//       setTabs(
//         [{ page: 'students-overview', label: 'Overview' },
//          { page: 'students-documents', label: 'Documents' }],
//         'students-overview'
//       );
//
// Expected page HTML skeleton:
//   <div id="app" class="app-shell">
//     <div class="main-content" id="main-content">
//       <main class="content-area" id="page-content">
//         <!-- page-specific content here -->
//       </main>
//     </div>
//   </div>
//   <div id="shell-overlays"></div>
// =============================================================================

import { SHELL_CONFIG } from '/shell/shell-config.js';

// -----------------------------------------------------------------------------
// localStorage key constants
// -----------------------------------------------------------------------------

const STORAGE_KEYS = {
  theme: 'iams_theme_mode',
  collapsed: 'iams_sidebar_collapsed',
  version: 'iams_shell_version',
};
const SHELL_VERSION = 'v2';

// -----------------------------------------------------------------------------
// Internal state (module-level, set during renderShell)
// -----------------------------------------------------------------------------

let _config = null;   // RoleConfig for the current role
let _pageTitles = {};     // { [pageKey]: label } derived from config.nav
let _validPages = [];     // ordered list of valid page keys

// DOM references populated in renderShell — used across event handlers
let _sidebar = null;
let _collapseBtn = null;
let _brandLink = null;
let _sidebarScrim = null;
let _mobileMenuBtn = null;
let _topbarTitle = null;
let _topbarTabs = null;   // <nav class="topbar-tabs"> container, hidden by default
let _currentTabs = [];     // [{ page, label }] set by the active page via setTabs()
let _activePage = null;   // last page passed to navigateTo()
let _toastHost = null;
let _sidebarTooltip = null;
let _lcOverlay = null;

// Popover engine state
let _openPopoverEl = null;

// Icon retry counter
let _iconRetries = 0;

// Media query for system theme
const _mediaDark = window.matchMedia('(prefers-color-scheme: dark)');

// -----------------------------------------------------------------------------
// Lucide icon fallback map
// -----------------------------------------------------------------------------

const ICON_FALLBACK = {
  'chevron-left': '‹', 'chevron-right': '›', 'chevron-down': '⌄',
  'layout-dashboard': '▦', 'file-text': '📄', 'building-2': '🏢',
  'book-open': '📖', 'user-circle': '👤', 'sparkles': '✦',
  'settings': '⚙', 'bell': '🔔', 'menu': '☰', 'search': '🔍',
  'calendar-range': '📅', 'check': '✓', 'check-circle-2': '✓',
  'alert-triangle': '⚠', 'alert-circle': '⚠', 'info': 'ℹ',
  'map-pin': '📍', 'map-pin-check': '📍', 'clock': '🕐',
  'file-check': '📄', 'file-plus': '📄', 'file-down': '⬇',
  'send': '➤', 'log-out': '⎋', 'user': '👤', 'loader-circle': '↻',
  'panel-left': '▤', 'panel-left-open': '▥', 'sun': '☀',
  'users': '👥', 'map': '🗺', 'link-2': '🔗',
  'file-search': '🔎', 'x': '✕',
};

// -----------------------------------------------------------------------------
// Icon rendering helpers
// -----------------------------------------------------------------------------

function _applyIconFallback() {
  document.querySelectorAll('i[data-lucide]').forEach(function (el) {
    if (el.dataset.iconRendered) return;
    const name = el.getAttribute('data-lucide');
    el.textContent = ICON_FALLBACK[name] || '•';
    el.style.fontStyle = 'normal';
    el.style.lineHeight = '1';
    el.style.display = 'inline-flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
  });
}

function _renderIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    try {
      window.lucide.createIcons();
      document.querySelectorAll('i[data-lucide]').forEach(function (el) {
        el.dataset.iconRendered = '1';
      });
      return true;
    } catch (e) {
      _applyIconFallback();
      return false;
    }
  }
  _applyIconFallback();
  return false;
}

function _renderIconsWithRetry() {
  const ok = _renderIcons();
  if (!ok && _iconRetries < 10 && !window.__lucideFailed) {
    _iconRetries++;
    setTimeout(_renderIconsWithRetry, 200);
  } else if (!ok) {
    _applyIconFallback();
  }
}

/** Inject the Lucide UMD script once into <head>, then kick off icon render. */
function _ensureLucide() {
  const CDN = 'https://cdn.jsdelivr.net/npm/lucide@0.469.0/dist/umd/lucide.min.js';
  if (document.querySelector(`script[src="${CDN}"]`)) {
    // Already in DOM — might already be loaded or still loading
    _renderIconsWithRetry();
    return;
  }
  const s = document.createElement('script');
  s.src = CDN;
  s.onerror = function () { window.__lucideFailed = true; _applyIconFallback(); };
  s.onload = function () { _renderIconsWithRetry(); };
  document.head.appendChild(s);
}

// -----------------------------------------------------------------------------
// Toast
// -----------------------------------------------------------------------------

/**
 * Show a self-dismissing toast notification.
 * @param {string} message
 * @param {'info'|'success'|'error'} kind
 */
export function showToast(message, kind = 'info') {
  if (!_toastHost) return;
  const icon = kind === 'success' ? 'check-circle-2' : kind === 'error' ? 'alert-circle' : 'info';
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<i data-lucide="${icon}"></i><span></span>`;
  el.querySelector('span').textContent = message;
  _toastHost.appendChild(el);
  _renderIconsWithRetry();
  setTimeout(function () {
    el.style.transition = 'opacity 0.25s, transform 0.25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(function () { el.remove(); }, 250);
  }, 3200);
}

// -----------------------------------------------------------------------------
// Theme
// -----------------------------------------------------------------------------

function _applyTheme(mode) {
  const resolved = mode === 'system' ? (_mediaDark.matches ? 'dark' : 'light') : mode;
  document.documentElement.setAttribute('data-theme', resolved);

  document.querySelectorAll('.appearance-swatch').forEach(function (sw) {
    const isActive = sw.getAttribute('data-mode') === mode;
    sw.classList.toggle('active', isActive);
    const check = sw.querySelector('.appearance-check');
    if (check) check.style.display = isActive ? 'flex' : 'none';
  });

  try { localStorage.setItem(STORAGE_KEYS.theme, mode); } catch (e) { /* private / sandboxed */ }
  _renderIconsWithRetry();
}

function _readSavedTheme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.theme);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch (e) { /* ignore */ }
  return 'dark';
}

// -----------------------------------------------------------------------------
// Sidebar collapse (desktop)
// -----------------------------------------------------------------------------

function _setCollapsed(collapsed) {
  // Mobile drawer should never be in a collapsed state
  if (window.innerWidth <= 900) {
    _sidebar.classList.remove('collapsed');
    return;
  }
  
  _sidebar.classList.toggle('collapsed', collapsed);
  const label = collapsed ? 'Open sidebar' : 'Close sidebar';
  if (_collapseBtn) {
    _collapseBtn.setAttribute('aria-label', label);
    _collapseBtn.setAttribute('data-tooltip', label);
  }
  try { localStorage.setItem(STORAGE_KEYS.collapsed, collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
}

// -----------------------------------------------------------------------------
// Mobile sidebar drawer
// -----------------------------------------------------------------------------

function _openMobileSidebar() {
  _sidebar.classList.add('mobile-open');
  if (_sidebarScrim) _sidebarScrim.classList.add('visible');
}

function _closeMobileSidebar() {
  _sidebar.classList.remove('mobile-open');
  if (_sidebarScrim) _sidebarScrim.classList.remove('visible');
}

// -----------------------------------------------------------------------------
// Sidebar tooltip
// -----------------------------------------------------------------------------

function _showSidebarTooltip(el) {
  if (!_sidebarTooltip) return;
  const label = el.getAttribute('data-tooltip');
  if (!label) return;

  const isCollapseBtn = el.id === 'shell-collapseBtn';
  // Show tooltips for nav/switcher items only while the sidebar is collapsed;
  // the collapse button always shows its tooltip in expanded mode.
  if (!isCollapseBtn && !_sidebar.classList.contains('collapsed')) return;

  _sidebarTooltip.textContent = label;

  const rect = el.getBoundingClientRect();
  if (isCollapseBtn) {
    _sidebarTooltip.style.left = (rect.left + rect.width / 2) + 'px';
    _sidebarTooltip.style.top = (rect.bottom + 8) + 'px';
    _sidebarTooltip.style.transform = 'translate(-50%, 0)';
  } else {
    const centerY = rect.top + rect.height / 2;
    _sidebarTooltip.style.left = (rect.right + 12) + 'px';
    _sidebarTooltip.style.top = Math.min(Math.max(centerY, 24), window.innerHeight - 24) + 'px';
    _sidebarTooltip.style.transform = 'translateY(-50%)';
  }

  _sidebarTooltip.classList.add('visible');
}

function _hideSidebarTooltip() {
  if (_sidebarTooltip) _sidebarTooltip.classList.remove('visible');
}

// -----------------------------------------------------------------------------
// Popover engine
// -----------------------------------------------------------------------------

function _positionPopover(pop, anchor, align) {
  const rect = anchor.getBoundingClientRect();
  const popWidth = pop.offsetWidth || 280;
  let top = rect.bottom + 8;
  let left = align === 'right' ? rect.right - popWidth : rect.left;

  const margin = 8;
  if (left + popWidth > window.innerWidth - margin) left = window.innerWidth - popWidth - margin;
  if (left < margin) left = margin;
  if (top + 320 > window.innerHeight) top = Math.max(margin, rect.top - 8 - 320);

  pop.style.top = top + 'px';
  pop.style.left = left + 'px';
}

function _openPopover(pop, anchor, align) {
  _closeAllPopovers();
  _positionPopover(pop, anchor, align);
  pop.classList.add('open');
  _openPopoverEl = pop;
}

function _closeAllPopovers() {
  document.querySelectorAll('.popover.open').forEach(function (p) { p.classList.remove('open'); });
  document.querySelectorAll('.sidebar-switcher.menu-open').forEach(function (s) { s.classList.remove('menu-open'); });
  _openPopoverEl = null;
}

// -----------------------------------------------------------------------------
// Logout overlay
// -----------------------------------------------------------------------------

function _openLogoutConfirm() {
  _closeAllPopovers();
  if (!_lcOverlay) return;
  _lcOverlay.classList.remove('hidden');
  _lcOverlay.classList.add('visible');
}

function _closeLogoutConfirm() {
  if (!_lcOverlay) return;
  _lcOverlay.classList.add('hidden');
  _lcOverlay.classList.remove('visible');
}

// -----------------------------------------------------------------------------
// navigateTo — exported
// -----------------------------------------------------------------------------

/**
 * Navigate to a page within the current role's shell.
 * Updates topbar title, sidebar active state, tab active state, URL hash,
 * and closes the mobile drawer.
 *
 * NOTE: nav.js does NOT show/hide page content sections — that responsibility
 * belongs to each page script. Multi-page apps built from separate HTML files
 * simply load the correct file; single-file prototypes handle section toggling
 * themselves (see student-shell.html).
 *
 * @param {string} page - Page key, e.g. 'dashboard'
 */
export function navigateTo(page) {
  if (_config && _config.portalLabel === 'Admin Portal') {
    const routes = {
      'dashboard': '/src/modules/admin_portal/dashboard/dashboard.html',
      'users': '/src/modules/admin_portal/users/users.html',
      'zones': '/src/modules/admin_portal/zones/zones.html',
      'seasons': '/src/modules/admin_portal/seasons/seasons.html',
      'assign-placements': '/src/modules/admin_portal/placements.html',
      'letters-audit': '/src/modules/admin_portal/letters/letters-audit.html',
      'settings': '/src/modules/admin_portal/settings/settings.html',
    };
    if (routes[page]) {
      const targetPath = routes[page];
      // Only redirect if we are not already on the target path
      if (!window.location.pathname.endsWith(targetPath)) {
        // Implement PJAX-style persistent navigation
        window.history.pushState({ page }, '', targetPath);
        _pjaxNavigate(targetPath);
        return;
      }
    }
  }

  // Update URL hash for SPA modules (like student portal)
  if (!(_config && _config.portalLabel === 'Admin Portal')) {
    if (window.location.hash !== '#' + page) {
      try {
        window.history.pushState(null, '', '#' + page);
      } catch (e) {
        window.location.hash = '#' + page;
      }
    }
  }

  const isKnownNavPage = _validPages.length > 0 && _validPages.includes(page);
  const isKnownTabPage = _currentTabs.some(function (t) { return t.page === page; });
  if (_validPages.length > 0 && !isKnownNavPage && !isKnownTabPage) {
    page = _validPages[0] || 'dashboard';
  }
  _activePage = page;

  // Sidebar active state
  document.querySelectorAll('.sidebar-item[data-page]').forEach(function (el) {
    el.classList.toggle('active', el.getAttribute('data-page') === page);
  });

  // Topbar tabs active state — also reset to hidden by default on every
  // navigation. A page must call setTabs() again after navigating if it
  // wants the row to reappear for the new page; the shell never assumes.
  if (_topbarTabs) {
    const stillRelevant = _currentTabs.some(function (t) { return t.page === page; });
    if (stillRelevant) {
      document.querySelectorAll('.tab[data-page]').forEach(function (el) {
        el.classList.toggle('active', el.getAttribute('data-page') === page);
      });
    } else {
      _topbarTabs.classList.add('hidden');
      _topbarTabs.innerHTML = '';
      _currentTabs = [];
    }
  }

  // Topbar title is always the brand name — no per-page title needed.
  // (The responsive CSS shows .topbar-brand-full or .topbar-brand-initials.)

  // Update URL hash for SPA modules (like student portal)
  if (!(_config && _config.portalLabel === 'Admin Portal')) {
    if (window.location.hash !== '#' + page) {
      try {
        window.history.pushState(null, '', '#' + page);
      } catch (e) {
        window.location.hash = '#' + page;
      }
    }
  }

  // Close mobile drawer on navigation
  _closeMobileSidebar();
}

// -----------------------------------------------------------------------------
// PJAX Fetcher (Persistent Shell)
// -----------------------------------------------------------------------------
async function _pjaxNavigate(url) {
  const pageContent = document.getElementById('page-content');
  if (!pageContent) return;

  // 1. Show skeleton shimmer while fetching
  pageContent.innerHTML = `
    <div class="page-container" style="padding: 24px;">
      <div class="skeleton-shimmer" style="width:250px;height:36px;border-radius:6px;margin-bottom:8px;"></div>
      <div class="skeleton-shimmer" style="width:300px;height:16px;border-radius:4px;margin-bottom:32px;"></div>
      <div class="skeleton-shimmer" style="width:100%;height:400px;border-radius:12px;"></div>
    </div>
  `;

  try {
    const res = await fetch(url);
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // 2. Extract new content
    const newContent = doc.getElementById('page-content');
    if (newContent) {
      pageContent.innerHTML = newContent.innerHTML;
      
      // 3. Re-execute module scripts
      const scripts = doc.querySelectorAll('script[type="module"]');
      scripts.forEach(s => {
        const src = s.getAttribute('src');
        if (src) {
          const newScript = document.createElement('script');
          newScript.type = 'module';
          // Cache bust to force re-evaluation of the entry module (preserves shared imports)
          newScript.src = new URL(src, window.location.origin + url).href + '?t=' + Date.now();
          document.body.appendChild(newScript);
        }
      });

      // 4. Update title
      document.title = doc.title || document.title;
      
      if (typeof _renderIconsWithRetry === 'function') _renderIconsWithRetry();
    }
  } catch (err) {
    console.error('[nav.js] PJAX failed:', err);
    window.location.href = url; // Fallback to hard reload
  }
}

// Handle browser back/forward buttons
window.addEventListener('popstate', (e) => {
  if (_config && _config.portalLabel === 'Admin Portal') {
    _pjaxNavigate(window.location.pathname);
  }
});

// -----------------------------------------------------------------------------
// setTabs — exported
// -----------------------------------------------------------------------------

/**
 * Show (or hide) the sub-nav tab row beneath the topbar. The shell never
 * decides this on its own — a page calls setTabs() when it wants the row,
 * and the row disappears again once a page that doesn't call it loads.
 *
 * @param {Array<{page: string, label: string}>} tabs - Tab definitions, in
 *   display order. Pass an empty array (or omit) to hide the row.
 * @param {string} [activePage] - Which tab's `page` key should render active.
 *   Defaults to whatever page is currently active in the shell.
 */
export function setTabs(tabs, activePage) {
  if (!_topbarTabs) return;
  _currentTabs = Array.isArray(tabs) ? tabs : [];

  if (_currentTabs.length === 0) {
    _topbarTabs.classList.add('hidden');
    _topbarTabs.innerHTML = '';
    return;
  }

  const active = activePage || _activePage;
  _topbarTabs.innerHTML = '';
  _currentTabs.forEach(function (t) {
    const btn = document.createElement('button');
    btn.className = 'tab' + (t.page === active ? ' active' : '');
    btn.setAttribute('data-page', t.page);
    btn.textContent = t.label;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      navigateTo(t.page);
    });
    _topbarTabs.appendChild(btn);
  });
  _topbarTabs.classList.remove('hidden');
}

// -----------------------------------------------------------------------------
// HTML builders
// -----------------------------------------------------------------------------

/** Build the <aside class="sidebar"> element from config + userInfo. */
function _buildSidebar(config, userInfo) {
  const aside = document.createElement('aside');
  aside.className = 'sidebar';
  aside.id = 'shell-sidebar';

  // ----- Top row -----
  const top = document.createElement('div');
  top.className = 'sidebar-top';
  top.id = 'shell-sidebarTop';

  // Logo row: brand link (logo) + collapse/dismiss button side by side
  const brandRow = document.createElement('div');
  brandRow.className = 'sidebar-brand-row';

  const brandLink = document.createElement('a');
  brandLink.href = '#dashboard';
  brandLink.className = 'sidebar-brand';
  brandLink.id = 'shell-brandLink';
  brandLink.setAttribute('data-tooltip', 'Open sidebar');
  brandLink.innerHTML = `
    <div class="sidebar-brand-mark">
      <img class="brand-mark-crest"
        src="/assets/logo/ttu_logo_no_text.png"
        alt="TTU"
        onerror="this.style.display='none'" />
      <div class="brand-mark-divider"></div>
      <div class="brand-mark-wordmark">
        <span>Takoradi</span>
        <span>Technical</span>
        <span>University</span>
      </div>
      <span class="brand-mark-toggle-icon"><i data-lucide="panel-left-open"></i></span>
    </div>`;

  // Collapse button (desktop) — right of logo in the same row
  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'sidebar-collapse-btn';
  collapseBtn.id = 'shell-collapseBtn';
  collapseBtn.setAttribute('data-tooltip', 'Close sidebar');
  collapseBtn.setAttribute('aria-label', 'Close sidebar');
  collapseBtn.innerHTML = '<i data-lucide="panel-left"></i>';

  // Dismiss button (mobile/tablet) — same slot
  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'sidebar-dismiss-btn';
  dismissBtn.id = 'shell-dismissBtn';
  dismissBtn.setAttribute('aria-label', 'Close menu');
  dismissBtn.innerHTML = '<i data-lucide="x"></i>';

  brandRow.append(brandLink, collapseBtn, dismissBtn);
  top.appendChild(brandRow);

  // Motto line — "Integrity & Excellence"
  const integrityEl = document.createElement('div');
  integrityEl.className = 'sidebar-integrity';
  integrityEl.textContent = 'Integrity & Excellence';
  top.appendChild(integrityEl);

  // Portal label row below the logo (e.g. 'Admin Portal')
  const brandNameEl = document.createElement('a');
  brandNameEl.href = '#dashboard';
  brandNameEl.className = 'sidebar-brand-tagline';
  brandNameEl.textContent = config.portalLabel || config.brandName;
  top.appendChild(brandNameEl);

  const brandInitialsEl = document.createElement('a');
  brandInitialsEl.href = '#dashboard';
  brandInitialsEl.className = 'sidebar-brand-initials';
  brandInitialsEl.textContent = config.portalLabel || config.brandInitials;
  top.appendChild(brandInitialsEl);

  aside.appendChild(top);

  // ----- Season switcher -----
  if (config.showSeasonSwitcher) {
    const switcher = document.createElement('button');
    switcher.className = 'sidebar-switcher';
    switcher.id = 'shell-seasonSwitcher';
    switcher.setAttribute('data-tooltip', 'Attachment Season');
    switcher.innerHTML = `
      <div class="sidebar-switcher-icon"><i data-lucide="calendar-range"></i></div>
      <div class="sidebar-switcher-text">
        <div class="sidebar-switcher-title" id="shell-seasonTitle">2025/2026 Season</div>
        <div class="sidebar-switcher-subtitle">Placement window open</div>
      </div>
      <div class="sidebar-switcher-chevron"><i data-lucide="chevron-down"></i></div>`;
    aside.appendChild(switcher);
  }

  // ----- Main nav -----
  const nav = document.createElement('nav');
  nav.className = 'sidebar-nav';
  nav.id = 'shell-sidebarNav';

  if (config.nav.length > 0) {
    const label = document.createElement('div');
    label.className = 'sidebar-label';
    label.textContent = 'Menu';
    nav.appendChild(label);

    config.nav.forEach(function (item) {
      const a = document.createElement('a');
      a.href = '#' + item.page;
      a.className = 'sidebar-item';
      a.setAttribute('data-page', item.page);
      a.setAttribute('data-tooltip', item.label);
      a.innerHTML = `<i data-lucide="${_esc(item.icon)}"></i><span class="sidebar-item-text">${_esc(item.label)}</span>`;
      if (item.badge) {
        const badge = document.createElement('span');
        badge.className = 'badge badge-gold sidebar-badge';
        badge.style.cssText = 'font-size:10px;padding:2px 7px;';
        badge.textContent = item.badge;
        a.appendChild(badge);
      }
      nav.appendChild(a);
    });
  }
  aside.appendChild(nav);

  // ----- Promo banner -----
  if (config.showPromo && config.promo) {
    const promo = document.createElement('div');
    promo.className = 'sidebar-promo';
    promo.innerHTML = `
      <div class="sidebar-promo-top">
        <i data-lucide="sparkles"></i>
        <span class="sidebar-promo-title">${_esc(config.promo.title)}</span>
      </div>
      <p class="sidebar-promo-text">${_esc(config.promo.text)}</p>
      <div class="sidebar-promo-actions">
        <button class="btn btn-accent btn-sm" id="shell-promoCta">${_esc(config.promo.cta)}</button>
      </div>`;
    aside.appendChild(promo);
  }

  // ----- Footer -----
  const footer = document.createElement('div');
  footer.className = 'sidebar-footer';

  config.footer.forEach(function (item) {
    if (item.type === 'link') {
      const a = document.createElement('a');
      a.href = '#' + item.page;
      a.className = 'sidebar-item';
      a.setAttribute('data-page', item.page);
      a.setAttribute('data-tooltip', item.label);
      a.innerHTML = `<i data-lucide="${_esc(item.icon)}"></i><span class="sidebar-item-text">${_esc(item.label)}</span>`;
      footer.appendChild(a);
    } else {
      // type === 'action'
      const btn = document.createElement('button');
      btn.className = 'sidebar-item';
      btn.setAttribute('data-action', item.id);
      btn.setAttribute('data-tooltip', item.label);
      btn.innerHTML = `<i data-lucide="${_esc(item.icon)}"></i><span class="sidebar-item-text">${_esc(item.label)}</span>`;
      footer.appendChild(btn);
    }
  });

  aside.appendChild(footer);
  return aside;
}

/** Build the <header class="topbar"> element. */
function _buildTopbar(config, activePage, userInfo) {
  const header = document.createElement('header');
  header.className = 'topbar';



  header.innerHTML = `
    <div class="topbar-left">
      <button class="mobile-menu-btn" id="shell-mobileMenuBtn" aria-label="Open menu">
        <i data-lucide="menu"></i>
      </button>
      <span class="topbar-title" id="shell-topbarTitle">
        <span class="topbar-brand-full">${_esc(config.brandName)}</span>
        <span class="topbar-brand-initials">${_esc(config.brandInitials)}</span>
      </span>
    </div>

    <div class="topbar-search">
      <span class="topbar-search-icon"><i data-lucide="search"></i></span>
      <input type="text" class="inp" placeholder="Search placements, letters…"
        oninput="if(this.value.length===1) window.__shellShowToast && window.__shellShowToast('Search is not wired up yet.', 'info')">
    </div>

    <div class="topbar-actions">
      <button class="icon-btn" id="shell-notificationsBtn" title="Notifications">
        <i data-lucide="bell"></i>
        <span class="badge-dot"></span>
      </button>
      <button class="topbar-avatar-btn" id="shell-profileBtn">
        <div class="avatar avatar-sm" style="background:rgba(255,255,255,0.20);color:#FFFFFF;border:1px solid rgba(255,255,255,0.35);"
          id="shell-topbarAvatar">${_esc(userInfo.initials)}</div>
        <div class="topbar-avatar-info">
          <span class="topbar-avatar-name" id="shell-topbarName">${_esc(userInfo.name)}</span>
          <span class="topbar-avatar-sub" id="shell-topbarSub">${_esc(userInfo.email)}</span>
        </div>
      </button>
    </div>`;

  return header;
}

/** Build an empty, hidden <nav class="topbar-tabs"> shell. Pages populate it
 *  on demand via the exported setTabs() — see that function for details. */
function _buildTopbarTabs() {
  const nav = document.createElement('nav');
  nav.className = 'topbar-tabs hidden';
  nav.id = 'shell-topbarTabs';
  return nav;
}

/** Build the profile popover element. */
function _buildProfilePopover(config, userInfo) {
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.id = 'shell-profilePopover';

  pop.innerHTML = `
    <div class="popover-header">
      <div class="avatar avatar-md" style="background:var(--ttu-blue-surface);color:var(--ttu-blue);">
        ${_esc(userInfo.initials)}
      </div>
      <div>
        <strong>${_esc(userInfo.name)}</strong>
        <small>${_esc(userInfo.email)}</small>
      </div>
    </div>
    <div class="popover-divider"></div>
    <button class="popover-item" data-action="goProfile">
      <i data-lucide="user"></i> My Profile
    </button>
    <button class="popover-item" data-action="goPlacement">
      <i data-lucide="building-2"></i> My Placement
    </button>
    <button class="popover-item" data-action="goSettings">
      <i data-lucide="settings"></i> Account Settings
    </button>
    <div class="popover-divider"></div>
    <div class="popover-section-label">Appearance</div>
    <div class="appearance-row">
      <button class="appearance-swatch" data-mode="light">
        <div class="appearance-swatch-preview">
          <div class="appearance-check" style="display:none;"><i data-lucide="check"></i></div>
        </div>
        <span class="appearance-swatch-label">Light</span>
      </button>
      <button class="appearance-swatch" data-mode="dark">
        <div class="appearance-swatch-preview">
          <div class="appearance-check" style="display:none;"><i data-lucide="check"></i></div>
        </div>
        <span class="appearance-swatch-label">Dark</span>
      </button>
      <button class="appearance-swatch" data-mode="system">
        <div class="appearance-swatch-preview">
          <div class="appearance-check" style="display:none;"><i data-lucide="check"></i></div>
        </div>
        <span class="appearance-swatch-label">System</span>
      </button>
    </div>
    <div class="popover-divider"></div>
    <button class="popover-logout" id="shell-popoverLogoutBtn">
      <i data-lucide="log-out"></i> Logout
    </button>`;

  return pop;
}

/** Build the season popover element. */
function _buildSeasonPopover() {
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.id = 'shell-seasonPopover';
  pop.style.width = '240px';

  pop.innerHTML = `
    <div class="popover-section-label">Attachment seasons</div>
    <button class="season-option active">
      <span>2025/2026 Season</span>
      <i data-lucide="check"></i>
    </button>
    <button class="season-option" id="shell-archivedSeason">
      <span>2024/2025 Season (archived)</span>
    </button>`;

  return pop;
}

/** Build the logout confirm overlay. */
function _buildLogoutOverlay() {
  const overlay = document.createElement('div');
  overlay.id = 'lc-overlay';
  overlay.className = 'modal-backdrop hidden';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,15,26,0.55);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;';

  overlay.innerHTML = `
    <div class="lc-modal">
      <div class="lc-icon"><i data-lucide="log-out"></i></div>
      <div class="lc-title">Log out of IAMS?</div>
      <div class="lc-msg">You'll need to sign in again to access your dashboard, letters, and placement details.</div>
      <div class="lc-actions">
        <button class="lc-btn lc-btn-cancel" id="shell-lcCancelBtn">Cancel</button>
        <button class="lc-btn lc-btn-confirm" id="shell-lcConfirmBtn">Log out</button>
      </div>
    </div>`;

  return overlay;
}

// -----------------------------------------------------------------------------
// Utility — safe HTML escaping
// -----------------------------------------------------------------------------

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// -----------------------------------------------------------------------------
// Event wiring
// -----------------------------------------------------------------------------

function _wireEvents(config) {

  // ----- Desktop sidebar collapse -----
  _collapseBtn = document.getElementById('shell-collapseBtn');
  if (_collapseBtn) {
    _collapseBtn.addEventListener('click', function () {
      _setCollapsed(!_sidebar.classList.contains('collapsed'));
    });
  }

  // Collapsed brand mark or tagline → navigate or expand
  const brandSelectors = [
    '#shell-brandLink',
    '.sidebar-brand-tagline',
    '.sidebar-brand-initials'
  ];
  brandSelectors.forEach(selector => {
    const el = document.getElementById(selector.startsWith('#') ? selector.slice(1) : '');
    const target = el || document.querySelector(selector);
    if (target) {
      target.addEventListener('click', function (e) {
        if (_sidebar.classList.contains('collapsed')) {
          e.preventDefault();
          _setCollapsed(false);
        } else {
          e.preventDefault();
          navigateTo('dashboard');
        }
      });
    }
  });

  // ----- Mobile drawer -----
  _mobileMenuBtn = document.getElementById('shell-mobileMenuBtn');
  if (_mobileMenuBtn) _mobileMenuBtn.addEventListener('click', _openMobileSidebar);

  _sidebarScrim = document.getElementById('shell-sidebarScrim');
  if (_sidebarScrim) _sidebarScrim.addEventListener('click', _closeMobileSidebar);

  const dismissBtn = document.getElementById('shell-dismissBtn');
  if (dismissBtn) dismissBtn.addEventListener('click', _closeMobileSidebar);

  // ----- Sidebar nav + topbar tabs -----
  // NOTE: this also covers footer <a data-page> items (e.g. Settings) since
  // they share the .sidebar-item class — do not add a second listener for
  // them below, or clicks fire navigateTo() twice.
  document.querySelectorAll('.sidebar-item[data-page], .tab[data-page]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      navigateTo(el.getAttribute('data-page'));
    });
  });

  // Footer action items
  document.querySelectorAll('.sidebar-footer [data-action]').forEach(function (el) {
    el.addEventListener('click', function () {
      const id = el.getAttribute('data-action');
      if (id === 'themeToggle') {
        // Cycle the *saved* mode, not the resolved data-theme attribute —
        // reading resolved light/dark would silently overwrite a 'system'
        // preference the first time this button is clicked.
        const saved = _readSavedTheme();
        const next = saved === 'light' ? 'dark' : saved === 'dark' ? 'system' : 'light';
        _applyTheme(next);
      } else if (id === 'signOut') {
        _openLogoutConfirm();
      }
    });
  });

  // Promo CTA (optional — page can override after renderShell returns)
  const promoCta = document.getElementById('shell-promoCta');
  if (promoCta) {
    promoCta.addEventListener('click', function () {
      showToast('This is a static preview of the IAMS Phase 1 roadmap.', 'info');
    });
  }

  // ----- Sidebar tooltips -----
  _sidebarTooltip = document.getElementById('shell-sidebarTooltip');

  document.querySelectorAll('#shell-sidebar [data-tooltip]').forEach(function (el) {
    el.addEventListener('mouseenter', function () { _showSidebarTooltip(el); });
    el.addEventListener('mouseleave', _hideSidebarTooltip);
    el.addEventListener('click', _hideSidebarTooltip);
  });

  window.addEventListener('resize', function () {
    _hideSidebarTooltip();
    if (window.innerWidth <= 900) {
      _sidebar?.classList.remove('collapsed');
    }
  });

  // ----- Popover engine: close on outside click, resize, scroll -----
  document.addEventListener('click', function (e) {
    if (!_openPopoverEl) return;
    const insidePop = _openPopoverEl.contains(e.target);
    const clickedAnchor = e.target.closest('#shell-profileBtn, #shell-seasonSwitcher');
    if (!insidePop && !clickedAnchor) _closeAllPopovers();
  });
  window.addEventListener('resize', _closeAllPopovers);
  window.addEventListener('scroll', _closeAllPopovers, true);

  // Profile popover trigger
  const profileBtn = document.getElementById('shell-profileBtn');
  const profilePop = document.getElementById('shell-profilePopover');
  if (profileBtn && profilePop) {
    profileBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      _openPopover(profilePop, profileBtn, 'right');
    });
  }

  // Profile popover inner actions
  if (profilePop) {
    profilePop.querySelector('[data-action="goProfile"]')?.addEventListener('click', function () {
      navigateTo('profile');
      _closeAllPopovers();
    });
    profilePop.querySelector('[data-action="goPlacement"]')?.addEventListener('click', function () {
      navigateTo('register-placement');
      _closeAllPopovers();
    });
    profilePop.querySelector('[data-action="goSettings"]')?.addEventListener('click', function () {
      showToast('Account settings are not part of this mock.', 'info');
      _closeAllPopovers();
    });
  }

  // Season switcher popover trigger
  const seasonSwitcher = document.getElementById('shell-seasonSwitcher');
  const seasonPop = document.getElementById('shell-seasonPopover');
  if (seasonSwitcher && seasonPop) {
    seasonSwitcher.addEventListener('click', function (e) {
      e.stopPropagation();
      const willOpen = !seasonPop.classList.contains('open');
      _openPopover(seasonPop, seasonSwitcher, 'left');
      seasonSwitcher.classList.toggle('menu-open', willOpen);
    });
  }

  // Archived season option
  const archivedSeason = document.getElementById('shell-archivedSeason');
  if (archivedSeason) {
    archivedSeason.addEventListener('click', function () {
      showToast('Only the active season is available to students.', 'info');
      _closeAllPopovers();
    });
  }

  // ----- Appearance swatches -----
  document.querySelectorAll('.appearance-swatch').forEach(function (sw) {
    sw.addEventListener('click', function () {
      _applyTheme(sw.getAttribute('data-mode'));
    });
  });

  // System theme media query change
  _mediaDark.addEventListener('change', function () {
    const saved = _readSavedTheme();
    if (saved === 'system') _applyTheme('system');
  });

  // ----- Notifications (stub) -----
  const notificationsBtn = document.getElementById('shell-notificationsBtn');
  if (notificationsBtn) {
    notificationsBtn.addEventListener('click', function () {
      showToast('3 unread notifications (static).', 'info');
    });
  }

  // ----- Logout overlay -----
  _lcOverlay = document.getElementById('lc-overlay');

  const logoutBtnPopover = document.getElementById('shell-popoverLogoutBtn');
  if (logoutBtnPopover) logoutBtnPopover.addEventListener('click', _openLogoutConfirm);

  const lcCancelBtn = document.getElementById('shell-lcCancelBtn');
  if (lcCancelBtn) {
    lcCancelBtn.addEventListener('click', _closeLogoutConfirm);
  }

  // In the _wireEvents() function, inside the logout confirm button handler:

  const lcConfirmBtn = document.getElementById('shell-lcConfirmBtn');
  if (lcConfirmBtn) {
    lcConfirmBtn.addEventListener('click', async function () {
      _closeLogoutConfirm();

      try {
        const { supabase } = await import('/shared/supabase-client.js');
        await supabase.auth.signOut();
        console.log('[nav.js] Sign out successful');
      } catch (e) {
        console.warn('[nav.js] Sign out error:', e);
      }

      // No sessionStorage flags needed — signOut() clears the session
      // in mock-auth (localStorage + memory) before redirecting.
      // auth-guard will see no session on the login page and stay there.
      window.location.href = '/src/modules/auth/login.html';
    });
  }


  if (_lcOverlay) {
    _lcOverlay.addEventListener('click', function (e) {
      if (e.target === _lcOverlay) _closeLogoutConfirm();
    });
  }

  // Hash-change routing (single-file prototype support)
  window.addEventListener('hashchange', function () {
    const hash = (window.location.hash || '').replace('#', '');
    if (_validPages.includes(hash)) navigateTo(hash);
  });
}

// -----------------------------------------------------------------------------
// renderShell — primary export
// -----------------------------------------------------------------------------

/**
 * Build and inject the IAMS shell (sidebar, topbar, overlays) for a given role.
 *
 * @param {'student'|'admin'|'school_supervisor'} role
 * @param {string} activePage  - Page key to mark active on first render
 * @param {{ name: string, initials: string, email: string }} userInfo
 * @returns {Promise<void>}
 */
export async function renderShell(role, activePage, userInfo) {
  const config = SHELL_CONFIG[role];
  if (!config) throw new Error(`[nav.js] Unknown role: "${role}"`);
  _config = config;

  // Build page title map + valid page list from the nav config.
  // NOTE: tabs no longer come from config — pages supply their own labels
  // directly when they call setTabs(), so they don't need to be seeded here.
  _pageTitles = {};
  config.nav.forEach(function (item) { _pageTitles[item.page] = item.label; });
  // Hardcoded well-known labels used by footer links
  _pageTitles['dashboard'] = _pageTitles['dashboard'] || 'Dashboard';
  _pageTitles['profile'] = _pageTitles['profile'] || 'Profile';
  _pageTitles['register-placement'] = _pageTitles['register-placement'] || 'Register Placement';
  _pageTitles['settings'] = _pageTitles['settings'] || 'Settings';
  _pageTitles['generate-letter'] = _pageTitles['generate-letter'] || 'Generate Letter';
  _pageTitles['logbook'] = _pageTitles['logbook'] || 'Digital Logbook';

  _validPages = Object.keys(_pageTitles);

  // ----- One-time version check — clear stale localStorage state -----
  try {
    if (localStorage.getItem(STORAGE_KEYS.version) !== SHELL_VERSION) {
      localStorage.removeItem(STORAGE_KEYS.theme);
      localStorage.removeItem(STORAGE_KEYS.collapsed);
      localStorage.setItem(STORAGE_KEYS.version, SHELL_VERSION);
    }
  } catch (e) { /* private browsing / sandboxed */ }

  // ----- DOM roots -----
  const app = document.getElementById('app');
  const mainContent = document.getElementById('main-content');
  const pageContent = document.getElementById('page-content');
  const overlayRoot = document.getElementById('shell-overlays');

  if (!app || !mainContent || !pageContent) {
    throw new Error('[nav.js] Required DOM elements (#app, #main-content, #page-content) not found.');
  }

  // ----- Build sidebar -----
  const sidebar = _buildSidebar(config, userInfo);
  app.insertBefore(sidebar, mainContent);
  _sidebar = sidebar;

  // ----- Scrim (lives outside sidebar so it covers main-content) -----
  const scrim = document.createElement('div');
  scrim.className = 'sidebar-scrim';
  scrim.id = 'shell-sidebarScrim';
  app.insertBefore(scrim, mainContent);

  // ----- Build topbar + (empty, hidden) tabs row and prepend to main-content -----
  const topbar = _buildTopbar(config, activePage, userInfo);
  const topbarTabs = _buildTopbarTabs();
  mainContent.insertBefore(topbarTabs, pageContent);
  mainContent.insertBefore(topbar, topbarTabs);
  _topbarTabs = topbarTabs;

  // Cache topbar title reference
  _topbarTitle = document.getElementById('shell-topbarTitle');

  // ----- Build overlays -----
  if (overlayRoot) {
    const profilePop = _buildProfilePopover(config, userInfo);
    overlayRoot.appendChild(profilePop);

    if (config.showSeasonSwitcher) {
      const seasonPop = _buildSeasonPopover();
      overlayRoot.appendChild(seasonPop);
    }

    const lcOverlay = _buildLogoutOverlay();
    overlayRoot.appendChild(lcOverlay);

    const toastHost = document.createElement('div');
    toastHost.className = 'toast-host';
    toastHost.id = 'shell-toastHost';
    overlayRoot.appendChild(toastHost);
    _toastHost = toastHost;

    const tooltip = document.createElement('div');
    tooltip.className = 'sidebar-tooltip';
    tooltip.id = 'shell-sidebarTooltip';
    overlayRoot.appendChild(tooltip);
    _sidebarTooltip = tooltip;
  }

  // ----- Wire all events -----
  _wireEvents(config);

  // ----- Restore sidebar collapsed state -----
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.collapsed);
    if (saved === '1' && window.innerWidth > 900) _setCollapsed(true);
  } catch (e) { /* ignore */ }

  // ----- Restore theme -----
  _applyTheme(_readSavedTheme());

  // ----- Mark active page in sidebar + tabs -----
  navigateTo(activePage);

  // ----- Expose showToast on window for inline onclick attributes -----
  window.__shellShowToast = showToast;

  // ----- Inject Lucide + render icons -----
  _ensureLucide();
}

// -----------------------------------------------------------------------------
// initShell — helper for new modules
// -----------------------------------------------------------------------------
export async function initShell(activePage) {
  try {
    const { supabase } = await import('/shared/supabase-client.js');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    
    const userId = session.user.id;
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, full_name')
      .eq('id', userId)
      .maybeSingle();
      
    if (!profile) return;
    
    const role = profile.role;
    const fullName = profile.full_name ?? 'User';
    const initials = fullName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    
    let resolvedPage = activePage;
    if (!resolvedPage) {
      if (role === 'admin') {
        const path = window.location.pathname;
        if (path.includes('/users/')) resolvedPage = 'users';
        else if (path.includes('/zones/')) resolvedPage = 'zones';
        else if (path.includes('/seasons/')) resolvedPage = 'seasons';
        else if (path.includes('placements.html')) resolvedPage = 'assign-placements';
        else if (path.includes('/letters/')) resolvedPage = 'letters-audit';
        else if (path.includes('/settings/')) resolvedPage = 'settings';
        else resolvedPage = 'dashboard';
      } else {
        resolvedPage = (location.hash || '').replace('#', '') || 'dashboard';
      }
    }
    
    // If the shell is already built (e.g. during a PJAX navigation), just update active state
    if (document.getElementById('shell-sidebarNav')) {
      navigateTo(resolvedPage);
      const loader = document.getElementById('page-loading');
      if (loader) loader.style.display = 'none';
      return;
    }
    
    await renderShell(role, resolvedPage, { name: fullName, initials, email: session.user.email });
  } catch (err) {
    console.error('[nav.js] initShell error:', err);
  }
}