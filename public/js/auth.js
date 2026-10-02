/**
 * Authentication Handler for Login Page
 */

document.addEventListener('DOMContentLoaded', () => {
  // If already logged in, redirect to dashboard
  if (localStorage.getItem('sps_token') && localStorage.getItem('sps_user')) {
    window.location.replace('dashboard.html');
    return;
  }

  // Skip the login page entirely for local preview usage.
  const previewUser = {
    id: 'preview-SUPER_ADMIN',
    name: 'Preview Administrator',
    email: 'admin@college.edu',
    role: 'SUPER_ADMIN',
    department: 'ALL',
  };
  localStorage.setItem('sps_token', 'local-frontend-preview');
  localStorage.setItem('sps_user', JSON.stringify(previewUser));
  window.location.replace('dashboard.html');
  return;

  const loginForm = document.getElementById('loginForm');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const togglePasswordIcon = document.getElementById('togglePasswordIcon');
  const loginBtn = document.getElementById('loginBtn');
  const loginBtnText = document.getElementById('loginBtnText');
  const loginSpinner = document.getElementById('loginSpinner');
  const loginAlert = document.getElementById('loginAlert');
  const loginAlertText = document.getElementById('loginAlertText');

  // Check if redirected after logout
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('logout') === 'true') {
    if (loginAlert && loginAlertText) {
      loginAlert.className = 'alert alert-success py-2 px-3 small d-flex align-items-center gap-2';
      loginAlertText.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i> You have logged out successfully.';
      loginAlert.classList.remove('d-none');
    }
  }

  // Toggle password visibility
  if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      togglePasswordIcon.classList.toggle('bi-eye', !isPassword);
      togglePasswordIcon.classList.toggle('bi-eye-slash', isPassword);
    });
  }

  // Handle Form Submission
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      loginAlert.classList.add('d-none');

      // Validation
      const email = emailInput.value.trim();
      const password = passwordInput.value;

      if (!email || !password) {
        showError('Please enter both institutional email and password.');
        return;
      }

      setLoading(true);

      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });

        const responseText = await response.text();
        let data;
        try {
          data = responseText ? JSON.parse(responseText) : {};
        } catch (parseError) {
          throw new Error(
            response.ok
              ? 'The server returned an invalid response. Please check the deployment configuration.'
              : `Server error (${response.status}). Please check that the API is running.`
          );
        }

        if (!response.ok) {
          throw new Error(data.message || 'Login failed. Please check credentials.');
        }

        // Store session
        localStorage.setItem('sps_token', data.data.token);
        localStorage.setItem('sps_user', JSON.stringify(data.data.user));

        // Redirect based on user role
        let redirectUrl = localStorage.getItem('sps_redirect');
        if (!redirectUrl || (data.data.user.role === 'student' && (redirectUrl.includes('dashboard') || redirectUrl.includes('audit')))) {
          if (data.data.user.role === 'student') {
            redirectUrl = data.data.user.studentProfileId
              ? `student-profile.html?id=${data.data.user.studentProfileId}`
              : 'student-profile.html';
          } else {
            redirectUrl = 'dashboard.html';
          }
        }
        localStorage.removeItem('sps_redirect');
        window.location.href = redirectUrl;
      } catch (err) {
        showError(err.message);
      } finally {
        setLoading(false);
      }
    });
  }

  function showError(msg) {
    if (loginAlert && loginAlertText) {
      loginAlert.textContent = '';
      loginAlert.className = 'alert alert-danger py-2 px-3 small d-flex align-items-center gap-2';
      loginAlert.innerHTML = `<i class="bi bi-exclamation-triangle-fill flex-shrink-0"></i><div>${msg}</div>`;
      loginAlert.classList.remove('d-none');
    }
  }

  function setLoading(isLoading) {
    if (loginBtn) {
      loginBtn.disabled = isLoading;
      loginSpinner.classList.toggle('d-none', !isLoading);
      loginBtnText.style.display = isLoading ? 'none' : 'inline-block';
    }
  }
});

// Quick fill credentials for demo
function fillCredentials(role) {
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');

  if (role === 'admin') {
    emailInput.value = 'admin@college.edu';
    passwordInput.value = 'Admin@123';
  } else if (role === 'faculty') {
    emailInput.value = 'faculty@college.edu';
    passwordInput.value = 'Mentor@123';
  } else if (role === 'student') {
    emailInput.value = 'student@college.edu';
    passwordInput.value = 'Student@123';
  }
}
