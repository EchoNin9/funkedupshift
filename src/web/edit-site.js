(function () {
  var base = (window.API_BASE_URL || '').replace(/\/$/, '');
  var messageEl = document.getElementById('message');
  var formWrap = document.getElementById('formWrap');
  var editSiteForm = document.getElementById('editSiteForm');
  var saveResult = document.getElementById('saveResult');
  var allCategories = [];
  var selectedIds = [];
  var currentLogoKey = null;
  var removeLogoRequested = false;
  var DEFAULT_LOGO_PATH = 'img/default-site-logo.png';
  var MIN_LOGO_SIZE = 100;
  var MAX_LOGO_BYTES = 5 * 1024 * 1024;

  function getSiteId() {
    var params = new URLSearchParams(window.location.search);
    return params.get('id') || '';
  }

  function showMessage(msg, isError) {
    if (!messageEl) return;
    messageEl.textContent = msg;
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
        if (token) options.headers['Authorization'] = 'Bearer ' + token;
        fetch(url, options).then(resolve).catch(reject);
      });
    });
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function renderDropdown(filter) {
    var dropdown = document.getElementById('categoryDropdown');
    var search = document.getElementById('categorySearch');
    if (!dropdown || !search) return;
    var q = (filter || search.value || '').toLowerCase().trim();
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
      }
    });

    document.getElementById('categorySelected').addEventListener('click', function (e) {
      var btn = e.target.closest('.category-chip-remove');
      if (btn && btn.dataset.id) removeCategory(btn.dataset.id);
    });

    document.addEventListener('click', function (e) {
      if (!search.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.hidden = true;
      }
    });
  }

  if (!base) {
    showMessage('API URL not set.', true);
    return;
  }

  var siteId = getSiteId();
  if (!siteId) {
    showMessage('Missing site id in URL (e.g. edit-site.html?id=SITE#...).', true);
    return;
  }

  if (!window.auth) {
    showMessage('Sign in required. <a href="auth.html">Sign in</a>.', true);
    return;
  }

  window.auth.isAuthenticated(function (isAuth) {
    if (!isAuth) {
      showMessage('Sign in required.', true);
      return;
    }

    Promise.all([
      fetchWithAuth(base + '/me').then(function (r) { return r.json(); }),
      fetchWithAuth(base + '/sites?id=' + encodeURIComponent(siteId)).then(function (r) { return r.json(); }),
      fetchWithAuth(base + '/categories').then(function (r) { return r.json(); })
    ])
      .then(function (results) {
        var user = results[0];
        var siteData = results[1];
        var catData = results[2];
        var groups = (user && user.groups) || [];
        var isAdmin = groups.indexOf('admin') !== -1;
        if (!isAdmin) {
          showMessage('Admin access required.', true);
          return;
        }
        var site = siteData && siteData.site;
        if (!site) {
          showMessage('Site not found.', true);
          return;
        }

        document.getElementById('siteId').value = site.PK || siteId;
        document.getElementById('siteTitle').value = site.title || '';
        document.getElementById('siteDescription').value = site.description || '';

        currentLogoKey = (site.logoKey && site.logoKey.trim()) ? site.logoKey : null;
        removeLogoRequested = false;
        var currentWrap = document.getElementById('currentLogoWrap');
        var currentImg = document.getElementById('currentLogoImg');
        if (currentWrap && currentImg) {
          if (site.logoUrl && site.logoUrl.trim()) {
            currentImg.src = site.logoUrl;
          } else {
            currentImg.src = DEFAULT_LOGO_PATH;
          }
          currentWrap.hidden = !currentLogoKey;
        }
        var logoInput = document.getElementById('siteLogo');
        if (logoInput) logoInput.value = '';
        var previewEl = document.getElementById('logoPreview');
        if (previewEl) { previewEl.innerHTML = ''; previewEl.hidden = true; }
        var errEl = document.getElementById('logoError');
        if (errEl) { errEl.textContent = ''; errEl.hidden = true; }

        var cats = (catData && catData.categories) || [];
        allCategories = cats.map(function (c) {
          var id = c.PK || c.id || '';
          return { id: id, name: c.name || id };
        });
        selectedIds = site.categoryIds || [];

        var searchEl = document.getElementById('categorySearch');
        var emptyEl = document.getElementById('categoryEmpty');
        if (allCategories.length === 0) {
          if (searchEl) searchEl.style.display = 'none';
          if (emptyEl) emptyEl.hidden = false;
        } else {
          if (searchEl) searchEl.style.display = '';
          if (emptyEl) emptyEl.hidden = true;
          initCategoryMultiselect();
          renderSelected();
        }

        formWrap.hidden = false;
      })
      .catch(function (e) {
        showMessage('Failed to load: ' + (e.message || 'Unknown error'), true);
      });
  });

  var logoFileInput = document.getElementById('siteLogo');
  var removeLogoBtn = document.getElementById('removeLogoBtn');

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
        previewEl.innerHTML = '<img src="' + u + '" alt="New logo">';
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

  if (removeLogoBtn) {
    removeLogoBtn.addEventListener('click', function () {
      removeLogoRequested = true;
      var w = document.getElementById('currentLogoWrap');
      if (w) w.hidden = true;
      if (logoFileInput) logoFileInput.value = '';
      var previewEl = document.getElementById('logoPreview');
      if (previewEl) { previewEl.innerHTML = ''; previewEl.hidden = true; }
    });
  }
  if (logoFileInput) {
    logoFileInput.addEventListener('change', function () {
      removeLogoRequested = false;
      validateLogoFile(logoFileInput.files[0], function () {});
    });
  }

  if (editSiteForm) {
    editSiteForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var id = document.getElementById('siteId').value.trim();
      var title = document.getElementById('siteTitle').value.trim();
      var description = document.getElementById('siteDescription').value.trim();
      var categoryIds = selectedIds.slice();
      var file = logoFileInput && logoFileInput.files[0];

      saveResult.textContent = 'Saving...';
      saveResult.className = 'status';
      saveResult.hidden = false;

      function doUpdate(payload) {
        return fetchWithAuth(base + '/sites', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
          .then(function (r) {
            if (r.ok) return r.json();
            return r.text().then(function (t) { throw new Error(t || 'Failed'); });
          })
          .then(function () {
            saveResult.textContent = 'Saved.';
            saveResult.className = 'status ok';
            window.location.href = 'websites.html';
          });
      }

      var payload = { id: id, title: title, description: description, categoryIds: categoryIds };
      if (removeLogoRequested) {
        payload.deleteLogo = true;
        doUpdate(payload).catch(function (e) {
          saveResult.textContent = 'Error: ' + e.message;
          saveResult.className = 'status err';
        });
        return;
      }
      if (file) {
        validateLogoFile(file, function (err) {
          if (err) {
            saveResult.textContent = err.message || 'Invalid logo';
            saveResult.className = 'status err';
            return;
          }
          fetchWithAuth(base + '/sites/logo-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteId: id, contentType: file.type || 'image/png' })
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
              payload.logoKey = key;
              return doUpdate(payload);
            })
            .catch(function (e) {
              saveResult.textContent = 'Error: ' + e.message;
              saveResult.className = 'status err';
            });
        });
      } else {
        doUpdate(payload).catch(function (e) {
          saveResult.textContent = 'Error: ' + e.message;
          saveResult.className = 'status err';
        });
      }
    });
  }
})();
