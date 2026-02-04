(function () {
  var base = window.API_BASE_URL || '';
  var loading = document.getElementById('loading');
  var errorEl = document.getElementById('error');
  var healthEl = document.getElementById('health');
  var sitesWrap = document.getElementById('sitesWrap');
  var sitesList = document.getElementById('sites');
  var addSiteForm = document.getElementById('addSiteForm');
  var createSiteForm = document.getElementById('createSiteForm');
  var createSiteResult = document.getElementById('createSiteResult');
  var authSection = document.getElementById('authSection');
  var signInForm = document.getElementById('signInForm');
  var signUpForm = document.getElementById('signUpForm');
  var userInfo = document.getElementById('userInfo');
  var signOutBtn = document.getElementById('signOutBtn');
  var showSignUpBtn = document.getElementById('showSignUp');

  function showError(msg) {
    loading.hidden = true;
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function hideLoading() {
    loading.hidden = true;
  }

  function setHealth(ok, text) {
    healthEl.textContent = text;
    healthEl.className = 'status ' + (ok ? 'ok' : 'err');
    healthEl.hidden = false;
  }

  function renderSites(sites) {
    if (!sites || sites.length === 0) {
      sitesList.innerHTML = '<li>No sites yet.</li>';
    } else {
      sitesList.innerHTML = sites.map(function (s) {
        var title = s.title || s.url || s.PK || 'Untitled';
        var url = s.url ? '<a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener">' + escapeHtml(s.url) + '</a>' : '';
        return '<li><strong>' + escapeHtml(title) + '</strong>' + (url ? ' ' + url : '') + '</li>';
      }).join('');
    }
    sitesWrap.hidden = false;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function fetchWithAuth(url, options) {
    options = options || {};
    options.headers = options.headers || {};
    return new Promise(function (resolve, reject) {
      window.auth.getAccessToken(function (token) {
        if (token) {
          options.headers['Authorization'] = 'Bearer ' + token;
        }
        fetch(url, options).then(resolve).catch(reject);
      });
    });
  }

  function initAuth() {
    if (!window.auth) {
      authSection.hidden = true;
      return;
    }
    authSection.hidden = false;

    window.auth.isAuthenticated(function (isAuth) {
      if (isAuth) {
        signInForm.hidden = true;
        signUpForm.hidden = true;
        showSignUpBtn.hidden = true;
        signOutBtn.hidden = false;
        addSiteForm.hidden = false;
        window.auth.getCurrentUserEmail(function (email) {
          userInfo.textContent = 'Signed in as: ' + (email || 'user');
          userInfo.hidden = false;
        });
      } else {
        signInForm.hidden = false;
        signUpForm.hidden = true;
        showSignUpBtn.hidden = false;
        signOutBtn.hidden = true;
        userInfo.hidden = true;
        addSiteForm.hidden = true;
      }
    });

    signInForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('signInEmail').value;
      var password = document.getElementById('signInPassword').value;
      window.auth.signIn(email, password, function (err) {
        if (err) {
          alert('Sign in failed: ' + (err.message || err));
          return;
        }
        location.reload();
      });
    });

    signUpForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('signUpEmail').value;
      var password = document.getElementById('signUpPassword').value;
      window.auth.signUp(email, password, function (err, result) {
        if (err) {
          alert('Sign up failed: ' + (err.message || err));
          return;
        }
        alert('Sign up successful! Check your email for verification code.');
        signUpForm.hidden = true;
        signInForm.hidden = false;
      });
    });

    createSiteForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var url = document.getElementById('siteUrl').value.trim();
      var title = document.getElementById('siteTitle').value.trim();
      if (!url) {
        createSiteResult.textContent = 'URL is required';
        createSiteResult.className = 'status err';
        return;
      }
      createSiteResult.textContent = 'Creating...';
      createSiteResult.className = 'status';
      createSiteResult.hidden = false;
      fetchWithAuth(base + '/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, title: title })
      }).then(function (r) {
        if (r.ok) {
          return r.json();
        }
        return r.text().then(function (text) {
          throw new Error(text || 'Request failed');
        });
      }).then(function (data) {
        createSiteResult.textContent = 'Site added: ' + (data.title || data.url);
        createSiteResult.className = 'status ok';
        document.getElementById('siteUrl').value = '';
        document.getElementById('siteTitle').value = '';
        // Reload sites list
        fetch(base + '/sites')
          .then(function (r) { return r.json(); })
          .then(function (data) { renderSites(data.sites || []); });
      }).catch(function (e) {
        createSiteResult.textContent = 'Error: ' + e.message;
        createSiteResult.className = 'status err';
      });
    });
  }

  if (!base) {
    showError('API URL not set. Deploy via CI or set window.API_BASE_URL in config.js.');
    return;
  }

  base = base.replace(/\/$/, '');

  initAuth();

  fetch(base + '/health')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      setHealth(data.ok === true, 'API: ' + (data.ok ? 'OK' : 'Error'));
    })
    .catch(function (e) {
      setHealth(false, 'API health check failed: ' + e.message);
    });

  fetch(base + '/sites')
    .then(function (r) {
      if (!r.ok) {
        return r.text().then(function (text) {
          throw new Error('HTTP ' + r.status + ': ' + text);
        });
      }
      return r.json();
    })
    .then(function (data) {
      renderSites(data.sites || []);
    })
    .catch(function (e) {
      console.error('GET /sites error:', e);
      showError('Failed to load sites: ' + e.message);
      renderSites([]);
    })
    .then(hideLoading);
})();
