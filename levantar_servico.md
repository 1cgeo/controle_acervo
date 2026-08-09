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
2. Deploy (build da interface mais PM2, idempotente):
   ```bash
   npm run deploy   # = npm run build + pm2 startOrReload ecosystem.config.cjs + pm2 save
   ```
   Sobe um processo PM2, `controle-acervo`, na porta de `PORT`. A interface fica em `/`.
3. Auto-start no boot: `pm2 startup` (uma vez, como admin) mais `pm2 save`.

O banco precisa estar na versão **3.0.0**, que é o `MIN_DATABASE_VERSION` de `server/src/config.js`.
Este número ENVELHECE: leia a constante no arquivo antes de confiar nele.
O server recusa subir com banco abaixo do piso (`semver.lt`), e aceita banco à frente. Migrações em
`migrations/`, aplicadas na ordem da VERSÃO que cada arquivo carimba (ver o `README.md`).

**As TRÊS migrações de 2026-08-09 são o exemplo vivo disso, e a ordem alfabética delas é a errada.**
Elas se aplicam nesta ordem: `2026-08-09_o_pit_devolve_o_nome_producao.sql` (carimba 1.50.0),
`2026-08-09_o_sca_vira_sap_3.sql` (**não carimba nada**: o `UPDATE public.versao` saiu dela, e o que
sobrou é uma conferência) e `2026-08-09_o_core_de_producao_atravessa.sql` (carimba **3.0.0**, e é
quem cria os cinco schemas do core). Aplicar por nome de arquivo começaria pelo core, que é o
último. **Um banco que se diz 3.0.0 e não tem `producao.etapa` é o caso que a migração do core
existe para consertar**: com `MIN_DATABASE_VERSION` em 3.0.0 o serviço subiria sem reclamar, e a
falha só apareceria na primeira consulta, como "relation producao.etapa does not exist", longe de
onde nasceu.

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
`/api/metadados`, `/api/microcontrole` e `/api/perigo`) ainda estão FORA dela -- são 309 das 750
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
