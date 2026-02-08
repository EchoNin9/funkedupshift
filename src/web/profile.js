(function () {
  var base = (window.API_BASE_URL || '').replace(/\/$/, '');
  var messageEl = document.getElementById('message');
  var profileWrap = document.getElementById('profileWrap');
  var ROLE_DISPLAY = { admin: 'SuperAdmin', manager: 'Manager', user: 'User' };
  var profileData = null;

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
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

  function renderRoleBar(cognitoGroups) {
    var el = document.getElementById('roleBar');
    if (!el) return;
    if (!cognitoGroups || cognitoGroups.length === 0) {
      el.innerHTML = '<span class="role-badge role-user">User</span>';
      return;
    }
    el.innerHTML = cognitoGroups.map(function (g) {
      var display = ROLE_DISPLAY[g] || g;
      var cls = g === 'admin' ? 'role-admin' : g === 'manager' ? 'role-manager' : 'role-user';
      return '<span class="role-badge ' + cls + '">' + escapeHtml(display) + '</span>';
    }).join('');
  }

  function renderGroupChips(customGroups) {
    var el = document.getElementById('groupChips');
    var noEl = document.getElementById('noGroups');
    if (!el || !noEl) return;
    if (!customGroups || customGroups.length === 0) {
      el.innerHTML = '';
      noEl.hidden = false;
      return;
    }
    noEl.hidden = true;
    el.innerHTML = customGroups.map(function (g) {
      return '<span class="group-chip">' + escapeHtml(g) + '</span>';
    }).join('');
  }

  function updateCharCount() {
    var input = document.getElementById('descriptionInput');
    var countEl = document.getElementById('charCount');
    if (!input || !countEl) return;
    var len = (input.value || '').length;
    countEl.textContent = len + ' / 100';
    countEl.classList.toggle('at-limit', len >= 100);
  }

  function saveProfile() {
    var description = (document.getElementById('descriptionInput').value || '').trim().slice(0, 100);
    return fetchWithAuth(base + '/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: description })
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Failed'); });
      return r.json();
    });
  }

  if (!base) {
    showMessage('API URL not set.', true);
    return;
  }

  if (!window.auth) {
    showMessage('Sign in required. <a href="auth.html">Sign in</a>.', true);
    return;
  }

  window.auth.isAuthenticated(function (isAuth) {
    if (!isAuth) {
      showMessage('Sign in required. <a href="auth.html">Sign in</a>.', true);
      return;
    }

    fetchWithAuth(base + '/profile')
      .then(function (r) { return r.ok ? r.json() : r.json().then(function (d) { throw new Error(d.error || 'Failed'); }); })
      .then(function (data) {
        profileData = data;
        document.getElementById('userEmail').textContent = data.email || '—';
        document.getElementById('userStatus').textContent = data.status || '—';
        renderRoleBar(data.cognitoGroups || []);
        renderGroupChips(data.customGroups || []);
        document.getElementById('descriptionInput').value = (data.profile && data.profile.description) || '';
        updateCharCount();

        var avatarImg = document.getElementById('avatarImg');
        var avatarPlaceholder = document.getElementById('avatarPlaceholder');
        var avatarDeleteBtn = document.getElementById('avatarDeleteBtn');
        if (data.profile && data.profile.avatarUrl) {
          avatarImg.src = data.profile.avatarUrl;
          avatarImg.style.display = 'block';
          avatarPlaceholder.style.display = 'none';
          avatarDeleteBtn.hidden = false;
        } else {
          avatarImg.src = '';
          avatarImg.style.display = 'none';
          avatarPlaceholder.style.display = 'flex';
          avatarDeleteBtn.hidden = true;
        }

        profileWrap.hidden = false;
      })
      .catch(function (e) {
        showMessage('Failed to load profile: ' + (e.message || 'Unknown error'), true);
      });
  });

  document.getElementById('descriptionInput').addEventListener('input', updateCharCount);

  document.getElementById('saveProfileBtn').addEventListener('click', function () {
    var resultEl = document.getElementById('saveResult');
    resultEl.textContent = 'Saving...';
    resultEl.className = 'status';
    resultEl.hidden = false;
    saveProfile()
      .then(function () {
        resultEl.textContent = 'Saved.';
        resultEl.className = 'status ok';
      })
      .catch(function (e) {
        resultEl.textContent = 'Error: ' + (e.message || 'Unknown');
        resultEl.className = 'status err';
      });
  });

  var avatarFileInput = document.getElementById('avatarFile');
  if (avatarFileInput) {
    avatarFileInput.addEventListener('change', function () {
      var file = avatarFileInput.files[0];
      var avatarError = document.getElementById('avatarError');
      if (!file) {
        avatarError.textContent = '';
        avatarError.hidden = true;
        return;
      }
      if (!file.type || !file.type.match(/^image\/(png|jpeg|jpg|gif|webp)$/)) {
        avatarError.textContent = 'Please choose PNG, JPEG, GIF, or WebP.';
        avatarError.hidden = false;
        avatarFileInput.value = '';
        return;
      }
      avatarError.textContent = '';
      avatarError.hidden = true;

      var contentType = file.type || 'image/png';
      fetchWithAuth(base + '/profile/avatar-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: contentType })
      })
        .then(function (r) {
          if (r.ok) return r.json();
          return r.json().then(function (d) { throw new Error(d.error || 'Upload failed'); });
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
          return fetchWithAuth(base + '/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ avatarKey: key })
          });
        })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (d) { throw new Error(d.error); });
          return fetchWithAuth(base + '/profile');
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var avatarImg = document.getElementById('avatarImg');
          var avatarPlaceholder = document.getElementById('avatarPlaceholder');
          var avatarDeleteBtn = document.getElementById('avatarDeleteBtn');
          if (data.profile && data.profile.avatarUrl) {
            avatarImg.src = data.profile.avatarUrl;
            avatarImg.style.display = 'block';
            avatarPlaceholder.style.display = 'none';
            avatarDeleteBtn.hidden = false;
          }
          avatarFileInput.value = '';
        })
        .catch(function (e) {
          avatarError.textContent = 'Error: ' + (e.message || 'Unknown');
          avatarError.hidden = false;
          avatarFileInput.value = '';
        });
    });
  }

  var avatarDeleteBtn = document.getElementById('avatarDeleteBtn');
  if (avatarDeleteBtn) {
    avatarDeleteBtn.addEventListener('click', function () {
      var avatarError = document.getElementById('avatarError');
      avatarError.textContent = '';
      avatarError.hidden = true;
      fetchWithAuth(base + '/profile/avatar', { method: 'DELETE' })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (d) { throw new Error(d.error); });
          var avatarImg = document.getElementById('avatarImg');
          var avatarPlaceholder = document.getElementById('avatarPlaceholder');
          avatarImg.src = '';
          avatarImg.style.display = 'none';
          avatarPlaceholder.style.display = 'flex';
          avatarDeleteBtn.hidden = true;
        })
        .catch(function (e) {
          avatarError.textContent = 'Error: ' + (e.message || 'Unknown');
          avatarError.hidden = false;
        });
    });
  }
})();
