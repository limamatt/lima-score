"""
Termômetro do Brasileirão — robô dos melhores momentos.

Lê os vídeos publicados no YouTube pelos canais do ge, encontra os de
"MELHORES MOMENTOS" do Brasileirão e liga cada vídeo ao jogo certo
(pela rodada e pelos dois times). Grava em data/videos.json.

Precisa da chave YOUTUBE_API_KEY (YouTube Data API v3, gratuita).
Na primeira vez percorre a temporada inteira; depois só olha os vídeos novos.
"""
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "data" / "site.json"
OUT = ROOT / "data" / "videos.json"
API = "https://www.googleapis.com/youtube/v3"
# ordem de preferência: 1º ge tv, 2º CazéTV, 3º PernaPlays (só entra se as outras não tiverem o vídeo)
# ordem de preferência geral: 1º ge tv, 2º CazéTV / Prime Video, 3º PernaPlays.
# Mas, em cada jogo, quem tem o direito de transmissão vem antes de todos (ver prioridade()).
PRIME = ["primevideobr"]
CANAIS = ["getv", "geglobo", "CazeTV"] + PRIME + ["PernaPlays"]
PRIORIDADE = {"getv": 1, "geglobo": 1, "CazeTV": 2, "PernaPlays": 3}
PRIORIDADE.update({h: 2 for h in PRIME})
# regra 2: vídeo de quem transmitiu. Na primeira volta com a regra nova, relê a temporada desses canais.
REGRA = 2
RELER = ["CazeTV"] + PRIME


def prioridade(handle, jogo):
    """Prioridade do canal para os melhores momentos deste jogo (menor = preferido).
    Quem tem o direito de transmissão vem antes do ge: jogo da CazéTV -> vídeo da CazéTV;
    jogo exclusivo do Prime Video -> vídeo do Prime Video. Sem vídeo deles, fica o do ge."""
    lista = [norm(c) for c in ((jogo or {}).get("canais") or [])]
    canais = " ".join(lista)
    if handle == "CazeTV" and "CAZE" in canais:
        return 0
    # jogo exclusivo do Prime Video: o vídeo do próprio Prime vem primeiro
    if handle in PRIME and lista and all("PRIME" in c for c in lista):
        return 0
    return PRIORIDADE.get(handle, 9)
MAX_PAGINAS = 500

# como cada clube aparece nos títulos do ge (sem acento, maiúsculas)
NOMES = {
    1783: ["FLAMENGO"], 1769: ["PALMEIRAS"], 1771: ["CRUZEIRO"], 1765: ["FLUMINENSE"],
    1768: ["ATHLETICO-PR", "ATHLETICO PARANAENSE", "ATHLETICO"], 1777: ["BAHIA"],
    1766: ["ATLETICO-MG", "ATLETICO MINEIRO", "ATLETICO MG"], 6685: ["SANTOS"],
    4286: ["RED BULL BRAGANTINO", "BRAGANTINO"], 1780: ["VASCO DA GAMA", "VASCO"],
    1776: ["SAO PAULO"], 1770: ["BOTAFOGO"], 4241: ["CORITIBA"], 1782: ["VITORIA"],
    4364: ["MIRASSOL"], 1779: ["CORINTHIANS"], 6684: ["INTERNACIONAL", "INTER"],
    1767: ["GREMIO"], 4287: ["REMO", "CLUBE DO REMO"], 1772: ["CHAPECOENSE", "CHAPE"],
}


def norm(txt):
    txt = unicodedata.normalize("NFKD", txt).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", txt.upper())


def api(caminho, **params):
    params["key"] = CHAVE
    url = f"{API}/{caminho}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def playlist_de_envios(handle):
    d = api("channels", part="contentDetails", forHandle=handle)
    itens = d.get("items") or []
    return itens[0]["contentDetails"]["relatedPlaylists"]["uploads"] if itens else None


def times_no_titulo(titulo_norm):
    """Devolve os ids dos clubes citados antes do primeiro '|' do título."""
    parte = titulo_norm.split("|")[0]
    achados = []
    for cid, nomes in NOMES.items():
        for n in sorted(nomes, key=len, reverse=True):
            m = re.search(r"(?<![A-Z])" + re.escape(n) + r"(?![A-Z])", parte)
            if m:
                achados.append((m.start(), cid))
                break
    achados.sort()
    return [c for _, c in achados]


# títulos que falam de gol mas não são um gol que valeu (ou repetem um gol já publicado)
NAO_E_GOL = re.compile(
    r"QUASE|ANULAD|\bANULA|NAO VALEU|INVALIDAD|DEFENDE|DEFESA|DEFESACA|EVITA|SALVA |PERIGO|"
    r"OUTRO ANGULO|OUTROS ANGULOS|NOVO ANGULO|REPLAY|DE NOVO|REVEJA|COMEMORA|APELO|AUTOR DO GOL|ABRACA|"
    r"PERDE |PERDEU|DESPERDICA|TRAVE|TRAVESSAO|NA TRAVE|CHORA|PROVOCA|ENTREVISTA|BASTIDOR|TORCIDA FAZ")


def eh_video_de_gol(t):
    """Títulos de vídeo de um gol só (não melhores momentos, nem jogo completo, nem 'quase gol')."""
    if "MELHORES MOMENTOS" in t or "JOGO COMPLETO" in t or "COLETIVA" in t or "PRE-JOGO" in t:
        return False
    if NAO_E_GOL.search(t):
        return False
    return bool(re.match(r"^\W*(E )?(GOL|GOLACO|GOOO+L)", t)) or " GOL D" in t[:60] or "GOLACO" in t[:40]


def lado_do_gol(t, jogo):
    """Qual time marcou, pelo título: 'GOL DO X' -> X; '... CONTRA O X' / 'SOBRE O X' -> o outro."""
    parte = t.split("|")[0]
    lados = {jogo["casa"]: "casa", jogo["fora"]: "fora"}
    outro = {"casa": "fora", "fora": "casa"}
    citados = [c for c in times_no_titulo(t) if c in lados]
    if not citados:
        return None
    # 'GOL DO VITORIA - RENE (INTERNACIONAL 0X1 VITORIA)': quem vem logo depois de "GOL DO" marcou
    if "GOL CONTRA" not in parte:
        for c in citados:
            if any(re.search(r"GOL(ACO)?\s+D[OAE]S?\s+" + re.escape(n) + r"(?![A-Z])(?!\s*\d+\s*X)", parte) for n in NOMES[c]):
                return lados[c]

    def posicoes(c):
        return [m.start() for n in NOMES[c] for m in re.finditer(r"(?<![A-Z])" + re.escape(n) + r"(?![A-Z])", parte)]
    # placar no título: 'O GOL DE VASCO 0 X 1 BAHIA' (vale o time escrito antes e o escrito depois do placar)
    m = re.search(r"(\d+)\s*X\s*(\d+)", parte)
    if m and len(citados) == 2:
        a, b = int(m.group(1)), int(m.group(2))
        antes = max(citados, key=lambda c: max([p for p in posicoes(c) if p < m.start()] or [-1]))
        depois = citados[0] if antes == citados[1] else citados[1]
        if (a > 0) != (b > 0) and any(p < m.start() for p in posicoes(antes)):
            return lados[antes if a > 0 else depois]
    lado = None
    for c in citados:
        for n in NOMES[c]:
            if re.search(r"(CONTRA|SOBRE|DIANTE D[OAE]|EM CIMA D[OAE])\W+(O |A |DO |DA )?" + re.escape(n) + r"(?![A-Z])", parte):
                lado = outro[lados[c]]
                break
        if lado:
            break
    if not lado:
        lado = lados[citados[0]]
    if "GOL CONTRA" in parte:
        lado = outro[lado]
    return lado


def minuto_real(txt):
    """Minutos desde o início do jogo, contando o intervalo: "23'" -> 23, "67'" -> 84, "45'+2'" -> 47."""
    nums = [int(x) for x in re.findall(r"\d+", txt or "")]
    if not nums:
        return None
    base, extra = nums[0], (nums[1] if len(nums) > 1 else 0)
    return base + extra + (17 if base > 45 else 0)


def palavras_do_nome(nome):
    return [p for p in norm(nome or "").replace("-", " ").split() if len(p) >= 4 and p not in ("JUNIOR", "FILHO", "NETO")]


def montar_gols(jogo, brutos, lances):
    """
    Liga cada vídeo a um gol que valeu. Regras:
    - cada gol real recebe no máximo um vídeo (o primeiro que sair);
    - vídeo de um time que não tem mais gol 'livre' é descartado (repetição, outro ângulo, gol anulado);
    - com os lances da ESPN, o vídeo precisa sair depois do gol e, se citar o autor, vai para o gol dele.
    Sem os lances, cada time fica com no máximo tantos vídeos quantos gols tem no placar.
    """
    placar = {"casa": jogo.get("gols_casa") or 0, "fora": jogo.get("gols_fora") or 0}
    ini = datetime.fromisoformat(jogo["data"].replace("Z", "+00:00"))
    saida = []
    for lado in ("casa", "fora"):
        vids = sorted((v for v in brutos if v.get("lado") == lado), key=lambda v: v["publicado"])
        gols_reais = [g for g in (lances or []) if g["tipo"] == "gol" and g["lado"] == lado]
        if lances is not None and len(gols_reais) == placar[lado]:
            livres = [dict(g, quando=ini + timedelta(minutes=(minuto_real(g.get("minuto")) or 0) - 8)) for g in gols_reais]
            usados = []
            for v in vids:
                pub = datetime.fromisoformat(v["publicado"].replace("Z", "+00:00"))
                aptos = [g for g in livres if g["quando"] <= pub]
                t = norm(v["titulo"])
                # cita o autor de um gol que já tem vídeo? é repetição
                if any(any(re.search(r"\b" + re.escape(p) + r"\b", t) for p in palavras_do_nome(g.get("jogador"))) for g in usados) \
                        and not any(any(re.search(r"\b" + re.escape(p) + r"\b", t) for p in palavras_do_nome(g.get("jogador"))) for g in aptos):
                    continue
                if not aptos:
                    continue
                escolhido = next((g for g in aptos if any(re.search(r"\b" + re.escape(p) + r"\b", t) for p in palavras_do_nome(g.get("jogador")))), aptos[0])
                livres.remove(escolhido)
                usados.append(escolhido)
                saida.append(dict(id=v["id"], titulo=v["titulo"], publicado=v["publicado"], lado=lado,
                                  minuto=escolhido.get("minuto"), jogador=escolhido.get("jogador")))
        else:
            for v in vids[:placar[lado]]:
                saida.append(dict(id=v["id"], titulo=v["titulo"], publicado=v["publicado"], lado=lado))
    saida.sort(key=lambda g: (minuto_real(g.get("minuto")) if g.get("minuto") else 999, g["publicado"]))
    return saida


def main():
    global CHAVE
    CHAVE = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if not CHAVE:
        print("Sem YOUTUBE_API_KEY: pulando os melhores momentos.")
        return
    site = json.loads(SITE.read_text(encoding="utf-8"))
    # clube novo (promovido na temporada seguinte): usa o nome do próprio site para achar os vídeos
    for t in site.get("times", []):
        if t["id"] not in NOMES:
            NOMES[t["id"]] = [norm(t["nome"])]
    inicio = datetime.fromisoformat(site["temporada"]["inicio"] + "T00:00:00+00:00")
    ano = site["temporada"]["inicio"][:4]

    # jogos por (rodada, par de times)
    jogos = {}
    for j in site["jogos"]:
        jogos[(j["rodada"], frozenset((j["casa"], j["fora"])))] = j
    por_par = {}
    for j in site["jogos"]:
        por_par.setdefault(frozenset((j["casa"], j["fora"])), []).append(j)

    dados = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    videos = dados.get("jogos", {})
    gols_antes = json.dumps(dados.get("gols", {}), sort_keys=True)
    jogo_por_id = {str(j["id"]): j for j in site["jogos"]}
    brutos = dados.get("gols_brutos")
    if brutos is None:  # primeira vez com a regra nova: aproveita os vídeos já encontrados
        brutos = {}
        for jid, lista in dados.get("gols", {}).items():
            if jid in jogo_por_id:
                brutos[jid] = [dict(id=g["id"], titulo=g["titulo"], publicado=g["publicado"]) for g in lista]
    brutos_antes = json.dumps(brutos, sort_keys=True)
    jogos_por_time = {}
    for j in site["jogos"]:
        for t in (j["casa"], j["fora"]):
            jogos_por_time.setdefault(t, []).append(j)
    ultimo = dados.get("ultimo_visto", {})  # playlist -> data do vídeo mais novo já lido
    novos_ultimos = dict(ultimo)
    diag = dict(hora=datetime.now(timezone.utc).isoformat(timespec="seconds"), canais={}, titulos_gol=[], erros=[])

    for handle in CANAIS:
        try:
            pl = playlist_de_envios(handle)
        except Exception as e:
            print(f"@{handle}: não deu para ler o canal ({e.__class__.__name__})")
            diag["erros"].append(f"@{handle}: {e.__class__.__name__} {e}"[:200])
            continue
        if not pl:
            print(f"@{handle}: canal não encontrado")
            continue
        corte = datetime.fromisoformat(ultimo[pl]) - timedelta(days=2) if pl in ultimo else inicio
        if handle in RELER and dados.get("regra") != REGRA:
            corte = inicio
        token, paginas, lidos, ligados = None, 0, 0, 0
        while paginas < MAX_PAGINAS:
            params = dict(part="snippet", playlistId=pl, maxResults=50)
            if token:
                params["pageToken"] = token
            d = api("playlistItems", **params)
            paginas += 1
            parar = False
            for it in d.get("items", []):
                sn = it["snippet"]
                pub = datetime.fromisoformat(sn["publishedAt"].replace("Z", "+00:00"))
                if pub < corte:
                    parar = True
                    break
                lidos += 1
                if pl not in novos_ultimos or pub.isoformat() > novos_ultimos[pl]:
                    novos_ultimos[pl] = pub.isoformat()
                t = norm(sn.get("title", ""))
                vid = sn["resourceId"]["videoId"]
                if eh_video_de_gol(t) and len(diag["titulos_gol"]) < 15:
                    diag["titulos_gol"].append([sn.get("title", "")[:90], sn["publishedAt"], sorted(times_no_titulo(t))])
                if eh_video_de_gol(t):
                    # liga o gol ao jogo do clube citado que estava acontecendo quando o vídeo saiu
                    for cid in times_no_titulo(t):
                        cands = [x for x in jogos_por_time.get(cid, [])
                                 if timedelta(minutes=-5) <= pub - datetime.fromisoformat(x["data"].replace("Z", "+00:00")) <= timedelta(hours=4)]
                        if len(cands) == 1:
                            lista = brutos.setdefault(str(cands[0]["id"]), [])
                            if all(g["id"] != vid for g in lista):
                                lista.append(dict(id=vid, titulo=sn.get("title", ""), publicado=sn["publishedAt"], canal=handle))
                                lista.sort(key=lambda g: g["publicado"])
                            break
                    continue
                if "MELHORES MOMENTOS" not in t or "BRASILEIR" not in t or ano not in t:
                    continue
                m = re.search(r"(\d{1,2})\s*[ªAO°º]?\s*RODADA", t)
                clubes = times_no_titulo(t)
                if len(clubes) != 2:
                    continue
                jogo = jogos.get((int(m.group(1)), frozenset(clubes))) if m else None
                if not jogo:
                    # jogo adiado ou título sem rodada: usa o jogo desses dois times que terminou até 4 dias antes do vídeo
                    cands = [x for x in por_par.get(frozenset(clubes), []) if x["status"] == "FINISHED"
                             and timedelta(0) <= pub - datetime.fromisoformat(x["data"].replace("Z", "+00:00")) <= timedelta(days=4)]
                    jogo = cands[0] if len(cands) == 1 else None
                if not jogo:
                    continue
                atual = videos.get(str(jogo["id"]))
                # se houver mais de um vídeo, fica o publicado primeiro (o oficial da partida)
                pri, pri_atual = prioridade(handle, jogo), prioridade((atual or {}).get("canal"), jogo)
                if not atual or pri < pri_atual or (pri == pri_atual and sn["publishedAt"] < atual["publicado"]):
                    videos[str(jogo["id"])] = dict(id=vid, titulo=sn.get("title", ""), publicado=sn["publishedAt"], canal=handle)
                    ligados += 1
            token = d.get("nextPageToken")
            if parar or not token:
                break
        print(f"@{handle}: {paginas} páginas, {lidos} vídeos lidos, {ligados} melhores momentos ligados")
        diag["canais"][handle] = dict(paginas=paginas, lidos=lidos)

    # confere cada vídeo de gol com o placar (e com os lances, quando houver)
    arq_est = ROOT / "data" / "estatisticas.json"
    est = json.loads(arq_est.read_text(encoding="utf-8")).get("jogos", {}) if arq_est.exists() else {}
    gols = {}
    for jid, lista in brutos.items():
        jogo = jogo_por_id.get(jid)
        if not jogo:
            continue
        lista[:] = [v for v in lista if eh_video_de_gol(norm(v["titulo"]))]
        for v in lista:
            v["lado"] = lado_do_gol(norm(v["titulo"]), jogo)
        lances = (est.get(jid) or {}).get("lances")
        if not est.get(jid) or not (est[jid].get("casa") or est[jid].get("fora") or lances):
            lances = None
        valem, ocupados = [], set()
        for pri in sorted({PRIORIDADE.get(v.get("canal") or "getv", 9) for v in lista}):
            do_canal = [v for v in lista if PRIORIDADE.get(v.get("canal") or "getv", 9) == pri]
            for g in montar_gols(jogo, do_canal, lances):
                if g.get("minuto"):
                    chave = (g["lado"], g.get("minuto"), g.get("jogador"))
                    if chave in ocupados:
                        continue
                    ocupados.add(chave)
                else:
                    # sem os lances: cada lado fica com no máximo tantos vídeos quantos gols tem
                    limite = (jogo.get("gols_casa") if g["lado"] == "casa" else jogo.get("gols_fora")) or 0
                    if sum(1 for x in valem if x["lado"] == g["lado"]) >= limite:
                        continue
                valem.append(g)
        valem.sort(key=lambda g: (minuto_real(g.get("minuto")) if g.get("minuto") else 999, g["publicado"]))
        if valem:
            gols[jid] = valem
    brutos = {k: v for k, v in brutos.items() if v}

    # só grava quando algo mudou (evita mudanças a cada volta)
    novo = dict(jogos=videos, gols=gols, gols_brutos=brutos, ultimo_visto=novos_ultimos, diag=diag, regra=REGRA)
    if videos != dados.get("jogos", {}) or json.dumps(gols, sort_keys=True) != gols_antes \
            or json.dumps(brutos, sort_keys=True) != brutos_antes or not dados.get("ultimo_visto") or True:  # diag temporário
        OUT.write_text(json.dumps(novo, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"Vídeos: {len(videos)} jogos com melhores momentos.")
    else:
        print("Vídeos: nada mudou.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Erro nos vídeos: {e}")
        sys.exit(1)
