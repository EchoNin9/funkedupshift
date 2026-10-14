const { chromium } = require('playwright');
const fs = require('fs');
const OUT = __dirname + '/qa';
const BASE = 'http://127.0.0.1:4173';
const API = 'https://api.stub';
const personas = {
  guest: null,
  user: { userId: 'u1', email: 'ursula.user@example.com', groups: ['user'], customGroups: [] },
  member: { userId: 'u2', email: 'mel.member@example.com', groups: ['user'], customGroups: ['Memes'] },
  admin: { userId: 'u3', email: 'ada.admin@example.com', groups: ['admin'], customGroups: [] },
};
const memes = [1,2,3].map(i => ({ PK: 'MEME#'+i, title: 'Meme '+i, tags: ['t'], imageUrl: '', stars: 4, createdAt: '2026-01-0'+i }));
const pages = [
  ['home', '/'], ['website', '/websites'], ['apps-tools', '/apps/tools'], ['shortener', '/shortener'],
  ['crop', '/crop'], ['memes', '/memes'], ['admin-themes', '/admin/themes'],
];
const widths = { desktop: [1280, 800], m375: [375, 812], m320: [320, 640] };
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
  const results = [];
  for (const [pname, persona] of Object.entries(personas)) {
    for (const mode of ['dark', 'light']) {
      for (const [wname, [w, h]] of Object.entries(widths)) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
        await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body:
          `window.API_BASE_URL='${API}';window.COGNITO_USER_POOL_ID='x';window.COGNITO_CLIENT_ID='y';` +
          (persona ? `window.auth={isAuthenticated:function(cb){cb(true)},getAccessToken:function(cb){cb('tok')},signOut:function(){}};` : `window.auth={isAuthenticated:function(cb){cb(false)},getAccessToken:function(cb){cb(null)},signOut:function(){}};`) }));
        await ctx.route('**/auth.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
        await ctx.route('**/amazon-cognito-identity.min.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
        await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
        await ctx.route(API + '/**', r => {
          const u = new URL(r.request().url()); const p = u.pathname;
          const j = b => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
          if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
          if (p === '/me') return persona ? j(persona) : r.fulfill({ status: 401, headers: { 'access-control-allow-origin': '*' }, body: '{}' });
          if (p === '/profile') return j({ profile: { pins: [], themeId: '', mode: '' } });
          if (p === '/s') return j({ items: [{ code: 'abc123', url: 'https://example.com/a/very/long/path', shortUrl: 'https://f.us/abc123', createdAt: '2026-10-01T00:00:00Z', expiresAt: 1893456000 }], nextCursor: null });
          if (p === '/memes' || p === '/memes/cache') return j({ memes });
          if (p === '/memes/tags') return j({ tags: ['t'] });
          if (p === '/themes') return j({ themes: [], defaultThemeId: 'funk' });
          if (p === '/site-settings') return j({ defaultThemeId: 'funk', defaultMode: 'dark' });
          return j({});
        });
        await ctx.addInitScript(m => { try { localStorage.setItem('funkedupshift_theme', m); } catch (e) {} }, mode);
        for (const [name, path] of pages) {
          const page = await ctx.newPage();
          const errs = [];
          page.on('pageerror', e => errs.push('pageerror: ' + e.message));
          page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
          await page.goto(BASE + path, { waitUntil: 'load' });
          await page.waitForTimeout(900);
          const info = await page.evaluate(() => ({
            theme: document.documentElement.getAttribute('data-theme'),
            sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
            url: location.pathname, h1: (document.querySelector('h1') || {}).textContent || '',
          }));
          const tag = `${pname}-${mode}-${wname}-${name}`;
          if (wname !== 'm320' || name === 'home') await page.screenshot({ path: `${OUT}/${tag}.png` });
          results.push({ tag, ...info, overflow: info.sw > info.cw, errs });
          // overlays
          if (name === 'home') {
            if (w > 640) {
              await page.click('button[aria-label="Open apps"]').catch(() => {});
            } else {
              await page.click('nav.tabbar >> text=Apps').catch(() => {});
            }
            await page.waitForTimeout(500);
            if (wname !== 'm320') await page.screenshot({ path: `${OUT}/${tag}-launcher.png` });
            await page.keyboard.press('Escape'); await page.waitForTimeout(300);
            if (persona) {
              if (w > 640) await page.click('button[aria-label="Account menu"]').catch(() => {});
              else await page.click('nav.tabbar >> text=Account').catch(() => {});
              await page.waitForTimeout(500);
              if (wname !== 'm320') await page.screenshot({ path: `${OUT}/${tag}-account.png` });
            }
          }
          await page.close();
        }
        await ctx.close();
      }
    }
  }
  fs.writeFileSync(OUT + '/results.json', JSON.stringify(results, null, 1));
  await browser.close();
  const bad = results.filter(r => r.overflow || r.errs.length);
  console.log('cells', results.length, 'flagged', bad.length);
  bad.forEach(b => console.log(b.tag, b.overflow ? `OVERFLOW ${b.sw}>${b.cw}` : '', b.errs.slice(0, 2).join(' | ')));
})();
