(function () {
  var base = (window.API_BASE_URL || '').replace(/\/$/, '');
  var messageEl = document.getElementById('message');
  var squashPlayersWrap = document.getElementById('squashPlayersWrap');
  var playerList = document.getElementById('playerList');
  var editingPlayerId = null;

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

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function loadPlayers() {
    return fetchWithAuth(base + '/squash/players')
      .then(function (r) { return r.ok ? r.json() : r.json().then(function (d) { throw new Error(d.error || 'Failed'); }); })
      .then(function (data) {
        var allPlayers = data.players || [];
        renderPlayers(allPlayers);
      });
  }

  function renderPlayers(allPlayers) {
    if (!playerList) return;
    if (allPlayers.length === 0) {
      playerList.innerHTML = '<li>No players yet. Add players above.</li>';
      return;
    }
    playerList.innerHTML = allPlayers.map(function (p) {
      var id = p.id || p.PK || '';
      var name = p.name || id;
      var email = p.email ? ' <span style="color:#666;font-size:0.9rem">(' + escapeHtml(p.email) + ')</span>' : '';
      return '<li data-id="' + escapeHtml(id) + '">' +
        '<span class="player-name">' + escapeHtml(name) + '</span>' + email +
        ' <button type="button" class="secondary edit-player" data-id="' + escapeHtml(id) + '">Edit</button>' +
        ' <button type="button" class="danger delete-player" data-id="' + escapeHtml(id) + '">Delete</button>' +
        '</li>';
    }).join('');

    playerList.querySelectorAll('.edit-player').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        fetchWithAuth(base + '/squash/players')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var p = (data.players || []).find(function (x) { return (x.id || x.PK) === id; });
            if (!p) return;
            editingPlayerId = id;
            document.getElementById('playerId').value = id;
            document.getElementById('playerName').value = p.name || '';
            document.getElementById('playerEmail').value = p.email || '';
            document.getElementById('playerUserId').value = p.userId || '';
            document.getElementById('playerSubmitBtn').textContent = 'Update player';
          });
      });
    });

    playerList.querySelectorAll('.delete-player').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        if (!id || !window.confirm('Delete this player?')) return;
        fetchWithAuth(base + '/squash/players?id=' + encodeURIComponent(id), { method: 'DELETE' })
          .then(function (r) {
            if (r.ok) return loadPlayers();
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
        var customGroups = user.customGroups || [];
        var canModify = groups.indexOf('admin') !== -1 || (groups.indexOf('manager') !== -1 && customGroups.indexOf('Squash') !== -1);
        if (!canModify) {
          showMessage('Squash Players requires manager (in Squash group) or SuperAdmin access.', true);
          return;
        }
        squashPlayersWrap.hidden = false;
        loadPlayers();

        if (document.getElementById('playerForm')) {
          document.getElementById('playerForm').addEventListener('submit', function (e) {
            e.preventDefault();
            var id = document.getElementById('playerId').value;
            var name = document.getElementById('playerName').value.trim();
            var email = document.getElementById('playerEmail').value.trim();
            var userId = document.getElementById('playerUserId').value || null;
            if (!name) { alert('Name is required.'); return; }
            var payload = { name: name, email: email || undefined, userId: userId };
            var url = base + '/squash/players';
            var method = 'POST';
            if (editingPlayerId) {
              payload.id = id || editingPlayerId;
              method = 'PUT';
            }
            fetchWithAuth(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
              .then(function (r) {
                if (r.ok) {
                  editingPlayerId = null;
                  document.getElementById('playerId').value = '';
                  document.getElementById('playerForm').reset();
                  document.getElementById('playerSubmitBtn').textContent = 'Add player';
                  return loadPlayers();
                }
                return r.json().then(function (d) { throw new Error(d.error || 'Failed'); });
              })
              .catch(function (e) { alert('Failed: ' + e.message); });
          });
        }
        if (document.getElementById('playerCancelBtn')) {
          document.getElementById('playerCancelBtn').addEventListener('click', function () {
            editingPlayerId = null;
            document.getElementById('playerId').value = '';
            document.getElementById('playerForm').reset();
            document.getElementById('playerSubmitBtn').textContent = 'Add player';
          });
        }

        fetchWithAuth(base + '/admin/users?limit=100')
          .then(function (r) { return r.ok ? r.json() : Promise.resolve({ users: [] }); })
          .then(function (data) {
            var sel = document.getElementById('playerUserId');
            if (!sel) return;
            var opts = '<option value="">— None —</option>';
            (data.users || []).forEach(function (u) {
              var sub = u.sub || '';
              var label = u.email || u.username || sub;
              if (sub) opts += '<option value="' + escapeHtml(sub) + '">' + escapeHtml(label) + '</option>';
            });
            sel.innerHTML = opts;
          });
      })
      .catch(function () {
        showMessage('Could not verify access.', true);
      });
  });
})();
