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
  // vagas de hoje (mudam com a final da Libertadores e com o rebaixamento do Grêmio): vêm de data/vagas.json pelo robô
  const VG = () => (D && D.vagas) || { grupos: 4, pre: 2, sul: 6, excluido: null };
  const ord = (n) => n + 'º';
  function zona(pos) {
    const v = VG();
    if (pos >= 17) return 'reb';
    return pos <= v.grupos ? 'lib' : pos <= v.grupos + v.pre ? 'pre' : pos <= v.grupos + v.pre + v.sul ? 'sul' : 'mid';
  }
  // zona de cada clube numa lista já ordenada: o clube com vaga pela Copa do Brasil é pulado na contagem
  function zonasDaLista(lista) {
    const v = VG(), m = {};
    let k = 0;
    lista.forEach((id, i) => {
      if (i + 1 >= 17) { m[id] = 'reb'; return; }
      if (id === v.excluido) { m[id] = 'lib'; return; }
      m[id] = zona(++k);
    });
    return m;
  }
  function textoVagas() {
    const v = VG(), g = v.grupos, p = v.pre, s = v.sul;
    const partes = [`Hoje: ${ord(1)} ao ${ord(g)} na fase de grupos da Libertadores, ${ord(g + 1)}${p > 1 ? ' e ' + ord(g + p) : ''} na Pré-Libertadores e ${ord(g + p + 1)} ao ${ord(g + p + s)} na Sul-Americana (G-${g + p}).`];
    const ex = v.excluido && T[v.excluido];
    if (v.copa && v.copa.time && T[v.copa.time]) {
      const n = T[v.copa.time].nome;
      partes.push(v.copa.rebaixado_hoje
        ? `O ${n} está no Z4: se cair, perde a vaga da Copa do Brasil e ela desce para a tabela (já contado acima).`
        : `O ${n} tem vaga pela Copa do Brasil e é pulado na contagem; se cair, a vaga desce para a tabela.`);
    }
    const L = v.libertadores;
    if (L && L.time && T[L.time]) {
      const n = T[L.time].nome;
      if (L.resultado === true) partes.push(`O ${n} foi campeão da Libertadores: a vaga de campeão desceu para a tabela (já contado acima).`);
      else if (L.resultado == null) partes.push(`Se o ${n} for campeão da Libertadores (${L.data ? L.data.split('-').reverse().slice(0, 2).join('/') : 'final'}), abre mais uma vaga na fase de grupos e a linha desce uma posição.`);
    }
    if (v.dist) {
      const d = Object.entries(v.dist).filter(([, x]) => x >= 0.5).map(([k, x]) => `${k.replace('G', 'G-')} ${pct(x)}`);
      if (d.length > 1) partes.push('Chance de cada cenário no fim: ' + d.join(' · ') + '.');
    }
    return partes.filter(Boolean).join(' ');
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
  // rodada vigente: a menor rodada que ainda tem jogo por acontecer.
  // Jogo adiado para mais de 7 dias depois da data típica da rodada não segura a rodada.
  function rodadaAtual() {
    const tipica = {};
    D.jogos.forEach((j) => { (tipica[j.rodada] = tipica[j.rodada] || []).push(new Date(j.data).getTime()); });
    Object.keys(tipica).forEach((r) => { const v = tipica[r].sort((a, b) => a - b); tipica[r] = v[Math.floor(v.length / 2)]; });
    const pend = D.jogos.filter((j) => !encerrado(j) && new Date(j.data).getTime() <= tipica[j.rodada] + 7 * 864e5);
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
    // vídeos dos gols: só na página da partida
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
    if (encerrado(j) || aoVivo(j)) card.append(el('a', { class: 'ver-jogo', href: '#jogo-' + j.id }, 'Estatísticas e lances ›'));
    else if (j.provavel) card.append(el('a', { class: 'ver-jogo', href: '#jogo-' + j.id }, 'Escalações ›'));
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
      const esc = secaoEscalacoes(j, e);
      if (esc) app.append(esc);
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
    const escJ = secaoEscalacoes(j, e);
    if (escJ) app.append(escJ);

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
    ));
  }

  // escalações: prováveis até 1h antes do jogo; depois, as oficiais (quando divulgadas)
  function secaoEscalacoes(j, e) {
    const falta = (new Date(j.data).getTime() - Date.now()) / 60000;
    const oficial = e && e.escalacao && e.escalacao.casa && e.escalacao.fora ? e.escalacao : null;
    const usarOficial = oficial && falta <= 60;
    const prov = j.provavel;
    if (!usarOficial && (!prov || encerrado(j))) return null;
    const coluna = (lado) => {
      const tid = j[lado];
      const d = usarOficial ? oficial[lado] : (prov && prov[lado]);
      const box = el('div', { class: 'esc-col' }, el('div', { class: 'esc-time' }, escudo(tid), el('b', { text: T[tid] ? T[tid].nome : '' }),
        usarOficial && d && d.formacao ? el('span', { class: 'small', text: d.formacao }) : null));
      if (!d) { box.append(el('p', { class: 'small', text: 'Sem informação.' })); return box; }
      const linha = (p, banco) => el('li', { class: p.novo ? 'novo' : '' },
        el('span', { class: 'esc-num num', text: p.c || '' }),
        el('span', { class: 'esc-n' }, el('span', { text: p.n }), usarOficial ? marcas(p, lado, banco) : null),
        el('span', { class: 'small esc-p', text: p.p || '' }));
      const ul = el('ul', { class: 'esc-lista' });
      (d.titulares || []).forEach((p) => ul.append(linha(p, false)));
      box.append(ul);
      if (usarOficial && d.reservas && d.reservas.length) {
        const entraram = d.reservas.filter((p) => p.ent != null), banco = d.reservas.filter((p) => p.ent == null);
        if (entraram.length) {
          const ue = el('ul', { class: 'esc-lista' });
          entraram.sort((a, b) => a.ent - b.ent).forEach((p) => ue.append(linha(p, true)));
          box.append(el('div', { class: 'small esc-sub', text: 'Entraram' }), ue);
        }
        if (banco.length) box.append(el('div', { class: 'small esc-res' }, el('b', { text: 'No banco: ' }), banco.map((p) => p.n).join(', ')));
      }
      if (!usarOficial && d.desfalques && d.desfalques.length) {
        box.append(el('div', { class: 'small esc-res' }, el('b', { text: 'Suspensos: ' }), d.desfalques.map((p) => p.n).join(', ')));
      }
      return box;
    };
    // gols, assistências e cartões de cada jogador (pelos lances do jogo)
    const nrm = (t) => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const lances = (e && e.lances) || [];
    const mesmo = (a, b) => { a = nrm(a); b = nrm(b); return !!a && !!b && (a === b || a.endsWith(' ' + b) || b.endsWith(' ' + a) || a.startsWith(b + ' ') || b.startsWith(a + ' ')); };
    const marcas = (p, lado, banco) => {
      const out = el('span', { class: 'esc-m' });
      const meus = lances.filter((l) => l.lado === lado);
      const gols = meus.filter((l) => l.tipo === 'gol' && !l.contra && mesmo(l.jogador, p.n)).length;
      const contra = lances.filter((l) => l.tipo === 'gol' && l.contra && l.lado !== lado && mesmo(l.jogador, p.n)).length;
      const ast = meus.filter((l) => l.tipo === 'gol' && mesmo(l.assistencia, p.n)).length;
      const am = meus.filter((l) => l.tipo === 'amarelo' && mesmo(l.jogador, p.n)).length;
      const vm = meus.filter((l) => l.tipo === 'vermelho' && mesmo(l.jogador, p.n)).length;
      const tag = (txt, cls, tit) => out.append(el('span', { class: 'esc-t ' + cls, title: tit, 'aria-label': tit, text: txt }));
      if (gols) tag('⚽' + (gols > 1 ? '×' + gols : ''), 'g', `${gols} gol${gols > 1 ? 's' : ''}`);
      if (contra) tag('⚽ contra', 'gc', 'gol contra');
      if (ast) tag('A' + (ast > 1 ? '×' + ast : ''), 'a', `${ast} assistência${ast > 1 ? 's' : ''}`);
      if (am) out.append(el('i', { class: 'cart am', title: 'Cartão amarelo', 'aria-label': 'Cartão amarelo' }));
      if (vm) out.append(el('i', { class: 'cart vm', title: 'Cartão vermelho', 'aria-label': 'Cartão vermelho' }));
      if (p.les) tag('✚', 'les', 'Saiu machucado');
      if (banco && p.ent != null) tag(`↑${p.ent}'`, 'ent', `Entrou aos ${p.ent} minutos`);
      if (!banco && p.sai != null && !vm) tag(`↓${p.sai}'`, 'sai', `Saiu aos ${p.sai} minutos`);
      return out.childNodes.length ? out : null;
    };
    const titulo = usarOficial ? 'Escalações oficiais' : 'Prováveis escalações';
    const nota = usarOficial ? null
      : (falta <= 60 && !encerrado(j) ? 'A escalação oficial aparece aqui assim que for divulgada. ' : '') +
        (['casa', 'fora'].every((l) => prov && prov[l] && prov[l].fonte === 'ge')
          ? 'Prováveis escalações publicadas pelo ge.'
          : ['casa', 'fora'].some((l) => prov && prov[l] && prov[l].fonte === 'ge')
            ? 'Provável do ge para um dos times; para o outro, os titulares do último jogo sem os suspensos.'
            : 'Provável: os titulares do último jogo, sem os suspensos (no lugar entra quem mais foi titular no setor). Lesões e decisões do técnico não entram.');
    const fonte = usarOficial ? oficial : prov;
    if (!fonte || !fonte.casa || !fonte.fora) return null;
    // suspensos aparecem antes e durante o jogo (vêm da provável, que considera cartões e expulsões)
    const suspensos = prov ? { casa: (prov.casa && prov.casa.desfalques) || [], fora: (prov.fora && prov.fora.desfalques) || [] } : {};
    // com a escalação oficial, quem foi relacionado não está suspenso (tira da lista)
    if (usarOficial) ['casa', 'fora'].forEach((l) => {
      const rel = new Set(((oficial[l].titulares || []).concat(oficial[l].reservas || [])).map((p) => p.n));
      suspensos[l] = (suspensos[l] || []).filter((x) => !rel.has(x.n));
    });
    // banco de reservas (só na escalação oficial): quem entrou, quando e no lugar de quem
    let banco = null;
    if (usarOficial && ((oficial.casa.reservas || []).length || (oficial.fora.reservas || []).length)) {
      const col = (lado) => {
        const d = oficial[lado];
        const res = (d.reservas || []).slice().sort((a, b) => (a.ent == null) - (b.ent == null) || (a.ent || 0) - (b.ent || 0));
        const ul = el('ul', { class: 'bc-lista' });
        res.forEach((p) => {
          const saiu = (d.titulares || []).concat(d.reservas || []).find((x) => x.por === p.n);
          const m = marcas(Object.assign({}, p, { ent: undefined, sai: undefined }), lado, true);
          ul.append(el('li', { class: 'bc-j' + (p.ent != null ? ' entrou' : '') },
            el('span', { class: 'bc-num num', text: p.c || '' }),
            el('span', { class: 'bc-txt' },
              el('span', { class: 'bc-nome' }, el('span', { text: p.n }), m),
              p.ent != null ? el('span', { class: 'bc-sub' }, el('i', { class: 'cp-sub-ic', 'aria-hidden': 'true' }),
                el('b', { class: 'num', text: `${p.ent}'` }), saiu ? ` no lugar de ${saiu.n}` : ' entrou') : null)));
        });
        const usados = res.filter((p) => p.ent != null).length;
        return el('div', { class: 'bc-col' }, el('div', { class: 'esc-time' }, escudo(j[lado]), el('b', { text: T[j[lado]] ? T[j[lado]].nome : '' }),
          el('span', { class: 'small', text: `${usados} de ${res.length} entraram` })), ul);
      };
      banco = el('section', null, secHead('Reservas', 'Banco de reservas', null), el('div', { class: 'card esc' }, col('casa'), col('fora')));
    }
    return el('div', null, el('section', null, secHead('Escalações', titulo, null),
      campinho(j, fonte, { marcas: usarOficial ? marcas : null, suspensos }),
      nota ? el('p', { class: 'small', text: nota }) : null), banco);
  }

  // campinho: o mandante embaixo, o visitante em cima, cada um em linhas pela posição
  function campinho(j, fonte, extra = {}) {
    const linhaDe = (pos) => {
      const p = (pos || '').toLowerCase();
      if (p.includes('goleiro')) return 0;
      if (/zagueiro|lateral|ala|defensor/.test(p)) return 1;
      if (/volante|meio-campista/.test(p)) return 2;
      if (p.includes('meia')) return 3;
      if (/atacante|ponta/.test(p)) return 4;
      return 2;
    };
    const ordemLado = (pos) => {
      const p = (pos || '').toLowerCase();
      if (p.includes('esquerd')) return 0;
      if (p.includes('direit')) return 4;
      if (p.includes('ponta') || p.includes('ala')) return 0.5;
      return 2;
    };
    const curto = (n) => {
      const ps = (n || '').trim().split(/\s+/);
      if (ps.length === 1 || (n || '').length <= 11) return n;
      return ps[ps.length - 1].length > 2 ? ps[ps.length - 1] : ps.slice(-2).join(' ');
    };
    const metade = (lado) => {
      const tit = ((fonte[lado] && fonte[lado].titulares) || []).slice();
      // sempre em 4-3-3: ordena do goleiro ao ataque e preenche 1 + 4 + 3 + 3
      tit.forEach((p) => { p._l = linhaDe(p.p); p._o = ordemLado(p.p); });
      const gk = tit.findIndex((p) => p._l === 0);
      const goleiro = gk >= 0 ? tit.splice(gk, 1) : tit.splice(0, 1);
      tit.sort((a, b) => a._l - b._l);
      const linhas = [goleiro, tit.slice(0, 4), tit.slice(4, 7), tit.slice(7, 10)].concat(tit.length > 10 ? [tit.slice(10)] : []);
      linhas.forEach((ln) => {
        let alt = 0;
        ln.forEach((p) => { if (p._o === 0.5) p._o = alt++ % 2 === 0 ? 0 : 4; });
        // o visitante ataca para baixo: a esquerda dele fica à direita da tela
        ln.sort((a, b) => (lado === 'fora' ? b._o - a._o : a._o - b._o));
      });
      // no ataque de três, o centroavante fica no meio
      const atq = linhas[3];
      if (atq && atq.length === 3) {
        const ci = atq.findIndex((p) => /atacante/i.test(p.p || ''));
        if (ci >= 0) { const [c] = atq.splice(ci, 1); atq.splice(1, 0, c); }
      }
      const box = el('div', { class: 'cp-metade ' + lado });
      const usadas = linhas.filter((ln) => ln.length);
      (lado === 'casa' ? usadas.slice().reverse() : usadas).forEach((ln) => {
        box.append(el('div', { class: 'cp-linha' }, ln.map((p) => {
          const m = extra.marcas ? extra.marcas(Object.assign({}, p, { sai: undefined, les: undefined }), lado, false) : null;
          // substituído: quem entrou no lugar dele, com o minuto
          const ent = p.por ? ((fonte[lado].reservas || []).find((r) => r.n === p.por) || { n: p.por }) : null;
          const mEnt = ent && extra.marcas ? extra.marcas(Object.assign({}, ent, { sai: undefined, ent: undefined }), lado, true) : null;
          return el('div', { class: 'cp-j' + (p.sai != null ? ' saiu' : ''), title: p.n },
            el('span', { class: 'cp-n num', text: p.c || '' }, p.les ? el('i', { class: 'cp-les', title: 'Saiu machucado', text: '✚' }) : null),
            el('span', { class: 'cp-nome', text: curto(p.n) }),
            m ? el('span', { class: 'cp-m' }, m) : null,
            ent ? el('span', { class: 'cp-sub', title: `${ent.n} entrou no lugar de ${p.n} aos ${p.sai}'` },
              el('i', { class: 'cp-sub-ic', 'aria-hidden': 'true' }), el('span', { class: 'cp-sub-min num', text: p.sai != null ? p.sai + "'" : '' }),
              el('span', { class: 'cp-sub-n', text: curto(ent.n) }), mEnt) : (p.sai != null ? el('span', { class: 'cp-sub' }, el('span', { class: 'cp-sub-min num', text: `↓${p.sai}'` })) : null));
        })));
      });
      return box;
    };
    const rot = (lado) => {
      const t = T[j[lado]];
      const susp = (extra.suspensos && extra.suspensos[lado]) || [];
      return el('div', { class: 'cp-rot ' + lado },
        el('div', { class: 'cp-rot-l' }, escudo(j[lado]), el('b', { text: t ? t.nome : '' }), el('span', { class: 'small', text: '4-3-3' })),
        el('div', { class: 'cp-info small' },
          t && t.tecnico ? el('span', { class: 'cp-chip' }, el('i', { class: 'cp-ic-tec', 'aria-hidden': 'true', text: '📋' }), `Técnico: ${t.tecnico.nome}${t.tecnico.interino ? ' (interino)' : ''}`) : null,
          susp.length ? el('span', { class: 'cp-chip susp' }, el('i', { class: 'cart vm', 'aria-hidden': 'true' }),
            `${fonte[lado] && fonte[lado].fonte === 'ge' || (j.provavel && j.provavel[lado] && j.provavel[lado].fonte === 'ge') ? 'Desfalques' : 'Suspensos'}: ${susp.map((x) => x.n).join(', ')}`) : null,
          (() => { const pd = j.provavel && j.provavel[lado] && j.provavel[lado].pendurados; return pd && pd.length && !encerrado(j)
            ? el('span', { class: 'cp-chip' }, el('i', { class: 'cart am', 'aria-hidden': 'true' }), `Pendurados: ${pd.join(', ')}`) : null; })()));
    };
    return el('div', { class: 'card cp-card' }, rot('fora'),
      el('div', { class: 'campo' }, el('div', { class: 'cp-meio', 'aria-hidden': 'true' }), metade('fora'), metade('casa')), rot('casa'));
  }

  // casinha = jogo em casa; avião = jogo fora
  const SVG_CASA = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 3 2 11.5h3V21h5.5v-6h3v6H19v-9.5h3z"/></svg>';
  const SVG_AVIAO = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M21 15.5v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V8.5l-8 5v2l8-2.5V18l-2 1.5V21l3.5-1 3.5 1v-1.5L13 18v-5z"/></svg>';
  function localIcone(emCasa) {
    const s = el('span', { class: 'local-ic ' + (emCasa ? 'casa' : 'fora'), title: emCasa ? 'Em casa' : 'Fora de casa', role: 'img', 'aria-label': emCasa ? 'Em casa' : 'Fora de casa' });
    s.innerHTML = emCasa ? SVG_CASA : SVG_AVIAO;
    return s;
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
      ['g4', 'Liberta', 'Vaga direta na fase de grupos da Libertadores (inclui as vagas extras que podem abrir).', () => topo('libertadores', 1, 8).map((t) => linhaProb(t, t.libertadores, 'var(--info)'))],
      ['pre', 'Pré-Liberta', `Fase preliminar da Libertadores (hoje: ${ord(VG().grupos + 1)} e ${ord(VG().grupos + VG().pre)}).`, () => topo('pre_libertadores', 1, 8).map((t) => linhaProb(t, t.pre_libertadores, 'var(--teal)'))],
      ['sul', 'Sul-Americana', `Os seis seguintes fora da Libertadores (hoje: ${ord(VG().grupos + VG().pre + 1)} ao ${ord(VG().grupos + VG().pre + VG().sul)}).`, () => topo('sulamericana', 1, 10).map((t) => linhaProb(t, t.sulamericana, 'var(--good)'))],
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
    [['g4', 'Pela vaga direta'], ['z4', 'Contra o Z4']].forEach(([k, txt]) => {
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
    const rot = g4 ? 'de vaga direta' : 'de cair';
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
          text: g4 ? `Praticamente garante a vaga direta na Libertadores já nesta rodada se vencer e ${torc}.`
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
    const seg = el('div', { class: 'seg seg-scroll', role: 'group', 'aria-label': 'Visão da tabela' });
    [['classificacao', 'Geral'], ['turnos', 'Turnos'], ['mandante', 'Mandante'], ['visitante', 'Visitante'], ['chances', 'Chances']].forEach(([k, txt]) => {
      seg.append(el('button', { type: 'button', 'aria-pressed': String(estado.tabela === k), text: txt, onclick: () => { estado.tabela = k; render(); } }));
    });
    app.append(seg);
    if (estado.tabela === 'turnos') {
      if (!estado.turno) estado.turno = rodadaAtual() > 19 ? 2 : 1;
      const st2 = el('div', { class: 'seg', role: 'group', 'aria-label': 'Turno', style: 'max-width:22rem' });
      [[1, '1º turno'], [2, '2º turno']].forEach(([k, txt]) => st2.append(el('button', { type: 'button', 'aria-pressed': String(estado.turno === k), text: txt,
        onclick: () => { estado.turno = k; render(); } })));
      app.append(st2);
    }

    const card = el('div', { class: 'card' });
    const wrap = el('div', { class: 'tbl-wrap' });
    const tb = el('tbody');
    let head;
    if (estado.tabela === 'classificacao') {
      head = ['#', 'Clube', 'Pts', 'J', 'V', 'E', 'D', 'GP', 'GC', 'SG', 'Últimos 5'];
      const zc = zonasDaLista(D.times.slice().sort((a, b) => a.pos - b.pos).map((t) => t.id));
      D.times.forEach((t) => tb.append(el('tr', { class: 'z-' + zc[t.id] },
        el('td', { class: 'pos', text: t.pos }),
        el('td', { class: 'sticky-col2' }, timeLinkSigla(t.id)),
        el('td', { class: 'pts', text: t.pts }), el('td', { text: t.j }), el('td', { text: t.v }), el('td', { text: t.e }), el('td', { text: t.d }),
        el('td', { text: t.gp }), el('td', { text: t.gc }), el('td', { text: sgTxt(t.sg) }),
        el('td', null, forma(t.forma)))));
    } else if (estado.tabela === 'mandante' || estado.tabela === 'visitante' || estado.tabela === 'turnos') {
      const turno = estado.tabela === 'turnos' ? estado.turno : null;
      head = ['#', 'Clube', 'Pts', 'J', 'V', 'E', 'D', 'GP', 'GC', 'SG', 'Aprov.'];
      const st = {};
      D.times.forEach((t) => { st[t.id] = { id: t.id, pts: 0, j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0 }; });
      const soma = (id, gp, gc) => {
        const x = st[id]; if (!x) return;
        x.j++; x.gp += gp; x.gc += gc;
        if (gp > gc) { x.v++; x.pts += 3; } else if (gp === gc) { x.e++; x.pts += 1; } else x.d++;
      };
      D.jogos.filter(encerrado).forEach((j) => {
        if (turno) {
          if (turno === 1 ? j.rodada > 19 : j.rodada <= 19) return;
          soma(j.casa, j.gols_casa, j.gols_fora); soma(j.fora, j.gols_fora, j.gols_casa);
        } else if (estado.tabela === 'mandante') soma(j.casa, j.gols_casa, j.gols_fora);
        else soma(j.fora, j.gols_fora, j.gols_casa);
      });
      Object.values(st).sort((a, b) => b.pts - a.pts || b.v - a.v || (b.gp - b.gc) - (a.gp - a.gc) || b.gp - a.gp)
        .forEach((x, i) => tb.append(el('tr', null,
          el('td', { class: 'pos', text: i + 1 }),
          el('td', { class: 'sticky-col2' }, timeLinkSigla(x.id)),
          el('td', { class: 'pts', text: x.pts }), el('td', { text: x.j }), el('td', { text: x.v }), el('td', { text: x.e }), el('td', { text: x.d }),
          el('td', { text: x.gp }), el('td', { text: x.gc }), el('td', { text: sgTxt(x.gp - x.gc) }),
          el('td', { text: x.j ? Math.round(x.pts / (x.j * 3) * 100) + '%' : '—' }))));
    } else {
      head = ['#', 'Clube', 'Pts', 'Projeção', 'Título', 'Liberta', 'Pré-Liberta', 'Sul-Americana', 'Rebaix.'];
      const proj = D.times.slice().sort((a, b) => b.pts_projetados - a.pts_projetados);
      const zp = zonasDaLista(proj.map((t) => t.id));
      proj.forEach((t, i) => tb.append(el('tr', { class: 'z-' + zp[t.id] },
        el('td', { class: 'pos', text: i + 1 }),
        el('td', { class: 'sticky-col2' }, timeLinkSigla(t.id)),
        el('td', { class: 'pts', text: t.pts }), el('td', { text: n1(t.pts_projetados) }),
        el('td', null, heat(t.titulo, 'var(--accent)')), el('td', null, heat(t.libertadores, 'var(--info)')),
        el('td', null, heat(t.pre_libertadores, 'var(--teal)')), el('td', null, heat(t.sulamericana, 'var(--good)')),
        el('td', null, heat(t.rebaixamento, 'var(--bad)')))));
    }
    wrap.append(el('table', null, el('thead', null, el('tr', null, head.map((h, i) => el('th', { class: (i === 1 ? 'sticky-col2' : ''), text: h })))), tb));
    const porMando = estado.tabela === 'mandante' || estado.tabela === 'visitante' || estado.tabela === 'turnos';
    if (porMando) card.append(wrap, el('div', { class: 'zones' }, el('span', { text: estado.tabela === 'turnos'
      ? `Só os jogos do ${estado.turno}º turno (rodadas ${estado.turno === 1 ? '1 a 19' : '20 a 38'}). Aprov. = aproveitamento dos pontos disputados.`
      : estado.tabela === 'mandante'
        ? 'Só os jogos em casa. Aprov. = aproveitamento dos pontos disputados.'
        : 'Só os jogos fora de casa. Aprov. = aproveitamento dos pontos disputados.' })));
    else card.append(wrap, el('div', { class: 'zones' },
      el('span', null, el('i', { style: 'background:var(--info)' }), 'Libertadores'),
      el('span', null, el('i', { style: 'background:var(--teal)' }), 'Pré-Libertadores'),
      el('span', null, el('i', { style: 'background:var(--good)' }), 'Sul-Americana'),
      el('span', null, el('i', { style: 'background:var(--bad)' }), 'Rebaixamento'),
      estado.tabela === 'chances' ? el('span', { text: 'Ordenada pela projeção de pontos' }) : null));
    if (porMando) { app.append(card); return; }
    app.append(card, el('p', { class: 'small', text: textoVagas() }));
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
  // grupos da lista do elenco; quem não tem posição informada fica com os atacantes
  const GRUPO_POS = (pos) => /goleiro/i.test(pos || '') ? 0 : /zagueiro|lateral|ala|defensor/i.test(pos || '') ? 1 : /meia|volante|meio/i.test(pos || '') ? 2 : 3;
  const NOME_GRUPO = ['Goleiros', 'Defensores', 'Meio-campistas', 'Atacantes'];
  // função para o scout (mais detalhada que o grupo)
  const FUNCAO = (pos) => /goleiro/i.test(pos || '') ? 'goleiro' : /zagueiro|defensor/i.test(pos || '') ? 'zagueiro'
    : /lateral|ala/i.test(pos || '') ? 'lateral' : /volante|meio-campista/i.test(pos || '') ? 'volante' : /meia/i.test(pos || '') ? 'meia'
      : /ponta/i.test(pos || '') ? 'ponta' : 'centroavante';
  const NOME_FUNCAO = { goleiro: 'goleiros', zagueiro: 'zagueiros', lateral: 'laterais', volante: 'volantes e meio-campistas', meia: 'meias ofensivos', ponta: 'pontas', centroavante: 'atacantes e centroavantes' };
  const RES_FUNCAO = { goleiro: 'Goleiro', zagueiro: 'Zagueiro', lateral: 'Lateral', volante: 'Volante', meia: 'Meia ofensivo', ponta: 'Ponta', centroavante: 'Centroavante' };
  const p90f = (v, y) => (y.minutos ? (v || 0) * 90 / y.minutos : 0);
  const n2f = (v) => (+v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pcf = (v) => Math.round(v * 100) + '%';
  // [rótulo, valor, formato, menor é melhor?]
  const METRICAS = {
    goleiro: [
      ['Defesas por 90', (y) => p90f(y.defesas, y), n2f],
      ['% de defesas', (y) => ((y.defesas || 0) + (y.gols_sofridos || 0) ? (y.defesas || 0) / ((y.defesas || 0) + (y.gols_sofridos || 0)) : 0), pcf],
      ['Gols sofridos por 90', (y) => p90f(y.gols_sofridos, y), n2f, true],
      ['Jogos sem sofrer gol', (y) => (y.titular ? (y.sem_sofrer || 0) / y.titular : 0), pcf],
      ['Defesas em chutes de dentro da área por 90', (y) => p90f(y.def_area, y), n2f],
      ['xG defendido por 90', (y) => p90f(y.xg_defendido, y), n2f],
      ['Pênaltis defendidos', (y) => y.def_pen || 0, (v) => String(v)],
    ],
    zagueiro: [
      ['Gols sofridos com ele em campo por 90', (y) => p90f(y.gols_sofridos, y), n2f, true],
      ['Faltas cometidas por 90', (y) => p90f(y.faltas, y), n2f, true],
      ['Cartões por 90', (y) => p90f((y.amarelos || 0) + 2 * (y.vermelhos || 0), y), n2f, true],
      ['Pênaltis cometidos', (y) => y.penaltis_cometidos || 0, (v) => String(v), true],
      ['Cabeceios para o gol por 90', (y) => p90f(y.cabeceios, y), n2f],
      ['Gols', (y) => y.gols || 0, (v) => String(v)],
      ['Passes para finalização por 90', (y) => p90f(y.chances, y), n2f],
    ],
    lateral: [
      ['Passes para finalização por 90', (y) => p90f(y.chances, y), n2f],
      ['Cruzamentos que viraram finalização por 90', (y) => p90f(y.ch_cruz, y), n2f],
      ['Assistências por 90', (y) => p90f(y.assist, y), n2f],
      ['xA por 90', (y) => p90f(y.xa, y), n2f],
      ['Faltas sofridas por 90', (y) => p90f(y.sofridas, y), n2f],
      ['Gols sofridos com ele em campo por 90', (y) => p90f(y.gols_sofridos, y), n2f, true],
      ['Faltas cometidas por 90', (y) => p90f(y.faltas, y), n2f, true],
    ],
    volante: [
      ['Gols sofridos com ele em campo por 90', (y) => p90f(y.gols_sofridos, y), n2f, true],
      ['Faltas cometidas por 90', (y) => p90f(y.faltas, y), n2f, true],
      ['Cartões por 90', (y) => p90f((y.amarelos || 0) + 2 * (y.vermelhos || 0), y), n2f, true],
      ['Faltas sofridas por 90', (y) => p90f(y.sofridas, y), n2f],
      ['Passes para finalização por 90', (y) => p90f(y.chances, y), n2f],
      ['Chutes de fora da área por 90', (y) => p90f(y.chutes_fora, y), n2f],
      ['Participações em gol por 90', (y) => p90f((y.gols || 0) + (y.assist || 0), y), n2f],
    ],
    meia: [
      ['Passes para finalização por 90', (y) => p90f(y.chances, y), n2f],
      ['xA por 90', (y) => p90f(y.xa, y), n2f],
      ['Assistências por 90', (y) => p90f(y.assist, y), n2f],
      ['Passes em profundidade para finalização por 90', (y) => p90f(y.ch_enfiada, y), n2f],
      ['Chances em bola parada por 90', (y) => p90f(y.ch_parada, y), n2f],
      ['Gols por 90', (y) => p90f(y.gols, y), n2f],
      ['xG por 90', (y) => p90f(y.xg, y), n2f],
      ['Faltas sofridas por 90', (y) => p90f(y.sofridas, y), n2f],
    ],
    ponta: [
      ['Gols por 90', (y) => p90f(y.gols, y), n2f],
      ['xG por 90', (y) => p90f(y.xg, y), n2f],
      ['Finalizações por 90', (y) => p90f(y.chutes, y), n2f],
      ['Passes para finalização por 90', (y) => p90f(y.chances, y), n2f],
      ['Cruzamentos que viraram finalização por 90', (y) => p90f(y.ch_cruz, y), n2f],
      ['Assistências por 90', (y) => p90f(y.assist, y), n2f],
      ['Faltas sofridas por 90', (y) => p90f(y.sofridas, y), n2f],
    ],
    centroavante: [
      ['Gols por 90', (y) => p90f(y.gols, y), n2f],
      ['xG por 90', (y) => p90f(y.xg, y), n2f],
      ['Gols − xG', (y) => (y.gols || 0) - (y.xg || 0), (v) => (v > 0 ? '+' : '') + v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })],
      ['Gols por finalização', (y) => (y.chutes ? (y.gols || 0) / y.chutes : 0), pcf],
      ['% de chutes no gol', (y) => (y.chutes ? (y.no_alvo || 0) / y.chutes : 0), pcf],
      ['Grandes chances por 90', (y) => p90f(y.grandes_chances, y), n2f],
      ['Gols de cabeça', (y) => y.gols_cabeca || 0, (v) => String(v)],
      ['Impedimentos por 90', (y) => p90f(y.impedimentos, y), n2f, true],
    ],
  };
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
    const elenco = (P.jogadores || []).filter((x) => x.clube === cid && x.jogos > 0)
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
    app.append(el('p', { class: 'small', text: 'Toque no jogador para ver a ficha completa.' }));
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
    const min = x.minutos || 0;
    const p90 = (v) => (min >= 90 ? ((v || 0) * 90 / min).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–');
    const dec = (v, c = 1) => (v == null ? '–' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }));
    const sinal = (v) => (v > 0 ? '+' : '') + dec(v);
    const grupos = [grupo('Participação', [tile('Jogos', x.jogos, `${x.titular || 0} como titular · ${x.entrou || 0} saindo do banco`, 'jogos'),
      tile('Minutos', min ? min.toLocaleString('pt-BR') : '–', min && x.jogos ? `${Math.round(min / x.jogos)} por jogo` : null, 'minutos'),
      tile('Participações em gol', (x.gols || 0) + (x.assist || 0), `${p90((x.gols || 0) + (x.assist || 0))} por 90 min`, null),
      tile('Minutos por gol', x.gols && min ? Math.round(min / x.gols) : '–', null, null)])];
    if (goleiro) {
      grupos.push(grupo('Goleiro', [tile('Defesas', x.defesas || 0, `${p90(x.defesas)} por 90 min`, 'defesas'),
        tile('Gols sofridos', x.gols_sofridos || 0, `${p90(x.gols_sofridos)} por 90 min`, null),
        tile('Jogos sem sofrer gol', x.sem_sofrer || 0, null, 'sem_sofrer'),
        tile('Defesas a cada 100 chutes no gol', (x.defesas || 0) + (x.gols_sofridos || 0) ? Math.round(100 * (x.defesas || 0) / ((x.defesas || 0) + (x.gols_sofridos || 0))) : '–', null, null)]));
    } else {
      grupos.push(grupo('Finalização', [tile('Gols', x.gols || 0, `${p90(x.gols)} por 90 min`, 'gols'),
        tile('xG estimado', dec(x.xg, 2), `${p90(x.xg)} por 90 min`, 'xg'),
        tile('Gols − xG', x.xg != null ? sinal((x.gols || 0) - (x.xg || 0)) : '–', (x.gols || 0) - (x.xg || 0) >= 0 ? 'acima do esperado' : 'abaixo do esperado', null),
        tile('Finalizações', x.chutes || 0, `${p90(x.chutes)} por 90 min`, 'chutes'),
        tile('Chutes no gol', x.no_alvo || 0, `${pctTxt2(x.no_alvo || 0, x.chutes || 0)} das finalizações`, 'no_alvo'),
        tile('Grandes chances', x.grandes_chances || 0, 'chutes com xG acima de 0,30', 'grandes_chances'),
        tile('xG por finalização', x.fin ? dec((x.xg || 0) / x.fin, 2) : '–', 'qualidade média dos chutes', null),
        tile('Cabeceios', x.cabeceios || 0, null, null)]));
      const z = x.zonas || {};
      const totZ = (z.pequena_area || 0) + (z.area || 0) + (z.fora || 0) + (z.penalti || 0) + (z.falta || 0);
      if (totZ) grupos.push(grupo('Zona das finalizações', [tile('Pequena área', z.pequena_area || 0, pctTxt2(z.pequena_area || 0, totZ), null),
        tile('Dentro da área', z.area || 0, pctTxt2(z.area || 0, totZ), null), tile('Fora da área', z.fora || 0, pctTxt2(z.fora || 0, totZ), null),
        tile('Pênaltis e faltas diretas', (z.penalti || 0) + (z.falta || 0), pctTxt2((z.penalti || 0) + (z.falta || 0), totZ), null)]));
      grupos.push(grupo('Criação', [tile('Assistências', x.assist || 0, `${p90(x.assist)} por 90 min`, 'assist'),
        tile('Passes para finalização', x.chances || 0, `${p90(x.chances)} por 90 min`, 'chances'),
        tile('xA estimado', dec(x.xa, 2), 'xG dos chutes que ele deu o passe', 'xa'),
        tile('Assistências − xA', x.xa != null ? sinal((x.assist || 0) - (x.xa || 0)) : '–', null, null)]));
    }
    grupos.push(grupo('Duelos e disciplina', [tile('Faltas sofridas', x.sofridas || 0, `${p90(x.sofridas)} por 90 min`, 'sofridas'),
      tile('Faltas cometidas', x.faltas || 0, `${p90(x.faltas)} por 90 min`, null),
      tile('Pênaltis sofridos', x.penaltis_sofridos || 0, null, null), tile('Pênaltis cometidos', x.penaltis_cometidos || 0, null, null),
      tile('Impedimentos', x.impedimentos || 0, null, null), tile('Cartões', `${x.amarelos || 0} 🟨 · ${x.vermelhos || 0} 🟥`, null, null),
      x.contra ? tile('Gols contra', x.contra, null, null) : null]));
    // mapa de finalizações (posição de cada chute na narração da ESPN; o gol fica em cima)
    if (!goleiro && x.mapa && x.mapa.length) {
      const NS = 'http://www.w3.org/2000/svg';
      const sv = (tag, at) => { const e = document.createElementNS(NS, tag); Object.entries(at).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
      const svg = sv('svg', { viewBox: '-2 -3 72 46', class: 'mapa-chutes', role: 'img', 'aria-label': `Mapa das ${x.mapa.length} finalizações` });
      const linha = { fill: 'none', stroke: 'var(--line-strong, #9aa7a0)', 'stroke-width': '.35' };
      svg.append(sv('rect', { x: 0, y: 0, width: 68, height: 42, rx: 1, fill: 'var(--pitch-soft, rgba(16,96,60,.08))' }));
      svg.append(sv('rect', { x: 13.85, y: 0, width: 40.3, height: 16.5, ...linha }));
      svg.append(sv('rect', { x: 24.85, y: 0, width: 18.3, height: 5.5, ...linha }));
      svg.append(sv('path', { d: 'M26.7 16.5 A9.15 9.15 0 0 0 41.3 16.5', ...linha }));
      svg.append(sv('circle', { cx: 34, cy: 11, r: .45, fill: 'var(--muted)' }));
      svg.append(sv('rect', { x: 30.34, y: -1.6, width: 7.32, height: 1.6, fill: 'none', stroke: 'var(--fg)', 'stroke-width': '.4' }));
      const cor = { g: 'var(--good)', d: 'var(--accent)', b: 'var(--muted)', f: 'var(--bad)', t: 'var(--info)' };
      x.mapa.slice().sort((a, b) => (a[2] === 'g') - (b[2] === 'g')).forEach(([fx, fy, r, xg]) => {
        const cy = Math.min(41, fx * 52.5), cx = Math.max(0.5, Math.min(67.5, fy * 68));
        svg.append(sv('circle', { cx: cx.toFixed(2), cy: cy.toFixed(2), r: (0.7 + Math.sqrt(xg) * 2.2).toFixed(2), fill: cor[r] || 'var(--muted)',
          'fill-opacity': r === 'g' ? '.95' : '.6', stroke: r === 'g' ? 'var(--fg)' : 'none', 'stroke-width': '.25' }));
      });
      const leg = el('div', { class: 'mapa-leg small' }, [['g', 'Gol'], ['d', 'Defendido'], ['f', 'Para fora'], ['b', 'Bloqueado'], ['t', 'Trave']].map(([k, t]) =>
        el('span', null, el('i', { style: `background:${cor[k]}` }), t)), el('span', null, 'tamanho = xG'));
      app.append(el('section', null, secHead('Mapa', 'Onde ele finaliza', null), el('div', { class: 'card pad' }, svg, leg)));
    }

    // scout: as métricas principais da função, com percentil contra a mesma função (pelo menos 450 minutos)
    const fn = FUNCAO(x.pos);
    let pares = todos.filter((y) => FUNCAO(y.pos) === fn && (y.minutos || 0) >= 450);
    let rotPares = NOME_FUNCAO[fn];
    if (pares.length < 10) { pares = todos.filter((y) => GRUPO_POS(y.pos) === GRUPO_POS(x.pos) && (y.minutos || 0) >= 450); rotPares = NOME_GRUPO[GRUPO_POS(x.pos)].toLowerCase(); }
    const barras = el('div', { class: 'perfil' });
    const temMin = min >= 450 && pares.length >= 5;
    METRICAS[fn].forEach(([rot, f, fmt, inv]) => {
      const v = f(x);
      const pc = temMin ? Math.round(100 * pares.filter((y) => (inv ? f(y) > v : f(y) < v)).length / pares.length) : null;
      barras.append(el('div', { class: 'pf-l' + (pc == null ? ' sem' : '') }, el('span', { class: 'pf-r', text: rot }),
        el('b', { class: 'num pf-x', text: fmt(v) }),
        pc == null ? el('span', { class: 'pf-b' }) : el('span', { class: 'pf-b' }, el('i', { style: `width:${Math.max(3, pc)}%;background:${pc >= 75 ? 'var(--good)' : pc >= 40 ? 'var(--accent)' : 'var(--bad)'}` })),
        el('b', { class: 'num pf-v', title: pc == null ? '' : `Melhor que ${pc}% dos ${rotPares}`, text: pc == null ? '' : pc + '%' })));
    });
    app.append(el('section', null, secHead('Scout', RES_FUNCAO[fn], null),
      el('div', { class: 'card pad' }, barras, el('p', { class: 'small', style: 'margin:.6rem 0 0',
        text: temMin ? `A porcentagem diz de quantos dos ${pares.length} ${rotPares} com pelo menos 450 minutos ele é melhor naquele item (90% = melhor que 90% deles). Nas métricas em que menos é melhor, a conta já considera isso.`
          : 'Com menos de 450 minutos jogados, ainda não há comparação justa com os outros jogadores da função.' }))));

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
          el('span', { class: 'team' }, localIcone(emCasa), escudo(adv), el('span', { text: T[adv] ? T[adv].nome : '' }), el('span', { class: 'small num', text: ` ${j.gols_casa}–${j.gols_fora}` })),
          el('span', { class: 'small', text: feito })));
      });
      app.append(el('section', null, secHead('Jogos', 'Últimos jogos', null), card));
    }
    app.append(el('p', { class: 'small', text: 'Números somados jogo a jogo da temporada. Minutos calculados pelas substituições e expulsões. xG e xA são estimativas do Lima Score a partir da descrição de cada chute (zona, cabeça, pênalti, contra-ataque); não são os números da Opta. O número ao lado é a posição do jogador entre todos do campeonato.' }));
  }

  function telaClube(app, id) {
    const t = T[id];
    if (!t) { app.append(el('p', { class: 'erro', text: 'Clube não encontrado.' })); return; }
    app.append(el('a', { class: 'back', href: '#tabela', text: '← Tabela' }));
    app.append(el('header', { class: 'club-head' }, escudo(id, 'lg'),
      el('div', null, el('div', { class: 'eyebrow', text: `${t.pos}º colocado` }), el('h1', { text: t.nome }),
        t.tecnico ? el('div', { class: 'small clube-tec', text: `Técnico: ${t.tecnico.nome}${t.tecnico.interino ? ' (interino)' : ''}` }) : null)));

    const kp = el('div', { class: 'kpis' });
    [['Pontos', t.pts], ['Projeção', n1(t.pts_projetados)], ['Posição média', n1(t.pos_media) + 'º'], ['Campanha', `${t.v}V ${t.e}E ${t.d}D`],
      ['Saldo', sgTxt(t.sg)], ['Em casa', `${t.casa.gp} gols em ${t.casa.j}`], ['Fora', `${t.fora.gp} gols em ${t.fora.j}`]]
      .forEach(([k, v]) => kp.append(el('div', { class: 'card kpi' }, el('div', { class: 'k', text: k }), el('div', { class: 'v num', text: v }))));
    app.append(kp);

    // chances por faixa
    const faixas = el('div', { class: 'card pad' });
    [['Título', t.titulo, 'var(--accent)'], ['Libertadores (fase de grupos)', t.libertadores, 'var(--info)'], ['Pré-Libertadores', t.pre_libertadores, 'var(--teal)'],
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
        el('span', { class: 'team' }, localIcone(emCasa), escudo(adv), el('a', { href: '#clube-' + adv, text: T[adv] ? T[adv].nome : '' })),
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
      el('p', { class: 'small', text: 'Médias por jogo. O número ao lado é a posição do clube entre os 20 (1º = melhor).' }));
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
    app.append(el('p', { class: 'small nota-arb', text: `Cartões, faltas, pênaltis e VAR disponíveis em ${A.jogos_com_espn} de ${A.jogos_encerrados} jogos. Médias de cartões e pênaltis consideram só os jogos com esses dados.` }));
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
        text: 'Ainda não há decisões do VAR registradas. O robô lê os lances de revisão (gols anulados, pênaltis marcados ou anulados e expulsões após revisão) e o ranking aparece aqui conforme os jogos forem processados.' })));
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
