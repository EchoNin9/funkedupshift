// Handoff copy: loads ../styles.css so the prototype opens standalone.
(() => {
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = '../styles.css';
  document.head.appendChild(l);
})();
