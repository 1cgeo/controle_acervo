# mapoteca_cli

Interface de linha de comando da **Mapoteca** do SCA, desenhada para **agentes**.

O `mapoteca_client` serve humanos, o `mapoteca_cli` serve agentes. São dois clientes da mesma API, com ergonomias diferentes de propósito: a tela otimiza clique e descoberta visual, o CLI otimiza contexto e encadeamento.

```
node mapoteca_cli/mapoteca.js --ajuda
```

## Por que existe

A mapoteca é o módulo de pedidos do SCA: um cliente (OM ou civil) pede cartas e a DGEO atende. Um agente que opera isso pela API crua paga quatro impostos.

1. Precisa carregar um catálogo de rotas escrito à mão para descobrir os campos de um pedido.
2. Recebe o JSON inteiro de um pedido com quarenta itens quando queria seis colunas.
3. Casa cada folha do documento com o acervo em duas chamadas por folha, sequenciais, e faz o casamento exato do MI do lado de fora.
4. Cadastrar um pedido são três rotas sem transação entre elas, com um id que precisa atravessar de uma para a outra.

O CLI existe para zerar os quatro.

## Os cinco princípios

**1. Nada de contrato copiado.** Campos, tipos, obrigatórios e condicionais saem do Joi vivo do `server/` em tempo de execução, via `describe()`. Não existe arquivo gerado, catálogo em markdown nem documentação paralela para apodrecer. Se `mapoteca_schema.js` mudar, o `mapoteca schema` muda no mesmo commit.

**2. Prosa curada só para o que o `describe()` não alcança.** O `describe()` não enxerga os comentários dos `*_schema.js` nem as decisões que o chefe tomou lendo documento de verdade, e é aí que mora o porquê (que duas linhas com o mesmo MI são um item só, por exemplo). Por isso `lib/regras.js` guarda a prosa curada, curta, só do que o Joi não sabe dizer. **Forma vem do Joi; porquê vem da prosa ao lado.** O que o Joi já diz não se repete lá.

**3. Saída compacta por padrão.** O consumidor tem janela finita. O padrão é TSV recortado nas colunas que importam; `--json` continua devolvendo tudo, para quem vai encadear.

**4. Verbos de intenção, não espelho do CRUD.** `pedido cadastrar`, `resolver`, `pedido situacao` e `pendentes` são o que o chefe realmente pede. Nenhum deles inventa regra de negócio nova: verbo que precisasse disso pertenceria ao backend, não a este CLI. O que eles fazem é encadear rotas que já existem e aplicar regras de resolução e de apresentação.

**5. O guardrail mora na interface.** Validação local, `--dry-run` offline e confirmação de ação irreversível ficam aqui, não na skill que chama. Skill é de um cliente só; a interface serve todos.

## Uso

```bash
# contrato (não gasta rede nem credencial)
mapoteca schema                  # lista os recursos e as regras gerais
mapoteca schema pedido           # campos, tipos, obrigatórios e regras do pedido
mapoteca dominio situacao_pedido # os codes que entram nos campos *_id

# resolver: o que o documento escreveu -> o que a API exige
mapoteca resolver 2962-4-NE 2963-1        # folha -> uuid_versao no acervo
mapoteca resolver --plano pedido.json     # resolve os MIs de um plano inteiro
mapoteca cliente resolver "6 RCB"         # sigla -> cliente_id, sem duplicar a OM

# cadastrar um pedido inteiro a partir de um plano
mapoteca pedido cadastrar --plano pedido.json --dry-run   # valida offline
mapoteca pedido cadastrar --plano pedido.json

# dia a dia
mapoteca pendentes --dias 15              # a fila, ordenada pelo prazo
mapoteca pedido itens --id 116            # só os itens, recortados
mapoteca pedido situacao --id 116 --situacao 5 --data-atendimento 2026-07-30
mapoteca pedido anexo baixar --id 7 --para conferir.pdf   # baixa e dá o sha256
mapoteca imprimir --item 881 --qtd 5      # registra a impressão de um item
mapoteca painel --ano 2026                # resumo do ano
mapoteca relatorio detalhado --ano 2026 --csv
mapoteca relatorio impressao --ano 2026 --ods   # a aba META4_DETALHADA
mapoteca anuario --ano 2026 --mes 7 --ods       # Anuário Estatístico (exige admin)

# material: o LIVRO escreve, o saldo só se lê
mapoteca movimento listar --tipo_movimento_id 3 --data_inicio 2026-07-01
mapoteca movimento criar --data '{"tipo_material_id":18,"tipo_movimento_id":3,"quantidade":2,"data_movimento":"2026-08-08","localizacao_origem_id":1}'
mapoteca estoque listar                   # o saldo de hoje, por localização

# CRUD, quando o verbo de intenção não cobre
mapoteca pedido listar --ano 2025 --campos id,prazo,cliente_nome
mapoteca pedido listar --ano 2026 --palavra_chave Extra-PIT   # etiqueta INTEIRA, com maiúscula
mapoteca cliente criar --data '{...}' --dry-run
mapoteca pedido deletar --ids 116 --confirmar 116

# sessão
mapoteca status    # o SCA está no ar? há token em cache?
mapoteca login     # autentica uma vez e guarda o token
```

## O plano de um pedido

`pedido cadastrar` executa um JSON único, revisável antes de gravar:

```json
{
  "cliente": {
    "nome": "6º Regimento de Cavalaria Blindado",
    "tipo_cliente_id": 1
  },
  "pedido": {
    "data_pedido": "2026-07-24",
    "situacao_pedido_id": 3,
    "documento_solicitacao": "DIEx 123-S/3",
    "documento_solicitacao_nup": "64536.000123/2026-11",
    "ponto_contato": "Cap MASSACANI, Chefe da 3ª Seção, (55) 99733-5177",
    "demandante": "6º RCB / 3ª Seção",
    "prazo": "2026-08-30"
  },
  "itens": [
    {
      "mi": "2962-4-NE",
      "nome": "Cerro da Glória",
      "uuid_versao": "3f2b1a9c-...",
      "quantidade": 5,
      "tipo_midia_id": 6
    }
  ],
  "anexos": [
    { "arquivo": "DIEx_123_6RCB.pdf", "tipo_anexo_id": 1 }
  ]
}
```

`mi` e `nome` são chaves **locais**: não vão ao servidor. O `nome` é o que o **documento** escreveu (nunca o do acervo), e é ele que permite ao `resolver` acusar divergência de nome. Se ele fosse preenchido com o nome do acervo, o detector ficaria calado.

Quem passa `pedido.cliente_id` dispensa o bloco `cliente`.

O comando é **idempotente**: rodá-lo de novo com o mesmo plano completa o que falta (o pedido é reconhecido pelo NUP, o item pelo `uuid_versao`, o anexo pelo nome do arquivo) em vez de duplicar.

## O que o CLI protege

- **Validação local**: o corpo é conferido contra o Joi antes de sair da máquina. Corpo torto falha em milissegundos, com o contrato do campo errado impresso junto, em vez de custar um round-trip e um 400 genérico.
- **Campo descartado em silêncio**: o servidor valida o corpo com `stripUnknown`, então campo com nome errado (`prazo_entrega` em vez de `prazo`) some sem erro. O CLI avisa. É a diferença entre "gravei" e "achei que gravei".
- **A armadilha do PUT**: o `PUT` da mapoteca vai na coleção, leva o id no **corpo** e **substitui a linha inteira**. Mandar só o campo que mudou zera todos os outros, calado. O CLI lista exatamente quais campos voltariam ao default antes de enviar, e o verbo `pedido situacao` faz o ciclo ler, alterar e reenviar por você.
- **Data que grava o dia anterior**: o servidor devolve as datas como timestamp ISO e o schema as regrava cruas numa coluna `DATE`. Num fuso a oeste de Greenwich isso grava `D-1`. Todo reenvio passa pelo recorte para `YYYY-MM-DD`.
- **Exclusão em lote e irreversível**: o `DELETE` sempre leva um array de ids, e excluir um pedido apaga todos os itens dele junto. Exige `--confirmar` com a mesma lista repetida; confirmar `42` quando se pediu `42,43` não passa.
- **Escrita em recurso derivado**: `estoque` é só leitura desde 2026-08-08, porque o saldo passou a ser o acumulado do livro de movimentos. `estoque criar` não monta corpo nenhum nem gasta requisição: responde que a escrita é em `movimento` e qual contrato ler.
- **MI ambíguo ou ausente**: o `resolver` nunca escolhe no escuro. Duas versões candidatas viram aviso e nenhuma escolha.
- **Duas linhas com o mesmo MI**: viram **um** item, com a quantidade de uma linha, nunca a soma (a duplicata é erro de cópia do solicitante, e imprimir o dobro é o erro caro). A fusão nunca é silenciosa: sai aviso e o rastro das duas linhas fica na observação do item.
- **Falha parcial**: não há transação entre criar o pedido, criar os itens e subir o anexo. Quando o anexo falha, o CLI diz explicitamente para não repetir o `cadastrar` e dá o comando de reenviar só o anexo.
- **Conferência lendo de volta**: as escritas releem o registro depois de gravar. A mensagem de sucesso do servidor não é prova de gravação.
- **Limite de requisições**: o SCA corta em 200 por minuto. Toda alça que faz várias chamadas em sequência respeita um intervalo entre elas.

### Sobre o `--dry-run`

É **offline** (não toca a rede, não usa credencial, não precisa de `SCA_URL`) em `criar`, `atualizar`, `deletar`, `pedido cadastrar`, `pedido anexar` e `imprimir`.

As exceções são `pedido situacao`, `pedido corrigir` e `item mover`, que fazem um **GET** para montar o corpo completo antes de mostrá-lo. Eles avisam isso na saída. Nenhuma escrita ocorre.

Como o `--dry-run` não escreve, ele **não** exige `--confirmar`: é ele que mostra o que a confirmação autorizaria.

## Ambiente

Nunca ponha senha na linha de comando. Catálogo das chaves no `env-guia.md` do vault.

| Variável | Para quê |
|---|---|
| `SCA_URL` | URL do backend do SCA (`MAPOTECA_SERVER` é aceito como sinônimo) |
| `SCA_USER` | login de admin no SCA |
| `SCA_SENHA` | senha (preferir a variável ao `--senha`) |
| `SCA_TOKEN` | JWT pronto, dispensa o login |

O token fica em cache em `~/.sca/sessao-<servidor>.json`, com validade lida do próprio JWT. Um arquivo por servidor, para não misturar a instância local com a de produção; e no diretório do SCA, não da mapoteca, porque o token vale para a API inteira. `--sem-cache` desliga.

O acesso é por **perfil** no módulo `mapoteca`: consulta lê (inclusive o livro de material), operador imprime e faz tudo de material (lança movimento, cadastra e conta), gerente cadastra pedido, cliente, item e anexo. O administrador passa em tudo. Públicos, sem login: `/api` (health), `/api/login` e a consulta por localizador. Os GET de domínio exigem perfil de consulta.

## Testes

```bash
cd mapoteca_cli && npm test
```

Rodam com o `node:test` embutido, sem instalar nada. Os testes de schema rodam **contra os schemas reais do `server/`**, não contra mocks: o valor do CLI é não ter cópia do contrato, e testar com schema falso testaria justamente a cópia. Em troca, eles quebram quando o contrato da mapoteca muda, que é exatamente o alarme que se quer ter.

Um dos testes amarra a registry ao schema: se a chave do corpo do `DELETE` divergir (`pedido_ids` de um lado, outra coisa do outro), a suíte falha antes de a produção falhar.

## Dependências

Nenhuma. Só o Node e o `server/` (de onde vem o Joi, através do próprio arquivo de schema). É o que permite rodar o `mapoteca` num clone recém-baixado, sem `npm install` na pasta do CLI.

## Estrutura

```
mapoteca.js         roteador e mapa de ajuda
lib/args.js         parser de argumentos próprio
lib/config.js       ambiente, cliente do auth, caminho da sessão
lib/http.js         requisição, envelope, cache de token, multipart, ritmo
lib/recursos.js     registry: rota, chaves do schema, forma do CRUD, colunas
lib/schema.js       joi.describe() -> contrato legível; validação local
lib/regras.js       a prosa curada que o describe() não alcança
lib/plano.js        valida e normaliza o plano de um pedido, sempre offline
lib/mi.js           normalização do MI como o documento o escreve
lib/saida.js        TSV, tabela, JSON, --campos
comandos/           schema, dominio, crud, pedido, resolver, relatorio, sessao
```

## Replicar noutro sistema

O padrão é portável entre os sistemas da DGEO que compartilham a stack (Express, Joi, pg-promise, CommonJS). O que muda por sistema é `lib/recursos.js` (a registry), `lib/regras.js` (a prosa) e os verbos de intenção; o resto é infraestrutura. Ver a página `agent-first` na wiki do vault.
