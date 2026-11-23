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
ESC = ROOT / "data" / "escalacoes.json"  # quem jogou e os números de cada jogador, por jogo
API = "https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1"
MAX_ENCERRADOS_POR_VEZ = 8      # com jogo rolando
MAX_ENCERRADOS_SEM_JOGO = 400   # sem jogo, completa a temporada mais rápido
VERSAO = 11                      # sobe quando passamos a ler algo novo (relê os jogos antigos)
MAX_TENTATIVAS = 4

# nome na ESPN -> chave no site
ESTAT = {
    "possessionPct": "posse", "totalShots": "finalizacoes", "shotsOnTarget": "no_alvo",
    "wonCorners": "escanteios", "foulsCommitted": "faltas", "yellowCards": "amarelos",
    "redCards": "vermelhos", "offsides": "impedimentos", "saves": "defesas",
    "totalPasses": "passes", "passPct": "precisao_passes",
    "accuratePasses": "passes_certos", "totalCrosses": "cruzamentos", "accurateCrosses": "cruzamentos_certos",
    "totalLongBalls": "bolas_longas", "accurateLongBalls": "bolas_longas_certas", "blockedShots": "chutes_bloqueados",
    "totalTackles": "desarmes", "effectiveTackles": "desarmes_certos", "interceptions": "interceptacoes",
    "totalClearance": "cortes", "effectiveClearance": "cortes_certos",
    "penaltyKickGoals": "penaltis_gols", "penaltyKickShots": "penaltis",
}
FATOR_XG = 0.89  # calibra o xG estimado (a soma da temporada bate com os gols)
NOMES_ESTAT_VISTOS = set()


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
            NOMES_ESTAT_VISTOS.add(str(s.get("name")))
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


def lado_do_texto(texto, lado_por_clube):
    """Acha o time citado no texto da revisão: '(Coritiba)', 'Penalty Remo', 'No Penalty RB Bragantino'."""
    cands = re.findall(r"\(([^()]+)\)", texto)
    m = re.search(r"(?:no )?penalty\s+([^.]+)\.?$", texto, re.I)
    if m:
        cands.insert(0, m.group(1))
    for c in cands:
        cid = clube_por_nome(c)
        if cid in lado_por_clube:
            return lado_por_clube[cid]
    return None


def lances_var(comp, resumo, lado_por_espn, tipos_vistos, amostras=None, lado_por_clube=None):
    """Revisões do VAR. A ESPN não tem um tipo próprio para o VAR: a revisão aparece no texto
    do lance ("Goal awarded following VAR Review", "VAR Decision: No Goal" etc.), tanto nos
    lances principais quanto na narração (commentary). 'lado' é o time a quem o lance se refere."""
    brutos = list(resumo.get("keyEvents") or []) + list(comp.get("details") or []) + list(resumo.get("commentary") or [])
    out, vistos = [], set()
    for ev in brutos:
        play = ev.get("play") or {}
        tipo = ((ev.get("type") or play.get("type") or {}).get("text") or "").strip()
        tipos_vistos.add(tipo)
        texto = (ev.get("text") or play.get("text") or "").strip()
        t = (tipo + " " + texto).lower()
        if not re.search(r"\bvar\b|video assistant", t):
            continue
        if amostras is not None and len(amostras) < 40 and texto not in amostras:
            amostras.append(texto[:220])
        time_ev = ev.get("team") or play.get("team") or {}
        lado = lado_por_espn.get(str(time_ev.get("id")))
        if not lado and lado_por_clube:
            lado = lado_do_texto(texto, lado_por_clube)
        relogio = ev.get("clock") or play.get("clock") or ev.get("time") or {}
        minuto = (relogio.get("displayValue") or "").strip() or None
        if re.search(r"no penalty|penalty (cancel|overturn|not given|rescinded)", t):
            dec = "penalti_anulado"       # pênalti que o time 'lado' tinha ganho e o VAR tirou
        elif re.search(r"penalty awarded|var decision: penalty|penalty given", t):
            dec = "penalti_marcado"       # pênalti a favor do time 'lado'
        elif re.search(r"no red card|red card (cancel|overturn|rescinded)|card downgraded", t):
            dec = "vermelho_anulado"      # expulsão de jogador do 'lado' desfeita pelo VAR
        elif re.search(r"card upgraded", t):
            dec = "vermelho"              # amarelo virou vermelho para jogador do 'lado'
        elif re.search(r"no goal|goal (disallowed|cancelled|ruled out|overturned)|overturned by var|disallowed|ruled out", t):
            dec = "gol_anulado"
        elif re.search(r"goal awarded", t):
            dec = "gol_validado"          # gol que tinha sido anulado e o VAR deu
        elif re.search(r"var decision: goal", t):
            dec = "confirmado"
        elif re.search(r"red card|sent off", t) and re.search(r"following|after|var decision", t):
            dec = "vermelho"
        elif re.search(r"confirmed|stands|upheld|no change", t):
            dec = "confirmado"            # revisou e manteve a decisão de campo
        else:
            dec = "outro"
        chave = (dec, minuto)
        if chave in vistos:
            # mesma revisão na narração e nos lances: fica a versão que sabe o time
            if lado:
                for x in out:
                    if (x["decisao"], x["minuto"]) == chave and not x["lado"]:
                        x["lado"] = lado
            continue
        vistos.add(chave)
        out.append(dict(decisao=dec, lado=lado, minuto=minuto, texto=texto[:160]))
    # várias linhas sobre a mesma revisão (atraso, decisão, lance) viram uma só:
    # junta o que estiver a até 2 minutos e fica a decisão mais específica
    prio = {"outro": 0, "confirmado": 1}
    out.sort(key=lambda x: minuto_num(x["minuto"]))
    revisoes = []
    for x in out:
        ult = revisoes[-1] if revisoes else None
        if ult and abs(minuto_num(x["minuto"]) - minuto_num(ult["minuto"])) <= 2:
            if prio.get(x["decisao"], 2) > prio.get(ult["decisao"], 2) or (x["lado"] and not ult["lado"] and x["decisao"] == ult["decisao"]):
                lado = x["lado"] or ult["lado"]
                ult.update(x)
                ult["lado"] = lado
            elif not ult["lado"] and x["lado"]:
                ult["lado"] = x["lado"]
            continue
        revisoes.append(dict(x))
    return revisoes


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


def traduz_posicao(txt):
    """Posição da ESPN em português. 'Substitute' (reserva que entrou) não é posição: volta None."""
    t = (txt or "").lower().replace("-", " ").strip()
    if not t or t in ("sub", "substitute") or "substitut" in t:
        return None
    if "goalkeeper" in t or t == "g" or t == "gk":
        return "Goleiro"
    if "wing back" in t:
        return "Ala"
    if "midfielder" in t:
        if "defensive" in t:
            return "Volante"
        if "attacking" in t or (("left" in t or "right" in t) and "center" not in t and "centre" not in t):
            return "Meia"
        return "Meio-campista"
    if "back" in t or "defender" in t:
        if "left" in t and "center" not in t and "centre" not in t:
            return "Lateral-esquerdo"
        if "right" in t and "center" not in t and "centre" not in t:
            return "Lateral-direito"
        return "Zagueiro"
    if "winger" in t or (("left" in t or "right" in t) and "forward" in t):
        return "Ponta"
    if "forward" in t or "striker" in t:
        return "Atacante"
    return {"d": "Defensor", "m": "Meio-campista", "f": "Atacante"}.get(t, txt)


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


def _norm_nome(n):
    import unicodedata
    n = unicodedata.normalize("NFKD", n or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z ]", "", n).strip()


def minutos_em_campo(resumo):
    """Minuto de entrada e saída de cada jogador, pelas substituições e expulsões da narração.
    Devolve {nome normalizado: (entrou_aos, saiu_aos)} só para quem entrou ou saiu."""
    entrou, saiu = {}, {}
    vistos = set()
    lesionados = set()
    pares = {}  # quem saiu (normalizado) -> nome de quem entrou
    for ev in list(resumo.get("commentary") or []) + list(resumo.get("keyEvents") or []):
        play = ev.get("play") or {}
        tipo = ((ev.get("type") or play.get("type") or {}).get("text") or "").lower()
        texto = (ev.get("text") or play.get("text") or "")
        rel = ev.get("clock") or play.get("clock") or ev.get("time") or {}
        nums = [int(x) for x in re.findall(r"\d+", rel.get("displayValue") or "")]
        if not nums:
            continue
        minuto = min(nums[0], 90)
        if "substitution" in tipo or "replaces" in texto:
            m = re.search(r"\.\s*([^.]+?) replaces ([^.]+?)(?: because of an injury)?\.?$", texto) or re.search(r"([^.,]+?) replaces ([^.]+?)\.", texto)
            if m:
                a, b = _norm_nome(m.group(1)), _norm_nome(m.group(2))
                if "injury" in texto.lower():
                    lesionados.add(b)
                pares.setdefault(b, m.group(1).strip())
                if (a, b) not in vistos:
                    vistos.add((a, b))
                    entrou[a] = minuto
                    saiu[b] = minuto
        elif "retired" in tipo or "went off injured" in texto.lower():
            m = re.match(r"\s*(.+?) went off injured", texto)
            if m:
                lesionados.add(_norm_nome(m.group(1)))
                saiu.setdefault(_norm_nome(m.group(1)), minuto)
        elif "red card" in tipo or "second yellow" in texto.lower() or "red card" in texto.lower():
            m = re.match(r"\s*([^(]+?) \(", texto)
            if m:
                saiu.setdefault(_norm_nome(m.group(1)), minuto)
    minutos_em_campo.lesionados = lesionados
    minutos_em_campo.pares = pares
    return entrou, saiu


# xG estimado pela descrição do chute na narração (zona, cabeça, pênalti, falta, contra-ataque).
# Valores médios de referência para cada tipo de chute; é uma estimativa do Lima Score, não o xG da Opta.
def xg_estimado(texto):
    t = texto.lower()
    if "penalty" in t and ("converts" in t or "penalty missed" in t or "penalty saved" in t):
        return 0.76, "penalti"
    if "from a free kick" in t or "direct free kick" in t:
        return 0.06, "falta"
    cab = "header" in t
    if "very close range" in t or "six yard box" in t:
        base, zona = (0.30 if cab else 0.42), "pequena_area"
    elif "centre of the box" in t:
        base, zona = (0.11 if cab else 0.16), "area"
    elif "side of the box" in t or "difficult angle" in t:
        base, zona = (0.05 if cab else (0.04 if "difficult angle" in t else 0.07)), "area"
    elif "outside the box" in t or "long range" in t or "more than" in t:
        base, zona = 0.03, "fora"
    else:
        base, zona = 0.08, "area"
    if "fast break" in t:
        base *= 1.35
    elif "through ball" in t:
        base *= 1.3
    if "cross" in t and not cab:
        base *= 0.9
    return round(min(base, 0.85), 3), zona


def chutes_e_acoes(resumo, lado_por_espn):
    """Pela narração: cada finalização (quem chutou, quem deu o passe, de onde, resultado, xG
    estimado, posição no campo) e ações de cada jogador (faltas sofridas/cometidas, pênaltis)."""
    chutes, acoes = [], {}
    def soma(nome, k):
        if nome:
            d = acoes.setdefault(nome, {})
            d[k] = d.get(k, 0) + 1
    for ev in resumo.get("commentary") or []:
        play = ev.get("play") or {}
        if not play:
            continue
        tipo = ((play.get("type") or {}).get("text") or "").lower()
        texto = ev.get("text") or play.get("text") or ""
        t = texto.lower()
        parts = [((pp.get("athlete") or {}).get("displayName")) for pp in (play.get("participants") or [])]
        lado = lado_por_espn.get(str((play.get("team") or {}).get("id")))
        eh_chute = (t.startswith("attempt ") or t.startswith("goal!") or "hits the" in t and ("post" in t or "bar" in t)
                    or t.startswith("penalty missed") or t.startswith("penalty saved"))
        if eh_chute and parts and parts[0] and "own goal" not in t:
            if t.startswith("goal!"):
                res = "gol"
            elif "saved" in t:
                res = "defendido"
            elif "blocked" in t:
                res = "bloqueado"
            elif "hits the" in t:
                res = "trave"
            else:
                res = "fora"
            xg, zona = xg_estimado(texto)
            m = re.search(r"assisted by ([^.]+?)(?: with| following|\.|$)", texto, re.I)
            rel = play.get("clock") or ev.get("time") or {}
            tp = None
            if m:
                tl = texto[m.start():].lower()
                tp = ("escanteio" if "corner" in tl else "bola_parada" if "set piece" in tl or "free kick" in tl
                      else "cruzamento" if "cross" in tl else "enfiada" if "through ball" in tl
                      else "cabeceio" if "headed pass" in tl else "contra_ataque" if "fast break" in tl else "passe")
            gk = None
            mg = re.search(r"saved .*? by ([^(]+?) \(", texto)
            if mg:
                gk = mg.group(1).strip()
            chutes.append(dict(tp=tp, gk=gk, j=parts[0], a=(parts[1] if len(parts) > 1 and m else None), lado=lado, res=res, xg=xg, zona=zona,
                               cab="header" in t, x=play.get("fieldPositionX"), y=play.get("fieldPositionY"),
                               min=(rel.get("displayValue") or "").strip() or None))
            continue
        if "wins a free kick" in t and parts:
            soma(parts[-1], "faltas_sofridas")
        elif t.startswith("foul by") and parts:
            soma(parts[0], "faltas_cometidas")
        elif t.startswith("penalty conceded by") and parts:
            soma(parts[0], "penaltis_cometidos")
        elif ("penalty" in t and "wins" in t) or "fouled in the penalty area" in t:
            if parts:
                soma(parts[0], "penaltis_sofridos")
        elif "is caught offside" in t:
            m = re.search(r"\.\s*([^.]+?) is caught offside", texto)
            if m:
                soma(m.group(1).strip(), "impedimentos")
    return chutes, acoes


def escalacao_oficial(resumo, lado_por_espn):
    """Titulares, reservas e esquema tático de cada lado (a ESPN publica cerca de 1h antes do jogo),
    com quem entrou, quem saiu (e o minuto) e quem saiu machucado."""
    out = {}
    entrou, saiu = minutos_em_campo(resumo)
    lesionados = getattr(minutos_em_campo, "lesionados", set())
    pares = getattr(minutos_em_campo, "pares", {})
    for r in resumo.get("rosters") or []:
        lado = lado_por_espn.get(str((r.get("team") or {}).get("id")))
        if not lado:
            continue
        tit, res = [], []
        for p in r.get("roster") or []:
            a = p.get("athlete") or {}
            pos = p.get("position") or {}
            item = dict(n=a.get("displayName") or a.get("shortName"), c=p.get("jersey"),
                        p=traduz_posicao(pos.get("displayName") or pos.get("abbreviation")))
            nn = _norm_nome(item["n"])
            if nn in saiu:
                item["sai"] = saiu[nn]
            if nn in entrou:
                item["ent"] = entrou[nn]
            if nn in lesionados:
                item["les"] = True
            if nn in pares:
                item["por"] = pares[nn]
            (tit if p.get("starter") else res).append(item)
        if len(tit) >= 11:
            out[lado] = dict(formacao=r.get("formation") or r.get("formationName"), titulares=tit, reservas=res)
    return out if len(out) == 2 else None


def resumo_finalizacoes(chutes, est):
    """Por time: xG estimado, grandes chances, onde e como terminaram as finalizações,
    e 'gols evitados' do goleiro (xG dos chutes no gol que ele enfrentou menos os gols sofridos)."""
    out = {}
    for lado in ("casa", "fora"):
        meus = [c for c in chutes if c.get("lado") == lado]
        outro = "fora" if lado == "casa" else "casa"
        contra = [c for c in chutes if c.get("lado") == outro]
        xg = sum(c["xg"] for c in meus) * FATOR_XG
        no_alvo_contra = [c for c in contra if c["res"] in ("gol", "defendido")]
        out[lado] = dict(
            xg=round(xg, 2),
            grandes=sum(1 for c in meus if c["xg"] >= 0.3 and c["zona"] != "penalti"),
            grandes_gol=sum(1 for c in meus if c["xg"] >= 0.3 and c["zona"] != "penalti" and c["res"] == "gol"),
            dentro=sum(1 for c in meus if c["zona"] in ("pequena_area", "area", "penalti")),
            fora_area=sum(1 for c in meus if c["zona"] in ("fora", "falta")),
            trave=sum(1 for c in meus if c["res"] == "trave"),
            para_fora=sum(1 for c in meus if c["res"] == "fora"),
            bloqueados=sum(1 for c in meus if c["res"] == "bloqueado"),
            cabeca=sum(1 for c in meus if c.get("cab")),
            xg_alvo_contra=round(sum(c["xg"] for c in no_alvo_contra) * FATOR_XG, 2),
            gols_contra_chute=sum(1 for c in contra if c["res"] == "gol"),
        )
        out[lado]["gols_evitados"] = round(out[lado]["xg_alvo_contra"] - out[lado]["gols_contra_chute"], 2)
    return out


def jogadores_do_jogo(resumo, lado_por_espn):
    """Quem entrou em campo em cada lado e os números de cada um nesse jogo."""
    out = {"casa": [], "fora": []}
    entrou_aos, saiu_aos = minutos_em_campo(resumo)
    for r in resumo.get("rosters") or []:
        lado = lado_por_espn.get(str((r.get("team") or {}).get("id")))
        if not lado:
            continue
        for p in r.get("roster") or []:
            a = p.get("athlete") or {}
            if not a.get("id"):
                continue
            stats = {}
            for st in p.get("stats") or []:
                v = numero(st.get("value", st.get("displayValue")))
                if v:
                    stats[st.get("name")] = v
            titular = bool(p.get("starter"))
            entrou = bool(p.get("subbedIn")) and not titular
            if not (titular or entrou or stats.get("appearances")):
                continue  # ficou no banco
            pos = (p.get("position") or {})
            nn = _norm_nome(a.get("displayName"))
            ini = 0 if titular else entrou_aos.get(nn)
            fim = saiu_aos.get(nn, 90)
            minutos = max(1, fim - ini) if ini is not None and fim >= ini else None
            out[lado].append(dict(minutos=minutos,id=str(a["id"]), nome=a.get("displayName") or a.get("shortName"),
                                  pos=traduz_posicao(pos.get("displayName") or pos.get("abbreviation")),
                                  pos_espn=pos.get("displayName") or pos.get("abbreviation"),
                                  camisa=p.get("jersey"), titular=titular, entrou=entrou, saiu=bool(p.get("subbedOut")), stats=stats))
    return out


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
        if j["status"] in ("IN_PLAY", "PAUSED") or (j["status"] not in ("FINISHED",) and inicio(j) - timedelta(minutes=75) <= agora <= inicio(j) + timedelta(hours=3)):
            # desde 1h15 antes do início: pega a escalação oficial assim que for divulgada
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
    escalacoes = json.loads(ESC.read_text(encoding="utf-8")) if ESC.exists() else {}
    esc_antes = json.dumps(escalacoes, sort_keys=True)
    tipos_vistos = set(dados.get("tipos_espn") or [])
    amostras_tipos = dict(dados.get("amostras_tipos") or {})
    amostras_var = list(dados.get("amostras_var") or [])
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
        try:
            esc = escalacao_oficial(resumo, lado_por_espn)
            if esc:
                novo["escalacao"] = esc
        except Exception:
            pass
        try:
            jj = jogadores_do_jogo(resumo, lado_por_espn)
            try:
                jj["chutes"], jj["acoes"] = chutes_e_acoes(resumo, lado_por_espn)
                # a narração nem sempre traz o time do lance: descobre o lado pelo elenco do jogo
                lado_nome = {}
                for ld in ("casa", "fora"):
                    for pj in jj.get(ld) or []:
                        nm = pj.get("n") or pj.get("nome")
                        if nm:
                            lado_nome[_norm_nome(nm)] = ld
                for c in jj["chutes"]:
                    if not c.get("lado"):
                        c["lado"] = lado_nome.get(_norm_nome(c["j"]))
                novo["fin"] = resumo_finalizacoes(jj["chutes"], est)
            except Exception:
                pass
            if jj["casa"] or jj["fora"]:
                escalacoes[chave] = jj
        except Exception:
            pass
        arb = arbitro(resumo)
        if arb:
            novo["arbitro"] = arb
        var = lances_var(comp, resumo, lado_por_espn, tipos_vistos, amostras_var, {j["casa"]: "casa", j["fora"]: "fora"})
        for ev in (resumo.get("commentary") or [])[:400]:
            play = ev.get("play") or {}
            tp = ((ev.get("type") or play.get("type") or {}).get("text") or "")
            lst = amostras_tipos.setdefault(tp, [])
            if len(lst) < 2:
                lst.append(dict(texto=(ev.get("text") or play.get("text") or "")[:200], chaves=sorted(ev.keys())[:15],
                                play=sorted(play.keys())[:15],
                                participantes=[{k: (v if not isinstance(v, dict) else {kk: vv for kk, vv in v.items() if kk in ("id", "displayName")})
                                                for k, v in pp.items() if k in ("athlete", "type", "order")} for pp in (play.get("participants") or ev.get("participants") or [])[:3]]))
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

    if json.dumps(escalacoes, sort_keys=True) != esc_antes or (escalacoes and not ESC.exists()):
        ESC.write_text(json.dumps(escalacoes, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if json.dumps(jogos_dados, sort_keys=True) != antes or not OUT.exists() or "erro" in dados or not jogos_dados:
        OUT.write_text(json.dumps(dict(fonte="ESPN", diag=diag, tipos_espn=sorted(tipos_vistos)[:300], nomes_estat=sorted(NOMES_ESTAT_VISTOS), amostras_var=amostras_var[:40], amostras_tipos=amostras_tipos, jogos=jogos_dados), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
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
