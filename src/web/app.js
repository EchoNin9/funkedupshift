(function () {
  var base = window.API_BASE_URL || '';
  var loading = document.getElementById('loading');
  var errorEl = document.getElementById('error');
  var healthEl = document.getElementById('health');
  var sitesWrap = document.getElementById('sitesWrap');
  var sitesList = document.getElementById('sites');
  var addSiteForm = document.getElementById('addSiteForm');
  var createSiteForm = document.getElementById('createSiteForm');
  var createSiteResult = document.getElementById('createSiteResult');
  var authSection = document.getElementById('authSection');
  var signInForm = document.getElementById('signInForm');
  var signUpForm = document.getElementById('signUpForm');
  var userInfo = document.getElementById('userInfo');
  var signOutBtn = document.getElementById('signOutBtn');
  var showSignUpBtn = document.getElementById('showSignUp');
  var canRate = false;
  var isAdmin = false;

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
        var id = s.PK || '';
        var title = s.title || s.url || id || 'Untitled';
        var avg = '';
        if (s.averageRating != null) {
          var n = parseFloat(s.averageRating);
          if (!isNaN(n)) {
            avg = ' (' + n.toFixed(1) + '★)';
          }
        }
        var url = s.url ? '<a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener">' + escapeHtml(s.url) + '</a>' : '';
        var desc = s.description ? '<div>' + escapeHtml(s.description) + '</div>' : '';
        var editBtn = (id && isAdmin) ? ' <button class="secondary edit-site" data-id="' + escapeHtml(id) +
          '" data-title="' + escapeHtml(title) +
          '" data-description="' + escapeHtml(s.description || '') + '">Edit</button>' : '';
        var stars = '';
        if (id && canRate) {
          stars =
            '<div class="stars" data-id="' + escapeHtml(id) + '">' +
              '<label>Rate: ' +
              '<select class="star-select">' +
                '<option value="">--</option>' +
                '<option value="1">1</option>' +
                '<option value="2">2</option>' +
                '<option value="3">3</option>' +
                '<option value="4">4</option>' +
                '<option value="5">5</option>' +
              '</select>' +
              '<button type="button" class="secondary star-save">Save</button>' +
              '</label>' +
            '</div>';
        }
        return '<li><strong>' + escapeHtml(title) + avg + '</strong>' +
          (url ? ' ' + url : '') + editBtn + desc + stars + '</li>';
      }).join('');

      // Attach edit handlers (admin only)
      if (isAdmin) {
        Array.prototype.forEach.call(document.querySelectorAll('.edit-site'), function (btn) {
          btn.addEventListener('click', function () {
            var id = this.getAttribute('data-id');
            var currentTitle = this.getAttribute('data-title') || '';
            var currentDesc = this.getAttribute('data-description') || '';
            var newTitle = window.prompt('Edit title:', currentTitle);
            if (newTitle === null) return;
            var newDesc = window.prompt('Edit description:', currentDesc);
            if (newDesc === null) return;
            fetchWithAuth(base + '/sites', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: id, title: newTitle, description: newDesc })
            }).then(function (r) {
              if (r.ok) return r.json();
              return r.text().then(function (text) { throw new Error(text || 'Request failed'); });
            }).then(function () {
              // Refresh sites list
              return fetch(base + '/sites').then(function (r) { return r.json(); });
            }).then(function (data) {
              renderSites(data.sites || []);
            }).catch(function (e) {
              alert('Edit failed: ' + e.message);
            });
          });
        });
      }

      // Attach star handlers (any authenticated user)
      if (canRate) {
        Array.prototype.forEach.call(document.querySelectorAll('.stars .star-save'), function (btn) {
          btn.addEventListener('click', function () {
            var container = this.closest('.stars');
            if (!container) return;
            var siteId = container.getAttribute('data-id');
            var select = container.querySelector('.star-select');
            var value = select && select.value;
            if (!value) {
              alert('Please choose a rating between 1 and 5.');
              return;
            }
            fetchWithAuth(base + '/stars', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ siteId: siteId, rating: parseInt(value, 10) })
            }).then(function (r) {
              if (r.ok) return r.json();
              return r.text().then(function (text) { throw new Error(text || 'Request failed'); });
            }).then(function () {
              alert('Rating saved.');
            }).catch(function (e) {
              alert('Failed to save rating: ' + e.message);
            });
          });
        });
      }
    }
    sitesWrap.hidden = false;
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
      authSection.hidden = true;
      return;
    }
    authSection.hidden = false;

    window.auth.isAuthenticated(function (isAuth) {
      canRate = isAuth; // any authenticated user can rate
      if (!isAuth) {
        isAdmin = false;
        signInForm.hidden = false;
        signUpForm.hidden = true;
        showSignUpBtn.hidden = false;
        signOutBtn.hidden = true;
        userInfo.hidden = true;
        addSiteForm.hidden = true;
        return;
      }

      // Authenticated: fetch user info (/me) to determine admin role
      fetchWithAuth(base + '/me')
        .then(function (r) { return r.ok ? r.json() : r.text().then(function (t) { throw new Error(t || 'Failed to load user'); }); })
        .then(function (user) {
          var groups = user.groups || [];
          isAdmin = Array.isArray(groups) && groups.indexOf('admin') !== -1;

          signInForm.hidden = true;
          signUpForm.hidden = true;
          showSignUpBtn.hidden = true;
          signOutBtn.hidden = true; // show below after we know user

          addSiteForm.hidden = !isAdmin;

          window.auth.getCurrentUserEmail(function (email) {
            userInfo.textContent = 'Signed in as: ' + (email || 'user') +
              (isAdmin ? ' (admin)' : '');
            userInfo.hidden = false;
          });

          signOutBtn.hidden = false;
        })
        .catch(function () {
          // On error, treat as non-admin but still authenticated for rating
          isAdmin = false;
          signInForm.hidden = true;
          signUpForm.hidden = true;
          showSignUpBtn.hidden = true;
          signOutBtn.hidden = false;
          addSiteForm.hidden = true;
        });
    });

    signInForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('signInEmail').value;
      var password = document.getElementById('signInPassword').value;
      window.auth.signIn(email, password, function (err) {
        if (err) {
          alert('Sign in failed: ' + (err.message || err));
          return;
        }
        location.reload();
      });
    });

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
        signInForm.hidden = false;
      });
    });

    createSiteForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var url = document.getElementById('siteUrl').value.trim();
      var title = document.getElementById('siteTitle').value.trim();
      var description = document.getElementById('siteDescription').value.trim();
      if (!url) {
        createSiteResult.textContent = 'URL is required';
        createSiteResult.className = 'status err';
        return;
      }
      createSiteResult.textContent = 'Creating...';
      createSiteResult.className = 'status';
      createSiteResult.hidden = false;
      fetchWithAuth(base + '/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, title: title, description: description })
      }).then(function (r) {
        if (r.ok) {
          return r.json();
        }
        return r.text().then(function (text) {
          throw new Error(text || 'Request failed');
        });
      }).then(function (data) {
        createSiteResult.textContent = 'Site added: ' + (data.title || data.url);
        createSiteResult.className = 'status ok';
        document.getElementById('siteUrl').value = '';
        document.getElementById('siteTitle').value = '';
         document.getElementById('siteDescription').value = '';
        // Reload sites list
        fetch(base + '/sites')
          .then(function (r) { return r.json(); })
          .then(function (data) { renderSites(data.sites || []); });
      }).catch(function (e) {
        createSiteResult.textContent = 'Error: ' + e.message;
        createSiteResult.className = 'status err';
      });
    });
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
      renderSites(data.sites || []);
    })
    .catch(function (e) {
      console.error('GET /sites error:', e);
      showError('Failed to load sites: ' + e.message);
      renderSites([]);
    })
    .then(hideLoading);
})();
