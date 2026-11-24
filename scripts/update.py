"""
Termômetro do Brasileirão — robô de atualização.

Baixa a tabela, os jogos e os artilheiros do Brasileirão no football-data.org,
calcula a previsão de cada jogo que falta, simula o fim do campeonato e grava
tudo em data/site.json, que o site lê.

Roda no GitHub Actions. A chave fica no segredo FOOTBALL_DATA_TOKEN.
Também roda no seu computador:  FOOTBALL_DATA_TOKEN=suachave python scripts/update.py
"""
import json
import math
import re
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

API = "https://api.football-data.org/v4"
COMP = "BSA"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "site.json"
N_SIM = 20000
SEED = 2026  # semente fixa: mesmos dados -> mesmos números

# Nomes como o torcedor conhece (o football-data usa outros em alguns clubes)
NOMES = {
    "Paranaense": "Athletico-PR",
    "Mineiro": "Atlético-MG",
    "Clube do Remo": "Remo",
    "Vasco da Gama": "Vasco",
    "Bragantino": "Bragantino",
}
SIGLAS = {"Corinthians": "COR", "Coritiba": "CFC", "Grêmio": "GRE", "São Paulo": "SAO",
          "Internacional": "INT", "Clube do Remo": "REM"}
# Escudos que o football-data ainda mostra na versão antiga
ESCUDOS = {
    1768: "https://r2.thesportsdb.com/images/media/team/badge/irzu1u1554237406.png/medium",  # Athletico-PR (escudo atual)
}

# Faixas fixas da tabela. Libertadores, Pré e Sul-Americana mudam conforme as copas: ver regras_vagas()
# e data/vagas.json.
FAIXAS = [
    ("titulo", 1, 1),
    ("rebaixamento", 17, 20),
]
ARQ_VAGAS = ROOT / "data" / "vagas.json"


def baixar(caminho, token):
    req = urllib.request.Request(API + caminho, headers={"X-Auth-Token": token})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def estatisticas_dos_clubes(saida_jogos, espn):
    """Números de cada clube na temporada, a partir das estatísticas e dos lances da ESPN,
    com a posição do clube entre os 20 em cada número."""
    def minuto(txt):
        nums = [int(x) for x in re.findall(r"\d+", txt or "")]
        return (nums[0] + (nums[1] if len(nums) > 1 else 0)) if nums else None

    reg = {}
    for jg in saida_jogos:
        if jg["status"] != "FINISHED":
            continue
        e = espn.get(str(jg["id"])) or {}
        for ld, outro in (("casa", "fora"), ("fora", "casa")):
            cid = jg[ld]
            r = reg.setdefault(cid, dict(jogos=0, com_dados=0, soma={}, sofrido={}, gols=0, sofridos=0, sem_sofrer=0, sem_marcar=0,
                                         g1t=0, g2t=0, s1t=0, s2t=0, g_final=0, s_final=0, g_pen=0, s_pen=0,
                                         virada_pts=0, cedeu_pts=0, saiu_atras=0, saiu_frente=0, maior_v=None, maior_d=None,
                                         pub_casa=[], pub_fora=[]))
            gp, gc = (jg["gols_casa"], jg["gols_fora"]) if ld == "casa" else (jg["gols_fora"], jg["gols_casa"])
            r["jogos"] += 1
            r["gols"] += gp; r["sofridos"] += gc
            r["sem_sofrer"] += gc == 0; r["sem_marcar"] += gp == 0
            if gp > gc and (r["maior_v"] is None or gp - gc > r["maior_v"][0]):
                r["maior_v"] = (gp - gc, jg["id"])
            if gp < gc and (r["maior_d"] is None or gc - gp > r["maior_d"][0]):
                r["maior_d"] = (gc - gp, jg["id"])
            if e.get("publico"):
                r["pub_" + ld].append(e["publico"])
            st, so = e.get(ld) or {}, e.get(outro) or {}
            if st:
                r["com_dados"] += 1
                for k, v in st.items():
                    if isinstance(v, (int, float)):
                        r["soma"][k] = r["soma"].get(k, 0) + v
                for k, v in so.items():
                    if isinstance(v, (int, float)):
                        r["sofrido"][k] = r["sofrido"].get(k, 0) + v
            # gols por momento do jogo e viradas (só quando os lances batem com o placar)
            gols = [l for l in e.get("lances") or [] if l.get("tipo") == "gol"]
            if gols and sum(1 for l in gols if l["lado"] == ld) == gp and sum(1 for l in gols if l["lado"] == outro) == gc:
                placar = [0, 0]
                atras = frente = False
                for l in gols:
                    m = minuto(l.get("minuto")) or 0
                    base = int((re.findall(r"\d+", l.get("minuto") or "0") or ["0"])[0])
                    meu = l["lado"] == ld
                    placar[0 if meu else 1] += 1
                    pre = "g" if meu else "s"
                    r[pre + ("1t" if base <= 45 else "2t")] += 1
                    if m >= 76:
                        r[pre + "_final"] += 1
                    if l.get("penalti"):
                        r[pre + "_pen"] += 1
                    if placar[0] < placar[1]:
                        atras = True
                    if placar[0] > placar[1]:
                        frente = True
                pts = 3 if gp > gc else 1 if gp == gc else 0
                if atras:
                    r["saiu_atras"] += 1; r["virada_pts"] += pts
                if frente:
                    r["saiu_frente"] += 1; r["cedeu_pts"] += 3 - pts
    out = {}
    for cid, r in reg.items():
        n = r["com_dados"] or 1
        med = lambda d, k, c=1: round(d.get(k, 0) / n, c)
        out[cid] = dict(
            jogos=r["jogos"], com_dados=r["com_dados"],
            gols_jogo=round(r["gols"] / max(r["jogos"], 1), 2), sofridos_jogo=round(r["sofridos"] / max(r["jogos"], 1), 2),
            sem_sofrer=r["sem_sofrer"], sem_marcar=r["sem_marcar"],
            posse=med(r["soma"], "posse"), finalizacoes=med(r["soma"], "finalizacoes"), no_alvo=med(r["soma"], "no_alvo"),
            finalizacoes_sofridas=med(r["sofrido"], "finalizacoes"), no_alvo_sofridos=med(r["sofrido"], "no_alvo"),
            escanteios=med(r["soma"], "escanteios"), faltas=med(r["soma"], "faltas"), faltas_sofridas=med(r["sofrido"], "faltas"),
            impedimentos=med(r["soma"], "impedimentos"), defesas=med(r["soma"], "defesas"), passes=med(r["soma"], "passes", 0),
            precisao_passes=med(r["soma"], "precisao_passes"),
            amarelos=int(r["soma"].get("amarelos", 0)), vermelhos=int(r["soma"].get("vermelhos", 0)),
            aproveitamento_chutes=round(100 * r["gols"] / r["soma"]["no_alvo"], 1) if r["soma"].get("no_alvo") else None,
            g1t=r["g1t"], g2t=r["g2t"], s1t=r["s1t"], s2t=r["s2t"], g_final=r["g_final"], s_final=r["s_final"],
            g_pen=r["g_pen"], s_pen=r["s_pen"],
            saiu_atras=r["saiu_atras"], virada_pts=r["virada_pts"], saiu_frente=r["saiu_frente"], cedeu_pts=r["cedeu_pts"],
            maior_v=r["maior_v"][1] if r["maior_v"] else None, maior_d=r["maior_d"][1] if r["maior_d"] else None,
            publico_casa=round(sum(r["pub_casa"]) / len(r["pub_casa"])) if r["pub_casa"] else None,
            publico_fora=round(sum(r["pub_fora"]) / len(r["pub_fora"])) if r["pub_fora"] else None,
            publico_casa_jogos=len(r["pub_casa"]), publico_fora_jogos=len(r["pub_fora"]),
            publico_casa_max=max(r["pub_casa"]) if r["pub_casa"] else None,
        )
    # posição de cada clube em cada número (1º = melhor; para números "ruins", menor é melhor)
    menor_melhor = {"sofridos_jogo", "finalizacoes_sofridas", "no_alvo_sofridos", "faltas", "amarelos", "vermelhos", "sem_marcar",
                    "impedimentos", "s1t", "s2t", "s_final", "s_pen", "cedeu_pts"}
    for k in ("gols_jogo", "sofridos_jogo", "sem_sofrer", "posse", "finalizacoes", "no_alvo", "finalizacoes_sofridas",
              "no_alvo_sofridos", "escanteios", "faltas", "faltas_sofridas", "impedimentos", "defesas", "passes",
              "precisao_passes", "amarelos", "vermelhos", "aproveitamento_chutes", "virada_pts", "cedeu_pts", "g_final", "s_final",
              "publico_casa", "publico_fora"):
        vals = sorted(((v[k], c) for c, v in out.items() if v.get(k) is not None), reverse=k not in menor_melhor)
        for pos, (val, c) in enumerate(vals, 1):
            empate = next(i for i, (x, _) in enumerate(vals, 1) if x == val)
            out[c].setdefault("rank", {})[k] = empate
    return out


def _posicao_chute(x, y):
    """Posição do chute no meio-campo de ataque: (distância até a linha do gol / 52,5 m, largura de 0 a 1).
    A narração usa duas escalas: 0–1 (já a partir do gol) e 0–100 (campo inteiro, atacando para o 100).
    Sem posição (0, 0) ou fora do campo: descarta."""
    if x is None or y is None:
        return None
    if x > 1.5 or y > 1.5:  # escala 0–100
        if x >= 99 or x < 50:
            return None
        x, y = (100 - x) * 1.05 / 52.5, y / 100
    if x <= 0.005 and y <= 0.005:
        return None
    if not (0 < x <= 1 and 0 <= y <= 1):
        return None
    return [round(x, 3), round(y, 3)]


def _tokens_arbitro(nome):
    """'Daronco, Anderson' -> ['anderson', 'daronco']; tira acentos, 'de/da/do/dos' e 'Filho/Júnior'."""
    n = _sem_acento(nome)
    if "," in n:
        a, b = [x.strip() for x in n.split(",", 1)]
        n = f"{b} {a}"
    t = [x for x in re.split(r"[^a-z]+", n) if x and x not in ("de", "da", "do", "dos", "das", "e")]
    while len(t) > 2 and t[-1] in ("filho", "fillho", "junior", "neto", "sobrinho"):
        t.pop()
    return t


def _arbitros_cbf(saida_jogos):
    """Escala oficial da CBF (scripts/arbitros_cbf.py): quando existe, vale mais que as outras fontes."""
    arq = ROOT / "data" / "arbitros_cbf.json"
    cbf = (json.loads(arq.read_text(encoding="utf-8")) if arq.exists() else {}).get("jogos", {})
    por_par = {(x.get("casa_id"), x.get("fora_id")): x for x in cbf.values() if x.get("casa_id") and x.get("fora_id")}
    for jg in saida_jogos:
        x = por_par.get((jg["casa"], jg["fora"]))
        if not x:
            continue
        eq = x.get("equipe") or {}
        if (eq.get("arbitro") or {}).get("nome"):
            jg["arbitro"] = eq["arbitro"]["nome"]
            jg["arbitro_uf"] = eq["arbitro"].get("uf") or None
        if (eq.get("var") or {}).get("nome"):
            jg["arbitro_var"] = eq["var"]["nome"]


def unificar_arbitros(saida_jogos):
    _arbitros_cbf(saida_jogos)
    _arbitros_manuais(saida_jogos)
    _unificar(saida_jogos)


def _arbitros_manuais(saida_jogos):
    arq = ROOT / "data" / "arbitros_manual.json"
    man = (json.loads(arq.read_text(encoding="utf-8")) if arq.exists() else {}).get("jogos", {})
    for jg in saida_jogos:
        if not jg.get("arbitro") and man.get(str(jg["id"])):
            jg["arbitro"] = man[str(jg["id"])]


def _unificar(saida_jogos):
    """O mesmo árbitro vem com nomes diferentes (football-data x outra fonte: 'Wilton Sampaio' e
    'Wilton Pereira Sampaio', 'Daronco, Anderson', maiúsculas). Junta numa grafia só: mesmo primeiro
    nome e todas as palavras do nome curto contidas no nome longo."""
    cont = {}
    for jg in saida_jogos:
        if jg.get("arbitro"):
            cont[jg["arbitro"]] = cont.get(jg["arbitro"], 0) + 1
    nomes = sorted(cont, key=lambda n: (-len(_tokens_arbitro(n)), -cont[n]))
    grupos = []  # [tokens do nome mais completo, [grafias]]
    for n in nomes:
        tk = _tokens_arbitro(n)
        if not tk:
            continue
        for g in grupos:
            gt = g[0]
            mesmo_inicio_fim = tk[0] == gt[0] and tk[-1] == gt[-1] and len(set(tk) & set(gt)) >= 3
            if (tk[0] == gt[0] and set(tk) <= set(gt) and (len(tk) >= 2 and tk[-1] in gt)) or mesmo_inicio_fim:
                g[1].append(n)
                break
        else:
            grupos.append([tk, [n]])
    canon = {}
    for tk, grafias in grupos:
        # grafia exibida: a mais usada entre as que não estão no formato "Sobrenome, Nome"; 'De/Da' em minúsculo
        boas = [g for g in grafias if "," not in g] or grafias
        escolhido = max(boas, key=lambda g: (sum(cont[x] for x in grafias if _tokens_arbitro(x) == _tokens_arbitro(g)), len(g)))
        if "," in escolhido:
            a, b = [x.strip() for x in escolhido.split(",", 1)]
            escolhido = f"{b} {a}"
        escolhido = re.sub(r"\b(De|Da|Do|Dos|Das)\b", lambda m: m.group(1).lower(), escolhido)
        for g in grafias:
            canon[g] = escolhido
    for jg in saida_jogos:
        if jg.get("arbitro"):
            jg["arbitro"] = canon.get(jg["arbitro"], jg["arbitro"])


def _sem_acento(n):
    import unicodedata
    return unicodedata.normalize("NFKD", n or "").encode("ascii", "ignore").decode().lower().strip()


def montar_jogadores(saida_jogos):
    """Números de cada jogador na temporada, somando jogo a jogo as escalações da ESPN
    (data/escalacoes.json). Grava data/jogadores.json, lido pela aba Jogadores."""
    arq = ROOT / "data" / "escalacoes.json"
    if not arq.exists():
        return
    esc = json.loads(arq.read_text(encoding="utf-8"))
    por_id = {str(j["id"]): j for j in saida_jogos}
    # lances de gol (com minuto) de cada jogo, para os "gols úteis"
    try:
        lances_jogo = {k: v.get("lances") or [] for k, v in
                       json.loads((ROOT / "data" / "estatisticas.json").read_text(encoding="utf-8")).get("jogos", {}).items()}
    except Exception:
        lances_jogo = {}
    CAMPOS = {"totalGoals": "gols", "goalAssists": "assist", "totalShots": "chutes", "shotsOnTarget": "no_alvo",
              "foulsCommitted": "faltas", "foulsSuffered": "sofridas", "offsides": "impedimentos",
              "yellowCards": "amarelos", "redCards": "vermelhos", "ownGoals": "contra", "saves": "defesas",
              "goalsConceded": "gols_sofridos", "shotsFaced": "chutes_sofridos"}
    jog = {}
    for jid, lados in sorted(esc.items(), key=lambda x: (por_id.get(x[0]) or {}).get("data", "")):
        jg = por_id.get(jid)
        if not jg or jg["status"] != "FINISHED":
            continue
        for lado in ("casa", "fora"):
            cid = jg[lado]
            sofreu = jg["gols_fora"] if lado == "casa" else jg["gols_casa"]
            for p in lados.get(lado) or []:
                r = jog.setdefault(p["id"], dict(id=p["id"], nome=p["nome"], pos={}, camisa=None, clube=cid,
                                                  jogos=0, titular=0, entrou=0, sem_sofrer=0, ultimos=[], minutos=0, jogos_sem_min=0,
                                                  **{v: 0 for v in CAMPOS.values()}))
                r["nome"] = p["nome"] or r["nome"]
                r["clube"] = cid  # clube do jogo mais recente (acompanha transferências)
                r["camisa"] = p.get("camisa") or r["camisa"]
                if p.get("pos"):
                    r["pos"][p["pos"]] = r["pos"].get(p["pos"], 0) + 1
                r["jogos"] += 1
                if p.get("minutos"):
                    r["minutos"] += int(p["minutos"])
                else:
                    r["jogos_sem_min"] += 1
                r["titular"] += bool(p.get("titular"))
                r["entrou"] += bool(p.get("entrou"))
                st = p.get("stats") or {}
                for k, v in CAMPOS.items():
                    r[v] += int(st.get(k) or 0)
                if p.get("pos") == "Goleiro" and p.get("titular") and not p.get("saiu") and sofreu == 0:
                    r["sem_sofrer"] += 1
                r["ultimos"].append([int(jid), int(st.get("totalGoals") or 0), int(st.get("goalAssists") or 0),
                                     1 if p.get("titular") else 0])
        # finalizações e passes para finalização (narração): liga o nome ao jogador do elenco daquele jogo
        nomes = {}
        for lado in ("casa", "fora"):
            for p in lados.get(lado) or []:
                nomes[(p.get("nome") or "")] = p["id"]
                nomes[_sem_acento(p.get("nome"))] = p["id"]
        def quem(nome):
            return nomes.get(nome or "") or nomes.get(_sem_acento(nome))
        # gols úteis: gols que deixam o time exatamente 1 gol à frente (1x0, 2x1, 3x2...),
        # ou seja, os que tiram o time do empate. Gol contra muda o placar mas não conta para ninguém.
        gols_jogo = [l for l in lances_jogo.get(jid, []) if l.get("tipo") == "gol"]
        if len(gols_jogo) == jg["gols_casa"] + jg["gols_fora"]:  # só usa jogos com todos os gols nos lances
            plac = {"casa": 0, "fora": 0}
            for l in gols_jogo:
                lado = l["lado"]
                plac[lado] += 1
                outro = "fora" if lado == "casa" else "casa"
                if plac[lado] - plac[outro] == 1 and not l.get("contra"):
                    pid = quem(l.get("jogador"))
                    if pid in jog:
                        jog[pid]["gols_uteis"] = jog[pid].get("gols_uteis", 0) + 1
        for c in lados.get("chutes") or []:
            pid = quem(c.get("j"))
            if pid in jog:
                r = jog[pid]
                r["xg"] = round(r.get("xg", 0) + c["xg"], 3)
                r["fin"] = r.get("fin", 0) + 1
                z = r.setdefault("zonas", {})
                z[c["zona"]] = z.get(c["zona"], 0) + 1
                if c.get("cab"):
                    r["cabeceios"] = r.get("cabeceios", 0) + 1
                    if c["res"] == "gol":
                        r["gols_cabeca"] = r.get("gols_cabeca", 0) + 1
                if c["zona"] == "fora":
                    r["chutes_fora"] = r.get("chutes_fora", 0) + 1
                    if c["res"] == "gol":
                        r["gols_fora"] = r.get("gols_fora", 0) + 1
                if c["xg"] >= 0.3 and c["zona"] != "penalti":
                    r["grandes_chances"] = r.get("grandes_chances", 0) + 1
                pos = _posicao_chute(c.get("x"), c.get("y"))
                if pos and len(r.setdefault("mapa", [])) < 150:
                    r["mapa"].append([pos[0], pos[1], c["res"][0], c["xg"]])
            aid = quem(c.get("a"))
            if aid in jog:
                r = jog[aid]
                r["chances"] = r.get("chances", 0) + 1
                r["xa"] = round(r.get("xa", 0) + c["xg"], 3)
                if c.get("tp") in ("cruzamento", "escanteio"):
                    r["ch_cruz"] = r.get("ch_cruz", 0) + 1
                if c.get("tp") == "enfiada":
                    r["ch_enfiada"] = r.get("ch_enfiada", 0) + 1
                if c.get("tp") in ("escanteio", "bola_parada"):
                    r["ch_parada"] = r.get("ch_parada", 0) + 1
            gid = quem(c.get("gk"))
            if gid in jog and c["res"] == "defendido":
                r = jog[gid]
                r["def_" + ("pen" if c["zona"] == "penalti" else "fora" if c["zona"] == "fora" else "area")] = \
                    r.get("def_" + ("pen" if c["zona"] == "penalti" else "fora" if c["zona"] == "fora" else "area"), 0) + 1
                r["xg_defendido"] = round(r.get("xg_defendido", 0) + c["xg"], 3)
        for nome, acs in (lados.get("acoes") or {}).items():
            pid = quem(nome)
            if pid in jog:
                for k in ("penaltis_sofridos", "penaltis_cometidos"):
                    if acs.get(k):
                        jog[pid][k] = jog[pid].get(k, 0) + acs[k]
    # calibra o xG estimado para que a soma bata com os gols da temporada (tira o viés da tabela de zonas)
    tot_xg = sum(r.get("xg", 0) for r in jog.values())
    tot_gols = sum(r.get("gols", 0) for r in jog.values() if r.get("fin"))
    fator = (tot_gols / tot_xg) if tot_xg and tot_gols else 1.0
    fator = min(max(fator, 0.7), 1.3)
    for r in jog.values():
        if "xg" in r:
            r["xg"] = round(r["xg"] * fator, 2)
        if "xa" in r:
            r["xa"] = round(r["xa"] * fator, 2)
        for m in r.get("mapa") or []:
            m[3] = round(m[3] * fator, 3)
    saida = []
    for r in jog.values():
        r["pos"] = max(r["pos"], key=r["pos"].get) if r["pos"] else None
        r["ultimos"] = r["ultimos"][-5:]
        saida.append({k: v for k, v in r.items() if v not in (0, None) or k in ("jogos", "gols", "assist", "titular")})
    saida.sort(key=lambda r: (r["clube"], -r["jogos"], r["nome"] or ""))
    conteudo = dict(jogos_lidos=len([1 for jid in esc if (por_id.get(jid) or {}).get("status") == "FINISHED"]),
                    jogadores=saida)
    out = ROOT / "data" / "jogadores.json"
    novo = json.dumps(conteudo, ensure_ascii=False, separators=(",", ":"))
    if not out.exists() or out.read_text(encoding="utf-8") != novo:
        out.write_text(novo, encoding="utf-8")
        print(f"Jogadores: {len(saida)} jogadores em {conteudo['jogos_lidos']} jogos.")


def _titulares_ge(grupos, cid, elencos):
    """Linhas do ge (goleiro; defesa; meio; ataque) -> titulares com posição aproximada e camisa do elenco."""
    n = len(grupos)
    if n == 4:
        rot = ["Goleiro", "Zagueiro", "Meio-campista", "Atacante"]
    elif n == 5:
        rot = ["Goleiro", "Zagueiro", "Volante", "Meia", "Atacante"]
    else:
        rot = ["Goleiro"] + ["Zagueiro"] + ["Meio-campista"] * max(0, n - 3) + ["Atacante"]
    el = elencos.get(cid, [])
    def acha(nome):
        a = _sem_acento(nome)
        for x in sorted(el, key=lambda y: -y.get("jogos", 0)):
            b = _sem_acento(x.get("nome"))
            if a == b or b.endswith(" " + a) or a.endswith(" " + b) or b.startswith(a + " ") or a.startswith(b + " "):
                return x
        return None
    out = []
    for i, g in enumerate(grupos):
        for nome in g:
            x = acha(nome)
            pos = rot[min(i, len(rot) - 1)]
            if x and x.get("pos") and i not in (0,):
                # usa o lado do campo do elenco (lateral esquerdo/direito, ponta) quando bate com a linha
                if any(k in x["pos"] for k in ("Lateral", "Ala")) and pos == "Zagueiro":
                    pos = x["pos"]
                if x["pos"] == "Ponta" and pos == "Atacante":
                    pos = "Ponta"
            out.append(dict(n=nome, c=(x or {}).get("camisa"), p=pos))
    return out


def provaveis_escalacoes(saida_jogos):
    """Provável escalação de cada clube no próximo jogo: os titulares do último jogo, tirando quem
    está suspenso (vermelho no último jogo ou 3º, 6º, 9º... amarelo) e pondo no lugar quem mais foi
    titular na mesma posição. Lesões e escolhas do técnico não entram."""
    arq = ROOT / "data" / "escalacoes.json"
    if not arq.exists():
        return {}
    esc = json.loads(arq.read_text(encoding="utf-8"))
    por_id = {str(j["id"]): j for j in saida_jogos}
    encerrados = sorted((j for j in saida_jogos if j["status"] == "FINISHED" and str(j["id"]) in esc), key=lambda j: j["data"])
    ultimo, amarelos, titularidades, info = {}, {}, {}, {}
    for j in encerrados:
        for lado in ("casa", "fora"):
            cid = j[lado]
            jogs = esc[str(j["id"])].get(lado) or []
            if not any(p.get("titular") for p in jogs):
                continue
            ultimo[cid] = (j, jogs)
            for p in jogs:
                k = (cid, p["id"])
                amarelos[k] = amarelos.get(k, 0) + int((p.get("stats") or {}).get("yellowCards") or 0)
                if p.get("titular"):
                    titularidades[k] = titularidades.get(k, 0) + 1
                info[k] = (p.get("nome"), p.get("camisa"), p.get("pos"))
    def grupo(pos):
        pos = (pos or "").lower()
        return 0 if "goleiro" in pos else 1 if any(x in pos for x in ("zagueiro", "lateral", "ala", "defensor")) else \
            2 if any(x in pos for x in ("volante", "meia", "meio")) else 3
    out = {}
    for cid, (jg, jogs) in ultimo.items():
        suspensos, xi = [], []
        for p in jogs:
            st = p.get("stats") or {}
            k = (cid, p["id"])
            motivo = None
            if int(st.get("redCards") or 0):
                motivo = "expulso no último jogo"
            elif int(st.get("yellowCards") or 0) and amarelos.get(k, 0) % 3 == 0:
                motivo = f"{amarelos[k]}º cartão amarelo"
            if motivo:
                suspensos.append(dict(n=p.get("nome"), motivo=motivo))
            if p.get("titular") and not motivo:
                xi.append(dict(n=p.get("nome"), c=p.get("camisa"), p=p.get("pos"), id=p["id"]))
        fora = {x["n"] for x in suspensos}
        for p in jogs:
            if p.get("titular") and p.get("nome") in fora:
                # substituto: quem mais foi titular no mesmo setor, sem estar suspenso nem já escalado
                ja = {x["id"] for x in xi}
                cands = [(n, pid) for (c, pid), n in titularidades.items() if c == cid and pid not in ja and pid != p["id"]
                         and info[(c, pid)][0] not in fora and grupo(info[(c, pid)][2]) == grupo(p.get("pos"))]
                if cands:
                    _, pid = max(cands)
                    nome, camisa, pos = info[(cid, pid)]
                    xi.append(dict(n=nome, c=camisa, p=pos, id=pid, novo=True))
        xi.sort(key=lambda x: (grupo(x["p"]), x["n"] or ""))
        out[cid] = dict(titulares=[{k: v for k, v in x.items() if k != "id"} for x in xi], desfalques=suspensos, base=jg["id"])
    return out


def campeao_libertadores(token, lib):
    """Descobre no football-data (competição CLI) se o clube de data/vagas.json ganhou a final.
    Devolve True/False quando a final já acabou, ou None se ainda não deu para saber."""
    try:
        if datetime.now(timezone.utc).date().isoformat() < lib.get("data_final", "0000"):
            return None
        finais = baixar("/competitions/CLI/matches?stage=FINAL", token).get("matches", [])
        for j in finais:
            if j.get("status") != "FINISHED":
                continue
            w = j["score"].get("winner")
            venc = j["homeTeam"] if w == "HOME_TEAM" else j["awayTeam"] if w == "AWAY_TEAM" else None
            if venc is None:
                continue
            alvo = _sem_acento(lib["time"]).lower()
            return alvo in _sem_acento(venc.get("name") or "").lower() or alvo in _sem_acento(venc.get("shortName") or "").lower()
    except Exception as e:  # sem a final, segue com a probabilidade do arquivo
        print("Libertadores: não consegui ver a final:", e)
    return None


def regras_vagas(ids, idx, times, posicoes, token):
    """Quem vai para a Libertadores (fase de grupos / Pré) e para a Sul-Americana em cada simulação.

    Base 2026: 1º a 4º na fase de grupos, 5º e 6º na Pré, os 6 seguintes na Sul-Americana (G-6, porque o
    Palmeiras, já classificado pela tabela, é finalista da Copa do Brasil). Vagas extras de fase de grupos:
      - Palmeiras campeão da Libertadores (a vaga de campeão desce para a tabela);
      - Grêmio rebaixado (perde a vaga da Copa do Brasil, que desce para a tabela).
    Cada extra empurra a linha uma posição para baixo (G-7, G-8). Se o Grêmio não cair, ele já está na
    Libertadores e é pulado na contagem da Pré e da Sul-Americana."""
    cfg = json.loads(ARQ_VAGAS.read_text(encoding="utf-8")) if ARQ_VAGAS.exists() else {}
    base = {"grupos": 4, "pre": 2, "sul": 6, **cfg.get("base", {})}
    n_sim, n = posicoes.shape
    por_nome = {nome(times[t]["team"]): t for t in ids}
    extra = np.zeros(n_sim, int)

    lib = cfg.get("libertadores") or {}
    lib_res = lib.get("resultado")
    if lib and lib_res is None and token:
        lib_res = campeao_libertadores(token, lib)
        if lib_res is not None:  # grava para não perguntar de novo a cada rodada do robô
            cfg["libertadores"]["resultado"] = lib_res
            ARQ_VAGAS.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if lib:
        if lib_res is None:
            ganhou = np.random.default_rng(SEED + 1).random(n_sim) < float(lib.get("prob", 50)) / 100
        else:
            ganhou = np.full(n_sim, bool(lib_res))
        extra += ganhou

    cb = cfg.get("copa_do_brasil") or {}
    e = por_nome.get(cb.get("time"))
    if e is not None:
        ie = idx[e]
        caiu = posicoes[:, ie] >= 17
        extra += caiu
        na_lib = ~caiu
        adj = posicoes - ((posicoes > posicoes[:, [ie]]) & na_lib[:, None])
    else:
        ie, caiu, na_lib, adj = None, np.zeros(n_sim, bool), np.zeros(n_sim, bool), posicoes

    g = (base["grupos"] + extra)[:, None]
    grupos = adj <= g
    pre = (adj > g) & (adj <= g + base["pre"])
    sul = (adj > g + base["pre"]) & (adj <= g + base["pre"] + base["sul"])
    if ie is not None:
        grupos[:, ie] |= na_lib
        pre[:, ie] &= ~na_lib
        sul[:, ie] &= ~na_lib

    # linha da tabela de hoje (a final da Libertadores só conta depois de jogada)
    caiu_hoje = e is not None and times[e]["position"] >= 17
    g_hoje = base["grupos"] + (1 if lib_res else 0) + (1 if caiu_hoje else 0)
    total = base["grupos"] + base["pre"] + extra
    info = dict(
        grupos=g_hoje, pre=base["pre"], sul=base["sul"],
        g=g_hoje + base["pre"],
        excluido=None if (e is None or caiu_hoje) else e,
        copa=dict(time=e, descricao=cb.get("descricao"), rebaixado_hoje=bool(caiu_hoje),
                  chance_cair=round(float(caiu.mean()) * 100, 1)),
        libertadores=dict(time=por_nome.get(lib.get("time")), descricao=lib.get("descricao"),
                          data=lib.get("data_final"), resultado=lib_res,
                          prob=None if lib_res is not None else lib.get("prob", 50)) if lib else None,
        dist={f"G{k}": round(float(np.mean(total == k)) * 100, 1) for k in sorted(set(total.tolist()))},
    )
    return grupos, pre, sul, info


def montar_cenarios(ids, idx, times, restantes, proximo, resultados, posicoes, pts, direta=None, g_hoje=4, pular=None,
                    pre=None, g_pre=None):
    """Para cada clube que ainda briga pelo G4 ou contra o Z4: o que muda com o resultado do
    próximo jogo, para quem torcer (quem secar) e quantos pontos deixam a vaga praticamente certa.
    Tudo sai das mesmas simulações do fim do campeonato."""
    if not restantes:
        return []
    n_sim = posicoes.shape[0]
    tabela = sorted(ids, key=lambda t: times[t]["position"])
    pts_de = {t: times[t]["points"] for t in ids}
    faltam = {t: sum(1 for j in restantes if t in (j["homeTeam"]["id"], j["awayTeam"]["id"])) for t in ids}
    saida = []
    zonas = [("g4", 1, 4), ("z4", 17, 20)]
    if pre is not None and direta is not None and g_pre:
        zonas.insert(1, ("pre", 1, g_pre))
    for zona, lo, hi in zonas:
        sobe = zona != "z4"   # g4 e pré: quanto mais, melhor
        for t in ids:
            i = idx[t]
            if sobe and t == pular:
                continue  # o clube da Copa do Brasil não disputa a vaga pela tabela
            if zona == "pre":
                dentro = direta[:, i].astype(bool) | pre[:, i].astype(bool)
            elif zona == "g4" and direta is not None:
                dentro = direta[:, i]
            else:
                dentro = (posicoes[:, i] >= lo) & (posicoes[:, i] <= hi)
            chance = float(dentro.mean()) * 100
            if not (1 <= chance <= 99) or t not in proximo:
                continue
            pc = lambda m: round(float(dentro[m].mean()) * 100, 1) if m.sum() >= 30 else None
            jogo, adv, em_casa = proximo[t]
            res = resultados[jogo["id"]]
            vence, empata, perde = (res == (0 if em_casa else 2)), (res == 1), (res == (2 if em_casa else 0))
            prox = dict(jogo=jogo["id"], adversario=adv, em_casa=em_casa,
                        vence=pc(vence), empata=pc(empata), perde=pc(perde))
            # quem secar: jogos da mesma rodada (sem o clube) cujo resultado mais mexe na chance dele
            rodada = jogo["matchday"]
            torcidas = []
            for j in restantes:
                if j["matchday"] != rodada or t in (j["homeTeam"]["id"], j["awayTeam"]["id"]) or j["id"] not in resultados:
                    continue
                r = resultados[j["id"]]
                ch = [pc(r == k) for k in range(3)]
                if None in ch:
                    continue
                melhor = (max if sobe else min)(range(3), key=lambda k: ch[k])
                pior = (min if sobe else max)(range(3), key=lambda k: ch[k])
                impacto = abs(ch[melhor] - ch[pior])
                if impacto >= 1.5:
                    torcidas.append(dict(jogo=j["id"], torcer=["casa", "empate", "fora"][melhor],
                                         se_der=ch[melhor], se_nao=ch[pior], impacto=round(impacto, 1)))
            torcidas.sort(key=lambda x: -x["impacto"])
            # pontos que deixam a situação praticamente resolvida (95% das simulações)
            final = pts[:, i]
            meta = None
            # menor total final a partir do qual o clube fica na faixa (G4) ou fora dela (Z4)
            # em pelo menos 95% das simulações que terminam com aquele total
            base = int(pts_de[t])
            ok_por_p = {}
            for p in range(base, base + 3 * faltam[t] + 1):
                m = final == p
                if m.sum() >= 30:
                    ok_por_p[p] = float(dentro[m].mean()) if sobe else float((~dentro[m]).mean())
            for p in sorted(ok_por_p):
                if all(v >= 0.95 for q, v in ok_por_p.items() if q >= p):
                    if p > base:
                        meta = dict(pontos=p, faltam=p - base, jogos=faltam[t])
                    break
            # combinação que decide já nesta rodada (vencer/perder + o resultado de quem secar)
            decide = None
            if torcidas:
                alvo = torcidas[0]
                r = resultados[alvo["jogo"]]
                k = ["casa", "empate", "fora"].index(alvo["torcer"])
                if sobe:
                    m = vence & (r == k)
                    v = pc(m)
                    if v is not None and v >= 99.5:
                        decide = dict(tipo="garante", com="vence", jogo=alvo["jogo"], torcer=alvo["torcer"])
                else:
                    m = perde & (r != k)
                    v = pc(m)
                    if v is not None and v >= 99.5:
                        decide = dict(tipo="cai", com="perde", jogo=alvo["jogo"], torcer=alvo["torcer"])
            # distância para a linha (4º/5º ou 16º/17º)
            pos = times[t]["position"]
            if sobe:
                g = g_pre if zona == "pre" else g_hoje
                ref = tabela[g] if pos <= g else tabela[g - 1]
            else:
                ref = tabela[16] if pos <= 16 else tabela[15]
            saida.append(dict(time=t, zona=zona, chance=round(chance, 1), pos=pos, pts=pts_de[t], jogos=faltam[t],
                              linha=dict(time=ref, pos=times[ref]["position"], dif=pts_de[t] - pts_de[ref]),
                              proximo=prox, secar=torcidas[:3], meta=meta, decide=decide))
    saida.sort(key=lambda c: (c["zona"], c["pos"]))
    return saida


def nome(team):
    return NOMES.get(team["shortName"], team["shortName"])


def sigla(team):
    return SIGLAS.get(team["shortName"], team["tla"])


# ---------------------------------------------------------------- modelo

def forca_dos_times(times, jogos_encerrados):
    """Gols por jogo em casa e fora, e fase recente (últimos 5 e 10 jogos)."""
    s = {t: dict(hj=0, hgp=0, hgc=0, aj=0, agp=0, agc=0, hist=[]) for t in times}
    for j in sorted(jogos_encerrados, key=lambda x: x["utcDate"]):
        h, a = j["homeTeam"]["id"], j["awayTeam"]["id"]
        gh, ga = j["score"]["fullTime"]["home"], j["score"]["fullTime"]["away"]
        if h not in s or a not in s or gh is None:
            continue
        s[h]["hj"] += 1; s[h]["hgp"] += gh; s[h]["hgc"] += ga
        s[a]["aj"] += 1; s[a]["agp"] += ga; s[a]["agc"] += gh
        s[h]["hist"].append((gh, ga)); s[a]["hist"].append((ga, gh))

    tot_hj = sum(v["hj"] for v in s.values()) or 1
    tot_aj = sum(v["aj"] for v in s.values()) or 1
    liga_casa = max(sum(v["hgp"] for v in s.values()) / tot_hj, 0.5)
    liga_fora = max(sum(v["agp"] for v in s.values()) / tot_aj, 0.4)

    def media(gols, jogos, padrao):
        # encolhe para a média da liga quando há poucos jogos
        k = 3
        return (gols + padrao * k) / (jogos + k)

    for t, v in s.items():
        v["ataque_casa"] = media(v["hgp"], v["hj"], liga_casa) / liga_casa
        v["defesa_casa"] = media(v["hgc"], v["hj"], liga_fora) / liga_fora
        v["ataque_fora"] = media(v["agp"], v["aj"], liga_fora) / liga_fora
        v["defesa_fora"] = media(v["agc"], v["aj"], liga_casa) / liga_casa
        j = len(v["hist"])
        gp_temp = sum(x[0] for x in v["hist"]) / j if j else 1.2
        gc_temp = sum(x[1] for x in v["hist"]) / j if j else 1.2
        u5, u10 = v["hist"][-5:], v["hist"][-10:]
        if len(u5) >= 3:
            r_gp = 0.6 * sum(x[0] for x in u5) / len(u5) + 0.4 * sum(x[0] for x in u10) / len(u10)
            r_gc = 0.6 * sum(x[1] for x in u5) / len(u5) + 0.4 * sum(x[1] for x in u10) / len(u10)
            v["fase_ataque"] = 1 + 0.5 * ((r_gp + 0.3) / (gp_temp + 0.3) - 1)
            v["fase_defesa"] = 1 + 0.5 * ((r_gc + 0.3) / (gc_temp + 0.3) - 1)
        else:
            v["fase_ataque"] = v["fase_defesa"] = 1.0
        v["gols_por_jogo"] = gp_temp
    return s, liga_casa, liga_fora


def gols_esperados(s, liga_casa, liga_fora, h, a):
    H, A = s[h], s[a]
    lh = liga_casa * H["ataque_casa"] * A["defesa_fora"] * H["fase_ataque"] * A["fase_defesa"]
    la = liga_fora * A["ataque_fora"] * H["defesa_casa"] * A["fase_ataque"] * H["fase_defesa"]
    return max(lh, 0.15), max(la, 0.1)


def poisson(k, lam):
    return math.exp(-lam) * lam ** k / math.factorial(k)


def chances(lh, la):
    v = e = 0.0
    tabela = {}
    for i in range(10):
        for j in range(10):
            p = poisson(i, lh) * poisson(j, la)
            tabela[(i, j)] = p
            if i > j:
                v += p
            elif i == j:
                e += p
    d = max(0.0, 1 - v - e)
    fav = max((("v", v), ("e", e), ("d", d)), key=lambda x: x[1])[0]
    cand = [(k, p) for k, p in tabela.items()
            if (fav == "v" and k[0] > k[1]) or (fav == "e" and k[0] == k[1]) or (fav == "d" and k[0] < k[1])]
    placar = max(cand, key=lambda x: x[1])[0]
    return v, e, d, placar


# ---------------------------------------------------------------- principal

def main():
    token = os.environ.get("FOOTBALL_DATA_TOKEN", "").strip()
    if not token:
        sys.exit("Falta a chave: defina FOOTBALL_DATA_TOKEN.")

    tabela = baixar(f"/competitions/{COMP}/standings", token)
    jogos = baixar(f"/competitions/{COMP}/matches", token)["matches"]
    artilharia = baixar(f"/competitions/{COMP}/scorers?limit=100", token)["scorers"]

    temporada = tabela["season"]
    linhas = next(x for x in tabela["standings"] if x["type"] == "TOTAL")["table"]
    times = {r["team"]["id"]: r for r in linhas}
    ids = list(times)

    encerrados = [j for j in jogos if j["status"] == "FINISHED"]
    restantes = [j for j in jogos if j["status"] not in ("FINISHED", "CANCELLED", "AWARDED")
                 and j["homeTeam"]["id"] in times and j["awayTeam"]["id"] in times]

    s, liga_casa, liga_fora = forca_dos_times(ids, encerrados)

    # previsão de cada jogo que falta
    prev = {}
    for j in restantes:
        h, a = j["homeTeam"]["id"], j["awayTeam"]["id"]
        lh, la = gols_esperados(s, liga_casa, liga_fora, h, a)
        v, e, d, placar = chances(lh, la)
        prev[j["id"]] = dict(xg_casa=round(lh, 2), xg_fora=round(la, 2),
                             casa=round(v * 100, 1), empate=round(e * 100, 1), fora=round(d * 100, 1),
                             placar=f"{placar[0]} x {placar[1]}")

    # simulação do fim do campeonato
    rng = np.random.default_rng(SEED)
    idx = {t: i for i, t in enumerate(ids)}
    n = len(ids)
    pts0 = np.array([times[t]["points"] for t in ids], float)
    sg0 = np.array([times[t]["goalDifference"] for t in ids], float)
    vit0 = np.array([times[t]["won"] for t in ids], float)
    pts = np.repeat(pts0[None, :], N_SIM, 0)
    sg = np.repeat(sg0[None, :], N_SIM, 0)
    vit = np.repeat(vit0[None, :], N_SIM, 0)
    pontos_esperados = pts0.copy()
    resultados = {}  # resultado de cada jogo em cada simulação: 0 = mandante vence, 1 = empate, 2 = visitante vence
    for j in restantes:
        h, a = idx[j["homeTeam"]["id"]], idx[j["awayTeam"]["id"]]
        p = prev[j["id"]]
        gh = rng.poisson(p["xg_casa"], N_SIM)
        ga = rng.poisson(p["xg_fora"], N_SIM)
        pts[:, h] += np.where(gh > ga, 3, np.where(gh == ga, 1, 0))
        pts[:, a] += np.where(ga > gh, 3, np.where(gh == ga, 1, 0))
        vit[:, h] += gh > ga
        vit[:, a] += ga > gh
        resultados[j["id"]] = np.where(gh > ga, 0, np.where(gh == ga, 1, 2)).astype(np.int8)
        sg[:, h] += gh - ga
        sg[:, a] += ga - gh
        pontos_esperados[h] += (3 * p["casa"] + p["empate"]) / 100
        pontos_esperados[a] += (3 * p["fora"] + p["empate"]) / 100
    chave = pts * 1e6 + vit * 1e3 + sg + rng.random(pts.shape) * 1e-3
    ordem = np.argsort(-chave, axis=1)
    posicoes = np.empty_like(ordem)
    linhas_sim = np.arange(N_SIM)[:, None]
    posicoes[linhas_sim, ordem] = np.arange(1, n + 1)[None, :]

    v_grupos, v_pre, v_sul, vagas = regras_vagas(ids, idx, times, posicoes, token)

    # forma (últimos 5 resultados) de cada time
    forma = {t: [] for t in ids}
    for j in sorted(encerrados, key=lambda x: x["utcDate"]):
        h, a = j["homeTeam"]["id"], j["awayTeam"]["id"]
        w = j["score"]["winner"]
        if h in forma:
            forma[h].append("V" if w == "HOME_TEAM" else "E" if w == "DRAW" else "D")
        if a in forma:
            forma[a].append("V" if w == "AWAY_TEAM" else "E" if w == "DRAW" else "D")

    # próximo jogo de cada time
    proximo = {}
    for j in sorted(restantes, key=lambda x: x["utcDate"]):
        for lado, outro, casa in (("homeTeam", "awayTeam", True), ("awayTeam", "homeTeam", False)):
            t = j[lado]["id"]
            if t not in proximo:
                proximo[t] = (j, j[outro]["id"], casa)

    arq_tec = ROOT / "data" / "tecnicos.json"
    tecnicos = (json.loads(arq_tec.read_text(encoding="utf-8")) if arq_tec.exists() else {}).get("tecnicos", {})
    saida_times = []
    for t in ids:
        r = times[t]
        i = idx[t]
        col = posicoes[:, i]
        st = s[t]
        faixas = {k: round(float(np.mean((col >= lo) & (col <= hi))) * 100, 1) for k, lo, hi in FAIXAS}
        faixas.update(libertadores=round(float(v_grupos[:, i].mean()) * 100, 1),
                      pre_libertadores=round(float(v_pre[:, i].mean()) * 100, 1),
                      sulamericana=round(float(v_sul[:, i].mean()) * 100, 1))
        saida_times.append(dict(
            id=t, nome=nome(r["team"]), sigla=sigla(r["team"]), escudo=ESCUDOS.get(t, r["team"]["crest"]),
            pos=r["position"], pts=r["points"], j=r["playedGames"], v=r["won"], e=r["draw"], d=r["lost"],
            gp=r["goalsFor"], gc=r["goalsAgainst"], sg=r["goalDifference"],
            forma="".join(forma[t][-5:]),
            tecnico=tecnicos.get(str(t)),
            casa=dict(j=st["hj"], gp=st["hgp"], gc=st["hgc"]),
            fora=dict(j=st["aj"], gp=st["agp"], gc=st["agc"]),
            pts_projetados=round(float(pontos_esperados[i]), 1),
            pos_media=round(float(np.mean(col)), 1),
            dist_pos=[round(float(np.mean(col == k)) * 100, 2) for k in range(1, n + 1)],
            **faixas,
        ))
    saida_times.sort(key=lambda x: x["pos"])
    cenarios = montar_cenarios(ids, idx, times, restantes, proximo, resultados, posicoes, pts,
                               direta=v_grupos, g_hoje=vagas["grupos"], pular=vagas["copa"]["time"],
                               pre=v_pre, g_pre=vagas["grupos"] + vagas["pre"])

    # canais de transmissão (preenchidos em data/transmissoes.json)
    arq_canais = ROOT / "data" / "transmissoes.json"
    canais = json.loads(arq_canais.read_text(encoding="utf-8")) if arq_canais.exists() else {}
    arq_lives = ROOT / "data" / "lives.json"
    lives = (json.loads(arq_lives.read_text(encoding="utf-8")) if arq_lives.exists() else {}).get("jogos", {})
    arq_videos = ROOT / "data" / "videos.json"
    _v = json.loads(arq_videos.read_text(encoding="utf-8")) if arq_videos.exists() else {}
    videos, videos_gols = _v.get("jogos", {}), _v.get("gols", {})
    arq_est = ROOT / "data" / "estatisticas.json"
    espn = json.loads(arq_est.read_text(encoding="utf-8")).get("jogos", {}) if arq_est.exists() else {}

    saida_jogos = []
    for j in sorted(jogos, key=lambda x: (x["matchday"] or 0, x["utcDate"])):
        h, a = j["homeTeam"]["id"], j["awayTeam"]["id"]
        if h not in times or a not in times:
            continue
        ft = j["score"]["fullTime"]
        status, gc, gf = j["status"], ft["home"], ft["away"]
        e = espn.get(str(j["id"])) or {}
        extra = {}
        # a ESPN costuma estar à frente da fonte grátis durante o jogo: usa o placar e o relógio dela
        if status != "FINISHED" and e.get("estado") in ("in", "post") and e.get("placar"):
            gc, gf = e["placar"]["casa"], e["placar"]["fora"]
            if e.get("estado") == "in":
                status = "PAUSED" if e.get("intervalo") else "IN_PLAY"
                if e.get("ancora") and not e.get("intervalo"):
                    extra["periodo"], extra["ancora"] = e.get("periodo"), e["ancora"]
            else:
                status = "FINISHED"  # acabou na ESPN: some o "ao vivo" na hora (a fonte grátis confirma depois)
        saida_jogos.append(dict(
            id=j["id"], rodada=j["matchday"], data=j["utcDate"], status=status,
            casa=h, fora=a, gols_casa=gc, gols_fora=gf, **extra,
            previsao=prev.get(j["id"]),
            canais=(canais.get(str(j["id"])) or {}).get("canais"),
            lives=lives.get(str(j["id"])) or None,
            arbitro=next((r.get("name") for r in (j.get("referees") or []) if r.get("type") == "REFEREE" and r.get("name")), None)
                    or e.get("arbitro") or None,
            video=(videos.get(str(j["id"])) or {}).get("id"),
            gols_video=[{k: v for k, v in dict(id=g["id"], lado=g.get("lado"), minuto=g.get("minuto"), jogador=g.get("jogador")).items() if v}
                        for g in videos_gols.get(str(j["id"]), [])] or None,
        ))

    # artilheiros e garçons, com chance de gol/assistência no próximo jogo
    saida_jogadores = []
    for sc in artilharia:
        t = sc["team"]["id"]
        if t not in times:
            continue
        jogos_j = sc.get("playedMatches") or times[t]["playedGames"] or 1
        gols = sc.get("goals") or 0
        assist = sc.get("assists") or 0
        item = dict(nome=sc["player"]["name"], time=t, jogos=jogos_j, gols=gols, assistencias=assist,
                    penaltis=sc.get("penalties") or 0, prox=None)
        if t in proximo:
            jogo, adv, em_casa = proximo[t]
            p = prev[jogo["id"]]
            xg_time = p["xg_casa"] if em_casa else p["xg_fora"]
            media_time = max(s[t]["gols_por_jogo"], 0.3)
            fator = xg_time / media_time
            lam_g = gols / jogos_j * fator
            lam_a = assist / jogos_j * fator
            item["prox"] = dict(jogo=jogo["id"], adversario=adv, em_casa=em_casa,
                                gol=round((1 - math.exp(-lam_g)) * 100, 1),
                                assistencia=round((1 - math.exp(-lam_a)) * 100, 1))
        saida_jogadores.append(item)

    unificar_arbitros(saida_jogos)
    est_clubes = estatisticas_dos_clubes(saida_jogos, espn)
    try:
        prov = provaveis_escalacoes(saida_jogos)
        arq_ge = ROOT / "data" / "provaveis_ge.json"
        prov_ge = (json.loads(arq_ge.read_text(encoding="utf-8")) if arq_ge.exists() else {}).get("jogos", {})
        arq_jog = ROOT / "data" / "jogadores.json"
        elencos = {}
        for x in (json.loads(arq_jog.read_text(encoding="utf-8")) if arq_jog.exists() else {}).get("jogadores", []):
            elencos.setdefault(x["clube"], []).append(x)
        proximo_de = {}
        for jg in sorted((x for x in saida_jogos if x["status"] != "FINISHED"), key=lambda x: x["data"]):
            for lado in ("casa", "fora"):
                proximo_de.setdefault(jg[lado], jg["id"])
        for jg in saida_jogos:
            if jg["status"] == "FINISHED":
                continue
            p = {lado: prov[jg[lado]] for lado in ("casa", "fora") if proximo_de.get(jg[lado]) == jg["id"] and jg[lado] in prov}
            # provável publicada pelo ge tem preferência sobre a calculada
            ge = (prov_ge.get(str(jg["id"])) or {})
            for lado in ("casa", "fora"):
                g = ge.get(lado)
                if g and g.get("titulares"):
                    p[lado] = dict(titulares=_titulares_ge(g["titulares"], jg[lado], elencos), desfalques=[{"n": n} for n in g.get("desfalques") or []],
                                   pendurados=g.get("pendurados") or [], fonte="ge", url=g.get("url"))
            if p:
                jg["provavel"] = p
    except Exception as ex:
        print(f"Prováveis escalações: erro ({ex.__class__.__name__}: {ex})")
    try:
        montar_jogadores(saida_jogos)
    except Exception as ex:  # a aba Jogadores nunca derruba o resto
        print(f"Jogadores: erro ({ex.__class__.__name__}: {ex})")
    for tt in saida_times:
        tt["estat"] = est_clubes.get(tt["id"])

    # arbitragem: números de cada árbitro e de cada clube com cada árbitro (cartões, pênaltis e VAR vêm da ESPN)
    arb, var_clube = {}, {}
    jogos_com_espn = 0

    def novo_reg():
        return dict(jogos=0, com_dados=0, v=0, e=0, d=0, gols_pro=0, gols_contra=0, amarelos=0, vermelhos=0,
                    amarelos_adv=0, vermelhos_adv=0, pen_favor=0, pen_contra=0, faltas=0, var_favor=0, var_contra=0)

    # só entram rodadas encerradas: a aba muda ao fim de cada rodada (jogos adiados para
    # mais de 7 dias depois da data típica da rodada não seguram a rodada aberta)
    por_rodada = {}
    for jg in saida_jogos:
        por_rodada.setdefault(jg["rodada"], []).append(jg)
    rodadas_fechadas = set()
    for r, js in por_rodada.items():
        datas = sorted(datetime.fromisoformat(x["data"].replace("Z", "+00:00")) for x in js)
        tipica = datas[len(datas) // 2]
        if all(x["status"] == "FINISHED" or datetime.fromisoformat(x["data"].replace("Z", "+00:00")) > tipica + timedelta(days=7) for x in js):
            rodadas_fechadas.add(r)
    ultima_fechada = max((r for r in rodadas_fechadas if all((r2 in rodadas_fechadas) for r2 in range(1, r + 1))), default=0)
    for jg in saida_jogos:
        if jg["status"] != "FINISHED" or jg["rodada"] not in rodadas_fechadas:
            continue
        e = espn.get(str(jg["id"])) or {}
        tem = bool(e.get("casa") or e.get("fora") or e.get("lances"))
        jogos_com_espn += tem
        # VAR de cada lado: a favor = decisão que beneficiou o time; contra = que o prejudicou
        vf, vc = {"casa": 0, "fora": 0}, {"casa": 0, "fora": 0}
        for x in e.get("var") or []:
            ld = x.get("lado")
            if ld not in ("casa", "fora"):
                continue
            outro = "fora" if ld == "casa" else "casa"
            if x["decisao"] in ("penalti_marcado", "gol_validado", "vermelho_anulado"):
                vf[ld] += 1; vc[outro] += 1
            elif x["decisao"] in ("penalti_anulado", "gol_anulado", "vermelho"):
                vc[ld] += 1; vf[outro] += 1
        for ld in ("casa", "fora"):
            cid = jg[ld]
            vcb = var_clube.setdefault(cid, dict(favor=0, contra=0, lances=[]))
            vcb["favor"] += vf[ld]; vcb["contra"] += vc[ld]
        for x in e.get("var") or []:
            if x.get("lado") in ("casa", "fora") and x["decisao"] not in ("outro", "confirmado"):
                var_clube[jg[x["lado"]]]["lances"].append(dict(jogo=jg["id"], decisao=x["decisao"], minuto=x.get("minuto")))
        if not jg.get("arbitro"):
            continue
        a = arb.setdefault(jg["arbitro"], dict(nome=jg["arbitro"], **novo_reg(), mandante=[0, 0, 0], ultimos=[], clubes={}))
        res = 0 if jg["gols_casa"] > jg["gols_fora"] else 1 if jg["gols_casa"] == jg["gols_fora"] else 2
        a["jogos"] += 1
        a["mandante"][res] += 1
        a["gols_pro"] += jg["gols_casa"] + jg["gols_fora"]
        a["ultimos"].append(jg["id"])
        pen = {"casa": 0, "fora": 0}
        for l in e.get("lances") or []:
            if l.get("tipo") == "gol" and l.get("penalti") and l.get("lado") in pen:
                pen[l["lado"]] += 1
        for ld, n in (e.get("penaltis_perdidos") or {}).items():
            if ld in pen:
                pen[ld] += n
        if tem:
            a["com_dados"] += 1
            a["var_chamadas"] = a.get("var_chamadas", 0) + len(e.get("var") or [])  # vezes que o VAR chamou o árbitro
        for ld in ("casa", "fora"):
            outro = "fora" if ld == "casa" else "casa"
            st, so = e.get(ld) or {}, e.get(outro) or {}
            c = a["clubes"].setdefault(str(jg[ld]), novo_reg())
            c["jogos"] += 1
            gp, gc = (jg["gols_casa"], jg["gols_fora"]) if ld == "casa" else (jg["gols_fora"], jg["gols_casa"])
            c["gols_pro"] += gp; c["gols_contra"] += gc
            c["v" if gp > gc else "e" if gp == gc else "d"] += 1
            if tem:
                c["com_dados"] += 1
                for k_, src, chave in (("amarelos", st, "amarelos"), ("vermelhos", st, "vermelhos"),
                                       ("amarelos_adv", so, "amarelos"), ("vermelhos_adv", so, "vermelhos")):
                    c[k_] += int(src.get(chave) or 0)
                c["faltas"] += int(st.get("faltas") or 0)
                c["pen_favor"] += pen[ld]; c["pen_contra"] += pen[outro]
                c["var_favor"] += vf[ld]; c["var_contra"] += vc[ld]
                a["amarelos"] += int(st.get("amarelos") or 0)
                a["vermelhos"] += int(st.get("vermelhos") or 0)
                a["faltas"] += int(st.get("faltas") or 0)
                a["pen_favor"] += pen[ld]
                a["var_favor"] += vf[ld]
    arbitros = sorted(arb.values(), key=lambda a: (-a["jogos"], a["nome"]))
    for a in arbitros:
        a["penaltis"] = a.pop("pen_favor")
        a.pop("var_favor", None)
        a["var_chamadas"] = a.get("var_chamadas", 0)
        a["var"] = a["var_chamadas"]  # compatibilidade com quem ainda está com a versão anterior do site aberta
        for k_ in ("v", "e", "d", "gols_contra", "amarelos_adv", "vermelhos_adv", "pen_contra", "var_contra"):
            a.pop(k_, None)
        a["ultimos"] = a["ultimos"][-5:]
    arbitragem = dict(arbitros=arbitros, var=var_clube, jogos_com_espn=jogos_com_espn, ate_rodada=ultima_fechada,
                      jogos_encerrados=sum(1 for jg in saida_jogos if jg["status"] == "FINISHED" and jg["rodada"] in rodadas_fechadas))

    agora = datetime.now(timezone.utc).isoformat(timespec="seconds")
    site = dict(
        temporada=dict(inicio=temporada["startDate"], fim=temporada["endDate"],
                       rodada_atual=temporada.get("currentMatchday")),
        simulacoes=N_SIM, times=saida_times, jogos=saida_jogos, jogadores=saida_jogadores,
        arbitragem=arbitragem, cenarios=cenarios, vagas=vagas,
    )

    # só grava (e muda a data) se algum número mudou
    if OUT.exists():
        antigo = json.loads(OUT.read_text(encoding="utf-8"))
        antigo_sem_data = {k: v for k, v in antigo.items() if k != "atualizado"}
        if antigo_sem_data == json.loads(json.dumps(site)):
            print("Nada mudou.")
            return
    site["atualizado"] = agora
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(site, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Dados atualizados: {len(saida_times)} clubes, {len(saida_jogos)} jogos, {len(saida_jogadores)} jogadores.")


if __name__ == "__main__":
    main()
