(function () {
  var base = (window.API_BASE_URL || '').replace(/\/$/, '');
  var messageEl = document.getElementById('message');
  var formWrap = document.getElementById('formWrap');
  var editSiteForm = document.getElementById('editSiteForm');
  var saveResult = document.getElementById('saveResult');
  var allCategories = [];
  var selectedIds = [];

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

  if (editSiteForm) {
    editSiteForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var id = document.getElementById('siteId').value.trim();
      var title = document.getElementById('siteTitle').value.trim();
      var description = document.getElementById('siteDescription').value.trim();
      var categoryIds = selectedIds.slice();

      saveResult.textContent = 'Saving...';
      saveResult.className = 'status';
      saveResult.hidden = false;

      fetchWithAuth(base + '/sites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, title: title, description: description, categoryIds: categoryIds })
      })
        .then(function (r) {
          if (r.ok) return r.json();
          return r.text().then(function (t) { throw new Error(t || 'Failed'); });
        })
        .then(function () {
          saveResult.textContent = 'Saved.';
          saveResult.className = 'status ok';
          window.location.href = 'index.html';
        })
        .catch(function (e) {
          saveResult.textContent = 'Error: ' + e.message;
          saveResult.className = 'status err';
        });
    });
  }
})();
