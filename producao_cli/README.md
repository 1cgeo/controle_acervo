# producao_cli

Interface de linha de comando do **PIT** e do **RPCMTec** do SCA, desenhada para **agentes**.

Irmão do `acervo_cli`, do `mapoteca_cli`, do `orcamento_cli` e do `efetivo_cli`: mesmo servidor, mesmo login, mesma sessão em cache. Os três primeiros falam com um **módulo**; este fala com a **plataforma**. O plano anual da Divisão e o relatório mensal dela não pertencem a acervo, mapoteca nem orçamento: os três alimentam os dois.

```
node producao_cli/producao.js --ajuda
```

O **efetivo** (passagens pela DGEO, impedimentos e o mapa de aproveitamento) não está aqui: use o `efetivo_cli`.

## Por que existe

Um agente que opera a API crua paga três impostos. Ele carrega um catálogo de rotas escrito à mão para descobrir os campos de um recurso. Ele recebe JSON completo quando queria quatro colunas. E ele autentica de novo a cada invocação. O CLI zera os três.

## Os quatro princípios

**1. Nada de contrato copiado.** Campos, tipos, obrigatórios, filtros de listagem, parâmetros de rota e regras entre campos saem do Joi vivo do `server/` em tempo de execução, via `describe()`. Não existe arquivo gerado, catálogo em markdown nem documentação paralela para apodrecer. Se o schema mudar, o `producao schema` muda no mesmo commit. A lista de clientes de auth aceitos também não é copiada: ela sai do `.valid()` do `login_schema.js`.

O limite disso é conhecido e tratado: o `describe()` não enxerga os comentários dos `*_schema.js` nem os invariantes dos controladores, e é neles que mora o porquê (que nulo e zero são coisas diferentes na célula da grade, por exemplo). Por isso `lib/regras.js` guarda a prosa curada, curta, só do que o Joi não sabe dizer. **Forma vem do Joi; porquê vem da prosa ao lado.**

**2. Operação nomeada, não CRUD fingido.** A registry é a do `efetivo_cli`, e não a do `orcamento_cli`. Aqui nada é CRUD uniforme: a execução mensal é uma **célula** de grade que um POST só cria, altera e apaga; `fechar` e `reabrir` são **atos**; a subseção se endereça pelo rótulo do documento (`2.3`); o PDF e as planilhas saem fora do envelope JSON. Anunciar `listar/obter/criar/atualizar/deletar` produziria um mapa mentiroso, e o agente descobriria pelo 404.

**3. Saída compacta por padrão.** O consumidor tem janela finita. O padrão é TSV recortado nas colunas que importam, e um array aninhado (os doze meses de uma meta) vira a contagem em vez de explodir a linha. `--json` continua devolvendo tudo, para quem vai encadear.

**4. O guardrail mora na interface.** Validação local antes do envio, e confirmação de ato irreversível com o identificador repetido. A mensagem de recusa diz o que o ato **faz**, não só que ele é perigoso. Skill é de um cliente só; a interface serve todos.

## Os dois modos de validação, e por que são dois

Esta é a única sutileza estrutural do CLI, e ela vem do servidor:

| Grupo | Middleware do servidor | Chave desconhecida no corpo |
|---|---|---|
| `/api/metas` | `utils/schema_validation_estrito.js` | vira **400**, com sugestão do nome parecido |
| `/api/rpcmtec` | `utils/schema_validation.js` | é **descartada em silêncio** (`stripUnknown`) |

A registry declara o modo de cada recurso, e a validação local roda no modo certo. Validar os dois grupos do mesmo jeito produziria um CLI que aprova no `--dry-run` o que a rota real recusa, ou o contrário, que é pior que não validar. No modo `strip`, o descarte vira aviso explícito: é a diferença entre "gravei" e "achei que gravei".

## Uso

```bash
# contrato (não gasta rede nem credencial)
producao schema                # os recursos e suas operações
producao schema execucao       # campos, tipos, guarda e regras da execução mensal
producao edicao                # só as operações de um recurso

# PIT
producao meta listar --ano 2026 --campos numero_meta,item,descricao,quantidade_prevista
producao execucao grade --ano 2026                 # exige gerente
producao execucao resumo --ano 2026 --mes 7        # as duas colunas da 2.1
producao execucao ensaio --ano 2026                # o digitado x o calculado
producao execucao lancar --data '{"meta_id":12,"mes":7,"quantidade":3}' --dry-run
producao revisao alteracoes --revisao 4            # leia contra o DIEx
producao revisao publicar --revisao 4 --data '{"data_vigencia":"2026-05-11"}' --confirmar 4

# RPCMTec (tudo exige administrador)
producao edicao listar --ano 2026
producao edicao conferir --id 7                    # o congelado x o banco de hoje
producao edicao pdf --id 7                         # grava com o nome que o servidor manda
producao edicao fechar --id 7 --confirmar 7
producao anuario rtm-ods --ano 2026 --mes 7 --saida META4.ods

# sessão
producao status    # o SCA está no ar? há token em cache?
producao login     # autentica uma vez, guarda o token (~1h)
```

## Ambiente

Nunca ponha senha na linha de comando.

| Variável | Para quê |
|---|---|
| `SCA_URL` | URL do backend, ex.: `http://IP:porta` (`SCA_SERVER` é alias aceito) |
| `SCA_USER` | login no SCA |
| `SCA_SENHA` | senha (preferir a variável ao `--senha`) |
| `SCA_TOKEN` | JWT pronto, dispensa o login |

O token fica em cache em `~/.sca/sessao-<servidor>.json`, com validade lida do próprio JWT. Um arquivo por servidor, para não misturar a instância local com a de produção. O diretório é o do SCA, e não o deste CLI, de propósito: o token vale para a API inteira, então os CLIs irmãos reaproveitam a mesma sessão. `--sem-cache` desliga.

## Acesso

`/api/metas` e `/api/rpcmtec` são rotas de **plataforma**: sem prefixo de módulo, como `/api/usuarios`. Não existe "perfil de PIT" nem "perfil de RPCMTec", porque não existe módulo com esse nome. A guarda muda **dentro** do `/api/metas`, e é a única sutileza de acesso da área:

| O quê | Guarda |
|---|---|
| ler a meta, o Extra-PIT, o exercício e a revisão | `verifyAcesso` (perfil em **algum** módulo) |
| ler a execução mensal (grade, resumo, ensaio, lançamentos de uma meta) | `verifyPerfil('consulta', 'pit')` |
| lançar a execução mensal e cadastrar o Extra-PIT | `verifyPerfil('operador', 'pit')` |
| a capacitação **MINISTRADA** (2.6), inteira | `verifyPerfil('operador', 'pit')` |
| a capacitação **RECEBIDA** (6.2), inteira | `verifyPerfil('operador', 'efetivo')` |
| a **meta** e a **revisão** do PIT | `verifyAdmin` |
| **ler** a edição do `/api/rpcmtec` e escrever subseção | `verifyGerente` (mais o módulo da subseção) |
| criar, fechar e reabrir a edição do `/api/rpcmtec` | `verifyAdmin` |

O módulo de permissão chama-se **`pit`** (code 4). Ele se chamava `producao` até
2026-08-09, e o nome foi devolvido ao core de produção do SAP, que vai entrar
como módulo próprio. O **diretório** deste CLI ainda se chama `producao_cli`.

A linha entre as duas últimas é a decisão que importa: a **meta** é o que a DSG prometeu, e o que está no sistema é transcrição de documento assinado; a **execução** é o que a Divisão entregou.

**PIT e Efetivo viraram módulos na 1.33.0** (o primeiro com o nome Produção, trocado na 1.50.0), para haver como dar menos que a flag global. Até ali a única guarda disponível para esse trabalho era `verifyAdmin`, e por isso 5 das 7 contas que trabalhavam no sistema eram administradoras (medido em 2026-08-06).

**A capacitação são DOIS recursos**, `capacitacao-ministrada` e `capacitacao-recebida`, porque a permissão é por tipo e a guarda de rota não enxerga o corpo. O `tipo_id` deixou de ir no corpo: quem o fixa é a rota, no servidor.

`verifyGerente` e `verifyPerfil` leem o banco a cada requisição, e não o token: rebaixar perfil vale na hora. O `producao login` diz, numa linha, o que a pessoa alcança, para o 403 não ser lido como rota quebrada.

## O que o CLI protege

- **Validação local**: query, parâmetros de rota e corpo são conferidos contra o Joi antes de sair da máquina, no modo daquele grupo. Corpo torto falha em milissegundos, com o contrato do campo errado impresso junto.
- **Campo descartado**: no `/api/rpcmtec` o servidor joga fora a chave desconhecida sem reclamar. O CLI avisa.
- **Ato irreversível**: `--confirmar` com o identificador repetido em toda exclusão, em `fechar`, em `reabrir` e em `publicar`. Um teste percorre a registry e reprova quem mudar o mundo sem pedir confirmação.
- **`reabrir` não é o inverso de `fechar`**: ele apaga o congelado das subseções calculadas. A mensagem de confirmação diz isso.
- **Binário nunca vai para o stdout**: o PDF e as planilhas vão para disco, com o nome que o servidor escolheu no `Content-Disposition`. Despejar megabytes na saída que o agente lê é o jeito mais rápido de queimar a janela.
- **429**: o SCA limita 200 requisições por minuto. O CLI traduz o 429 numa mensagem que manda retomar do ponto de parada, em vez de reenviar o lote.

## Testes

```bash
node --test producao_cli/__tests__/*.test.js
```

Rodam com o `node:test` embutido, sem instalar nada. Os testes de schema rodam **contra os schemas reais do `server/`**, não contra mocks: o valor do CLI é não ter cópia do contrato, e testar com schema falso testaria justamente a cópia. Em troca, eles quebram quando o contrato do PIT ou do RPCMTec muda, que é exatamente o alarme que se quer ter.

Quatro deles auditam a própria registry contra o servidor: todo nome de schema citado tem de existir no módulo, toda rota com `:param` tem de declarar o schema de params, todo `--confirmar` tem de apontar um parâmetro que a rota realmente tem, e o modo de validação de cada grupo tem de bater com o middleware que o servidor monta.

## Dependências

Nenhuma. Só o Node e o `server/`, de onde vem o Joi através dos próprios arquivos de schema. Isso é o que permite rodar o `producao` num clone recém-baixado, sem `npm install` na pasta do CLI.

## Estrutura

```
producao.js         roteador e mapa de ajuda
lib/args.js         parser de argumentos próprio
lib/config.js       ambiente, cliente do auth, caminho da sessão
lib/http.js         requisição, envelope, cache de token, multipart, download
lib/recursos.js     registry: operação, rota, guarda, modo de validação, colunas
lib/schema.js       joi.describe() -> contrato legível; validação local nos dois modos
lib/regras.js       a prosa curada que o describe() não alcança
lib/saida.js        TSV, tabela, JSON, --campos
comandos/schema.js  o contrato, sem tocar a rede
comandos/operacao.js  o executor de toda operação da registry
comandos/sessao.js  login, logout, status
```

O caminho de cada rota mora em `lib/recursos.js`, e só ali. Os comandos derivam tudo da registry em vez de escrever URL à mão, para que a próxima mudança de rota seja de uma linha.

## Replicar noutro sistema

O padrão é portável para o SAP, que compartilha a mesma stack. O que muda por sistema é `lib/recursos.js` (a registry) e `lib/regras.js` (a prosa). O resto é infraestrutura. Ver a página `agent-first` na wiki do vault.
