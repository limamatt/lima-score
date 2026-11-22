/* Lima Score — app */
(function () {
  'use strict';

  const DATA_URL = 'data/site.json';
  const TZ = 'America/Sao_Paulo';
  let D = null;           // dados do site
  let N = null;           // notícias
  let T = {};             // times por id
  let E = null;           // estatísticas e lances dos jogos
  let P = null;           // jogadores (números da temporada, ESPN)
  let estado = { rodada: null, artilharia: 'clube', tabela: 'classificacao', clubeNoticias: 'todos', arb: 'arbitros', arbClube: null, arbAberto: null, cen: null, pano: 'titulo' };

  // ---------- utilidades
  const $ = (s, r = document) => r.querySelector(s);
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
    return e;
  }
  const pct = (v) => {
    if (v == null) return '—';
    if (v > 99) return '100%';
    if (v > 0 && v < 0.05) return '<0,1%';
    return (+v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
  };
  const n1 = (v) => (+v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const dataHora = (iso) => {
    const d = new Date(iso);
    const dia = d.toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' });
    const h = d.toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
    return `${dia.replace('.', '')} · ${h}`;
  };
  const sgTxt = (v) => (v > 0 ? '+' + v : String(v));

  function escudo(id, size) {
    const t = T[id];
    const cls = 'crest' + (size ? ' ' + size : '');
    if (!t) return el('span', { class: cls });
    const img = el('img', { class: cls, src: t.escudo, alt: '', loading: 'lazy', width: 24, height: 24 });
    img.addEventListener('error', () => {
      const fb = el('span', { class: cls + ' crest-fb', 'aria-hidden': 'true', text: t.sigla });
      img.replaceWith(fb);
    });
    return img;
  }
  function timeLink(id, size) {
    const t = T[id];
    return el('a', { class: 'team', href: '#clube-' + id }, escudo(id, size), el('span', { text: t ? t.nome : '?' }));
  }
  function timeLinkSigla(id) {
    const t = T[id];
    return el('a', { class: 'team sigla', href: '#clube-' + id, 'aria-label': t ? t.nome : '', title: t ? t.nome : '' },
      escudo(id, 'tb'), D ? placarAoVivo(id) : null);
  }
  function zona(pos) {
    return pos <= 4 ? 'lib' : pos <= 6 ? 'pre' : pos <= 12 ? 'sul' : pos >= 17 ? 'reb' : 'mid';
  }
  function heat(v, cor) {
    const s = el('span', { class: 'heat num', text: pct(v) });
    if (v > 0) s.style.background = `color-mix(in srgb, ${cor} ${Math.round(6 + v * 0.45)}%, transparent)`;
    return s;
  }
  function forma(str) {
    return el('span', { class: 'forma', 'aria-label': 'Últimos jogos: ' + str.split('').map((c) => ({ V: 'vitória', E: 'empate', D: 'derrota' })[c]).join(', ') },
      str.split('').map((c) => el('i', { class: c, text: c })));
  }
  function secHead(eyebrow, titulo, texto, h = 'h2') {
    return el('header', { class: 'sec-head' },
      eyebrow && el('div', { class: 'eyebrow', text: eyebrow }),
      el(h, { text: titulo }),
      texto && el('p', { text: texto }));
  }
  const encerrado = (j) => j.status === 'FINISHED';
  // minuto do jogo: usa a hora em que o tempo atual começou (vinda da ESPN); sem ela, estima pelo horário do jogo
  function minuto(j) {
    if (j.status === 'PAUSED' || j.intervalo) return 'Intervalo';
    if (j.ancora && (j.periodo === 1 || j.periodo === 2)) {
      const dec = Math.floor((Date.now() - new Date(j.ancora).getTime()) / 60000) + 1;
      if (j.periodo === 1) return dec <= 45 ? dec + "'" : "45+" + Math.min(dec - 45, 15) + "'";
      return 45 + dec <= 90 ? (45 + dec) + "'" : "90+" + Math.min(45 + dec - 90, 15) + "'";
    }
    const m = (Date.now() - new Date(j.data).getTime()) / 60000;
    if (m < 1) return "1'";
    if (m <= 45) return Math.ceil(m) + "'";
    if (m <= 62) return 'Intervalo';
    const s2 = Math.ceil(m - 17);
    return s2 <= 90 ? s2 + "'" : "90+'";
  }
  function placarAoVivo(id) {
    const j = D.jogos.find((x) => aoVivo(x) && (x.casa === id || x.fora === id));
    if (!j || j.gols_casa == null) return null;
    const meu = j.casa === id ? j.gols_casa : j.gols_fora, dele = j.casa === id ? j.gols_fora : j.gols_casa;
    const res = meu > dele ? 'V' : meu === dele ? 'E' : 'D';
    const adv = T[j.casa === id ? j.fora : j.casa];
    return el('span', { class: 'mini-live ' + res, title: `Ao vivo contra ${adv ? adv.nome : ''}`, text: `${meu}-${dele}` });
  }
  const aoVivo = (j) => j.status === 'IN_PLAY' || j.status === 'PAUSED';
  function rodadaAtual() {
    const pend = D.jogos.filter((j) => !encerrado(j));
    if (!pend.length) return 38;
    return Math.min(...pend.map((j) => j.rodada));
  }
  const rebaixadoMatematicamente = (t) => {
    const restam = D.jogos.filter((j) => !encerrado(j) && (j.casa === t.id || j.fora === t.id)).length;
    const corte = D.times.map((x) => x.pts).sort((a, b) => b - a)[15];
    return t.pts + 3 * restam < corte;
  };

  // ---------- cartão de jogo
  function cartaoJogo(j, opts = {}) {
    const p = j.previsao;
    const top = el('div', { class: 'game-top' },
      el('span', { text: dataHora(j.data) }),
      aoVivo(j) ? el('span', { class: 'live-wrap' }, el('span', { class: 'minuto num', 'data-min': j.id, text: minuto(j) }), el('span', { class: 'tag live-tag' }, el('i', { class: 'dot' }), 'Ao vivo'))
        : encerrado(j) ? el('span', { text: 'Encerrado' })
          : opts.destaque ? el('span', { class: 'tag y', text: opts.destaque }) : null);
    let placar;
    if (encerrado(j)) placar = el('div', { class: 'sc final num', text: `${j.gols_casa} × ${j.gols_fora}` });
    else if (aoVivo(j) && j.gols_casa != null) placar = el('div', { class: 'sc live num', text: `${j.gols_casa} × ${j.gols_fora}` });
    else placar = el('div', { class: 'sc vs', 'aria-hidden': 'true', text: '×' });
    const timeCartao = (id) => { const t = T[id]; return el('span', { class: 'team' }, escudo(id, 'md'), el('span', { text: t ? t.nome : '?' })); };
    const card = el('article', { class: 'card game clicavel' + (aoVivo(j) ? ' is-live' : ''), tabindex: '0', role: 'link',
      'aria-label': `${T[j.casa] ? T[j.casa].nome : ''} x ${T[j.fora] ? T[j.fora].nome : ''}: ver detalhes do jogo`,
      onclick: (e) => { if (!e.target.closest('a')) location.hash = '#jogo-' + j.id; },
      onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) location.hash = '#jogo-' + j.id; } }, top,
      el('div', { class: 'game-row' }, timeCartao(j.casa), placar, timeCartao(j.fora)));
    // vídeos dos gols no cartão só enquanto o jogo rola; depois ficam na página da partida
    if (aoVivo(j) && j.gols_video && j.gols_video.length) {
      const gl = el('div', { class: 'gols-v' }, el('span', { class: 'tv-k', text: 'Gols' }));
      j.gols_video.forEach((g, i) => gl.append(chipGol(g, i)));
      card.append(gl);
    }
    if (encerrado(j) && j.video) {
      card.append(el('a', { class: 'btn-video', href: 'https://www.youtube.com/watch?v=' + encodeURIComponent(j.video), target: '_blank', rel: 'noopener' },
        el('span', { class: 'play', 'aria-hidden': 'true' }), 'Melhores momentos'));
    }
    if (p && !encerrado(j) && !aoVivo(j)) {
      const bar = el('div', { class: 'bar3', role: 'img', 'aria-label': `Mandante ${pct(p.casa)}, empate ${pct(p.empate)}, visitante ${pct(p.fora)}` },
        el('span', { style: `width:${p.casa}%;background:var(--good)` }),
        el('span', { style: `width:${p.empate}%;background:var(--muted)` }),
        el('span', { style: `width:${p.fora}%;background:var(--bad)` }));
      const pr = el('div', { class: 'probs' },
        el('span', null, 'Casa ', el('b', { class: 'num', text: pct(p.casa) })),
        el('span', null, 'Empate ', el('b', { class: 'num', text: pct(p.empate) })),
        el('span', null, 'Fora ', el('b', { class: 'num', text: pct(p.fora) })));
      card.append(bar, pr);
    }
    if ((encerrado(j) || aoVivo(j)) && arbitroDoJogo(j)) card.append(el('div', { class: 'small arb-linha', text: 'Árbitro: ' + arbitroDoJogo(j) }));
    if (encerrado(j) || aoVivo(j)) card.append(el('a', { class: 'ver-jogo', href: '#jogo-' + j.id }, 'Estatísticas e lances ›'));
    if (!encerrado(j)) {
      const tv = el('div', { class: 'tv' }, el('span', { class: 'tv-k', text: 'Onde assistir' }));
      if (j.canais && j.canais.length) j.canais.forEach((c) => {
        const vid = j.lives && j.lives[c];
        const yt = vid ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(vid) : canalYouTube(c);
        tv.append(yt && !encerrado(j)
          ? el('a', { class: 'chip chip-yt', href: yt, target: '_blank', rel: 'noopener', 'aria-label': `Assistir no YouTube (${c})` }, '▶ ' + c)
          : el('span', { class: 'chip', text: c }));
      });
      else tv.append(el('span', { class: 'small', text: 'A definir' }));
      card.append(tv);
    }
    return card;
  }
  const sobrenome = (n) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : p[0] || ''; };
  // canais que transmitem no YouTube: o link /live abre a transmissão que estiver no ar
  const CANAIS_YT = { 'cazetv': 'CazeTV', 'ge tv': 'getv', 'getv': 'getv' };
  function canalYouTube(nome) {
    const k = (nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    return CANAIS_YT[k] ? `https://www.youtube.com/@${CANAIS_YT[k]}/live` : null;
  }
  function chipGol(g, i) {
    const id = typeof g === 'string' ? g : g.id;
    const txt = typeof g === 'object' && g.minuto ? `▶ ${g.minuto} ${sobrenome(g.jogador)}`.trim() : `▶ Gol ${i + 1}`;
    const quem = typeof g === 'object' && g.jogador ? ` de ${g.jogador}` : ` ${i + 1}`;
    return el('a', { class: 'chip chip-gol', href: 'https://www.youtube.com/watch?v=' + encodeURIComponent(id), target: '_blank', rel: 'noopener', 'aria-label': `Ver gol${quem} no YouTube` }, txt);
  }

  // ---------- página do jogo
  const ESTAT_LINHAS = [
    ['posse', 'Posse de bola', '%'], ['finalizacoes', 'Finalizações'], ['no_alvo', 'Chutes no gol'],
    ['escanteios', 'Escanteios'], ['faltas', 'Faltas'], ['amarelos', 'Cartões amarelos'], ['vermelhos', 'Cartões vermelhos'],
    ['impedimentos', 'Impedimentos'], ['defesas', 'Defesas do goleiro'], ['passes', 'Passes'], ['precisao_passes', 'Precisão dos passes', '%'],
  ];
  function telaJogo(app, id) {
    const j = D.jogos.find((x) => x.id === id);
    if (!j) { app.append(el('p', { class: 'erro', text: 'Jogo não encontrado.' })); return; }
    const e = E && E.jogos ? E.jogos[String(id)] : null;
    app.append(el('a', { class: 'back', href: '#rodadas', text: '← Voltar',
      onclick: (ev) => { if (history.length > 1) { ev.preventDefault(); history.back(); } } }));
    if (estado.rodada == null) estado.rodada = j.rodada;

    // placar
    const st = aoVivo(j) ? el('span', { class: 'live-wrap' }, el('span', { class: 'minuto num', 'data-min': j.id, text: minuto(j) }), el('span', { class: 'tag live-tag' }, el('i', { class: 'dot' }), 'Ao vivo'))
      : encerrado(j) ? el('span', { class: 'small', text: 'Encerrado' }) : el('span', { class: 'small', text: 'Não começou' });
    const sc = encerrado(j) || (aoVivo(j) && j.gols_casa != null)
      ? el('div', { class: 'sc num ' + (aoVivo(j) ? 'live' : 'final'), text: `${j.gols_casa} × ${j.gols_fora}` })
      : el('div', { class: 'sc vs', text: '×' });
    const lado = (tid) => el('a', { class: 'jg-time', href: '#clube-' + tid }, escudo(tid, 'lg'), el('b', { text: T[tid] ? T[tid].nome : '?' }));
    app.append(el('section', { class: 'card jg-head' + (aoVivo(j) ? ' is-live' : '') },
      el('div', { class: 'small', text: `${j.rodada}ª rodada · ${dataHora(j.data)}` }),
      el('div', { class: 'jg-placar' }, lado(j.casa), el('div', { class: 'jg-meio' }, sc, st), lado(j.fora)),
      el('div', { class: 'small jg-arb' }, 'Árbitro: ', arbitroDoJogo(j) ? el('a', { href: '#arbitragem', text: arbitroDoJogo(j),
        onclick: () => { estado.arb = 'arbitros'; estado.arbAberto = arbitroDoJogo(j); } }) : el('span', { text: 'a definir' }))));

    if (encerrado(j) && j.video) {
      app.append(el('a', { class: 'btn-video', href: 'https://www.youtube.com/watch?v=' + encodeURIComponent(j.video), target: '_blank', rel: 'noopener' },
        el('span', { class: 'play', 'aria-hidden': 'true' }), 'Melhores momentos'));
    }

    if (!encerrado(j) && !aoVivo(j)) {
      const card = cartaoJogo(j); card.classList.remove('clicavel'); card.removeAttribute('role'); card.removeAttribute('tabindex');
      app.append(el('section', null, secHead('Antes do jogo', 'Palpite e onde assistir', null), legendaJogo(), card));
      return;
    }

    // lances: gols e cartões
    const vids = (j.gols_video || []).filter((g) => typeof g === 'object');
    const lances = e && e.lances ? e.lances : [];
    const lista = el('div', { class: 'card lances' });
    const videosGol = []; // [vídeo, lance]
    if (lances.length) {
      const usados = new Set();
      lances.forEach((l) => {
        let v = null;
        if (l.tipo === 'gol') {
          v = vids.find((g) => !usados.has(g.id) && g.lado === l.lado && g.minuto === l.minuto) || vids.find((g) => !usados.has(g.id) && g.lado === l.lado && !g.minuto);
          if (v) usados.add(v.id);
        }
        const ic = { gol: '⚽', amarelo: '', vermelho: '' }[l.tipo];
        const extra = l.contra ? ' (contra)' : l.penalti ? ' (pênalti)' : '';
        lista.append(el('div', { class: 'lance ' + l.lado },
          el('span', { class: 'lc-min num', text: l.minuto || '' }),
          el('span', { class: 'lc-ic ' + l.tipo, 'aria-label': { gol: 'Gol', amarelo: 'Cartão amarelo', vermelho: 'Cartão vermelho' }[l.tipo] }, ic),
          el('span', { class: 'lc-txt' }, el('b', { text: (l.jogador || (l.tipo === 'gol' ? 'Gol' : 'Cartão')) + extra }),
            el('span', { class: 'small', text: ' ' + (T[j[l.lado]] ? T[j[l.lado]].nome : '') }),
            l.assistencia ? el('span', { class: 'lc-ast', text: 'Assistência: ' + l.assistencia }) : null),
          v ? el('a', { class: 'chip chip-gol', href: 'https://www.youtube.com/watch?v=' + encodeURIComponent(v.id), target: '_blank', rel: 'noopener', 'aria-label': `Assistir ao gol de ${l.jogador || ''} no YouTube` }, '▶ Assistir') : null));
      });
      vids.forEach((g) => { if (!usados.has(g.id)) videosGol.push([g, null]); });
    } else if (j.gols_video && j.gols_video.length) {
      (j.gols_video || []).forEach((g) => videosGol.push([g, null]));
    } else {
      lista.append(el('p', { class: 'pad small', style: 'margin:0', text: E ? 'Ainda sem lances para mostrar.' : 'Carregando…' }));
    }
    // vídeos de gol que não casaram com nenhum lance entram no fim da mesma lista
    videosGol.forEach(([g], i) => {
      const id = typeof g === 'string' ? g : g.id;
      const lado = typeof g === 'object' ? g.lado : null;
      const quem = (typeof g === 'object' && g.jogador) || `Gol ${i + 1}`;
      lista.append(el('div', { class: 'lance ' + (lado || '') },
        el('span', { class: 'lc-min num', text: (typeof g === 'object' && g.minuto) || '' }),
        el('span', { class: 'lc-ic gol', 'aria-label': 'Gol' }, '⚽'),
        el('span', { class: 'lc-txt' }, el('b', { text: quem }), lado && T[j[lado]] ? el('span', { class: 'small', text: ' ' + T[j[lado]].nome }) : null),
        el('a', { class: 'chip chip-gol', href: 'https://www.youtube.com/watch?v=' + encodeURIComponent(id), target: '_blank', rel: 'noopener', 'aria-label': `Assistir ao gol de ${quem} no YouTube` }, '▶ Assistir')));
    });
    app.append(el('section', null, secHead('Lances', 'Gols e cartões', null), lista));

    // destaque do jogo
    if (e && e.destaque) {
      const d = e.destaque;
      const ini = d.nome.split(/\s+/).filter(Boolean).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
      app.append(el('section', null, secHead('Destaque', 'Melhor do jogo', null),
        el('div', { class: 'card destaque' },
          el('div', { class: 'dq-av', 'aria-hidden': 'true' }, el('span', { text: ini }), escudo(j[d.lado], 'md')),
          el('div', { class: 'dq-txt' },
            el('b', { text: d.nome }),
            el('span', { class: 'small', text: [T[j[d.lado]] ? T[j[d.lado]].nome : '', d.posicao].filter(Boolean).join(' · ') }),
            d.motivo ? el('span', { class: 'dq-mot', text: d.motivo }) : null))));
    }

    // estatísticas
    const box = el('div', { class: 'card estat' });
    const linhas = e ? ESTAT_LINHAS.filter(([k]) => e.casa && e.fora && (e.casa[k] != null || e.fora[k] != null)) : [];
    if (linhas.length) {
      linhas.forEach(([k, rot, suf]) => {
        const a = +(e.casa[k] || 0), b = +(e.fora[k] || 0), tot = a + b;
        const fmt = (v) => (suf === '%' ? Math.round(v) + '%' : String(v));
        const pa = tot ? (a / tot) * 100 : 50;
        box.append(el('div', { class: 'es-l' },
          el('div', { class: 'es-top' }, el('b', { class: 'num' + (a > b ? ' lider' : ''), text: fmt(a) }), el('span', { text: rot }), el('b', { class: 'num' + (b > a ? ' lider' : ''), text: fmt(b) })),
          el('div', { class: 'es-bar', role: 'img', 'aria-label': `${rot}: ${fmt(a)} a ${fmt(b)}` },
            el('span', { class: 'c', style: `width:${tot ? pa : 0}%` }), el('span', { class: 'f', style: `width:${tot ? 100 - pa : 0}%` }))));
      });
      box.prepend(el('div', { class: 'es-head' }, escudo(j.casa), el('span', { class: 'small', text: aoVivo(j) ? 'Atualiza sozinho a cada minuto' : '' }), escudo(j.fora)));
    } else {
      box.append(el('p', { class: 'pad small', style: 'margin:0', text: E ? 'As estatísticas deste jogo ainda não estão disponíveis. Elas costumam aparecer poucos minutos depois do início.' : 'Carregando estatísticas…' }));
    }
    app.append(el('section', null, secHead('Estatísticas', 'Números da partida', null), box,
      el('p', { class: 'small', text: 'Fonte das estatísticas e dos lances: ESPN.' })));
  }

  const legendaJogo = () => el('div', { class: 'legend' },
    el('span', null, el('i', { style: 'background:var(--good)' }), 'Mandante vence'),
    el('span', null, el('i', { style: 'background:var(--muted)' }), 'Empate'),
    el('span', null, el('i', { style: 'background:var(--bad)' }), 'Visitante vence'));

  // ---------- telas
  function telaInicio(app) {
    const r = rodadaAtual();
    const restamRodadas = 38 - r + 1;

    app.append(el('section', { class: 'hero hero-min', 'aria-label': 'Brasileirão' },
      el('h1', { text: `Brasileirão ${D.temporada.inicio.slice(0, 4)}` }),
      el('div', { class: 'hero-rod', text: restamRodadas > 0 ? `Rodada ${r}` : 'Campeonato encerrado' })));

    // ao vivo
    const vivos = D.jogos.filter(aoVivo);
    if (vivos.length) {
      const g = el('div', { class: 'games' });
      vivos.forEach((j) => g.append(cartaoJogo(j)));
      app.append(el('section', { id: 'ao-vivo' }, secHead('Agora', 'Ao vivo', null), g));
    }

    // panorama em abas: uma faixa por vez
    const linhaProb = (t, v, cor, extra) => el('a', { class: 'pr', href: '#clube-' + t.id },
      escudo(t.id), el('span', { class: 'pr-n', text: t.nome }),
      el('span', { class: 'pr-bar' }, el('span', { style: `width:${Math.max(v > 0 ? 2 : 0, Math.min(100, v))}%;background:${cor}` })),
      el('span', { class: 'pr-v num', text: extra || pct(v) }));
    const topo = (campo, min, max) => D.times.filter((t) => t[campo] >= min).sort((a, b) => b[campo] - a[campo]).slice(0, max);
    const faixas = [
      ['titulo', 'Título', 'Chance de ser campeão.', () => topo('titulo', 0.1, 6).map((t) => linhaProb(t, t.titulo, 'var(--accent)'))],
      ['g4', 'G4', 'Vaga direta na fase de grupos da Libertadores.', () => topo('libertadores', 1, 8).map((t) => linhaProb(t, t.libertadores, 'var(--info)'))],
      ['pre', 'Pré-Liberta', 'Terminar em 5º ou 6º: fase preliminar da Libertadores.', () => topo('pre_libertadores', 1, 8).map((t) => linhaProb(t, t.pre_libertadores, 'var(--teal)'))],
      ['sul', 'Sul-Americana', 'Terminar entre 7º e 12º.', () => topo('sulamericana', 1, 10).map((t) => linhaProb(t, t.sulamericana, 'var(--good)'))],
      ['z4', 'Z4', 'Terminar entre os quatro últimos e cair para a Série B.', () => topo('rebaixamento', 1, 10).reverse().map((t) => linhaProb(t, t.rebaixamento, 'var(--bad)', rebaixadoMatematicamente(t) ? '100%' : null))],
      ['copa', 'Copa BR', 'Quem cair perde a vaga da Copa do Brasil 2027 pela Série A (ainda pode entrar pelo estadual ou pelo ranking da CBF).', () => topo('rebaixamento', 1, 10).reverse().map((t) => linhaProb(t, t.rebaixamento, 'var(--muted)', rebaixadoMatematicamente(t) ? '100%' : null))],
    ];
    const atual = faixas.find((f) => f[0] === estado.pano) || faixas[0];
    const abas = el('div', { class: 'seg seg-scroll', role: 'group', 'aria-label': 'Faixa da tabela' });
    faixas.forEach(([k, txt]) => abas.append(el('button', { type: 'button', 'aria-pressed': String(atual[0] === k), text: txt, onclick: () => { estado.pano = k; render(); } })));
    const linhas = atual[3]();
    app.append(el('section', null, secHead('Panorama', 'Chances de cada clube', null), abas,
      el('div', { class: 'card pano' }, el('p', { class: 'small', style: 'margin:0 0 .6rem', text: atual[2] }),
        el('div', { class: 'pr-list' }, linhas.length ? linhas : el('p', { class: 'small', text: 'Ninguém com chance relevante.' })))));

    // cenários: quem ainda briga pelo G4 e contra o Z4
    if (D.cenarios && D.cenarios.length) app.append(secaoCenarios());

  }

  // ---------- cenários (G4 e Z4)
  function secaoCenarios() {
    const C = D.cenarios;
    const tem = { g4: C.some((c) => c.zona === 'g4'), z4: C.some((c) => c.zona === 'z4') };
    if (!tem[estado.cen]) estado.cen = tem.z4 ? 'z4' : 'g4';
    const z = estado.cen;
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Briga' });
    [['g4', 'Pelo G4'], ['z4', 'Contra o Z4']].forEach(([k, txt]) => {
      if (tem[k]) seg.append(el('button', { type: 'button', 'aria-pressed': String(z === k), text: txt, onclick: () => { estado.cen = k; render(); } }));
    });
    const lista = el('div', { class: 'cen-lista' });
    // G4: da maior para a menor chance; Z4: da menor para a maior chance de cair
    C.filter((c) => c.zona === z).sort((a, b) => z === 'g4' ? b.chance - a.chance : a.chance - b.chance).forEach((c) => lista.append(cartaoCenario(c)));
    return el('section', null, secHead('Cenários', 'O que cada um precisa', null), seg, lista);
  }
  const nomeT = (id) => (T[id] ? T[id].nome : '?');
  function frasesTorcida(x) {
    const j = D.jogos.find((y) => y.id === x.jogo);
    if (!j) return null;
    if (x.torcer === 'empate') return `Torcer pelo empate em ${nomeT(j.casa)} x ${nomeT(j.fora)}`;
    const quem = x.torcer === 'casa' ? j.casa : j.fora, contra = x.torcer === 'casa' ? j.fora : j.casa;
    return `Secar o ${nomeT(contra)}: torcer pelo ${nomeT(quem)}`;
  }
  function cartaoCenario(c) {
    const g4 = c.zona === 'g4';
    const t = T[c.time];
    const rot = g4 ? 'de G4' : 'de cair';
    const cor = g4 ? 'var(--info)' : 'var(--bad)';
    const dif = c.linha.dif;
    const linhaTxt = dif === 0 ? `Empatado em pontos com o ${nomeT(c.linha.time)} (${c.linha.pos}º)`
      : dif > 0 ? `${dif} ponto${dif === 1 ? '' : 's'} à frente do ${nomeT(c.linha.time)} (${c.linha.pos}º)`
        : `${-dif} ponto${dif === -1 ? '' : 's'} atrás do ${nomeT(c.linha.time)} (${c.linha.pos}º)`;
    const card = el('article', { class: 'card cen ' + c.zona },
      el('header', { class: 'cen-top' },
        el('a', { class: 'cen-time', href: '#clube-' + c.time }, escudo(c.time, 'md'),
          el('span', null, el('b', { text: t ? t.nome : '' }), el('span', { class: 'small', text: `${c.pos}º · ${c.pts} pts · ${c.jogos} jogo${c.jogos === 1 ? '' : 's'}` }))),
        el('span', { class: 'cen-chance' }, el('b', { class: 'num', style: `color:${cor}`, text: pct(c.chance) }), el('small', { text: rot }))),
      el('p', { class: 'small cen-linha', text: linhaTxt }));

    // próximo jogo
    const p = c.proximo;
    if (p) {
      const vs = `${p.em_casa ? 'x' : '@'} ${nomeT(p.adversario)}`;
      const chip = (rotulo, v, cls) => el('span', { class: 'cen-chip ' + cls }, el('small', { text: rotulo }), el('b', { class: 'num', text: v == null ? '–' : pct(v) }));
      card.append(el('div', { class: 'cen-bloco' },
        el('div', { class: 'cen-k', text: `Próximo jogo · ${p.em_casa ? 'em casa contra o' : 'fora contra o'} ${nomeT(p.adversario)}` }),
        el('div', { class: 'cen-chips' }, chip('Se vencer', p.vence, 'v'), chip('Se empatar', p.empata, 'e'), chip('Se perder', p.perde, 'd')),
        el('div', { class: 'small cen-obs', text: `Chance ${rot} depois de cada resultado.` })));
    }
    // decide na rodada
    if (c.decide) {
      const j = D.jogos.find((y) => y.id === c.decide.jogo);
      if (j) {
        const torc = c.decide.torcer === 'empate' ? `${nomeT(j.casa)} e ${nomeT(j.fora)} empatarem`
          : `o ${nomeT(c.decide.torcer === 'casa' ? j.casa : j.fora)} vencer o ${nomeT(c.decide.torcer === 'casa' ? j.fora : j.casa)}`;
        card.append(el('p', { class: 'cen-decide ' + (g4 ? 'bom' : 'ruim'),
          text: g4 ? `Praticamente garante o G4 já nesta rodada se vencer e ${torc}.`
            : `Fica praticamente rebaixado nesta rodada se perder e ${c.decide.torcer === 'empate' ? 'não houver empate entre ' + nomeT(j.casa) + ' e ' + nomeT(j.fora) : 'o ' + nomeT(c.decide.torcer === 'casa' ? j.casa : j.fora) + ' não vencer'}.` }));
      }
    }
    // quem secar
    if (c.secar && c.secar.length) {
      const ul = el('ul', { class: 'cen-secar' });
      c.secar.slice(0, 2).forEach((x) => {
        const f = frasesTorcida(x);
        if (f) ul.append(el('li', null, el('span', { text: f }), el('span', { class: 'small num', text: ` → ${pct(x.se_der)} ${rot} (senão ${pct(x.se_nao)})` })));
      });
      card.append(el('div', { class: 'cen-bloco' }, el('div', { class: 'cen-k', text: 'Quem secar nesta rodada' }), ul));
    }
    // meta de pontos
    const m = c.meta;
    card.append(el('p', { class: 'cen-meta' }, m
      ? (g4 ? `Chegando a ${m.pontos} pontos (mais ${m.faltam} em ${m.jogos} jogo${m.jogos === 1 ? '' : 's'}), a vaga fica praticamente garantida.`
        : `Chegando a ${m.pontos} pontos (mais ${m.faltam} em ${m.jogos} jogo${m.jogos === 1 ? '' : 's'}), fica praticamente livre do Z4.`)
      : (g4 ? 'Nem vencendo tudo a vaga está garantida: depende também de tropeços dos rivais.'
        : 'Nem vencendo tudo está garantido: depende também dos resultados dos rivais.')));
    return card;
  }

  function telaTabela(app) {
    app.append(secHead('Classificação', 'Tabela do Brasileirão', null, 'h1'));
    const seg = el('div', { class: 'seg quatro', role: 'group', 'aria-label': 'Visão da tabela' });
    [['classificacao', 'Classificação'], ['mandante', 'Mandante'], ['visitante', 'Visitante'], ['chances', 'Chances']].forEach(([k, txt]) => {
      seg.append(el('button', { type: 'button', 'aria-pressed': String(estado.tabela === k), text: txt, onclick: () => { estado.tabela = k; render(); } }));
    });
    app.append(seg);

    const card = el('div', { class: 'card' });
    const wrap = el('div', { class: 'tbl-wrap' });
    const tb = el('tbody');
    let head;
    if (estado.tabela === 'classificacao') {
      head = ['#', 'Clube', 'Pts', 'J', 'V', 'E', 'D', 'GP', 'GC', 'SG', 'Últimos 5'];
      D.times.forEach((t) => tb.append(el('tr', { class: 'z-' + zona(t.pos) },
        el('td', { class: 'pos', text: t.pos }),
        el('td', { class: 'sticky-col2' }, timeLinkSigla(t.id)),
        el('td', { class: 'pts', text: t.pts }), el('td', { text: t.j }), el('td', { text: t.v }), el('td', { text: t.e }), el('td', { text: t.d }),
        el('td', { text: t.gp }), el('td', { text: t.gc }), el('td', { text: sgTxt(t.sg) }),
        el('td', null, forma(t.forma)))));
    } else if (estado.tabela === 'mandante' || estado.tabela === 'visitante') {
      const casa = estado.tabela === 'mandante';
      head = ['#', 'Clube', 'Pts', 'J', 'V', 'E', 'D', 'GP', 'GC', 'SG', 'Aprov.'];
      const st = {};
      D.times.forEach((t) => { st[t.id] = { id: t.id, pts: 0, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0 }; });
      D.jogos.filter(encerrado).forEach((j) => {
        const id = casa ? j.casa : j.fora;
        const x = st[id]; if (!x) return;
        const gp = casa ? j.gols_casa : j.gols_fora, gc = casa ? j.gols_fora : j.gols_casa;
        x.j++; x.gp += gp; x.gc += gc;
        if (gp > gc) { x.v++; x.pts += 3; } else if (gp === gc) { x.e++; x.pts += 1; } else x.d++;
      });
      Object.values(st).sort((a, b) => b.pts - a.pts || b.v - a.v || (b.gp - b.gc) - (a.gp - a.gc) || b.gp - a.gp)
        .forEach((x, i) => tb.append(el('tr', null,
          el('td', { class: 'pos', text: i + 1 }),
          el('td', { class: 'sticky-col2' }, timeLinkSigla(x.id)),
          el('td', { class: 'pts', text: x.pts }), el('td', { text: x.j }), el('td', { text: x.v }), el('td', { text: x.e }), el('td', { text: x.d }),
          el('td', { text: x.gp }), el('td', { text: x.gc }), el('td', { text: sgTxt(x.gp - x.gc) }),
          el('td', { text: x.j ? Math.round(x.pts / (x.j * 3) * 100) + '%' : '—' }))));
    } else {
      head = ['#', 'Clube', 'Pts', 'Projeção', 'Título', 'G4', 'Pré-Liberta', 'Sul-Americana', 'Rebaix.'];
      D.times.slice().sort((a, b) => b.pts_projetados - a.pts_projetados).forEach((t, i) => tb.append(el('tr', { class: 'z-' + zona(i + 1) },
        el('td', { class: 'pos', text: i + 1 }),
        el('td', { class: 'sticky-col2' }, timeLinkSigla(t.id)),
        el('td', { class: 'pts', text: t.pts }), el('td', { text: n1(t.pts_projetados) }),
        el('td', null, heat(t.titulo, 'var(--accent)')), el('td', null, heat(t.libertadores, 'var(--info)')),
        el('td', null, heat(t.pre_libertadores, 'var(--teal)')), el('td', null, heat(t.sulamericana, 'var(--good)')),
        el('td', null, heat(t.rebaixamento, 'var(--bad)')))));
    }
    wrap.append(el('table', null, el('thead', null, el('tr', null, head.map((h, i) => el('th', { class: (i === 1 ? 'sticky-col2' : ''), text: h })))), tb));
    const porMando = estado.tabela === 'mandante' || estado.tabela === 'visitante';
    if (porMando) card.append(wrap, el('div', { class: 'zones' }, el('span', { text: estado.tabela === 'mandante'
      ? 'Só os jogos em casa. Aprov. = aproveitamento dos pontos disputados.'
      : 'Só os jogos fora de casa. Aprov. = aproveitamento dos pontos disputados.' })));
    else card.append(wrap, el('div', { class: 'zones' },
      el('span', null, el('i', { style: 'background:var(--info)' }), 'Libertadores'),
      el('span', null, el('i', { style: 'background:var(--teal)' }), 'Pré-Libertadores'),
      el('span', null, el('i', { style: 'background:var(--good)' }), 'Sul-Americana'),
      el('span', null, el('i', { style: 'background:var(--bad)' }), 'Rebaixamento'),
      estado.tabela === 'chances' ? el('span', { text: 'Ordenada pela projeção de pontos' }) : null));
    if (porMando) { app.append(card); return; }
    app.append(card, el('p', { class: 'small', text: 'As vagas em Libertadores e Sul-Americana podem mudar conforme os campeões da Copa do Brasil e das competições continentais.' }));
  }

  function telaRodadas(app) {
    if (estado.rodada == null) estado.rodada = rodadaAtual();
    const r = estado.rodada;
    const atual = rodadaAtual();
    app.append(secHead('Todas as rodadas', 'Rodadas', null, 'h1'));
    const chips = el('div', { class: 'rounds', role: 'group', 'aria-label': 'Escolha a rodada' });
    for (let i = 1; i <= 38; i++) {
      const feitos = D.jogos.filter((j) => j.rodada === i).every(encerrado);
      chips.append(el('button', {
        type: 'button', 'aria-pressed': String(i === r), class: (feitos ? 'done' : '') + (i === atual ? ' atual' : ''),
        'aria-label': `${i}ª rodada`, text: i, onclick: () => { estado.rodada = i; render(); },
      }));
    }
    app.append(chips);
    const nav = el('div', { class: 'round-nav' },
      el('h2', { text: `${r}ª rodada` }),
      el('div', { class: 'arrows' },
        el('button', { class: 'btn', type: 'button', disabled: r <= 1, 'aria-label': 'Rodada anterior', text: '←', onclick: () => { estado.rodada = r - 1; render(); } }),
        el('button', { class: 'btn', type: 'button', disabled: r >= 38, 'aria-label': 'Próxima rodada', text: '→', onclick: () => { estado.rodada = r + 1; render(); } })));
    app.append(nav);
    const jogos = D.jogos.filter((j) => j.rodada === r).sort((a, b) => a.data.localeCompare(b.data));
    if (jogos.some((j) => !encerrado(j))) app.append(legendaJogo());
    const g = el('div', { class: 'games' });
    jogos.forEach((j) => g.append(cartaoJogo(j)));
    app.append(g);
    requestAnimationFrame(() => {
      const b = chips.querySelector('[aria-pressed="true"]');
      if (b) chips.scrollLeft = b.offsetLeft - chips.clientWidth / 2 + b.clientWidth / 2;
    });
  }

  function linhaJogador(p, rank, modo) {
    const t = T[p.time];
    const quem = el('div', { class: 'who' },
      p.pid ? el('a', { class: 'pl-nome', href: '#jogador-' + p.pid }, el('b', { text: p.nome })) : el('b', { text: p.nome }),
      el('span', { class: 'small' }, escudo(p.time), el('a', { href: '#clube-' + p.time, text: t ? t.nome : '' }), ` · ${p.jogos} jogos`));
    const valor = modo === 'gols' ? p.gols : p.assistencias;
    const stat = el('div', { class: 'stat' },
      el('div', { class: 'big num' }, String(valor), el('small', { text: modo === 'gols' ? 'gols' : 'assist.' })));
    return el('div', { class: 'pl' }, el('span', { class: 'rk num', text: rank }), quem, stat);
  }

  // ---------- jogadores
  const GRUPO_POS = (pos) => /goleiro/i.test(pos || '') ? 0 : /zagueiro|lateral|ala|defensor/i.test(pos || '') ? 1 : /meia|volante|meio/i.test(pos || '') ? 2 : /atacante|ponta/i.test(pos || '') ? 3 : 4;
  const NOME_GRUPO = ['Goleiros', 'Defensores', 'Meio-campistas', 'Atacantes', 'Só entraram no decorrer dos jogos'];
  function telaJogadores(app) {
    app.append(secHead('Jogadores', 'Jogadores do Brasileirão', null, 'h1'));
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Visão' });
    [['clube', 'Por clube'], ['gols', 'Artilheiros'], ['assistencias', 'Garçons']].forEach(([k, txt]) => {
      seg.append(el('button', { type: 'button', 'aria-pressed': String(estado.artilharia === k), text: txt, onclick: () => { estado.artilharia = k; render(); } }));
    });
    app.append(seg);
    if (estado.artilharia === 'clube') return jogadoresPorClube(app);
    const modo = estado.artilharia;
    const fonte = P && P.jogadores && P.jogadores.length
      ? P.jogadores.map((x) => ({ pid: x.id, nome: x.nome, time: x.clube, jogos: x.jogos, gols: x.gols, assistencias: x.assist }))
      : D.jogadores;
    const lista = fonte.filter((p) => (modo === 'gols' ? p.gols : p.assistencias) > 0)
      .sort((a, b) => modo === 'gols' ? (b.gols - a.gols || b.assistencias - a.assistencias || a.jogos - b.jogos) : (b.assistencias - a.assistencias || b.gols - a.gols || a.jogos - b.jogos))
      .slice(0, 50);
    const card = el('div', { class: 'card players' });
    let rank = 0, ultimo = null;
    lista.forEach((p, i) => {
      const v = modo === 'gols' ? p.gols : p.assistencias;
      if (v !== ultimo) { rank = i + 1; ultimo = v; }
      card.append(linhaJogador(p, rank, modo === 'gols' ? 'gols' : 'assist'));
    });
    app.append(card);
  }

  function jogadoresPorClube(app) {
    const times = D.times.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    if (!estado.jogClube) estado.jogClube = String(times[0].id);
    const filtro = el('div', { class: 'clubes-filtro', role: 'group', 'aria-label': 'Escolha o clube' });
    times.forEach((t) => filtro.append(el('button', { type: 'button', 'aria-pressed': String(estado.jogClube === String(t.id)), 'aria-label': t.nome, title: t.nome,
      onclick: () => { estado.jogClube = String(t.id); render(); } }, escudo(t.id, 'tb'))));
    app.append(filtro);
    if (!P) { app.append(el('p', { class: 'small', text: 'Carregando jogadores…' })); carregarJogadores(); return; }
    const cid = +estado.jogClube;
    const elenco = (P.jogadores || []).filter((x) => x.clube === cid)
      .sort((a, b) => GRUPO_POS(a.pos) - GRUPO_POS(b.pos) || b.jogos - a.jogos || a.nome.localeCompare(b.nome));
    if (!elenco.length) { app.append(el('div', { class: 'card pad' }, el('p', { class: 'small', style: 'margin:0', text: 'Os jogadores deste clube aparecem aqui na próxima atualização do robô.' }))); return; }
    const t = T[cid];
    app.append(el('div', { class: 'arb-clube', style: 'margin-bottom:.8rem' }, escudo(cid, 'md'), el('div', null, el('b', { text: t ? t.nome : '' }),
      el('div', { class: 'small', text: `${elenco.length} jogadores usados na temporada` }))));
    let grupoAtual = -1, tb = null;
    const blocos = el('div', { class: 'jg-blocos' });
    elenco.forEach((x) => {
      const g = GRUPO_POS(x.pos);
      if (g !== grupoAtual) {
        grupoAtual = g;
        tb = el('tbody');
        const goleiro = g === 0;
        blocos.append(el('div', { class: 'card' }, el('div', { class: 'eyebrow pad', style: 'padding-bottom:0', text: NOME_GRUPO[g] }),
          el('div', { class: 'tbl-wrap' }, el('table', { class: 'jg-tbl' },
            el('thead', null, el('tr', null, el('th', { class: 'l sticky-col', text: 'Jogador' }), el('th', { text: 'J', title: 'Jogos' }), el('th', { text: 'Tit', title: 'Titular' }),
              goleiro ? el('th', { text: 'Def', title: 'Defesas' }) : el('th', { text: 'G', title: 'Gols' }),
              goleiro ? el('th', { text: 'GS', title: 'Gols sofridos' }) : el('th', { text: 'A', title: 'Assistências' }),
              goleiro ? el('th', { text: 'SG', title: 'Jogos sem sofrer gol' }) : el('th', { text: 'Chutes', title: 'Finalizações' }),
              goleiro ? null : el('th', { text: 'No gol', title: 'Chutes no gol' }),
              el('th', { title: 'Amarelos' }, el('i', { class: 'cart am', 'aria-label': 'Amarelos' })), el('th', { title: 'Vermelhos' }, el('i', { class: 'cart vm', 'aria-label': 'Vermelhos' })))),
            tb))));
      }
      const goleiro = g === 0;
      tb.append(el('tr', { class: 'clicavel', onclick: () => { location.hash = '#jogador-' + x.id; } },
        el('td', { class: 'l sticky-col' }, el('a', { class: 'jg-nome', href: '#jogador-' + x.id, text: x.nome })),
        el('td', { class: 'num', text: x.jogos }), el('td', { class: 'num', text: x.titular || 0 }),
        el('td', { class: 'num', text: goleiro ? (x.defesas || 0) : x.gols }), el('td', { class: 'num', text: goleiro ? (x.gols_sofridos || 0) : x.assist }),
        el('td', { class: 'num', text: goleiro ? (x.sem_sofrer || 0) : (x.chutes || 0) }),
        goleiro ? null : el('td', { class: 'num', text: x.no_alvo || 0 }),
        el('td', { class: 'num', text: x.amarelos || 0 }), el('td', { class: 'num', text: x.vermelhos || 0 })));
    });
    app.append(blocos);
    app.append(el('p', { class: 'small', text: 'Toque no jogador para ver a ficha completa. Fonte: ESPN.' }));
  }

  function telaJogador(app, pid) {
    app.append(el('a', { class: 'back', href: '#jogadores', text: '← Jogadores', onclick: () => { estado.artilharia = 'clube'; } }));
    if (!P) { app.append(el('p', { class: 'small', text: 'Carregando…' })); carregarJogadores(); return; }
    const x = (P.jogadores || []).find((y) => y.id === pid);
    if (!x) { app.append(el('p', { class: 'erro', text: 'Jogador não encontrado.' })); return; }
    estado.jogClube = String(x.clube);
    const t = T[x.clube];
    const goleiro = GRUPO_POS(x.pos) === 0;
    const iniciais = (x.nome || '?').split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
    app.append(el('header', { class: 'card jg-ficha' },
      el('div', { class: 'dq-av' }, el('span', { text: iniciais }), escudo(x.clube, 'md')),
      el('div', null, el('h1', { class: 'jg-h1', text: x.nome }),
        el('div', { class: 'small' }, el('a', { href: '#clube-' + x.clube, text: t ? t.nome : '' }), x.pos ? ` · ${x.pos}` : '', x.camisa ? ` · camisa ${x.camisa}` : ''))));
    // ranking entre todos os jogadores do campeonato
    const todos = P.jogadores || [];
    const pos = (campo) => { const v = x[campo] || 0; if (!v) return null; return 1 + todos.filter((y) => (y[campo] || 0) > v).length; };
    const por = (v) => x.jogos ? ((v || 0) / x.jogos).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '–';
    const tile = (rot, val, sub, campo) => {
      const r = campo ? pos(campo) : null;
      return el('div', { class: 'es-t' }, el('small', { text: rot }),
        el('div', { class: 'es-v' }, el('b', { class: 'num', text: String(val) }), r && r <= 50 ? el('span', { class: 'es-r ' + (r <= 10 ? 'top' : ''), title: `${r}º no campeonato`, text: `${r}º` }) : null),
        sub ? el('small', { text: sub }) : null);
    };
    const grupo = (titulo, tiles) => el('div', { class: 'card es-g' }, el('div', { class: 'eyebrow', text: titulo }), el('div', { class: 'es-grid' }, tiles.filter(Boolean)));
    const pctTxt2 = (a, b) => b ? Math.round(100 * a / b) + '%' : '–';
    const grupos = [grupo('Participação', [tile('Jogos', x.jogos, `${x.titular || 0} como titular · ${x.entrou || 0} saindo do banco`, 'jogos'),
      tile('Participações em gol', (x.gols || 0) + (x.assist || 0), 'gols + assistências', null)])];
    if (goleiro) {
      grupos.push(grupo('Goleiro', [tile('Defesas', x.defesas || 0, `${por(x.defesas)} por jogo`, 'defesas'),
        tile('Gols sofridos', x.gols_sofridos || 0, `${por(x.gols_sofridos)} por jogo`, null),
        tile('Jogos sem sofrer gol', x.sem_sofrer || 0, null, 'sem_sofrer'),
        tile('Defesas a cada 100 chutes no gol', (x.defesas || 0) + (x.gols_sofridos || 0) ? Math.round(100 * (x.defesas || 0) / ((x.defesas || 0) + (x.gols_sofridos || 0))) : '–', null, null)]));
    }
    grupos.push(grupo('Ataque', [tile('Gols', x.gols || 0, `${por(x.gols)} por jogo`, 'gols'), tile('Assistências', x.assist || 0, `${por(x.assist)} por jogo`, 'assist'),
      tile('Finalizações', x.chutes || 0, `${por(x.chutes)} por jogo`, 'chutes'), tile('Chutes no gol', x.no_alvo || 0, `${pctTxt2(x.no_alvo || 0, x.chutes || 0)} das finalizações`, 'no_alvo'),
      tile('Gols por finalização', pctTxt2(x.gols || 0, x.chutes || 0), null, null), tile('Impedimentos', x.impedimentos || 0, null, null)]));
    grupos.push(grupo('Disciplina', [tile('Faltas cometidas', x.faltas || 0, `${por(x.faltas)} por jogo`, null), tile('Faltas sofridas', x.sofridas || 0, `${por(x.sofridas)} por jogo`, 'sofridas'),
      tile('Cartões amarelos', x.amarelos || 0, null, null), tile('Cartões vermelhos', x.vermelhos || 0, null, null),
      x.contra ? tile('Gols contra', x.contra, null, null) : null]));
    app.append(el('section', null, secHead('Temporada', 'Números do jogador', null), el('div', { class: 'es-wrap' }, grupos)));
    // últimos jogos
    if (x.ultimos && x.ultimos.length) {
      const card = el('div', { class: 'card list-games' });
      x.ultimos.slice().reverse().forEach(([jid, g, a, tit]) => {
        const j = D.jogos.find((y) => y.id === jid);
        if (!j) return;
        const emCasa = j.casa === x.clube, adv = emCasa ? j.fora : j.casa;
        const feito = [g ? `${g} gol${g > 1 ? 's' : ''}` : '', a ? `${a} assist.` : ''].filter(Boolean).join(' · ') || (tit ? 'Titular' : 'Entrou');
        card.append(el('a', { class: 'lg', href: '#jogo-' + j.id, style: 'text-decoration:none;color:inherit' },
          el('span', { class: 'small num', text: `R${j.rodada}` }),
          el('span', { class: 'team' }, el('span', { class: 'small', text: emCasa ? 'vs' : '@' }), escudo(adv), el('span', { text: T[adv] ? T[adv].nome : '' }), el('span', { class: 'small num', text: ` ${j.gols_casa}–${j.gols_fora}` })),
          el('span', { class: 'small', text: feito })));
      });
      app.append(el('section', null, secHead('Jogos', 'Últimos jogos', null), card));
    }
    app.append(el('p', { class: 'small', text: 'Números somados jogo a jogo da temporada. O número ao lado é a posição do jogador entre todos do campeonato. Fonte: ESPN.' }));
  }

  function telaClube(app, id) {
    const t = T[id];
    if (!t) { app.append(el('p', { class: 'erro', text: 'Clube não encontrado.' })); return; }
    app.append(el('a', { class: 'back', href: '#tabela', text: '← Tabela' }));
    app.append(el('header', { class: 'club-head' }, escudo(id, 'lg'),
      el('div', null, el('div', { class: 'eyebrow', text: `${t.pos}º colocado` }), el('h1', { text: t.nome }))));

    const kp = el('div', { class: 'kpis' });
    [['Pontos', t.pts], ['Projeção', n1(t.pts_projetados)], ['Posição média', n1(t.pos_media) + 'º'], ['Campanha', `${t.v}V ${t.e}E ${t.d}D`],
      ['Saldo', sgTxt(t.sg)], ['Em casa', `${t.casa.gp} gols em ${t.casa.j}`], ['Fora', `${t.fora.gp} gols em ${t.fora.j}`]]
      .forEach(([k, v]) => kp.append(el('div', { class: 'card kpi' }, el('div', { class: 'k', text: k }), el('div', { class: 'v num', text: v }))));
    app.append(kp);

    // chances por faixa
    const faixas = el('div', { class: 'card pad' });
    [['Título', t.titulo, 'var(--accent)'], ['Libertadores (G4)', t.libertadores, 'var(--info)'], ['Pré-Libertadores', t.pre_libertadores, 'var(--teal)'],
      ['Sul-Americana', t.sulamericana, 'var(--good)'], ['Rebaixamento', t.rebaixamento, 'var(--bad)']].forEach(([k, v, c]) => {
      faixas.append(el('div', { style: 'display:grid;grid-template-columns:minmax(110px,150px) 1fr 4.5rem;gap:.7rem;align-items:center;margin-bottom:.55rem' },
        el('span', { style: 'font-weight:600', text: k }),
        el('div', { class: 'meter', style: 'height:10px' }, el('span', { style: `width:${Math.max(v > 0 ? 1.5 : 0, v)}%;background:${c}` })),
        el('span', { class: 'num', style: 'text-align:right;font-family:var(--display);font-weight:800;font-size:1.15rem', text: pct(v) })));
    });

    // distribuição de posição final
    const dist = el('div', { class: 'dist' });
    const distCard = el('div', { class: 'card pad' }, el('div', { class: 'eyebrow', text: 'Onde deve terminar' }), el('p', { class: 'small', style: 'margin:.2rem 0 0', text: 'Chance de terminar em cada posição.' }), dist);
    app.append(el('section', { class: 'split' }, el('div', null, secHead('Chances', 'Para onde vai', null), faixas), el('div', null, secHead('Posição final', 'Distribuição', null), distCard)));
    requestAnimationFrame(() => desenharDist(dist, t));

    // estatísticas da temporada
    if (t.estat) app.append(secaoEstatClube(t));

    // jogos
    const meus = D.jogos.filter((j) => j.casa === id || j.fora === id);
    const feitos = meus.filter(encerrado).sort((a, b) => b.data.localeCompare(a.data)).slice(0, 8);
    const faltam = meus.filter((j) => !encerrado(j)).sort((a, b) => a.data.localeCompare(b.data));
    const linha = (j) => {
      const emCasa = j.casa === id;
      const adv = emCasa ? j.fora : j.casa;
      let res, txt;
      if (encerrado(j)) {
        const gp = emCasa ? j.gols_casa : j.gols_fora, gc = emCasa ? j.gols_fora : j.gols_casa;
        res = gp > gc ? 'V' : gp === gc ? 'E' : 'D';
        txt = `${j.gols_casa}–${j.gols_fora}`;
      } else {
        res = 'P';
        const p = j.previsao;
        txt = p ? pct(emCasa ? p.casa : p.fora) : '—';
      }
      return el('div', { class: 'lg' },
        el('span', { class: 'small num', text: `R${j.rodada} · ${new Date(j.data).toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' })}` }),
        el('span', { class: 'team' }, el('span', { class: 'small', text: emCasa ? 'vs' : '@' }), escudo(adv), el('a', { href: '#clube-' + adv, text: T[adv] ? T[adv].nome : '' })),
        el('span', { class: 'res num ' + res, title: res === 'P' ? 'Chance de vitória' : '', text: txt }));
    };
    const colA = el('div', { class: 'card list-games' }); faltam.forEach((j) => colA.append(linha(j)));
    if (!faltam.length) colA.append(el('p', { class: 'pad small', text: 'Sem jogos restantes.' }));
    const colB = el('div', { class: 'card list-games' }); feitos.forEach((j) => colB.append(linha(j)));
    app.append(el('section', { class: 'split' },
      el('div', null, secHead('Próximos jogos', 'O que falta', null), colA),
      el('div', null, secHead('Resultados', 'Últimos jogos', null), colB)));

    const nc = noticiasDe(String(id)).slice(0, 4);
    if (nc.length) {
      const card = el('div', { class: 'card news' });
      nc.forEach(([n, cid]) => card.append(linhaNoticia(n, cid)));
      app.append(el('section', null, secHead('Notícias', 'Últimas do ge', null), card,
        el('p', null, el('a', { href: '#noticias', text: 'Ver todas as notícias →', onclick: () => { estado.clubeNoticias = String(id); } }))));
    }

    // jogadores
    const js = D.jogadores.filter((p) => p.time === id).sort((a, b) => b.gols - a.gols || b.assistencias - a.assistencias);
    if (js.length) {
      const lista = el('div', { class: 'card players' });
      js.forEach((p, i) => lista.append(linhaJogador(p, i + 1, 'gols')));
      app.append(el('section', null, secHead('Elenco', 'Artilheiros do clube', null), lista));
    }
  }

  function secaoEstatClube(t) {
    const x = t.estat, rk = x.rank || {};
    const n1v = (v) => (v == null ? '–' : (+v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }));
    const n2v = (v) => (v == null ? '–' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    const tile = (rot, val, chave) => {
      const r = chave ? rk[chave] : null;
      return el('div', { class: 'es-t' }, el('small', { text: rot }),
        el('div', { class: 'es-v' }, el('b', { class: 'num', text: val }),
          r ? el('span', { class: 'es-r ' + (r <= 4 ? 'top' : r >= 17 ? 'bot' : ''), title: `${r}º entre os 20 clubes`, text: `${r}º` }) : null));
    };
    const grupo = (titulo, tiles) => el('div', { class: 'card es-g' }, el('div', { class: 'eyebrow', text: titulo }), el('div', { class: 'es-grid' }, tiles));
    const jogoTxt = (id) => {
      const j = D.jogos.find((y) => y.id === id);
      if (!j) return null;
      return el('a', { href: '#jogo-' + j.id, text: `${T[j.casa] ? T[j.casa].nome : ''} ${j.gols_casa}×${j.gols_fora} ${T[j.fora] ? T[j.fora].nome : ''}` });
    };
    const grade = el('div', { class: 'es-wrap' },
      grupo('Ataque', [tile('Gols por jogo', n2v(x.gols_jogo), 'gols_jogo'), tile('Finalizações', n1v(x.finalizacoes), 'finalizacoes'),
        tile('Chutes no gol', n1v(x.no_alvo), 'no_alvo'), tile('Gols a cada 100 chutes no gol', n1v(x.aproveitamento_chutes), 'aproveitamento_chutes'),
        tile('Escanteios', n1v(x.escanteios), 'escanteios'), tile('Gols de pênalti', String(x.g_pen), null)]),
      grupo('Defesa', [tile('Gols sofridos por jogo', n2v(x.sofridos_jogo), 'sofridos_jogo'), tile('Jogos sem sofrer gol', String(x.sem_sofrer), 'sem_sofrer'),
        tile('Finalizações sofridas', n1v(x.finalizacoes_sofridas), 'finalizacoes_sofridas'), tile('Chutes no gol sofridos', n1v(x.no_alvo_sofridos), 'no_alvo_sofridos'),
        tile('Defesas do goleiro', n1v(x.defesas), null), tile('Pênaltis sofridos (gols)', String(x.s_pen), null)]),
      grupo('Estilo', [tile('Posse de bola', n1v(x.posse) + '%', 'posse'), tile('Passes', n1v(x.passes), 'passes'),
        tile('Acerto de passes', n1v(x.precisao_passes) + '%', 'precisao_passes'), tile('Impedimentos', n1v(x.impedimentos), null)]),
      grupo('Disciplina', [tile('Faltas cometidas', n1v(x.faltas), 'faltas'), tile('Faltas sofridas', n1v(x.faltas_sofridas), null),
        tile('Cartões amarelos', String(x.amarelos), 'amarelos'), tile('Cartões vermelhos', String(x.vermelhos), 'vermelhos')]),
      grupo('Momentos do jogo', [tile('Gols no 1º tempo (pró × contra)', `${x.g1t} × ${x.s1t}`, null), tile('Gols no 2º tempo (pró × contra)', `${x.g2t} × ${x.s2t}`, null),
        tile('Gols marcados após os 75′', String(x.g_final), 'g_final'), tile('Gols sofridos após os 75′', String(x.s_final), 's_final'),
        tile(`Pontos buscados saindo atrás (${x.saiu_atras} jogos)`, String(x.virada_pts), 'virada_pts'), tile(`Pontos cedidos estando na frente (${x.saiu_frente} jogos)`, String(x.cedeu_pts), 'cedeu_pts')]));
    const extremos = el('div', { class: 'es-ext small' },
      x.maior_v ? el('span', null, 'Maior vitória: ', jogoTxt(x.maior_v)) : null,
      x.maior_d ? el('span', null, 'Maior derrota: ', jogoTxt(x.maior_d)) : null);
    return el('section', null, secHead('Estatísticas', 'Números da temporada', null), grade, extremos,
      el('p', { class: 'small', text: 'Médias por jogo. O número ao lado é a posição do clube entre os 20 (1º = melhor). Fonte: ESPN.' }));
  }

  function desenharDist(box, t) {
    const W = box.clientWidth || 320, H = box.clientHeight || 170;
    const m = { t: 18, r: 4, b: 18, l: 4 };
    const n = t.dist_pos.length;
    const bw = (W - m.l - m.r) / n;
    const max = Math.max(...t.dist_pos, 1);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Chance de ${t.nome} terminar em cada posição`);
    const tip = el('div', { class: 'tip', hidden: true });
    t.dist_pos.forEach((v, i) => {
      const pos = i + 1;
      const h = (H - m.t - m.b) * v / max;
      const x = m.l + i * bw;
      const cor = { lib: 'var(--info)', pre: 'var(--teal)', sul: 'var(--good)', reb: 'var(--bad)', mid: 'var(--muted)' }[zona(pos)];
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', x + 1); r.setAttribute('y', H - m.b - h); r.setAttribute('width', Math.max(1, bw - 2)); r.setAttribute('height', Math.max(v > 0 ? 1.5 : 0, h));
      r.setAttribute('rx', 2); r.style.fill = cor; r.style.opacity = v > 0 ? 1 : 0;
      svg.append(r);
      const hit = document.createElementNS(ns, 'rect');
      hit.setAttribute('x', x); hit.setAttribute('y', m.t); hit.setAttribute('width', bw); hit.setAttribute('height', H - m.t - m.b); hit.style.fill = 'transparent';
      hit.addEventListener('pointerenter', () => { tip.hidden = false; tip.textContent = `${pos}º lugar: ${pct(v)}`; tip.style.left = Math.min(Math.max(0, x - 30), W - 110) + 'px'; tip.style.top = '0px'; });
      hit.addEventListener('pointerleave', () => { tip.hidden = true; });
      svg.append(hit);
      if (pos === 1 || pos % 5 === 0 || pos === n) {
        const tx = document.createElementNS(ns, 'text');
        tx.setAttribute('x', x + bw / 2); tx.setAttribute('y', H - 4); tx.setAttribute('text-anchor', 'middle'); tx.textContent = pos + 'º';
        svg.append(tx);
      }
      if (v === max) {
        const tv = document.createElementNS(ns, 'text');
        tv.setAttribute('x', Math.min(Math.max(x + bw / 2, 20), W - 20)); tv.setAttribute('y', H - m.b - h - 5); tv.setAttribute('text-anchor', 'middle');
        tv.style.fontWeight = '700'; tv.style.fill = 'var(--fg)'; tv.textContent = pct(v);
        svg.append(tv);
      }
    });
    box.replaceChildren(svg, tip);
  }

  function haQuanto(iso) {
    if (!iso) return '';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? 'ontem' : `há ${d} dias`;
  }
  function linhaNoticia(n, id) {
    return el('a', { class: 'nw', href: n.link, target: '_blank', rel: 'noopener' },
      escudo(+id, 'md'),
      el('div', null, el('b', { text: n.titulo }),
        el('span', { class: 'small', text: [T[id] ? T[id].nome : '', haQuanto(n.data), 'ge'].filter(Boolean).join(' · ') })));
  }
  function noticiasDe(id) {
    if (!N || !N.clubes) return [];
    if (id !== 'todos') return (N.clubes[id] || []).map((n) => [n, id]);
    const todas = [];
    Object.entries(N.clubes).forEach(([cid, l]) => l.forEach((n) => todas.push([n, cid])));
    const vistos = new Set();
    return todas.filter(([n]) => (vistos.has(n.link) ? false : vistos.add(n.link)))
      .sort((a, b) => (b[0].data || '').localeCompare(a[0].data || '')).slice(0, 40);
  }
  // ---------- arbitragem
  function arbitroDoJogo(j) {
    return j.arbitro || (E && E.jogos && E.jogos[j.id] && E.jogos[j.id].arbitro) || null;
  }
  const media = (n, d, casas = 1) => d ? (n / d).toFixed(casas).replace('.', ',') : '–';
  const pctTxt = (n, d) => d ? Math.round(100 * n / d) + '%' : '–';
  const VAR_TXT = { penalti_marcado: 'Pênalti marcado pelo VAR', penalti_anulado: 'Pênalti anulado pelo VAR', gol_anulado: 'Gol anulado pelo VAR', gol_validado: 'Gol validado pelo VAR', vermelho_anulado: 'Expulsão anulada pelo VAR', vermelho: 'Expulsão após revisão do VAR' };

  function telaArbitragem(app) {
    const A = D.arbitragem;
    app.append(secHead('Arbitragem', 'Árbitros e VAR', null, 'h1'));
    if (!A || !A.arbitros) {
      app.append(el('div', { class: 'card pad' }, el('p', { class: 'small', style: 'margin:0', text: 'Os dados de arbitragem aparecem aqui na próxima atualização do robô.' })));
      return;
    }
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Visão da arbitragem' });
    [['arbitros', 'Árbitros'], ['clube', 'Por clube'], ['var', 'VAR']].forEach(([k, txt]) => {
      seg.append(el('button', { type: 'button', 'aria-pressed': String(estado.arb === k), text: txt, onclick: () => { estado.arb = k; render(); } }));
    });
    app.append(seg);
    if (A.ate_rodada) app.append(el('p', { class: 'small arb-ate', text: `Atualizado ao fim de cada rodada · dados até a ${A.ate_rodada}ª rodada` }));
    if (estado.arb === 'clube') arbClube(app, A);
    else if (estado.arb === 'var') arbVar(app, A);
    else arbArbitros(app, A);
    app.append(el('p', { class: 'small nota-arb', text: `Árbitros: football-data e ESPN. Cartões, faltas, pênaltis e VAR: ESPN, disponíveis em ${A.jogos_com_espn} de ${A.jogos_encerrados} jogos — o robô completa o restante aos poucos. Médias de cartões e pênaltis consideram só os jogos com esses dados.` }));
  }

  function arbArbitros(app, A) {
    const lista = el('div', { class: 'arb-lista' });
    A.arbitros.forEach((a) => {
      const aberto = estado.arbAberto === a.nome;
      const n = a.com_dados;
      const det = el('details', { class: 'card arb', open: aberto || null, ontoggle: (ev) => { if (ev.target.open) estado.arbAberto = a.nome; } },
        el('summary', null,
          el('span', { class: 'arb-nome' }, el('b', { text: a.nome }), el('span', { class: 'small', text: `${a.jogos} jogo${a.jogos === 1 ? '' : 's'}` })),
          el('span', { class: 'arb-kpis' },
            el('span', { class: 'kpi' }, el('i', { class: 'cart am', 'aria-hidden': 'true' }), el('b', { class: 'num', text: media(a.amarelos, n) }), el('small', { text: 'por jogo' })),
            el('span', { class: 'kpi' }, el('i', { class: 'cart vm', 'aria-hidden': 'true' }), el('b', { class: 'num', text: String(n ? a.vermelhos : '–') }), el('small', { text: 'vermelhos' })))));
      const m = a.mandante;
      det.append(el('div', { class: 'arb-grid' },
        bloco('Jogos', a.jogos), bloco('Com dados', n),
        bloco('Amarelos', n ? a.amarelos : '–'), bloco('Vermelhos', n ? a.vermelhos : '–'),
        bloco('Faltas por jogo', media(a.faltas, n)), bloco('Pênaltis', n ? a.penaltis : '–'),
        bloco('Pênaltis por jogo', media(a.penaltis, n, 2)), bloco('Gols por jogo', media(a.gols_pro, a.jogos)), bloco('Chamadas do VAR', n ? (a.var_chamadas || 0) : '–'),
        bloco('Mandante vence', pctTxt(m[0], a.jogos)), bloco('Empates', pctTxt(m[1], a.jogos)), bloco('Visitante vence', pctTxt(m[2], a.jogos))));
      // clubes com esse árbitro
      const linhas = Object.entries(a.clubes).sort((x, y) => y[1].jogos - x[1].jogos || (T[x[0]] ? T[x[0]].nome : '').localeCompare(T[y[0]] ? T[y[0]].nome : ''));
      det.append(tabelaClubes(linhas.map(([cid, c]) => [escudoLink(+cid), c]), 'Clube', false));
      const ult = (a.ultimos || []).map((id) => D.jogos.find((j) => j.id === id)).filter(Boolean).reverse();
      if (ult.length) {
        const ul = el('div', { class: 'arb-ult' }, el('span', { class: 'tv-k', text: 'Últimos jogos' }));
        ult.forEach((j) => ul.append(el('a', { class: 'chip', href: '#jogo-' + j.id, text: `${T[j.casa] ? T[j.casa].sigla : ''} ${j.gols_casa}×${j.gols_fora} ${T[j.fora] ? T[j.fora].sigla : ''}` })));
        det.append(ul);
      }
      lista.append(det);
    });
    app.append(lista);
    if (estado.arbAberto) setTimeout(() => { const d = app.querySelector('details[open]'); if (d) d.scrollIntoView({ block: 'start' }); }, 0);
  }
  function bloco(rot, val) {
    return el('div', { class: 'arb-b' }, el('small', { text: rot }), el('b', { class: 'num', text: String(val) }));
  }
  function escudoLink(cid) {
    return el('a', { href: '#clube-' + cid, 'aria-label': T[cid] ? T[cid].nome : '', title: T[cid] ? T[cid].nome : '' }, escudo(cid, 'tb'));
  }
  // tabela de desempenho: primeira coluna = clube ou árbitro
  function tabelaClubes(linhas, rotulo, comVar = true) {
    const tb = el('tbody');
    linhas.forEach(([quem, c]) => {
      const n = c.com_dados;
      tb.append(el('tr', null,
        el('td', { class: 'l sticky-col' }, quem),
        el('td', { class: 'num', text: c.jogos }),
        el('td', { class: 'num', text: c.v }), el('td', { class: 'num', text: c.e }), el('td', { class: 'num', text: c.d }),
        el('td', { class: 'num', text: `${c.gols_pro}:${c.gols_contra}` }),
        el('td', { class: 'num', text: n ? c.amarelos : '–' }), el('td', { class: 'num', text: n ? c.vermelhos : '–' }),
        el('td', { class: 'num', text: n ? `${c.pen_favor}/${c.pen_contra}` : '–' }),
        comVar ? el('td', { class: 'num', text: n ? `${c.var_favor}/${c.var_contra}` : '–' }) : null));
    });
    return el('div', { class: 'tbl-wrap' }, el('table', { class: 'arb-tbl' },
      el('thead', null, el('tr', null, el('th', { class: 'l sticky-col', text: rotulo }), el('th', { text: 'J', title: 'Jogos' }),
        el('th', { text: 'V', title: 'Vitórias' }), el('th', { text: 'E', title: 'Empates' }), el('th', { text: 'D', title: 'Derrotas' }),
        el('th', { text: 'Gols', title: 'Gols pró : contra' }),
        el('th', { title: 'Cartões amarelos recebidos' }, el('i', { class: 'cart am', 'aria-label': 'Amarelos' })),
        el('th', { title: 'Cartões vermelhos recebidos' }, el('i', { class: 'cart vm', 'aria-label': 'Vermelhos' })),
        el('th', { text: 'Pên.', title: 'Pênaltis a favor / contra' }), comVar ? el('th', { text: 'VAR', title: 'Decisões do VAR a favor / contra' }) : null)),
      tb));
  }

  function arbClube(app, A) {
    if (!estado.arbClube) estado.arbClube = String(D.times.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))[0].id);
    const filtro = el('div', { class: 'clubes-filtro', role: 'group', 'aria-label': 'Escolha o clube' });
    D.times.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).forEach((t) => {
      filtro.append(el('button', { type: 'button', 'aria-pressed': String(estado.arbClube === String(t.id)), 'aria-label': t.nome, title: t.nome,
        onclick: () => { estado.arbClube = String(t.id); render(); } }, escudo(t.id, 'tb')));
    });
    app.append(filtro);
    const cid = estado.arbClube, t = T[cid];
    const linhas = A.arbitros.filter((a) => a.clubes[cid]).map((a) => [a.nome, a.clubes[cid]])
      .sort((x, y) => y[1].jogos - x[1].jogos || x[0].localeCompare(y[0]));
    const tot = linhas.reduce((acc, [, c]) => { ['jogos', 'v', 'e', 'd'].forEach((k) => acc[k] += c[k]); return acc; }, { jogos: 0, v: 0, e: 0, d: 0 });
    // frases automáticas
    const frases = [];
    const comMin = linhas.filter(([, c]) => c.jogos >= 2);
    const aprove = (c) => (3 * c.v + c.e) / (3 * c.jogos);
    if (comMin.length) {
      const melhor = comMin.slice().sort((x, y) => aprove(y[1]) - aprove(x[1]) || y[1].jogos - x[1].jogos)[0];
      const pior = comMin.slice().sort((x, y) => aprove(x[1]) - aprove(y[1]) || y[1].jogos - x[1].jogos)[0];
      frases.push(`Melhor aproveitamento com ${melhor[0]}: ${melhor[1].v}V ${melhor[1].e}E ${melhor[1].d}D (${Math.round(aprove(melhor[1]) * 100)}%).`);
      if (pior[0] !== melhor[0]) frases.push(`Pior aproveitamento com ${pior[0]}: ${pior[1].v}V ${pior[1].e}E ${pior[1].d}D (${Math.round(aprove(pior[1]) * 100)}%).`);
      const cart = comMin.filter(([, c]) => c.com_dados >= 2).sort((x, y) => y[1].amarelos / y[1].com_dados - x[1].amarelos / x[1].com_dados)[0];
      if (cart) frases.push(`Quem mais amarela o ${t ? t.nome : 'clube'}: ${cart[0]}, ${media(cart[1].amarelos, cart[1].com_dados)} por jogo.`);
    }
    app.append(el('section', { class: 'card pad arb-resumo' },
      el('div', { class: 'arb-clube' }, escudo(+cid, 'md'), el('div', null, el('b', { text: t ? t.nome : '' }),
        el('div', { class: 'small', text: `${tot.jogos} jogos com árbitro identificado · ${tot.v}V ${tot.e}E ${tot.d}D · ${linhas.length} árbitros diferentes` }))),
      frases.length ? el('ul', { class: 'arb-frases' }, frases.map((f) => el('li', { text: f }))) : null));
    if (!linhas.length) { app.append(el('p', { class: 'small', text: 'Ainda sem jogos com árbitro identificado para este clube.' })); return; }
    app.append(el('div', { class: 'card' }, tabelaClubes(linhas.map(([nome, c]) => [el('span', { class: 'arb-n', text: nome }), c]), 'Árbitro')));
    app.append(el('p', { class: 'small', text: 'Cartões: recebidos pelo clube. Pên. e VAR: a favor / contra.' }));
  }

  function arbVar(app, A) {
    const linhas = D.times.map((t) => { const v = (A.var && A.var[t.id]) || { favor: 0, contra: 0, lances: [] }; return { t, ...v, saldo: v.favor - v.contra }; });
    const total = linhas.reduce((n, x) => n + x.favor + x.contra, 0);
    if (!total) {
      app.append(el('div', { class: 'card pad' }, el('p', { class: 'small', style: 'margin:0',
        text: 'Ainda não há decisões do VAR registradas. O robô lê os lances de revisão da ESPN (gols anulados, pênaltis marcados ou anulados e expulsões após revisão) e o ranking aparece aqui conforme os jogos forem processados.' })));
      return;
    }
    const ord = linhas.slice().sort((a, b) => b.saldo - a.saldo || b.favor - a.favor);
    const top = ord[0], fundo = ord[ord.length - 1];
    app.append(el('div', { class: 'var-dest' },
      el('div', { class: 'card pad var-card bom' }, el('small', { text: 'Mais favorecido pelo VAR' }), el('div', { class: 'arb-clube' }, escudo(top.t.id, 'md'),
        el('div', null, el('b', { text: top.t.nome }), el('div', { class: 'small', text: `${top.favor} a favor · ${top.contra} contra · saldo ${top.saldo > 0 ? '+' : ''}${top.saldo}` })))),
      el('div', { class: 'card pad var-card ruim' }, el('small', { text: 'Mais prejudicado pelo VAR' }), el('div', { class: 'arb-clube' }, escudo(fundo.t.id, 'md'),
        el('div', null, el('b', { text: fundo.t.nome }), el('div', { class: 'small', text: `${fundo.favor} a favor · ${fundo.contra} contra · saldo ${fundo.saldo > 0 ? '+' : ''}${fundo.saldo}` }))))));
    const tb = el('tbody');
    ord.forEach((x, i) => {
      const cont = {}; x.lances.forEach((l) => { cont[l.decisao] = (cont[l.decisao] || 0) + 1; });
      tb.append(el('tr', null, el('td', { class: 'pos', text: i + 1 }), el('td', { class: 'l sticky-col' }, escudoLink(x.t.id)),
        el('td', { class: 'num', text: x.favor }), el('td', { class: 'num', text: x.contra }),
        el('td', { class: 'num pts', text: (x.saldo > 0 ? '+' : '') + x.saldo }),
        el('td', { class: 'num', text: cont.gol_anulado || 0 }), el('td', { class: 'num', text: cont.gol_validado || 0 }), el('td', { class: 'num', text: cont.penalti_marcado || 0 }),
        el('td', { class: 'num', text: cont.penalti_anulado || 0 }), el('td', { class: 'num', text: cont.vermelho || 0 }), el('td', { class: 'num', text: cont.vermelho_anulado || 0 })));
    });
    app.append(el('div', { class: 'card' }, el('div', { class: 'tbl-wrap' }, el('table', null,
      el('thead', null, el('tr', null, el('th', { text: '#' }), el('th', { class: 'l sticky-col', text: 'Clube' }),
        el('th', { text: 'A favor' }), el('th', { text: 'Contra' }), el('th', { text: 'Saldo' }),
        el('th', { text: 'Gols anul.', title: 'Gols do clube anulados pelo VAR' }), el('th', { text: 'Gols valid.', title: 'Gols do clube validados pelo VAR' }), el('th', { text: 'Pên. +', title: 'Pênaltis a favor marcados pelo VAR' }),
        el('th', { text: 'Pên. −', title: 'Pênaltis a favor anulados pelo VAR' }), el('th', { text: 'Expulsões', title: 'Expulsões do clube após revisão do VAR' }), el('th', { text: 'Exp. anul.', title: 'Expulsões do clube anuladas pelo VAR' }))), tb))));
    app.append(el('p', { class: 'small', text: 'A favor: decisões do VAR que beneficiaram o clube (gol dele validado, pênalti marcado para ele, expulsão dele anulada, gol do rival anulado, pênalti do rival tirado, rival expulso após revisão). Contra: o inverso. Revisões que mantiveram a decisão de campo não contam aqui, só nas chamadas do VAR de cada árbitro.' }));
  }

  function telaNoticias(app) {
    app.append(secHead('Notícias', 'Últimas do ge', null, 'h1'));
    const filtro = el('div', { class: 'clubes-filtro', role: 'group', 'aria-label': 'Escolha o clube' });
    filtro.append(el('button', { type: 'button', class: 'todos', 'aria-pressed': String(estado.clubeNoticias === 'todos'), text: 'Todos',
      onclick: () => { estado.clubeNoticias = 'todos'; render(); } }));
    D.times.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).forEach((t) => {
      filtro.append(el('button', { type: 'button', 'aria-pressed': String(estado.clubeNoticias === String(t.id)), 'aria-label': t.nome, title: t.nome,
        onclick: () => { estado.clubeNoticias = String(t.id); render(); } }, escudo(t.id, 'tb')));
    });
    app.append(filtro);
    const lista = noticiasDe(estado.clubeNoticias);
    if (!lista.length) {
      app.append(el('div', { class: 'card pad' }, el('p', { class: 'small', style: 'margin:0',
        text: N ? 'Nenhuma notícia recente deste clube no momento.' : 'As notícias aparecem aqui assim que o robô fizer a próxima atualização.' })));
      return;
    }
    const card = el('div', { class: 'card news' });
    lista.forEach(([n, id]) => card.append(linhaNoticia(n, id)));
    app.append(card);
  }

  function metodo() {
    return el('details', { class: 'card how' }, el('summary', { text: 'Como as previsões são feitas' }),
      el('ol', null,
        el('li', { text: 'Para cada jogo, cruzamos a média de gols que o mandante marca em casa com a que o visitante sofre fora, e o contrário, em relação à média do campeonato.' }),
        el('li', { text: 'A fase recente ajusta ataque e defesa: últimos 5 jogos com peso 60% e últimos 10 com peso 40%.' }),
        el('li', { text: 'Com os gols esperados, a distribuição de Poisson dá a chance de vitória, empate e derrota em cada jogo.' }),
        el('li', { text: `O resto do campeonato é simulado ${D.simulacoes.toLocaleString('pt-BR')} vezes. A chance de cada faixa é a parte das simulações em que o clube termina nela.` }),
        el('li', { text: 'Os dados são atualizados automaticamente alguns minutos depois do fim de cada jogo.' })),
      el('p', { class: 'small', style: 'margin:.8rem 0 0' }, 'Site não oficial, sem ligação com a CBF ou com os clubes. Dados de jogos e artilharia: ',
        el('a', { href: 'https://www.football-data.org', target: '_blank', rel: 'noopener', text: 'football-data.org' }), '. Previsões são estimativas.'));
  }

  // ---------- roteamento
  function rota() {
    const h = (location.hash || '#inicio').slice(1);
    if (h.startsWith('clube-')) return { tela: 'clube', id: +h.slice(6) };
    if (h.startsWith('jogo-')) return { tela: 'jogo', id: +h.slice(5) };
    if (h.startsWith('jogador-')) return { tela: 'jogador', id: h.slice(8) };
    if (h === 'artilharia') return { tela: 'jogadores' };
    if (['inicio', 'tabela', 'rodadas', 'jogadores', 'noticias', 'arbitragem'].includes(h)) return { tela: h };
    return { tela: 'inicio' };
  }
  window.addEventListener('error', () => {
    const app = $('#app');
    if (app && !app.children.length) app.replaceChildren(el('p', { class: 'erro', text: 'Algo deu errado ao abrir o site. Recarregue a página.' }));
  });
  function render() {
    if (!D) return;
    const app = $('#app');
    const r = rota();
    const y = window.scrollY;
    app.replaceChildren();
    if (r.tela === 'inicio') telaInicio(app);
    else if (r.tela === 'tabela') telaTabela(app);
    else if (r.tela === 'rodadas') telaRodadas(app);
    else if (r.tela === 'jogadores') { telaJogadores(app); if (!P) carregarJogadores(); }
    else if (r.tela === 'jogador') telaJogador(app, r.id);
    else if (r.tela === 'noticias') telaNoticias(app);
    else if (r.tela === 'arbitragem') telaArbitragem(app);
    else if (r.tela === 'jogo') { telaJogo(app, r.id); if (!E) carregarEstat(); }
    else telaClube(app, r.id);
    const navKey = r.tela === 'clube' ? 'tabela' : r.tela === 'jogo' ? 'rodadas' : r.tela === 'jogador' ? 'jogadores' : r.tela;
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const jg = r.tela === 'jogo' ? D.jogos.find((x) => x.id === r.id) : null;
    document.title = r.tela === 'clube' && T[r.id] ? `${T[r.id].nome} · Lima Score`
      : jg && T[jg.casa] && T[jg.fora] ? `${T[jg.casa].nome} x ${T[jg.fora].nome} · Lima Score` : 'Lima Score';
    if (render._ultima === location.hash) window.scrollTo(0, y);
    else window.scrollTo(0, 0);
    render._ultima = location.hash;
  }

  async function carregar(silencioso) {
    if (window.__SITE_DATA__ && !D) {  // prévia com dados embutidos
      D = window.__SITE_DATA__;
      T = Object.fromEntries(D.times.map((t) => [t.id, t]));
      const upd = $('#upd');
      if (upd) upd.textContent = 'Atualizado em ' + new Date(D.atualizado).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      render();
      return;
    }
    if (window.__SITE_DATA__) return;
    try {
      const resp = await fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!resp.ok) throw new Error(resp.status);
      const novo = await resp.json();
      if (D && novo.atualizado === D.atualizado) return;
      D = novo;
      T = Object.fromEntries(D.times.map((t) => [t.id, t]));
      const upd = $('#upd');
      if (upd) upd.textContent = 'Atualizado em ' + new Date(D.atualizado).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      render();
    } catch (e) {
      if (!silencioso && !D) $('#app').replaceChildren(el('p', { class: 'erro', text: 'Não foi possível carregar os dados agora. Verifique sua conexão e tente de novo.' }));
    }
  }

  async function carregarNoticias() {
    if (window.__SITE_DATA__) return;
    try {
      const r = await fetch('data/noticias.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const novo = await r.json();
      if (N && novo.atualizado === N.atualizado) return;
      N = novo;
      if (D) render();
    } catch (e) { /* sem notícias por enquanto */ }
  }
  carregarNoticias();
  setInterval(carregarNoticias, 10 * 60 * 1000);

  let jogCarregando = false;
  async function carregarJogadores() {
    if (window.__SITE_DATA__ || jogCarregando) return;
    jogCarregando = true;
    try {
      const r = await fetch('data/jogadores.json?t=' + Date.now(), { cache: 'no-store' });
      P = r.ok ? await r.json() : { jogadores: [] };
    } catch (e) { P = { jogadores: [] }; }
    jogCarregando = false;
    if (D && ['jogadores', 'jogador'].includes(rota().tela)) render();
  }

  let estatCarregando = false;
  async function carregarEstat() {
    if (window.__SITE_DATA__ || estatCarregando) return;
    estatCarregando = true;
    try {
      const r = await fetch('data/estatisticas.json?t=' + Date.now(), { cache: 'no-store' });
      const novo = r.ok ? await r.json() : { jogos: {} };
      const mudou = !E || JSON.stringify(novo) !== JSON.stringify(E);
      E = novo;
      if (mudou && D && rota().tela === 'jogo') render();
    } catch (e) { if (!E) { E = { jogos: {} }; if (D && rota().tela === 'jogo') render(); } }
    estatCarregando = false;
  }

  // ---------- placar ao vivo rápido: lê um arquivo pequeno direto do GitHub a cada 20 s
  const REPO = (() => {
    const dono = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : 'limamatt';
    const nome = location.pathname.split('/').filter(Boolean)[0] || 'limascore';
    return `${dono}/${nome}`;
  })();
  let etagAoVivo = null;
  async function pollAoVivo() {
    if (window.__SITE_DATA__ || !D) return;
    try {
      const h = { Accept: 'application/vnd.github.raw+json' };
      if (etagAoVivo) h['If-None-Match'] = etagAoVivo;
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/ao_vivo.json?ref=ao-vivo`, { headers: h, cache: 'no-cache' });
      if (r.status === 304 || !r.ok) return;
      etagAoVivo = r.headers.get('ETag');
      const v = await r.json();
      let mudou = false;
      Object.entries(v.jogos || {}).forEach(([id, x]) => {
        const j = D.jogos.find((y) => String(y.id) === id);
        if (!j || j.status === 'FINISHED') return;
        ['status', 'gols_casa', 'gols_fora', 'periodo', 'ancora', 'lives'].forEach((k) => {
          if (x[k] !== undefined && JSON.stringify(j[k]) !== JSON.stringify(x[k])) { j[k] = x[k]; mudou = true; }
        });
      });
      if (v.estat) {
        if (!E) E = { jogos: {} };
        Object.entries(v.estat).forEach(([id, x]) => {
          const antes = JSON.stringify(E.jogos[id] || {});
          E.jogos[id] = Object.assign({}, E.jogos[id] || {}, x);
          if (JSON.stringify(E.jogos[id]) !== antes) mudou = true;
        });
      }
      if (mudou) render();
    } catch (e) { /* sem placar rápido agora; o site segue com a atualização normal */ }
  }
  (function cicloAoVivo() {
    setTimeout(async () => { if (temJogoAgora() && !document.hidden) await pollAoVivo(); cicloAoVivo(); }, 20 * 1000);
  })();
  // o minuto avança sozinho na tela
  setInterval(() => {
    if (!D) return;
    document.querySelectorAll('[data-min]').forEach((n) => {
      const j = D.jogos.find((x) => String(x.id) === n.dataset.min);
      if (j) n.textContent = minuto(j);
    });
  }, 15 * 1000);

  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) carregar(true); });
  // com jogo rolando, confere a cada 1 minuto; fora disso, a cada 5 minutos
  function temJogoAgora() {
    if (!D) return false;
    const agora = Date.now();
    return D.jogos.some((j) => aoVivo(j) || (!encerrado(j) && Math.abs(agora - new Date(j.data).getTime() - 60 * 60 * 1000) < 80 * 60 * 1000));
  }
  (function ciclo() {
    setTimeout(async () => { await carregar(true); if (rota().tela === 'jogo') await carregarEstat(); ciclo(); }, temJogoAgora() ? 60 * 1000 : 5 * 60 * 1000);
  })();
  carregar(false);

  // ---------- app instalável
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  let pedidoInstalar = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    pedidoInstalar = e;
    const b = $('#install');
    if (b) b.hidden = false;
  });
  const btn = $('#install');
  if (btn) btn.addEventListener('click', async () => {
    if (!pedidoInstalar) return;
    pedidoInstalar.prompt();
    await pedidoInstalar.userChoice.catch(() => {});
    pedidoInstalar = null;
    btn.hidden = true;
  });
})();
