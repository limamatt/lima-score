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
ARQUIVOS = ["data/site.json", "data/noticias.json", "data/videos.json", "data/estatisticas.json"]
DURACAO_MAX = int(5.5 * 3600)  # fica ligado enquanto houver jogo (limite de segurança: 5h30)
INTERVALO = 60              # segundos entre conferências durante os jogos
ESPACO_ENTRE_PUBLICACOES = 120  # evita publicar mais de uma vez a cada 2 min


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
        if j["status"] != "FINISHED":
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
    volta = 0
    while True:
        t0 = time.time()
        rodar("estatisticas.py")        # posse, finalizações, cartões e lances (ESPN), a cada volta
        if volta % 3 == 0 and (volta == 0 or jogo_rolando()):
            rodar("videos.py")          # melhores momentos e gols (a cada ~3 min no modo ao vivo)
        rodar("update.py")              # placar, tabela e previsões
        if (volta == 0 and noticias_velhas()) or time.time() - ultima_noticia > 3600:
            rodar("noticias.py")        # notícias: no máximo 1 vez por hora
            ultima_noticia = time.time()
        ao_vivo = ha_jogo_agora()
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


if __name__ == "__main__":
    main()
