"""
Lima Score — placar rápido.

Roda em paralelo ao robô principal enquanto há jogo. A cada ~8 s lê só o placar do dia
(uma chamada pequena), e publica no ramo ao-vivo na hora em que muda o que importa:
início do jogo, gol, cartão, intervalo e fim. O resto (estatísticas, escalações) vem do
robô principal pelo arquivo data/ao_vivo.json e vai junto, no máximo a cada 2 minutos.
"""
import json
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from estatisticas import baixar, clube_por_nome, ler_lances  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "data" / "site.json"
BASE = ROOT / "data" / "ao_vivo.json"        # escrito pelo robô principal
SAIDA = ROOT / "data" / "ao_vivo_rapido.json"
PARAR = ROOT / "data" / ".parar_rapido"
INTERVALO = 8
ESPACO_EXTRAS = 120
CHAVES = ("status", "gols_casa", "gols_fora", "periodo", "ancora")
AVISADOS = ROOT / "data" / "gols_avisados.json"
SITE_URL = "https://limamatt.github.io/lima-score/"
TOPICO = "limascore"           # tópicos no ntfy: limascore-gols e limascore-<clube>


def slug(nome):
    import unicodedata
    t = "".join(c for c in unicodedata.normalize("NFD", nome) if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def avisar(topicos, titulo, msg, link):
    """Notificação no celular pelo ntfy (grátis, sem cadastro): quem segue o tópico no app recebe na hora."""
    import urllib.request
    for tp in topicos:
        corpo = json.dumps(dict(topic=tp, title=titulo, message=msg, tags=["soccer"], priority=4, click=link)).encode()
        try:
            req = urllib.request.Request("https://ntfy.sh/", data=corpo, headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=10).read()
        except Exception as e:
            print(f"Aviso no ntfy falhou ({tp}): {e.__class__.__name__}", flush=True)


def avisar_gols(site, rapido, avisados):
    """Compara o placar com o último avisado; manda um aviso por gol (e avisa gol anulado)."""
    nomes = {t["id"]: t["nome"] for t in site.get("times", [])}
    jogos = {str(j["id"]): j for j in site.get("jogos", [])}
    mudou = False
    for jid, r in rapido.items():
        j = jogos.get(jid)
        if not j or r.get("gols_casa") is None or r.get("gols_fora") is None:
            continue
        agora_pl = [r["gols_casa"], r["gols_fora"]]
        antes = avisados.get(jid)
        if antes is None:
            # primeira vez que vemos o jogo: só avisa se ele está começando agora (0 x 0 é a base)
            avisados[jid] = [0, 0] if r.get("status") in ("IN_PLAY", "PAUSED") and sum(agora_pl) <= 1 else agora_pl
            antes = avisados[jid]
            mudou = True
        if agora_pl == antes:
            continue
        casa, fora = nomes.get(j["casa"], "Mandante"), nomes.get(j["fora"], "Visitante")
        placar = f"{casa} {agora_pl[0]} × {agora_pl[1]} {fora}"
        topicos = [f"{TOPICO}-gols", f"{TOPICO}-{slug(casa)}", f"{TOPICO}-{slug(fora)}"]
        link = f"{SITE_URL}#jogo-{jid}"
        gols_lances = [x for x in (r.get("lances") or []) if x.get("tipo") == "gol"]
        for i, lado in enumerate(("casa", "fora")):
            novos = agora_pl[i] - antes[i]
            time_nome = casa if lado == "casa" else fora
            if novos > 0:
                dele = [x for x in gols_lances if x.get("lado") == lado]
                for k in range(novos):
                    lance = dele[-novos + k] if len(dele) >= novos else None
                    quem = ""
                    if lance:
                        quem = " · " + " ".join(x for x in [lance.get("minuto"), lance.get("jogador")] if x)
                        if lance.get("penalti"):
                            quem += " (pênalti)"
                        if lance.get("contra"):
                            quem += " (contra)"
                    avisar(topicos, f"⚽ GOL do {time_nome}!", placar + quem, link)
            elif novos < 0:
                avisar(topicos, f"❌ Gol anulado do {time_nome}", placar, link)
        avisados[jid] = agora_pl
        mudou = True
    return mudou


def git(*args, entrada=None):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, input=entrada)


def ler(p, padrao):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return padrao


def janela(site, agora):
    alvo = []
    for j in site.get("jogos", []):
        ini = datetime.fromisoformat(j["data"].replace("Z", "+00:00"))
        if j["status"] in ("IN_PLAY", "PAUSED") or (ini - timedelta(minutes=20) <= agora <= ini + timedelta(minutes=170)):
            alvo.append(j)
    return alvo


def placar_espn(agora):
    evs, vistos = [], set()
    dias = {None, (agora - timedelta(hours=3)).strftime("%Y%m%d")}
    for d in dias:
        try:
            for ev in baixar("/scoreboard" + (f"?dates={d}" if d else "")).get("events", []):
                if ev.get("id") not in vistos:
                    vistos.add(ev.get("id"))
                    evs.append(ev)
        except Exception:
            pass
    return evs


def ler_jogo(j, ev, guardado, agora):
    comp = (ev.get("competitions") or [{}])[0]
    lado = {}
    gols = {}
    for c in comp.get("competitors", []):
        cid = clube_por_nome((c.get("team") or {}).get("displayName") or (c.get("team") or {}).get("name"))
        tid = str((c.get("team") or {}).get("id") or c.get("id"))
        ld = "casa" if cid == j["casa"] else "fora" if cid == j["fora"] else None
        if ld:
            lado[tid] = ld
            try:
                gols[ld] = int(float(c.get("score")))
            except (TypeError, ValueError):
                pass
    if len(lado) < 2:
        return None, None
    st = comp.get("status") or ev.get("status") or {}
    tipo = st.get("type") or {}
    estado = tipo.get("state")
    if estado == "pre":
        return None, None
    out = {}
    if estado == "post":
        out["status"] = "FINISHED"
    else:
        nome = (tipo.get("name") or "").upper()
        detalhe = (tipo.get("shortDetail") or "").upper()
        intervalo = "HALFTIME" in nome or detalhe in ("HT", "INTERVALO", "HALFTIME")
        out["status"] = "PAUSED" if intervalo else "IN_PLAY"
        periodo = int(st.get("period") or 0)
        import re
        nums = [int(x) for x in re.findall(r"\d+", st.get("displayClock") or "")]
        if periodo in (1, 2) and not intervalo:
            base = 0 if periodo == 1 else 45
            decorrido = min(max((nums[0] if nums else base) - base, 0), 45)
            estimada = agora - timedelta(minutes=decorrido)
            ant = guardado.get("ancora")
            if guardado.get("periodo") == periodo and ant and abs(datetime.fromisoformat(ant) - estimada) < timedelta(minutes=3):
                out["ancora"] = ant
            else:
                out["ancora"] = estimada.isoformat(timespec="seconds")
            out["periodo"] = periodo
    if len(gols) == 2:
        out["gols_casa"], out["gols_fora"] = gols["casa"], gols["fora"]
    try:
        lances = ler_lances(comp, {}, lado)
    except Exception:
        lances = None
    return out, lances


def publicar(conteudo, agora):
    SAIDA.write_text(conteudo, encoding="utf-8")
    blob = git("hash-object", "-w", str(SAIDA)).stdout.strip()
    arvore = git("mktree", entrada=f"100644 blob {blob}\tao_vivo.json\n").stdout.strip()
    commit = git("commit-tree", arvore, "-m", "ao vivo " + agora.strftime("%H:%M:%S")).stdout.strip()
    return git("push", "-f", "origin", f"{commit}:refs/heads/ao-vivo").returncode == 0


def main():
    inicio = time.time()
    rapido = {}                 # o que o placar rápido sabe de cada jogo
    ultimo_chave, ultimo_tudo, ultima_pub = None, None, 0.0
    sem_jogo_desde = None
    avisados = ler(AVISADOS, {})
    while time.time() - inicio < 5.5 * 3600 and not PARAR.exists():
        t0 = time.time()
        agora = datetime.now(timezone.utc)
        site = ler(SITE, {})
        alvo = janela(site, agora)
        if not alvo:
            sem_jogo_desde = sem_jogo_desde or time.time()
            if time.time() - sem_jogo_desde > 600:
                break
        else:
            sem_jogo_desde = None
            evs = placar_espn(agora)
            for j in alvo:
                for ev in evs:
                    comp = (ev.get("competitions") or [{}])[0]
                    ids = {clube_por_nome((c.get("team") or {}).get("displayName") or "") for c in comp.get("competitors", [])}
                    if ids == {j["casa"], j["fora"]} and abs(datetime.fromisoformat(ev["date"].replace("Z", "+00:00"))
                                                            - datetime.fromisoformat(j["data"].replace("Z", "+00:00"))) < timedelta(hours=36):
                        out, lances = ler_jogo(j, ev, rapido.get(str(j["id"]), {}), agora)
                        if out:
                            rapido[str(j["id"])] = dict(out, lances=lances)
                        break
        try:
            if avisar_gols(site, rapido, avisados):
                AVISADOS.write_text(json.dumps(avisados, sort_keys=True), encoding="utf-8")
        except Exception as e:
            print(f"Erro nos avisos de gol: {e.__class__.__name__}: {e}", flush=True)
        # junta com o que o robô principal publicou (estatísticas, escalação, transmissões)
        base = ler(BASE, {"jogos": {}, "estat": {}})
        jogos, estat = base.get("jogos") or {}, base.get("estat") or {}
        for jid, r in rapido.items():
            j = jogos.setdefault(jid, {})
            for k in CHAVES:
                if k in r:
                    j[k] = r[k]
            if r.get("status") == "FINISHED":
                j.pop("ancora", None)
            if r.get("lances") is not None and len(r["lances"]) >= len((estat.get(jid) or {}).get("lances") or []):
                estat.setdefault(jid, {})["lances"] = r["lances"]
        chave = json.dumps({k: {kk: v.get(kk) for kk in CHAVES} for k, v in jogos.items()}, sort_keys=True) + \
            json.dumps({k: (v or {}).get("lances") for k, v in estat.items()}, sort_keys=True)
        tudo = json.dumps(dict(jogos=jogos, estat=estat), ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        if jogos and (chave != ultimo_chave or (tudo != ultimo_tudo and time.time() - ultima_pub >= ESPACO_EXTRAS)):
            if publicar(tudo, agora):
                print(f"Placar rápido publicado {agora:%H:%M:%S}" + (" (lance)" if chave != ultimo_chave else ""), flush=True)
                ultimo_chave, ultimo_tudo, ultima_pub = chave, tudo, time.time()
        time.sleep(max(2, INTERVALO - (time.time() - t0)))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Erro no placar rápido: {e.__class__.__name__}: {e}", flush=True)
