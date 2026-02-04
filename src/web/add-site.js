(function () {
  var base = (window.API_BASE_URL || '').replace(/\/$/, '');
  var messageEl = document.getElementById('message');
  var formWrap = document.getElementById('formWrap');
  var createSiteForm = document.getElementById('createSiteForm');
  var createSiteResult = document.getElementById('createSiteResult');

  function showMessage(msg, isError) {
    if (!messageEl) return;
    messageEl.innerHTML = msg;
    messageEl.className = 'status ' + (isError ? 'err' : 'ok');
    messageEl.hidden = false;
  }

  function fetchWithAuth(url, options) {
    options = options || {};
    options.headers = options.headers || {};
    return new Promise(function (resolve, reject) {
      if (!window.auth || !window.auth.getAccessToken) {
        reject(new Error('Not signed in'));
        return;
      }
      window.auth.getAccessToken(function (token) {
        if (token) {
          options.headers['Authorization'] = 'Bearer ' + token;
        }
        fetch(url, options).then(resolve).catch(reject);
      });
    });
  }

  if (!base) {
    showMessage('API URL not set. Deploy via CI or set window.API_BASE_URL in config.js.', true);
    return;
  }

  if (!window.auth) {
    showMessage('Sign in required. <a href="auth.html">Sign in</a>.', true);
    return;
  }

  window.auth.isAuthenticated(function (isAuth) {
    if (!isAuth) {
      showMessage('Sign in required. <a href="auth.html">Sign in</a>', true);
      return;
    }

    fetchWithAuth(base + '/me')
      .then(function (r) { return r.ok ? r.json() : r.text().then(function (t) { throw new Error(t || 'Failed'); }); })
      .then(function (user) {
        var groups = user.groups || [];
        var isAdmin = Array.isArray(groups) && groups.indexOf('admin') !== -1;
        if (!isAdmin) {
          showMessage('Admin access required. Only admins can add sites.', true);
          return;
        }
        formWrap.hidden = false;
      })
      .catch(function () {
        showMessage('Could not verify admin access.', true);
      });
  });

  if (createSiteForm) {
    createSiteForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var url = document.getElementById('siteUrl').value.trim();
      var title = document.getElementById('siteTitle').value.trim();
      var description = document.getElementById('siteDescription').value.trim();
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
        body: JSON.stringify({ url: url, title: title, description: description })
      })
        .then(function (r) {
          if (r.ok) return r.json();
          return r.text().then(function (text) { throw new Error(text || 'Request failed'); });
        })
        .then(function (data) {
          createSiteResult.textContent = 'Site added: ' + (data.title || data.url);
          createSiteResult.className = 'status ok';
          document.getElementById('siteUrl').value = '';
          document.getElementById('siteTitle').value = '';
          document.getElementById('siteDescription').value = '';
          window.location.href = 'index.html';
        })
        .catch(function (e) {
          createSiteResult.textContent = 'Error: ' + e.message;
          createSiteResult.className = 'status err';
        });
    });
  }
})();
