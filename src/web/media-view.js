(function () {
  var base = (window.API_BASE_URL || '').replace(/\/$/, '');
  var loading = document.getElementById('loading');
  var errorEl = document.getElementById('error');
  var mediaView = document.getElementById('mediaView');

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function showError(msg) {
    loading.hidden = true;
    errorEl.textContent = msg;
    errorEl.hidden = false;
    mediaView.hidden = true;
  }

  function fetchWithAuth(url, options) {
    options = options || {};
    options.headers = options.headers || {};
    return new Promise(function (resolve, reject) {
      if (!window.auth || !window.auth.getAccessToken) {
        fetch(url, options).then(resolve).catch(reject);
        return;
      }
      window.auth.getAccessToken(function (token) {
        if (token) options.headers['Authorization'] = 'Bearer ' + token;
        fetch(url, options).then(resolve).catch(reject);
      });
    });
  }

  function getMediaId() {
    var match = /[?&]id=([^&]*)/.exec(window.location.search);
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')).trim() : '';
  }

  if (!base) {
    showError('API URL not set.');
    return;
  }

  var mediaId = getMediaId();
  if (!mediaId) {
    showError('No media ID specified.');
    return;
  }

  loading.hidden = false;
  fetch(base + '/media?id=' + encodeURIComponent(mediaId))
    .then(function (r) {
      if (!r.ok) {
        if (r.status === 404) throw new Error('Media not found');
        return r.text().then(function (t) { throw new Error(t || 'Request failed'); });
      }
      return r.json();
    })
    .then(function (data) {
      loading.hidden = true;
      errorEl.hidden = true;
      var m = data.media;
      if (!m) {
        showError('Media not found.');
        return;
      }
      var id = m.PK || m.id || mediaId;
      var title = m.title || id || 'Untitled';
      var avg = '';
      if (m.averageRating != null) {
        var n = parseFloat(m.averageRating);
        if (!isNaN(n)) avg = ' (' + n.toFixed(1) + '★)';
      }
      var cats = (m.categories && m.categories.length)
        ? '<div class="media-categories">' + m.categories.map(function (c) { return escapeHtml(c.name); }).join(', ') + '</div>'
        : '';
      var desc = m.description ? '<div class="media-description">' + escapeHtml(m.description) + '</div>' : '';
      var ratingDisplay = m.averageRating != null ? '<div class="media-rating">Average rating: ' + parseFloat(m.averageRating).toFixed(1) + '★</div>' : '';
      var mediaHtml = '<h2>' + escapeHtml(title) + avg + '</h2>' + cats + desc + ratingDisplay;
      if (m.mediaType === 'video' && m.mediaUrl) {
        mediaHtml += '<video controls src="' + escapeHtml(m.mediaUrl) + '">Your browser does not support video.</video>';
      } else if (m.mediaUrl) {
        mediaHtml += '<img src="' + escapeHtml(m.mediaUrl) + '" alt="' + escapeHtml(title) + '">';
      } else {
        mediaHtml += '<p>No media file available.</p>';
      }
      mediaView.innerHTML = mediaHtml;
      mediaView.hidden = false;

      if (window.auth) {
        fetchWithAuth(base + '/me')
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (user) {
            if (user && (user.groups || []).indexOf('admin') !== -1) {
              var h2 = mediaView.querySelector('h2');
              if (h2) h2.innerHTML += ' <a href="edit-media.html?id=' + encodeURIComponent(id) + '" class="secondary">Edit</a>';
            }
          })
          .catch(function () {});
      }
    })
    .catch(function (e) {
      showError(e.message || 'Failed to load media.');
    });
})();
