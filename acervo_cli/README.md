# acervo_cli

Interface de linha de comando do SCA, desenhada para **agentes**.

O `acervo_client` serve humanos, o `acervo_cli` serve agentes. São dois clientes da mesma API, com ergonomias diferentes de propósito: a tela otimiza clique e descoberta visual, o CLI otimiza contexto e encadeamento.

```
node acervo_cli/acervo.js --ajuda
```

## Por que existe

Um agente que opera o SCA pela API crua paga quatro impostos: precisa carregar um catálogo de rotas escrito à mão para descobrir os campos de uma operação, recebe JSON aninhado quando queria seis colunas, autentica de novo a cada invocação, e monta um `PUT` de objeto inteiro à mão (arriscando apagar em silêncio o campo que não mandou). O CLI existe para zerar os quatro.

## Os cinco princípios

**1. Nada de contrato copiado.** Campos, tipos, obrigatórios, condicionais, dependências e filtros saem do Joi vivo do `server/` em tempo de execução, via `describe()`. Não existe arquivo gerado, catálogo em markdown nem documentação paralela para apodrecer. Se o schema mudar, o `acervo schema` muda no mesmo commit, e os testes quebram.

**2. Prosa curada só para o que o `describe()` não alcança.** O `describe()` não enxerga os comentários dos `*_schema.js`, os controllers nem os triggers do banco, e é neles que mora o porquê (que a `data_edicao` prova a edição e o rótulo impresso na folha não, por exemplo). `lib/regras.js` guarda essa prosa, curta. O que o Joi já diz não se repete lá. **Forma vem do Joi; porquê vem da prosa ao lado.**

**3. Saída compacta por padrão.** O consumidor tem janela finita: o `/produto/detalhado` de uma carta devolve produto, versões, relacionamentos e arquivos aninhados. O padrão é TSV recortado; `--json` continua devolvendo tudo, para quem vai encadear.

**4. Verbos de intenção, não espelho do CRUD.** Os verbos existem onde colapsam um encadeamento real (ver abaixo). Verbo que precisasse de regra de negócio nova pertence ao backend, não ao CLI.

**5. O guardrail mora na interface.** Validação local antes do envio, `--dry-run` que funciona **offline** (sem servidor e sem credencial) e confirmação explícita de ação irreversível ficam aqui, não na skill que chama. Skill é de um cliente só; a interface serve todos.

## O que o CLI não copia do SCO

O `orcamento_cli` tem um `crud.js` genérico porque o SCO é CRUD uniforme (`/recurso`, `/recurso/:id`). O SCA **não é**: as rotas são operações em lote nomeadas (`PUT /produtos/versao` com o objeto inteiro no corpo, `DELETE /arquivo/arquivo` com a lista de ids no corpo, `POST /produtos/mover-arquivos`). Fingir CRUD produziria um mapa mentiroso, então cada recurso da registry declara suas **operações**, uma por rota real.

## Uso

```bash
# contrato (não gasta rede nem credencial)
acervo schema                    # os recursos e suas operações
acervo schema produtos           # campos, tipos, obrigatórios e regras da escrita
acervo dominio                   # os ids de domínio e os apelidos aceitos
acervo dominio tipo_escala       # a tabela viva (exige perfil consulta)

# os verbos de intenção
acervo cobertura --mi 2965-2,2965-4 --escala 50k --anos 10   # já temos essa carta?
acervo cobertura --escala 250k --so-faltantes
acervo produto 2965-2                                        # as edições da folha
acervo produto --id 4211 --arquivos --caminho                # os arquivos, com o caminho
acervo finalizados --ano 2026 --mes 7                        # o que foi finalizado
acervo rpcmtec --ano 2026 --mes 7 --pdf                      # o RPCMTec do mês, em PDF
acervo rpcmtec --ano 2026 --mes 7 --anuario                  # o Anuário Estatístico, em ODS

# escrita guardada
acervo editar versao --id 7244 --set data_edicao=2019-08-15 --dry-run
acervo editar versao --id 7244 --set data_edicao=2019-08-15 --confirmar 7244

# qualquer rota, pela registry
acervo produtos                                       # as operações do recurso
acervo produtos excluir-versao --data '{...}' --dry-run
acervo arquivo preparar-produto --data-file lote.json --dry-run

# sessão
acervo status    # o SCA está no ar? há token em cache?
acervo login     # autentica uma vez, guarda o token (~1h)
```

## Os verbos, e por que estes

Cada verbo colapsa um encadeamento que hoje se repete no dia a dia da DGEO (as skills do vault são o levantamento de requisitos: elas mostram o que o chefe de fato pede).

| Verbo | O que colapsa |
|---|---|
| `cobertura` | "já temos essa carta?". Uma chamada pública, mas a resposta é uma FeatureCollection por escala com os anos de edição em arrays: raciocinar folha a folha sobre isso custa a janela inteira. Aqui sai uma linha por folha, com o ano mais recente e o veredito, e **a folha que o acervo nem conhece vira aviso** em vez de sumir da lista. |
| `produto` | "que edições tem essa folha?" e "qual é o arquivo mais recente do MI X?". Faz `busca` → `produto/detalhado` → (com `--caminho`) `volumes` e recorta. Termo ambíguo devolve os candidatos em vez de escolher o primeiro: a mesma folha costuma ter carta topográfica, ortoimagem e a versão militar. |
| `editar` | o read-modify-write de um `PUT` de objeto inteiro. Ver abaixo. |
| `finalizados` / `rpcmtec` | o fechamento do mês. O primeiro é público (não gasta login); o segundo acha a **edição mensal** daquele ano/mês e pede o documento dela ao servidor, que já sabe montar o relatório inteiro (acervo, mapoteca e orçamento), em JSON, em PDF (`--pdf`) ou, com `--anuario`, o ODS do Anuário Estatístico. O CLI não remonta tabela nenhuma. |
| `dominio` | o dicionário dos ids. O acervo é todo dirigido por id numérico, e trocar 50k (code 2) por 250k (code 4) de cabeça já custou uma auditoria rodada na escala errada. |

Ficaram **fora** de propósito: a carga em si (o `prepare-upload` não transfere byte, e a cópia acontece fora da API), a mapoteca (é do `mapoteca_cli`), e qualquer verbo que precisasse de regra de negócio nova.

## O `editar`, e o modo de falha que ele tranca

Todo `PUT` do SCA sobrescreve o **objeto inteiro**: o controller monta um `UPDATE` com a lista fixa de colunas. Quem quer mudar um campo tem que ler o registro, trocar o campo e devolver o registro completo. Fazer isso à mão erra de três jeitos:

1. **mandar só o campo que mudou** → 400 nos obrigatórios, ou pior: o servidor grava o **default do schema** nos campos que têm default (`subtipo_produto_id` vira `null`, `palavras_chave` vira `[]`), em silêncio;
2. **copiar o GET direto para o PUT** → o `GET /acervo/versao/:id` chama o campo de `nome_versao` e o `PUT /produtos/versao` espera `nome`;
3. **copiar o GET de produto direto para o PUT** → o GET **não devolve** `subtipo_produto_id`, e o PUT o grava como `null`, apagando a identidade do produto (uma Carta Militar deixa de ser militar).

O `editar` lê, casa os nomes, aplica só o que você pediu, **recusa** quando a leitura não traz um campo que o PUT gravaria com default (o caso 3), valida contra o Joi vivo, mostra o diff e só então grava, exigindo `--confirmar` com o id.

O detector do caso 3 é derivado, não escrito à mão: ele compara as chaves que a leitura devolveu com os campos que o `describe()` marca como tendo `default`. Se o backend acrescentar um campo com default amanhã, o guardrail o cobre sozinho.

## O que mais o CLI protege

- **Validação local**: o corpo é conferido contra o Joi antes de sair da máquina, com o contrato do campo errado impresso junto. Pega inclusive o `.strict()` dos ids, que recusa `"9001"` onde espera `9001`.
- **Campo descartado em silêncio**: o servidor valida com `stripUnknown`, então campo com nome errado some sem erro. O CLI avisa. É a diferença entre "gravei" e "achei que gravei".
- **Ação irreversível**: exclusão, `mover-arquivos` e `renumerar-versoes` exigem `--confirmar` repetindo **os identificadores que a operação vai atingir**, lidos do próprio corpo. Confirmação que se digita sem olhar não é guardrail.
- **Segredo na saída**: `camadas_produto` devolve credencial de banco e `volumes listar` devolve caminho de rede. Os dois avisam para não gravar a saída em arquivo versionado.
- **429**: o servidor limita 200 requisições por minuto; o CLI traduz o 429 em "espere a janela virar e retome do ponto de parada", em vez de deixar parecer falha da rota.
- **Proxy**: o módulo `http` do Node não lê `HTTP_PROXY` do ambiente, e isso aqui é deliberado. O proxy da rede interna devolve 503 para IP interno, e já houve caso de isso ser lido como "o SCA está fora do ar".

## Ambiente

Nunca ponha senha na linha de comando. Catálogo das chaves no `env-guia.md` do vault.

| Variável | Para quê |
|---|---|
| `SCA_URL` | URL do backend, ex.: `http://IP:3015` (`SCA_SERVER` é alias aceito) |
| `SCA_USER` | login de admin |
| `SCA_SENHA` | senha (preferir a variável ao `--senha`) |
| `SCA_TOKEN` | JWT pronto, dispensa o login |

O token fica em cache em `~/.sca/sessao-<servidor>.json`, com validade lida do próprio JWT. Um arquivo por servidor, para não misturar a instância local com a de produção. `--sem-cache` desliga.

Acesso: sem login são apenas `/api` (health) e `/api/integracao/*`. Todo o resto exige **perfil no módulo acervo**, inclusive os GET de `/api/gerencia/dominio/*`: consulta lê, operador cataloga, gerente exclui. O administrador é global e passa em tudo. O cliente de auth padrão é `sca_web`; a lista de clientes aceitos é lida do `login_schema.js` do `server/`, não copiada.

## Testes

```bash
cd acervo_cli && npm test
```

Rodam com o `node:test` embutido, sem instalar nada. Os testes de schema rodam **contra os schemas reais do `server/`**, não contra mocks: o valor do CLI é não ter cópia do contrato, e testar com schema falso testaria justamente a cópia. Em troca, eles quebram quando o contrato do SCA muda, que é exatamente o alarme que se quer ter. Um deles confere que **toda operação da registry aponta uma chave que existe no módulo de schema**: se o `server/` renomear um schema, quebra aqui em vez de quebrar num 500 no meio de uma carga.

## Dependências

Nenhuma. Só o Node e o `server/` (de onde vêm o Joi, através dos próprios arquivos de schema, e os apelidos de domínio, através do `utils/domain_constants.js`). Isso é o que permite rodar o `acervo` num clone recém-baixado, sem `npm install` na pasta do CLI.

O `package.json` daqui declara `"type": "commonjs"` de propósito: a raiz do repositório é `"type": "module"`, e sem essa declaração o Node trataria estes arquivos como ESM e o `require` dos schemas falharia.

## Estrutura

```
acervo.js           roteador e mapa de ajuda
lib/args.js         parser de argumentos próprio (flag repetida vira array)
lib/config.js       ambiente, cliente de auth, caminho da sessão
lib/http.js         requisição, envelope, cache de token
lib/recursos.js     registry: recurso -> operações (rota, acesso, colunas, guardrail)
lib/schema.js       joi.describe() -> contrato legível; validação local
lib/regras.js       a prosa curada que o describe() não alcança
lib/dominios.js     apelido -> code, derivado do domain_constants.js do server/
lib/saida.js        TSV, tabela, JSON, --campos
comandos/           schema, api (registry), cobertura, produto, editar,
                    relatorio, dominio, sessao
```

## Replicar noutro sistema

O padrão veio do `orcamento_cli` (SCO) e é o mesmo aqui. O que muda por sistema é `lib/recursos.js` (a registry), `lib/regras.js` (a prosa) e os verbos de intenção; o resto é infraestrutura. Ver a página `agent-first` na wiki do vault.
