(function () {
  var base = window.API_BASE_URL || '';
  var loading = document.getElementById('loading');
  var errorEl = document.getElementById('error');
  var healthEl = document.getElementById('health');
  var sitesWrap = document.getElementById('sitesWrap');
  var sitesList = document.getElementById('sites');

  function showError(msg) {
    loading.hidden = true;
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function hideLoading() {
    loading.hidden = true;
  }

  function setHealth(ok, text) {
    healthEl.textContent = text;
    healthEl.className = 'status ' + (ok ? 'ok' : 'err');
    healthEl.hidden = false;
  }

  function renderSites(sites) {
    if (!sites || sites.length === 0) {
      sitesList.innerHTML = '<li>No sites yet.</li>';
    } else {
      sitesList.innerHTML = sites.map(function (s) {
        var title = s.title || s.url || s.PK || 'Untitled';
        var url = s.url ? '<a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener">' + escapeHtml(s.url) + '</a>' : '';
        return '<li><strong>' + escapeHtml(title) + '</strong>' + (url ? ' ' + url : '') + '</li>';
      }).join('');
    }
    sitesWrap.hidden = false;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  if (!base) {
    showError('API URL not set. Deploy via CI or set window.API_BASE_URL in config.js.');
    return;
  }

  base = base.replace(/\/$/, '');

  fetch(base + '/health')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      setHealth(data.ok === true, 'API: ' + (data.ok ? 'OK' : 'Error'));
    })
    .catch(function (e) {
      setHealth(false, 'API health check failed: ' + e.message);
    });

  fetch(base + '/sites')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      renderSites(data.sites || []);
    })
    .catch(function (e) {
      renderSites([]);
    })
    .then(hideLoading);
})();
