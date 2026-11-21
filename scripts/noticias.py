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

# outros nomes pelos quais o clube aparece nas manchetes
APELIDOS = {
    1768: ["Athletico", "Furacão"], 1766: ["Atlético-MG", "Galo", "Atlético Mineiro"], 4286: ["Bragantino", "Massa Bruta"],
    6684: ["Inter", "Internacional", "Colorado"], 1772: ["Chapecoense", "Chape"], 4287: ["Remo", "Leão Azul"],
    1780: ["Vasco"], 1783: ["Flamengo", "Fla", "Mengão"], 1765: ["Fluminense", "Flu"], 1770: ["Botafogo", "Fogão"],
    1779: ["Corinthians", "Timão"], 1769: ["Palmeiras", "Verdão"], 6685: ["Santos", "Peixe"], 1776: ["São Paulo"],
    1767: ["Grêmio"], 1771: ["Cruzeiro", "Raposa"], 1777: ["Bahia", "Tricolor de Aço"], 4241: ["Coritiba", "Coxa"],
    1782: ["Vitória"], 4364: ["Mirassol"],
}


def relevante(item, cid, slug):
    if f"/times/{slug}/" in item["link"]:
        return True
    titulo = item["titulo"]
    if titulo.lower().startswith("ao vivo"):
        return False
    return any(re.search(r"(?<![\wÀ-ú])" + re.escape(n) + r"(?![\wÀ-ú])", titulo) for n in APELIDOS.get(cid, []))


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
        if dt is not None and dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
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
        for rotulo, fonte in (("ge", lambda: do_ge(slug)), ("Google Notícias", lambda: do_google(nome))):
            try:
                novos = fonte()
            except Exception as e:  # uma fonte fora do ar não derruba o robô
                print(f"{nome}: {rotulo} falhou ({e.__class__.__name__})")
                continue
            novos = [i for i in novos if (i["data"] is None or i["data"] >= limite) and relevante(i, cid, slug)]
            print(f"{nome}: {len(novos)} notícias recentes de {rotulo}")
            itens += novos
            if len(itens) >= POR_CLUBE:
                break
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
