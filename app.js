/* Termômetro do Brasileirão — app */
(function () {
  'use strict';

  const DATA_URL = 'data/site.json';
  const TZ = 'America/Sao_Paulo';
  let D = null;           // dados do site
  let T = {};             // times por id
  let estado = { rodada: null, artilharia: 'gols', tabela: 'classificacao' };

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
    if (v >= 99.95) return '>99,9%';
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
      escudo(id, 'tb'));
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
      aoVivo(j) ? el('span', { class: 'tag', text: 'Ao vivo' })
        : encerrado(j) ? el('span', { text: 'Encerrado' })
          : opts.destaque ? el('span', { class: 'tag y', text: opts.destaque }) : null);
    let placar;
    if (encerrado(j)) placar = el('div', { class: 'sc final num', text: `${j.gols_casa} × ${j.gols_fora}` });
    else if (aoVivo(j) && j.gols_casa != null) placar = el('div', { class: 'sc live num', text: `${j.gols_casa} × ${j.gols_fora}` });
    else placar = el('div', { class: 'sc vs', 'aria-hidden': 'true', text: '×' });
    const card = el('article', { class: 'card game' }, top,
      el('div', { class: 'game-row' }, timeLink(j.casa, 'md'), placar, timeLink(j.fora, 'md')));
    if (p && !encerrado(j)) {
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
    if (!encerrado(j)) {
      const tv = el('div', { class: 'tv' }, el('span', { class: 'tv-k', text: 'Onde assistir' }));
      if (j.canais && j.canais.length) j.canais.forEach((c) => tv.append(el('span', { class: 'chip', text: c })));
      else tv.append(el('span', { class: 'small', text: 'A definir' }));
      card.append(tv);
    }
    return card;
  }
  const legendaJogo = () => el('div', { class: 'legend' },
    el('span', null, el('i', { style: 'background:var(--good)' }), 'Mandante vence'),
    el('span', null, el('i', { style: 'background:var(--muted)' }), 'Empate'),
    el('span', null, el('i', { style: 'background:var(--bad)' }), 'Visitante vence'));

  // ---------- telas
  function telaInicio(app) {
    const lider = D.times.slice().sort((a, b) => b.titulo - a.titulo)[0];
    const porRisco = D.times.slice().sort((a, b) => b.rebaixamento - a.rebaixamento);
    const certos = porRisco.filter((t) => t.rebaixamento >= 99.95);
    const abertos = porRisco.filter((t) => t.rebaixamento >= 5 && t.rebaixamento < 99.95);
    const vagas = 4 - certos.length;
    const r = rodadaAtual();
    const restamRodadas = 38 - r + 1;

    let frase;
    if (lider.titulo >= 99.95) frase = `${lider.nome} está praticamente campeão.`;
    else frase = `${lider.nome} tem ${pct(lider.titulo)} de chance de título.`;
    if (vagas > 0 && abertos.length) {
      const nomes = abertos.map((t) => t.nome);
      frase += ` Na parte de baixo, ${nomes.length} clubes disputam ${vagas} ${vagas === 1 ? 'vaga' : 'vagas'} na zona de rebaixamento: ${nomes.slice(0, -1).join(', ')}${nomes.length > 1 ? ' e ' : ''}${nomes.at(-1)}.`;
    }

    app.append(el('section', { class: 'hero', 'aria-label': 'Resumo' },
      el('div', null,
        el('div', { class: 'eyebrow', text: `Brasileirão ${D.temporada.inicio.slice(0, 4)} · ${restamRodadas > 0 ? 'rodada ' + r : 'fim do campeonato'}` }),
        el('h1', { text: 'A reta final em números' }),
        el('p', { text: frase })),
      el('div', { class: 'board' },
        el('div', null, el('div', { class: 'k', text: 'Chance de título' }), el('div', { class: 'v y num', text: pct(lider.titulo) }),
          el('div', { class: 's' }, escudo(lider.id), `${lider.nome} · ${lider.pts} pts`)),
        el('div', null, el('div', { class: 'k', text: 'Rebaixados' }), el('div', { class: 'v num', text: String(certos.length) }),
          el('div', { class: 's', text: certos.map((t) => t.nome).join(' e ') || 'Nenhum definido ainda' })),
        el('div', null, el('div', { class: 'k', text: 'Rodadas restantes' }), el('div', { class: 'v num', text: String(Math.max(0, restamRodadas)) }),
          el('div', { class: 's', text: 'Fim em ' + new Date(D.temporada.fim + 'T12:00:00Z').toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' }) })))));

    // risco de rebaixamento
    const risk = el('div', { class: 'risk' });
    porRisco.filter((t) => t.rebaixamento >= 1).forEach((t) => {
      const lvl = t.rebaixamento >= 50 ? 'hi' : t.rebaixamento >= 15 ? 'mid' : 'lo';
      const mat = rebaixadoMatematicamente(t);
      risk.append(el('a', { href: '#clube-' + t.id },
        el('div', { class: 'card risk-card lvl-' + lvl },
          mat ? el('span', { class: 'tag', text: 'Rebaixado' }) : t.rebaixamento >= 99.95 ? el('span', { class: 'tag', text: 'Praticamente rebaixado' }) : null,
          el('div', { class: 'team' }, escudo(t.id), el('span', { style: 'font-weight:700', text: t.nome })),
          el('div', { class: 'pct num', text: mat ? '100%' : pct(t.rebaixamento) }),
          el('div', { class: 'meter' }, el('span', { style: `width:${Math.max(2, t.rebaixamento)}%` })),
          el('div', { class: 'small num', text: `${t.pos}º · ${t.pts} pts · projeção ${n1(t.pts_projetados)}` }))));
    });
    app.append(el('section', null, secHead('Zona de rebaixamento', 'Quem corre risco de cair', `Chance de terminar entre os quatro últimos, em ${D.simulacoes.toLocaleString('pt-BR')} simulações do resto do campeonato.`), risk));

    // próximos jogos
    const proximos = D.jogos.filter((j) => j.rodada === r && !encerrado(j));
    if (proximos.length) {
      const zr = new Set(abertos.map((t) => t.id));
      proximos.sort((a, b) => (zr.has(b.casa) || zr.has(b.fora)) - (zr.has(a.casa) || zr.has(a.fora)) || a.data.localeCompare(b.data));
      const g = el('div', { class: 'games' });
      proximos.forEach((j) => g.append(cartaoJogo(j, { destaque: zr.has(j.casa) || zr.has(j.fora) ? 'Mexe com o Z4' : null })));
      app.append(el('section', null, secHead(`${r}ª rodada`, 'Palpites dos próximos jogos', 'Chance de vitória de cada time e de empate.'), legendaJogo(), g,
        el('p', null, el('a', { href: '#rodadas', text: 'Ver todas as rodadas →' }))));
    }

    // artilheiros
    const top = D.jogadores.slice().sort((a, b) => b.gols - a.gols || a.jogos - b.jogos).slice(0, 5);
    const lista = el('div', { class: 'card players' });
    top.forEach((p, i) => lista.append(linhaJogador(p, i + 1, 'gols')));
    app.append(el('section', null, secHead('Artilharia', 'Goleadores do campeonato', null), lista,
      el('p', null, el('a', { href: '#artilharia', text: 'Ver artilheiros e garçons →' }))));

    app.append(metodo());
  }

  function telaTabela(app) {
    app.append(secHead('Classificação', 'Tabela do Brasileirão', 'Posição atual e as chances de cada clube em cada faixa da tabela ao fim da 38ª rodada.', 'h1'));
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Visão da tabela' });
    [['classificacao', 'Classificação'], ['chances', 'Chances']].forEach(([k, txt]) => {
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
    card.append(wrap, el('div', { class: 'zones' },
      el('span', null, el('i', { style: 'background:var(--info)' }), 'Libertadores'),
      el('span', null, el('i', { style: 'background:var(--teal)' }), 'Pré-Libertadores'),
      el('span', null, el('i', { style: 'background:var(--good)' }), 'Sul-Americana'),
      el('span', null, el('i', { style: 'background:var(--bad)' }), 'Rebaixamento'),
      estado.tabela === 'chances' ? el('span', { text: 'Ordenada pela projeção de pontos' }) : null));
    app.append(card, el('p', { class: 'small', text: 'As vagas em Libertadores e Sul-Americana podem mudar conforme os campeões da Copa do Brasil e das competições continentais.' }));
  }

  function telaRodadas(app) {
    if (estado.rodada == null) estado.rodada = rodadaAtual();
    const r = estado.rodada;
    const atual = rodadaAtual();
    app.append(secHead('Todas as rodadas', 'Rodadas', 'Resultados dos jogos disputados e previsão dos que faltam.', 'h1'));
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
      el('b', { text: p.nome }),
      el('span', { class: 'small' }, escudo(p.time), el('a', { href: '#clube-' + p.time, text: t ? t.nome : '' }), ` · ${p.jogos} jogos`));
    const valor = modo === 'gols' ? p.gols : p.assistencias;
    const stat = el('div', { class: 'stat' },
      el('div', { class: 'big num' }, String(valor), el('small', { text: modo === 'gols' ? 'gols' : 'assist.' })));
    return el('div', { class: 'pl' }, el('span', { class: 'rk num', text: rank }), quem, stat);
  }

  function telaArtilharia(app) {
    app.append(secHead('Artilharia', 'Artilheiros e garçons', 'Ranking de gols e assistências do campeonato.', 'h1'));
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Ranking' });
    [['gols', 'Gols'], ['assistencias', 'Assistências']].forEach(([k, txt]) => {
      seg.append(el('button', { type: 'button', 'aria-pressed': String(estado.artilharia === k), text: txt, onclick: () => { estado.artilharia = k; render(); } }));
    });
    app.append(seg);
    const modo = estado.artilharia;
    const lista = D.jogadores.filter((p) => (modo === 'gols' ? p.gols : p.assistencias) > 0)
      .sort((a, b) => modo === 'gols' ? (b.gols - a.gols || b.assistencias - a.assistencias) : (b.assistencias - a.assistencias || b.gols - a.gols))
      .slice(0, 40);
    const card = el('div', { class: 'card players' });
    let rank = 0, ultimo = null;
    lista.forEach((p, i) => {
      const v = modo === 'gols' ? p.gols : p.assistencias;
      if (v !== ultimo) { rank = i + 1; ultimo = v; }
      card.append(linhaJogador(p, rank, modo === 'gols' ? 'gols' : 'assist'));
    });
    app.append(card);
    if (modo !== 'gols') app.append(el('p', { class: 'small', text: 'O ranking de assistências considera os 100 maiores artilheiros, que é o que a fonte de dados informa. Um jogador que dá muitas assistências mas marca pouco pode não aparecer.' }));
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
      el('div', null, secHead('Próximos jogos', 'O que falta', 'Com a chance de vitória em cada jogo.'), colA),
      el('div', null, secHead('Resultados', 'Últimos jogos', null), colB)));

    // jogadores
    const js = D.jogadores.filter((p) => p.time === id).sort((a, b) => b.gols - a.gols || b.assistencias - a.assistencias);
    if (js.length) {
      const lista = el('div', { class: 'card players' });
      js.forEach((p, i) => lista.append(linhaJogador(p, i + 1, 'gols')));
      app.append(el('section', null, secHead('Elenco', 'Artilheiros do clube', null), lista));
    }
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

  function metodo() {
    return el('details', { class: 'card how' }, el('summary', { text: 'Como as previsões são feitas' }),
      el('ol', null,
        el('li', { text: 'Para cada jogo, cruzamos a média de gols que o mandante marca em casa com a que o visitante sofre fora, e o contrário, em relação à média do campeonato.' }),
        el('li', { text: 'A fase recente ajusta ataque e defesa: últimos 5 jogos com peso 60% e últimos 10 com peso 40%.' }),
        el('li', { text: 'Com os gols esperados, a distribuição de Poisson dá a chance de vitória, empate e derrota em cada jogo.' }),
        el('li', { text: `O resto do campeonato é simulado ${D.simulacoes.toLocaleString('pt-BR')} vezes. A chance de cada faixa é a parte das simulações em que o clube termina nela.` }),
        el('li', { text: 'Os dados são atualizados automaticamente alguns minutos depois do fim de cada jogo.' })));
  }

  // ---------- roteamento
  function rota() {
    const h = (location.hash || '#inicio').slice(1);
    if (h.startsWith('clube-')) return { tela: 'clube', id: +h.slice(6) };
    if (['inicio', 'tabela', 'rodadas', 'artilharia'].includes(h)) return { tela: h };
    return { tela: 'inicio' };
  }
  function render() {
    if (!D) return;
    const app = $('#app');
    const r = rota();
    const y = window.scrollY;
    app.replaceChildren();
    if (r.tela === 'inicio') telaInicio(app);
    else if (r.tela === 'tabela') telaTabela(app);
    else if (r.tela === 'rodadas') telaRodadas(app);
    else if (r.tela === 'artilharia') telaArtilharia(app);
    else telaClube(app, r.id);
    const navKey = r.tela === 'clube' ? 'tabela' : r.tela;
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = r.tela === 'clube' && T[r.id] ? `${T[r.id].nome} · Termômetro do Brasileirão` : 'Termômetro do Brasileirão';
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

  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) carregar(true); });
  setInterval(() => carregar(true), 5 * 60 * 1000);
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
