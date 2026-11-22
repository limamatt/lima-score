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

# Faixas da tabela (2026). As vagas extras dependem dos campeões das copas.
FAIXAS = [
    ("titulo", 1, 1),
    ("libertadores", 1, 4),
    ("pre_libertadores", 5, 6),
    ("sulamericana", 7, 12),
    ("rebaixamento", 17, 20),
]


def baixar(caminho, token):
    req = urllib.request.Request(API + caminho, headers={"X-Auth-Token": token})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


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
    for j in restantes:
        h, a = idx[j["homeTeam"]["id"]], idx[j["awayTeam"]["id"]]
        p = prev[j["id"]]
        gh = rng.poisson(p["xg_casa"], N_SIM)
        ga = rng.poisson(p["xg_fora"], N_SIM)
        pts[:, h] += np.where(gh > ga, 3, np.where(gh == ga, 1, 0))
        pts[:, a] += np.where(ga > gh, 3, np.where(gh == ga, 1, 0))
        vit[:, h] += gh > ga
        vit[:, a] += ga > gh
        sg[:, h] += gh - ga
        sg[:, a] += ga - gh
        pontos_esperados[h] += (3 * p["casa"] + p["empate"]) / 100
        pontos_esperados[a] += (3 * p["fora"] + p["empate"]) / 100
    chave = pts * 1e6 + vit * 1e3 + sg + rng.random(pts.shape) * 1e-3
    ordem = np.argsort(-chave, axis=1)
    posicoes = np.empty_like(ordem)
    linhas_sim = np.arange(N_SIM)[:, None]
    posicoes[linhas_sim, ordem] = np.arange(1, n + 1)[None, :]

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

    saida_times = []
    for t in ids:
        r = times[t]
        i = idx[t]
        col = posicoes[:, i]
        st = s[t]
        faixas = {k: round(float(np.mean((col >= lo) & (col <= hi))) * 100, 1) for k, lo, hi in FAIXAS}
        saida_times.append(dict(
            id=t, nome=nome(r["team"]), sigla=sigla(r["team"]), escudo=ESCUDOS.get(t, r["team"]["crest"]),
            pos=r["position"], pts=r["points"], j=r["playedGames"], v=r["won"], e=r["draw"], d=r["lost"],
            gp=r["goalsFor"], gc=r["goalsAgainst"], sg=r["goalDifference"],
            forma="".join(forma[t][-5:]),
            casa=dict(j=st["hj"], gp=st["hgp"], gc=st["hgc"]),
            fora=dict(j=st["aj"], gp=st["agp"], gc=st["agc"]),
            pts_projetados=round(float(pontos_esperados[i]), 1),
            pos_media=round(float(np.mean(col)), 1),
            dist_pos=[round(float(np.mean(col == k)) * 100, 2) for k in range(1, n + 1)],
            **faixas,
        ))
    saida_times.sort(key=lambda x: x["pos"])

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
            if x["decisao"] == "penalti_marcado":
                vf[ld] += 1; vc[outro] += 1
            elif x["decisao"] in ("penalti_anulado", "gol_anulado", "vermelho"):
                vc[ld] += 1; vf[outro] += 1
        for ld in ("casa", "fora"):
            cid = jg[ld]
            vcb = var_clube.setdefault(cid, dict(favor=0, contra=0, lances=[]))
            vcb["favor"] += vf[ld]; vcb["contra"] += vc[ld]
        for x in e.get("var") or []:
            if x.get("lado") in ("casa", "fora") and x["decisao"] != "outro":
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
            a["var_chamadas"] = a.get("var_chamadas", 0)
        a["var"] = a["var_chamadas"]  # compatibilidade com quem ainda está com a versão anterior do site aberta + len(e.get("var") or [])  # vezes que o VAR chamou o árbitro
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
        arbitragem=arbitragem,
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
