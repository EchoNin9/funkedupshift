(function () {
  var base = (window.API_BASE_URL || '').replace(/\/$/, '');
  var messageEl = document.getElementById('message');
  var formWrap = document.getElementById('formWrap');
  var createGroupForm = document.getElementById('createGroupForm');
  var groupList = document.getElementById('groupList');

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

  function loadGroups() {
    fetchWithAuth(base + '/admin/groups')
      .then(function (r) { return r.ok ? r.json() : r.json().then(function (d) { throw new Error(d.error || 'Failed'); }); })
      .then(function (data) {
        var groups = data.groups || [];
        groups.sort(function (a, b) {
          var na = (a.name || a.PK || '').toLowerCase();
          var nb = (b.name || b.PK || '').toLowerCase();
          return na.localeCompare(nb);
        });
        renderGroups(groups);
      })
      .catch(function (e) {
        groupList.innerHTML = '<li>Failed to load: ' + escapeHtml(e.message) + '</li>';
      });
  }

  function renderGroups(groups) {
    if (!groupList) return;
    if (groups.length === 0) {
      groupList.innerHTML = '<li>No custom groups yet. Create one above.</li>';
      return;
    }
    groupList.innerHTML = groups.map(function (g) {
      var name = g.name || (g.PK || '').replace('GROUP#', '') || 'Untitled';
      var desc = g.description ? '<span class="group-desc">' + escapeHtml(g.description) + '</span>' : '';
      var perms = Array.isArray(g.permissions) && g.permissions.length
        ? '<span class="group-perms">Permissions: ' + escapeHtml(g.permissions.join(', ')) + '</span>'
        : '';
      return '<li data-name="' + escapeHtml(name) + '">' +
        '<span class="group-name">' + escapeHtml(name) + '</span>' +
        (desc ? ' ' + desc : '') +
        (perms ? '<br>' + perms : '') +
        ' <button type="button" class="secondary edit-grp">Edit</button>' +
        ' <button type="button" class="danger delete-grp">Delete</button>' +
        '</li>';
    }).join('');

    groupList.querySelectorAll('.edit-grp').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var li = this.closest('li');
        var name = li && li.getAttribute('data-name');
        var descEl = li && li.querySelector('.group-desc');
        var permsEl = li && li.querySelector('.group-perms');
        var currentDesc = descEl ? descEl.textContent.replace(/^Description:?\s*/, '') : '';
        var currentPerms = permsEl ? permsEl.textContent.replace(/^Permissions:\s*/, '') : '';
        var newDesc = window.prompt('Edit description:', currentDesc);
        if (newDesc === null) return;
        var newPerms = window.prompt('Edit permissions (comma-separated):', currentPerms);
        if (newPerms === null) return;
        var perms = (newPerms || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
        fetchWithAuth(base + '/admin/groups/' + encodeURIComponent(name), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: newDesc, permissions: perms })
        })
          .then(function (r) {
            if (r.ok) return loadGroups();
            return r.json().then(function (d) { throw new Error(d.error || 'Failed'); });
          })
          .catch(function (e) { alert('Update failed: ' + e.message); });
      });
    });

    groupList.querySelectorAll('.delete-grp').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var li = this.closest('li');
        var name = li && li.getAttribute('data-name');
        if (!name || !window.confirm('Delete group "' + name + '"? Members will lose access.')) return;
        fetchWithAuth(base + '/admin/groups/' + encodeURIComponent(name), { method: 'DELETE' })
          .then(function (r) {
            if (r.ok) return loadGroups();
            return r.json().then(function (d) { throw new Error(d.error || 'Failed'); });
          })
          .catch(function (e) { alert('Delete failed: ' + e.message); });
      });
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
    fetchWithAuth(base + '/me')
      .then(function (r) { return r.ok ? r.json() : r.text().then(function (t) { throw new Error(t || 'Failed'); }); })
      .then(function (user) {
        var groups = user.groups || [];
        var isAdmin = groups.indexOf('admin') !== -1;
        var isManager = groups.indexOf('manager') !== -1;
        if (!isAdmin && !isManager) {
          showMessage('Manager or SuperAdmin access required.', true);
          return;
        }
        formWrap.hidden = false;
        loadGroups();
      })
      .catch(function () {
        showMessage('Could not verify access.', true);
      });
  });

  if (createGroupForm) {
    createGroupForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = (document.getElementById('groupName').value || '').trim();
      var description = (document.getElementById('groupDescription').value || '').trim();
      var permsStr = (document.getElementById('groupPermissions').value || '').trim();
      var permissions = permsStr ? permsStr.split(',').map(function (p) { return p.trim(); }).filter(Boolean) : [];
      if (!name) {
        showMessage('Name is required.', true);
        return;
      }
      fetchWithAuth(base + '/admin/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, description: description, permissions: permissions })
      })
        .then(function (r) {
          if (r.ok) {
            showMessage('Group created.', false);
            document.getElementById('groupName').value = '';
            document.getElementById('groupDescription').value = '';
            document.getElementById('groupPermissions').value = '';
            return loadGroups();
          }
          return r.json().then(function (d) { throw new Error(d.error || 'Failed'); });
        })
        .catch(function (e) {
          showMessage('Error: ' + (e.message || 'Unknown'), true);
        });
    });
  }
})();
