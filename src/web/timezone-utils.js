/**
 * Last login timezone formatting and dropdown.
 * Format: "YYYY-MM-DD HH:mm UTC±N" (e.g. "2025-02-08 11:30 UTC-8").
 */
(function () {
  var STORAGE_KEY = "funkedupshift_lastlogin_tz";
  var TZ_OPTIONS = [
    { value: -8, label: "UTC-8" },
    { value: -5, label: "UTC-5" },
    { value: 0, label: "UTC+0/GMT" },
  ];

  function getStored() {
    try {
      var v = parseInt(sessionStorage.getItem(STORAGE_KEY), 10);
      if (!isNaN(v) && TZ_OPTIONS.some(function (o) { return o.value === v; })) {
        return v;
      }
    } catch (e) {}
    return -8;
  }

  function setStored(val) {
    try {
      sessionStorage.setItem(STORAGE_KEY, String(val));
    } catch (e) {}
  }

  function pad(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function formatLastLoginDisplay(isoString, offsetHours, ip) {
    if (!isoString) return { text: "", hasTime: false };
    try {
      var d = new Date(isoString);
      if (isNaN(d.getTime())) return { text: isoString, hasTime: false };
      var t = d.getTime() + (offsetHours || 0) * 3600000;
      var disp = new Date(t);
      var y = disp.getUTCFullYear();
      var m = pad(disp.getUTCMonth() + 1);
      var day = pad(disp.getUTCDate());
      var h = pad(disp.getUTCHours());
      var min = pad(disp.getUTCMinutes());
      var opt = TZ_OPTIONS.find(function (o) { return o.value === offsetHours; });
      var label = opt ? opt.label : (offsetHours < 0 ? "UTC" + offsetHours : "UTC+" + offsetHours);
      var text = y + "-" + m + "-" + day + " " + h + ":" + min + " " + label;
      if (ip) text += " from " + ip;
      return { text: text, hasTime: true };
    } catch (e) {
      return { text: isoString, hasTime: false };
    }
  }

  function initTimezoneSelect(selectId, onChange) {
    var sel = document.getElementById(selectId);
    if (!sel) return;
    var current = getStored();
    TZ_OPTIONS.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      opt.selected = o.value === current;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", function () {
      var v = parseInt(sel.value, 10);
      setStored(v);
      if (onChange) onChange(v);
    });
  }

  window.lastLoginTz = {
    getOffset: getStored,
    setOffset: setStored,
    format: formatLastLoginDisplay,
    initSelect: initTimezoneSelect,
    options: TZ_OPTIONS,
  };
})();
