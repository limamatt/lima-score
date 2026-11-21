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
CANAIS = ["getv", "geglobo"]  # @getv (ge tv) e, se existir, @geglobo
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


def main():
    global CHAVE
    CHAVE = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if not CHAVE:
        print("Sem YOUTUBE_API_KEY: pulando os melhores momentos.")
        return
    site = json.loads(SITE.read_text(encoding="utf-8"))
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
    ultimo = dados.get("ultimo_visto", {})  # playlist -> data do vídeo mais novo já lido
    novos_ultimos = dict(ultimo)

    for handle in CANAIS:
        try:
            pl = playlist_de_envios(handle)
        except Exception as e:
            print(f"@{handle}: não deu para ler o canal ({e.__class__.__name__})")
            continue
        if not pl:
            print(f"@{handle}: canal não encontrado")
            continue
        corte = datetime.fromisoformat(ultimo[pl]) - timedelta(days=2) if pl in ultimo else inicio
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
                vid = sn["resourceId"]["videoId"]
                atual = videos.get(str(jogo["id"]))
                # se houver mais de um vídeo, fica o publicado primeiro (o oficial da partida)
                if not atual or sn["publishedAt"] < atual["publicado"]:
                    videos[str(jogo["id"])] = dict(id=vid, titulo=sn.get("title", ""), publicado=sn["publishedAt"], canal=handle)
                    ligados += 1
            token = d.get("nextPageToken")
            if parar or not token:
                break
        print(f"@{handle}: {paginas} páginas, {lidos} vídeos lidos, {ligados} melhores momentos ligados")

    # só grava quando um vídeo novo foi ligado a um jogo (evita mudanças a cada 15 minutos)
    novo = dict(jogos=videos, ultimo_visto=novos_ultimos)
    if videos != dados.get("jogos", {}):
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
