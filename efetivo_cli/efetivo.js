#!/usr/bin/env node
'use strict'

// efetivo - CLI de IDENTIDADE e EFETIVO do SAP, desenhado para AGENTES.
//
// Irmao do acervo_cli, do mapoteca_cli e do orcamento_cli: mesmo servidor, mesmo
// login, mesma sessao em cache. A diferenca e que os outros tres falam com um
// MODULO, e este fala com a PLATAFORMA. Duas perguntas e o mesmo dono do dado,
// que e a pessoa:
//   quem e, e o que pode  ->  usuario, perfil por modulo, senha, acesso
//   quem esteve na Divisao ->  passagem (periodo) e impedimento
// Nenhuma das duas pertence a modulo nenhum, mas a GUARDA delas deixou de ser a
// mesma na 1.33.0: /usuarios e /acessos continuam verifyAdmin, e /efetivo passou
// ao modulo Efetivo (code 5).
//
// Cinco principios, e o codigo os segue:
//   1. Nada de contrato copiado. Campos, tipos e filtros saem do Joi vivo do
//      server/ em tempo de execucao. Nao ha arquivo gerado para apodrecer.
//   2. Prosa curada so para o que o describe() nao alcanca (lib/regras.js).
//   3. Saida compacta por padrao. O consumidor tem janela finita: --json existe
//      para encadear, mas nao e o default.
//   4. Verbos de intencao, nao espelho do CRUD. `perfis` existe porque conceder
//      acesso pela rota crua exige reenviar administrador e ativo, e quem
//      esquecer desativa alguem sem querer.
//   5. O guardrail mora na interface. Operacao em LOTE resolve os uuid para NOME
//      antes de pedir confirmacao: skill e de um cliente so, a interface serve
//      todos.

const argsLib = require('./lib/args')
const { resolver } = require('./lib/config')
const { listarChaves } = require('./lib/recursos')

const AJUDA = `efetivo - CLI de identidade e efetivo do SAP, para agentes

CONTRATO (nao gasta rede, leia isto antes de montar um corpo)
  efetivo schema                      lista os recursos e suas operacoes
  efetivo schema usuario              campos, tipos, obrigatorios e regras
  efetivo schema efetivo              o contrato de passagem e impedimento
  efetivo usuario dominios            posto/graduacao, modulos e niveis de perfil

USUARIOS  (exigem ADMINISTRADOR)
  efetivo usuario listar [--ativo false] [--admin] [--sem-senha] [--modulo acervo]
  efetivo usuario obter --uuid U
  efetivo usuario criar --data '{...}' [--dry-run]
  efetivo usuario editar --uuid U --data '{"administrador": false, "ativo": true}'
  efetivo usuario editar-lista --data '{"usuarios": [...]}' --confirmar <quantos>
  efetivo usuario excluir --uuid U --confirmar U
  efetivo usuario resetar-senha --uuids U1,U2 --confirmar <quantos>
  efetivo usuario perfis --uuid U
  efetivo usuario perfis --uuid U --conceder acervo=operador --revogar mapoteca --confirmar U

O PROPRIO CADASTRO  (basta estar logado)
  efetivo usuario meu-perfil
  SCA_SENHA_ATUAL=... SCA_SENHA_NOVA=... efetivo usuario trocar-senha

ACESSOS  (exigem ADMINISTRADOR)
  efetivo acessos resumo
  efetivo acessos logados
  efetivo acessos logins dia|usuarios [--total N] [--max N]

EFETIVO  (modulo Efetivo: LER pede consulta, ESCREVER pede gerente)
  efetivo mapa --ano 2026            o mapa por semana, mais o fechamento do ano
  efetivo mes --ano 2026 --mes 7     o aproveitamento do mes (a 6.1 do RPCMTec)
  efetivo periodos [--ano 2026]      as passagens pela DGEO
  efetivo periodos criar   --data '{"usuario_uuid": "U", "data_inicio": "2026-01-05"}'
  efetivo periodos editar  --id 12 --data '{"data_inicio": "2026-01-05", "data_fim": "2026-12-20"}'
  efetivo periodos excluir --id 12 --confirmar 12
  efetivo impedimentos [--ano 2026]  o que TIRA a pessoa do trabalho da Divisao
  efetivo impedimentos criar   --data '{...}'
  efetivo impedimentos editar  --id 30 --data '{...}'
  efetivo impedimentos excluir --id 30 --confirmar 30

O PROPRIO  (nao pede perfil em Efetivo: basta ter acesso a ALGUM modulo)
  efetivo meu aproveitamento --ano 2026   a minha grade do ano
  efetivo meu periodo                     as minhas passagens, todas
  efetivo meu periodo criar   --data '{"data_inicio": "2026-01-05"}'
  efetivo meu periodo editar  --id 12 --data '{"data_inicio": "2026-01-05"}'
  efetivo meu periodo excluir --id 12 --confirmar 12
  efetivo meu impedimento                 os meus impedimentos, todos
  efetivo meu impedimento criar   --data '{"descricao": "LTSP", "percentual": 100, "data_inicio": "2026-03-02"}'
  efetivo meu impedimento editar  --id 30 --data '{...}'
  efetivo meu impedimento excluir --id 30 --confirmar 30

SESSAO
  efetivo status                      o SAP esta no ar? ha token em cache? sou admin?
  efetivo login                       autentica uma vez e guarda o token (~1h)
  efetivo logout                      descarta o token em cache

AMBIENTE  (nunca ponha senha na linha de comando)
  SCA_URL     URL do backend, ex.: http://IP:porta
  SCA_USER    login de admin        SCA_SENHA   senha
  SCA_TOKEN   JWT pronto (dispensa login)
  SCA_SENHA_ATUAL / SCA_SENHA_NOVA    as duas do usuario trocar-senha

FLAGS GLOBAIS
  --json          saida crua e completa (para encadear)
  --formato       tsv (padrao) | tabela | json
  --campos a,b    recorta colunas na saida
  --dry-run       valida contra o Joi e mostra a requisicao; nao envia nada
  --confirmar     confirma acao irreversivel ou de alto impacto
  --server URL    sobrepoe SCA_URL
  --cliente       cliente de auth (padrao sca_web)
  --insecure      aceita HTTPS com certificado self-signed
  --sem-cache     nao le nem grava o token em cache

CODIGO DE SAIDA
  0 tudo certo
  1 erro, recusa de guardrail ou recusa do servidor

Recursos do contrato: ${listarChaves().join(', ')}.
/api/usuarios, /api/acessos e /api/efetivo sao rotas de PLATAFORMA, sem prefixo
de modulo. As duas primeiras sao verifyAdmin; /api/efetivo e do modulo Efetivo
(code 5) desde a 1.33.0, com LER em consulta e ESCREVER em gerente desde
2026-08-08. Nao existe "administrador de modulo", e o administrador e global e
passa em tudo. NAO ha comando de aplicacao: a lista de clientes de auth e
fechada e vive no .valid() de login/login_schema.js.`

const ROTEADOR = {
  schema: './comandos/schema',
  usuario: './comandos/usuario',
  usuarios: './comandos/usuario',
  acessos: './comandos/acessos',
  periodos: './comandos/efetivo',
  impedimentos: './comandos/efetivo',
  mapa: './comandos/efetivo',
  mes: './comandos/efetivo',
  // O PROPRIO aproveitamento. Mesmo arquivo de comando, RECURSO diferente: ver
  // `recursoDe` em comandos/efetivo.js. O que os separa e o ACESSO.
  meu: './comandos/efetivo',
  login: './comandos/sessao',
  logout: './comandos/sessao',
  status: './comandos/sessao'
}

async function principal () {
  const args = argsLib.parse(process.argv.slice(2))
  const comando = args._[0]

  if (!comando || args.flags.ajuda || args.flags.help) {
    process.stdout.write(AJUDA + '\n')
    return 0
  }

  const modulo = ROTEADOR[comando]

  if (!modulo) {
    process.stderr.write(
      `Comando desconhecido: "${comando}".\n` +
      `Comandos: ${Object.keys(ROTEADOR).join(', ')}.\n` +
      'Use efetivo --ajuda para o mapa completo.\n'
    )
    return 1
  }

  const cmd = require(modulo)

  // Nada que responda so com conhecimento do repo pode exigir servidor ou
  // credencial: nem o `schema`, nem o --dry-run de uma escrita (que valida
  // contra o Joi sem tocar a rede), nem o erro de acao inexistente. Pedir
  // SCA_URL para dizer "essa acao nao existe" seria trocar uma resposta util
  // por uma exigencia de configuracao.
  const precisa = typeof cmd.precisaServidor === 'function'
    ? cmd.precisaServidor(args)
    : cmd.precisaServidor === true && args.flags['dry-run'] !== true

  const cfg = cmd.precisaServidor ? resolver(args.flags, precisa) : null

  const resultado = await cmd.executar(args, cfg)

  // Avisos vao para stderr: nao poluem o stdout que o agente pode estar
  // encadeando (--json), mas continuam visiveis.
  for (const aviso of resultado.avisos || []) {
    process.stderr.write('[aviso] ' + aviso + '\n')
  }
  if (resultado.texto) process.stdout.write(resultado.texto + '\n')

  // O comando escolhe o codigo de saida quando o DESFECHO importa a quem chama.
  return typeof resultado.codigo === 'number' ? resultado.codigo : 0
}

principal()
  .then(codigo => { process.exitCode = codigo })
  .catch(err => {
    // Erro ja formatado (o bloco de quem seria atingido, a validacao local com o
    // contrato junto, a recusa do servidor) sai limpo; o resto sai com o
    // prefixo, sem stack: stack em CLI de agente e ruido.
    for (const aviso of err.avisos || []) {
      process.stderr.write('[aviso] ' + aviso + '\n')
    }
    process.stderr.write(
      (err.jaFormatado ? err.message : '[erro] ' + err.message) + '\n'
    )
    process.exitCode = 1
  })
