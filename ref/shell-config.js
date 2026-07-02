// =============================================================================
// IAMS — shell/shell-config.js
// Role → navigation configuration.
// Consumed by shell/nav.js — never import this directly from page scripts.
// =============================================================================

/**
 * @typedef {Object} NavItem
 * @property {string}      page   - Unique page key (matches HTML id and URL hash)
 * @property {string}      icon   - Lucide icon name
 * @property {string}      label  - Display text
 * @property {string|null} badge  - Optional badge label (e.g. 'Phase 2') or null
 */

/**
 * @typedef {Object} FooterItem
 * @property {'link'|'action'} type
 * @property {string} [page]   - For type:'link' — the page key to navigate to
 * @property {string} [id]     - For type:'action' — stable identifier used by nav.js
 * @property {string} icon     - Lucide icon name
 * @property {string} label    - Display text
 */

/**
 * @typedef {Object} PromoConfig
 * @property {string} title
 * @property {string} text
 * @property {string} cta     - CTA button label
 */

/**
 * @typedef {Object} RoleConfig
 * @property {string}       brandName          - Full brand name shown in the topbar (expanded)
 * @property {string}       brandInitials      - Short initials shown in the topbar when space is tight
 * @property {string}       portalLabel        - Portal label shown under the sidebar logo (e.g. 'Admin Portal')
 * @property {boolean}      showSeasonSwitcher - Whether to render the season switcher row
 * @property {boolean}      showPromo          - Whether to render the promo banner
 * @property {PromoConfig|null} promo          - Promo content (null when showPromo is false)
 * @property {NavItem[]}    nav                - Main navigation items (top section)
 * @property {FooterItem[]} footer             - Items always shown at sidebar bottom
 *
 * NOTE: there is deliberately no `tabs` field here. The sub-nav tab row is
 * opt-in per page via nav.js's exported setTabs(tabs, activePage) — pages
 * call it themselves, scoped to whatever module/page they represent. The
 * shell never decides tab content from role config alone.
 */

/** @type {Record<string, RoleConfig>} */
export const SHELL_CONFIG = {

  // ---------------------------------------------------------------------------
  // SUPER ADMIN
  // ---------------------------------------------------------------------------
  super_admin: {
    brandName:          'Industrial Attachment Management System',
    brandInitials:      'IAMS',
    portalLabel:        'Super Admin',
    showSeasonSwitcher: false,
    showPromo:          false,
    promo:              null,
    nav: [
      { page: 'dashboard',     icon: 'layout-dashboard', label: 'Dashboard',      badge: null },
      { page: 'structure',     icon: 'network',          label: 'Institution',     badge: null },
      { page: 'students',      icon: 'graduation-cap',   label: 'Students',        badge: null },
      { page: 'supervisors',   icon: 'user-check',       label: 'Supervisors',     badge: null },
      { page: 'admins',        icon: 'shield-check',     label: 'Admin Accounts',  badge: null },
      { page: 'system-audit',  icon: 'scroll-text',      label: 'Audit Log',       badge: null },
      { page: 'system-health', icon: 'activity',         label: 'System Health',   badge: null },
      { page: 'settings',      icon: 'settings',         label: 'System Config',   badge: null },
    ],
    footer: [
      { type: 'action', id: 'themeToggle', icon: 'sun',     label: 'Toggle Theme' },
      { type: 'action', id: 'signOut',     icon: 'log-out', label: 'Sign Out'     },
    ],
  },

  // ---------------------------------------------------------------------------
  // STUDENT
  // ---------------------------------------------------------------------------
  student: {
    brandName:          'Industrial Attachment Management System',
    brandInitials:      'IAMS',
    portalLabel:        'Student Portal',
    showSeasonSwitcher: true,
    showPromo:          false,
    promo:              null,
    nav: [
      { page: 'dashboard',          icon: 'layout-dashboard', label: 'Dashboard',          badge: null },
      { page: 'generate-letter',    icon: 'file-text',        label: 'Generate Letter',    badge: null },
      { page: 'register-placement', icon: 'building-2',       label: 'Register Placement', badge: null },
      { page: 'attendance',         icon: 'map-pin',          label: 'Attendance',         badge: null },
      { page: 'logbook',            icon: 'book-open',        label: 'Logbook',            badge: null },
      { page: 'attachment-report',  icon: 'file-check',       label: 'Attachment Report',  badge: null },
      { page: 'profile',            icon: 'user-circle',      label: 'Profile',            badge: null },
    ],
    footer: [
      { type: 'link',   page: 'settings', icon: 'settings', label: 'Settings'  },
      { type: 'action', id:   'signOut',  icon: 'log-out',  label: 'Sign Out'  },
    ],
  },

  // ---------------------------------------------------------------------------
  // ADMIN
  // ---------------------------------------------------------------------------
  admin: {
    brandName:          'Industrial Attachment Management System',
    brandInitials:      'IAMS',
    portalLabel:        'Admin Portal',
    showSeasonSwitcher: false,  // Admins manage seasons rather than read one
    showPromo:          false,
    promo:              null,
    nav: [
      { page: 'dashboard',        icon: 'layout-dashboard', label: 'Dashboard',        badge: null },
      { page: 'users',            icon: 'users',            label: 'Users',            badge: null },
      { page: 'zones',            icon: 'map',              label: 'Zones',            badge: null },
      { page: 'placement-zones',  icon: 'map-pin',          label: 'Placement Zones',  badge: null },
      { page: 'seasons',          icon: 'calendar-range',   label: 'Seasons',          badge: null },
      { page: 'assign-placements',icon: 'link-2',           label: 'Assign Placements',badge: null },
      { page: 'letters-audit',    icon: 'file-search',      label: 'Letters Audit',    badge: null },
      { page: 'finance',          icon: 'banknote',         label: 'Finance',          badge: null },
      { page: 'settings',         icon: 'settings',         label: 'Settings',         badge: null },
    ],
    footer: [
      { type: 'action', id: 'themeToggle', icon: 'sun',     label: 'Toggle Theme' },
      { type: 'action', id: 'signOut',     icon: 'log-out', label: 'Sign Out'     },
    ],
  },

  // ---------------------------------------------------------------------------
  // SCHOOL SUPERVISOR
  // Phase 1: minimal shell — nav is empty until Phase 2. Tabs (if any pages
  // need them) are called directly via setTabs() from the page itself.
  // ---------------------------------------------------------------------------
  school_supervisor: {
    brandName:          'Industrial Attachment Management System',
    brandInitials:      'IAMS',
    portalLabel:        'Supervisor Portal',
    showSeasonSwitcher: false,
    showPromo:          false,
    promo:              null,
    // Nav items added in Phase 2
    nav: [
      { page: 'dashboard', icon: 'layout-dashboard', label: 'Dashboard', badge: null },
      { page: 'students',  icon: 'users',            label: 'Students',  badge: null },
      { page: 'visits',    icon: 'map-pin',          label: 'Visits',    badge: null },
    ],
    footer: [
      { type: 'action', id: 'themeToggle', icon: 'sun',     label: 'Toggle Theme' },
      { type: 'action', id: 'signOut',     icon: 'log-out', label: 'Sign Out'     },
    ],
  },
};