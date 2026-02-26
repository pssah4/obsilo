/* Obsilo Docs — Client-side i18n engine */
(function () {
  'use strict';

  var LANGS = {
    de: 'Deutsch',
    en: 'English',
    es: 'Espa\u00F1ol',
    hi: '\u0939\u093F\u0928\u094D\u0926\u0940',
    ja: '\u65E5\u672C\u8A9E',
    'zh-CN': '\u7B80\u4F53\u4E2D\u6587'
  };

  var RTL_LANGS = [];
  var DEFAULT_LANG = 'en';
  var STORAGE_KEY = 'lang';
  var translations = {};
  var currentLang = DEFAULT_LANG;

  function getAvailableLangs() {
    return Object.keys(LANGS);
  }

  function getInitialLang() {
    var stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LANGS[stored]) return stored;
    return DEFAULT_LANG;
  }

  function getBasePath() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute('src') || '';
      if (src.indexOf('i18n.js') !== -1) {
        return src.replace('i18n.js', '');
      }
    }
    return 'assets/';
  }

  function loadLocale(lang, cb) {
    if (translations[lang]) { cb(); return; }
    var basePath = getBasePath();
    var xhr = new XMLHttpRequest();
    xhr.open('GET', basePath + 'locales/' + lang + '.json', true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          try {
            translations[lang] = JSON.parse(xhr.responseText);
          } catch (e) {
            console.warn('i18n: parse error for ' + lang, e);
          }
        } else {
          console.warn('i18n: failed to load ' + lang + ' (' + xhr.status + ')');
        }
        cb();
      }
    };
    xhr.send();
  }

  function t(key, params) {
    var val = (translations[currentLang] && translations[currentLang][key])
           || (translations[DEFAULT_LANG] && translations[DEFAULT_LANG][key])
           || null;
    if (!val) return null;
    if (params) {
      for (var k in params) {
        if (params.hasOwnProperty(k)) {
          val = val.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), params[k]);
        }
      }
    }
    return val;
  }

  function applyTranslations() {
    // Text content
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var key = el.getAttribute('data-i18n');
      var val = t(key);
      if (val !== null) {
        if (el.hasAttribute('data-i18n-html')) {
          el.innerHTML = val;
        } else {
          el.textContent = val;
        }
      }
    }

    // Placeholder attributes
    var phEls = document.querySelectorAll('[data-i18n-placeholder]');
    for (var j = 0; j < phEls.length; j++) {
      var phKey = phEls[j].getAttribute('data-i18n-placeholder');
      var phVal = t(phKey);
      if (phVal !== null) phEls[j].setAttribute('placeholder', phVal);
    }

    // Aria-label attributes
    var arEls = document.querySelectorAll('[data-i18n-aria]');
    for (var k = 0; k < arEls.length; k++) {
      var arKey = arEls[k].getAttribute('data-i18n-aria');
      var arVal = t(arKey);
      if (arVal !== null) arEls[k].setAttribute('aria-label', arVal);
    }

    // Update html lang and dir
    var html = document.documentElement;
    html.setAttribute('lang', currentLang);
    html.setAttribute('dir', RTL_LANGS.indexOf(currentLang) !== -1 ? 'rtl' : 'ltr');

    // Update lang switcher label
    var label = document.querySelector('.lang-toggle-label');
    if (label) {
      var code = currentLang.indexOf('-') !== -1 ? currentLang.split('-')[0].toUpperCase() : currentLang.toUpperCase();
      label.textContent = code;
    }

    // Mark active language in dropdown
    var options = document.querySelectorAll('.lang-option');
    for (var m = 0; m < options.length; m++) {
      var optLang = options[m].getAttribute('data-lang');
      if (optLang === currentLang) {
        options[m].classList.add('active');
      } else {
        options[m].classList.remove('active');
      }
    }
  }

  function switchLang(lang) {
    if (!LANGS[lang]) return;
    currentLang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    loadLocale(lang, function () {
      applyTranslations();
      closeLangDropdown();
    });
  }

  function toggleLangDropdown(e) {
    if (e) e.stopPropagation();
    var dd = document.querySelector('.lang-dropdown');
    if (dd) dd.classList.toggle('visible');
  }

  function closeLangDropdown() {
    var dd = document.querySelector('.lang-dropdown');
    if (dd) dd.classList.remove('visible');
  }

  document.addEventListener('click', function (e) {
    var switcher = document.querySelector('.lang-switcher');
    if (switcher && !switcher.contains(e.target)) {
      closeLangDropdown();
    }
  });

  // Build dropdown items dynamically
  function buildDropdown() {
    var dd = document.querySelector('.lang-dropdown');
    if (!dd || dd.children.length > 0) return;
    var langs = getAvailableLangs();
    for (var i = 0; i < langs.length; i++) {
      var code = langs[i];
      var btn = document.createElement('button');
      btn.className = 'lang-option';
      btn.setAttribute('data-lang', code);
      btn.textContent = LANGS[code] + ' (' + code + ')';
      btn.onclick = (function (c) {
        return function () { switchLang(c); };
      })(code);
      dd.appendChild(btn);
    }
  }

  // Initialize
  currentLang = getInitialLang();
  localStorage.setItem(STORAGE_KEY, currentLang);

  buildDropdown();

  loadLocale(DEFAULT_LANG, function () {
    if (currentLang !== DEFAULT_LANG) {
      loadLocale(currentLang, applyTranslations);
    } else {
      applyTranslations();
    }
  });

  // Expose globals
  window.switchLang = switchLang;
  window.toggleLangDropdown = toggleLangDropdown;
  window.i18nT = t;
  window.i18nApply = applyTranslations;
})();
