// Voice typing: adds a mic button to the bottom-left of every text box. Tap to record, tap again to stop;
// the audio is transcribed by ElevenLabs (POST /api/transcribe) and inserted where the cursor was.
// Opt a field out with data-nodictate (on the field or any ancestor).
(() => {
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) return;
  const MAX_MS = 120000;
  const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  const SKIP_INPUT_TYPES = /^(text|)$/i; // only plain text inputs; emails, numbers, dates etc. are not dictated

  const style = document.createElement('style');
  style.textContent = `
.dict-wrap { position: relative; display: flow-root; }
.dict-wrap.dict-flex { flex: 1 1 auto; min-width: 0; }
.dict-wrap > textarea, .dict-wrap > input { display: block; }
.dict-wrap > textarea.dict-field { padding-bottom: 2.75rem; }
.dict-wrap > input.dict-field { padding-right: 3rem; }
.dict-wrap > input.dict-field ~ .dict-btn { bottom: 7px; }
.dict-wrap > button.dict-btn { position: absolute; right: 6px; bottom: 6px; z-index: 2; box-sizing: border-box; width: 2rem; height: 2rem; min-width: 2rem; min-height: 2rem; max-height: 2rem; padding: 0; margin: 0; gap: 0; border-radius: 0; flex: none;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: none; text-transform: none;
  background: transparent; color: var(--primary, #0055a5); border: 0; }
.dict-wrap > button.dict-btn:hover { background: transparent; color: var(--primary-text, #003d75); opacity: .75; }
.dict-wrap > button.dict-btn:focus-visible { outline: 3px solid var(--focus, #0055a5); outline-offset: 2px; }
.dict-wrap > button.dict-btn svg { width: 1.05rem; height: 1.05rem; pointer-events: none; }
.dict-wrap > button.dict-btn.rec { border-radius: 50%; background: var(--err, #b42318); border-color: var(--err, #b42318); color: #fff; animation: dict-pulse 1.2s ease-out infinite; }
.dict-btn.busy { cursor: progress; opacity: .7; }
.dict-wrap.is-rec > .dict-field { border-color: var(--err, #b42318); box-shadow: 0 0 0 2px var(--err-soft, #fdeceb); }
.dict-status { position: absolute; right: 2.75rem; bottom: .6rem; z-index: 2; display: none; max-width: calc(100% - 3.5rem); font-size: .8125rem; font-weight: 600; line-height: 1.2;
  color: var(--ink, #1a1a1a); pointer-events: none; }
.dict-status.show { display: inline-flex; align-items: center; gap: .4rem; }
.dict-status.err { color: var(--err, #b42318); }
.dict-wrap > input.dict-field ~ .dict-status { bottom: calc(100% + 2px); left: 0; right: auto; padding: .1rem .45rem; background: var(--surface, #fff); border: 1px solid var(--line-strong, #8a8a8a); }
.dict-dot { width: .6rem; height: .6rem; border-radius: 50%; background: var(--err, #b42318); flex: none; }
.dict-status.rec .dict-dot { animation: dict-blink 1s steps(2, start) infinite; }
@keyframes dict-pulse { 0% { box-shadow: 0 0 0 0 rgba(180,35,24,.55); } 100% { box-shadow: 0 0 0 .7rem rgba(180,35,24,0); } }
@keyframes dict-blink { to { visibility: hidden; } }
@media (prefers-reduced-motion: reduce) { .dict-btn.rec, .dict-status.rec .dict-dot { animation: none; } }`;
  document.head.appendChild(style);

  const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  const STOP = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

  let active = null; // the one recording in progress: { cancel(), stop() }
  const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

  function labelFor(el) {
    const l = el.labels?.[0]?.childNodes ? [...el.labels[0].childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim() : '';
    return el.getAttribute('aria-label') || l || el.placeholder || 'this field';
  }

  function insertText(el, text) {
    if (el.maxLength > 0) text = text.slice(0, Math.max(0, el.maxLength - el.value.length));
    if (!text) return;
    const v = el.value;
    const a = el.selectionStart ?? v.length, b = el.selectionEnd ?? v.length;
    const before = v.slice(0, a), after = v.slice(b);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const trail = after && !/^\s/.test(after) ? ' ' : '';
    el.value = before + lead + text + trail + after;
    const pos = (before + lead + text).length;
    try { el.setSelectionRange(pos, pos); } catch { /* not supported for this type */ }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus({ preventScroll: true });
  }

  function attach(el) {
    el.dataset.dictate = '1';
    const parentDisplay = getComputedStyle(el.parentElement).display;
    const wrap = document.createElement('span');
    wrap.className = 'dict-wrap' + (/flex|grid/.test(parentDisplay) ? ' dict-flex' : '');
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
    el.classList.add('dict-field');

    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'dict-btn'; btn.innerHTML = MIC;
    btn.title = 'Dictate with your voice';
    btn.setAttribute('aria-label', `Dictate into ${labelFor(el)}`);
    btn.setAttribute('aria-pressed', 'false');
    const status = document.createElement('span');
    status.className = 'dict-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    wrap.append(btn, status);

    let hideTimer;
    const say = (html, cls = '', ms = 0) => {
      clearTimeout(hideTimer);
      status.className = 'dict-status show ' + cls; status.innerHTML = html;
      if (ms) hideTimer = setTimeout(() => { status.className = 'dict-status'; }, ms);
    };
    const quiet = () => { clearTimeout(hideTimer); status.className = 'dict-status'; };
    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

    async function start() {
      if (active) active.cancel();
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch { return say('Microphone blocked. Allow access in your browser to dictate.', 'err', 5000); }
      const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      const t0 = Date.now();
      let discard = false, tick, auto;
      const release = () => { clearInterval(tick); clearTimeout(auto); stream.getTracks().forEach((t) => t.stop()); active = null; wrap.classList.remove('is-rec'); btn.classList.remove('rec'); btn.innerHTML = MIC; btn.setAttribute('aria-pressed', 'false'); };

      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = async () => {
        release();
        if (discard) return quiet();
        if (!chunks.length) return say('Nothing was recorded.', 'err', 4000);
        btn.classList.add('busy'); btn.disabled = true;
        say('Transcribing…');
        try {
          const fd = new FormData();
          fd.append('audio', new Blob(chunks, { type: mr.mimeType || mimeType || 'audio/webm' }), 'dictation.webm');
          const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
          if (r.status === 401) { location.href = '/login.html'; return; }
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || 'Could not transcribe that.');
          if (!d.text) return say('We could not hear anything. Try again.', 'err', 4000);
          insertText(el, d.text);
          quiet();
        } catch (e) { say(esc(e.message || 'Could not transcribe that.'), 'err', 6000); }
        finally { btn.classList.remove('busy'); btn.disabled = false; }
      };

      active = { stop: () => mr.state === 'recording' && mr.stop(), cancel: () => { discard = true; if (mr.state === 'recording') mr.stop(); else release(); } };
      mr.start();
      wrap.classList.add('is-rec'); btn.classList.add('rec'); btn.innerHTML = STOP; btn.setAttribute('aria-pressed', 'true');
      const show = () => say(`<span class="dict-dot"></span>Recording ${mmss(Date.now() - t0)} &middot; tap to stop`, 'rec');
      show(); tick = setInterval(show, 500);
      auto = setTimeout(() => active?.stop(), MAX_MS);
    }

    btn.onclick = () => { if (btn.classList.contains('rec')) active?.stop(); else start(); };
  }

  const eligible = (el) => {
    if (el.dataset.dictate || el.disabled || el.readOnly || el.closest('[data-nodictate]') || !el.parentElement) return false;
    if (el.tagName === 'INPUT') {
      if (!SKIP_INPUT_TYPES.test(el.getAttribute('type') || '') || el.hasAttribute('list')) return false;
      if (/email|tel|phone|url|zip|postal|code|pass/i.test(`${el.name} ${el.id} ${el.autocomplete}`)) return false;
    }
    return true;
  };

  let scheduled = false;
  const scan = () => {
    scheduled = false;
    document.querySelectorAll('textarea, input').forEach((el) => { if (eligible(el)) attach(el); });
  };
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(scan); } };

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && active) active.cancel(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && active) active.stop(); });

  fetch('/api/transcribe').then((r) => (r.ok ? r.json() : { enabled: false })).catch(() => ({ enabled: false })).then((s) => {
    if (!s.enabled) return;
    scan();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  });
})();
