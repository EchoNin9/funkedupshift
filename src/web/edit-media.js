(function () {
  var base = (window.API_BASE_URL || '').replace(/\/$/, '');
  var messageEl = document.getElementById('message');
  var formWrap = document.getElementById('formWrap');
  var editMediaForm = document.getElementById('editMediaForm');
  var saveResult = document.getElementById('saveResult');
  var allCategories = [];
  var selectedIds = [];
  var mediaFileInput = document.getElementById('mediaFile');

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function getMediaId() {
    var match = /[?&]id=([^&]*)/.exec(window.location.search);
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')).trim() : '';
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

  var mediaId = getMediaId();
  if (!mediaId) {
    showMessage('Missing media id in URL (e.g. edit-media.html?id=MEDIA#...).', true);
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
      fetch(base + '/media?id=' + encodeURIComponent(mediaId)).then(function (r) { return r.json(); }),
      fetchWithAuth(base + '/media-categories').then(function (r) { return r.json(); })
    ])
      .then(function (results) {
        var user = results[0];
        var mediaData = results[1];
        var catData = results[2];
        var groups = (user && user.groups) || [];
        var isAdmin = groups.indexOf('admin') !== -1;
        if (!isAdmin) {
          showMessage('Admin access required.', true);
          return;
        }
        var m = mediaData && mediaData.media;
        if (!m) {
          showMessage('Media not found.', true);
          return;
        }

        document.getElementById('mediaId').value = m.PK || m.id || mediaId;
        document.getElementById('mediaTitle').value = m.title || '';
        document.getElementById('mediaDescription').value = m.description || '';

        var currentWrap = document.getElementById('currentMediaWrap');
        var currentImg = document.getElementById('currentMediaImg');
        var currentVideo = document.getElementById('currentMediaVideo');
        if (currentWrap && currentImg && currentVideo) {
          if (m.mediaType === 'video' && m.mediaUrl) {
            currentVideo.src = m.mediaUrl;
            currentVideo.hidden = false;
            currentImg.style.display = 'none';
          } else if (m.mediaUrl) {
            currentImg.src = m.mediaUrl;
            currentImg.style.display = 'block';
            currentVideo.hidden = true;
          }
          currentWrap.hidden = !m.mediaUrl;
        }

        var thumbWrap = document.getElementById('thumbnailUploadWrap');
        var thumbImg = document.getElementById('currentThumbImg');
        var noThumbPlaceholder = document.getElementById('noThumbPlaceholder');
        if (thumbWrap && thumbImg) {
          if (m.mediaType === 'video') {
            thumbWrap.hidden = false;
            if (m.thumbnailUrl && m.thumbnailUrl.trim()) {
              thumbImg.src = m.thumbnailUrl;
              thumbImg.style.display = 'block';
              if (noThumbPlaceholder) noThumbPlaceholder.hidden = true;
            } else {
              thumbImg.src = '';
              thumbImg.style.display = 'none';
              if (noThumbPlaceholder) { noThumbPlaceholder.textContent = 'Using auto-generated thumbnail'; noThumbPlaceholder.hidden = false; }
            }
          } else {
            thumbWrap.hidden = true;
          }
        }

        if (mediaFileInput) mediaFileInput.value = '';
        var previewEl = document.getElementById('mediaPreview');
        if (previewEl) { previewEl.innerHTML = ''; previewEl.hidden = true; }
        var errEl = document.getElementById('mediaError');
        if (errEl) { errEl.textContent = ''; errEl.hidden = true; }

        var cats = (catData && catData.categories) || [];
        allCategories = cats.map(function (c) {
          var id = c.PK || c.id || '';
          return { id: id, name: c.name || id };
        });
        selectedIds = m.categoryIds || [];

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

  function validateMediaFile(file, callback) {
    var errEl = document.getElementById('mediaError');
    var previewEl = document.getElementById('mediaPreview');
    if (!file) {
      if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
      if (previewEl) { previewEl.innerHTML = ''; previewEl.hidden = true; }
      callback(null);
      return;
    }
    if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
    if (file.type.startsWith('image/')) {
      var img = new Image();
      img.onload = function () {
        previewEl.innerHTML = '<img src="' + URL.createObjectURL(file) + '" alt="New media">';
        previewEl.hidden = false;
        callback(null);
      };
      img.onerror = function () {
        if (errEl) { errEl.textContent = 'Please choose a valid image file.'; errEl.hidden = false; }
        callback(new Error('Invalid image'));
      };
      img.src = URL.createObjectURL(file);
    } else if (file.type.startsWith('video/')) {
      previewEl.innerHTML = '<video src="' + URL.createObjectURL(file) + '" muted controls style="max-width:200px;max-height:150px;"></video>';
      previewEl.hidden = false;
      callback(null);
    } else {
      if (errEl) { errEl.textContent = 'Please choose an image or video file.'; errEl.hidden = false; }
      callback(new Error('Invalid file type'));
    }
  }

  if (mediaFileInput) {
    mediaFileInput.addEventListener('change', function () {
      validateMediaFile(mediaFileInput.files[0], function () {});
    });
  }

  var takeScreenshotBtn = document.getElementById('takeScreenshotBtn');
  if (takeScreenshotBtn) {
    takeScreenshotBtn.addEventListener('click', function () {
      var id = document.getElementById('mediaId').value.trim();
      if (!id) return;
      var thumbErr = document.getElementById('thumbnailError');
      if (thumbErr) { thumbErr.textContent = ''; thumbErr.hidden = true; }
      takeScreenshotBtn.disabled = true;
      takeScreenshotBtn.textContent = 'Regenerating…';
      fetchWithAuth(base + '/media/regenerate-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaId: id })
      })
        .then(function (r) {
          if (r.ok) return r.json();
          return r.text().then(function (t) { throw new Error(t || 'Regeneration failed'); });
        })
        .then(function () {
          if (thumbErr) { thumbErr.textContent = 'Screenshot started. New thumbnail will appear in a few seconds.'; thumbErr.className = 'status'; thumbErr.hidden = false; }
          takeScreenshotBtn.disabled = false;
          takeScreenshotBtn.textContent = 'Take screenshot';
          setTimeout(function () {
            fetchWithAuth(base + '/media?id=' + encodeURIComponent(id))
              .then(function (r) { return r.ok ? r.json() : null; })
              .then(function (data) {
                var m = data && data.media;
                var thumbImg = document.getElementById('currentThumbImg');
                var noThumbPlaceholder = document.getElementById('noThumbPlaceholder');
                if (m && thumbImg) {
                  if (m.thumbnailUrl && m.thumbnailUrl.trim()) {
                    thumbImg.src = m.thumbnailUrl;
                    thumbImg.style.display = 'block';
                    if (noThumbPlaceholder) noThumbPlaceholder.hidden = true;
                  }
                  if (thumbErr) { thumbErr.textContent = ''; thumbErr.hidden = true; }
                }
              });
          }, 6000);
        })
        .catch(function (e) {
          if (thumbErr) { thumbErr.textContent = 'Error: ' + e.message; thumbErr.hidden = false; }
          takeScreenshotBtn.disabled = false;
          takeScreenshotBtn.textContent = 'Take screenshot';
        });
    });
  }

  var thumbnailFileInput = document.getElementById('thumbnailFile');
  if (thumbnailFileInput) {
    thumbnailFileInput.addEventListener('change', function () {
      var file = thumbnailFileInput.files[0];
      if (!file) return;
      var id = document.getElementById('mediaId').value.trim();
      if (!id) return;
      var thumbErr = document.getElementById('thumbnailError');
      var thumbImg = document.getElementById('currentThumbImg');
      var contentType = file.type || 'image/png';
      if (!file.type.startsWith('image/')) {
        if (thumbErr) { thumbErr.textContent = 'Please choose an image (PNG, JPEG, GIF, WebP).'; thumbErr.hidden = false; }
        thumbnailFileInput.value = '';
        return;
      }
      if (thumbErr) { thumbErr.textContent = ''; thumbErr.hidden = true; }
      fetchWithAuth(base + '/media/thumbnail-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaId: id, contentType: contentType })
      })
        .then(function (r) {
          if (r.ok) return r.json();
          return r.text().then(function (t) { throw new Error(t || 'Upload failed'); });
        })
        .then(function (data) {
          return fetch(data.uploadUrl, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': contentType }
          }).then(function (putRes) {
            if (!putRes.ok) throw new Error('Upload failed');
            return data.key;
          });
        })
        .then(function (key) {
          return fetchWithAuth(base + '/media', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id, thumbnailKey: key })
          }).then(function (r) {
            if (!r.ok) {
              return r.text().then(function (t) {
                var err = 'Update failed';
                try {
                  var obj = JSON.parse(t);
                  if (obj && obj.error) err = obj.error;
                } catch (e) {}
                throw new Error(err);
              });
            }
            return fetchWithAuth(base + '/media?id=' + encodeURIComponent(id));
          });
        })
        .then(function (r) {
          if (!r.ok) throw new Error('Refresh failed');
          return r.json();
        })
        .then(function (data) {
          var m = data && data.media;
          var noThumbPlaceholder = document.getElementById('noThumbPlaceholder');
          if (m && m.thumbnailUrl && thumbImg) {
            thumbImg.src = m.thumbnailUrl;
            thumbImg.style.display = 'block';
            thumbImg.alt = 'Custom thumbnail';
            if (noThumbPlaceholder) noThumbPlaceholder.hidden = true;
          }
          thumbnailFileInput.value = '';
          if (thumbErr) { thumbErr.textContent = ''; thumbErr.hidden = true; }
        })
        .catch(function (e) {
          if (thumbErr) { thumbErr.textContent = 'Error: ' + e.message; thumbErr.hidden = false; }
          thumbnailFileInput.value = '';
        });
    });
  }

  if (editMediaForm) {
    editMediaForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var id = document.getElementById('mediaId').value.trim();
      var title = document.getElementById('mediaTitle').value.trim();
      var description = document.getElementById('mediaDescription').value.trim();
      var categoryIds = selectedIds.slice();
      var file = mediaFileInput && mediaFileInput.files[0];

      saveResult.textContent = 'Saving...';
      saveResult.className = 'status';
      saveResult.hidden = false;

      function doUpdate(payload) {
        return fetchWithAuth(base + '/media', {
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
            window.location.href = 'media-view.html?id=' + encodeURIComponent(id);
          });
      }

      var payload = { id: id, title: title, description: description, categoryIds: categoryIds };

      if (file) {
        validateMediaFile(file, function (err) {
          if (err) {
            saveResult.textContent = err.message || 'Invalid file';
            saveResult.className = 'status err';
            return;
          }
          var mediaType = file.type.startsWith('video/') ? 'video' : 'image';
          fetchWithAuth(base + '/media/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mediaId: id,
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
              payload.mediaKey = key;
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

  var deleteBtn = document.getElementById('deleteMediaBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', function () {
      var id = document.getElementById('mediaId').value.trim();
      if (!id) return;
      if (!window.confirm('Delete this media item? This cannot be undone.')) return;
      saveResult.textContent = 'Deleting...';
      saveResult.className = 'status';
      saveResult.hidden = false;
      fetchWithAuth(base + '/media', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id })
      })
        .then(function (r) {
          if (r.ok) return r.json();
          return r.text().then(function (t) { throw new Error(t || 'Delete failed'); });
        })
        .then(function () {
          saveResult.textContent = 'Deleted.';
          saveResult.className = 'status ok';
          window.location.href = 'media.html';
        })
        .catch(function (e) {
          saveResult.textContent = 'Error: ' + e.message;
          saveResult.className = 'status err';
        });
    });
  }
})();
