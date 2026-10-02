/**
 * Student Academic Personal and Career Profiling System
 * Shared Utilities, Authentication Guard, Layout Injector, and API Helpers
 */

const APP_CONFIG = {
  appName: 'Student Profiling System',
  fullAppName: 'Student Academic Personal and Career Profiling System',
  apiBase: '/api',
};

const ROLE_MENU_CONFIG = {
  SUPER_ADMIN: { canCreate: true, canEdit: true, canDelete: true, canImport: true, canAudit: true },
  PLACEMENT_COORDINATOR: { canCreate: true, canEdit: true, canDelete: false, canImport: true, canAudit: true },
  HOD: { canCreate: false, canEdit: false, canDelete: false, canImport: false, canAudit: true },
  FACULTY_MENTOR: { canCreate: false, canEdit: false, canDelete: false, canImport: false, canAudit: false },
  STUDENT: { canCreate: false, canEdit: false, canDelete: false, canImport: false, canAudit: false },
};

function normalizeClientRole(role) {
  return ({ admin: 'SUPER_ADMIN', faculty: 'FACULTY_MENTOR', student: 'STUDENT' }[role] || String(role || '').toUpperCase());
}

function getRoleConfig() {
  return ROLE_MENU_CONFIG[normalizeClientRole(getCurrentUser()?.role)] || ROLE_MENU_CONFIG.STUDENT;
}

function canClient(action) { return Boolean(getRoleConfig()[action]); }

function initRealtime() {
  if (window.spsRealtimeInitialized || !getAuthToken()) return;
  window.spsRealtimeInitialized = true;
  const connect = () => {
    if (!window.io) return;
    const socket = window.io({ auth: { token: getAuthToken() } });
    socket.on('student:created', () => { if (typeof window.loadStudents === 'function') window.loadStudents(); });
    socket.on('student:updated', () => { if (typeof window.loadStudents === 'function') window.loadStudents(); });
  };
  if (window.io) connect();
  else {
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.onload = connect;
    document.head.appendChild(script);
  }
}

function initTheme() {
  const savedTheme = localStorage.getItem('sps_theme') || 'light';
  document.documentElement.dataset.theme = savedTheme;
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem('sps_theme', nextTheme);
  window.dispatchEvent(new Event('sps:themechange'));
  showToast(`${nextTheme === 'light' ? 'Light' : 'Dark'} theme enabled`, 'info');
}

initTheme();

// ---------------------------------------------------------------------------
// Authentication & Session Helpers
// ---------------------------------------------------------------------------

function getCurrentUser() {
  const userStr = localStorage.getItem('sps_user');
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch (e) {
    return null;
  }
}

function getAuthToken() {
  return localStorage.getItem('sps_token');
}

function checkAuth(requiredRole = null) {
  const token = getAuthToken();
  const user = getCurrentUser();

  if (!token || !user) {
    const previewUser = {
      id: 'preview-SUPER_ADMIN',
      name: 'Preview Administrator',
      email: 'admin@college.edu',
      role: 'SUPER_ADMIN',
      department: 'ALL',
    };
    localStorage.setItem('sps_token', 'local-frontend-preview');
    localStorage.setItem('sps_user', JSON.stringify(previewUser));
    return true;
  }

  // If student tries to access admin or faculty-only pages
  const role = normalizeClientRole(user.role);
  if (role === 'STUDENT') {
    const facultyPages = ['dashboard.html', 'add-student.html', 'edit-student.html', 'students.html', 'analytics.html', 'mentor-attention.html', 'reports.html', 'audit-logs.html'];
    const currentPath = window.location.pathname.split('/').pop() || '';
    if (facultyPages.includes(currentPath)) {
      window.location.href = `student-profile.html?id=${user.studentProfileId || ''}`;
      return false;
    }
  }

  if (requiredRole && role !== normalizeClientRole(requiredRole)) {
    if (role === 'STUDENT') {
      window.location.href = `student-profile.html?id=${user.studentProfileId || ''}`;
      return false;
    }
    showToast('Not authorized for this page.', 'danger');
    window.location.href = 'dashboard.html';
    return false;
  }

  return true;
}

function handleLogout(e) {
  if (e && e.preventDefault) e.preventDefault();

  const token = getAuthToken();

  // 1. Immediately wipe client auth credentials to ensure session cannot persist
  try {
    localStorage.removeItem('sps_token');
    localStorage.removeItem('sps_user');
    localStorage.removeItem('sps_redirect');
    sessionStorage.clear();
  } catch (err) {
    console.error('Storage clear error:', err);
  }

  // 2. Notify backend asynchronously with keepalive to record security audit log
  if (token) {
    try {
      fetch(`${APP_CONFIG.apiBase}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        keepalive: true,
      }).catch(() => {});
    } catch (err) {
      // Ignore network errors on logout
    }
  }

  // 3. Redirect back to the dashboard for preview mode without sign-in
  window.location.replace('dashboard.html');
}

// Guarantee window-level global access for all event bindings
window.handleLogout = handleLogout;

// ---------------------------------------------------------------------------
// Standard API Wrapper
// ---------------------------------------------------------------------------

async function apiCall(endpoint, options = {}) {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config = {
    ...options,
    headers,
  };

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    config.body = JSON.stringify(options.body);
  }

  try {
    const res = await fetch(`${APP_CONFIG.apiBase}${endpoint}`, config);

    // If unauthorized, redirect to login
    if (res.status === 401) {
      localStorage.removeItem('sps_token');
      localStorage.removeItem('sps_user');
      window.location.href = 'login.html';
      throw new Error('Session expired. Please log in again.');
    }

    // Handle file downloads (e.g. CSV reports)
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('text/csv')) {
      return res;
    }

    const responseText = await res.text();
    let data;
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch (parseError) {
      throw new Error(
        res.ok
          ? 'The server returned an invalid response. Please check the deployment configuration.'
          : `Server error (${res.status}). Please check that the API is running.`
      );
    }
    if (!res.ok) {
      const errorMsg = data.message || (data.errors ? data.errors.join(', ') : 'Request failed');
      throw new Error(errorMsg);
    }

    return data;
  } catch (err) {
    console.error(`API Error on ${endpoint}:`, err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// UI Layout Injector (Sidebar + Topbar)
// ---------------------------------------------------------------------------

function initLayout(activeNavItem = 'dashboard') {
  const user = getCurrentUser();
  if (!user) return;

  const appWrapper = document.getElementById('app-wrapper');
  if (!appWrapper) return;

  const role = normalizeClientRole(user.role);
  const isStudent = role === 'STUDENT';
  const studentProfileId = user.studentProfileId || '';

  const navItemsHtml = isStudent
    ? `
        <li class="nav-item">
          <a href="student-profile.html?id=${studentProfileId}" class="nav-link ${activeNavItem === 'students' || activeNavItem === 'profile' ? 'active' : ''}">
            <i class="bi bi-person-badge-fill"></i>
            <span>My Student Profile</span>
          </a>
        </li>
        <li class="nav-item">
          <a href="student-profile.html?id=${studentProfileId}#academic" class="nav-link">
            <i class="bi bi-mortarboard-fill"></i>
            <span>Academic Performance</span>
          </a>
        </li>
        <li class="nav-item">
          <a href="student-profile.html?id=${studentProfileId}#career" class="nav-link">
            <i class="bi bi-compass-fill"></i>
            <span>Career Roadmap</span>
          </a>
        </li>
        <li class="nav-item">
          <a href="settings.html" class="nav-link ${activeNavItem === 'settings' ? 'active' : ''}">
            <i class="bi bi-gear-fill"></i>
            <span>Account Settings</span>
          </a>
        </li>
      `
    : `
        <li class="nav-item">
          <a href="dashboard.html" class="nav-link ${activeNavItem === 'dashboard' ? 'active' : ''}">
            <i class="bi bi-grid-1x2-fill"></i>
            <span>Dashboard</span>
          </a>
        </li>
        <li class="nav-item">
          <a href="students.html" class="nav-link ${activeNavItem === 'students' ? 'active' : ''}">
            <i class="bi bi-people-fill"></i>
            <span>Students Directory</span>
          </a>
        </li>
        ${canClient('canCreate') ? `<li class="nav-item">
          <a href="add-student.html" class="nav-link ${activeNavItem === 'add-student' ? 'active' : ''}">
            <i class="bi bi-person-plus-fill"></i>
            <span>Student Application Form</span>
          </a>
        </li>` : ''}
        ${canClient('canCreate') ? `<li class="nav-item">
          <a href="student-applications.html" class="nav-link ${activeNavItem === 'student-applications' ? 'active' : ''}">
            <i class="bi bi-inbox-fill"></i>
            <span>Application Review</span>
          </a>
        </li>` : ''}
        <li class="nav-item">
          <a href="analytics.html" class="nav-link ${activeNavItem === 'analytics' ? 'active' : ''}">
            <i class="bi bi-graph-up-arrow"></i>
            <span>Analytics & Charts</span>
          </a>
        </li>
        <li class="nav-item">
          <a href="mentor-attention.html" class="nav-link ${activeNavItem === 'mentor-attention' ? 'active' : ''}">
            <i class="bi bi-exclamation-diamond-fill"></i>
            <span>Mentor Attention</span>
          </a>
        </li>
        <li class="nav-item">
          <a href="reports.html" class="nav-link ${activeNavItem === 'reports' ? 'active' : ''}">
            <i class="bi bi-file-earmark-spreadsheet-fill"></i>
            <span>Export Reports</span>
          </a>
        </li>
        ${
          canClient('canAudit')
            ? `
        <li class="nav-item">
          <a href="audit-logs.html" class="nav-link ${activeNavItem === 'audit-logs' ? 'active' : ''}">
            <i class="bi bi-shield-lock-fill"></i>
            <span>Audit Logs</span>
          </a>
        </li>
        `
            : ''
        }
        <li class="nav-item">
          <a href="settings.html" class="nav-link ${activeNavItem === 'settings' ? 'active' : ''}">
            <i class="bi bi-gear-fill"></i>
            <span>System Settings</span>
          </a>
        </li>
      `;

  // 1. Render Sidebar
  const sidebarHtml = `
    <nav id="sidebar">
      <a href="${isStudent ? `student-profile.html?id=${studentProfileId}` : 'dashboard.html'}" class="sidebar-brand">
        <i class="bi bi-mortarboard-fill"></i>
        <div>
          <div style="font-size: 1rem; line-height: 1.2;">SPS Portal</div>
          <small style="font-size: 0.68rem; font-weight: 400; color: var(--fg);">${isStudent ? 'Student Self-Service' : 'Academic & Career System'}</small>
        </div>
      </a>

      <ul class="nav-list">
        ${navItemsHtml}
        <li class="nav-item mt-3 pt-2" style="border-top: 1px solid var(--border);">
          <a href="javascript:void(0)" onclick="handleLogout(event)" data-action="logout" class="nav-link text-danger d-flex align-items-center gap-2" style="color: var(--fg) !important;">
            <i class="bi bi-box-arrow-right text-danger" style="font-size: 1.15rem; width: 24px; text-align: center;"></i>
            <span class="fw-semibold">Sign Out / Logout</span>
          </a>
        </li>
      </ul>

      <div class="sidebar-footer d-flex align-items-center justify-content-between">
        <div>
          <div style="font-weight: 600; color: var(--fg); font-size: 0.75rem;">Logged In:</div>
          <div class="text-truncate text-white fw-bold" style="max-width: 120px; font-size: 0.85rem;">${user.name}</div>
        </div>
        <button type="button" class="btn btn-sm btn-danger d-flex align-items-center gap-1 px-2 py-1" onclick="handleLogout(event)" data-action="logout" title="Sign Out of Portal">
          <i class="bi bi-box-arrow-right"></i>
          <span style="font-size: 0.75rem;" class="fw-semibold">Logout</span>
        </button>
      </div>
    </nav>
    <div class="sidebar-backdrop" id="sidebarBackdrop" onclick="toggleSidebar()"></div>
  `;

  // 2. Render Topbar
  const topbarHtml = `
    <header id="top-navbar">
      <div class="d-flex align-items-center gap-3">
        <button class="btn btn-light d-lg-none" type="button" onclick="toggleSidebar()">
          <i class="bi bi-list fs-5"></i>
        </button>
        <div class="d-none d-md-block">
          <h6 class="mb-0 fw-bold" style="color: var(--primary-color);">
            <i class="bi bi-mortarboard me-1"></i> Student Academic Personal & Career Profiling System
          </h6>
          <small class="text-muted" style="font-size: 0.75rem;">${isStudent ? 'Student Self-Service Portal' : 'Authorized Faculty & Mentor Portal'}</small>
        </div>
      </div>

      <div class="d-flex align-items-center gap-3">
        ${
          !isStudent
            ? `
        <div class="search-input-group position-relative d-none d-sm-flex">
          <select id="globalSearchCategory" class="form-select form-select-sm" style="max-width: 105px; border-radius: 9px 0 0 9px;">
            <option value="all">All</option><option value="name">Name</option><option value="registerNumber">Register No</option><option value="department">Dept</option>
          </select>
          <i class="bi bi-search search-icon"></i>
          <input
            type="text"
            id="globalSearchInput"
            class="form-control"
            placeholder="Search students..."
            onkeydown="if(event.key === 'Enter') handleGlobalSearch()"
          />
        </div>
        `
            : ''
        }

        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="toggleTheme()" title="Toggle theme" aria-label="Toggle theme"><i class="bi bi-sun-fill"></i></button>
        <a class="position-relative text-decoration-none" href="mentor-attention.html" title="Mentor attention" aria-label="Mentor attention"><i class="bi bi-bell fs-5"></i><span id="attentionBadge" class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-warning text-dark">0</span></a>
        <div class="user-profile-badge dropdown">
          <button type="button" class="btn btn-link p-0 text-decoration-none d-flex align-items-center gap-2 dropdown-toggle" data-bs-toggle="dropdown" id="userMenuDropdown" aria-expanded="false">
            <div class="user-avatar">${user.name.charAt(0)}</div>
            <div class="d-none d-lg-block text-start">
              <div class="fw-semibold text-dark" style="font-size: 0.85rem; line-height: 1.1;">${user.name}</div>
              <span class="badge bg-light text-dark border" style="font-size: 0.65rem;">
                ${role}
              </span>
            </div>
          </button>
          <ul class="dropdown-menu dropdown-menu-end shadow-sm" aria-labelledby="userMenuDropdown">
            <li><h6 class="dropdown-header">Dept: ${user.department || 'CSE'} ${user.registerNumber ? `(${user.registerNumber})` : ''}</h6></li>
            <li><a class="dropdown-item" href="settings.html"><i class="bi bi-person-gear me-2"></i>My Profile & Settings</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><button type="button" class="dropdown-item text-danger d-flex align-items-center gap-2" onclick="handleLogout(event)" data-action="logout"><i class="bi bi-box-arrow-right text-danger"></i><span>Sign Out / Logout</span></button></li>
          </ul>
        </div>

        <!-- Prominent Always-Visible Navbar Logout Button -->
        <button type="button" class="btn btn-outline-danger btn-sm d-flex align-items-center gap-1 px-2.5 py-1 shadow-sm" onclick="handleLogout(event)" data-action="logout" title="Sign Out of Portal">
          <i class="bi bi-box-arrow-right"></i>
          <span class="d-none d-sm-inline fw-semibold">Logout</span>
        </button>
      </div>
    </header>
  `;

  // Inject sidebar at start of app-wrapper
  appWrapper.insertAdjacentHTML('afterbegin', sidebarHtml);

  // Inject topbar at start of #main-content
  const mainContent = document.getElementById('main-content');
  if (mainContent) {
    mainContent.insertAdjacentHTML('afterbegin', topbarHtml);
    mainContent.insertAdjacentHTML('afterbegin', `
      <nav class="module-strip" aria-label="Primary modules">
        <a href="dashboard.html"><i class="bi bi-grid-1x2-fill"></i> Dashboard</a><a href="students.html"><i class="bi bi-people-fill"></i> Students</a>${canClient('canCreate') ? '<a href="add-student.html"><i class="bi bi-person-plus-fill"></i> Applications</a><a href="student-applications.html"><i class="bi bi-inbox-fill"></i> Review Queue</a>' : ''}<a href="analytics.html"><i class="bi bi-bar-chart-line-fill"></i> Analytics</a><a href="mentor-attention.html"><i class="bi bi-shield-exclamation"></i> Attention</a><a href="reports.html"><i class="bi bi-file-earmark-arrow-down-fill"></i> Reports</a><a href="settings.html"><i class="bi bi-gear-fill"></i> Settings</a>
      </nav>`);
  }

  apiCall('/insights/mentor-attention').then((result) => {
    const badge = document.getElementById('attentionBadge');
    if (badge && result.data) badge.textContent = result.data.totalAttentionCount || 0;
  }).catch(() => {});

  // Attach direct event listeners to all logout triggers
  setTimeout(() => {
    document.querySelectorAll('[data-action="logout"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        handleLogout(e);
      });
    });
  }, 50);

  // Inject toast notification container if not present
  if (!document.getElementById('toast-container')) {
    document.body.insertAdjacentHTML('beforeend', '<div id="toast-container" class="toast-container"></div>');
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sidebar) sidebar.classList.toggle('show');
  if (backdrop) backdrop.classList.toggle('show');
}

function handleGlobalSearch() {
  const input = document.getElementById('globalSearchInput');
  if (input && input.value.trim() !== '') {
    const category = document.getElementById('globalSearchCategory')?.value || 'all';
    window.location.href = `students.html?search=${encodeURIComponent(input.value.trim())}&searchType=${category}`;
  }
}

// ---------------------------------------------------------------------------
// Toast Notification
// ---------------------------------------------------------------------------

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const id = `toast-${Date.now()}`;
  const iconMap = {
    success: 'bi-check-circle-fill text-success',
    danger: 'bi-exclamation-triangle-fill text-danger',
    warning: 'bi-exclamation-circle-fill text-warning',
    info: 'bi-info-circle-fill text-info',
  };

  const toastHtml = `
    <div id="${id}" class="toast align-items-center shadow-lg border-0 mb-2" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex p-2">
        <div class="toast-body d-flex align-items-center gap-2" style="font-size: 0.9rem;">
          <i class="bi ${iconMap[type] || iconMap.info} fs-5"></i>
          <div>${message}</div>
        </div>
        <button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', toastHtml);
  const toastEl = document.getElementById(id);
  const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
  toast.show();

  toastEl.addEventListener('hidden.bs.toast', () => {
    toastEl.remove();
  });
}

// ---------------------------------------------------------------------------
// UI Formatters & Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch (e) {
    return dateStr;
  }
}

function getAcademicTrendBadge(trend) {
  if (!trend) return '<span class="badge bg-secondary">Insufficient Data</span>';
  if (typeof trend === 'object') trend = trend.trend || 'Stable';

  switch (trend) {
    case 'Improving':
      return '<span class="badge bg-success"><i class="bi bi-arrow-up-right me-1"></i>Improving Trend</span>';
    case 'Declining':
      return '<span class="badge bg-warning text-dark"><i class="bi bi-arrow-down-right me-1"></i>Declining Trend</span>';
    case 'Stable':
      return '<span class="badge bg-info text-dark"><i class="bi bi-arrow-right me-1"></i>Stable Trend</span>';
    default:
      return '<span class="badge bg-secondary">Insufficient Data</span>';
  }
}

function getArrearBadge(pendingCount) {
  const count = Number(pendingCount) || 0;
  if (count === 0) {
    return '<span class="badge badge-soft-success"><i class="bi bi-check2-circle me-1"></i>0 Arrears (All Clear)</span>';
  }
  return `<span class="badge badge-soft-danger"><i class="bi bi-exclamation-circle me-1"></i>${count} Pending Arrear${count > 1 ? 's' : ''}</span>`;
}
