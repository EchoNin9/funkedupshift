/**
 * Initialize auth link/button across the site.
 * - Guest: grey "Sign in / Sign up" linking to auth.html; hide .profile-link
 * - Logged in: red "Sign out <username>"; show .profile-link
 */
(function () {
  function updateAuthLinks() {
    var links = document.querySelectorAll('.auth-link');
    var profileLinks = document.querySelectorAll('.profile-link');
    if (!window.auth) {
      links.forEach(function (el) {
        el.href = 'auth.html';
        el.textContent = 'Sign in / Sign up';
        el.classList.remove('auth-link-signed-in');
        el.onclick = null;
        el.removeAttribute('role');
      });
      profileLinks.forEach(function (el) { el.style.display = 'none'; });
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
        profileLinks.forEach(function (el) { el.style.display = 'none'; });
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
            if (window.profileBoxClearCache) window.profileBoxClearCache();
            window.auth.signOut();
            window.location.href = 'index.html';
          };
        });
      });
      profileLinks.forEach(function (el) {
        el.href = 'profile.html';
        el.textContent = 'Profile';
        el.style.display = '';
        el.onclick = null;
        el.removeAttribute('role');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateAuthLinks);
  } else {
    updateAuthLinks();
  }
})();
