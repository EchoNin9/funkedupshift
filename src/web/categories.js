(function () {
  var base = (window.API_BASE_URL || '').replace(/\/$/, '');
  var messageEl = document.getElementById('message');
  var formWrap = document.getElementById('formWrap');
  var createCategoryForm = document.getElementById('createCategoryForm');
  var createResult = document.getElementById('createResult');
  var categoryList = document.getElementById('categoryList');
  var PAGE_SIZE = 10;
  var currentCategoryPage = 1;
  var allCategoriesData = [];

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

  function renderCategoryRow(c) {
    var id = c.PK || c.id || '';
    var name = c.name || 'Untitled';
    var desc = c.description ? '<span class="category-desc">' + escapeHtml(c.description) + '</span>' : '';
    return '<li data-id="' + escapeHtml(id) + '">' +
      '<span class="category-name">' + escapeHtml(name) + '</span>' + desc +
      ' <button type="button" class="secondary edit-cat">Edit</button>' +
      ' <button type="button" class="danger delete-cat">Delete</button>' +
      '</li>';
  }

  function attachCategoryHandlers() {
    Array.prototype.forEach.call(document.querySelectorAll('.edit-cat'), function (btn) {
            btn.addEventListener('click', function () {
              var li = this.closest('li');
              var id = li && li.getAttribute('data-id');
              var nameEl = li && li.querySelector('.category-name');
              var descEl = li && li.querySelector('.category-desc');
              var currentName = nameEl ? nameEl.textContent : '';
              var currentDesc = descEl ? descEl.textContent : '';
              var newName = window.prompt('Edit name:', currentName);
              if (newName === null) return;
              var newDesc = window.prompt('Edit description:', currentDesc);
              if (newDesc === null) return;
              fetchWithAuth(base + '/categories', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id, name: newName, description: newDesc })
              }).then(function (r) {
                if (r.ok) return loadCategories(); // refetch to refresh list
                return r.text().then(function (t) { throw new Error(t || 'Failed'); });
              }).catch(function (e) {
                alert('Update failed: ' + e.message);
              });
            });
          });

    Array.prototype.forEach.call(document.querySelectorAll('.delete-cat'), function (btn) {
      btn.addEventListener('click', function () {
        var li = this.closest('li');
        var id = li && li.getAttribute('data-id');
        if (!id || !window.confirm('Delete this category?')) return;
        fetchWithAuth(base + '/categories?id=' + encodeURIComponent(id), { method: 'DELETE' })
          .then(function (r) {
            if (r.ok) return loadCategories();
            return r.text().then(function (t) { throw new Error(t || 'Failed'); });
          })
          .catch(function (e) {
            alert('Delete failed: ' + e.message);
          });
      });
    });
  }

  function renderCategoryPage() {
    var total = allCategoriesData.length;
    if (total === 0) {
      categoryList.innerHTML = '<li>No categories yet.</li>';
      document.getElementById('categoryPagination').hidden = true;
      return;
    }
    var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentCategoryPage > totalPages) currentCategoryPage = totalPages;
    var start = (currentCategoryPage - 1) * PAGE_SIZE;
    var pageCats = allCategoriesData.slice(start, start + PAGE_SIZE);
    categoryList.innerHTML = pageCats.map(renderCategoryRow).join('');
    attachCategoryHandlers();

    var pagEl = document.getElementById('categoryPagination');
    pagEl.hidden = false;
    pagEl.innerHTML = '<button type="button" class="secondary" id="catPrev">Prev</button><span>Page ' + currentCategoryPage + ' of ' + totalPages + '</span><button type="button" class="secondary" id="catNext">Next</button>';
    document.getElementById('catPrev').disabled = currentCategoryPage <= 1;
    document.getElementById('catNext').disabled = currentCategoryPage >= totalPages;
    document.getElementById('catPrev').onclick = function () { if (currentCategoryPage > 1) { currentCategoryPage--; renderCategoryPage(); } };
    document.getElementById('catNext').onclick = function () { if (currentCategoryPage < totalPages) { currentCategoryPage++; renderCategoryPage(); } };
  }

  function loadCategories() {
    fetchWithAuth(base + '/categories')
      .then(function (r) { return r.ok ? r.json() : r.text().then(function (t) { throw new Error(t || 'Failed'); }); })
      .then(function (data) {
        allCategoriesData = data.categories || [];
        currentCategoryPage = 1;
        renderCategoryPage();
      })
      .catch(function (e) {
        categoryList.innerHTML = '<li>Failed to load: ' + escapeHtml(e.message) + '</li>';
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
        var isAdmin = Array.isArray(groups) && groups.indexOf('admin') !== -1;
        if (!isAdmin) {
          showMessage('Admin access required.', true);
          return;
        }
        formWrap.hidden = false;
        loadCategories();
      })
      .catch(function () {
        showMessage('Could not verify admin access.', true);
      });
  });

  if (createCategoryForm) {
    createCategoryForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = document.getElementById('categoryName').value.trim();
      var description = document.getElementById('categoryDescription').value.trim();
      if (!name) {
        createResult.textContent = 'Name is required';
        createResult.className = 'status err';
        return;
      }
      createResult.textContent = 'Adding...';
      createResult.className = 'status';
      createResult.hidden = false;

      fetchWithAuth(base + '/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, description: description })
      })
        .then(function (r) {
          if (r.ok) return r.json();
          return r.text().then(function (t) { throw new Error(t || 'Failed'); });
        })
        .then(function () {
          createResult.textContent = 'Category added.';
          createResult.className = 'status ok';
          document.getElementById('categoryName').value = '';
          document.getElementById('categoryDescription').value = '';
          loadCategories(); // refetch to include new category
        })
        .catch(function (e) {
          createResult.textContent = 'Error: ' + e.message;
          createResult.className = 'status err';
        });
    });
  }
})();
