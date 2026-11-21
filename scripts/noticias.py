"""
Termômetro do Brasileirão — robô de notícias.

Busca as últimas manchetes do ge (ge.globo.com) de cada clube da Série A e grava
em data/noticias.json. O site mostra só o título, a hora e o link para a
matéria no ge.

Fonte 1: o feed RSS do ge de cada clube.
Fonte 2 (se o feed do ge não responder): a busca do Google Notícias limitada ao ge.
"""
import email.utils
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "data" / "site.json"
OUT = ROOT / "data" / "noticias.json"
POR_CLUBE = 8
MAX_DIAS = 10

# id do clube no football-data -> (endereço do clube no ge, nome para a busca)
CLUBES = {
    1783: ("flamengo", "Flamengo"),
    1769: ("palmeiras", "Palmeiras"),
    1771: ("cruzeiro", "Cruzeiro"),
    1765: ("fluminense", "Fluminense"),
    1768: ("athletico-pr", "Athletico-PR"),
    1777: ("bahia", "Bahia"),
    1766: ("atletico-mg", "Atlético-MG"),
    6685: ("santos", "Santos"),
    4286: ("bragantino", "Bragantino"),
    1780: ("vasco", "Vasco"),
    1776: ("sao-paulo", "São Paulo"),
    1770: ("botafogo", "Botafogo"),
    4241: ("coritiba", "Coritiba"),
    1782: ("vitoria", "Vitória"),
    4364: ("mirassol", "Mirassol"),
    1779: ("corinthians", "Corinthians"),
    6684: ("internacional", "Internacional"),
    1767: ("gremio", "Grêmio"),
    4287: ("remo", "Remo"),
    1772: ("chapecoense", "Chapecoense"),
}

UA = {"User-Agent": "Mozilla/5.0 (TermometroDoBrasileirao; +https://github.com)"}


def baixar(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def ler_rss(xml_bytes):
    raiz = ET.fromstring(xml_bytes)
    itens = []
    for it in raiz.iter("item"):
        titulo = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        data = it.findtext("pubDate")
        if not titulo or not link.startswith("http"):
            continue
        try:
            dt = email.utils.parsedate_to_datetime(data) if data else None
        except (TypeError, ValueError):
            dt = None
        itens.append(dict(titulo=titulo, link=link, data=dt))
    return itens


def do_ge(slug):
    itens = ler_rss(baixar(f"https://ge.globo.com/rss/ge/futebol/times/{slug}/"))
    return [i for i in itens if "ge.globo.com" in i["link"]]


def do_google(nome):
    q = urllib.parse.quote(f'"{nome}" site:ge.globo.com when:{MAX_DIAS}d')
    url = f"https://news.google.com/rss/search?q={q}&hl=pt-BR&gl=BR&ceid=BR:pt-419"
    itens = ler_rss(baixar(url))
    for i in itens:
        i["titulo"] = re.sub(r"\s+-\s+(ge|Globo Esporte|globoesporte\.com|ge\.globo)\s*$", "", i["titulo"], flags=re.I)
    return itens


def main():
    agora = datetime.now(timezone.utc)
    limite = agora - timedelta(days=MAX_DIAS)
    antigo = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {"clubes": {}}
    clubes = {}
    for cid, (slug, nome) in CLUBES.items():
        itens = []
        for fonte in (lambda: do_ge(slug), lambda: do_google(nome)):
            try:
                itens = fonte()
            except Exception as e:  # uma fonte fora do ar não derruba o robô
                print(f"{nome}: fonte falhou ({e.__class__.__name__})")
                itens = []
            if itens:
                break
        itens = [i for i in itens if i["data"] is None or i["data"] >= limite]
        itens.sort(key=lambda i: i["data"] or limite, reverse=True)
        vistos, lista = set(), []
        for i in itens:
            chave = i["titulo"].lower()
            if chave in vistos:
                continue
            vistos.add(chave)
            lista.append(dict(titulo=i["titulo"], link=i["link"],
                              data=i["data"].astimezone(timezone.utc).isoformat(timespec="minutes") if i["data"] else None))
            if len(lista) >= POR_CLUBE:
                break
        # se não veio nada agora, mantém as últimas que já tínhamos
        clubes[str(cid)] = lista or antigo.get("clubes", {}).get(str(cid), [])
        print(f"{nome}: {len(lista)} notícias")

    novo = {"clubes": clubes}
    if {"clubes": antigo.get("clubes")} == novo:
        print("Notícias: nada mudou.")
        return
    novo["atualizado"] = agora.isoformat(timespec="seconds")
    OUT.write_text(json.dumps(novo, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("Notícias atualizadas.")


if __name__ == "__main__":
    main()
