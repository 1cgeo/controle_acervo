# equipamento_cli

Interface de linha de comando do módulo **Equipamento** do SAP, desenhada para **agentes**.

O client web serve humanos, o `equipamento_cli` serve agentes. São dois clientes da mesma API, com ergonomias diferentes de propósito: a tela otimiza clique e descoberta visual, o CLI otimiza contexto e encadeamento.

```
node equipamento_cli/equipamento.js --ajuda
```

## Por que existe

O módulo equipamento é o parque de material da Divisão (estação total, GNSS, plotter, drone). Ele responde três perguntas: o que temos, em que situação cada bem está **hoje**, e o que já aconteceu com ele. Um agente que opera isso pela API crua paga quatro impostos.

1. Precisa de um catálogo de rotas escrito à mão para descobrir os campos de uma manutenção.
2. Recebe a ficha inteira de um bem com quatro históricos quando queria seis colunas.
3. Descobre pelo 400 que `data_fim` não pode ser anterior a `data_inicio`, que `valor` não aceita zero e que `situacao_id` não existe no corpo do bem.
4. Fecha uma indisponibilidade mandando `{"data_fim": "..."}` e apaga o motivo, a previsão e a data de início, porque o `PUT` deste módulo **substitui a linha inteira**.

O CLI existe para zerar os quatro. O quarto é o caro.

## Os quatro princípios

**1. Nada de contrato copiado.** Campos, tipos, obrigatórios, limites, defaults e as mensagens de erro em português saem do Joi vivo de `server/src/equipamento/equipamento_schema.js`, em tempo de execução, via `describe()`. Não existe arquivo gerado, catálogo em markdown nem documentação paralela para apodrecer. Coluna nova no schema vira flag aceita no mesmo commit.

**2. Prosa curada só para o que o `describe()` não alcança.** O `describe()` não enxerga os comentários dos `*_schema.js` e dos `*_ctrl.js`, e é aí que mora o porquê (que a situação é derivada, que a vida útil da planilha está em anos e a daqui em meses). Por isso `lib/regras.js` guarda a prosa curada, curta, só do que o Joi não sabe dizer. **Forma vem do Joi; porquê vem da prosa ao lado.**

**3. Saída compacta por padrão.** O consumidor tem janela finita. O padrão é TSV recortado nas colunas que importam; `--json` continua devolvendo tudo, para quem vai encadear.

**4. O guardrail mora na interface.** O ciclo ler-mesclar-reenviar, a validação local, o `--dry-run` e a confirmação de exclusão ficam aqui, não na skill que chama. Skill é de um cliente só; a interface serve todos.

## Uso

```bash
# contrato (não gasta rede nem credencial)
equipamento schema                    # os recursos e as regras gerais
equipamento schema manutencao         # campos, tipos, obrigatórios e regras
equipamento dominio                   # os códigos que entram nos campos *_id

# o parque
equipamento listar
equipamento listar --situacao_id 4 --secao_detentora_id 1
equipamento listar --ativo false      # os bens baixados
equipamento ver --id 12
equipamento ver --patrimonio 104820700014462
equipamento dashboard                 # o retrato de hoje, em seis blocos
equipamento relatorio dmt --para relatorio_dmt.ods

# o que acontece com o bem
equipamento indisponibilidade listar --aberta
equipamento indisponibilidade abrir --equipamento_id 7 \
    --data_inicio 2026-07-17 --motivo "Erro de firmware" --previsao_retorno 2026-12-31
equipamento indisponibilidade fechar --id 12 --data_fim 2026-08-08
equipamento afastamento abrir --equipamento_id 30 --om "3º BPE" \
    --motivo "Apoio a operação" --data_inicio 2026-04-09
equipamento manutencao abrir --equipamento_id 59 --data_inicio 2026-05-11 \
    --indisponibilidade_id 8 --valor_orcado 600 --valor_pdr 600 --certame "Contrata+Brasil"
equipamento transferencia lancar --equipamento_id 59 --tipo_id 3 --situacao_id 1
equipamento transferencia editar --id 4 --situacao_id 3 --transferido_siafi

# a carga (gerente)
equipamento cadastrar --nr_patrimonio 104821500017688 --classe_id 6 --tipo_id 6 \
    --modelo "HP Latex 335" --secao_detentora_id 1
equipamento alterar --id 12 --nr_serie ABC123
equipamento baixar --id 12            # dá BAIXA no bem (ativo = false)

# tipo de equipamento (é cadastro, não domínio)
equipamento tipo listar
equipamento tipo cadastrar --nome "Estação Total" --vida_util_meses 120

# sessão
equipamento status
equipamento login
```

## Como se monta um corpo

Duas portas, e a segunda vence a primeira:

```bash
equipamento manutencao abrir --data '{"equipamento_id":59,"data_inicio":"2026-05-11"}'
equipamento manutencao abrir --equipamento_id 59 --data_inicio 2026-05-11
```

As flags `--<campo>` **saem do schema**: os nomes aceitos são exatamente as chaves do Joi daquela ação, e uma flag que não é campo nem filtro vira aviso em vez de sumir. Campo booleano aceita a flag sozinha (`--transferido_siafi` quer dizer `true`), e `--<campo> null` limpa o campo, que é a única forma de esvaziar uma coluna num `PUT` que substitui a linha.

## O que o CLI protege

- **A armadilha do PUT.** O `PUT` deste módulo substitui a linha inteira. `alterar`, `editar` e `fechar` **leem o registro, aplicam o que muda e reenviam o corpo completo**, e imprimem o antes e o depois de cada campo antes de gravar. Não existe corpo parcial aqui.
- **Default é valor, não ausência.** `ativo` (default `true`), `transferido_siafi` e `apropriado_siafi` (default `false`) são gravados mesmo quando ninguém os digita: num `PUT`, omitir é **reverter**. O CLI lista quais campos o default preencheu, sempre, e o contrato marca cada um deles.
- **A herança da vida útil.** A leitura devolve `vida_util_meses` já resolvido por `COALESCE(bem, tipo)`, com `vida_util_herdada` dizendo de onde veio. Reenviar esse número materializaria a herança, e o bem deixaria de acompanhar o tipo, sem nada acusar (o valor gravado seria igual ao que a tela mostrava). O `alterar` reenvia nulo e avisa; só um `--vida_util_meses` explícito rompe a herança.
- **Vida útil em MESES.** É como o dado é guardado. A planilha da Seção traz a coluna em **anos**: 10 lá são 120 aqui, e digitar 10 cadastra dez meses sem erro nenhum na hora.
- **A situação não se escreve.** Ela é derivada do dia por `equipamento.situacao_em(CURRENT_DATE)`, na escada 10 Disponível, 20 Afastado, 30 Em manutenção, 40 Indisponível, 50 Baixado. Não há campo, e o contrato diz isso em vez de deixar procurar.
- **Validação local**: o corpo é conferido contra o Joi antes de sair da máquina, com o contrato do campo errado impresso junto. As mensagens em português do schema (`A data de fim deve ser igual ou posterior à data de início`) aparecem no contrato **e** no erro local, sem gastar um round-trip.
- **Campo recusado, não descartado**: o módulo usa o validador estrito, então chave desconhecida volta 400. O CLI a pega antes, local, e diz qual é.
- **Data que grava o dia anterior**: o servidor devolve as datas como timestamp ISO e o schema as regrava cruas numa coluna `DATE`. Todo reenvio passa pelo recorte para `AAAA-MM-DD`.
- **Colunas que a leitura acrescenta**: a ficha e as listas trazem `nr_patrimonio`, `modelo` e o nome resolvido dos domínios, que o corpo não aceita. O recorte para os campos do schema é feito antes de reenviar.
- **Exclusão irreversível**: `apagar` exige `--confirmar` com o mesmo id, e lembra que bem que saiu da carga se **baixa**, não se apaga.
- **`baixar` não é download.** Aqui é dar baixa no bem (`ativo = false`). O download do Relatório DMT é `equipamento relatorio dmt`, e o comando recusa `--para` para não deixar a confusão passar.
- **Transferência não tem `fechar`.** Ela não dura, se resolve: o comando explica isso e manda mudar a situação, em vez de inventar um campo.
- **Limite de requisições**: o SAP corta em 200 por minuto, e o 429 vem com a instrução de retomar do ponto de parada.

### Sobre o `--dry-run`

É **offline** (não toca a rede, não usa credencial, não precisa de `SCA_URL`) em `cadastrar`, `abrir`, `lancar` e nos `apagar` por id.

As exceções são `alterar`, `baixar`, `editar` e `fechar`, que fazem um **GET** para montar o corpo completo antes de mostrá-lo. Eles avisam isso na saída, e cobram a URL do servidor mesmo com a flag. Nenhuma escrita ocorre.

Como o `--dry-run` não escreve, ele **não** exige `--confirmar`: é ele que mostra o que a confirmação autorizaria.

## Ambiente

Nunca ponha senha na linha de comando.

| Variável | Para quê |
|---|---|
| `SCA_URL` | URL do backend do SAP (`SCA_SERVER` é aceito como sinônimo) |
| `SCA_USER` | login no SAP |
| `SCA_SENHA` | senha (preferir a variável ao `--senha`) |
| `SCA_TOKEN` | JWT pronto, dispensa o login |

O token fica em cache em `~/.sca/sessao-<servidor>.json`, com validade lida do próprio JWT. Um arquivo por servidor, para não misturar instâncias; e no diretório do SAP, não do equipamento, porque o token vale para a API inteira e os CLIs irmãos reaproveitam a mesma sessão. `--sem-cache` desliga.

O acesso é por **perfil** no módulo `equipamento`:

| perfil | alcança |
|---|---|
| consulta | o parque, a ficha, o Dashboard e o Relatório DMT |
| operador | o mesmo, mais lançar indisponibilidade, afastamento e manutenção |
| gerente | o mesmo, mais a carga (cria, altera, baixa e apaga o bem), a transferência e a Configuração inteira (o cadastro de tipo) |

O administrador passa em tudo. **O CLI não afrouxa nada**: quem recusa é o `verifyPerfil` do servidor, que lê o banco a cada requisição.

## Dependências

Nenhuma. Só o Node e o `server/` (de onde vem o Joi, através do próprio arquivo de schema). É o que permite rodar o `equipamento` num clone recém-baixado, sem `npm install` na pasta do CLI.

## Estrutura

```
equipamento.js       roteador e mapa de ajuda
lib/args.js          parser de argumentos próprio
lib/config.js        ambiente, cliente de auth, caminho da sessão
lib/http.js          requisição, envelope, cache de token, download binário
lib/recursos.js      registry: rota, perfil, forma do CRUD, colunas
lib/schema.js        joi.describe() -> contrato legível; validação local
lib/corpo.js         monta, mescla sobre o lido e confere o corpo de uma escrita
lib/registro.js      leitura de volta onde não há GET por id
lib/regras.js        a prosa curada que o describe() não alcança
lib/saida.js         TSV, tabela, JSON, --campos
comandos/            schema, dominio, bem, tipo, historico, painel, relatorio, sessao
```

Os quatro históricos (indisponibilidade, afastamento, manutenção, transferência) são **um** comando só, `comandos/historico.js`: eles compartilham a forma, e o que muda entre eles é dado declarado na registry. Quatro cópias divergiriam, e bastaria uma esquecer o ciclo ler-mesclar-reenviar para o defeito existir num canto e não no outro.

## Replicar noutro sistema

O padrão é portável entre os sistemas que compartilham a stack (Express, Joi, pg-promise, CommonJS). O que muda por sistema é `lib/recursos.js` (a registry), `lib/regras.js` (a prosa) e os verbos de intenção; o resto é infraestrutura.
