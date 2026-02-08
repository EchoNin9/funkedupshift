(function () {
  var base = (window.API_BASE_URL || '').replace(/\/$/, '');
  var messageEl = document.getElementById('message');
  var usersWrap = document.getElementById('usersWrap');
  var userTableBody = document.getElementById('userTableBody');
  var paginationEl = document.getElementById('pagination');
  var ROLE_DISPLAY = { admin: 'SuperAdmin', manager: 'Manager', user: 'User' };
  var isSuperAdmin = false;
  var allUsers = [];
  var allCustomGroups = [];
  var paginationToken = '';

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

  function renderGroupBadges(cognitoGroups, customGroups) {
    var html = '';
    (cognitoGroups || []).forEach(function (g) {
      var display = ROLE_DISPLAY[g] || g;
      var cls = g === 'admin' ? 'badge-admin' : g === 'manager' ? 'badge-manager' : 'badge-user';
      html += '<span class="badge ' + cls + '">' + escapeHtml(display) + '</span>';
    });
    (customGroups || []).forEach(function (g) {
      html += '<span class="badge badge-custom">' + escapeHtml(g) + '</span>';
    });
    return html || '<span class="user-groups">—</span>';
  }

  function loadUsers(nextToken) {
    var url = base + '/admin/users';
    if (nextToken) url += '?paginationToken=' + encodeURIComponent(nextToken);
    fetchWithAuth(url)
      .then(function (r) { return r.ok ? r.json() : r.json().then(function (d) { throw new Error(d.error || 'Failed'); }); })
      .then(function (data) {
        allUsers = data.users || [];
        paginationToken = data.paginationToken || '';
        renderUsers();
        renderPagination();
      })
      .catch(function (e) {
        showMessage('Failed to load users: ' + (e.message || 'Unknown error'), true);
      });
  }

  function loadCustomGroups() {
    fetchWithAuth(base + '/admin/groups')
      .then(function (r) { return r.ok ? r.json() : r.json().then(function (d) { throw new Error(d.error || 'Failed'); }); })
      .then(function (data) {
        allCustomGroups = (data.groups || []).map(function (g) { return g.name || g.PK || ''; }).filter(Boolean);
      })
      .catch(function () { allCustomGroups = []; });
  }

  function renderUsers() {
    if (!userTableBody) return;
    if (allUsers.length === 0) {
      userTableBody.innerHTML = '<tr><td colspan="5">No users found.</td></tr>';
      return;
    }
    userTableBody.innerHTML = allUsers.map(function (u) {
      var email = escapeHtml(u.email || u.username || '—');
      var status = escapeHtml(u.status || '—');
      return '<tr data-username="' + escapeHtml(u.username || '') + '" data-email="' + email + '">' +
        '<td>' + email + '</td>' +
        '<td>' + status + '</td>' +
        '<td class="user-groups" data-cognito-groups=""></td>' +
        '<td class="user-groups" data-custom-groups=""></td>' +
        '<td><button type="button" class="secondary manage-groups-btn">Manage groups</button></td>' +
        '</tr>';
    }).join('');

    allUsers.forEach(function (u) {
      var row = userTableBody.querySelector('tr[data-username="' + escapeHtml(u.username || '') + '"]');
      if (!row) return;
      fetchWithAuth(base + '/admin/users/' + encodeURIComponent(u.username) + '/groups')
        .then(function (r) { return r.ok ? r.json() : r.json().then(function (d) { throw new Error(d.error); }); })
        .then(function (data) {
          var cognitoCell = row.querySelector('[data-cognito-groups]');
          var customCell = row.querySelector('[data-custom-groups]');
          if (cognitoCell) cognitoCell.innerHTML = renderGroupBadges(data.cognitoGroups || [], []);
          if (customCell) customCell.innerHTML = renderGroupBadges([], data.customGroups || []);
          row.dataset.cognitoGroups = JSON.stringify(data.cognitoGroups || []);
          row.dataset.customGroups = JSON.stringify(data.customGroups || []);
        })
        .catch(function () {
          var cognitoCell = row.querySelector('[data-cognito-groups]');
          if (cognitoCell) cognitoCell.textContent = '—';
        });
    });

    userTableBody.querySelectorAll('.manage-groups-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var row = this.closest('tr');
        var username = row && row.getAttribute('data-username');
        if (!username) return;
        openManageModal(username, row);
      });
    });
  }

  function openManageModal(username, row) {
    var cognitoGroups = [];
    var customGroups = [];
    try {
      cognitoGroups = JSON.parse(row.dataset.cognitoGroups || '[]');
      customGroups = JSON.parse(row.dataset.customGroups || '[]');
    } catch (e) {}

    var sysGroups = ['admin', 'manager', 'user'];
    var canEditAdmin = isSuperAdmin;
    var options = [];
    if (canEditAdmin) options.push('admin');
    options.push('manager', 'user');
    options = options.concat(allCustomGroups.filter(function (g) { return sysGroups.indexOf(g) === -1; }));

    var msg = 'User: ' + (row.getAttribute('data-email') || username) + '\n\n';
    msg += 'Current: ' + cognitoGroups.concat(customGroups).join(', ') + '\n\n';
    msg += 'Add to group (enter exact name: admin, manager, user, or custom group name):';
    var toAdd = window.prompt(msg);
    if (toAdd === null) return;
    toAdd = (toAdd || '').trim();
    if (!toAdd) return;

    fetchWithAuth(base + '/admin/users/' + encodeURIComponent(username) + '/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupName: toAdd })
    })
      .then(function (r) {
        if (r.ok) {
          showMessage('Added to ' + toAdd + '.', false);
          return fetchWithAuth(base + '/admin/users/' + encodeURIComponent(username) + '/groups').then(function (rr) { return rr.json(); });
        }
        return r.json().then(function (d) { throw new Error(d.error || 'Failed'); });
      })
      .then(function (data) {
        row.dataset.cognitoGroups = JSON.stringify(data.cognitoGroups || []);
        row.dataset.customGroups = JSON.stringify(data.customGroups || []);
        var cognitoCell = row.querySelector('[data-cognito-groups]');
        var customCell = row.querySelector('[data-custom-groups]');
        if (cognitoCell) cognitoCell.innerHTML = renderGroupBadges(data.cognitoGroups || [], []);
        if (customCell) customCell.innerHTML = renderGroupBadges([], data.customGroups || []);
      })
      .catch(function (e) {
        showMessage('Error: ' + (e.message || 'Unknown'), true);
      });
  }

  function removeFromGroup(username, groupName, row) {
    if (!window.confirm('Remove ' + username + ' from ' + groupName + '?')) return;
    fetchWithAuth(base + '/admin/users/' + encodeURIComponent(username) + '/groups/' + encodeURIComponent(groupName), {
      method: 'DELETE'
    })
      .then(function (r) {
        if (r.ok) return fetchWithAuth(base + '/admin/users/' + encodeURIComponent(username) + '/groups').then(function (rr) { return rr.json(); });
        return r.json().then(function (d) { throw new Error(d.error || 'Failed'); });
      })
      .then(function (data) {
        row.dataset.cognitoGroups = JSON.stringify(data.cognitoGroups || []);
        row.dataset.customGroups = JSON.stringify(data.customGroups || []);
        var cognitoCell = row.querySelector('[data-cognito-groups]');
        var customCell = row.querySelector('[data-custom-groups]');
        if (cognitoCell) cognitoCell.innerHTML = renderGroupBadges(data.cognitoGroups || [], []);
        if (customCell) customCell.innerHTML = renderGroupBadges([], data.customGroups || []);
        showMessage('Removed from ' + groupName + '.', false);
      })
      .catch(function (e) {
        showMessage('Error: ' + (e.message || 'Unknown'), true);
      });
  }

  function renderPagination() {
    if (!paginationToken) {
      paginationEl.hidden = true;
      return;
    }
    paginationEl.hidden = false;
    paginationEl.innerHTML = '<button type="button" class="secondary" id="loadMore">Load more</button>';
    document.getElementById('loadMore').onclick = function () { loadUsers(paginationToken); };
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
        isSuperAdmin = groups.indexOf('admin') !== -1;
        var isManager = groups.indexOf('manager') !== -1;
        if (!isSuperAdmin && !isManager) {
          showMessage('Manager or SuperAdmin access required.', true);
          return;
        }
        usersWrap.hidden = false;
        loadCustomGroups();
        loadUsers();
      })
      .catch(function () {
        showMessage('Could not verify access.', true);
      });
  });
})();
