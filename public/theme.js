// Appearance preference: "system" | "light" | "dark", saved in this browser only.
// Runs in <head> so the right theme is set before first paint (no flash).
(function () {
  var KEY = 'bc-theme', root = document.documentElement;
  var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function get() { try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch (e) { return 'system'; } }
  function apply() { var p = get(); root.setAttribute('data-theme', p === 'system' ? (mq && mq.matches ? 'dark' : 'light') : p); }
  function set(p) { try { if (p === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, p); } catch (e) {} apply(); }
  apply();
  window.bcTheme = { get: get, set: set };
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (get() === 'system') apply(); });

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('profileBtn'), pop = document.getElementById('profileMenu');
    if (!btn || !pop) return;
    var radios = pop.querySelectorAll('input[name=theme]');
    radios.forEach(function (r) { r.checked = r.value === get(); r.addEventListener('change', function () { if (r.checked) set(r.value); }); });
    function open(o) { pop.hidden = !o; btn.setAttribute('aria-expanded', String(o)); if (o) { var c = pop.querySelector('input:checked'); if (c) c.focus(); } }
    btn.addEventListener('click', function () { open(pop.hidden); });
    document.addEventListener('click', function (e) { if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) open(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) { open(false); btn.focus(); } });
  });
})();
