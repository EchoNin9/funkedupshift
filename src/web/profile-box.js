/**
 * Profile box: square box in top-right (same width as theme toggle), shows user avatar or default.
 * Clicking goes to profile.html. Only visible when logged in.
 */
(function () {
  var DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236b7280'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E";

  function fetchWithAuth(url) {
    return new Promise(function (resolve, reject) {
      if (!window.auth || !window.auth.getAccessToken) {
        reject(new Error("Not signed in"));
        return;
      }
      window.auth.getAccessToken(function (token) {
        var headers = {};
        if (token) headers["Authorization"] = "Bearer " + token;
        fetch(url, { headers: headers }).then(resolve).catch(reject);
      });
    });
  }

  function injectStyles() {
    if (document.getElementById("profile-box-styles")) return;
    var style = document.createElement("style");
    style.id = "profile-box-styles";
    style.textContent =
      ".top-right-controls{position:fixed;top:1rem;right:1rem;z-index:10000;display:flex;flex-direction:row;align-items:center;gap:0.5rem;}" +
      ".top-right-controls .theme-toggle{position:static;}" +
      ".profile-box{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;" +
      "width:2.75rem;height:2.75rem;background:rgba(0,0,0,0.7);color:#fff;border:none;border-radius:0.35rem;" +
      "cursor:pointer;text-decoration:none;overflow:hidden;flex-shrink:0;}" +
      ".profile-box:hover{background:rgba(0,0,0,0.85);}" +
      ".profile-box img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;}" +
      ".profile-box .profile-label{position:relative;z-index:1;font-size:0.5rem;line-height:1;padding:0.15rem 0;text-transform:uppercase;letter-spacing:0.05em;background:rgba(0,0,0,0.6);width:100%;text-align:center;}" +
      ".theme-dark .profile-box{background:rgba(255,255,255,0.15);}" +
      ".theme-dark .profile-box:hover{background:rgba(255,255,255,0.25);}" +
      ".theme-dark .profile-box .profile-label{color:#f5f5f5;}";
    document.head.appendChild(style);
  }

  function createProfileBox(avatarUrl) {
    var a = document.createElement("a");
    a.href = "profile.html";
    a.className = "profile-box";
    a.setAttribute("aria-label", "Profile");
    a.style.position = "relative";
    var img = document.createElement("img");
    img.src = avatarUrl || DEFAULT_AVATAR;
    img.alt = "";
    a.appendChild(img);
    var label = document.createElement("span");
    label.className = "profile-label";
    label.textContent = "profile";
    a.appendChild(label);
    return a;
  }

  function ensureWrapper() {
    var toggle = document.getElementById("themeToggle");
    if (!toggle) return null;
    var existing = document.querySelector(".top-right-controls");
    if (existing) return existing;
    injectStyles();
    var wrapper = document.createElement("div");
    wrapper.className = "top-right-controls";
    toggle.parentNode.insertBefore(wrapper, toggle);
    wrapper.appendChild(toggle);
    return wrapper;
  }

  function updateProfileBox() {
    var wrapper = ensureWrapper();
    if (!wrapper) return;

    var existingBox = wrapper.querySelector(".profile-box");
    if (existingBox) existingBox.remove();

    if (!window.auth) return;
    window.auth.isAuthenticated(function (isAuth) {
      if (!isAuth) return;

      var box = createProfileBox(null);
      wrapper.insertBefore(box, wrapper.firstChild);

      var base = (window.API_BASE_URL || "").replace(/\/$/, "");
      if (!base) {
        box.querySelector("img").src = DEFAULT_AVATAR;
        return;
      }
      fetchWithAuth(base + "/profile")
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (data) {
          var url = data && data.profile && data.profile.avatarUrl;
          var img = box.querySelector("img");
          if (url) {
            img.src = url;
          } else {
            img.src = DEFAULT_AVATAR;
          }
        })
        .catch(function () {
          box.querySelector("img").src = DEFAULT_AVATAR;
        });
    });
  }

  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", updateProfileBox);
    } else {
      updateProfileBox();
    }
  }

  init();
  window.profileBoxRefresh = updateProfileBox;
})();
