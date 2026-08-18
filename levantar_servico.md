# Levantar o SAP

O SAP **não depende de serviço externo para subir**: a autenticação é dele
(`dgeo.usuario.senha`, hash bcrypt), e o boot é `db -> versão -> startServer` (`main.js`), sem cron.
Basta o PostgreSQL.

Estrutura, rotas, variáveis de ambiente e comandos estão no [`README.md`](README.md). Aqui fica só o
procedimento de subir.

## Componentes e portas

| Componente | Porta | Observação |
|---|---|---|
| PostgreSQL + PostGIS | veja `DB_PORT` | banco `sca`; única dependência para subir |
| PostgreSQL da telemetria | veja `MICRO_DB_PORT` | OPCIONAL, e outro banco. Sem ele o serviço sobe inteiro |
| SAP server | 3015 em dev, `PORT` em produção | API REST mais a interface única em `/` |
| Client (dev) | 3003 | Vite, com proxy `/api` para 3015 |

As duas portas de desenvolvimento saem do ambiente (`SCA_CLIENT_PORT` e `SCA_API_PORT`, em
`client/vite.config.js`), com 3003 e 3015 de padrão. Elas existem para levantar uma SEGUNDA
instância em paralelo sem editar o arquivo, que é versionado: editado, a troca de porta aparece em
todo diff e acaba commitada por engano.

Em **produção** o server serve a interface na mesma origem, sem proxy nem porta extra: `npm run build`
gera `client/` para `server/src/build`, servido em `/`. As chamadas de API são `/api/...` na mesma
origem.

### Publicado por proxy reverso, num subcaminho

Quando um proxy reverso publica o SAP em `/<prefixo>/` em vez da raiz do host (porque o mesmo host
publica outros sistemas), duas chaves do `config.env` entram em jogo, e as duas estão no
[`README.md`](README.md):

- **`PUBLIC_PATH=/<prefixo>`.** Ela **entra no build**, e não só no servidor: o `base` do Vite
  escreve o prefixo dentro do `index.html` e das URLs que o bundle monta. Sem ela, o navegador pede
  `/assets/...` na raiz do host, que é um caminho que o proxy não mapeia, e a tela fica branca com
  404 nos assets. **Trocar o prefixo pede build novo**, e na instalação em CONTÊINER ela tem de
  chegar ao BUILD DA IMAGEM (`ENV` ou build arg), porque o `config.env` do bind mount só existe em
  tempo de execução. O `create_build.js` dá precedência ao ambiente exatamente por isso.
- **`TRUST_PROXY=<servidor do proxy>`.** Sem ela o `req.ip` é o IP do proxy para todo mundo, o rate
  limit de 3000/min deixa de ser por cliente e vira um balde único da rede inteira, e o log registra
  sempre o mesmo endereço.

No proxy, a regra encaminha `/<prefixo>/` para a porta de `PORT` **removendo o prefixo** (no nginx, é
a barra no fim do `proxy_pass`), porque o servidor serve a API em `/api` e os assets em `/assets`. O
`client_max_body_size` do proxy tem de caber os 60mb de JSON que o `express.json` aceita, senão o
vídeo de campo morre com 413 antes de chegar ao Node.

O acesso DIRETO na porta continua valendo, com o prefixo na URL (`http://<servidor>:<PORT>/<prefixo>/`):
é o próprio servidor que remove o prefixo quando não há proxy na frente. A raiz nua da porta serve o
`index.html`, e o hash do router funciona a partir dali; o que não existe é o par de caminhos ao mesmo
tempo, porque o prefixo está gravado no build.

## Desenvolvimento (local)

Banco `sca` em `localhost`:
```bash
cd <sca>/server && npm run dev                  # servidor
cd <sca> && npm run dev-client                  # interface, porta 3003
```

Para trabalhar contra o banco de **produção** a partir da máquina local, aponte `DB_*` do
`config.env` para produção. Vale para ler e depurar; escrever assim mexe em dado real.

## Produção (rede da DGEO)

Este repositório é PÚBLICO. Endereço de servidor, porta acoplada a host, pasta de rede e credencial
vivem só no `server/config.env`, que é gitignored. Aqui se cita a CHAVE; o catálogo comentado está em
`.env.example`.

O banco `sca` fica na rede interna: veja `DB_SERVER` e `DB_PORT`. O nome do banco, as chaves `SCA_*`
e o cache de sessão dos CLIs em `~/.sca` NÃO mudaram com a renomeação para SAP: são
identificadores de ambiente e de disco, e trocá-los obrigaria toda máquina instalada a reconfigurar.
Clientes de login: `sap_web` (interface), `sap_fp` (plugin SAP Operador) e `sap_fg` (plugin SAP
Gerente), com `sca_web` e `sca_qgis` ainda aceitos enquanto houver cliente antigo no ar. É o que a
coluna `dgeo.login.cliente` guarda. Os arquivos do acervo ficam no volume descrito na coluna
`acervo.volume_armazenamento.volume`, no próprio banco, que é a fonte canônica do caminho.

1. `server/config.env`: `DB_*` do banco de produção, `DB_USER_READONLY` e `DB_PASSWORD_READONLY`. A
   role de leitura precisa existir no banco antes do deploy. Fora do Windows, `VOLUMES_RAIZ`.
   As `MICRO_DB_*` são o banco da TELEMETRIA do microcontrole, que é **outro banco** e é
   **opcional**: elas valem todas ou nenhuma (o boot cobra), e vazias são um estado normal -- o
   serviço sobe inteiro e só as seis rotas de `/api/microcontrole` que leem a telemetria respondem
   503. A conexão é preguiçosa, então aquele banco fora do ar **não derruba o serviço**. O schema
   dele se instala por `er_microcontrole/`, e `node create_config.js` o cria quando se responde que
   sim à pergunta do microcontrole.

   As `PRODUCAO_DB_ADMIN_*` mais `PRODUCAO_DB_HOSTS` são a conexão ADMINISTRATIVA dos bancos de
   edição, que cria e revoga o papel efêmero do operador. Elas também valem **todas ou nenhuma**, e
   sem elas as três rotas de `/banco_dados` respondem 503 e o pacote da atividade sai sem a seção de
   acesso. **ATENÇÃO AO ATUALIZAR:** quem já tinha as duas primeiras precisa acrescentar
   `PRODUCAO_DB_HOSTS`, senão o serviço **não sobe** -- o boot recusa duas das três, e a mensagem
   nomeia a que falta. Ela é a lista branca de `servidor` ou `servidor:porta`, separada por vírgula,
   e existe porque sem ela um gerente do módulo escolhia para onde o serviço discava com a
   credencial de superusuário.
2. Deploy (build da interface mais PM2, idempotente):
   ```bash
   npm run deploy   # = npm run build + pm2 startOrReload ecosystem.config.cjs + pm2 save
   ```
   Sobe um processo PM2, `controle-acervo`, na porta de `PORT`. A interface fica em `/`.
3. Auto-start no boot: `pm2 startup` (uma vez, como admin) mais `pm2 save`.

### A instalação da DGEO roda em CONTÊINER, e não pelos passos 2 e 3 acima

Descoberto em 2026-08-12, ao atualizar o serviço depois de uma migração: **este documento descrevia
só o caminho do PM2 na máquina, e quem o seguisse iria pelo caminho errado.** Os passos 2 e 3
continuam válidos para uma instalação que rode direto no host; não é o caso da que está no ar.

Lá o serviço é um contêiner Docker, `controle-acervo`, publicado na porta de `PORT`, com um clone
deste repositório na pasta do serviço no servidor. **O PM2 não sumiu: ele roda DENTRO do contêiner**
(`CMD ["pm2-runtime", "start", "/app/ecosystem.config.cjs"]`), e é isso que reconcilia os dois
caminhos. O `config.env` NÃO entra na imagem: ele é montado do host por bind mount, e é por isso que
trocar credencial não pede build.

**`Dockerfile` e `start_docker.sh` NÃO são versionados: vivem só no servidor.** Quem procurar os dois
aqui não acha, e a ausência é o estado normal, não arquivo perdido. Leia-os no servidor antes de
mexer, e guarde cópia antes de editar -- não há de onde restaurar.

**NÃO rode o `start_docker.sh` de lá para atualizar.** Ele faz `stop`, `rm`, `rmi`, `build`, `run`
nessa ordem: apaga a imagem ANTES de construir a nova, e um build que falhe deixa o serviço fora do
ar sem imagem para voltar. O ciclo seguro constrói primeiro, com o contêiner atual servindo o tempo
todo:

```bash
git pull
docker build -t controle-acervo:novo .        # o atual continua no ar
docker tag controle-acervo:latest controle-acervo:anterior   # guarda de onde voltar
docker stop controle-acervo && docker rm controle-acervo
docker tag controle-acervo:novo controle-acervo:latest
docker run -d ... --name controle-acervo controle-acervo     # portas e binds LIDOS do start_docker.sh
```

A parada real é de poucos segundos, entre o `stop` e o `run`. **Migração aditiva tolera a janela**
entre migrar o banco e trocar o contêiner (medido: o código anterior serviu horas contra o banco já
migrado, sem incidente); migração DESTRUTIVA quebra as telas durante a janela inteira, e aí a ordem
é parar o contêiner, migrar e subir a imagem nova.

**Depois de trocar, prove -- e escolha a prova pelo que o commit tocou.** Contêiner "Up" não prova
serviço no ar, e `GET /api` devolvendo `version` com o número novo prova que o processo carregou o
código novo. Se o commit mexeu no client, o nome do bundle
(`server/src/build/assets/index-<hash>.js`) muda entre a imagem anterior e a nova; se mexeu **só no
servidor**, ele sai IGUAL nas duas, e cobrar diferença ali acusa um defeito que não existe -- prove
com o símbolo novo dentro da imagem (`docker run --rm controle-acervo:novo grep ...`).

**O contêiner sobe sem política de reinício**, porque o `start_docker.sh` não passa `--restart`. Um
reboot do servidor deixa o serviço fora até alguém subir a mão. Está anotado como pendência, e
mudá-lo é decisão à parte.

O endereço do servidor, o caminho da pasta e a credencial de acesso não entram aqui, porque este
repositório é público. Eles vivem no `.env` do vault de gestão, junto com a rotina que faz esta
atualização.

O banco precisa estar na versão **3.0.0**, que é o `MIN_DATABASE_VERSION` de `server/src/config.js`.
Este número ENVELHECE: leia a constante no arquivo antes de confiar nele.
O server recusa subir com banco abaixo do piso (`semver.lt`), e aceita banco à frente. Migrações em
`migrations/`, aplicadas na ordem da VERSÃO que cada arquivo carimba (ver o `README.md`).

**As CINCO migrações de 2026-08-09 são o exemplo vivo disso, e a ordem alfabética delas é a
errada.** Elas se aplicam nesta ordem, que é a da versão que cada uma carimba:

1. `2026-08-09_o_pit_devolve_o_nome_producao.sql` -- carimba **1.50.0**.
2. `2026-08-09_a_instituicao.sql` -- carimba **1.51.0**. Cria `dgeo.instituicao` e semeia a linha
   única com o nome, a sigla e a UG desta instalação.
3. `2026-08-09_a_area_e_de_quem_configurou.sql` -- carimba **1.52.0**. Apaga
   `limites.area_suprimento.e_1cgeo` e amarra a área ao nome configurado no passo anterior. Ela
   **recusa rodar antes da 1.51.0**, e a recusa é o comportamento certo.
4. `2026-08-09_o_sca_vira_sap_3.sql` -- **não carimba nada**: o `UPDATE public.versao` saiu dela em
   2026-08-09, e o que sobrou é uma conferência.
5. `2026-08-09_o_core_de_producao_atravessa.sql` -- carimba **3.0.0**, e é quem cria os cinco
   schemas do core.

A cadeia sobe, portanto, 1.49.0 -> 1.50.0 -> 1.51.0 -> 1.52.0 -> 3.0.0. Aplicar por nome de arquivo
começaria pela área (que exige a instituição) e poria o core em segundo, quando ele é o último.
**Quem pular as duas do meio sobe sem `dgeo.instituicao` e com o `e_1cgeo` ainda de pé**, e o
sintoma aparece longe daqui: a subseção 2.7 do RPCMTec e o rodapé dos relatórios não têm de onde
tirar de quem é a instalação. **Um banco que se diz 3.0.0 e não tem `producao.etapa` é o caso que a
migração do core existe para consertar**: com `MIN_DATABASE_VERSION` em 3.0.0 o serviço subiria sem
reclamar, e a falha só apareceria na primeira consulta, como "relation producao.etapa does not
exist", longe de onde nasceu.

**A versão do banco NÃO diz quais migrações faltam.** Metade delas não mexe no número, e duas do
mesmo dia não se ordenam pelo nome do arquivo. Antes de atualizar um banco, MEÇA o que já está lá,
objeto por objeto (a tabela existe? a coluna existe? o índice existe?), e monte a lista de pendentes
a partir da medição. Um banco que se diz numa versão pode ter migrações pendentes que não carimbam
nada, e outras que parecem pendentes já aplicadas e superadas por migrações posteriores.

## Smoke tests

**Depois de todo deploy, rode a fumaça inteira.** Ela exercita a plataforma, o acervo, a mapoteca, o
orçamento e o RPCMTec de ponta a ponta, só com leitura, e sai com código 1 se algo falhar (serve de
portão num script de deploy). `equipamento`, `campo`, `efetivo` e os **sete prefixos do core de
produção** (`/api/producao`, `/api/gerencia_producao`, `/api/distribuicao`, `/api/acompanhamento`,
`/api/metadados`, `/api/microcontrole` e `/api/perigo`) ainda estão FORA dela -- são 312 das 755
rotas do sistema sem fumaça, e depois de um deploy do core vale abrir `#/producao` na interface:

```bash
SCA_URL=http://localhost:3015 SCA_USER=<login> SCA_SENHA=<senha> python scripts/fumaca.py
```

Cada checagem imprime o que esperava e o que veio. Duas delas conferem CONTAGEM, e não só o HTTP: as
subseções do RPCMTec e as linhas de cada bloco do Anuário. São os dois números que caem em silêncio
se uma subseção sumir do gerador ou se a planilha-semente for trocada por uma de outro formato.

Os mínimos da fumaça são do acervo da DGEO, e instalação nova devolve menos: ajuste os mínimos ou
rode só as checagens de rota.

Conferência rápida, sem credencial:
```bash
curl -s http://localhost:3015/api | grep operacional                            # SAP
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3015/                 # interface
```

Swagger em `/api/api_docs`.

## Guard anti-vazamento (rode uma vez por clone)

```bash
git config core.hooksPath .githooks
```

Sem isso o `.githooks/pre-commit` não roda, porque o git não versiona `.git/hooks`. O hook checa a
sintaxe dos `.js` do commit e roda `scripts/check_vazamento.py`, que barra IP interno, pasta de rede,
caminho de máquina e segredo com valor neste repositório, que é PÚBLICO.

## Troubleshooting

- **SAP sobe e cai na hora** -> banco fora do ar ou `DB_*` errado.
- **Boot recusado por versão** -> banco abaixo do `MIN_DATABASE_VERSION`; falta aplicar migração de
  `migrations/`.
- **Ninguém consegue entrar, com "Usuário sem senha cadastrada"** -> a migração
  `2026-08-02_autenticacao_local.sql` foi aplicada e a cópia dos hashes não. Rode
  `scripts/copiar_usuarios_auth.js` (em ensaio primeiro). A tela `#/usuarios` marca quem está sem
  senha.
- **Interface em branco, ou 404 nos assets** -> `base` no `client/vite.config.js` tem de ser `'/'`, e
  o `build/` precisa ter sido gerado (`npm run build`).
- **A tela chama rota que não existe, e o erro fala de OUTRO campo** ("Erro de validação dos
  Parâmetros: `id` must be a number" no RPCMTec, na capacitação ou no dashboard) -> o `build/` que a
  porta do servidor serve está VELHO. Ele é uma cópia, e não se atualiza com o fonte: enquanto o
  `npm run dev-client` (3003) mostra o código de agora, a porta do servidor mostra o build da última
  vez que alguém rodou `npm run build`. Quando uma rota é renomeada no meio, o bundle antigo chama o
  endereço antigo, ele cai na rota de parâmetro (`/rpcmtec/:id`) e a mensagem acusa o `id`, que
  ninguém mandou. Rode `npm run build` e recarregue com Ctrl+F5. Medido em 2026-08-08, com um build
  de seis dias antes.
- **Módulo some do seletor** -> a pessoa não tem linha em `dgeo.usuario_perfil` para aquele módulo, e
  não é `administrador`. Conceder é ato explícito, pela tela de usuários. Se `modulos` vier vazio no
  corpo do `POST /api/login`, o problema está no banco, não na tela.
- **Rota do orçamento devolve 403 para quem tem perfil** -> a rota pode ter ficado sem o segundo
  argumento do `verifyPerfil`, e estar cobrando perfil no acervo. O teste
  `server/src/__tests__/routes/modulo_em_toda_rota.test.js` barra isso. Ele varre SEIS pastas de
  rota, com piso de contagem em cada uma: `orcamento`, `mapoteca`, `equipamento`, `producao`, mais
  duas em que a PASTA não se chama como o MÓDULO -- `campo`, que cobra `pit`, e `microcontrole`, que
  cobra `producao`. Em `efetivo`, em `pit/` e no acervo, ninguém cobra por você.
- **`confirm-upload` responde "Arquivo não encontrado" para todo arquivo, em servidor Linux** -> a
  coluna `acervo.volume_armazenamento.volume` guarda caminho UNC do Windows. Em Linux a contrabarra é
  caractere comum de nome, e o `path.join` junta com barra normal, produzindo caminho relativo
  inexistente. Monte o compartilhamento por CIFS e grave o PONTO DE MONTAGEM na coluna, ou use
  `VOLUMES_RAIZ`. As duas coisas são a MESMA mudança: separadas, o cadastro para de validar checksum.
