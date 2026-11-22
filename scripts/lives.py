"""
Termômetro do Brasileirão — robô das transmissões no YouTube.

Para os jogos que passam em canais do YouTube (CazéTV, ge tv), acha o vídeo exato
da transmissão pelo título da live (os dois times no título) e grava em
data/lives.json. O site usa esse link no botão "Onde assistir".

Gasta pouca cota: a lista de envios do canal custa 1 unidade e a confirmação
dos vídeos mais 1. Só se isso não achar nada recorre à busca de lives do canal
(100 unidades), no máximo a cada 20 minutos por canal.
"""
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import videos  # noqa: E402  (mesma chave, mesmos nomes de clubes)
from videos import NOMES, norm  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "data" / "site.json"
OUT = ROOT / "data" / "lives.json"
CACHE = ROOT / "data" / ".lives_cache.json"  # controle de frequência (não vai para o site)

# nome do canal como aparece em "Onde assistir" -> @ do canal no YouTube
CANAIS_YT = {"CAZETV": "CazeTV", "GE TV": "getv", "GETV": "getv"}
CONFERIR_A_CADA = 120        # segundos entre leituras da lista de envios de cada canal
BUSCA_A_CADA = 20 * 60       # segundos entre buscas de lives (a parte cara da cota)


def clubes_no_titulo(titulo):
    t = norm(titulo)
    achados = set()
    for cid, nomes in NOMES.items():
        for n in nomes:
            if re.search(r"(?<![A-Z])" + re.escape(n) + r"(?![A-Z])", t):
                achados.add(cid)
                break
    return achados


def main():
    videos.CHAVE = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if not videos.CHAVE:
        print("Lives: sem YOUTUBE_API_KEY.")
        return
    site = json.loads(SITE.read_text(encoding="utf-8"))
    dados = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    achados = dados.get("jogos", {})
    antes = json.dumps(achados, sort_keys=True)
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    agora = datetime.now(timezone.utc)

    # jogos de hoje em canais do YouTube, de 2h antes até 3h depois do início, ainda sem link
    pendentes = {}  # handle -> [(jogo, nome do canal)]
    for j in site.get("jogos", []):
        ini = datetime.fromisoformat(j["data"].replace("Z", "+00:00"))
        if j.get("status") == "FINISHED" or not (ini - timedelta(hours=2) <= agora <= ini + timedelta(hours=3)):
            continue
        for c in j.get("canais") or []:
            h = CANAIS_YT.get(norm(c).strip())
            if h and c not in (achados.get(str(j["id"])) or {}):
                pendentes.setdefault(h, []).append((j, c))
    if not pendentes:
        print("Lives: nada para procurar.")
        return

    for handle, jogos in pendentes.items():
        cc = cache.setdefault(handle, {})
        if time.time() - cc.get("conferido", 0) < CONFERIR_A_CADA:
            continue
        cc["conferido"] = time.time()
        try:
            if not cc.get("playlist"):
                cc["playlist"] = videos.playlist_de_envios(handle)
            ids = []
            if cc.get("playlist"):
                d = videos.api("playlistItems", part="contentDetails", playlistId=cc["playlist"], maxResults=50)
                ids = [i["contentDetails"]["videoId"] for i in d.get("items", [])]
            candidatos = []
            if ids:
                d = videos.api("videos", part="snippet,liveStreamingDetails", id=",".join(ids[:50]))
                candidatos = [v for v in d.get("items", []) if v.get("liveStreamingDetails")]
            ligados = ligar(jogos, candidatos, achados)
            # nada na lista de envios: busca as lives do canal (cara, então com intervalo maior)
            faltam = [x for x in jogos if x[1] not in (achados.get(str(x[0]["id"])) or {})]
            if faltam and time.time() - cc.get("buscado", 0) >= BUSCA_A_CADA:
                cc["buscado"] = time.time()
                if not cc.get("canal_id"):
                    d = videos.api("channels", part="id", forHandle=handle)
                    cc["canal_id"] = ((d.get("items") or [{}])[0]).get("id")
                ids = []
                for tipo in ("live", "upcoming"):
                    d = videos.api("search", part="id", channelId=cc["canal_id"], eventType=tipo, type="video", maxResults=25)
                    ids += [i["id"]["videoId"] for i in d.get("items", []) if i.get("id", {}).get("videoId")]
                if ids:
                    d = videos.api("videos", part="snippet,liveStreamingDetails", id=",".join(ids[:50]))
                    ligados += ligar(faltam, d.get("items", []), achados)
            print(f"Lives @{handle}: {ligados} jogo(s) ligado(s).")
        except Exception as e:
            print(f"Lives @{handle}: erro ({e.__class__.__name__}: {e})")

    CACHE.write_text(json.dumps(cache), encoding="utf-8")
    if json.dumps(achados, sort_keys=True) != antes:
        OUT.write_text(json.dumps(dict(jogos=achados), ensure_ascii=False, indent=1), encoding="utf-8")
        print("Lives atualizadas.")


def ligar(jogos, candidatos, achados):
    """Liga cada jogo à live cujo título cita os dois times e cujo horário bate."""
    n = 0
    for j, canal in jogos:
        ini = datetime.fromisoformat(j["data"].replace("Z", "+00:00"))
        melhor, dif = None, None
        for v in candidatos:
            sn, ls = v.get("snippet") or {}, v.get("liveStreamingDetails") or {}
            if sn.get("liveBroadcastContent") not in ("live", "upcoming") and not ls.get("actualStartTime"):
                continue
            if not {j["casa"], j["fora"]} <= clubes_no_titulo(sn.get("title", "")):
                continue
            if re.search(r"PRE[ -]?JOGO|POS[ -]?JOGO|MELHORES MOMENTOS|REACT", norm(sn.get("title", ""))):
                continue
            quando = ls.get("scheduledStartTime") or ls.get("actualStartTime")
            d = abs(datetime.fromisoformat(quando.replace("Z", "+00:00")) - ini) if quando else timedelta(hours=5)
            if d <= timedelta(hours=4) and (dif is None or d < dif):
                melhor, dif = v["id"], d
        if melhor:
            achados.setdefault(str(j["id"]), {})[canal] = melhor
            n += 1
    return n


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # nunca derruba o robô principal
        print(f"Erro nas lives: {e.__class__.__name__}: {e}")
