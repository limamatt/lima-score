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
MAX_ENCERRADOS_POR_VEZ = 8      # com jogo rolando
MAX_ENCERRADOS_SEM_JOGO = 40    # sem jogo, completa a temporada mais rápido
VERSAO = 2                      # sobe quando passamos a ler algo novo (relê os jogos antigos)
MAX_TENTATIVAS = 4

# nome na ESPN -> chave no site
ESTAT = {
    "possessionPct": "posse", "totalShots": "finalizacoes", "shotsOnTarget": "no_alvo",
    "wonCorners": "escanteios", "foulsCommitted": "faltas", "yellowCards": "amarelos",
    "redCards": "vermelhos", "offsides": "impedimentos", "saves": "defesas",
    "totalPasses": "passes", "passPct": "precisao_passes",
}


def baixar(caminho):
    req = urllib.request.Request(API + caminho, headers={"User-Agent": "Mozilla/5.0 limascore"})
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


def arbitro(resumo):
    """Nome do árbitro principal (a ESPN lista a equipe de arbitragem em gameInfo.officials)."""
    ofs = ((resumo.get("gameInfo") or {}).get("officials")) or []
    for o in ofs:
        pos = norm(str(((o.get("position") or {}).get("displayName")) or ((o.get("position") or {}).get("name")) or ""))
        if "REFEREE" in pos and "ASSIST" not in pos and "VIDEO" not in pos and "FOURTH" not in pos:
            return o.get("displayName") or o.get("fullName")
    o = ofs[0] if ofs else {}
    return o.get("displayName") or o.get("fullName") or None


def lances_var(comp, resumo, lado_por_espn, tipos_vistos):
    """Decisões do VAR que a ESPN registra (gol anulado, pênalti marcado/anulado, expulsão após revisão).
    'lado' é o time a quem o lance se refere (quem fez o gol anulado, quem sofreu/cometeu etc.)."""
    brutos = list(resumo.get("keyEvents") or []) + list(comp.get("details") or [])
    out, vistos = [], set()
    for ev in brutos:
        tipo = ((ev.get("type") or {}).get("text") or "").strip()
        tipos_vistos.add(tipo)
        txt = (tipo + " " + ((ev.get("type") or {}).get("type") or "") + " " + (ev.get("text") or "")).lower()
        if not re.search(r"\bvar\b|video assistant|review|disallow|overturn|chalked off|ruled out", txt):
            continue
        lado = lado_por_espn.get(str((ev.get("team") or {}).get("id")))
        minuto = ((ev.get("clock") or {}).get("displayValue") or "").strip() or None
        if "penalty" in txt and re.search(r"cancel|overturn|no penalty|not given|rescind", txt):
            dec = "penalti_anulado"      # pênalti para o time 'lado' que o VAR tirou
        elif "penalty" in txt:
            dec = "penalti_marcado"      # pênalti para o time 'lado' após revisão
        elif re.search(r"goal|disallow|chalked off|ruled out", txt) and re.search(r"disallow|cancel|overturn|no goal|chalked off|ruled out|offside", txt):
            dec = "gol_anulado"          # gol do time 'lado' anulado
        elif "red" in txt:
            dec = "vermelho"             # expulsão de jogador do time 'lado' após revisão
        else:
            dec = "outro"
        chave = (dec, lado, minuto)
        if chave in vistos:
            continue
        vistos.add(chave)
        out.append(dict(decisao=dec, lado=lado, minuto=minuto, texto=(ev.get("text") or tipo)[:160]))
    return out


def penaltis_perdidos(comp, resumo, lado_por_espn):
    """Pênaltis desperdiçados (perdidos ou defendidos) por lado, fora da disputa de pênaltis."""
    brutos = comp.get("details") or resumo.get("keyEvents") or []
    out = {}
    for ev in brutos:
        txt = ((ev.get("type") or {}).get("text") or "").lower() + " " + ((ev.get("type") or {}).get("type") or "").lower()
        lado = lado_por_espn.get(str((ev.get("team") or {}).get("id")))
        if lado and not ev.get("shootout") and "penalty" in txt and any(x in txt for x in ("miss", "saved")):
            out[lado] = out.get(lado, 0) + 1
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
        if tipo == "gol" and len(atletas) > 1 and not (ev.get("ownGoal") or "own goal" in tipo_txt):
            assist = atletas[1].get("displayName")
            if assist and assist != jogador:
                item["assistencia"] = assist
        if tipo == "gol":
            if ev.get("penaltyKick") or "penalty" in tipo_txt:
                item["penalti"] = True
            if ev.get("ownGoal") or "own goal" in tipo_txt or "own-goal" in tipo_txt:
                item["contra"] = True
        lances.append(item)
    lances.sort(key=lambda x: minuto_num(x["minuto"]))
    return lances


POSICOES = [("goalkeeper", "Goleiro"), ("center left", "Zagueiro"), ("center right", "Zagueiro"), ("attacking midfielder", "Meia"), ("defensive midfielder", "Volante"),
             ("midfielder", "Meio-campista"), ("center back", "Zagueiro"), ("centre back", "Zagueiro"),
             ("left back", "Lateral-esquerdo"), ("right back", "Lateral-direito"), ("wing back", "Ala"),
             ("defender", "Defensor"), ("winger", "Ponta"), ("left forward", "Ponta"), ("right forward", "Ponta"),
             ("forward", "Atacante"), ("striker", "Atacante")]


def traduz_posicao(txt):
    t = (txt or "").lower().replace("-", " ")
    for en, pt in POSICOES:
        if en in t:
            return pt
    return {"G": "Goleiro", "D": "Defensor", "M": "Meio-campista", "F": "Atacante"}.get((txt or "").upper(), txt)


def destaque_do_jogo(resumo, lado_por_espn):
    """Destaque pelos números da ESPN: gols, assistências, finalizações, defesas.
    Não é o "melhor em campo" oficial; é quem mais pesou nas estatísticas."""
    pesos = {"totalGoals": 10, "goalAssists": 6, "shotsOnTarget": 1.5, "totalShots": 0.5,
             "saves": 1.5, "foulsSuffered": 0.3, "ownGoals": -6, "redCards": -6, "yellowCards": -1}
    melhor = None
    for r in resumo.get("rosters") or []:
        lado = lado_por_espn.get(str((r.get("team") or {}).get("id")))
        if not lado:
            continue
        for p in r.get("roster") or []:
            stats = {s.get("name"): numero(s.get("value", s.get("displayValue"))) or 0 for s in (p.get("stats") or [])}
            nota = sum(stats.get(k, 0) * w for k, w in pesos.items())
            if nota <= 0:
                continue
            nome = (p.get("athlete") or {}).get("displayName")
            if not nome:
                continue
            motivo = []
            for k, rot in (("totalGoals", "gol"), ("goalAssists", "assistência"), ("saves", "defesa"), ("shotsOnTarget", "chute no gol")):
                v = int(stats.get(k, 0))
                if v:
                    plural = {"gol": "gols", "assistência": "assistências", "defesa": "defesas", "chute no gol": "chutes no gol"}[rot]
                    motivo.append(f"{v} {rot if v == 1 else plural}")
            if melhor is None or nota > melhor["nota"]:
                melhor = dict(nome=nome, lado=lado, nota=round(nota, 1), motivo=", ".join(motivo[:3]),
                              posicao=traduz_posicao((p.get("position") or {}).get("displayName") or (p.get("position") or {}).get("abbreviation")))
    return melhor


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
        elif j["status"] == "FINISHED" and (not guardado.get("final") or guardado.get("v") != VERSAO) and guardado.get("tentativas", 0) < MAX_TENTATIVAS:
            encerrados.append(j)
    encerrados.sort(key=lambda j: j["data"], reverse=True)  # os mais recentes primeiro
    alvo = ao_vivo + encerrados[:MAX_ENCERRADOS_POR_VEZ if ao_vivo else MAX_ENCERRADOS_SEM_JOGO]
    if not alvo:
        print("Estatísticas: nada para buscar.")
        return

    # acha o jogo correspondente na ESPN (pelo par de clubes e pela data)
    # a ESPN recusa intervalos longos de datas: busca em janelas curtas (dia do jogo ± 1)
    janelas = sorted({((inicio(j) - timedelta(days=1)).strftime("%Y%m%d"), (inicio(j) + timedelta(days=1)).strftime("%Y%m%d"))
                      for j in alvo})
    todos, vistos, erros, ok = [], set(), [], []

    def juntar(caminho):
        try:
            evs = baixar(caminho).get("events", [])
        except Exception as e:
            corpo = ""
            try:
                corpo = e.read().decode("utf-8", "ignore")[:160]
            except Exception:
                pass
            erros.append(f"{caminho}: {e.__class__.__name__} {e} {corpo}"[:300])
            return False
        ok.append(f"{caminho}: {len(evs)}")
        for ev in evs:
            if ev.get("id") not in vistos:
                vistos.add(ev.get("id"))
                todos.append(ev)
        return True

    dias_lidos = set()
    juntar("/scoreboard")  # jogos de hoje (sem parâmetros: o formato mais simples)
    for a, b in janelas:
        # a ESPN só aceita um dia por vez (intervalos dão erro 400)
        d0 = datetime.strptime(a, "%Y%m%d")
        for k in range(3):
            dia = f"{(d0 + timedelta(days=k)):%Y%m%d}"
            if dia not in dias_lidos:
                dias_lidos.add(dia)
                juntar(f"/scoreboard?dates={dia}")
    placar = {"events": todos}
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

    diag = dict(hora=agora.isoformat(timespec="seconds"), eventos_espn=len(placar.get("events", [])),
                reconhecidos=len(eventos), alvo=len(alvo), janelas=len(janelas), erros=erros[:6], ok=ok[:6], sem_par=[])
    tipos_vistos = set(dados.get("tipos_espn") or [])
    lidos = 0
    for j in alvo:
        chave = str(j["id"])
        guardado = jogos_dados.get(chave) or {}
        cands = [e for e in eventos if {e["casa"][0], e["fora"][0]} == {j["casa"], j["fora"]}
                 and abs(e["data"] - inicio(j)) <= timedelta(hours=36)]
        if not cands:
            diag["sem_par"].append(chave)
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
        novo["estado"] = estado
        novo["v"] = VERSAO
        arb = arbitro(resumo)
        if arb:
            novo["arbitro"] = arb
        var = lances_var(comp, resumo, lado_por_espn, tipos_vistos)
        if var:
            novo["var"] = var
        pp = penaltis_perdidos(comp, resumo, lado_por_espn)
        if pp:
            novo["penaltis_perdidos"] = pp
        if estado in ("in", "post"):
            placar_espn = {}
            for c in comp.get("competitors", []):
                ld = lado_por_espn.get(str((c.get("team") or {}).get("id") or c.get("id")))
                if ld and c.get("score") not in (None, ""):
                    try:
                        placar_espn[ld] = int(float(c.get("score")))
                    except (TypeError, ValueError):
                        pass
            if len(placar_espn) == 2:
                novo["placar"] = placar_espn
        if estado == "in":
            nome_status = ((status.get("type") or {}).get("name") or "").upper()
            detalhe = ((status.get("type") or {}).get("shortDetail") or "").upper()
            novo["intervalo"] = "HALFTIME" in nome_status or detalhe in ("HT", "INTERVALO", "HALFTIME")
            # em vez de gravar o relógio (que muda todo minuto), grava a hora em que o tempo
            # atual começou; o site calcula o minuto sozinho a partir dela
            periodo = int(status.get("period") or 0)
            nums = [int(x) for x in re.findall(r"\d+", status.get("displayClock") or "")]
            if periodo in (1, 2) and nums and not novo["intervalo"]:
                base = 0 if periodo == 1 else 45
                decorrido = min(max(nums[0] - base, 0), 45)  # acréscimos não mexem na âncora
                estimada = agora - timedelta(minutes=decorrido)
                ant = guardado.get("ancora")
                if guardado.get("periodo") == periodo and ant and abs(datetime.fromisoformat(ant) - estimada) < timedelta(minutes=3):
                    novo["ancora"] = ant
                else:
                    novo["ancora"] = estimada.isoformat(timespec="seconds")
                novo["periodo"] = periodo
        if estado in ("in", "post"):
            try:
                d = destaque_do_jogo(resumo, lado_por_espn)
                if d:
                    novo["destaque"] = d
            except Exception:
                pass
        if not est["casa"] and not est["fora"] and not lances:
            novo["final"] = False
            novo["tentativas"] = guardado.get("tentativas", 0) + (1 if j["status"] == "FINISHED" else 0)
        jogos_dados[chave] = novo
        lidos += 1

    if json.dumps(jogos_dados, sort_keys=True) != antes or not OUT.exists() or "erro" in dados or not jogos_dados:
        OUT.write_text(json.dumps(dict(fonte="ESPN", diag=diag, tipos_espn=sorted(tipos_vistos)[:300], jogos=jogos_dados), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"Estatísticas: {lidos} jogos lidos ({len(ao_vivo)} ao vivo).")
    else:
        print("Estatísticas: nada mudou.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # nunca derruba o robô principal
        print(f"Erro nas estatísticas: {e.__class__.__name__}: {e}")
        try:
            if not OUT.exists():
                OUT.write_text(json.dumps(dict(fonte="ESPN", erro=f"{e.__class__.__name__}: {e}"[:300], jogos={})), encoding="utf-8")
        except Exception:
            pass
