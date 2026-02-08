(function () {
  var base = (window.API_BASE_URL || '').replace(/\/$/, '');
  var messageEl = document.getElementById('message');
  var formWrap = document.getElementById('formWrap');
  var editUserForm = document.getElementById('editUserForm');
  var saveResult = document.getElementById('saveResult');
  var ROLE_DISPLAY = { admin: 'SuperAdmin', manager: 'Manager', user: 'User' };
  var systemRoleOptions = [];
  var selectedSystemRoles = [];
  var allCustomGroups = [];
  var selectedCustomGroups = [];
  var isSuperAdmin = false;
  var currentUserGroups = { cognitoGroups: [], customGroups: [] };

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function getUsername() {
    var match = /[?&]username=([^&]*)/.exec(window.location.search);
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')).trim() : '';
  }

  function getQueryParam(name) {
    var match = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
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

  function chipClassForGroup(name) {
    if (name === 'admin') return 'chip-admin';
    if (name === 'manager') return 'chip-manager';
    if (name === 'user') return 'chip-user';
    return 'chip-custom';
  }

  function renderSystemRoleSelect() {
    var sel = document.getElementById('systemRoleSelect');
    if (!sel) return;
    var html = '<option value="">Select role to add...</option>';
    systemRoleOptions.forEach(function (opt) {
      if (selectedSystemRoles.indexOf(opt) === -1) {
        html += '<option value="' + escapeHtml(opt) + '">' + escapeHtml(ROLE_DISPLAY[opt] || opt) + '</option>';
      }
    });
    sel.innerHTML = html;
  }

  function renderSystemRoleChips() {
    var el = document.getElementById('systemRoleSelected');
    if (!el) return;
    el.innerHTML = selectedSystemRoles.map(function (name) {
      return '<span class="group-chip ' + chipClassForGroup(name) + '">' +
        escapeHtml(ROLE_DISPLAY[name] || name) +
        '<button type="button" class="group-chip-remove" data-name="' + escapeHtml(name) + '" aria-label="Remove">×</button></span>';
    }).join('');
  }

  function addSystemRole(name) {
    if (name && selectedSystemRoles.indexOf(name) === -1) {
      selectedSystemRoles.push(name);
      renderSystemRoleChips();
      renderSystemRoleSelect();
    }
  }

  function removeSystemRole(name) {
    selectedSystemRoles = selectedSystemRoles.filter(function (x) { return x !== name; });
    renderSystemRoleChips();
    renderSystemRoleSelect();
  }

  function renderCustomGroupDropdown(filter) {
    var dropdown = document.getElementById('customGroupDropdown');
    var search = document.getElementById('customGroupSearch');
    if (!dropdown || !search) return;
    var q = (filter || search.value || '').toLowerCase().trim();
    var opts = allCustomGroups.filter(function (g) {
      if (selectedCustomGroups.indexOf(g) !== -1) return false;
      return !q || g.toLowerCase().indexOf(q) !== -1;
    });
    dropdown.innerHTML = opts.length ? opts.map(function (g) {
      return '<div class="group-dropdown-option" data-name="' + escapeHtml(g) + '">' + escapeHtml(g) + '</div>';
    }).join('') : '<div class="group-dropdown-option" style="color:#666;cursor:default;">No matches</div>';
    dropdown.hidden = false;
  }

  function renderCustomGroupChips() {
    var el = document.getElementById('customGroupSelected');
    if (!el) return;
    el.innerHTML = selectedCustomGroups.map(function (name) {
      return '<span class="group-chip chip-custom">' +
        escapeHtml(name) +
        '<button type="button" class="group-chip-remove" data-name="' + escapeHtml(name) + '" aria-label="Remove">×</button></span>';
    }).join('');
  }

  function addCustomGroup(name) {
    if (name && selectedCustomGroups.indexOf(name) === -1) {
      selectedCustomGroups.push(name);
      renderCustomGroupChips();
      renderCustomGroupDropdown();
    }
  }

  function removeCustomGroup(name) {
    selectedCustomGroups = selectedCustomGroups.filter(function (x) { return x !== name; });
    renderCustomGroupChips();
    renderCustomGroupDropdown();
  }

  function initSystemRoleSelect() {
    var sel = document.getElementById('systemRoleSelect');
    var chipContainer = document.getElementById('systemRoleSelected');
    if (!sel || !chipContainer) return;
    sel.addEventListener('change', function () {
      var val = sel.value;
      if (val) {
        addSystemRole(val);
        sel.value = '';
      }
    });
    chipContainer.addEventListener('click', function (e) {
      var btn = e.target.closest('.group-chip-remove');
      if (btn && btn.dataset.name) removeSystemRole(btn.dataset.name);
    });
  }

  function initCustomGroupMultiselect() {
    var search = document.getElementById('customGroupSearch');
    var dropdown = document.getElementById('customGroupDropdown');
    var chipContainer = document.getElementById('customGroupSelected');
    if (!search || !dropdown || !chipContainer) return;

    search.addEventListener('focus', function () { renderCustomGroupDropdown(); });
    search.addEventListener('input', function () { renderCustomGroupDropdown(); });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') dropdown.hidden = true;
    });

    dropdown.addEventListener('click', function (e) {
      var opt = e.target.closest('.group-dropdown-option');
      if (opt && opt.dataset.name) {
        addCustomGroup(opt.dataset.name);
        search.value = '';
        search.focus();
      }
    });

    chipContainer.addEventListener('click', function (e) {
      var btn = e.target.closest('.group-chip-remove');
      if (btn && btn.dataset.name) removeCustomGroup(btn.dataset.name);
    });

    document.addEventListener('click', function (e) {
      if (!search.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.hidden = true;
      }
    });
  }

  function saveChanges() {
    var username = document.getElementById('username').value;
    if (!username) return Promise.reject(new Error('No username'));

    var desiredCognito = selectedSystemRoles.slice();
    var desiredCustom = selectedCustomGroups.slice();
    var currentCognito = currentUserGroups.cognitoGroups || [];
    var currentCustom = currentUserGroups.customGroups || [];

    var toAddCognito = desiredCognito.filter(function (g) { return currentCognito.indexOf(g) === -1; });
    var toRemoveCognito = currentCognito.filter(function (g) { return desiredCognito.indexOf(g) === -1; });
    var toAddCustom = desiredCustom.filter(function (g) { return currentCustom.indexOf(g) === -1; });
    var toRemoveCustom = currentCustom.filter(function (g) { return desiredCustom.indexOf(g) === -1; });

    var promises = [];

    toAddCognito.forEach(function (groupName) {
      promises.push(
        fetchWithAuth(base + '/admin/users/' + encodeURIComponent(username) + '/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupName: groupName })
        }).then(function (r) {
          if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Failed'); });
        })
      );
    });

    toRemoveCognito.forEach(function (groupName) {
      promises.push(
        fetchWithAuth(base + '/admin/users/' + encodeURIComponent(username) + '/groups/' + encodeURIComponent(groupName), {
          method: 'DELETE'
        }).then(function (r) {
          if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Failed'); });
        })
      );
    });

    toAddCustom.forEach(function (groupName) {
      promises.push(
        fetchWithAuth(base + '/admin/users/' + encodeURIComponent(username) + '/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupName: groupName })
        }).then(function (r) {
          if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Failed'); });
        })
      );
    });

    toRemoveCustom.forEach(function (groupName) {
      promises.push(
        fetchWithAuth(base + '/admin/users/' + encodeURIComponent(username) + '/groups/' + encodeURIComponent(groupName), {
          method: 'DELETE'
        }).then(function (r) {
          if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Failed'); });
        })
      );
    });

    return Promise.all(promises);
  }

  if (!base) {
    showMessage('API URL not set.', true);
    return;
  }

  var username = getUsername();
  if (!username) {
    showMessage('Missing username in URL (e.g. edit-user.html?username=user@example.com).', true);
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
      fetchWithAuth(base + '/me').then(function (r) { return r.ok ? r.json() : r.json().then(function (d) { throw new Error(d.error); }); }),
      fetchWithAuth(base + '/admin/users/' + encodeURIComponent(username) + '/groups').then(function (r) { return r.ok ? r.json() : r.json().then(function (d) { throw new Error(d.error); }); }),
      fetchWithAuth(base + '/admin/groups').then(function (r) { return r.ok ? r.json() : r.json().then(function (d) { throw new Error(d.error); }); })
    ])
      .then(function (results) {
        var me = results[0];
        var userGroupsData = results[1];
        var groupsData = results[2];

        var groups = (me && me.groups) || [];
        isSuperAdmin = groups.indexOf('admin') !== -1;
        var isManager = groups.indexOf('manager') !== -1;
        if (!isSuperAdmin && !isManager) {
          showMessage('Manager or SuperAdmin access required.', true);
          return;
        }

        currentUserGroups = {
          cognitoGroups: userGroupsData.cognitoGroups || [],
          customGroups: userGroupsData.customGroups || []
        };

        document.getElementById('username').value = username;
        document.getElementById('userEmail').textContent = getQueryParam('email') || userGroupsData.username || username;
        document.getElementById('userStatus').textContent = getQueryParam('status') || '—';

        var lastLoginEl = document.getElementById('userLastLogin');
        if (lastLoginEl) {
          var at = userGroupsData.lastLoginAt || '';
          var ip = userGroupsData.lastLoginIp || '';
          var iso = at ? (function (s) { try { var d = new Date(s); return isNaN(d.getTime()) ? s : d.toISOString(); } catch (e) { return s; } })(at) : '';
          if (iso && ip) {
            lastLoginEl.textContent = iso + ' from ' + ip;
          } else if (iso) {
            lastLoginEl.textContent = iso;
          } else if (ip) {
            lastLoginEl.textContent = 'from ' + ip;
          } else {
            lastLoginEl.textContent = '—';
          }
        }

        systemRoleOptions = ['manager', 'user'];
        if (isSuperAdmin) systemRoleOptions.unshift('admin');
        selectedSystemRoles = currentUserGroups.cognitoGroups.slice();
        selectedCustomGroups = currentUserGroups.customGroups.slice();

        allCustomGroups = (groupsData.groups || []).map(function (g) { return g.name || (g.PK || '').replace('GROUP#', '') || ''; }).filter(Boolean);

        initSystemRoleSelect();
        renderSystemRoleSelect();
        renderSystemRoleChips();

        var customSearch = document.getElementById('customGroupSearch');
        var customEmpty = document.getElementById('customGroupEmpty');
        if (allCustomGroups.length === 0) {
          if (customSearch) customSearch.style.display = 'none';
          if (customEmpty) customEmpty.hidden = false;
        } else {
          if (customSearch) customSearch.style.display = '';
          if (customEmpty) customEmpty.hidden = true;
          initCustomGroupMultiselect();
          renderCustomGroupChips();
        }

        formWrap.hidden = false;
      })
      .catch(function (e) {
        showMessage('Failed to load: ' + (e.message || 'Unknown error'), true);
      });
  });

  if (editUserForm) {
    editUserForm.addEventListener('submit', function (e) {
      e.preventDefault();
      saveResult.textContent = 'Saving...';
      saveResult.className = 'status';
      saveResult.hidden = false;

      saveChanges()
        .then(function () {
          window.alert('Changes saved');
          window.location.href = 'users.html';
        })
        .catch(function (e) {
          saveResult.textContent = 'Error: ' + (e.message || 'Unknown');
          saveResult.className = 'status err';
        });
    });
  }
})();
