# Termômetro do Brasileirão

Site não oficial com tabela, rodadas, artilharia e previsões do Brasileirão.
Ele se atualiza sozinho: a cada 15 minutos um robô do GitHub busca os jogos no
football-data.org, recalcula as previsões e publica os números novos.

## Como funciona

- `index.html`, `style.css`, `app.js`: o site.
- `data/site.json`: os dados que o site mostra. O robô reescreve este arquivo.
- `scripts/update.py`: o robô. Baixa tabela, jogos e artilheiros e calcula as previsões.
- `.github/workflows/atualizar.yml`: diz ao GitHub para rodar o robô a cada 15 minutos.
- `manifest.webmanifest`, `sw.js`, `assets/`: fazem o site virar app no celular.

## Configuração (uma vez só)

1. **Chave da API:** no repositório, vá em *Settings → Secrets and variables → Actions → New repository secret*.
   Nome: `FOOTBALL_DATA_TOKEN`. Valor: sua chave do football-data.org.
2. **Ligar o site:** *Settings → Pages → Build and deployment*. Em *Source*, escolha *Deploy from a branch*,
   branch `main`, pasta `/ (root)`, e salve. O link aparece no topo dessa página em 1 ou 2 minutos.
3. **Testar o robô:** aba *Actions → Atualizar dados → Run workflow*.

## Observações

- O GitHub pode atrasar alguns minutos os robôs agendados. O site reflete cada resultado entre 15 e 30 minutos depois do apito final.
- Se o repositório ficar 60 dias sem nenhuma mudança, o GitHub pausa o robô. Durante o campeonato isso não acontece, porque o próprio robô grava os dados.
- A chave nunca vai para o site: ela fica guardada nos Secrets do repositório.
