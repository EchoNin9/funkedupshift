(function () {
  var base = window.API_BASE_URL || '';
  var loading = document.getElementById('loading');
  var errorEl = document.getElementById('error');
  var healthEl = document.getElementById('health');
  var mediaWrap = document.getElementById('mediaWrap');
  var mediaContainer = document.getElementById('mediaContainer');
  var navAddMedia = document.getElementById('navAddMedia');
  var navMediaCategories = document.getElementById('navMediaCategories');
  var navLoadAll = document.getElementById('navLoadAll');
  var canRate = false;
  var isAdmin = false;
  var mediaData = [];
  var allCategoriesFromMedia = [];
  var groupByIds = [];
  var PAGE_SIZE = 10;
  var currentPage = 1;
  var searchTerm = '';
  var hasSearched = false;

  var MEDIA_CATEGORIES_CACHE_KEY = 'funkedupshift_media_categories';

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

  function mediaLi(m) {
    var id = m.PK || m.id || '';
    var title = m.title || id || 'Untitled';
    var avg = '';
    if (m.averageRating != null) {
      var n = parseFloat(m.averageRating);
      if (!isNaN(n)) avg = ' (' + n.toFixed(1) + '★)';
    }
    var thumbSrc = (m.thumbnailUrl && m.thumbnailUrl.trim()) ? m.thumbnailUrl : (m.mediaUrl && m.mediaType === 'image' ? m.mediaUrl : '');
    var thumbHtml = thumbSrc
      ? '<a href="media-view.html?id=' + encodeURIComponent(id) + '"><img class="media-thumb" src="' + escapeHtml(thumbSrc) + '" alt="" onerror="this.style.display=\'none\'"></a>'
      : '<a href="media-view.html?id=' + encodeURIComponent(id) + '"><span class="media-thumb" style="display:inline-block;width:80px;height:60px;background:#ddd;border-radius:0.5rem;line-height:60px;text-align:center;font-size:0.8rem;">' + (m.mediaType === 'video' ? '▶' : '📷') + '</span></a>';
    var mediaTypeLabel = (m.mediaType === 'video' ? 'Video' : 'Image');
    var mediaTypeLine = '<div class="media-type-line">' + escapeHtml(mediaTypeLabel) + '</div>';
    var desc = m.description ? '<div>' + escapeHtml(m.description) + '</div>' : '';
    var cats = (m.categories && m.categories.length) ? '<div class="media-categories-line"><span class="media-categories">' + m.categories.map(function (c) { return escapeHtml(c.name); }).join(', ') + '</span></div>' : '';
    var editBtn = (id && isAdmin) ? ' <a href="edit-media.html?id=' + encodeURIComponent(id) + '" class="secondary">Edit</a>' : '';
    var stars = '';
    if (id && canRate) {
      stars = '<div class="stars" data-id="' + escapeHtml(id) + '"><label>Rate: <select class="star-select"><option value="">--</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select><button type="button" class="secondary star-save">Save</button></label></div>';
    }
    return '<li class="media-item media-row">' + thumbHtml + ' <span class="media-info"><div class="media-title-line"><a href="media-view.html?id=' + encodeURIComponent(id) + '"><strong>' + escapeHtml(title) + avg + '</strong></a>' + editBtn + '</div>' + cats + mediaTypeLine + desc + stars + '</span></li>';
  }

  function applySort(media, sortBy) {
    var list = (media || []).slice();
    var key = sortBy || 'avgDesc';
    list.sort(function (a, b) {
      var titleA = (a.title || a.PK || '').toLowerCase();
      var titleB = (b.title || b.PK || '').toLowerCase();
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

  function buildFlatList(sorted) {
    if (groupByIds.length === 0) return sorted;
    var flat = [];
    groupByIds.forEach(function (cid) {
      var inGroup = sorted.filter(function (m) {
        var ids = (m.categoryIds || []).concat((m.categories || []).map(function (c) { return c.id; }));
        return ids.indexOf(cid) !== -1;
      });
      flat = flat.concat(inGroup);
    });
    return flat;
  }

  function renderMedia(media) {
    mediaData = media || [];
    var sortSelect = document.getElementById('sortOrder');
    var sortBy = (sortSelect && sortSelect.value) || 'avgDesc';
    var sorted = applySort(mediaData, sortBy);
    var flatList = buildFlatList(sorted);
    var totalPages = Math.max(1, Math.ceil(flatList.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    var start = (currentPage - 1) * PAGE_SIZE;
    var pageList = flatList.slice(start, start + PAGE_SIZE);

    var pagEl = document.getElementById('mediaPagination');
    if (!hasSearched) {
      mediaContainer.innerHTML = '';
      if (pagEl) pagEl.hidden = true;
      return;
    }
    if (flatList.length === 0) {
      mediaContainer.innerHTML = '<ul class="media"><li>No media found.</li></ul>';
      if (pagEl) pagEl.hidden = true;
    } else {
      mediaContainer.innerHTML = '<ul class="media">' + pageList.map(mediaLi).join('') + '</ul>';
      if (pagEl) pagEl.hidden = false;
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
      pagEl.innerHTML = '<button type="button" class="secondary" id="mediaPrev">Prev</button><span class="page-nums">' + numsHtml + '</span><button type="button" class="secondary" id="mediaNext">Next</button>';
      document.getElementById('mediaPrev').disabled = currentPage <= 1;
      document.getElementById('mediaNext').disabled = currentPage >= totalPages;
      document.getElementById('mediaPrev').onclick = function () { if (currentPage > 1) { currentPage--; renderMedia(mediaData); } };
      document.getElementById('mediaNext').onclick = function () { if (currentPage < totalPages) { currentPage++; renderMedia(mediaData); } };
      pagEl.querySelectorAll('.page-num[data-page]').forEach(function (btn) {
        btn.onclick = function () { currentPage = parseInt(btn.getAttribute('data-page'), 10); renderMedia(mediaData); };
      });
    }

    if (canRate) {
      Array.prototype.forEach.call(mediaContainer.querySelectorAll('.stars .star-save'), function (btn) {
        btn.addEventListener('click', function () {
          var container = this.closest('.stars');
          if (!container) return;
          var mediaId = container.getAttribute('data-id');
          var select = container.querySelector('.star-select');
          var value = select && select.value;
          if (!value) { alert('Please choose a rating between 1 and 5.'); return; }
          fetchWithAuth(base + '/media/stars', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mediaId: mediaId, rating: parseInt(value, 10) })
          }).then(function (r) {
            if (r.ok) return;
            return r.text().then(function (t) { throw new Error(t || 'Request failed'); });
          }).then(function () { alert('Rating saved.'); }).catch(function (e) { alert('Failed: ' + e.message); });
        });
      });
    }
    mediaWrap.hidden = false;
  }

  function buildCategoriesFromMedia(media) {
    var seen = {};
    var list = [];
    (media || []).forEach(function (m) {
      (m.categories || []).forEach(function (c) {
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
    var fromCache = [];
    try {
      var raw = localStorage.getItem(MEDIA_CATEGORIES_CACHE_KEY);
      if (raw) fromCache = JSON.parse(raw);
    } catch (e) {}
    var fromMedia = buildCategoriesFromMedia(mediaData);
    allCategoriesFromMedia = mergeCategories(fromCache, fromMedia);
    if (allCategoriesFromMedia.length === 0) {
      dropdown.innerHTML = '<div class="group-by-option" style="color:#666;cursor:default;">No matches. Search media first to load categories.</div>';
      dropdown.hidden = false;
      return;
    }
    var q = (filter || search.value || '').toLowerCase().trim();
    var opts = allCategoriesFromMedia.filter(function (c) {
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
      var c = allCategoriesFromMedia.find(function (x) { return x.id === id; });
      var name = c ? c.name : id;
      return '<span class="group-by-chip">' + escapeHtml(name) + '<button type="button" class="group-by-chip-remove" data-id="' + escapeHtml(id) + '" aria-label="Remove">×</button></span>';
    }).join('');
  }

  var groupByDropdownJustSelected = false;

  function mergeCategories(cacheList, fromMediaList) {
    var byId = {};
    (cacheList || []).forEach(function (c) { if (c.id) byId[c.id] = c; });
    (fromMediaList || []).forEach(function (c) { if (c.id) byId[c.id] = c; });
    return Object.keys(byId).map(function (id) { return byId[id]; }).sort(function (a, b) { return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()); });
  }

  function initGroupBy() {
    if (window._mediaGroupByListenersAttached) return;
    var fromMedia = buildCategoriesFromMedia(mediaData);
    var fromCache = [];
    try {
      var raw = localStorage.getItem(MEDIA_CATEGORIES_CACHE_KEY);
      if (raw) fromCache = JSON.parse(raw);
    } catch (e) {}
    allCategoriesFromMedia = mergeCategories(fromCache, fromMedia);
    var search = document.getElementById('groupBySearch');
    var dropdown = document.getElementById('groupByDropdown');
    if (!search || !dropdown) return;
    search.addEventListener('focus', function () { renderGroupByDropdown(); });
    search.addEventListener('input', function () { renderGroupByDropdown(); });
    search.addEventListener('keydown', function (e) { if (e.key === 'Escape') dropdown.hidden = true; });
    window._mediaGroupByListenersAttached = true;
    dropdown.addEventListener('click', function (e) {
      var opt = e.target.closest('.group-by-option');
      if (opt && opt.dataset.id) {
        if (groupByIds.indexOf(opt.dataset.id) === -1) {
          groupByIds.push(opt.dataset.id);
          currentPage = 1;
          renderGroupBySelected();
          groupByDropdownJustSelected = true;
          renderGroupByDropdown();
          loadMedia(false);
          setTimeout(function () { groupByDropdownJustSelected = false; }, 0);
        }
        search.value = '';
        search.focus();
      }
    });
    document.getElementById('groupBySelected').addEventListener('click', function (e) {
      var btn = e.target.closest('.group-by-chip-remove');
      if (btn && btn.dataset.id) {
        groupByIds = groupByIds.filter(function (x) { return x !== btn.dataset.id; });
        currentPage = 1;
        renderGroupBySelected();
        renderGroupByDropdown();
        loadMedia(false);
      }
    });
    document.addEventListener('click', function (e) {
      if (groupByDropdownJustSelected) return;
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
      if (navAddMedia) navAddMedia.style.display = 'none';
      if (navMediaCategories) navMediaCategories.style.display = 'none';
      if (navLoadAll) navLoadAll.style.display = 'none';
      return;
    }

    window.auth.isAuthenticated(function (isAuth) {
      canRate = isAuth;
      if (!isAuth) {
        isAdmin = false;
        if (navAddMedia) navAddMedia.style.display = 'none';
        if (navMediaCategories) navMediaCategories.style.display = 'none';
        if (navLoadAll) navLoadAll.style.display = 'none';
        return;
      }

      fetchWithAuth(base + '/me')
        .then(function (r) { return r.ok ? r.json() : r.text().then(function (t) { throw new Error(t || 'Failed to load user'); }); })
        .then(function (user) {
          var groups = user.groups || [];
          isAdmin = Array.isArray(groups) && groups.indexOf('admin') !== -1;
          if (navAddMedia) navAddMedia.style.display = isAdmin ? '' : 'none';
          if (navMediaCategories) navMediaCategories.style.display = isAdmin ? '' : 'none';
          if (navLoadAll) navLoadAll.style.display = isAdmin ? '' : 'none';
        })
        .catch(function () {
          isAdmin = false;
          if (navAddMedia) navAddMedia.style.display = 'none';
          if (navMediaCategories) navMediaCategories.style.display = 'none';
          if (navLoadAll) navLoadAll.style.display = 'none';
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

  function buildMediaUrl(loadAll) {
    var params = [];
    if (searchTerm) params.push('q=' + encodeURIComponent(searchTerm));
    if (loadAll) {
      if (groupByIds.length > 0) params.push('categoryIds=' + encodeURIComponent(groupByIds.join(',')));
      var qs = params.length ? '?' + params.join('&') : '';
      return base + '/media/all' + qs;
    }
    params.push('limit=100');
    if (groupByIds.length > 0) params.push('categoryIds=' + encodeURIComponent(groupByIds.join(',')));
    return base + '/media?' + params.join('&');
  }

  function loadMedia(loadAll) {
    var url = buildMediaUrl(loadAll);
    var fetcher = loadAll && window.auth ? fetchWithAuth(url) : fetch(url);
    loading.hidden = false;
    fetcher
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (text) {
            throw new Error('HTTP ' + r.status + ': ' + text);
          });
        }
        return r.json();
      })
      .then(function (data) {
        var list = data.media;
        if (Array.isArray(list)) {
          hasSearched = true;
          renderMedia(list);
        } else if (data.media && !Array.isArray(data.media)) {
          hasSearched = true;
          renderMedia([data.media]);
        } else {
          hasSearched = true;
          renderMedia([]);
        }
        var fromCache = [];
        try {
          var raw = localStorage.getItem(MEDIA_CATEGORIES_CACHE_KEY);
          if (raw) fromCache = JSON.parse(raw);
        } catch (e) {}
        allCategoriesFromMedia = mergeCategories(fromCache, buildCategoriesFromMedia(mediaData));
        if (allCategoriesFromMedia.length > 0) {
          try {
            localStorage.setItem(MEDIA_CATEGORIES_CACHE_KEY, JSON.stringify(allCategoriesFromMedia.map(function (c) { return { id: c.id, name: c.name }; })));
          } catch (e) {}
        }
        if (!window._mediaGroupByInitialized) {
          initGroupBy();
          window._mediaGroupByInitialized = true;
        } else {
          renderGroupBySelected();
          renderGroupByDropdown();
        }
        var hintEl = document.getElementById('searchHint');
        if (hintEl) hintEl.hidden = true;
        var sortOrder = document.getElementById('sortOrder');
        if (sortOrder && !sortOrder.hasAttribute('data-bound')) {
          sortOrder.setAttribute('data-bound', '1');
          sortOrder.addEventListener('change', function () { currentPage = 1; renderMedia(mediaData); });
        }
      })
      .catch(function (e) {
        showError('Failed to load media: ' + e.message);
        renderMedia([]);
      })
      .then(hideLoading);
  }

  function refreshCategoriesFromCache() {
    var cachedCats = [];
    try {
      var raw = localStorage.getItem(MEDIA_CATEGORIES_CACHE_KEY);
      if (raw) cachedCats = JSON.parse(raw);
    } catch (e) {}
    var fromMedia = buildCategoriesFromMedia(mediaData);
    allCategoriesFromMedia = mergeCategories(cachedCats, fromMedia);
    if (window._mediaGroupByInitialized) {
      renderGroupBySelected();
      renderGroupByDropdown();
    } else {
      initGroupBy();
      window._mediaGroupByInitialized = true;
    }
  }

  loading.hidden = true;
  refreshCategoriesFromCache();

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      refreshCategoriesFromCache();
    }
  });

  window.addEventListener('storage', function (e) {
    if (e.key === MEDIA_CATEGORIES_CACHE_KEY) {
      refreshCategoriesFromCache();
    }
  });

  var searchForm = document.getElementById('searchForm');
  var searchInput = document.getElementById('searchInput');
  if (searchForm && searchInput) {
    searchForm.addEventListener('submit', function (e) {
      e.preventDefault();
      searchTerm = (searchInput.value || '').trim();
      loadMedia(false);
    });
  }

  if (navLoadAll) {
    navLoadAll.addEventListener('click', function () {
      searchTerm = (searchInput && searchInput.value || '').trim();
      hasSearched = true;
      loadMedia(true);
    });
  }
})();
