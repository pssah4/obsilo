/* Obsilo Docs — Client-side BM25 Search */
(function () {
  'use strict';

  var INDEX_URL = 'assets/search-index.json';
  var index = null;       // loaded lazily
  var modal = null;       // DOM ref
  var input = null;
  var results = null;
  var debounceTimer = null;

  /* ── BM25 parameters ── */
  var k1 = 1.5;
  var b  = 0.75;

  /* ── Tokeniser ── */
  function tokenize(text) {
    return text.toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  }

  /* ── Build inverted index + stats ── */
  function buildBM25(docs) {
    var avgDl = 0;
    var N = docs.length;
    var docTokens = [];       // per-doc token arrays
    var df = {};              // document frequency per term

    for (var i = 0; i < N; i++) {
      var tokens = tokenize(docs[i].title + ' ' + docs[i].title + ' ' + docs[i].sections.join(' ') + ' ' + docs[i].content);
      docTokens.push(tokens);
      avgDl += tokens.length;
      var seen = {};
      for (var j = 0; j < tokens.length; j++) {
        var t = tokens[j];
        if (!seen[t]) { seen[t] = true; df[t] = (df[t] || 0) + 1; }
      }
    }
    avgDl /= N || 1;

    return { N: N, avgDl: avgDl, docTokens: docTokens, df: df };
  }

  /* ── Score one document ── */
  function scoreBM25(bm, docIdx, queryTokens) {
    var tokens = bm.docTokens[docIdx];
    var dl = tokens.length;
    var tf = {};
    for (var i = 0; i < tokens.length; i++) {
      tf[tokens[i]] = (tf[tokens[i]] || 0) + 1;
    }

    var score = 0;
    for (var q = 0; q < queryTokens.length; q++) {
      var term = queryTokens[q];
      var freq = tf[term] || 0;
      if (freq === 0) continue;
      var dfVal = bm.df[term] || 0;
      var idf = Math.log((bm.N - dfVal + 0.5) / (dfVal + 0.5) + 1);
      score += idf * ((freq * (k1 + 1)) / (freq + k1 * (1 - b + b * (dl / bm.avgDl))));
    }
    return score;
  }

  /* ── Search ── */
  function search(query) {
    if (!index) return [];
    var queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    var bm = buildBM25(index);
    var scored = [];
    for (var i = 0; i < index.length; i++) {
      var s = scoreBM25(bm, i, queryTokens);
      if (s > 0) scored.push({ idx: i, score: s });
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, 8);
  }

  /* ── Highlight matching terms in text ── */
  function highlight(text, queryTokens) {
    if (!text) return '';
    var words = queryTokens.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    var re = new RegExp('(' + words.join('|') + ')', 'gi');
    return escHtml(text).replace(re, '<mark>$1</mark>');
  }

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ── Extract snippet around first match ── */
  function snippet(content, queryTokens, maxLen) {
    maxLen = maxLen || 160;
    var lower = content.toLowerCase();
    var bestPos = -1;
    for (var i = 0; i < queryTokens.length; i++) {
      var pos = lower.indexOf(queryTokens[i]);
      if (pos !== -1 && (bestPos === -1 || pos < bestPos)) bestPos = pos;
    }
    if (bestPos === -1) return content.slice(0, maxLen);
    var start = Math.max(0, bestPos - 40);
    var end = Math.min(content.length, start + maxLen);
    var text = (start > 0 ? '...' : '') + content.slice(start, end) + (end < content.length ? '...' : '');
    return text;
  }

  /* ── Render results ── */
  function renderResults(query) {
    var queryTokens = tokenize(query);
    var hits = search(query);

    if (query.trim() === '') {
      results.innerHTML = '<div class="search-empty">Type to search across all documentation.</div>';
      return;
    }

    if (hits.length === 0) {
      results.innerHTML = '<div class="search-empty">No results for "' + escHtml(query) + '"</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < hits.length; i++) {
      var doc = index[hits[i].idx];
      var snip = snippet(doc.content, queryTokens);
      html += '<a class="search-result" href="' + doc.url + '">'
            + '<div class="search-result-title">' + highlight(doc.title, queryTokens) + '</div>'
            + '<div class="search-result-snippet">' + highlight(snip, queryTokens) + '</div>'
            + '</a>';
    }
    results.innerHTML = html;
  }

  /* ── Build modal DOM ── */
  function createModal() {
    modal = document.createElement('div');
    modal.className = 'search-modal';
    modal.innerHTML =
      '<div class="search-backdrop"></div>' +
      '<div class="search-dialog">' +
        '<div class="search-input-wrap">' +
          '<svg class="search-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
          '<input class="search-input" type="text" placeholder="Search docs..." autofocus />' +
          '<kbd class="search-kbd">Esc</kbd>' +
        '</div>' +
        '<div class="search-results"></div>' +
      '</div>';
    document.body.appendChild(modal);

    input = modal.querySelector('.search-input');
    results = modal.querySelector('.search-results');

    // Events
    modal.querySelector('.search-backdrop').addEventListener('click', closeSearch);
    input.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () { renderResults(input.value); }, 120);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeSearch(); e.preventDefault(); }
    });
  }

  /* ── Open / close ── */
  function openSearch() {
    if (!modal) createModal();
    modal.classList.add('visible');
    input.value = '';
    results.innerHTML = '<div class="search-empty">Type to search across all documentation.</div>';
    setTimeout(function () { input.focus(); }, 50);

    // Lazy-load index
    if (!index) {
      var basePath = '';
      var scripts = document.getElementsByTagName('script');
      for (var i = 0; i < scripts.length; i++) {
        var src = scripts[i].getAttribute('src') || '';
        if (src.indexOf('search.js') !== -1) {
          basePath = src.replace('search.js', '');
          break;
        }
      }
      fetch(basePath + 'search-index.json')
        .then(function (r) { return r.json(); })
        .then(function (data) { index = data; })
        .catch(function () {
          results.innerHTML = '<div class="search-empty">Failed to load search index.</div>';
        });
    }
  }

  function closeSearch() {
    if (modal) modal.classList.remove('visible');
  }

  /* ── Keyboard shortcut: Ctrl/Cmd+K ── */
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openSearch();
    }
  });

  /* ── Expose for header button ── */
  window.openDocsSearch = openSearch;
})();
