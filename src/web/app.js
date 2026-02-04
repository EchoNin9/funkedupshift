(function () {
  var base = window.API_BASE_URL || '';
  var loading = document.getElementById('loading');
  var errorEl = document.getElementById('error');
  var healthEl = document.getElementById('health');
  var sitesWrap = document.getElementById('sitesWrap');
  var sitesContainer = document.getElementById('sitesContainer');
  var adminLinks = document.getElementById('adminLinks');
  var authSection = document.getElementById('authSection');
  var signInForm = document.getElementById('signInForm');
  var signUpForm = document.getElementById('signUpForm');
  var userInfo = document.getElementById('userInfo');
  var signOutBtn = document.getElementById('signOutBtn');
  var showSignUpBtn = document.getElementById('showSignUp');
  var canRate = false;
  var isAdmin = false;
  var sitesData = [];
  var allCategoriesFromSites = [];
  var groupByIds = [];

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

  function siteLi(s) {
    var id = s.PK || '';
    var title = s.title || s.url || id || 'Untitled';
    var avg = '';
    if (s.averageRating != null) {
      var n = parseFloat(s.averageRating);
      if (!isNaN(n)) avg = ' (' + n.toFixed(1) + '★)';
    }
    var url = s.url ? '<a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener">' + escapeHtml(s.url) + '</a>' : '';
    var desc = s.description ? '<div>' + escapeHtml(s.description) + '</div>' : '';
    var cats = (s.categories && s.categories.length) ? ' <span class="site-categories">[' + s.categories.map(function (c) { return escapeHtml(c.name); }).join(', ') + ']</span>' : '';
    var editBtn = (id && isAdmin) ? ' <a href="edit-site.html?id=' + encodeURIComponent(id) + '" class="secondary">Edit</a>' : '';
    var stars = '';
    if (id && canRate) {
      stars = '<div class="stars" data-id="' + escapeHtml(id) + '"><label>Rate: <select class="star-select"><option value="">--</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select><button type="button" class="secondary star-save">Save</button></label></div>';
    }
    return '<li><strong>' + escapeHtml(title) + avg + '</strong>' + (url ? ' ' + url : '') + cats + editBtn + desc + stars + '</li>';
  }

  function applySort(sites, sortBy) {
    var list = (sites || []).slice();
    var key = sortBy || 'avgDesc';
    list.sort(function (a, b) {
      var titleA = (a.title || a.url || a.PK || '').toLowerCase();
      var titleB = (b.title || b.url || b.PK || '').toLowerCase();
      var avgA = a.averageRating != null ? parseFloat(a.averageRating) : 0;
      var avgB = b.averageRating != null ? parseFloat(b.averageRating) : 0;
      if (key === 'avgDesc') {
        if (avgB !== avgA) return avgB - avgA;
        return titleA.localeCompare(titleB);
      }
      if (key === 'avgAsc') {
        if (avgA !== avgB) return avgA - avgB;
        return titleA.localeCompare(titleB);
      }
      if (key === 'alphaAsc') return titleA.localeCompare(titleB);
      if (key === 'alphaDesc') return titleB.localeCompare(titleA);
      return 0;
    });
    return list;
  }

  function renderSites(sites) {
    sitesData = sites || [];
    var sortSelect = document.getElementById('sortOrder');
    var sortBy = (sortSelect && sortSelect.value) || 'avgDesc';
    var sorted = applySort(sitesData, sortBy);

    if (sorted.length === 0) {
      sitesContainer.innerHTML = '<ul class="sites"><li>No sites yet.</li></ul>';
    } else if (groupByIds.length > 0) {
      var catIds = groupByIds.slice();
      var idToName = {};
      allCategoriesFromSites.forEach(function (c) { idToName[c.id] = c.name; });
      var html = '';
      catIds.forEach(function (cid) {
        var name = idToName[cid] || cid;
        var inGroup = sorted.filter(function (s) {
          var ids = (s.categoryIds || []).concat((s.categories || []).map(function (c) { return c.id; }));
          return ids.indexOf(cid) !== -1;
        });
        if (inGroup.length > 0) {
          html += '<div class="sites-group"><h3>' + escapeHtml(name) + '</h3><ul class="sites">' + inGroup.map(siteLi).join('') + '</ul></div>';
        }
      });
      var inAny = {};
      catIds.forEach(function (cid) { inAny[cid] = true; });
      var other = sorted.filter(function (s) {
        var ids = (s.categoryIds || []).concat((s.categories || []).map(function (c) { return c.id; }));
        return !ids.some(function (id) { return inAny[id]; });
      });
      if (other.length > 0) {
        html += '<div class="sites-group"><h3>Other</h3><ul class="sites">' + other.map(siteLi).join('') + '</ul></div>';
      }
      if (!html) html = '<ul class="sites">' + sorted.map(siteLi).join('') + '</ul>';
      sitesContainer.innerHTML = html;
    } else {
      sitesContainer.innerHTML = '<ul class="sites">' + sorted.map(siteLi).join('') + '</ul>';
    }

    if (canRate) {
      Array.prototype.forEach.call(sitesContainer.querySelectorAll('.stars .star-save'), function (btn) {
        btn.addEventListener('click', function () {
          var container = this.closest('.stars');
          if (!container) return;
          var siteId = container.getAttribute('data-id');
          var select = container.querySelector('.star-select');
          var value = select && select.value;
          if (!value) { alert('Please choose a rating between 1 and 5.'); return; }
          fetchWithAuth(base + '/stars', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteId: siteId, rating: parseInt(value, 10) })
          }).then(function (r) {
            if (r.ok) return;
            return r.text().then(function (t) { throw new Error(t || 'Request failed'); });
          }).then(function () { alert('Rating saved.'); }).catch(function (e) { alert('Failed: ' + e.message); });
        });
      });
    }
    sitesWrap.hidden = false;
  }

  function buildCategoriesFromSites(sites) {
    var seen = {};
    var list = [];
    (sites || []).forEach(function (s) {
      (s.categories || []).forEach(function (c) {
        var id = c.id || c.PK;
        if (id && !seen[id]) { seen[id] = true; list.push({ id: id, name: c.name || id }); }
      });
    });
    list.sort(function (a, b) { return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()); });
    return list;
  }

  function renderGroupByDropdown(filter) {
    var dropdown = document.getElementById('groupByDropdown');
    var search = document.getElementById('groupBySearch');
    if (!dropdown || !search) return;
    var q = (filter || search.value || '').toLowerCase().trim();
    var opts = allCategoriesFromSites.filter(function (c) {
      if (groupByIds.indexOf(c.id) !== -1) return false;
      return !q || (c.name || '').toLowerCase().indexOf(q) !== -1;
    });
    dropdown.innerHTML = opts.length ? opts.map(function (c) {
      return '<div class="group-by-option" data-id="' + escapeHtml(c.id) + '" data-name="' + escapeHtml(c.name) + '">' + escapeHtml(c.name) + '</div>';
    }).join('') : '<div class="group-by-option" style="color:#666;cursor:default;">No matches</div>';
    dropdown.hidden = false;
  }

  function renderGroupBySelected() {
    var el = document.getElementById('groupBySelected');
    if (!el) return;
    el.innerHTML = groupByIds.map(function (id) {
      var c = allCategoriesFromSites.find(function (x) { return x.id === id; });
      var name = c ? c.name : id;
      return '<span class="group-by-chip">' + escapeHtml(name) + '<button type="button" class="group-by-chip-remove" data-id="' + escapeHtml(id) + '" aria-label="Remove">×</button></span>';
    }).join('');
  }

  function initGroupBy() {
    allCategoriesFromSites = buildCategoriesFromSites(sitesData);
    var search = document.getElementById('groupBySearch');
    var dropdown = document.getElementById('groupByDropdown');
    if (!search || !dropdown) return;
    search.addEventListener('focus', function () { renderGroupByDropdown(); });
    search.addEventListener('input', function () { renderGroupByDropdown(); });
    search.addEventListener('keydown', function (e) { if (e.key === 'Escape') dropdown.hidden = true; });
    dropdown.addEventListener('click', function (e) {
      var opt = e.target.closest('.group-by-option');
      if (opt && opt.dataset.id) {
        if (groupByIds.indexOf(opt.dataset.id) === -1) {
          groupByIds.push(opt.dataset.id);
          renderGroupBySelected();
          renderGroupByDropdown();
          renderSites(sitesData);
        }
        search.value = '';
      }
    });
    document.getElementById('groupBySelected').addEventListener('click', function (e) {
      var btn = e.target.closest('.group-by-chip-remove');
      if (btn && btn.dataset.id) {
        groupByIds = groupByIds.filter(function (x) { return x !== btn.dataset.id; });
        renderGroupBySelected();
        renderGroupByDropdown();
        renderSites(sitesData);
      }
    });
    document.addEventListener('click', function (e) {
      if (search && dropdown && !search.contains(e.target) && !dropdown.contains(e.target)) dropdown.hidden = true;
    });
    renderGroupBySelected();
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function fetchWithAuth(url, options) {
    options = options || {};
    options.headers = options.headers || {};
    return new Promise(function (resolve, reject) {
      window.auth.getAccessToken(function (token) {
        if (token) {
          options.headers['Authorization'] = 'Bearer ' + token;
        }
        fetch(url, options).then(resolve).catch(reject);
      });
    });
  }

  function initAuth() {
    if (!window.auth) {
      if (authSection) authSection.hidden = true;
      if (adminLinks) adminLinks.hidden = true;
      return;
    }

    var hasUi = !!authSection;
    if (hasUi) {
      authSection.hidden = false;
    }

    window.auth.isAuthenticated(function (isAuth) {
      canRate = isAuth; // any authenticated user can rate
      if (!isAuth) {
        isAdmin = false;
        if (adminLinks) adminLinks.hidden = true;

        if (hasUi) {
          if (signInForm) signInForm.hidden = false;
          if (signUpForm) signUpForm.hidden = true;
          if (showSignUpBtn) showSignUpBtn.hidden = false;
          if (signOutBtn) signOutBtn.hidden = true;
          if (userInfo) userInfo.hidden = true;
        }
        return;
      }

      // Authenticated: fetch user info (/me) to determine admin role
      fetchWithAuth(base + '/me')
        .then(function (r) { return r.ok ? r.json() : r.text().then(function (t) { throw new Error(t || 'Failed to load user'); }); })
        .then(function (user) {
          var groups = user.groups || [];
          isAdmin = Array.isArray(groups) && groups.indexOf('admin') !== -1;
          if (adminLinks) adminLinks.hidden = !isAdmin;

          if (hasUi) {
            if (signInForm) signInForm.hidden = true;
            if (signUpForm) signUpForm.hidden = true;
            if (showSignUpBtn) showSignUpBtn.hidden = true;
            if (signOutBtn) signOutBtn.hidden = true; // show below after we know user

            window.auth.getCurrentUserEmail(function (email) {
              if (userInfo) {
                userInfo.textContent = 'Signed in as: ' + (email || 'user') +
                  (isAdmin ? ' (admin)' : '');
                userInfo.hidden = false;
              }
            });

            if (signOutBtn) signOutBtn.hidden = false;
          }
        })
        .catch(function () {
          // On error, treat as non-admin but still authenticated for rating
          isAdmin = false;
          if (adminLinks) adminLinks.hidden = true;
          if (hasUi) {
            if (signInForm) signInForm.hidden = true;
            if (signUpForm) signUpForm.hidden = true;
            if (showSignUpBtn) showSignUpBtn.hidden = true;
            if (signOutBtn) signOutBtn.hidden = false;
          }
        });
    });

    // Attach auth form handlers only when forms exist (auth page)
    if (signInForm) {
      signInForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = document.getElementById('signInEmail').value;
        var password = document.getElementById('signInPassword').value;
        window.auth.signIn(email, password, function (err) {
          if (err) {
            alert('Sign in failed: ' + (err.message || err));
            return;
          }
          // After sign in, go back to main page
          window.location.href = 'index.html';
        });
      });
    }

    if (signUpForm) {
      signUpForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = document.getElementById('signUpEmail').value;
        var password = document.getElementById('signUpPassword').value;
        window.auth.signUp(email, password, function (err, result) {
          if (err) {
            alert('Sign up failed: ' + (err.message || err));
            return;
          }
          alert('Sign up successful! Check your email for verification code.');
          signUpForm.hidden = true;
          if (signInForm) signInForm.hidden = false;
        });
      });
    }

  }

  if (!base) {
    showError('API URL not set. Deploy via CI or set window.API_BASE_URL in config.js.');
    return;
  }

  base = base.replace(/\/$/, '');

  initAuth();

  fetch(base + '/health')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      setHealth(data.ok === true, 'API: ' + (data.ok ? 'OK' : 'Error'));
    })
    .catch(function (e) {
      setHealth(false, 'API health check failed: ' + e.message);
    });

  fetch(base + '/sites')
    .then(function (r) {
      if (!r.ok) {
        return r.text().then(function (text) {
          throw new Error('HTTP ' + r.status + ': ' + text);
        });
      }
      return r.json();
    })
    .then(function (data) {
      var list = data.sites || [];
      renderSites(list);
      initGroupBy();
      var sortOrder = document.getElementById('sortOrder');
      if (sortOrder) {
        sortOrder.addEventListener('change', function () { renderSites(sitesData); });
      }
    })
    .catch(function (e) {
      console.error('GET /sites error:', e);
      showError('Failed to load sites: ' + e.message);
      renderSites([]);
    })
    .then(hideLoading);
})();
