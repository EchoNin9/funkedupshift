/* Neon Pop shared chrome — FUNK-3
   One place that renders identical nav + marquee + footer + background + theme
   toggle on every page. Include after config.js/auth.js:
     <link rel="stylesheet" href="pop.css">
     <script src="pop-chrome.js"></script>
   Reuses the existing .auth-link convention (auth-button.js) and the /me role
   check used elsewhere for admin gating. */
(function () {
  // ---- theme: apply before paint, default dark ----
  var THEME_KEY = 'funkedupshift_theme';
  function currentTheme() {
    try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; }
    catch (e) { return 'dark'; }
  }
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
  }
  applyTheme(currentTheme());

  // ---- banner: default string; FUNK-11 overrides via window.popSetBanner ----
  window.POP_BANNER_DEFAULT =
    'EXPENSES ✦ FINANCE ✦ MERCH ✦ MEDIA ✦ SQUASH ✦ DASHBOARD ✦ CATALOG';

  var NAV = [
    { label: 'Browse', href: 'websites.html', match: ['websites.html', 'add-site.html', 'edit-site.html'] },
    { label: 'Media',  href: 'media.html',    match: ['media.html', 'add-media.html', 'edit-media.html', 'media-view.html'] },
    { label: 'Add',    href: 'add-site.html', match: [] },
    { label: 'Sign in', href: 'auth.html',    match: ['auth.html'], authLink: true },
    { label: 'Admin',  href: 'users.html',    match: ['users.html', 'categories.html', 'groups.html', 'media-categories.html', 'edit-user.html'], admin: true }
  ];

  function pageName() {
    var p = (location.pathname.split('/').pop() || 'index.html');
    return p || 'index.html';
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function renderMarquee(value) {
    var text = (value && value.trim()) || window.POP_BANNER_DEFAULT;
    var items = text.split('✦').map(function (s) { return s.trim(); }).filter(Boolean);
    // duplicate the set so translateX(-50%) loops seamlessly
    var html = '';
    for (var copy = 0; copy < 2; copy++) {
      items.forEach(function (it) {
        html += '<span class="pop-marquee__item">' + escapeHtml(it) + ' ✦</span>';
      });
    }
    return '<div class="pop-marquee__track" aria-hidden="true">' + html + '</div>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // expose so FUNK-11 / admin editor can refresh every marquee in place
  window.popSetBanner = function (value) {
    document.querySelectorAll('.pop-marquee').forEach(function (m) {
      m.innerHTML = renderMarquee(value);
    });
  };

  function build() {
    var here = pageName();
    document.body.classList.add('pop');

    // background ambiance (behind everything)
    var bg = el('div', 'pop-bg');
    bg.innerHTML = '<div class="pop-blob pop-blob--1"></div>' +
                   '<div class="pop-blob pop-blob--2"></div>' +
                   '<div class="pop-blob pop-blob--3"></div>';
    document.body.insertBefore(el('div', 'pop-halftone'), document.body.firstChild);
    document.body.insertBefore(bg, document.body.firstChild);

    // nav
    var nav = el('nav', 'pop-nav');
    var brand = '<a class="pop-brand" href="index.html">' +
      '<span class="pop-brand__dot pop-pulse"></span><span class="pop-brand__name">FUS</span></a>';
    var btns = NAV.map(function (item) {
      var active = item.match.indexOf(here) !== -1 ? ' is-active' : '';
      var cls = 'pop-nav-btn' + active + (item.authLink ? ' auth-link' : '');
      var hidden = item.admin ? ' style="display:none"' : '';
      var id = item.admin ? ' id="popAdminLink"' : '';
      return '<a class="' + cls + '"' + id + hidden + ' href="' + item.href + '">' + item.label + '</a>';
    }).join('');
    var toggle = '<button class="pop-theme-toggle" id="popThemeToggle" type="button" aria-label="Toggle light/dark">' +
      '<span id="popThemeIcon"></span><span id="popThemeLabel"></span></button>';
    nav.innerHTML =
      '<div class="pop-nav__inner">' +
        '<div class="pop-nav__brand">' + brand + '</div>' +
        '<div class="pop-nav__center">' + btns + '</div>' +
        '<div class="pop-nav__right">' + toggle + '</div>' +
      '</div>';

    // marquee under nav
    var marquee = el('div', 'pop-marquee');
    marquee.innerHTML = renderMarquee();

    var header = el('div', 'pop-chrome-top');
    header.appendChild(nav);
    header.appendChild(marquee);
    document.body.insertBefore(header, document.body.firstChild);

    // footer
    var footer = el('footer', 'pop-footer');
    footer.innerHTML =
      '<div class="pop-footer__inner pop-wrap">' +
        '<span>© 2026 FUNKEDUPSHIFT</span>' +
        '<nav class="pop-footer__links">' +
          '<a href="websites.html">Browse</a>' +
          '<a href="media.html">Media</a>' +
          '<a href="add-site.html">Add</a>' +
          '<a class="auth-link" href="auth.html">Sign in</a>' +
        '</nav>' +
      '</div>';
    document.body.appendChild(footer);

    wireTheme();
    gateAdmin();
  }

  function wireTheme() {
    var btn = document.getElementById('popThemeToggle');
    var icon = document.getElementById('popThemeIcon');
    var label = document.getElementById('popThemeLabel');
    function paint() {
      var dark = currentTheme() === 'dark';
      icon.textContent = dark ? '☀' : '☾';
      label.textContent = dark ? 'Light' : 'Dark';
    }
    paint();
    btn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      applyTheme(next);
      paint();
    });
  }

  // Admin link visible only to admin/manager — same /me check used elsewhere.
  function gateAdmin() {
    var link = document.getElementById('popAdminLink');
    if (!link || !window.auth) return;
    window.auth.isAuthenticated(function (isAuth) {
      if (!isAuth) return;
      var base = (window.API_BASE_URL || '').replace(/\/$/, '');
      if (!base) return;
      window.auth.getAccessToken(function (token) {
        fetch(base + '/me', { headers: token ? { Authorization: 'Bearer ' + token } : {} })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (user) {
            var groups = (user && user.groups) || [];
            if (groups.indexOf('admin') !== -1 || groups.indexOf('manager') !== -1) {
              link.style.display = '';
            }
          })
          .catch(function () {});
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
