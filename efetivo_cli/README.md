# efetivo_cli

Interface de linha de comando de **identidade** e de **efetivo** do SAP, desenhada para **agentes**. Duas perguntas e o mesmo dono do dado (a pessoa); a guarda deixou de ser a mesma na 1.33.0, e a seção **Acesso** a detalha:

| Pergunta | O que responde |
|---|---|
| quem é, e o que pode | usuário, perfil por módulo, senha, histórico de acesso |
| quem esteve na Divisão | passagem pela DGEO (período) e impedimento |

Irmão do `acervo_cli`, do `mapoteca_cli` e do `orcamento_cli`: mesmo servidor, mesmo login, mesma sessão em cache. A diferença é que os outros três falam com um **módulo**, e este fala com a **plataforma**: nada disso pertence a acervo, mapoteca nem orçamento.

```
node efetivo_cli/efetivo.js --ajuda
```

## Por que existe

A autenticação é do próprio SAP: o hash mora em `dgeo.usuario.senha`, o login é local, e não há serviço externo. O efetivo se amarra ao mesmo `dgeo.usuario`, e por isso mora aqui, e não num CLI à parte: quem esteve na Divisão é dado de **pessoal**, nominal, e guardado inclusive na leitura. O que guarda deixou de ser o `verifyAdmin` do histórico de acesso: desde a 1.33.0 é o módulo **Efetivo** (code 5), com a régua da seção **Acesso**.

## Os cinco princípios

**1. Nada de contrato copiado.** Campos, tipos, obrigatórios, filtros e regras entre campos saem do Joi vivo do `server/` em tempo de execução, via `describe()`. Não existe arquivo gerado nem catálogo em markdown para apodrecer. Se `usuario_schema.js` mudar, o `efetivo schema usuario` muda no mesmo commit. Vale igual para o efetivo: `efetivo schema efetivo` sai do `efetivo_schema.js` do servidor. A lista de clientes de auth também não é copiada: ela sai do `.valid()` de `login/login_schema.js`, a **única** lista de clientes que existe no sistema.

**2. Prosa curada só para o que o `describe()` não alcança** (`lib/regras.js`). Forma vem do Joi; porquê vem da prosa ao lado.

**3. Saída compacta por padrão.** TSV recortado nas colunas que importam; `--json` devolve tudo, para encadear.

**4. Verbos de intenção, não espelho do CRUD.** `efetivo usuario perfis` existe porque conceder acesso pela rota crua exige reenviar `administrador` e `ativo` (os dois são obrigatórios no `PUT`), e quem esquecer desativa alguém sem querer.

**5. O guardrail mora na interface**, não na skill que chama. Skill é de um cliente só; a interface serve todos.

## O guardrail: uuid não diz nada, nome diz

Este é o CLI de **maior raio de explosão** do SAP: o que se faz aqui vale em todos os módulos de uma vez (são sete em `dominio.modulo`: acervo, mapoteca, orçamento, PIT, efetivo, equipamento e produção), e o servidor lê o banco a cada requisição (`verifyPerfil`), então desativar alguém tem efeito no mesmo segundo.

Por isso toda operação em **lote** (e a irreversível) resolve os `uuid` para **nome** antes de pedir confirmação:

```
$ efetivo usuario resetar-senha --uuids U1,U2,U3
RESETAR A SENHA de 3 pessoa(s). A senha de cada uma passa a ser o LOGIN dela:

  1º Ten Silva (silva)   (3f2a...0001)   [ADMINISTRADOR]
  3º Sgt Souza (souza)   (3f2a...0002)
  ??? NAO ENCONTRADO   3f2a...0009

Com todas as letras: depois disto, quem souber o login de uma destas
pessoas entra na conta dela. ...

Nao confirmado. Para executar, informe a QUANTIDADE em --confirmar:
  efetivo usuario resetar-senha --uuids U1,U2,U3 --confirmar 3
```

Três detalhes deliberados:

- A confirmação de lote é a **quantidade**, e não um "sim": obriga a olhar quantos são, e um `--confirmar` copiado de outro comando não passa por acidente. A do `excluir` é o próprio uuid repetido.
- `??? NAO ENCONTRADO` (consultei e não existe) e `(nao verificado)` (não consegui consultar) são **casos distintos** na saída. Confundir os dois faria o CLI afirmar um fato que ele não apurou.
- O reset diz, **com todas as letras**, que a senha vira o login de cada pessoa. É a convenção herdada do Auth Server e mantida de propósito, mas confirmar sem saber disso é o modo típico de deixar contas abertas.

`efetivo usuario perfis` segue a mesma régua com um recorte: **conceder e subir** não pedem confirmação, **revogar e rebaixar** pedem, porque só esses tiram acesso.

## Uso

```bash
# contrato (não gasta rede nem credencial)
node efetivo_cli/efetivo.js schema            # lista os recursos
node efetivo_cli/efetivo.js schema usuario    # campos, tipos, obrigatórios e regras
efetivo usuario dominios                   # posto/graduação, módulos e níveis

# usuários (exigem ADMINISTRADOR)
efetivo usuario listar --sem-senha                  # quem não consegue entrar
efetivo usuario listar --modulo mapoteca --ativo true
efetivo usuario obter --uuid U
efetivo usuario criar --data '{"login":"fulano","senha":"...","nome":"Fulano de Tal",
  "nome_guerra":"Fulano","tipo_posto_grad_id":5,"administrador":false,"ativo":true,
  "perfis":{"acervo":1}}' --dry-run
efetivo usuario editar --uuid U --data '{"administrador": false, "ativo": false}'
efetivo usuario perfis --uuid U
efetivo usuario perfis --uuid U --conceder acervo=operador --conceder mapoteca=1
efetivo usuario perfis --uuid U --revogar orcamento --confirmar U
efetivo usuario resetar-senha --uuids U1,U2 --confirmar 2
efetivo usuario excluir --uuid U --confirmar U

# o próprio cadastro (basta estar logado)
efetivo usuario meu-perfil
SCA_SENHA_ATUAL=... SCA_SENHA_NOVA=... efetivo usuario trocar-senha

# acessos (exigem ADMINISTRADOR)
efetivo acessos resumo
efetivo acessos logados
efetivo acessos logins dia --total 30
efetivo acessos logins usuarios --total 30 --max 5

# efetivo (LER pede consulta no módulo Efetivo; ESCREVER pede gerente)
efetivo mapa --ano 2026            # o mapa por semana, mais o fechamento do ano
efetivo mes --ano 2026 --mes 7     # o aproveitamento do mês (a 6.1 do RPCMTec)
efetivo periodos --ano 2026        # as passagens pela DGEO
efetivo periodos criar --data '{"usuario_uuid":"U","data_inicio":"2026-01-05"}'
efetivo periodos editar --id 12 --data '{"data_inicio":"2026-01-05","data_fim":"2026-12-20"}'
efetivo periodos excluir --id 12 --confirmar 12
efetivo impedimentos --ano 2026
efetivo impedimentos criar --data '{"usuario_uuid":"U","descricao":"Curso na EsIMEx",
  "percentual":100,"data_inicio":"2026-03-01","data_fim":"2026-06-30"}'
efetivo impedimentos editar --id 30 --data '{"descricao":"...","percentual":50,
  "data_inicio":"2026-03-01"}'
efetivo impedimentos excluir --id 30 --confirmar 30

# sessão
efetivo status     # o SAP está no ar? há token em cache? sou administrador?
efetivo login      # autentica uma vez, guarda o token (~1h)
efetivo logout
```

## Ambiente

Nunca ponha senha na linha de comando.

| Variável | Para quê |
|---|---|
| `SCA_URL` | URL do backend, ex.: `http://IP:porta` (`SCA_SERVER` é alias aceito) |
| `SCA_USER` | login de administrador |
| `SCA_SENHA` | senha (preferir a variável ao `--senha`) |
| `SCA_TOKEN` | JWT pronto, dispensa o login |

O token fica em cache em `~/.sca/sessao-<servidor>.json`, com validade lida do próprio JWT. Um arquivo por servidor, para não misturar a instância local com a de produção. O diretório é o do SAP, e não o deste CLI, de propósito: **um login serve todos os CLIs irmãos**. Por isso o `efetivo logout` diz que derruba a sessão deles junto. `--sem-cache` desliga.

## Acesso

As três áreas são rotas de plataforma, sem prefixo de módulo, e a guarda **não é a mesma nas três** desde a 1.33.0. A tabela abaixo é o que o `server/` declara hoje, depois da régua de 2026-08-08:

| Área | Guarda |
|---|---|
| `/api/usuarios` e `/api/acessos` | `verifyAdmin` (administrador global) |
| `/api/efetivo/mapa`, `/mes`, `/divergencias`, `/militares` | `verifyPerfil('consulta', 'efetivo')` |
| `/api/efetivo/periodos` e `/impedimentos`, no **GET** | `verifyPerfil('consulta', 'efetivo')` |
| `/api/efetivo/periodos` e `/impedimentos`, ao **escrever** | `verifyPerfil('gerente', 'efetivo')` |
| `/api/efetivo/meu_aproveitamento`, `/meu_periodo`, `/meu_impedimento` | `verifyAcesso` (perfil em algum módulo) |

O módulo **Efetivo** (`dominio.modulo` code 5) nasceu na 1.33.0 para haver como dar menos que a flag global: até ali `/api/efetivo` era `verifyAdmin` nas dez rotas, e 5 das 7 contas que trabalhavam no sistema eram administradoras (medido em 2026-08-06). O administrador global continua passando em tudo.

**A régua de 2026-08-08 deslocou as dez rotas nos dois sentidos, e nenhuma ficou onde estava.** A leitura **desceu para consulta**, porque até ali ninguém conseguia olhar o aproveitamento da Divisão sem poder também escrevê-lo. A escrita **subiu para gerente**, porque lançar a passagem e o impedimento **de outra pessoa** é dizer o número que a subseção 6.1 do RPCMTec publica sobre terceiros. A guarda continua valendo **inclusive na leitura** (a resposta traz licença de saúde e função acumulada, nominalmente); o que mudou foi o nível, não o princípio.

O operador de Efetivo passou a cuidar do **próprio** aproveitamento, por nove rotas que vivem no recurso **`meu`**: `/efetivo/meu_aproveitamento`, `/efetivo/meu_periodo` e `/efetivo/meu_impedimento`. Elas são `verifyAcesso`, e não `verifyPerfil`, porque declarar o próprio impedimento é obrigação de quem está na Divisão e não trabalho do módulo; o dono sai do **token** e nunca do corpo, e o `:id` de terceiro responde **404**, não 403, para não confirmar que o registro existe.

**`meu` é recurso separado de `efetivo`, e não operações dentro dele.** O assunto é o mesmo (passagem e impedimento), mas o acesso não: lá é consulta ou gerente no módulo, aqui basta ter acesso. Num recurso só, `efetivo schema` teria de anunciar duas guardas para o mesmo assunto, e quem lesse escolheria a errada.

```
efetivo meu aproveitamento --ano 2026
efetivo meu periodo
efetivo meu periodo criar   --data '{"data_inicio": "2026-01-05"}'
efetivo meu impedimento criar --data '{"descricao": "LTSP", "percentual": 100, "data_inicio": "2026-03-02"}'
```

Repare que `usuario_uuid` **não** entra no corpo: o `meuPeriodo` e o `meuImpedimento` do Joi não a conhecem, e mandá-la vira chave desconhecida.

`/api/usuarios` e `/api/acessos` continuam **admin-only**, e isso é diferente dos CLIs irmãos: lá o que barra é a falta de perfil no módulo, aqui é a falta do **administrador global**, que não se resolve ganhando perfil em módulo nenhum.

As exceções, que bastam login (`verifyLogin`, a própria conta): `efetivo usuario meu-perfil`, `efetivo usuario trocar-senha` e o domínio `tipo_posto_grad`. **Login não é acesso**: quem não tem perfil em módulo nenhum alcança só essas três, e é isso que `verifyAcesso` separa de `verifyLogin`.

**Não há comando de aplicação.** Não existe catálogo de aplicação no SAP: a lista de clientes é fechada (`sap_web`, `sap_fp`, `sap_fg`, mais `sca_web` e `sca_qgis`, ainda aceitos enquanto houver cliente antigo no ar) e vive no Joi do login. Um CRUD de catálogo desse tamanho seria administração inventada, e o teste `schema.test.js` reprova o dia em que alguém acrescentar o recurso.

## O que o CLI protege

- **Validação local**: o corpo é conferido contra o Joi antes de sair da máquina, com as mesmas opções do middleware do servidor (`stripUnknown: true`). Corpo torto falha em milissegundos, com o contrato do campo errado impresso junto.
- **Campo descartado em silêncio**: o servidor valida com `stripUnknown`, então `perfil` (em vez de `perfis`) some sem erro e a resposta é 200, e a pessoa nasceria sem acesso nenhum sem ninguém saber. O CLI avisa.
- **Segredo nunca sai na saída**: `senha`, `senha_atual`, `senha_nova` e `token` viram `***` no formatador, inclusive no eco do `--dry-run`. A saída de um CLI de agente vai para transcrição e log. `senha_definida` continua visível, porque é um booleano derivado e é justamente a resposta que se procura.
- **A recusa do servidor chega inteira**: `DELETE /usuarios/:uuid` quase sempre volta 400 dizendo para **desativar** em vez de excluir (a FK protege quem já trabalhou no sistema), e há a trava do último administrador ativo. As duas frases dizem o que fazer; trocar qualquer uma por "não foi possível excluir" seria substituir a instrução pelo código de status. O CLI mostra a mensagem literal e ainda oferece o comando de desativar.
- **`administrador` e `ativo` reenviados intactos** no verbo `perfis`: são obrigatórios no `PUT`, e chutá-los mudaria o acesso da pessoa sem ninguém pedir. Se a listagem não responder, o comando **recusa agir** em vez de adivinhar.
- **429**: o SAP limita 200 requisições por minuto. O CLI traduz numa mensagem que manda retomar do ponto de parada.

## Divergências entre o contrato do servidor e o que o CLI precisaria

Anotadas aqui, e não contornadas em silêncio. Nenhuma é bloqueante.

1. **Não existe `GET /usuarios/:uuid`.** `efetivo usuario obter --uuid U` lê a listagem inteira e recorta a pessoa, e **anuncia** que fez isso. É barato (dezenas de linhas) e honesto; a alternativa seria anunciar uma rota que não existe. Se um dia a rota surgir, o verbo troca de caminho e a saída perde o aviso.
2. **`GET /usuarios` não aceita filtro de query nenhum.** Os filtros `--ativo`, `--admin`, `--sem-senha` e `--modulo` são peneira no **cliente**, e o CLI avisa sempre que reduziu a lista. Inventar `?ativo=true` seria contrato copiado do lado errado.
3. **Não há rota que mexa só em perfil.** Perfil vai pelo `PUT /usuarios/:uuid`, que exige `administrador` e `ativo` no mesmo corpo. É de onde vem o guardrail do item anterior. Uma rota `PUT /usuarios/:uuid/perfis` tornaria o verbo `perfis` uma chamada só, sem leitura prévia.
4. **`POST /usuarios/senha/reset` responde `{ total }`, sem dizer quem.** O CLI mostra os nomes que ele mesmo resolveu antes de confirmar, então a saída fica completa, mas a resposta do servidor sozinha não permitiria conferir.
5. **`GET /usuarios` não devolve `id`**, só `uuid` (e está certo: `uuid` é a chave pública). Registros de outros CLIs que listam `id` na coluna padrão do recurso `usuario` simplesmente não a encontram.
6. **`dgeo.login` não é exposta linha a linha**, só agregada (`/acessos/*`). Não há como perguntar "quando esta pessoa entrou pela última vez" fora do painel de logados de hoje.
7. **O efetivo não tem rota de obter por id.** `GET /efetivo/periodos` e `/efetivo/impedimentos` listam (com filtro opcional por ano), e o `:id` só aparece no `PUT` e no `DELETE`. Para conferir um registro antes de editar, liste o ano e recorte.
8. **O `PUT` de período e de impedimento não aceita trocar o militar**, e está certo: trocá-lo reescreveria de quem é o período. Corrigir a pessoa é excluir e cadastrar de novo, e o CLI diz isso na nota da operação.
9. **`GET /efetivo/divergencias` e `GET /efetivo/militares` também ficaram de fora.** As duas são `verifyPerfil('consulta', 'efetivo')`: a primeira lista conta ativa sem passagem pela DGEO no mês, e a segunda é o cadastro mínimo de militar que a tela usa para o seletor (sem `login`, `administrador`, `senha_definida` nem perfis, que continuam exclusivos de `/api/usuarios`).
10. **`GET /efetivo/mes` aceita `formato=json|csv`** (`anoMesRelatorioQuery`), e a registry ainda aponta `anoMesQuery`, que não conhece a chave. Consequência: `--formato csv` não chega à rota. Não é erro de guarda nem de rota, e sim contrato apontado com uma chave a menos.

## Regras do efetivo que o Joi não conta

- **É intervalo, não lançamento por mês.** Gravam-se os fatos (passagem e impedimento, cada um com início e fim); mês, semana e ano são **consulta** sobre eles. Por isso não existe verbo de "lançar o mês": isso seria gravar a conta em vez do fato.
- **Passagem não sobrepõe**, e quem cobra é um `EXCLUDE` no banco. **Impedimento sobrepõe**, e os percentuais somam até 100.
- **`data_fim` nula é "sem previsão de saída"**, o caso comum de quem está na Divisão agora, e não um cadastro pela metade.
- **`descricao` do impedimento vale o que TIRA a pessoa do trabalho da Divisão** (curso fora, licença, missão), nunca o que ela faz aqui.
- **`percentual` vai de 1 a 100**: zero seria um impedimento que não impede.
- **Excluir é definitivo** (não há tabela de deletados) e muda o número de todo mês e semana que o período cobria, no mapa e na subseção 6.1 do RPCMTec. Por isso `excluir` exige `--confirmar` com o id.

## Testes

```bash
cd efetivo_cli && npm test
# ou, junto com os CLIs irmãos, da raiz:
npm run test-cli
```

Rodam com o `node:test` embutido, sem instalar nada. Os testes de schema rodam **contra os schemas reais do `server/`**, não contra mocks: o valor do CLI é não ter cópia do contrato, e testar com schema falso testaria justamente a cópia. Em troca, eles quebram quando o contrato de identidade muda, que é o alarme que se quer ter.

`__tests__/usuario.test.js` cobre o guardrail de identidade e `__tests__/efetivo.test.js` o de efetivo. O alvo dos dois é a **decisão**, não o transporte: as listagens entram por dependência injetada (o terceiro argumento de `executar`) e as requisições de escrita que importam para a saída são trocadas no próprio módulo `http`. Nada sobe servidor.

Alguns testes existem como trava de regressão de **decisão**, e não de código: nenhuma rota de identidade pode ganhar prefixo de módulo; o `PUT` não pode ganhar `default` em campo nenhum (isso apagaria o cadastro de quem só foi ativado); não pode aparecer um recurso `aplicacao`; nenhuma rota de efetivo pode se anunciar com menos que perfil no módulo Efetivo (ler em consulta, escrever em gerente); e o `PUT` de período não pode passar a aceitar `usuario_uuid`.

## Dependências

Nenhuma. Só o Node e o `server/`, de onde vem o Joi através dos próprios arquivos de schema. Isso é o que permite rodar o `efetivo` num clone recém-baixado, sem `npm install` na pasta do CLI.

## Estrutura

```
efetivo.js             roteador e mapa de ajuda
lib/args.js         parser de argumentos próprio (flag repetida vira array)
lib/config.js       ambiente, cliente de auth, caminho da sessão
lib/http.js         requisição, envelope, cache de token
lib/recursos.js     registry: rota real, nível de acesso, colunas, guardrail
lib/schema.js       joi.describe() -> contrato legível; validação local
lib/regras.js       a prosa curada que o describe() não alcança
lib/saida.js        TSV, tabela, JSON, --campos, máscara de segredo
comandos/           usuario, acessos, efetivo, schema, sessao
```

A forma é a do `acervo_cli`, e não a do `orcamento_cli`: identidade também **não** é CRUD uniforme. `POST /usuarios/senha/reset` e `PUT /usuarios` (lote) são operações nomeadas, e o próprio cadastro vive em `/usuarios/perfil`, que é outra rota com outra guarda. Fingir `listar/obter/criar/atualizar/deletar` produziria um mapa mentiroso.

O recurso `efetivo` tem o mesmo nome do programa, e os verbos dele são de primeiro nível (`efetivo periodos criar`). Por isso o contrato não repete a chave ali: a linha impressa é a que se digita, e `efetivo efetivo periodos criar` não é comando nenhum.
