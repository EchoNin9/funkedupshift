/**
 * Initialize auth link/button across the site.
 * - Guest: grey "Sign in / Sign up" linking to auth.html
 * - Logged in: red "Sign out <username>" that signs out and redirects
 */
(function () {
  function updateAuthLinks() {
    var links = document.querySelectorAll('.auth-link');
    if (!links.length) return;
    if (!window.auth) {
      links.forEach(function (el) {
        el.href = 'auth.html';
        el.textContent = 'Sign in / Sign up';
        el.classList.remove('auth-link-signed-in');
        el.onclick = null;
        el.removeAttribute('role');
      });
      return;
    }
    window.auth.isAuthenticated(function (isAuth) {
      if (!isAuth) {
        links.forEach(function (el) {
          el.href = 'auth.html';
          el.textContent = 'Sign in / Sign up';
          el.classList.remove('auth-link-signed-in');
          el.onclick = null;
          el.removeAttribute('role');
        });
        return;
      }
      window.auth.getCurrentUserEmail(function (email) {
        var label = email ? ('Sign out ' + email) : 'Sign out';
        links.forEach(function (el) {
          el.href = '#';
          el.textContent = label;
          el.classList.add('auth-link-signed-in');
          el.setAttribute('role', 'button');
          el.onclick = function (e) {
            e.preventDefault();
            window.auth.signOut();
            window.location.href = 'index.html';
          };
        });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateAuthLinks);
  } else {
    updateAuthLinks();
  }
})();
