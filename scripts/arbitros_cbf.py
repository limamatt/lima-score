"""
Lima Score — escala oficial de arbitragem da CBF.

Cada jogo do Brasileirão 2026 tem uma página na CBF com a "Escala de Árbitros"
(árbitro, assistentes, quarto árbitro, VAR e AVAR). O número da página não segue a ordem
dos jogos, então o robô varre a faixa da temporada e guarda o id de cada jogo. Lê as páginas e grava data/arbitros_cbf.json.

Só relê jogos que ainda não têm árbitro escalado ou que são de até 10 dias atrás
ou dos próximos 7 dias (a CBF às vezes troca a escala em cima da hora).
"""
import html
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from estatisticas import clube_por_nome  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "arbitros_cbf.json"
BASE = 831889                      # perto do primeiro id de página da temporada 2026
URL = "https://www.cbf.com.br/futebol-brasileiro/jogos/campeonato-brasileiro/serie-a/2026/jogo/{}"
UA = {"User-Agent": "Mozilla/5.0 (compatible; LimaScore/1.0)"}
MESES = {m: i + 1 for i, m in enumerate("janeiro fevereiro março abril maio junho julho agosto setembro outubro novembro dezembro".split())}
FUNCOES = {"arbitro": "arbitro", "arbitro assistente 1": "assistente1", "arbitro assistente 2": "assistente2",
           "quarto arbitro": "quarto", "arbitro de video": "var", "var": "var", "avar": "avar", "avar 1": "avar",
           "avar2": "avar2", "avar 2": "avar2"}


def limpa(t):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", t))).strip()


def sem_acento(t):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn").lower()


def ler_jogo(pid):
    req = urllib.request.Request(URL.format(pid), headers=UA)
    with urllib.request.urlopen(req, timeout=25) as r:
        h = r.read().decode("utf-8", "ignore")
    m = re.search(r"Rodada\s*(?:<!-- -->)?\s*(\d+)\s*(?:<!-- -->)?\s*\|\s*Jogo:\s*(?:<!-- -->)?\s*(\d+)", h)
    tit = re.search(r"<title>(.*?)</title>", h, re.S)
    if not m or not tit or not re.search(r"Campeonato Brasileiro\s*\S\s*Série A\s*\S\s*2026", tit.group(1)):
        return None
    n = int(m.group(2))
    clubes = [limpa(x) for x in re.findall(r'class="styles_clubContainer[^"]*"[^>]*>\s*<strong>(.*?)</strong>', h, re.S)]
    if len(clubes) < 2:
        clubes = [limpa(x) for x in re.findall(r'class="styles_clubContainer[^"]*".*?<strong>(.*?)</strong>', h, re.S)]
    data = None
    md = re.search(r"<span>(\d{1,2}:\d{2})</span><span>[^<]*?(\d{1,2}) de ([a-zç]+) de (\d{4})</span>", h)
    if md:
        try:
            hh, mm = md.group(1).split(":")
            data = datetime(int(md.group(4)), MESES[md.group(3)], int(md.group(2)), int(hh), int(mm)).isoformat()
        except Exception:
            data = None
    equipe = {}
    tab = re.search(r"Árbitros em campo</h2>(.*?)</table>", h, re.S)
    if tab:
        for f, nome, uf in re.findall(r"<tr><td>(.*?)</td><td>(.*?)</td><td>(.*?)</td></tr>", tab.group(1), re.S):
            k = FUNCOES.get(sem_acento(limpa(f))) or sem_acento(limpa(f)).replace(" ", "_")
            if k and limpa(nome) and k not in equipe:
                equipe[k] = dict(nome=limpa(nome), uf=limpa(uf))
    casa, fora = (clubes + [None, None])[:2]
    return dict(jogo=n, id=pid, rodada=int(m.group(1)), data=data, casa=casa, fora=fora,
                casa_id=clube_por_nome(casa or ""), fora_id=clube_por_nome(fora or ""), equipe=equipe)


def main():
    antigo = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    jogos = antigo.get("jogos", {})
    agora = datetime.now(timezone(timedelta(hours=-3))).replace(tzinfo=None)
    # os números de página não seguem a ordem dos jogos: varre a faixa da temporada e guarda o id de cada jogo
    conhecidos = {j["id"]: k for k, j in jogos.items() if j.get("id")}
    completo = len(conhecidos) >= 380
    ids = range(BASE - 150, BASE + 600) if not completo else sorted(conhecidos)
    lidos, erros = 0, 0
    for pid in ids:
        k = conhecidos.get(pid)
        j = jogos.get(k) if k else None
        if j and j.get("equipe", {}).get("arbitro") and j.get("data"):
            d = datetime.fromisoformat(j["data"])
            if not (agora - timedelta(days=10) <= d <= agora + timedelta(days=7)):
                continue
        try:
            novo = ler_jogo(pid)
        except Exception:
            erros += 1
            if erros >= 60 and lidos == 0:
                break  # CBF fora do ar: tenta na próxima
            continue
        if novo:
            jogos[str(novo["jogo"])] = novo
            lidos += 1
        time.sleep(0.2)
    saida = dict(jogos=dict(sorted(jogos.items(), key=lambda kv: int(kv[0]))))
    if json.dumps(saida, sort_keys=True) != json.dumps({"jogos": antigo.get("jogos", {})}, sort_keys=True):
        saida["atualizado"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        OUT.write_text(json.dumps(saida, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Arbitragem CBF: {lidos} páginas lidas, {erros} erros, {sum(1 for j in jogos.values() if j['equipe'].get('arbitro'))} jogos com árbitro.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # nunca derruba o robô
        print(f"Erro na arbitragem da CBF: {e.__class__.__name__}: {e}")
