"""
Lima Score — prováveis escalações publicadas pelo ge.

Para cada jogo dos próximos 3 dias, procura nas notícias do ge dos dois clubes
(data/noticias.json) as matérias de escalação ("Escalação do X: ...",
"X x Y: onde assistir ao vivo, horário e escalações"), abre a matéria e lê a
linha da provável escalação, no formato que o ge usa:

    Goleiro; Lateral, Zagueiro, Zagueiro e Lateral; Volante, Meia e Meia; Atacante, Atacante e Atacante.

Também lê "Desfalques"/"Quem está fora" e "Pendurados". Grava data/provaveis_ge.json.
Se não achar a matéria ou não conseguir ler, não grava nada para aquele time
(o site usa a provável calculada pelo robô).
"""
import html
import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from estatisticas import clube_por_nome, norm  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "data" / "site.json"
NOT = ROOT / "data" / "noticias.json"
OUT = ROOT / "data" / "provaveis_ge.json"
UA = {"User-Agent": "Mozilla/5.0 (compatible; LimaScore/1.0)"}


def baixar(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode("utf-8", "ignore")


def texto_da_materia(h):
    """HTML -> texto com uma linha por parágrafo (só o corpo da matéria)."""
    corpo = re.findall(r"<p[^>]*class=\"[^\"]*content-text__container[^\"]*\"[^>]*>(.*?)</p>", h, re.S)
    if not corpo:
        corpo = re.findall(r"<p[^>]*>(.*?)</p>", h, re.S)
    linhas = []
    for p in corpo:
        t = re.sub(r"<br\s*/?>", "\n", p)
        t = re.sub(r"<[^>]+>", "", t)
        t = html.unescape(t).replace("\xa0", " ")
        for x in t.split("\n"):
            x = re.sub(r"\s+", " ", x).strip()
            if x:
                linhas.append(x)
    return linhas


def nomes_da_linha(txt):
    """'A; B, C e D; E e F' -> [['A'], ['B','C','D'], ['E','F']]"""
    txt = re.sub(r"\(.*?\)", "", txt)          # tira observações entre parênteses
    txt = txt.strip().rstrip(".").strip()
    grupos = []
    for g in txt.split(";"):
        g = g.strip()
        if not g:
            continue
        partes = re.split(r",\s*|\s+e\s+", g)
        nomes = [re.sub(r"^(o|a)\s+", "", p.strip(" .-–")) for p in partes if p.strip(" .-–")]
        if nomes:
            grupos.append(nomes)
    return grupos


def eh_escalacao(grupos):
    total = sum(len(g) for g in grupos)
    return 3 <= len(grupos) <= 6 and 10 <= total <= 12 and len(grupos[0]) == 1 \
        and all(len(n) <= 30 and len(n.split()) <= 4 for g in grupos for n in g)


ROTULO = re.compile(r"(prov[aá]vel (escala[cç][aã]o|time|forma[cç][aã]o)|escala[cç][aã]o prov[aá]vel|time prov[aá]vel|"
                    r"deve (ir a campo|come[cç]ar|ter|jogar) com|deve ser escalad|escala[cç][aã]o d[oa])", re.I)
FORA = re.compile(r"^(?:desfalques?|quem est[aá] fora|fora|n[aã]o (?:joga|jogam|enfrenta)|lesionados?|suspensos?|"
                  r"departamento m[eé]dico)\s*:\s*(?P<lista>.+)$", re.I)
PEND = re.compile(r"^pendurados?\s*:\s*(.+)$", re.I)


def ler_escalacoes(linhas, ids_jogo):
    """Procura, para cada clube do jogo, a linha da escalação, os desfalques e os pendurados."""
    out = {}
    clube_atual = None
    for i, ln in enumerate(linhas):
        # um título/linha curta que cita só um dos clubes muda o "clube atual" do trecho
        cit = clube_por_nome(ln) if len(ln) < 120 else None
        if cit in ids_jogo and not ";" in ln:
            clube_atual = cit
        texto = ln
        alvo = None
        m = re.match(r"^(.{0,90}?):\s*(.+)$", ln)
        if m and (ROTULO.search(m.group(1)) or clube_por_nome(m.group(1)) in ids_jogo):
            alvo = clube_por_nome(m.group(1)) if clube_por_nome(m.group(1)) in ids_jogo else clube_atual
            texto = m.group(2)
        elif ";" in ln:
            alvo = clube_atual
        if ";" in texto and alvo in ids_jogo:
            grupos = nomes_da_linha(texto)
            if eh_escalacao(grupos) and "titulares" not in out.get(alvo, {}):
                out.setdefault(alvo, {})["titulares"] = grupos
                continue
        mf = FORA.match(ln)
        if mf and clube_atual in ids_jogo:
            lista = [x for x in re.split(r",\s*|\s+e\s+|;\s*", re.sub(r"\(.*?\)", "", mf.group("lista")).rstrip(".")) if x.strip()]
            if lista and not re.match(r"^(ningu[eé]m|nenhum)", lista[0].strip(), re.I):
                out.setdefault(clube_atual, {}).setdefault("desfalques", []).extend(x.strip() for x in lista)
        mp = PEND.match(ln)
        if mp and clube_atual in ids_jogo:
            lista = [x.strip() for x in re.split(r",\s*|\s+e\s+", re.sub(r"\(.*?\)", "", mp.group(1)).rstrip(".")) if x.strip()]
            if lista and not re.match(r"^(ningu[eé]m|nenhum)", lista[0], re.I):
                out.setdefault(clube_atual, {})["pendurados"] = lista
    return out


def main():
    site = json.loads(SITE.read_text(encoding="utf-8"))
    noticias = json.loads(NOT.read_text(encoding="utf-8")).get("clubes", {}) if NOT.exists() else {}
    antigo = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    jogos_out = {}
    diag = dict(hora=datetime.now(timezone.utc).isoformat(timespec="seconds"), materias=[], amostra=[])
    agora = datetime.now(timezone.utc)
    lidos = {}
    for j in site.get("jogos", []):
        ini = datetime.fromisoformat(j["data"].replace("Z", "+00:00"))
        if j["status"] == "FINISHED" or not (agora - timedelta(hours=3) <= ini <= agora + timedelta(days=3)):
            continue
        ids = {j["casa"], j["fora"]}
        res = {}
        # matérias do ge sobre esses clubes que falam de escalação, publicadas até 4 dias antes do jogo
        cands = []
        for cid in ids:
            for it in noticias.get(str(cid), []):
                t, link = it.get("titulo", ""), it.get("link", "")
                if "ge.globo.com" not in link or not re.search(r"escala[cç]", t, re.I):
                    continue
                try:
                    quando = datetime.fromisoformat(it["data"])
                except Exception:
                    continue
                if not (ini - timedelta(days=4) <= quando <= ini + timedelta(hours=2)):
                    continue
                citados = {c for c in ids if clube_por_nome(t.split(":")[0]) == c} or {cid}
                cands.append((link, t, citados))
        vistos = set()
        for link, t, citados in cands:
            if link in vistos:
                continue
            vistos.add(link)
            try:
                linhas = lidos.get(link) or texto_da_materia(baixar(link))
                lidos[link] = linhas
            except Exception as e:
                diag["materias"].append([t[:80], f"erro {e.__class__.__name__}"])
                continue
            achado = ler_escalacoes(linhas, ids)
            diag["materias"].append([t[:80], {str(k): len(v.get("titulares") or []) for k, v in achado.items()}])
            if not achado and len(diag["amostra"]) < 2:
                diag["amostra"].append([t[:80], [l[:160] for l in linhas if re.search(r"escala|;|desfalq|fora", l, re.I)][:12]])
            for cid, dado in achado.items():
                r = res.setdefault(cid, {})
                if dado.get("titulares") and "titulares" not in r:
                    r["titulares"], r["url"] = dado["titulares"], link
                for k in ("desfalques", "pendurados"):
                    if dado.get(k) and k not in r:
                        r[k] = dado[k]
        if res:
            jogos_out[str(j["id"])] = {("casa" if cid == j["casa"] else "fora"): v for cid, v in res.items() if v.get("titulares")}
            jogos_out[str(j["id"])] = {k: v for k, v in jogos_out[str(j["id"])].items() if v}
            if not jogos_out[str(j["id"])]:
                del jogos_out[str(j["id"])]
    # mantém o que já tinha sido lido de jogos que ainda vão acontecer, se desta vez a matéria sumiu do feed
    for jid, v in (antigo.get("jogos") or {}).items():
        if jid not in jogos_out and any(str(j["id"]) == jid and j["status"] != "FINISHED" for j in site.get("jogos", [])):
            jogos_out[jid] = v
    novo = dict(jogos=jogos_out, diag=diag)
    if json.dumps(novo.get("jogos"), sort_keys=True) != json.dumps(antigo.get("jogos"), sort_keys=True) or not OUT.exists():
        OUT.write_text(json.dumps(novo, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"Prováveis do ge: {len(jogos_out)} jogos.")
    else:
        print("Prováveis do ge: nada mudou.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # nunca derruba o robô principal
        print(f"Erro nas prováveis do ge: {e.__class__.__name__}: {e}")
