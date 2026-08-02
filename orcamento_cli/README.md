# orcamento_cli

Interface de linha de comando do **módulo orçamento** do SCA, desenhada para **agentes**.

Irmão do `acervo_cli` e do `mapoteca_cli`: mesmo servidor, mesmo login, mesma sessão em cache. Muda só o módulo com que cada um fala. O client web serve humanos, o CLI serve agentes: a tela otimiza clique e descoberta visual, o CLI otimiza contexto e encadeamento.

```
node orcamento_cli/orcamento.js --ajuda
```

## Fusão de 2026-07-27

O SCO foi absorvido pelo SCA como o módulo `orcamento`, code 3. Três coisas mudaram para quem usava o CLI antigo:

- O binário era `sco.js` (comando `sco`) e agora é `orcamento.js` (comando `orcamento`).
- As rotas do módulo levam o prefixo `/api/orcamento/`. As exceções são `/api/login` e `/api/usuarios`, que são rotas de plataforma.
- As variáveis de ambiente eram `ORCAMENTO_*` e agora são `SCA_*`. O `cliente` do login era `c_orcamentario` e agora é `sca_web`.

O prefixo não é cosmético: `/arquivo` e `/relatorio` existem também no acervo, e uma chamada sem prefixo acerta a rota errada em vez de dar 404.

## Por que existe

Um agente que opera a API crua paga três impostos. Ele carrega um catálogo de rotas escrito à mão para descobrir os campos de um recurso. Ele recebe JSON completo quando queria quatro colunas. E ele autentica de novo a cada invocação. O CLI zera os três.

## Os três princípios

**1. Nada de contrato copiado.** Campos, tipos, obrigatórios, filtros de listagem e regras entre campos saem do Joi vivo do `server/` em tempo de execução, via `describe()`. Não existe arquivo gerado, catálogo em markdown nem documentação paralela para apodrecer. Se o schema mudar, o `orcamento schema` muda no mesmo commit. A lista de clientes de auth aceitos também não é copiada: ela sai do `.valid()` do `login_schema.js`.

O limite disso é conhecido e tratado: o `describe()` não enxerga os comentários dos `*_schema.js`, e é neles que mora o porquê (que `valor_nc` não muda por devolução, por exemplo). Por isso `lib/regras.js` guarda a prosa curada, curta, só do que o Joi não sabe dizer. **Forma vem do Joi; porquê vem da prosa ao lado.**

**2. Saída compacta por padrão.** O consumidor tem janela finita. O padrão é TSV recortado nas colunas que importam. `--json` continua devolvendo tudo, para quem vai encadear.

**3. O guardrail mora na interface.** Validação local antes do envio e confirmação de ação irreversível ficam aqui, não na skill que chama. Skill é de um cliente só; a interface serve todos.

## Uso

```bash
# contrato (não gasta rede nem credencial)
node orcamento_cli/orcamento.js schema      # lista os recursos
node orcamento_cli/orcamento.js schema nc   # campos, tipos, regras da NC

# dia a dia
orcamento saldo                       # quanto falta empenhar e liquidar (total do PDR)
orcamento saldo --nd 339040           # o mesmo, por natureza de despesa
# O RPCMTec saiu daqui em 2026-08-01: é gerado inteiro (acervo, mapoteca e
# orçamento), fora dos módulos, por `acervo rpcmtec --ano 2026 --mes 7 --docx`.

# CRUD
orcamento nc listar --ano 2026 --campos numero,cod_nd,valor_nc
orcamento nc criar --data '{...}' --dry-run       # valida offline, não envia
orcamento nc lancar --data '{...}' --anexo nota.pdf   # cria e anexa numa invocação
orcamento nc deletar --id 9 --confirmar 9

# sessão
orcamento status    # o SCA está no ar? há token em cache?
orcamento login     # autentica uma vez, guarda o token (~1h)
```

## Ambiente

Nunca ponha senha na linha de comando.

| Variável | Para quê |
|---|---|
| `SCA_URL` | URL do backend, ex.: `http://IP:porta` (`SCA_SERVER` é alias aceito) |
| `SCA_USER` | login no SCA |
| `SCA_SENHA` | senha (preferir a variável ao `--senha`) |
| `SCA_TOKEN` | JWT pronto, dispensa o login |

O token fica em cache em `~/.sca/sessao-<servidor>.json`, com validade lida do próprio JWT. Um arquivo por servidor, para não misturar a instância local com a de produção. O diretório é o do SCA, e não o do módulo, de propósito: o token vale para a API inteira, então o `acervo_cli` e o `mapoteca_cli` reaproveitam a mesma sessão. `--sem-cache` desliga.

## Acesso

O módulo não é admin-only. O acesso é por perfil no módulo `orcamento`: consulta lê, operador cria e atualiza, gerente deleta. O CRUD de domínio exige administrador, e o administrador passa em tudo. Só `GET /api` (health) e `POST /api/login` dispensam token.

## O que o CLI protege

- **Validação local**: o corpo é conferido contra o Joi antes de sair da máquina. Corpo torto falha em milissegundos, com o contrato do campo errado impresso junto, em vez de custar um round-trip e um 400 genérico.
- **Campo descartado em silêncio**: campo descartado por regra condicional (como o `pdr_item_id` de uma NC Extra-PDR) some sem erro. O CLI avisa. É a diferença entre "gravei" e "achei que gravei".
- **Exclusão irreversível**: `deletar` exige `--confirmar` com o identificador repetido.
- **Falha parcial do `lancar`**: não há transação entre criar o registro e anexar o arquivo. Se o anexo falhar, o CLI diz explicitamente para não repetir o `lancar` (duplicaria) e dá o comando de reenviar só o anexo.
- **429**: o SCA limita 200 requisições por minuto. O CLI traduz o 429 numa mensagem que manda retomar do ponto de parada, em vez de reenviar o lote.

## Testes

```bash
cd orcamento_cli && npm test
```

Rodam com o `node:test` embutido, sem instalar nada. Os testes de schema rodam **contra os schemas reais do `server/`**, não contra mocks: o valor do CLI é não ter cópia do contrato, e testar com schema falso testaria justamente a cópia. Em troca, eles quebram quando o contrato do módulo muda, que é exatamente o alarme que se quer ter. Há também um teste de regressão da fusão, que reprova qualquer recurso do módulo cujo caminho perca o prefixo `/orcamento`.

## Dependências

Nenhuma. Só o Node e o `server/`, de onde vem o Joi através dos próprios arquivos de schema. Isso é o que permite rodar o `orcamento` num clone recém-baixado, sem `npm install` na pasta do CLI.

## Estrutura

```
orcamento.js        roteador e mapa de ajuda
lib/args.js         parser de argumentos próprio
lib/config.js       ambiente, cliente do auth, caminho da sessão
lib/http.js         requisição, envelope, cache de token, multipart
lib/recursos.js     registry: rota (com o prefixo), módulo de schema, colunas padrão
lib/schema.js       joi.describe() -> contrato legível; validação local
lib/regras.js       a prosa curada que o describe() não alcança
lib/saida.js        TSV, tabela, JSON, --campos
comandos/           schema, crud, relatorio (saldo), dominio, sessao
```

O prefixo `/orcamento` mora em `lib/recursos.js`, e só ali. Os comandos derivam o caminho da registry em vez de escrevê-lo à mão, para que a próxima mudança de rota seja de uma linha.

## Replicar noutro sistema

O padrão é portável para o SAP, que compartilha a mesma stack. O que muda por sistema é `lib/recursos.js` (a registry) e `lib/regras.js` (a prosa). O resto é infraestrutura. Ver a página `agent-first` na wiki do vault.
