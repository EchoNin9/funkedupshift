(function () {
  var base = (window.API_BASE_URL || '').replace(/\/$/, '');
  var messageEl = document.getElementById('message');
  var squashWrap = document.getElementById('squashWrap');
  var matchList = document.getElementById('matchList');
  var resultsHint = document.getElementById('resultsHint');
  var matchPagination = document.getElementById('matchPagination');
  var allPlayers = [];
  var selectedPlayerIds = [];
  var allMatches = [];
  var currentPage = 1;
  var PAGE_SIZE = 10;
  var hasSearched = false;

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
        renderPlayerDropdowns();
      });
  }

  function searchMatches() {
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
        allMatches = data.matches || [];
        hasSearched = true;
        currentPage = 1;
        renderResults();
      });
  }

  function renderResults() {
    if (!matchList) return;
    if (resultsHint) resultsHint.hidden = hasSearched;
    if (!hasSearched) {
      matchList.innerHTML = '';
      matchPagination.hidden = true;
      return;
    }
    var totalPages = Math.max(1, Math.ceil(allMatches.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    var start = (currentPage - 1) * PAGE_SIZE;
    var pageMatches = allMatches.slice(start, start + PAGE_SIZE);
    if (pageMatches.length === 0) {
      matchList.innerHTML = '<li>No matches found.</li>';
    } else {
      matchList.innerHTML = pageMatches.map(function (m) {
        var teamA = [playerName(m.teamAPlayer1Id), playerName(m.teamAPlayer2Id)].filter(Boolean).join(' & ');
        var teamB = [playerName(m.teamBPlayer1Id), playerName(m.teamBPlayer2Id)].filter(Boolean).join(' & ');
        var ga = m.teamAGames != null ? m.teamAGames : 0;
        var gb = m.teamBGames != null ? m.teamBGames : 0;

        // Ensure winning team is always shown on the left in search results
        var leftTeam = teamA;
        var rightTeam = teamB;
        var leftGames = ga;
        var rightGames = gb;

        if (m.winningTeam === 'B') {
          leftTeam = teamB;
          rightTeam = teamA;
          leftGames = gb;
          rightGames = ga;
        } else if (m.winningTeam === 'A') {
          leftTeam = teamA;
          rightTeam = teamB;
          leftGames = ga;
          rightGames = gb;
        }

        var score = leftGames + '-' + rightGames;

        return '<li>' +
          '<span class="match-date">' + escapeHtml(m.date || '') + '</span> ' +
          escapeHtml(leftTeam) + ' vs ' + escapeHtml(rightTeam) + ' ' +
          '<span class="match-score">' + score + '</span>' +
          '</li>';
      }).join('');
    }
    renderPagination(totalPages);
  }

  function renderPagination(totalPages) {
    if (!matchPagination) return;
    if (totalPages <= 1) {
      matchPagination.hidden = true;
      return;
    }
    matchPagination.hidden = false;
    var pageNums = [];
    for (var p = 1; p <= totalPages; p++) pageNums.push(p);
    if (totalPages > 7) {
      var cur = currentPage;
      var show = [1];
      if (cur > 3) show.push('…');
      for (var i = Math.max(2, cur - 1); i <= Math.min(totalPages - 1, cur + 1); i++) {
        if (show.indexOf(i) === -1) show.push(i);
      }
      if (cur < totalPages - 2) show.push('…');
      if (totalPages > 1) show.push(totalPages);
      pageNums = show;
    }
    var numsHtml = pageNums.map(function (p) {
      if (p === '…') return '<span class="page-num">…</span>';
      var isCur = p === currentPage;
      return isCur
        ? '<span class="page-num current">' + p + '</span>'
        : '<button type="button" class="secondary page-num" data-page="' + p + '">' + p + '</button>';
    }).join('');
    matchPagination.innerHTML = '<button type="button" class="secondary" id="squashPrev">Prev</button><span class="page-nums">' + numsHtml + '</span><button type="button" class="secondary" id="squashNext">Next</button>';
    matchPagination.querySelector('#squashPrev').disabled = currentPage <= 1;
    matchPagination.querySelector('#squashNext').disabled = currentPage >= totalPages;
    matchPagination.querySelector('#squashPrev').onclick = function () { if (currentPage > 1) { currentPage--; renderResults(); } };
    matchPagination.querySelector('#squashNext').onclick = function () { if (currentPage < totalPages) { currentPage++; renderResults(); } };
    matchPagination.querySelectorAll('.page-num[data-page]').forEach(function (btn) {
      btn.onclick = function () { currentPage = parseInt(btn.getAttribute('data-page'), 10); renderResults(); };
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
      if (opt && opt.dataset.id) {
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
        var squashInCustomGroups = customGroups.some(function(g) { return (g || '').trim() === 'Squash'; });
        var canAccess = squashInCustomGroups || groups.indexOf('admin') !== -1;
        if (!canAccess) {
          showMessage('You do not have access to the Squash section. Join the Squash group or contact an admin.', true);
          return;
        }
        squashWrap.hidden = false;
        loadPlayers();

        if (document.getElementById('searchBtn')) {
          document.getElementById('searchBtn').addEventListener('click', function () { searchMatches(); });
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
            hasSearched = false;
            allMatches = [];
            currentPage = 1;
            renderResults();
          });
        }
      })
      .catch(function () {
        showMessage('Could not verify access.', true);
      });
  });
})();
