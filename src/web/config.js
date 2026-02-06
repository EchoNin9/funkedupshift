// Set by CI from terraform outputs; override for local dev.
window.API_BASE_URL = '';
window.COGNITO_USER_POOL_ID = '';
window.COGNITO_CLIENT_ID = '';

// Categories cache (localStorage) – populated from categories.html, used by index.html group-by
window.CATEGORIES_CACHE_KEY = 'funkedupshift_categories';
window.saveCategoriesToCache = function (cats) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!cats || !Array.isArray(cats)) return;
    var list = cats.map(function (c) { return { id: c.PK || c.id || '', name: c.name || c.PK || c.id || '' }; });
    localStorage.setItem(window.CATEGORIES_CACHE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('saveCategoriesToCache error:', e);
  }
};
window.getCategoriesFromCache = function () {
  try {
    var raw = localStorage.getItem(window.CATEGORIES_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
};
