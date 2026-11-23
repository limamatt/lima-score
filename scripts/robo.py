"""
Termômetro do Brasileirão — robô principal.

Fora de horário de jogo: roda uma vez (placar, previsões, vídeos e notícias) e termina.
Com jogo começando em até 70 minutos ou acontecendo: fica ligado até o último jogo
acabar, conferindo o placar a cada 1 minuto durante as partidas e publicando assim
que algo muda. (O GitHub nem sempre chama o robô na hora marcada, por isso ele
já entra em espera antes dos jogos.)
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "data" / "site.json"
NOTICIAS = ROOT / "data" / "noticias.json"
ARQUIVOS = ["data/site.json", "data/noticias.json", "data/videos.json", "data/estatisticas.json", "data/lives.json",
            "data/escalacoes.json", "data/jogadores.json", "data/vagas.json", "data/provaveis_ge.json", "data/arbitros_cbf.json", "data/gols_avisados.json"]
DURACAO_MAX = int(5.5 * 3600)  # fica ligado enquanto houver jogo (limite de segurança: 5h30)
INTERVALO = 30              # segundos entre conferências durante os jogos
ESPACO_ENTRE_PUBLICACOES = 6 * 60  # site completo: no máximo a cada 6 min durante os jogos
# (o GitHub Pages aceita cerca de 10 publicações por hora; o placar ao vivo vai por outro caminho)
AO_VIVO = ROOT / "data" / "ao_vivo.json"
ESTAT = ROOT / "data" / "estatisticas.json"


def rodar(script):
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / script)], cwd=ROOT)
    return r.returncode == 0


def git(*args, check=True):
    return subprocess.run(["git", *args], cwd=ROOT, check=check, capture_output=True, text=True)


def ha_jogo_agora():
    try:
        site = json.loads(SITE.read_text(encoding="utf-8"))
    except Exception:
        return False
    agora = datetime.now(timezone.utc)
    for j in site.get("jogos", []):
        if j["status"] in ("IN_PLAY", "PAUSED"):
            return True
        # mesmo encerrado, segue ligado até 150 min após o início para a tabela oficial confirmar
        ini = datetime.fromisoformat(j["data"].replace("Z", "+00:00"))
        if ini - timedelta(minutes=70) <= agora <= ini + timedelta(minutes=150):
            return True
    return False


def jogo_rolando():
    try:
        site = json.loads(SITE.read_text(encoding="utf-8"))
    except Exception:
        return False
    agora = datetime.now(timezone.utc)
    for j in site.get("jogos", []):
        if j["status"] in ("IN_PLAY", "PAUSED"):
            return True
        if j["status"] != "FINISHED":
            ini = datetime.fromisoformat(j["data"].replace("Z", "+00:00"))
            if ini <= agora <= ini + timedelta(minutes=150):
                return True
    return False


def noticias_velhas():
    try:
        d = json.loads(NOTICIAS.read_text(encoding="utf-8"))
        ultima = datetime.fromisoformat(d["atualizado"])
        return datetime.now(timezone.utc) - ultima > timedelta(minutes=55)
    except Exception:
        return True


def publicar_ao_vivo(ultimo):
    """Placar ao vivo por um caminho rápido: um arquivo pequeno num ramo separado (ao-vivo),
    que o site lê direto do GitHub a cada 20 s. Esse ramo não republica o site, então pode
    ser atualizado a cada volta sem esbarrar no limite do GitHub Pages."""
    try:
        site = json.loads(SITE.read_text(encoding="utf-8"))
        est = json.loads(ESTAT.read_text(encoding="utf-8")).get("jogos", {}) if ESTAT.exists() else {}
    except Exception:
        return ultimo
    agora = datetime.now(timezone.utc)
    jogos, extras = {}, {}
    for j in site.get("jogos", []):
        ini = datetime.fromisoformat(j["data"].replace("Z", "+00:00"))
        if j["status"] in ("IN_PLAY", "PAUSED") or (ini - timedelta(minutes=75) <= agora <= ini + timedelta(hours=3)):
            jogos[str(j["id"])] = {k: j.get(k) for k in ("status", "gols_casa", "gols_fora", "periodo", "ancora", "lives")}
            e = est.get(str(j["id"])) or {}
            extras[str(j["id"])] = {k: e[k] for k in ("lances", "destaque", "casa", "fora", "escalacao") if k in e}
    conteudo = json.dumps(dict(jogos=jogos, estat=extras), ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    if conteudo == ultimo:
        return ultimo
    AO_VIVO.write_text(conteudo, encoding="utf-8")
    if rapido_ligado():
        return conteudo  # quem publica é o placar rápido (junta este arquivo com o placar de segundos atrás)
    blob = git("hash-object", "-w", str(AO_VIVO)).stdout.strip()
    arvore = subprocess.run(["git", "mktree"], cwd=ROOT, input=f"100644 blob {blob}\tao_vivo.json\n",
                            capture_output=True, text=True, check=True).stdout.strip()
    commit = git("commit-tree", arvore, "-m", "ao vivo " + agora.strftime("%H:%M:%S")).stdout.strip()
    if git("push", "-f", "origin", f"{commit}:refs/heads/ao-vivo", check=False).returncode == 0:
        print("Placar ao vivo publicado.")
        return conteudo
    return ultimo


RAPIDO = None


def rapido_ligado():
    return RAPIDO is not None and RAPIDO.poll() is None


def ligar_rapido():
    """Placar rápido em paralelo: confere o placar a cada ~8 s e publica gol, cartão e início na hora."""
    global RAPIDO
    if not rapido_ligado():
        RAPIDO = subprocess.Popen([sys.executable, str(ROOT / "scripts" / "placar_rapido.py")], cwd=ROOT)


def publicar():
    for f in ARQUIVOS:
        if (ROOT / f).exists():
            git("add", f)
    if git("diff", "--cached", "--quiet", check=False).returncode == 0:
        return False
    git("commit", "-m", "Atualiza dados " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M") + " UTC")
    for _ in range(3):
        git("pull", "--rebase", "-X", "theirs", "origin", "main", check=False)
        if git("push", "origin", "HEAD:main", check=False).returncode == 0:
            print("Publicado.")
            return True
        time.sleep(5)
    print("Não consegui publicar desta vez.")
    return False


def main():
    git("config", "user.name", "robo-termometro")
    git("config", "user.email", "robo-termometro@users.noreply.github.com")
    inicio = time.time()
    ultima_pub = 0.0
    ultima_noticia = time.time()
    ultima_provavel = 0.0
    ultima_cbf = 0.0
    ultimo_ao_vivo = None
    volta = 0
    while True:
        t0 = time.time()
        rodar("estatisticas.py")        # posse, finalizações, cartões e lances (ESPN), a cada volta
        if volta % 3 == 0 and (volta == 0 or jogo_rolando()):
            rodar("videos.py")          # melhores momentos e gols (a cada ~3 min no modo ao vivo)
        if volta % 2 == 0:
            rodar("lives.py")           # link exato da transmissão no YouTube (CazéTV, ge tv)
        if volta == 0 or time.time() - ultima_cbf > 6 * 3600:
            rodar("arbitros_cbf.py")    # escala oficial de arbitragem da CBF (a cada 6 h)
            ultima_cbf = time.time()
        if volta == 0 or time.time() - ultima_provavel > 1800:
            rodar("provaveis_ge.py")    # prováveis escalações publicadas pelo ge (a cada 30 min)
            ultima_provavel = time.time()
        rodar("update.py")              # placar, tabela e previsões
        if (volta == 0 and noticias_velhas()) or time.time() - ultima_noticia > 3600:
            rodar("noticias.py")        # notícias: no máximo 1 vez por hora
            ultima_noticia = time.time()
        ao_vivo = ha_jogo_agora()
        if ao_vivo:
            ligar_rapido()
            ultimo_ao_vivo = publicar_ao_vivo(ultimo_ao_vivo)
        if not ao_vivo or time.time() - ultima_pub >= ESPACO_ENTRE_PUBLICACOES:
            if publicar():
                ultima_pub = time.time()
        if not ao_vivo:
            print("Nenhum jogo acontecendo agora.")
            break
        if time.time() - inicio > DURACAO_MAX:
            break
        volta += 1
        rolando = jogo_rolando()
        time.sleep(max(5, (INTERVALO if rolando else 120) - (time.time() - t0)))
    publicar()
    if rapido_ligado():
        RAPIDO.terminate()


if __name__ == "__main__":
    main()
