(function () {
  var base = (window.API_BASE_URL || '').replace(/\/$/, '');
  var messageEl = document.getElementById('message');
  var formWrap = document.getElementById('formWrap');
  var createSiteForm = document.getElementById('createSiteForm');
  var createSiteResult = document.getElementById('createSiteResult');
  var allCategories = [];
  var selectedIds = [];
  var categoryDropdownJustSelected = false;

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function renderDropdown() {
    var dropdown = document.getElementById('categoryDropdown');
    var search = document.getElementById('categorySearch');
    if (!dropdown || !search) return;
    var q = (search.value || '').toLowerCase().trim();
    var opts = allCategories.filter(function (c) {
      if (selectedIds.indexOf(c.id) !== -1) return false;
      return !q || (c.name || '').toLowerCase().indexOf(q) !== -1;
    });
    dropdown.innerHTML = opts.length ? opts.map(function (c) {
      return '<div class="category-dropdown-option" data-id="' + escapeHtml(c.id) + '" data-name="' + escapeHtml(c.name) + '">' + escapeHtml(c.name) + '</div>';
    }).join('') : '<div class="category-dropdown-option" style="color:#666;cursor:default;">No matches</div>';
    dropdown.hidden = false;
  }

  function renderSelected() {
    var el = document.getElementById('categorySelected');
    if (!el) return;
    el.innerHTML = selectedIds.map(function (id) {
      var c = allCategories.find(function (x) { return x.id === id; });
      var name = c ? c.name : id;
      return '<span class="category-chip">' + escapeHtml(name) + '<button type="button" class="category-chip-remove" data-id="' + escapeHtml(id) + '" aria-label="Remove">×</button></span>';
    }).join('');
  }

  function addCategory(id) {
    if (selectedIds.indexOf(id) === -1) {
      selectedIds.push(id);
      renderSelected();
      renderDropdown();
    }
  }

  function removeCategory(id) {
    selectedIds = selectedIds.filter(function (x) { return x !== id; });
    renderSelected();
    renderDropdown();
  }

  function initCategoryMultiselect() {
    var search = document.getElementById('categorySearch');
    var dropdown = document.getElementById('categoryDropdown');
    if (!search || !dropdown) return;

    search.addEventListener('focus', function () { renderDropdown(); });
    search.addEventListener('input', function () { renderDropdown(); });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') dropdown.hidden = true;
    });

    dropdown.addEventListener('click', function (e) {
      var opt = e.target.closest('.category-dropdown-option');
      if (opt && opt.dataset.id) {
        addCategory(opt.dataset.id);
        search.value = '';
        search.focus();
        categoryDropdownJustSelected = true;
        setTimeout(function () { categoryDropdownJustSelected = false; }, 0);
      }
    });

    document.getElementById('categorySelected').addEventListener('click', function (e) {
      var btn = e.target.closest('.category-chip-remove');
      if (btn && btn.dataset.id) removeCategory(btn.dataset.id);
    });

    document.addEventListener('click', function (e) {
      if (categoryDropdownJustSelected) return;
      if (search && dropdown && !search.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.hidden = true;
      }
    });
  }

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
            var searchEl = document.getElementById('categorySearch');
            var emptyEl = document.getElementById('categoryEmpty');
            if (!searchEl) return;
            var cats = (data && data.categories) || [];
            allCategories = cats.map(function (c) {
              var id = c.PK || c.id || '';
              return { id: id, name: c.name || id };
            });
            selectedIds = [];
            if (allCategories.length === 0) {
              searchEl.style.display = 'none';
              if (emptyEl) emptyEl.hidden = false;
            } else {
              searchEl.style.display = '';
              if (emptyEl) emptyEl.hidden = true;
              initCategoryMultiselect();
              renderSelected();
            }
          })
          .catch(function () {
            var emptyEl = document.getElementById('categoryEmpty');
            var searchEl = document.getElementById('categorySearch');
            if (searchEl) searchEl.style.display = 'none';
            if (emptyEl) { emptyEl.textContent = 'Could not load categories.'; emptyEl.hidden = false; }
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
        var categoryIds = selectedIds.slice();
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
            selectedIds = [];
            renderSelected();
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
