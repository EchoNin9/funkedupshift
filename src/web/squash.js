(function () {
  var base = (window.API_BASE_URL || '').replace(/\/$/, '');
  var messageEl = document.getElementById('message');
  var squashWrap = document.getElementById('squashWrap');
  var playerFormWrap = document.getElementById('playerFormWrap');
  var matchFormWrap = document.getElementById('matchFormWrap');
  var playerList = document.getElementById('playerList');
  var matchList = document.getElementById('matchList');
  var canModify = false;
  var allPlayers = [];
  var selectedPlayerIds = [];
  var editingPlayerId = null;
  var editingMatchId = null;

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

  function playerName(id) {
    var p = allPlayers.find(function (x) { return x.id === id || x.PK === id; });
    return p ? (p.name || p.id || id) : id;
  }

  function loadPlayers() {
    return fetchWithAuth(base + '/squash/players')
      .then(function (r) { return r.ok ? r.json() : r.json().then(function (d) { throw new Error(d.error || 'Failed'); }); })
      .then(function (data) {
        allPlayers = data.players || [];
        renderPlayers();
        renderPlayerDropdowns();
        renderPlayerSelectOptions();
      });
  }

  function renderPlayers() {
    if (!playerList) return;
    if (allPlayers.length === 0) {
      playerList.innerHTML = '<li>No players yet. Add players above.</li>';
      return;
    }
    playerList.innerHTML = allPlayers.map(function (p) {
      var id = p.id || p.PK || '';
      var name = p.name || id;
      var email = p.email ? ' <span style="color:#666;font-size:0.9rem">(' + escapeHtml(p.email) + ')</span>' : '';
      var editBtn = canModify ? ' <button type="button" class="secondary edit-player" data-id="' + escapeHtml(id) + '">Edit</button>' : '';
      var delBtn = canModify ? ' <button type="button" class="danger delete-player" data-id="' + escapeHtml(id) + '">Delete</button>' : '';
      return '<li data-id="' + escapeHtml(id) + '">' +
        '<span class="player-name">' + escapeHtml(name) + '</span>' + email +
        editBtn + delBtn + '</li>';
    }).join('');

    playerList.querySelectorAll('.edit-player').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        var p = allPlayers.find(function (x) { return (x.id || x.PK) === id; });
        if (!p) return;
        editingPlayerId = id;
        document.getElementById('playerId').value = id;
        document.getElementById('playerName').value = p.name || '';
        document.getElementById('playerEmail').value = p.email || '';
        document.getElementById('playerUserId').value = p.userId || '';
        document.getElementById('playerSubmitBtn').textContent = 'Update player';
        playerFormWrap.hidden = false;
      });
    });

    playerList.querySelectorAll('.delete-player').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        if (!id || !window.confirm('Delete this player?')) return;
        fetchWithAuth(base + '/squash/players?id=' + encodeURIComponent(id), { method: 'DELETE' })
          .then(function (r) {
            if (r.ok) return loadPlayers().then(loadMatches);
            return r.json().then(function (d) { throw new Error(d.error || 'Failed'); });
          })
          .catch(function (e) { alert('Delete failed: ' + e.message); });
      });
    });
  }

  function loadMatches() {
    var params = [];
    var date = document.getElementById('searchDate') && document.getElementById('searchDate').value;
    var dateFrom = document.getElementById('searchDateFrom') && document.getElementById('searchDateFrom').value;
    var dateTo = document.getElementById('searchDateTo') && document.getElementById('searchDateTo').value;
    if (date) params.push('date=' + encodeURIComponent(date));
    if (dateFrom) params.push('dateFrom=' + encodeURIComponent(dateFrom));
    if (dateTo) params.push('dateTo=' + encodeURIComponent(dateTo));
    if (selectedPlayerIds.length) params.push('playerIds=' + encodeURIComponent(selectedPlayerIds.join(',')));
    var qs = params.length ? '?' + params.join('&') : '';
    return fetchWithAuth(base + '/squash/matches' + qs)
      .then(function (r) { return r.ok ? r.json() : r.json().then(function (d) { throw new Error(d.error || 'Failed'); }); })
      .then(function (data) {
        renderMatches(data.matches || []);
      });
  }

  function renderMatches(matches) {
    if (!matchList) return;
    if (matches.length === 0) {
      matchList.innerHTML = '<li>No matches found.</li>';
      return;
    }
    matchList.innerHTML = matches.map(function (m) {
      var id = m.id || m.PK || '';
      var teamA = [playerName(m.teamAPlayer1Id), playerName(m.teamAPlayer2Id)].filter(Boolean).join(' & ');
      var teamB = [playerName(m.teamBPlayer1Id), playerName(m.teamBPlayer2Id)].filter(Boolean).join(' & ');
      var ga = m.teamAGames != null ? m.teamAGames : 0;
      var gb = m.teamBGames != null ? m.teamBGames : 0;
      var score = m.winningTeam === 'A' ? ga + '-' + gb : gb + '-' + ga;
      var editBtn = canModify ? ' <button type="button" class="secondary edit-match" data-id="' + escapeHtml(id) + '">Edit</button>' : '';
      var delBtn = canModify ? ' <button type="button" class="danger delete-match" data-id="' + escapeHtml(id) + '">Delete</button>' : '';
      return '<li data-id="' + escapeHtml(id) + '">' +
        '<span class="match-date">' + escapeHtml(m.date || '') + '</span> ' +
        escapeHtml(teamA) + ' vs ' + escapeHtml(teamB) + ' ' +
        '<span class="match-score">' + score + '</span>' +
        editBtn + delBtn + '</li>';
    }).join('');

    matchList.querySelectorAll('.edit-match').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        if (!id) return;
        fetchWithAuth(base + '/squash/matches')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var m = (data.matches || []).find(function (x) { return (x.id || x.PK) === id; });
            if (!m) return;
            editingMatchId = id;
            document.getElementById('matchId').value = id;
            document.getElementById('matchDate').value = m.date || '';
            document.getElementById('matchTeamAP1').value = m.teamAPlayer1Id || '';
            document.getElementById('matchTeamAP2').value = m.teamAPlayer2Id || '';
            document.getElementById('matchTeamBP1').value = m.teamBPlayer1Id || '';
            document.getElementById('matchTeamBP2').value = m.teamBPlayer2Id || '';
            document.getElementById('matchWinningTeam').value = m.winningTeam || 'A';
            document.getElementById('matchLoserGames').value = String(m.winningTeam === 'A' ? (m.teamBGames || 0) : (m.teamAGames || 0));
            document.getElementById('matchSubmitBtn').textContent = 'Update match';
            matchFormWrap.hidden = false;
            syncPlayerSelectDisabled();
          });
      });
    });

    matchList.querySelectorAll('.delete-match').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        if (!id || !window.confirm('Delete this match?')) return;
        fetchWithAuth(base + '/squash/matches?id=' + encodeURIComponent(id), { method: 'DELETE' })
          .then(function (r) {
            if (r.ok) return loadMatches();
            return r.json().then(function (d) { throw new Error(d.error || 'Failed'); });
          })
          .catch(function (e) { alert('Delete failed: ' + e.message); });
      });
    });
  }

  function renderPlayerDropdowns() {
    var search = document.getElementById('playerSearch');
    var dropdown = document.getElementById('playerDropdown');
    var selected = document.getElementById('playerSelected');
    if (!search || !dropdown || !selected) return;

    function renderPlayerDropdown() {
      var q = (search.value || '').toLowerCase().trim();
      var opts = allPlayers.filter(function (p) {
        var id = p.id || p.PK || '';
        if (selectedPlayerIds.indexOf(id) !== -1) return false;
        var name = (p.name || '').toLowerCase();
        return !q || name.indexOf(q) !== -1;
      });
      dropdown.innerHTML = opts.length ? opts.map(function (p) {
        var id = p.id || p.PK || '';
        return '<div class="player-dropdown-option" data-id="' + escapeHtml(id) + '">' + escapeHtml(p.name || id) + '</div>';
      }).join('') : '<div class="player-dropdown-option" style="color:#666;cursor:default;">No matches</div>';
      dropdown.hidden = false;
    }

    function renderPlayerSelected() {
      selected.innerHTML = selectedPlayerIds.map(function (id) {
        var name = playerName(id);
        return '<span class="player-chip">' + escapeHtml(name) + '<button type="button" class="player-chip-remove" data-id="' + escapeHtml(id) + '" aria-label="Remove">×</button></span>';
      }).join('');
    }

    search.addEventListener('focus', renderPlayerDropdown);
    search.addEventListener('input', renderPlayerDropdown);
    search.addEventListener('keydown', function (e) { if (e.key === 'Escape') dropdown.hidden = true; });
    dropdown.addEventListener('click', function (e) {
      var opt = e.target.closest('.player-dropdown-option');
      if (opt && opt.dataset.id && !opt.classList.contains('disabled')) {
        if (selectedPlayerIds.indexOf(opt.dataset.id) === -1) {
          selectedPlayerIds.push(opt.dataset.id);
          renderPlayerSelected();
          renderPlayerDropdown();
        }
        search.value = '';
        search.focus();
      }
    });
    selected.addEventListener('click', function (e) {
      var btn = e.target.closest('.player-chip-remove');
      if (btn && btn.dataset.id) {
        selectedPlayerIds = selectedPlayerIds.filter(function (x) { return x !== btn.dataset.id; });
        renderPlayerSelected();
        renderPlayerDropdown();
      }
    });
    document.addEventListener('click', function (e) {
      if (search && dropdown && !search.contains(e.target) && !dropdown.contains(e.target)) dropdown.hidden = true;
    });
    renderPlayerSelected();
  }

  function renderPlayerSelectOptions() {
    var ids = ['matchTeamAP1', 'matchTeamAP2', 'matchTeamBP1', 'matchTeamBP2'];
    var selectedInForm = [
      document.getElementById('matchTeamAP1') && document.getElementById('matchTeamAP1').value,
      document.getElementById('matchTeamAP2') && document.getElementById('matchTeamAP2').value,
      document.getElementById('matchTeamBP1') && document.getElementById('matchTeamBP1').value,
      document.getElementById('matchTeamBP2') && document.getElementById('matchTeamBP2').value
    ];
    ids.forEach(function (selId, idx) {
      var sel = document.getElementById(selId);
      if (!sel) return;
      var currentVal = sel.value;
      var others = selectedInForm.filter(function (_, i) { return i !== idx; });
      sel.innerHTML = '<option value="">— Select —</option>' + allPlayers.map(function (p) {
        var id = p.id || p.PK || '';
        var name = p.name || id;
        var disabled = others.indexOf(id) !== -1 ? ' disabled' : '';
        return '<option value="' + escapeHtml(id) + '"' + disabled + '>' + escapeHtml(name) + '</option>';
      }).join('');
      sel.value = currentVal || '';
    });
  }

  function syncPlayerSelectDisabled() {
    var sels = [
      document.getElementById('matchTeamAP1'),
      document.getElementById('matchTeamAP2'),
      document.getElementById('matchTeamBP1'),
      document.getElementById('matchTeamBP2')
    ];
    var selected = sels.map(function (s) { return s && s.value; });
    sels.forEach(function (sel, idx) {
      if (!sel) return;
      Array.prototype.forEach.call(sel.options, function (opt) {
        if (!opt.value) return;
        var usedElsewhere = selected.some(function (v, i) { return i !== idx && v === opt.value; });
        opt.disabled = usedElsewhere;
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
        var canAccess = customGroups.indexOf('Squash') !== -1 || groups.indexOf('admin') !== -1;
        if (!canAccess) {
          showMessage('You do not have access to the Squash section. Join the Squash group or contact an admin.', true);
          return;
        }
        canModify = groups.indexOf('admin') !== -1 || (groups.indexOf('manager') !== -1 && customGroups.indexOf('Squash') !== -1);
        squashWrap.hidden = false;
        if (canModify) {
          playerFormWrap.hidden = false;
          matchFormWrap.hidden = false;
        }
        loadPlayers().then(function () { return loadMatches(); });

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
            fetchWithAuth(url, {
              method: method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            })
              .then(function (r) {
                if (r.ok) {
                  editingPlayerId = null;
                  document.getElementById('playerId').value = '';
                  document.getElementById('playerForm').reset();
                  document.getElementById('playerSubmitBtn').textContent = 'Add player';
                  playerFormWrap.hidden = !canModify;
                  return loadPlayers().then(loadMatches);
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
            playerFormWrap.hidden = !canModify;
          });
        }

        if (document.getElementById('matchForm')) {
          document.getElementById('matchForm').addEventListener('submit', function (e) {
            e.preventDefault();
            var id = document.getElementById('matchId').value;
            var date = document.getElementById('matchDate').value;
            var p1 = document.getElementById('matchTeamAP1').value;
            var p2 = document.getElementById('matchTeamAP2').value;
            var p3 = document.getElementById('matchTeamBP1').value;
            var p4 = document.getElementById('matchTeamBP2').value;
            var winning = document.getElementById('matchWinningTeam').value;
            var loserGames = parseInt(document.getElementById('matchLoserGames').value, 10);
            if (!date || !p1 || !p2 || !p3 || !p4) {
              alert('All fields are required.');
              return;
            }
            var ids = [p1, p2, p3, p4];
            var uniq = ids.filter(function (v, i, a) { return a.indexOf(v) === i; });
            if (uniq.length !== 4) {
              alert('Each player can only be on one team.');
              return;
            }
            var teamAGames = winning === 'A' ? 3 : loserGames;
            var teamBGames = winning === 'B' ? 3 : loserGames;
            var payload = {
              date: date,
              teamAPlayer1Id: p1,
              teamAPlayer2Id: p2,
              teamBPlayer1Id: p3,
              teamBPlayer2Id: p4,
              winningTeam: winning,
              teamAGames: teamAGames,
              teamBGames: teamBGames
            };
            var url = base + '/squash/matches';
            var method = 'POST';
            if (editingMatchId) {
              payload.id = id || editingMatchId;
              method = 'PUT';
            }
            fetchWithAuth(url, {
              method: method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            })
              .then(function (r) {
                if (r.ok) {
                  editingMatchId = null;
                  document.getElementById('matchId').value = '';
                  document.getElementById('matchForm').reset();
                  document.getElementById('matchSubmitBtn').textContent = 'Add match';
                  matchFormWrap.hidden = !canModify;
                  return loadMatches();
                }
                return r.json().then(function (d) { throw new Error(d.error || 'Failed'); });
              })
              .catch(function (e) { alert('Failed: ' + e.message); });
          });
        }
        if (document.getElementById('matchCancelBtn')) {
          document.getElementById('matchCancelBtn').addEventListener('click', function () {
            editingMatchId = null;
            document.getElementById('matchId').value = '';
            document.getElementById('matchForm').reset();
            document.getElementById('matchSubmitBtn').textContent = 'Add match';
            matchFormWrap.hidden = !canModify;
          });
        }

        ['matchTeamAP1', 'matchTeamAP2', 'matchTeamBP1', 'matchTeamBP2'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) el.addEventListener('change', syncPlayerSelectDisabled);
        });

        if (document.getElementById('searchBtn')) {
          document.getElementById('searchBtn').addEventListener('click', function () { loadMatches(); });
        }
        if (document.getElementById('clearSearchBtn')) {
          document.getElementById('clearSearchBtn').addEventListener('click', function () {
            document.getElementById('searchDate').value = '';
            document.getElementById('searchDateFrom').value = '';
            document.getElementById('searchDateTo').value = '';
            selectedPlayerIds = [];
            var selected = document.getElementById('playerSelected');
            if (selected) selected.innerHTML = '';
            var search = document.getElementById('playerSearch');
            if (search) search.value = '';
            renderPlayerDropdowns();
            loadMatches();
          });
        }

        if (canModify) {
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
        }
      })
      .catch(function () {
        showMessage('Could not verify access.', true);
      });
  });
})();
