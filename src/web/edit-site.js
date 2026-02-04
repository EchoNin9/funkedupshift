(function () {
  var base = (window.API_BASE_URL || '').replace(/\/$/, '');
  var messageEl = document.getElementById('message');
  var formWrap = document.getElementById('formWrap');
  var editSiteForm = document.getElementById('editSiteForm');
  var saveResult = document.getElementById('saveResult');

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

        var currentIds = site.categoryIds || [];
        var cats = (catData && catData.categories) || [];
        var el = document.getElementById('categoryChoices');
        if (el) {
          el.innerHTML = '<label>Categories:</label>' + (cats.length ? cats.map(function (c) {
            var id = c.PK || c.id || '';
            var name = c.name || id;
            var checked = currentIds.indexOf(id) !== -1 ? ' checked' : '';
            return '<label class="checkbox"><input type="checkbox" name="category" value="' + id + '"' + checked + '> ' + name + '</label>';
          }).join('') : '<p>No categories. <a href="categories.html">Create categories</a>.</p>');
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
      var categoryIds = [];
      Array.prototype.forEach.call(document.querySelectorAll('#categoryChoices input[name=category]:checked'), function (cb) {
        if (cb.value) categoryIds.push(cb.value);
      });

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
