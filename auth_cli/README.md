# auth_cli

Interface de linha de comando de **identidade** do SCA (usuários, perfil por módulo, senha e histórico de acesso), desenhada para **agentes**.

Irmão do `acervo_cli`, do `mapoteca_cli` e do `orcamento_cli`: mesmo servidor, mesmo login, mesma sessão em cache. A diferença é que os outros três falam com um **módulo**, e este fala com a **plataforma**: quem é a pessoa, o que ela pode e quando ela entrou não pertence a acervo, mapoteca nem orçamento.

```
node auth_cli/auth.js --ajuda
```

## Por que existe

Existe desde **2026-08-02**, quando a autenticação veio para dentro do SCA e o Auth Server externo saiu de cena. Até ali `dgeo.usuario` era um espelho, o SCA não sabia validar uma senha e cadastrar gente era trabalho em dois sistemas. Hoje o hash mora em `dgeo.usuario.senha`, o login é local, e este CLI é o cliente de agente dessa feature.

## Os cinco princípios

**1. Nada de contrato copiado.** Campos, tipos, obrigatórios, filtros e regras entre campos saem do Joi vivo do `server/` em tempo de execução, via `describe()`. Não existe arquivo gerado nem catálogo em markdown para apodrecer. Se `usuario_schema.js` mudar, o `auth schema usuario` muda no mesmo commit. A lista de clientes de auth também não é copiada: ela sai do `.valid()` de `login/login_schema.js`, que desde a fusão é a **única** lista de clientes que existe no sistema.

**2. Prosa curada só para o que o `describe()` não alcança** (`lib/regras.js`). Forma vem do Joi; porquê vem da prosa ao lado.

**3. Saída compacta por padrão.** TSV recortado nas colunas que importam; `--json` devolve tudo, para encadear.

**4. Verbos de intenção, não espelho do CRUD.** `auth usuario perfis` existe porque conceder acesso pela rota crua exige reenviar `administrador` e `ativo` (os dois são obrigatórios no `PUT`), e quem esquecer desativa alguém sem querer.

**5. O guardrail mora na interface**, não na skill que chama. Skill é de um cliente só; a interface serve todos.

## O guardrail: uuid não diz nada, nome diz

Este é o CLI de **maior raio de explosão** do SCA: o que se faz aqui vale nos três módulos de uma vez, e o servidor lê o banco a cada requisição (`verifyPerfil`), então desativar alguém tem efeito no mesmo segundo.

Por isso toda operação em **lote** (e a irreversível) resolve os `uuid` para **nome** antes de pedir confirmação:

```
$ auth usuario resetar-senha --uuids U1,U2,U3
RESETAR A SENHA de 3 pessoa(s). A senha de cada uma passa a ser o LOGIN dela:

  1º Ten Silva (silva)   (3f2a...0001)   [ADMINISTRADOR]
  3º Sgt Souza (souza)   (3f2a...0002)
  ??? NAO ENCONTRADO   3f2a...0009

Com todas as letras: depois disto, quem souber o login de uma destas
pessoas entra na conta dela. ...

Nao confirmado. Para executar, informe a QUANTIDADE em --confirmar:
  auth usuario resetar-senha --uuids U1,U2,U3 --confirmar 3
```

Três detalhes deliberados:

- A confirmação de lote é a **quantidade**, e não um "sim": obriga a olhar quantos são, e um `--confirmar` copiado de outro comando não passa por acidente. A do `excluir` é o próprio uuid repetido.
- `??? NAO ENCONTRADO` (consultei e não existe) e `(nao verificado)` (não consegui consultar) são **casos distintos** na saída. Confundir os dois faria o CLI afirmar um fato que ele não apurou.
- O reset diz, **com todas as letras**, que a senha vira o login de cada pessoa. É a convenção herdada do Auth Server e mantida de propósito, mas confirmar sem saber disso é o modo típico de deixar contas abertas.

`auth usuario perfis` segue a mesma régua com um recorte: **conceder e subir** não pedem confirmação, **revogar e rebaixar** pedem, porque só esses tiram acesso.

## Uso

```bash
# contrato (não gasta rede nem credencial)
node auth_cli/auth.js schema            # lista os recursos
node auth_cli/auth.js schema usuario    # campos, tipos, obrigatórios e regras
auth usuario dominios                   # posto/graduação, módulos e níveis

# usuários (exigem ADMINISTRADOR)
auth usuario listar --sem-senha                  # quem não consegue entrar
auth usuario listar --modulo mapoteca --ativo true
auth usuario obter --uuid U
auth usuario criar --data '{"login":"fulano","senha":"...","nome":"Fulano de Tal",
  "nome_guerra":"Fulano","tipo_posto_grad_id":5,"administrador":false,"ativo":true,
  "perfis":{"acervo":1}}' --dry-run
auth usuario editar --uuid U --data '{"administrador": false, "ativo": false}'
auth usuario perfis --uuid U
auth usuario perfis --uuid U --conceder acervo=operador --conceder mapoteca=1
auth usuario perfis --uuid U --revogar orcamento --confirmar U
auth usuario resetar-senha --uuids U1,U2 --confirmar 2
auth usuario excluir --uuid U --confirmar U

# o próprio cadastro (basta estar logado)
auth usuario meu-perfil
auth usuario trocar-senha --senha-atual X --senha-nova Y

# acessos (exigem ADMINISTRADOR)
auth acessos resumo
auth acessos logados
auth acessos logins dia --total 30
auth acessos logins usuarios --total 30 --max 5

# sessão
auth status     # o SCA está no ar? há token em cache? sou administrador?
auth login      # autentica uma vez, guarda o token (~1h)
auth logout
```

## Ambiente

Nunca ponha senha na linha de comando.

| Variável | Para quê |
|---|---|
| `SCA_URL` | URL do backend, ex.: `http://IP:porta` (`SCA_SERVER` é alias aceito) |
| `SCA_USER` | login de administrador |
| `SCA_SENHA` | senha (preferir a variável ao `--senha`) |
| `SCA_TOKEN` | JWT pronto, dispensa o login |

O token fica em cache em `~/.sca/sessao-<servidor>.json`, com validade lida do próprio JWT. Um arquivo por servidor, para não misturar a instância local com a de produção. O diretório é o do SCA, e não o deste CLI, de propósito: **um login serve todos os CLIs irmãos**. Por isso o `auth logout` diz que derruba a sessão deles junto. `--sem-cache` desliga.

## Acesso

Quase tudo aqui é **admin-only**, e isso é diferente dos CLIs irmãos: lá o que barra é a falta de perfil no módulo, aqui é a falta do **administrador global**, que não se resolve ganhando perfil em módulo nenhum. `/api/usuarios` e `/api/acessos` são rotas de plataforma, sem prefixo, guardadas por `verifyAdmin`.

As exceções, que bastam login: `auth usuario meu-perfil`, `auth usuario trocar-senha` e o domínio `tipo_posto_grad`.

**Não há comando de aplicação.** O catálogo `dgeo.aplicacao` do Auth Server não veio na fusão, por decisão do chefe: a lista de clientes é fechada (`sca_web`, `sca_qgis`) e vive no Joi do login. Um CRUD de catálogo de duas linhas seria administração inventada, e o teste `schema.test.js` reprova o dia em que alguém acrescentar o recurso.

## O que o CLI protege

- **Validação local**: o corpo é conferido contra o Joi antes de sair da máquina, com as mesmas opções do middleware do servidor (`stripUnknown: true`). Corpo torto falha em milissegundos, com o contrato do campo errado impresso junto.
- **Campo descartado em silêncio**: o servidor valida com `stripUnknown`, então `perfil` (em vez de `perfis`) some sem erro e a resposta é 200, e a pessoa nasceria sem acesso nenhum sem ninguém saber. O CLI avisa.
- **Segredo nunca sai na saída**: `senha`, `senha_atual`, `senha_nova` e `token` viram `***` no formatador, inclusive no eco do `--dry-run`. A saída de um CLI de agente vai para transcrição e log. `senha_definida` continua visível, porque é um booleano derivado e é justamente a resposta que se procura.
- **A recusa do servidor chega inteira**: `DELETE /usuarios/:uuid` quase sempre volta 400 dizendo para **desativar** em vez de excluir (a FK protege quem já trabalhou no sistema), e há a trava do último administrador ativo. As duas frases dizem o que fazer; trocar qualquer uma por "não foi possível excluir" seria substituir a instrução pelo código de status. O CLI mostra a mensagem literal e ainda oferece o comando de desativar.
- **`administrador` e `ativo` reenviados intactos** no verbo `perfis`: são obrigatórios no `PUT`, e chutá-los mudaria o acesso da pessoa sem ninguém pedir. Se a listagem não responder, o comando **recusa agir** em vez de adivinhar.
- **429**: o SCA limita 200 requisições por minuto. O CLI traduz numa mensagem que manda retomar do ponto de parada.

## Divergências entre o contrato do servidor e o que o CLI precisaria

Anotadas aqui, e não contornadas em silêncio. Nenhuma é bloqueante.

1. **Não existe `GET /usuarios/:uuid`.** `auth usuario obter --uuid U` lê a listagem inteira e recorta a pessoa, e **anuncia** que fez isso. É barato (dezenas de linhas) e honesto; a alternativa seria anunciar uma rota que não existe. Se um dia a rota surgir, o verbo troca de caminho e a saída perde o aviso.
2. **`GET /usuarios` não aceita filtro de query nenhum.** Os filtros `--ativo`, `--admin`, `--sem-senha` e `--modulo` são peneira no **cliente**, e o CLI avisa sempre que reduziu a lista. Inventar `?ativo=true` seria contrato copiado do lado errado.
3. **Não há rota que mexa só em perfil.** Perfil vai pelo `PUT /usuarios/:uuid`, que exige `administrador` e `ativo` no mesmo corpo. É de onde vem o guardrail do item anterior. Uma rota `PUT /usuarios/:uuid/perfis` tornaria o verbo `perfis` uma chamada só, sem leitura prévia.
4. **`POST /usuarios/senha/reset` responde `{ total }`, sem dizer quem.** O CLI mostra os nomes que ele mesmo resolveu antes de confirmar, então a saída fica completa, mas a resposta do servidor sozinha não permitiria conferir.
5. **`GET /usuarios` não devolve `id`**, só `uuid` (e está certo: `uuid` é a chave pública). Registros de outros CLIs que listam `id` na coluna padrão do recurso `usuario` simplesmente não a encontram.
6. **`dgeo.login` não é exposta linha a linha**, só agregada (`/acessos/*`). Não há como perguntar "quando esta pessoa entrou pela última vez" fora do painel de logados de hoje.

## Testes

```bash
cd auth_cli && npm test
# ou, junto com os CLIs irmãos, da raiz:
npm run test-cli
```

Rodam com o `node:test` embutido, sem instalar nada. Os testes de schema rodam **contra os schemas reais do `server/`**, não contra mocks: o valor do CLI é não ter cópia do contrato, e testar com schema falso testaria justamente a cópia. Em troca, eles quebram quando o contrato de identidade muda, que é o alarme que se quer ter.

`__tests__/usuario.test.js` cobre o guardrail, e o alvo dele é a **decisão**, não o transporte: as listagens entram por dependência injetada (o terceiro argumento de `executar`) e as duas requisições de escrita que importam para a saída são trocadas no próprio módulo `http`. Nada sobe servidor.

Três testes existem como trava de regressão de decisão, e não de código: nenhuma rota de identidade pode ganhar prefixo de módulo; o `PUT` não pode ganhar `default` em campo nenhum (isso apagaria o cadastro de quem só foi ativado); e não pode aparecer um recurso `aplicacao`.

## Dependências

Nenhuma. Só o Node e o `server/`, de onde vem o Joi através dos próprios arquivos de schema. Isso é o que permite rodar o `auth` num clone recém-baixado, sem `npm install` na pasta do CLI.

## Estrutura

```
auth.js             roteador e mapa de ajuda
lib/args.js         parser de argumentos próprio (flag repetida vira array)
lib/config.js       ambiente, cliente do auth, caminho da sessão
lib/http.js         requisição, envelope, cache de token
lib/recursos.js     registry: rota real, nível de acesso, colunas, guardrail
lib/schema.js       joi.describe() -> contrato legível; validação local
lib/regras.js       a prosa curada que o describe() não alcança
lib/saida.js        TSV, tabela, JSON, --campos, máscara de segredo
comandos/           usuario, acessos, schema, sessao
```

A forma é a do `acervo_cli`, e não a do `orcamento_cli`: identidade também **não** é CRUD uniforme. `POST /usuarios/senha/reset` e `PUT /usuarios` (lote) são operações nomeadas, e o próprio cadastro vive em `/usuarios/perfil`, que é outra rota com outra guarda. Fingir `listar/obter/criar/atualizar/deletar` produziria um mapa mentiroso.
