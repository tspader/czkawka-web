import type { FC, PropsWithChildren } from "hono/jsx";

export const Layout: FC<PropsWithChildren<{ title?: string }>> = ({ title = "Czkawka", children }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title}</title>
      <link rel="icon" type="image/png" href="/favicon.ico" />
      <link rel="stylesheet" href="/static/app.css" />
      <script src="/static/htmx.min.js" />
    </head>
    <body>
      <header>
        <a href="/" class="logo">czkawka</a>
        <nav class="header-links">
          <a href="https://spader.zone/" target="_blank" rel="noopener noreferrer">blog</a>
          <span class="header-link-sep" aria-hidden="true">·</span>
          <a href="https://github.com/tspader/czkawka-web" target="_blank" rel="noopener noreferrer">github</a>
        </nav>
      </header>
      <main>{children}</main>

      <div
        id="modal"
        class="modal-scrim"
        hidden
        hx-on:click="if (event.target === this) this.hidden = true"
      >
        <div class="modal-panel">
          <div id="browser-content" />
        </div>
      </div>

      <script dangerouslySetInnerHTML={{ __html: js }} />
    </body>
  </html>
);

const js = `
function czkawkaAddRow(which) {
  var li = document.createElement('li');
  li.className = 'path-list-add';
  li.dataset.list = which;
  li.textContent = '+ Browse';
  return li;
}

function czkawkaAppendPath(which, p, opts) {
  var list = document.querySelector('ul.path-list[data-list="' + which + '"]');
  if (!list) return;
  var name = list.dataset.name;
  var existing = Array.from(list.querySelectorAll('input[type="hidden"]')).map(function (i) { return i.value; });
  if (existing.indexOf(p) === -1) {
    var li = document.createElement('li');
    li.className = 'path-list-item';
    li.draggable = true;
    var handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⋮⋮';
    handle.setAttribute('aria-hidden', 'true');
    var text = document.createElement('span');
    text.className = 'path-text';
    text.textContent = p;
    var input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = p;
    var rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'path-remove';
    rm.setAttribute('aria-label', 'Remove');
    rm.textContent = '×';
    li.appendChild(handle);
    li.appendChild(text);
    li.appendChild(input);
    li.appendChild(rm);
    list.insertBefore(li, list.querySelector('.path-list-add'));
  }
  if (opts && opts.recordRecent && window.czkawkaRecordRecentDir) {
    window.czkawkaRecordRecentDir(p);
  }
}

function czkawkaOpenBrowser(path) {
  document.getElementById('modal').hidden = false;
  window.htmx.ajax('GET', '/browse', {
    target: '#browser-content', swap: 'innerHTML', values: { path: path },
  });
}

window.czkawkaSelectDir = function (p) {
  window.czkawkaLastDir = p;
  var which = window.czkawkaBrowseTarget || 'scan';
  var editTarget = window.czkawkaEditTarget;
  window.czkawkaEditTarget = null;
  if (editTarget && editTarget.parentNode) {
    var list = editTarget.closest('.path-list');
    var ownInput = editTarget.querySelector('input[type="hidden"]');
    var dupe = Array.from(list.querySelectorAll('.path-list-item input[type="hidden"]'))
      .find(function (i) { return i.value === p && i !== ownInput; });
    if (dupe) {
      // The picked path is already in the list — drop the row being edited so we end
      // up with one entry, not two. The other row keeps its position.
      editTarget.remove();
    } else {
      editTarget.querySelector('.path-text').textContent = p;
      ownInput.value = p;
    }
    if (window.czkawkaRecordRecentDir) window.czkawkaRecordRecentDir(p);
  } else {
    czkawkaAppendPath(which, p, { recordRecent: true });
  }
  document.getElementById('modal').hidden = true;
};

(function () {
  var dragged = null;
  document.addEventListener('dragstart', function (e) {
    var li = e.target.closest && e.target.closest('.path-list-item');
    if (!li) return;
    dragged = li;
    li.classList.add('dragging');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  document.addEventListener('dragend', function () {
    if (dragged) dragged.classList.remove('dragging');
    dragged = null;
  });
  document.addEventListener('dragover', function (e) {
    if (!dragged) return;
    var list = e.target.closest && e.target.closest('.path-list');
    if (!list || !list.contains(dragged)) return;
    e.preventDefault();
    var items = Array.from(list.querySelectorAll('.path-list-item:not(.dragging)'));
    var after = null;
    for (var i = 0; i < items.length; i++) {
      var r = items[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { after = items[i]; break; }
    }
    var addRow = list.querySelector('.path-list-add');
    if (after == null) list.insertBefore(dragged, addRow);
    else list.insertBefore(dragged, after);
  });
  document.addEventListener('click', function (e) {
    var rm = e.target.closest && e.target.closest('.path-remove');
    if (rm) {
      var li = rm.closest('.path-list-item');
      if (li) li.remove();
      return;
    }
    var add = e.target.closest && e.target.closest('.path-list-add');
    if (add) {
      var addList = add.closest('.path-list');
      window.czkawkaBrowseTarget = add.dataset.list;
      window.czkawkaEditTarget = null;
      czkawkaOpenBrowser(window.czkawkaLastDir || addList.dataset.root);
      return;
    }
    var pathText = e.target.closest && e.target.closest('.path-list-item .path-text');
    if (pathText) {
      var itemLi = pathText.closest('.path-list-item');
      var itemList = itemLi.closest('.path-list');
      var current = itemLi.querySelector('input[type="hidden"]').value;
      // Open the browser one level up from the row's current path — the user is
      // most often swapping in a sibling, not diving in.
      var parent = current.replace(/\\/[^/]+\\/?$/, '') || '/';
      window.czkawkaBrowseTarget = itemList.dataset.list;
      window.czkawkaEditTarget = itemLi;
      czkawkaOpenBrowser(parent);
      return;
    }
    var edit = e.target.closest && e.target.closest('.btn-edit-toggle');
    if (edit) {
      var which = edit.dataset.list;
      var list = document.querySelector('ul.path-list[data-list="' + which + '"]');
      var ta = document.querySelector('textarea.path-list-textarea[data-list="' + which + '"]');
      var recent = document.querySelector('.btn-list-recent[data-list="' + which + '"]');
      if (!list || !ta) return;
      if (ta.hidden) {
        var paths = Array.from(list.querySelectorAll('.path-list-item input[type="hidden"]')).map(function (i) { return i.value; });
        ta.value = paths.join('\\n');
        list.hidden = true;
        ta.hidden = false;
        edit.textContent = 'List';
        if (recent) recent.hidden = true;
        ta.focus();
      } else {
        var lines = ta.value.split('\\n').map(function (s) { return s.trim(); }).filter(Boolean);
        list.innerHTML = '';
        list.appendChild(czkawkaAddRow(which));
        for (var i = 0; i < lines.length; i++) czkawkaAppendPath(which, lines[i], { recordRecent: false });
        ta.hidden = true;
        list.hidden = false;
        edit.textContent = 'Edit';
        if (recent) recent.hidden = false;
      }
    }
  });

  // While the textarea is visible it owns the source of truth — mirror its
  // contents into the list's hidden inputs on every keystroke so a form submit
  // mid-edit posts what's on screen, not the stale list from when edit opened.
  document.addEventListener('input', function (e) {
    var ta = e.target.closest && e.target.closest('.path-list-textarea');
    if (!ta || ta.hidden) return;
    var which = ta.dataset.list;
    var list = document.querySelector('ul.path-list[data-list="' + which + '"]');
    if (!list) return;
    var name = list.dataset.name;
    var lines = ta.value.split('\\n').map(function (s) { return s.trim(); }).filter(Boolean);
    var seen = {};
    list.innerHTML = '';
    for (var i = 0; i < lines.length; i++) {
      if (seen[lines[i]]) continue;
      seen[lines[i]] = 1;
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = lines[i];
      list.appendChild(input);
    }
  });
})();

(function () {
  function sync() {
    var btn = document.getElementById('scan-submit');
    if (!btn) return;
    btn.disabled = !!document.getElementById('scan-status');
  }
  document.addEventListener('htmx:afterSwap', sync);
  document.addEventListener('DOMContentLoaded', sync);
  sync();
})();

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
  var ta = e.target.closest && e.target.closest('.path-list-textarea');
  if (!ta) return;
  e.preventDefault();
  var toggle = document.querySelector('.btn-edit-toggle[data-list="' + ta.dataset.list + '"]');
  if (toggle) toggle.click();
});

(function () {
  var KEY = 'czkawkaRecentDirs';
  var MAX = 100;
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function save(data) {
    var keys = Object.keys(data);
    keys.sort(function (a, b) { return data[b] - data[a]; });
    if (keys.length > MAX) keys = keys.slice(0, MAX);
    var trimmed = {};
    for (var i = 0; i < keys.length; i++) trimmed[keys[i]] = data[keys[i]];
    try { localStorage.setItem(KEY, JSON.stringify(trimmed)); } catch (e) {}
  }
  window.czkawkaRecordRecentDir = function (p) {
    if (!p) return;
    var data = load();
    data[p] = Date.now();
    save(data);
  };
  function relTime(ms) {
    var d = Math.max(0, Date.now() - ms);
    var s = Math.floor(d / 1000);
    if (s < 60) return 'just now';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    var dd = Math.floor(h / 24);
    return dd + 'd ago';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }
  window.czkawkaOpenRecent = function (which) {
    window.czkawkaBrowseTarget = which;
    var data = load();
    var entries = Object.keys(data).map(function (k) { return { path: k, mtime: data[k] }; });
    entries.sort(function (a, b) { return b.mtime - a.mtime; });
    var rows = entries.length === 0
      ? '<li class="dir-message">No recent directories yet.</li>'
      : entries.map(function (e) {
          return '<li class="dir-entry recent-entry" data-path="' + esc(e.path) +
            '"><span class="recent-path">' + esc(e.path) +
            '</span><span class="recent-time">' + relTime(e.mtime) + '</span></li>';
        }).join('');
    var content = document.getElementById('browser-content');
    content.innerHTML =
      '<div class="modal-header">' +
        '<span class="modal-current-path" style="flex:1;color:#bbb">Recent directories</span>' +
        '<button class="modal-close recent-close" type="button" aria-label="Close">✕</button>' +
      '</div>' +
      '<ul class="dir-list">' + rows + '</ul>';
    document.getElementById('modal').hidden = false;
  };
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.btn-list-recent');
    if (btn) { window.czkawkaOpenRecent(btn.dataset.list); return; }
    var entry = e.target.closest && e.target.closest('.recent-entry');
    if (entry) { window.czkawkaSelectDir(entry.dataset.path); return; }
    var close = e.target.closest && e.target.closest('.recent-close');
    if (close) { document.getElementById('modal').hidden = true; return; }
  });
})();
`.trim();

