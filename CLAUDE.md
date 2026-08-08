# CLAUDE.md - Controle do Acervo (SCA)

Só o que muda o que você digita. Estrutura, stack, comandos, rotas e banco: `README.md`. Como subir
o ambiente: `levantar_servico.md`. O **porquê** de cada escolha que parece defeito, e o que custou a
alternativa: `docs/decisoes.md`, que é também onde uma decisão nova se registra.

## Não se negocia

- **NUNCA crie commit.** Quem revisa e commita é o usuário. Só rode `git add`, `git commit` ou
  `git push` se ele pedir naquela mensagem.
- **O repositório é PÚBLICO.** Em arquivo versionado, nunca escreva endereço de servidor, IP interno,
  porta acoplada a host, pasta de rede, caminho de máquina (letra de unidade, UNC) nem segredo com
  valor. Cite a **CHAVE** do `server/config.env`, que é gitignored; o catálogo sem valor nenhum está
  em `.env.example`. O guard `scripts/check_vazamento.py` cobra no pre-commit, e numa máquina que não
  rodou `git config core.hooksPath .githooks` ele nem liga.
- **Senha nunca em claro, e nunca de volta por rota.** O único lugar que gera e confere o hash bcrypt
  de `dgeo.usuario.senha` é `login/senha.js`.
- **`er/` é instalação NOVA.** Atualizar banco existente é arquivo em `migrations/`, ensaiado por
  `migrations/ensaiar_migracao.cjs`.
- **Não invente campo** que não está no DDL nem no schema Joi. Marque como pendência.
- **Não introduza** ORM, TypeScript no servidor, framework de front, Docker ou biblioteca de UI, e
  não ressuscite a SPA React da mapoteca nem os clients por módulo (`acervo_client`,
  `mapoteca_client`), apagados de propósito: a interface é UMA. Mudar isso é decisão, e decisão se
  registra em `docs/decisoes.md`.
- **Decisão de desenho não se conserta sozinha.** Se algo em `docs/decisoes.md` parece defeito, fale
  com o chefe antes de mexer.

## Autorização

```
dgeo.usuario.administrador BOOLEAN   -- administrador de TUDO, global e unico
dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
dominio.tipo_perfil   -- 1 consulta, 2 operador, 3 gerente (hierarquicos)
dominio.modulo        -- 1 acervo, 2 mapoteca, 3 orcamento, 4 producao, 5 efetivo
```

> **Armadilha que já custou caro:** o default de `verifyPerfil(minimo, modulo)` é `'acervo'`. Rota de
> outro módulo que esquece o segundo argumento passa a cobrar perfil no ACERVO, sem erro visível.
> `server/src/__tests__/routes/modulo_em_toda_rota.test.js` varre só `orcamento` e `mapoteca`: em
> `producao` e em `efetivo`, ninguém cobra por você.

- **`dominio.modulo.nome` é RÓTULO, e trocar é inocente. `nome_abrev` é IDENTIFICADOR:** o
  `verifyPerfil`, o mapa `MODULO`, o prefixo de rota e a chave dos `perfis` o comparam por igualdade
  de string, e trocá-lo derruba a autorização sem erro de sintaxe e sem teste vermelho. O rótulo do
  MENU é uma terceira coisa: a seção **PIT** é do módulo `producao`.
- **A régua, de 2026-08-08:** `consulta` LÊ as telas do módulo, `operador` LANÇA, `gerente` responde
  pela área e vê tudo dela. Rota nova escolhe o piso por essa frase, e não por costume. As duas
  exceções são deliberadas: a lista NÃO hierárquica (`perfis: ['consulta','gerente']`, lida por
  `ehDeAlgumPerfil` e nunca por `temPerfil`, para a tela que o operador não vê) e
  `#/acervo/administracao`, do ADMINISTRADOR, a única tela que o gerente da área não alcança.
- **`verifyPerfil` lê o BANCO a cada requisição**, e não o token: rebaixar perfil vale na hora.
  `administrador` é global e curto-circuita qualquer módulo, e não existe administrador de módulo.
  Quem não tem linha para um módulo não o acessa, e conceder é ato explícito.
- **Ter conta não é ter acesso.** Sem perfil em módulo nenhum, a pessoa alcança só a própria página
  (`#/perfil`, `/usuarios/perfil` e a própria senha), e lê ali que o acesso se pede ao ADMINISTRADOR.
  Rota de PLATAFORMA escolhe a guarda entre `verifyLogin` (a própria conta), `verifyAcesso` (perfil
  em ALGUM módulo), `verifyGerente` (gerente de qualquer módulo, mais `verifyModuloSubsecao()` para
  ESCREVER subseção do RPCMTec) e `verifyAdmin` (usuários, meta e revisão do PIT, fechar o RPCMTec,
  views materializadas, limpeza de download).

## Ao escrever código

- Escrita que muda dado vive em `db.conn.tx()`, com **`auditoriaCtrl.registrar(t, {...})` na MESMA
  transação**: falhar ao auditar derruba a escrita, e é deliberado.
- **Dia de calendário é `Joi.date().iso().raw()`**, nunca `Joi.date()`. Sem o `.raw()` a coluna
  guarda o dia anterior em UTC-3; sem o `.iso()`, '01/08/2026' vira 8 de janeiro.
- **Rota literal ANTES de rota com parâmetro:** o Express casa na ordem de declaração, e `/perfil`
  cairia em `/:uuid`.
- Toda resposta sai por `res.sendJsonAndLog()`, e todo erro por `AppError` mais `asyncHandler`.
- Código de tabela de domínio vem de `utils/domain_constants.js`, nunca número mágico no SQL.
- Página nova no client segue o contrato de `client/src/js/modules/registry.js`. Perfil de rota no
  client é **só ergonomia**: quem barra escrita é o `verifyPerfil` no servidor.
- **Uma chamada que falha num `Promise.all` derruba a TELA INTEIRA**, e a mensagem que sobra é a
  dela. Mordeu três vezes em 2026-08-08: `#/aproveitamento` morria dizendo "necessita ser um
  administrador" porque a quarta chamada era `verifyAdmin`, e a lista de DFD morreria com 404 de uma
  rota de domínio apagada. Chamada de outro módulo, de outra guarda ou opcional carrega SOZINHA, com
  o próprio `catch`, e a falha dela fica na seção dela.
- `npm run test:rapido` no dia a dia e `npm run test:banco` antes de commitar, os dois em `server/`.
  Teste de schema prova o MOTIVO da recusa (`recusaPor`, de `__tests__/helpers/joi.js`), nunca só
  que houve recusa. O cliente é vitest, não jest.
- **`npm audit fix --force` quebra o boot:** `archiver` fica na 7, e os `overrides` do
  `server/package.json` são o que zera a auditoria.

## Convenções

- Servidor: CommonJS, `'use strict'`, SQL parametrizado por nome do pg-promise (`$<param>`).
- Client: Vanilla JS com módulos ES, sem framework e sem TypeScript, `el()` de `utils/dom.js`, BEM no
  CSS, tokens de `design-tokens.css`, tema por `[data-theme]`.
- CLI: dependência ZERO, e o contrato vem do **Joi vivo** em tempo de execução. Nunca copie contrato
  para dentro de um CLI.
- **Toda string de interface e de erro em português do Brasil.** Coluna de banco em `snake_case` sem
  acento, variável JS em `camelCase`, Python em `snake_case`.
- Sem em-dash em nada, acentuação correta fora de código, e data absoluta (2026-08-08) no lugar de
  "ontem".

## Regras de negócio que o código não impede

- **O saldo de material é DERIVADO do livro** (`mapoteca.movimento_material`: 1 Entrada, 2
  Transferência, 3 Consumo, 4 Contagem), por gatilho: `estoque_material` não tem porta de escrita, e
  abrir uma faz a soma do livro deixar de bater com o saldo no primeiro uso. É o saldo de HOJE: o
  "estoque do mês anterior" da 7.2 vem da EDIÇÃO FECHADA anterior, nunca de saldo atual mais consumo.
- **No orçamento não existe "exercício", "PCA" nem cabeçalho de "PDR":** tudo se amarra ao **ano**
  (coluna `ano SMALLINT`, sem FK).
- **A numeração de `pit.meta` não é estável entre anos:** guarde o `id`, nunca o código.
