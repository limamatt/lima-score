/* Lima TV — tela inicial estilo tvOS com os apps e o Brasileirão do Lima Score.
 * Desenvolvido por MLima. Usa tv.js do Free My TV (MIT) para listar e abrir os apps da TV Samsung. */
(function () {
  'use strict';

  var DATA = 'https://raw.githubusercontent.com/limamatt/lima-score/main/data/';
  var MEU_TIME = 0;   // sempre modo geral

  // Apps do menu, na ordem desejada. "match" acha o app instalado pelo nome.
  var APPS = [
    {key: 'globoplay', name: 'Globoplay', match: /globo/i, bg: 'linear-gradient(135deg,#ff7a2f,#ff2350)', fg: '#fff'},
    {key: 'tv', name: 'TV Aberta', source: 'source:TV:1', bg: 'linear-gradient(135deg,#2a93ff,#0b5bd6)', fg: '#fff'},
    {key: 'youtube', name: 'YouTube', match: /youtube/i, bg: 'linear-gradient(135deg,#ff2a3d,#d4001b)', fg: '#fff'},
    {key: 'sky', name: 'Sky+', match: /sky/i, bg: 'linear-gradient(135deg,#23232e,#14141b)', fg: '#ff3346', ring: true},
    {key: 'prime', name: 'Prime Video', match: /prime|amazon/i, bg: 'linear-gradient(135deg,#1fb0f2,#0d6fa3)', fg: '#fff'}
  ];

  // Canal de transmissão -> app que abre. yt: abre o vídeo ao vivo do Lima Score no YouTube, se houver.
  var CHANNELS = {
    'premiere': {app: 'globoplay', sub: 'no Globoplay'},
    'sportv': {app: 'globoplay', sub: 'no Globoplay'},
    'ge tv': {app: 'youtube', yt: true},
    'cazétv': {app: 'youtube', yt: true},
    'cazetv': {app: 'youtube', yt: true},
    'prime video': {app: 'prime'},
    'amazon prime video': {app: 'prime'},
    'globo': {app: 'tv', sub: 'na TV Aberta'},
    'record': {app: 'tv', sub: 'na TV Aberta'},
    'sbt': {app: 'tv', sub: 'na TV Aberta'},
    'band': {app: 'tv', sub: 'na TV Aberta'},
    'disney+': {app: 'disney'},
    'espn': {app: 'disney', sub: 'no Disney+'},
    'max': {app: 'hbo'},
    'hbo max': {app: 'hbo'}
  };

  var COLORS = {FLA: '#c4161c', PAL: '#006437', CRU: '#0033a0', FLU: '#7a1a35', CAP: '#c8102e', BAH: '#0055a4',
    CAM: '#444444', RBB: '#d1001f', SAN: '#555555', VAS: '#333333', SAO: '#c8102e', CFC: '#00704a', VIT: '#d50000',
    BOT: '#3a3a3a', GRE: '#0d80bf', MIR: '#f2c200', COR: '#4a4a4a', INT: '#e30613', REM: '#1b2a6b', CHA: '#00843d'};

  var LIVE = {IN_PLAY: 1, PAUSED: 1, LIVE: 1};
  var site = null, teams = {}, installed = {}, rows = [], cur = {row: 1, col: 0}, modalOpen = false, modalSel = 0;
  var memory = {};   // última coluna focada em cada fileira

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }

  // ---------- Relógio ----------
  function tick() { var d = new Date(); $('clock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  // ---------- Toast ----------
  var toastT;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.className = 'on'; clearTimeout(toastT); toastT = setTimeout(function () { t.className = ''; }, 2600); }

  // ---------- Apps ----------
  // Acha o app instalado certo: nome exato primeiro; entre empatados, o app da loja antes da cópia embutida
  // do sistema (org.tizen.*), que em algumas TVs abre com erro.
  var EXACT = {globoplay: /^globoplay$/i, youtube: /^youtube$/i, sky: /^sky\+?$/i, prime: /^(amazon )?prime video$/i};
  function loadApps(done) {
    TV.apps(function (list) {
      APPS.forEach(function (a) {
        if (a.source) { installed[a.key] = {id: a.source, title: a.name, icon: ''}; return; }
        var best = null, bestScore = -1;
        list.forEach(function (x) {
          if (!(a.match.test(x.title) || a.match.test(x.id))) return;
          var sc = (EXACT[a.key] && EXACT[a.key].test(String(x.title).trim()) ? 10 : 0) + (/^org\.tizen\./.test(x.id) ? 0 : 5);
          if (sc > bestScore) { best = x; bestScore = sc; }
        });
        if (best) installed[a.key] = best;
      });
      done();
    });
  }

  // Cada app usa o ícone original que o próprio app instalou na TV. Se a TV não fornecer, usa a cor e o nome.
  function drawDock() {
    var dock = $('dock'); dock.innerHTML = '';
    APPS.forEach(function (a) {
      var t = el('div', 'tile' + (a.ring ? ' ring' : ''));
      var app = installed[a.key];
      function fallback() {
        t.style.background = a.bg;
        var w = el('div', 'word', esc(a.name)); w.style.color = a.fg; t.insertBefore(w, t.firstChild);
      }
      if (app && app.icon && !a.source && (TV.name === 'tizen' || window.PREVIEW_ICONS)) {
        t.style.background = '#1c1d22';
        var img = new Image(); img.className = 'full';
        img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); fallback(); };
        img.src = (window.PREVIEW_ICONS && window.PREVIEW_ICONS[a.key]) || app.icon;
        t.appendChild(img);
      } else fallback();
      t.appendChild(el('div', 'label', esc(a.name)));
      if (!app) t.className += ' missing';
      t.onclick = function () { openApp(a.key); };
      t._act = function () { openApp(a.key); };
      dock.appendChild(t);
    });
  }

  // Abre o app do YouTube direto num vídeo. Tenta, em ordem:
  // 1) app control "view" com o endereço do vídeo e PAYLOAD "v=ID" (o formato que o YouTube da TV lê);
  // 2) o servidor DIAL da TV (porta 8080 e depois 8001), como faz o celular ao transmitir;
  // 3) só abrir o YouTube.
  function openYouTubeVideo(appId, vid) {
    var url = 'https://www.youtube.com/watch?v=' + vid;
    function dial(port, next) {
      var x = new XMLHttpRequest(), over = false;
      try {
        x.open('POST', 'http://127.0.0.1:' + port + '/ws/apps/YouTube', true);
        x.timeout = 6000;
        x.onreadystatechange = function () {
          if (x.readyState !== 4 || over) return; over = true;
          if (!(x.status === 200 || x.status === 201)) next();
        };
        x.ontimeout = x.onerror = function () { if (!over) { over = true; next(); } };
        x.setRequestHeader('Content-Type', 'text/plain; charset=utf-8');
        x.send('v=' + encodeURIComponent(vid));
      } catch (e) { next(); }
    }
    function plain() { TV.launch(appId, null, function () {}); }
    try {
      var control = new window.tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', url, null, null,
        [new window.tizen.ApplicationControlData('PAYLOAD', ['v=' + vid])]);
      window.tizen.application.launchAppControl(control, appId, function () {},
        function () { dial(8080, function () { dial(8001, plain); }); });
    } catch (e) {
      dial(8080, function () { dial(8001, plain); });
    }
  }

  function openApp(key, ytVideo) {
    var app = installed[key];
    var a = APPS.filter(function (x) { return x.key === key; })[0];
    if (!app) { toast((a ? a.name : key) + ' não está instalado nesta TV'); return; }
    if (ytVideo && TV.name === 'tizen') { openYouTubeVideo(app.id, ytVideo); return; }
    TV.launch(app.id, null, function (ok) { if (!ok) toast('Não consegui abrir ' + (a ? a.name : '')); });
  }

  // ---------- Dados do Lima Score ----------
  function getJSON(url, done) {
    var x = new XMLHttpRequest();
    x.open('GET', url + '?t=' + Math.floor(Date.now() / 60000), true);
    x.timeout = 15000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      if (x.status === 200) { try { done(JSON.parse(x.responseText)); return; } catch (e) {} }
      done(null);
    };
    x.ontimeout = function () { done(null); };
    x.send();
  }

  function loadData() {
    getJSON(DATA + 'site.json', function (d) {
      if (!d) { if (!site) $('heroTag').textContent = 'Sem conexão com o Lima Score'; schedule(); return; }
      site = d; teams = {};
      d.times.forEach(function (t) { teams[t.id] = t; });
      try { localStorage.setItem('limatv.site', JSON.stringify(d)); } catch (e) {}
      drawAll(); schedule();
    });
  }

  var refreshT;
  function schedule() {
    clearTimeout(refreshT);
    var soon = false, now = Date.now();
    if (site) site.jogos.forEach(function (j) {
      var t = Date.parse(j.data);
      if (LIVE[j.status] || (t - now < 30 * 60000 && now - t < 150 * 60000)) soon = true;
    });
    refreshT = setTimeout(loadData, soon ? 60000 : 10 * 60000);
  }

  // Jogos para mostrar: resultados das últimas 36 horas + todos os jogos ainda não encerrados
  // (inclusive adiados de rodadas anteriores), em ordem de data. A rodada seguinte só entra quando a atual acabou.
  // Rodada atual = a mais alta que já começou (algum jogo já passou do horário).
  function currentRound() {
    var now = Date.now(), r = 1;
    site.jogos.forEach(function (j) { if ((j.status !== 'TIMED' && j.status !== 'SCHEDULED') || Date.parse(j.data) <= now) r = Math.max(r, j.rodada); });
    return r;
  }

  // Próximos jogos: tudo o que ainda não acabou (inclusive adiados), em ordem de data.
  function roundGames() {
    var r = currentRound();
    var pend = site.jogos.filter(function (j) { return j.status !== 'FINISHED' && j.rodada <= r + 1; });
    pend.sort(function (a, b) { return Date.parse(a.data) - Date.parse(b.data); });
    var all = site.jogos.filter(function (j) { return j.rodada >= r - 1; });
    return {rodada: r, jogos: pend, todos: all};
  }

  // Melhores momentos: jogos encerrados da rodada anterior e da atual (e adiados jogados desde o início da anterior).
  // A rodada anterior só sai quando a próxima começa.
  function highlightGames() {
    var r = currentRound();
    var prev = site.jogos.filter(function (j) { return j.rodada === r - 1; });
    var since = prev.length ? Math.min.apply(null, prev.map(function (j) { return Date.parse(j.data); })) : 0;
    var list = site.jogos.filter(function (j) {
      return j.status === 'FINISHED' && (j.rodada >= r - 1 || Date.parse(j.data) >= since);
    });
    // do mais recente (esquerda) para o mais antigo (direita)
    list.sort(function (a, b) { return Date.parse(b.data) - Date.parse(a.data); });
    return list;
  }

  function hlScroll(col) {
    var n = $('highlights').children.length;
    var max = Math.max(0, n * 486 - 26 - 1728);
    var shift = Math.max(0, Math.min(max, (col - 2) * 486));
    $('highlights').style.transform = 'translateX(' + (-shift) + 'px)';
  }

  function drawHighlights() {
    var box = $('highlights'); box.innerHTML = '';
    var list = highlightGames();
    list.forEach(function (j) {
      var h = teams[j.casa] || {}, a = teams[j.fora] || {};
      var c = el('div', 'hl');
      c.innerHTML = '<div class="th">' + (j.video ? '<img src="https://i.ytimg.com/vi/' + esc(j.video) + '/hqdefault.jpg"><span class="play">▶</span>' : '<span class="crests"><img src="' + esc(h.escudo) + '"><img src="' + esc(a.escudo) + '"></span><span class="play">▶</span>') + '</div>' +
        '<div class="sc"><img src="' + esc(h.escudo) + '"><b>' + esc(h.sigla) + '</b><span class="g">' + j.gols_casa + ' × ' + j.gols_fora + '</span><b>' + esc(a.sigla) + '</b><img src="' + esc(a.escudo) + '"></div>' +
        '<div class="mt">Rodada ' + j.rodada + ' · ' + when(j).split(' · ')[0] + '</div>';
      c._act = function () { if (j.video) openApp('youtube', j.video); else toast('Vídeo ainda não foi postado'); };
      c.onclick = c._act;
      box.appendChild(c);
    });
    // começa no mais recente, à esquerda; ▶ vai para os mais antigos
    if (memory[3] == null || memory[3] >= list.length) memory[3] = 0;
    if (cur.row !== 3) hlScroll(memory[3]);
    var r = currentRound();
    $('hlTitle').textContent = 'Melhores momentos · Rodadas ' + (r - 1) + ' e ' + r;
  }

  function featured(list) {
    var live = list.filter(function (j) { return LIVE[j.status]; })[0];
    if (live) return live;
    var next = list.filter(function (j) { return j.status !== 'FINISHED'; })[0];
    if (next) return next;
    return list[list.length - 1];
  }

  var DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  function when(j) {
    var d = new Date(j.data), now = new Date();
    var day = d.toDateString() === now.toDateString() ? 'Hoje' :
      new Date(now.getTime() + 86400000).toDateString() === d.toDateString() ? 'Amanhã' :
      DOW[d.getDay()] + ', ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1);
    return day + ' · ' + pad(d.getHours()) + 'h' + pad(d.getMinutes());
  }

  // Opções de "onde assistir" de um jogo: [{label, sub, act}]
  function options(j) {
    var out = [];
    if (j.status === 'FINISHED') {
      if (j.video) out.push({label: 'Melhores momentos', sub: 'YouTube', act: function () { openApp('youtube', j.video); }});
      return out;
    }
    var lives = j.lives || {};
    (j.canais || []).forEach(function (c) {
      var m = CHANNELS[String(c).toLowerCase()];
      if (!m) return;
      var vid = m.yt ? (lives[c] || null) : null;
      out.push({label: c, sub: m.sub || '', act: function () { openApp(m.app, vid); }});
    });
    return out;
  }

  function teamLine(id, goals) {
    var t = teams[id] || {nome: '?', escudo: ''};
    return '<div class="line"><img src="' + esc(t.escudo) + '"><span class="nm">' + esc(t.nome) + '</span><span class="g">' +
      (goals == null ? '' : goals) + '</span></div>';
  }

  // Entre temporadas: sem jogos pela frente. Mostra o campeão (ou a data de início da próxima, quando já houver jogos marcados).
  function drawOffSeason() {
    var list = site.times.slice().sort(function (x, y) { return x.pos - y.pos; });
    var ano = String(site.temporada.inicio || '').slice(0, 4);
    var all = site.jogos.slice().sort(function (x, y) { return Date.parse(x.data) - Date.parse(y.data); });
    var acabou = all.length && all.every(function (j) { return j.status === 'FINISHED'; });
    var c = list[0] || {};
    if (acabou) {
      $('heroTag').textContent = 'Fim do Brasileirão ' + ano;
      $('heroMatch').innerHTML = '<div class="team"><img src="' + esc(c.escudo) + '">' + esc(c.nome) + '</div>';
      $('heroInfo').textContent = 'Campeão com ' + c.pts + ' pontos · Até a próxima temporada!';
    } else {
      $('heroTag').textContent = 'Brasileirão ' + ano;
      $('heroMatch').innerHTML = '';
      $('heroInfo').textContent = 'A tabela de jogos ainda não foi divulgada.';
    }
    $('heroBtns').innerHTML = '';
    document.documentElement.style.setProperty('--c1', COLORS[c.sigla] || '#1d3b2a');
    document.documentElement.style.setProperty('--c2', '#2a2140');
  }

  function drawHero(j) {
    var h = teams[j.casa] || {}, a = teams[j.fora] || {};
    var live = LIVE[j.status], fin = j.status === 'FINISHED';
    $('heroTag').innerHTML = live ? '<span class="live">Ao vivo</span> · Brasileirão' :
      fin ? 'Encerrado · Brasileirão · Rodada ' + j.rodada : 'Próximo jogo · Brasileirão · Rodada ' + j.rodada;
    var mid = (live || fin) ? '<div class="score">' + (j.gols_casa == null ? 0 : j.gols_casa) + ' – ' + (j.gols_fora == null ? 0 : j.gols_fora) + '</div>' : '<div class="vs">×</div>';
    $('heroMatch').innerHTML = '<div class="team"><img src="' + esc(h.escudo) + '">' + esc(h.nome) + '</div>' + mid +
      '<div class="team">' + esc(a.nome) + '<img src="' + esc(a.escudo) + '"></div>';
    var info = fin ? 'Resultado final' : when(j);
    if (j.canais && j.canais.length && !fin) info += ' · ' + j.canais.join(', ');
    $('heroInfo').textContent = info;
    var btns = $('heroBtns'); btns.innerHTML = '';
    options(j).forEach(function (o) {
      var b = el('div', 'btn', '▶ ' + esc(o.label) + (o.sub ? ' <span class="sub">' + esc(o.sub) + '</span>' : ''));
      b._act = o.act; b.onclick = o.act; btns.appendChild(b);
    });
    document.documentElement.style.setProperty('--c1', COLORS[h.sigla] || '#1d3b2a');
    document.documentElement.style.setProperty('--c2', COLORS[a.sigla] || '#2a2140');
  }

  function drawMatches(r) {
    $('roundTitle').textContent = 'Próximos jogos';
    var box = $('matches'); box.innerHTML = '';
    box.parentNode.style.display = r.jogos.length ? '' : 'none';
    r.jogos.forEach(function (j) {
      var live = LIVE[j.status], fin = j.status === 'FINISHED';
      var c = el('div', 'match');
      var right = live ? '<span class="live">● AO VIVO</span>' : fin ? 'Encerrado' : '';
      c.innerHTML = '<div class="rd">Rodada ' + j.rodada + '</div><div class="when"><span>' + (fin || live ? (fin ? when(j).split(' · ')[0] : 'Agora') : when(j)) + '</span>' + right + '</div>' +
        teamLine(j.casa, (fin || live) ? (j.gols_casa == null ? 0 : j.gols_casa) : null) +
        teamLine(j.fora, (fin || live) ? (j.gols_fora == null ? 0 : j.gols_fora) : null) +
        '<div class="chips">' + (fin ? ((j.video ? '<span class="chip hl">▶ Melhores momentos</span>' : '')) :
          (j.canais || []).map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('')) + '</div>';
      c._act = function () { chooseFor(j); }; c.onclick = c._act;
      box.appendChild(c);
    });
  }

  function chooseFor(j) {
    var o = options(j);
    if (!o.length) { toast(j.status === 'FINISHED' ? 'Melhores momentos ainda não disponíveis' : 'Transmissão ainda não divulgada'); return; }
    if (o.length === 1) { o[0].act(); return; }
    var h = teams[j.casa] || {}, a = teams[j.fora] || {};
    $('modalTitle').textContent = h.nome + ' × ' + a.nome + ' — onde assistir';
    var box = $('modalBtns'); box.innerHTML = '';
    o.forEach(function (x) {
      var b = el('div', 'btn', esc(x.label) + (x.sub ? ' <span class="sub">' + esc(x.sub) + '</span>' : ''));
      b._act = function () { closeModal(); x.act(); }; b.onclick = b._act; box.appendChild(b);
    });
    modalOpen = true; modalSel = 0; $('modal').className = 'on'; paintModal();
  }
  function paintModal() { var b = $('modalBtns').children; for (var i = 0; i < b.length; i++) b[i].className = 'btn' + (i === modalSel ? ' focus' : ''); }
  function closeModal() { modalOpen = false; $('modal').className = ''; }

  function zone(pos) { return pos <= 4 ? 'lib' : pos <= 6 ? 'pre' : pos <= 12 ? 'sul' : pos >= 17 ? 'reb' : ''; }

  function drawTable() {
    var list = site.times.slice().sort(function (a, b) { return a.pos - b.pos; });
    var head = '<div class="tr head"><span class="p">#</span><span class="t" style="margin-left:50px">Clube</span><span class="n">P</span><span class="n">J</span><span class="n">V</span><span class="n">SG</span><span class="f">Últimos</span></div>';
    function col(part) {
      return '<div class="col">' + head + part.map(function (t) {
        var forma = String(t.forma || '').slice(-5).split('').map(function (r) { return '<b class="' + r + '"></b>'; }).join('');
        return '<div class="tr ' + zone(t.pos) + '"><span class="p"><i></i>' + t.pos + '</span><img src="' + esc(t.escudo) + '"><span class="t">' + esc(t.nome) +
          '</span><span class="n pts">' + t.pts + '</span><span class="n">' + t.j + '</span><span class="n">' + t.v + '</span><span class="n">' + t.sg +
          '</span><span class="f">' + forma + '</span></div>';
      }).join('') + '</div>';
    }
    $('table').innerHTML = col(list.slice(0, 10)) + col(list.slice(10));
    $('table')._act = function () {};
    var up = new Date(site.atualizado);
    $('foot').textContent = 'Dados do Lima Score · atualizado às ' + pad(up.getHours()) + 'h' + pad(up.getMinutes()) + ' · Desenvolvido por MLima';
  }

  function lastAndNext(id) {
    var mine = site.jogos.filter(function (j) { return j.casa === id || j.fora === id; });
    mine.sort(function (x, y) { return Date.parse(x.data) - Date.parse(y.data); });
    var last = null, next = null, live = null;
    mine.forEach(function (j) {
      if (LIVE[j.status]) live = j;
      else if (j.status === 'FINISHED') last = j;
      else if (!next) next = j;
    });
    return {last: last, next: next, live: live};
  }

  function vsLine(j, id) {
    var oth = teams[j.casa === id ? j.fora : j.casa] || {};
    return '· × <img src="' + esc(oth.escudo) + '">' + esc(oth.nome) + (j.casa === id ? '' : ' <span style="opacity:.6">(fora)</span>');
  }

  function drawGeneral() {
    var box = $('myteam');
    var list = site.times.slice().sort(function (x, y) { return x.pos - y.pos; });
    var lider = list[0], top = (site.jogadores || []).slice().sort(function (x, y) { return y.gols - x.gols; })[0];
    var html = '<div class="hd"><img src="logo-marca.svg"><div><div class="lbl">Resumo</div><div class="nm">Brasileirão agora</div></div></div>';
    html += '<div class="ln"><div class="k">Líder</div><div class="v"><img src="' + esc(lider.escudo) + '">' + esc(lider.nome) + ' · <b>' + lider.pts + ' pts</b></div></div>';
    if (top) html += '<div class="ln"><div class="k">Artilheiro</div><div class="v"><img src="' + esc((teams[top.time] || {}).escudo) + '">' + esc(top.nome) + ' · <b>' + top.gols + ' gols</b></div></div>';
    var gar = (site.jogadores || []).slice().sort(function (x, y) { return (y.assistencias || 0) - (x.assistencias || 0); })[0];
    if (gar) html += '<div class="ln"><div class="k">Líder em assistências</div><div class="v"><img src="' + esc((teams[gar.time] || {}).escudo) + '">' + esc(gar.nome) + ' · <b>' + gar.assistencias + ' assist.</b></div></div>';
    box.innerHTML = html; box.style.display = '';
  }

  function drawMyTeam() {
    var t = teams[MEU_TIME]; var box = $('myteam');
    if (!t) { drawGeneral(); return; }
    var ln = lastAndNext(MEU_TIME);
    var forma = String(t.forma || '').slice(-5).split('').map(function (r) { return '<i class="' + r + '"></i>'; }).join('');
    var html = '<div class="hd"><img src="' + esc(t.escudo) + '"><div><div class="lbl">Meu time</div><div class="nm">' + esc(t.nome) + '</div></div></div>' +
      '<div class="st"><span><b>' + t.pos + 'º</b> lugar</span><span><b>' + t.pts + '</b> pts</span><span class="fm">' + forma + '</span></div>';
    function score(j) {
      var h = teams[j.casa] || {}, a = teams[j.fora] || {};
      return '<img src="' + esc(h.escudo) + '">' + esc(h.sigla) + ' <b>' + (j.gols_casa || 0) + ' × ' + (j.gols_fora || 0) + '</b> ' + esc(a.sigla) + '<img src="' + esc(a.escudo) + '">';
    }
    if (ln.live) html += '<div class="ln"><div class="k"><span class="live">● Ao vivo agora</span></div><div class="v">' + score(ln.live) + '</div></div>';
    else if (ln.last) html += '<div class="ln"><div class="k">Último jogo</div><div class="v">' + score(ln.last) + '</div></div>';
    if (ln.next) html += '<div class="ln"><div class="k">Próximo jogo · Rodada ' + ln.next.rodada + '</div><div class="v">' + when(ln.next) + ' ' + vsLine(ln.next, MEU_TIME) +
      '</div><div class="v">' + (ln.next.canais || []).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + '</div></div>';
    html += '<div class="pick btn" id="pickBtn">Trocar time</div>';
    box.innerHTML = html; box.style.display = '';
    $('pickBtn')._act = openPicker;
  }

  // ---------- Escolha do time ----------
  var picking = false, pickSel = 0, pickItems = [];
  function openPicker() {
    var list = site.times.slice().sort(function (x, y) { return x.nome < y.nome ? -1 : 1; });
    var g = $('pickGrid'); g.innerHTML = ''; pickItems = [];
    var none = el('div', 'pt none', '<span>Nenhum time<br><small>modo geral</small></span>'); none._id = 0; g.appendChild(none); pickItems.push(none);
    list.forEach(function (t) {
      var c = el('div', 'pt', '<img src="' + esc(t.escudo) + '"><span>' + esc(t.nome) + '</span>'); c._id = t.id; g.appendChild(c); pickItems.push(c);
    });
    pickSel = 0;
    for (var i = 0; i < pickItems.length; i++) if (pickItems[i]._id === MEU_TIME) pickSel = i;
    picking = true; $('picker').className = 'on'; paintPicker();
  }
  function paintPicker() { pickItems.forEach(function (e, i) { e.className = e.className.replace(/ ?focus/g, '') + (i === pickSel ? ' focus' : ''); }); }
  function choose(id) {
    MEU_TIME = id; TEAM_SET = true;
    try { localStorage.setItem('limatv.time', String(id)); } catch (e) {}
    picking = false; $('picker').className = ''; drawAll();
    toast(id ? 'Meu time: ' + teams[id].nome : 'Modo geral, sem time');
  }

  // Dois ou mais jogos ao vivo: o topo vira o placar da rodada ao vivo.
  function drawLive(list) {
    var live = list.filter(function (j) { return LIVE[j.status]; });
    var board = $('liveBoard'); board.innerHTML = '';
    if (live.length < 2) { document.body.className = document.body.className.replace(/ ?live/g, ''); return false; }
    if (document.body.className.indexOf('live') < 0) document.body.className += ' live';
    live.sort(function (x, y) { return (y.casa === MEU_TIME || y.fora === MEU_TIME) - (x.casa === MEU_TIME || x.fora === MEU_TIME); });
    $('heroTag').innerHTML = '<span class="live">Ao vivo agora</span> · ' + live.length + ' jogos do Brasileirão';
    live.slice(0, 6).forEach(function (j) {
      var h = teams[j.casa] || {}, a = teams[j.fora] || {};
      var mine = j.casa === MEU_TIME || j.fora === MEU_TIME;
      var c = el('div', 'lv' + (mine ? ' mine' : ''));
      c.innerHTML = '<div class="r"><img src="' + esc(h.escudo) + '"><span class="n">' + esc(h.nome) + '</span><span class="g">' + (j.gols_casa || 0) + '</span></div>' +
        '<div class="r"><img src="' + esc(a.escudo) + '"><span class="n">' + esc(a.nome) + '</span><span class="g">' + (j.gols_fora || 0) + '</span></div>' +
        '<div class="f"><span class="on">● AO VIVO</span><span>' + esc((j.canais || []).join(' · ')) + '</span></div>';
      c._act = function () { chooseFor(j); }; c.onclick = c._act;
      board.appendChild(c);
    });
    var c1 = COLORS[(teams[live[0].casa] || {}).sigla], c2 = COLORS[(teams[live[0].fora] || {}).sigla];
    document.documentElement.style.setProperty('--c1', c1 || '#1d3b2a');
    document.documentElement.style.setProperty('--c2', c2 || '#2a2140');
    return true;
  }

  function drawAll() {
    if (!site) return;
    var r = roundGames();
    var fj = featured(r.jogos);
    if (fj) drawHero(fj); else drawOffSeason();
    drawLive(r.jogos);
    drawMyTeam();
    drawMatches(r);
    drawHighlights();
    // Ao descer para os jogos, o foco começa no próximo jogo (os resultados recentes ficam à esquerda).
    drawTable();
    collect(); paint();
  }

  // ---------- Navegação pelo controle ----------
  function collect() {
    rows = [
      [].slice.call((document.body.className.indexOf('live') >= 0 ? $('liveBoard') : $('heroBtns')).children),
      [].slice.call($('dock').children),
      [].slice.call($('matches').children),
      [].slice.call($('highlights').children),
      [$('table')]
    ];
    if (!rows[cur.row] || !rows[cur.row].length) cur.row = 1;
    if (cur.col >= rows[cur.row].length) cur.col = rows[cur.row].length - 1;
  }

  function paint() {
    rows.forEach(function (r, ri) { r.forEach(function (e, ci) {
      var on = ri === cur.row && ci === cur.col;
      if (on && e.className.indexOf(' focus') < 0) e.className += ' focus';
      if (!on) e.className = e.className.replace(/ ?focus/g, '');
    }); });
    // Rolagem vertical: o topo fica parado até sair do dock.
    var tgt = [null, null, $('matches'), $('highlights'), $('table')][cur.row];
    var y = tgt && cur.row >= 2 ? -(tgt.parentNode.offsetTop - 70) : 0;
    $('page').style.transform = 'translateY(' + y + 'px)';
    $('brand').style.opacity = cur.row >= 2 ? 0 : 1;
    // Rolagem horizontal dos jogos
    if (cur.row === 3) hlScroll(cur.col);
    if (cur.row === 2) {
      var shift = Math.max(0, cur.col - 2) * 486;
      $('matches').style.transform = 'translateX(' + (-shift) + 'px)';
    }
  }

  function move(dr, dc) {
    if (dc) {
      var n = rows[cur.row].length;
      cur.col = Math.max(0, Math.min(n - 1, cur.col + dc));
    } else {
      var r = cur.row + dr;
      while (r >= 0 && r < rows.length && !rows[r].length) r += dr;
      if (r < 0 || r >= rows.length) return;
      memory[cur.row] = cur.col;
      cur.row = r;
      cur.col = Math.min(memory[r] != null ? memory[r] : 0, rows[r].length - 1);
    }
    paint();
  }

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, K = TV.keys;
    if (picking) {
      var cols = 7, n2 = pickItems.length;
      if (k === K.left) pickSel = Math.max(0, pickSel - 1);
      else if (k === K.right) pickSel = Math.min(n2 - 1, pickSel + 1);
      else if (k === K.up) pickSel = Math.max(0, pickSel - cols);
      else if (k === K.down) pickSel = Math.min(n2 - 1, pickSel + cols);
      else if (k === K.ok) { choose(pickItems[pickSel]._id); e.preventDefault(); return; }
      else if ((k === K.back || k === 27 || k === 8) && TEAM_SET) { picking = false; $('picker').className = ''; }
      else return;
      paintPicker(); e.preventDefault(); return;
    }
    if (modalOpen) {
      var n = $('modalBtns').children.length;
      if (k === K.left) modalSel = Math.max(0, modalSel - 1);
      else if (k === K.right) modalSel = Math.min(n - 1, modalSel + 1);
      else if (k === K.ok) { $('modalBtns').children[modalSel]._act(); return; }
      else if (k === K.back || k === 27 || k === 8) closeModal();
      else return;
      paintModal(); e.preventDefault(); return;
    }
    if (k === K.left) move(0, -1);
    else if (k === K.right) move(0, 1);
    else if (k === K.up) move(-1, 0);
    else if (k === K.down) move(1, 0);
    else if (k === K.ok) { var t = rows[cur.row][cur.col]; if (t && t._act) t._act(); }
    else if (k === K.back || k === 27 || k === 8) {
      if (cur.row !== 1) { cur.row = 1; cur.col = memory[1] || 0; paint(); } else TV.back();
    } else return;
    e.preventDefault();
  });

  // ---------- Encaixe na tela ----------
  // Desenhada em 1920x1080 e ampliada/reduzida para o tamanho real que a TV dá ao app (720p, 1080p ou 4K).
  function fit() {
    var w = window.innerWidth || document.documentElement.clientWidth || 1920;
    var h = window.innerHeight || document.documentElement.clientHeight || 1080;
    var s = Math.min(w / 1920, h / 1080);
    var st = $('stage');
    st.style.transform = 'translate(' + Math.round((w - 1920 * s) / 2) + 'px,' + Math.round((h - 1080 * s) / 2) + 'px) scale(' + s + ')';
  }
  fit(); window.addEventListener('resize', fit); setTimeout(fit, 500); setTimeout(fit, 2000);

  // ---------- Início ----------
  tick(); setInterval(tick, 5000);
  try { var cached = localStorage.getItem('limatv.site'); if (cached) { site = JSON.parse(cached); site.times.forEach(function (t) { teams[t.id] = t; }); } } catch (e) {}
  loadApps(function () { drawDock(); collect(); paint(); drawAll(); loadData(); });
  // Ao voltar de um app, atualiza na hora.
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { tick(); loadData(); } });
})();
