(function () {
  var base = (window.API_BASE_URL || '').replace(/\/$/, '');
  var messageEl = document.getElementById('message');
  var formWrap = document.getElementById('formWrap');
  var createMediaForm = document.getElementById('createMediaForm');
  var createResult = document.getElementById('createResult');
  var allCategories = [];
  var selectedIds = [];

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
      }
    });

    document.getElementById('categorySelected').addEventListener('click', function (e) {
      var btn = e.target.closest('.category-chip-remove');
      if (btn && btn.dataset.id) removeCategory(btn.dataset.id);
    });

    document.addEventListener('click', function (e) {
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
        if (token) options.headers['Authorization'] = 'Bearer ' + token;
        fetch(url, options).then(resolve).catch(reject);
      });
    });
  }

  function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
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
          showMessage('Admin access required. Only admins can add media.', true);
          return;
        }
        formWrap.hidden = false;
        fetchWithAuth(base + '/media-categories')
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

  var mediaFileInput = document.getElementById('mediaFile');
  if (mediaFileInput) {
    mediaFileInput.addEventListener('change', function () {
      var file = mediaFileInput.files[0];
      var previewEl = document.getElementById('mediaPreview');
      var errEl = document.getElementById('mediaError');
      if (!file) {
        if (previewEl) { previewEl.innerHTML = ''; previewEl.hidden = true; }
        if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
        return;
      }
      if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
      if (file.type.startsWith('image/')) {
        var img = new Image();
        img.onload = function () {
          previewEl.innerHTML = '<img src="' + URL.createObjectURL(file) + '" alt="Preview">';
          previewEl.hidden = false;
        };
        img.onerror = function () {
          if (errEl) { errEl.textContent = 'Invalid image file.'; errEl.hidden = false; }
        };
        img.src = URL.createObjectURL(file);
      } else if (file.type.startsWith('video/')) {
        previewEl.innerHTML = '<video src="' + URL.createObjectURL(file) + '" muted controls style="max-width:200px;max-height:150px;"></video>';
        previewEl.hidden = false;
      } else {
        if (errEl) { errEl.textContent = 'Please choose an image (png, jpeg, gif, webp) or video (mp4, webm).'; errEl.hidden = false; }
      }
    });
  }

  if (createMediaForm) {
    createMediaForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var title = document.getElementById('mediaTitle').value.trim();
      var description = document.getElementById('mediaDescription').value.trim();
      var file = mediaFileInput && mediaFileInput.files[0];
      if (!file) {
        createResult.textContent = 'Please select an image or video file.';
        createResult.className = 'status err';
        createResult.hidden = false;
        return;
      }
      var mediaType = file.type.startsWith('video/') ? 'video' : 'image';
      var mediaId = 'MEDIA#' + uuidv4();

      createResult.textContent = 'Uploading...';
      createResult.className = 'status';
      createResult.hidden = false;

      fetchWithAuth(base + '/media/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaId: mediaId,
          mediaType: mediaType,
          contentType: file.type || (mediaType === 'image' ? 'image/png' : 'video/mp4')
        })
      })
        .then(function (r) {
          if (r.ok) return r.json();
          return r.text().then(function (t) { throw new Error(t || 'Upload failed'); });
        })
        .then(function (data) {
          return fetch(data.uploadUrl, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': file.type || (mediaType === 'image' ? 'image/png' : 'video/mp4') }
          }).then(function (putRes) {
            if (!putRes.ok) throw new Error('Upload failed');
            return data.key;
          });
        })
        .then(function (key) {
          return fetchWithAuth(base + '/media', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: mediaId,
              mediaKey: key,
              title: title || 'Untitled',
              description: description || '',
              mediaType: mediaType,
              categoryIds: selectedIds.slice()
            })
          });
        })
        .then(function (r) {
          if (r.ok) return r.json();
          return r.text().then(function (t) { throw new Error(t || 'Request failed'); });
        })
        .then(function (data) {
          createResult.textContent = 'Media added.';
          createResult.className = 'status ok';
          window.location.href = 'media-view.html?id=' + encodeURIComponent(mediaId);
        })
        .catch(function (e) {
          createResult.textContent = 'Error: ' + e.message;
          createResult.className = 'status err';
        });
    });
  }
})();
