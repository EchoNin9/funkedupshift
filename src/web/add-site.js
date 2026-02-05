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
        fetchWithAuth(base + '/categories')
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            var el = document.getElementById('categoryChoices');
            if (!el) return;
            var cats = (data && data.categories) || [];
            if (cats.length === 0) {
              el.innerHTML = '<p class="muted">No categories yet. <a href="categories.html">Create categories</a>.</p>';
            } else {
              el.innerHTML = '<label>Categories:</label>' + cats.map(function (c) {
                var id = c.PK || c.id || '';
                var name = (c.name || id);
                return '<label class="checkbox"><input type="checkbox" name="category" value="' + id + '"> ' + name + '</label>';
              }).join('');
            }
          })
          .catch(function () {
            var el = document.getElementById('categoryChoices');
            if (el) el.innerHTML = '<p class="muted">Could not load categories.</p>';
          });
      })
      .catch(function () {
        showMessage('Could not verify admin access.', true);
      });
  });

  var MIN_LOGO_SIZE = 100;
  var MAX_LOGO_BYTES = 5 * 1024 * 1024;

  function validateLogoFile(file, callback) {
    var errEl = document.getElementById('logoError');
    var previewEl = document.getElementById('logoPreview');
    if (!file) {
      if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
      if (previewEl) { previewEl.innerHTML = ''; previewEl.hidden = true; }
      callback(null);
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      if (errEl) { errEl.textContent = 'Logo must be 5 MB or smaller.'; errEl.hidden = false; }
      callback(new Error('Logo must be 5 MB or smaller'));
      return;
    }
    var img = new Image();
    img.onload = function () {
      if (img.naturalWidth < MIN_LOGO_SIZE || img.naturalHeight < MIN_LOGO_SIZE) {
        if (errEl) { errEl.textContent = 'Logo must be at least 100×100 pixels.'; errEl.hidden = false; }
        callback(new Error('Logo must be at least 100×100 pixels'));
        return;
      }
      if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
      if (previewEl) {
        var u = URL.createObjectURL(file);
        previewEl.innerHTML = '<img src="' + u + '" alt="Preview">';
        previewEl.hidden = false;
      }
      callback(null);
    };
    img.onerror = function () {
      if (errEl) { errEl.textContent = 'Please choose a valid image file.'; errEl.hidden = false; }
      callback(new Error('Invalid image'));
    };
    img.src = URL.createObjectURL(file);
  }

  var logoFileInput = document.getElementById('siteLogo');
  if (logoFileInput) {
    logoFileInput.addEventListener('change', function () {
      validateLogoFile(logoFileInput.files[0], function () {});
    });
  }

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
      var file = logoFileInput && logoFileInput.files[0];
      var logoKeyToSend = null;
      createSiteResult.textContent = 'Creating...';
      createSiteResult.className = 'status';
      createSiteResult.hidden = false;

      function doCreateSite(logoKey) {
        var categoryIds = [];
        Array.prototype.forEach.call(document.querySelectorAll('#categoryChoices input[name=category]:checked'), function (cb) {
          if (cb.value) categoryIds.push(cb.value);
        });
        var payload = { url: url, title: title, description: description, categoryIds: categoryIds };
        if (logoKey) payload.logoKey = logoKey;
        return fetchWithAuth(base + '/sites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
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
            if (logoFileInput) logoFileInput.value = '';
            var previewEl = document.getElementById('logoPreview');
            if (previewEl) { previewEl.innerHTML = ''; previewEl.hidden = true; }
            window.location.href = 'index.html';
          });
      }

      if (file) {
        validateLogoFile(file, function (err) {
          if (err) {
            createSiteResult.textContent = err.message || 'Invalid logo';
            createSiteResult.className = 'status err';
            return;
          }
          fetchWithAuth(base + '/sites/logo-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteId: 'new', contentType: file.type || 'image/png' })
          })
            .then(function (r) {
              if (r.ok) return r.json();
              return r.text().then(function (t) { throw new Error(t || 'Upload failed'); });
            })
            .then(function (data) {
              return fetch(data.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'image/png' } })
                .then(function (putRes) {
                  if (!putRes.ok) throw new Error('Upload failed');
                  return data.key;
                });
            })
            .then(function (key) {
              return doCreateSite(key);
            })
            .catch(function (e) {
              createSiteResult.textContent = 'Error: ' + e.message;
              createSiteResult.className = 'status err';
            });
        });
      } else {
        doCreateSite(null).catch(function (e) {
          createSiteResult.textContent = 'Error: ' + e.message;
          createSiteResult.className = 'status err';
        });
      }
    });
  }
})();
