"""
Termômetro do Brasileirão — robô das estatísticas.

Busca na ESPN (gratuita, sem chave) as estatísticas de cada jogo — posse de bola,
finalizações, chutes no alvo, escanteios, faltas, cartões, impedimentos e defesas —
e os lances (gols com minuto e autor, cartões). Grava em data/estatisticas.json.

Os lances de gol também servem ao robô dos vídeos: um vídeo só vira "gol" no site
se houver um gol de verdade daquele time no placar.

Jogos ao vivo são atualizados a cada volta. Jogos encerrados são lidos uma vez
(os da temporada que ainda não têm dados entram aos poucos, até 40 por vez).
Se a ESPN falhar, o robô só avisa e segue: nada no site quebra.
"""
import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from videos import NOMES, norm  # noqa: E402  (mesma lista de nomes dos clubes)

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "data" / "site.json"
OUT = ROOT / "data" / "estatisticas.json"
API = "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1"
MAX_ENCERRADOS_POR_VEZ = 40
MAX_TENTATIVAS = 4

# nome na ESPN -> chave no site
ESTAT = {
    "possessionPct": "posse", "totalShots": "finalizacoes", "shotsOnTarget": "no_alvo",
    "wonCorners": "escanteios", "foulsCommitted": "faltas", "yellowCards": "amarelos",
    "redCards": "vermelhos", "offsides": "impedimentos", "saves": "defesas",
    "totalPasses": "passes", "passPct": "precisao_passes",
}


def baixar(caminho):
    req = urllib.request.Request(API + caminho, headers={"User-Agent": "Mozilla/5.0 termometro-brasileirao"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)


def clube_por_nome(nome):
    n = norm(nome or "")
    melhor, tam = None, 0
    for cid, nomes in NOMES.items():
        for x in nomes:
            if re.search(r"(?<![A-Z])" + re.escape(x) + r"(?![A-Z])", n) and len(x) > tam:
                melhor, tam = cid, len(x)
    return melhor


def numero(v):
    try:
        return float(str(v).replace("%", "").replace(",", "."))
    except (TypeError, ValueError):
        return None


def ler_estatisticas(times_box):
    out = {}
    for t in times_box:
        d = {}
        for s in t.get("statistics") or []:
            k = ESTAT.get(s.get("name"))
            v = numero(s.get("displayValue", s.get("value")))
            if k and v is not None:
                if k == "precisao_passes" and v <= 1:
                    v *= 100
                d[k] = round(v, 1) if k in ("posse", "precisao_passes") else int(round(v))
        out[str((t.get("team") or {}).get("id"))] = d
    return out


def ler_lances(comp, resumo, lado_por_espn):
    brutos = comp.get("details") or []
    fonte = "details"
    if not brutos:
        brutos = resumo.get("keyEvents") or []
        fonte = "keyEvents"
    lances = []
    for ev in brutos:
        tipo_txt = ((ev.get("type") or {}).get("text") or "").lower() + " " + ((ev.get("type") or {}).get("type") or "").lower()
        lado = lado_por_espn.get(str((ev.get("team") or {}).get("id")))
        if not lado:
            continue
        if ev.get("shootout"):
            continue
        nao_valeu = any(x in tipo_txt for x in ("disallow", "miss", "saved", "attempt", "cancel"))
        if (ev.get("scoringPlay") or ("goal" in tipo_txt and fonte == "keyEvents")) and not nao_valeu:
            tipo = "gol"
        elif ev.get("redCard") or "red card" in tipo_txt or "red-card" in tipo_txt:
            tipo = "vermelho"
        elif ev.get("yellowCard") or "yellow" in tipo_txt:
            tipo = "amarelo"
        else:
            continue
        atletas = ev.get("athletesInvolved") or [p.get("athlete") or {} for p in (ev.get("participants") or [])]
        jogador = (atletas[0].get("displayName") if atletas else None) or None
        item = dict(tipo=tipo, lado=lado, minuto=((ev.get("clock") or {}).get("displayValue") or "").strip() or None, jogador=jogador)
        if tipo == "gol":
            if ev.get("penaltyKick") or "penalty" in tipo_txt:
                item["penalti"] = True
            if ev.get("ownGoal") or "own goal" in tipo_txt or "own-goal" in tipo_txt:
                item["contra"] = True
        lances.append(item)
    lances.sort(key=lambda x: minuto_num(x["minuto"]))
    return lances


def minuto_num(txt):
    """'45'+2'' -> 47.0 (só para ordenar)."""
    nums = [int(x) for x in re.findall(r"\d+", txt or "")]
    if not nums:
        return 999
    return nums[0] + (nums[1] / 100 if len(nums) > 1 else 0)


def main():
    site = json.loads(SITE.read_text(encoding="utf-8"))
    dados = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    jogos_dados = dados.get("jogos", {})
    antes = json.dumps(jogos_dados, sort_keys=True)
    agora = datetime.now(timezone.utc)

    def inicio(j):
        return datetime.fromisoformat(j["data"].replace("Z", "+00:00"))

    # quais jogos precisam ser lidos agora
    ao_vivo, encerrados = [], []
    for j in site["jogos"]:
        guardado = jogos_dados.get(str(j["id"])) or {}
        if j["status"] in ("IN_PLAY", "PAUSED") or (j["status"] not in ("FINISHED",) and inicio(j) <= agora <= inicio(j) + timedelta(hours=3)):
            ao_vivo.append(j)
        elif j["status"] == "FINISHED" and not guardado.get("final") and guardado.get("tentativas", 0) < MAX_TENTATIVAS:
            encerrados.append(j)
    encerrados.sort(key=lambda j: j["data"], reverse=True)  # os mais recentes primeiro
    alvo = ao_vivo + encerrados[:MAX_ENCERRADOS_POR_VEZ]
    if not alvo:
        print("Estatísticas: nada para buscar.")
        return

    # acha o jogo correspondente na ESPN (pelo par de clubes e pela data)
    ini = min(inicio(j) for j in alvo) - timedelta(days=1)
    fim = max(inicio(j) for j in alvo) + timedelta(days=1)
    placar = baixar(f"/scoreboard?dates={ini:%Y%m%d}-{fim:%Y%m%d}&limit=1000")
    eventos = []
    for ev in placar.get("events", []):
        comp = (ev.get("competitions") or [{}])[0]
        ids = {}
        for c in comp.get("competitors", []):
            cid = clube_por_nome((c.get("team") or {}).get("displayName") or (c.get("team") or {}).get("name"))
            if cid:
                ids[c.get("homeAway")] = (cid, str(c.get("id") or (c.get("team") or {}).get("id")))
        if "home" in ids and "away" in ids:
            eventos.append(dict(id=ev["id"], data=datetime.fromisoformat(ev["date"].replace("Z", "+00:00")),
                                casa=ids["home"], fora=ids["away"]))

    lidos = 0
    for j in alvo:
        chave = str(j["id"])
        guardado = jogos_dados.get(chave) or {}
        cands = [e for e in eventos if {e["casa"][0], e["fora"][0]} == {j["casa"], j["fora"]}
                 and abs(e["data"] - inicio(j)) <= timedelta(hours=36)]
        if not cands:
            if j["status"] == "FINISHED":
                guardado["tentativas"] = guardado.get("tentativas", 0) + 1
                jogos_dados[chave] = guardado
            continue
        ev = min(cands, key=lambda e: abs(e["data"] - inicio(j)))
        try:
            resumo = baixar(f"/summary?event={ev['id']}")
        except Exception as e:
            print(f"Jogo {chave}: ESPN não respondeu ({e.__class__.__name__})")
            continue
        comp = ((resumo.get("header") or {}).get("competitions") or [{}])[0]
        # lado de cada time da ESPN no nosso jogo (a ESPN pode inverter mando em casos raros)
        lado_por_espn = {}
        for c in comp.get("competitors", []):
            cid = clube_por_nome((c.get("team") or {}).get("displayName"))
            tid = str((c.get("team") or {}).get("id") or c.get("id"))
            if cid == j["casa"]:
                lado_por_espn[tid] = "casa"
            elif cid == j["fora"]:
                lado_por_espn[tid] = "fora"
        if len(lado_por_espn) < 2:
            continue
        por_time = ler_estatisticas((resumo.get("boxscore") or {}).get("teams") or [])
        est = {"casa": {}, "fora": {}}
        for tid, lado in lado_por_espn.items():
            est[lado] = por_time.get(tid, {})
        lances = ler_lances(comp, resumo, lado_por_espn)
        # cartões pelos lances quando a estatística não vier
        for lado in ("casa", "fora"):
            for tipo, k in (("amarelo", "amarelos"), ("vermelho", "vermelhos")):
                if k not in est[lado] and est[lado]:
                    est[lado][k] = sum(1 for x in lances if x["tipo"] == tipo and x["lado"] == lado)
        status = (comp.get("status") or {})
        estado = (status.get("type") or {}).get("state")
        novo = dict(espn=ev["id"], casa=est["casa"], fora=est["fora"], lances=lances,
                    final=bool(j["status"] == "FINISHED" and estado == "post"))
        if estado == "in":
            novo["relogio"] = status.get("displayClock") or (status.get("type") or {}).get("shortDetail")
        if not est["casa"] and not est["fora"] and not lances:
            novo["final"] = False
            novo["tentativas"] = guardado.get("tentativas", 0) + (1 if j["status"] == "FINISHED" else 0)
        jogos_dados[chave] = novo
        lidos += 1

    if json.dumps(jogos_dados, sort_keys=True) != antes:
        OUT.write_text(json.dumps(dict(fonte="ESPN", jogos=jogos_dados), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"Estatísticas: {lidos} jogos lidos ({len(ao_vivo)} ao vivo).")
    else:
        print("Estatísticas: nada mudou.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # nunca derruba o robô principal
        print(f"Erro nas estatísticas: {e.__class__.__name__}: {e}")
