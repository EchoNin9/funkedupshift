(function () {
  var CACHE_KEY = 'funkedupshift_internet_dashboard';
  var CACHE_TTL_MS = 5 * 60 * 1000;
  var base = (window.API_BASE_URL || '').replace(/\/$/, '');
  var loadingEl = document.getElementById('loading');
  var errorEl = document.getElementById('error');
  var gridEl = document.getElementById('dashboardGrid');

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function render(sites) {
    if (!gridEl || !Array.isArray(sites)) return;
    gridEl.innerHTML = sites.map(function (s) {
      var domain = s.domain || '';
      var status = (s.status || 'down').toLowerCase();
      var rt = s.responseTimeMs;
      var rtStr = rt != null ? rt + ' ms' : '';
      return '<div class="dashboard-tile ' + escapeHtml(status) + '">' +
        '<div class="domain">' + escapeHtml(domain) + '</div>' +
        '<div class="status-text">' + escapeHtml(status) + '</div>' +
        (rtStr ? '<div class="response-time">' + escapeHtml(rtStr) + '</div>' : '') +
        '</div>';
    }).join('');
    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
  }

  function showError(msg) {
    if (loadingEl) loadingEl.hidden = true;
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    }
    if (gridEl) gridEl.innerHTML = '';
  }

  function load() {
    var cached;
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (raw) cached = JSON.parse(raw);
    } catch (e) {}
    if (cached && cached.sites && cached.lastFetchTime) {
      var age = Date.now() - new Date(cached.lastFetchTime).getTime();
      if (age < CACHE_TTL_MS) {
        render(cached.sites);
        return;
      }
    }
    if (!base) {
      showError('API URL not set.');
      return;
    }
    if (loadingEl) loadingEl.hidden = false;
    if (errorEl) errorEl.hidden = true;
    fetch(base + '/internet-dashboard')
      .then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(t || 'Request failed'); });
        return r.json();
      })
      .then(function (data) {
        var sites = data.sites;
        if (Array.isArray(sites) && sites.length > 0) {
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
              sites: sites,
              lastFetchTime: new Date().toISOString()
            }));
          } catch (e) {}
          render(sites);
        } else {
          showError('No data returned.');
        }
      })
      .catch(function (e) {
        if (cached && cached.sites) {
          render(cached.sites);
        } else {
          showError('Failed to load: ' + (e.message || 'Unknown error'));
        }
      });
  }

  load();
})();
