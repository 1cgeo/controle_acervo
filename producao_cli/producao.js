#!/usr/bin/env node
'use strict'

// producao - CLI do PIT e do RPCMTec do SCA, desenhado para AGENTES.
//
// O client web serve humanos; este CLI serve agentes. Sao dois clientes da mesma
// API, com ergonomias diferentes de proposito: a tela otimiza clique e
// descoberta visual, o CLI otimiza contexto e encadeamento.
//
// Irmao do acervo_cli, do mapoteca_cli, do orcamento_cli e do efetivo_cli: mesmo
// servidor, mesmo login, mesma sessao em cache. Os tres primeiros falam com um
// MODULO; este fala com a PLATAFORMA, como o efetivo_cli. O plano anual da
// Divisao e o relatorio mensal dela nao pertencem a acervo, mapoteca nem
// orcamento: os tres alimentam os dois.
//
// Quatro principios, e o codigo os segue:
//   1. Nada de contrato copiado. Campos, tipos, obrigatorios e filtros saem do
//      Joi vivo do server/ em tempo de execucao. Nao ha arquivo gerado para
//      apodrecer.
//   2. Prosa curada so para o que o describe() nao alcanca (lib/regras.js).
//   3. Saida compacta por padrao. O consumidor tem janela finita: --json existe
//      para encadear, mas nao e o default.
//   4. O guardrail mora na interface. A validacao local roda no MODO de cada
//      grupo de rota, e a confirmacao de ato irreversivel diz o que ele FAZ:
//      skill e de um cliente so, a interface serve todos.

const argsLib = require('./lib/args')
const { resolver } = require('./lib/config')
const { RECURSOS, listarChaves } = require('./lib/recursos')

const AJUDA = `producao - CLI do PIT e do RPCMTec do SCA, para agentes

CONTRATO (não gasta rede, leia isto antes de montar um corpo)
  producao schema                       lista os recursos e suas operações
  producao schema execucao              campos, tipos, obrigatórios, guarda e regras
  producao <recurso>                    as operações de um recurso, sem detalhe

PIT  (/api/metas)
  producao meta listar --ano 2026 [--campos a,b] [--formato tsv|tabela|json]
  producao meta obter --id 42
  producao meta historico --id 42
  producao meta criar --data '{...}' [--dry-run]
  producao meta corrigir-transcricao --id 42 --data '{...}'
  producao execucao grade --ano 2026                 (exige gerente)
  producao execucao resumo --ano 2026 --mes 7        (exige gerente)
  producao execucao ensaio --ano 2026                (o digitado x o calculado)
  producao execucao lancar --data '{...}'
  producao exercicio listar
  producao revisao listar --ano 2026
  producao revisao alteracoes --revisao 3            (leia contra o DIEx)
  producao revisao publicar --revisao 3 --data '{"data_vigencia":"2026-05-11"}' --confirmar 3
  producao extra listar --ano 2026
  producao midia listar --ano 2026

RPCMTec  (/api/rpcmtec; a EDIÇÃO exige administrador, a capacitação não)
  producao edicao listar --ano 2026
  producao edicao documento --id 7                   (os 34 blocos; resposta grande)
  producao edicao pdf --id 7 [--saida RPCMTec.pdf]
  producao edicao fechar --id 7 --confirmar 7        (CONGELA o documento)
  producao edicao reabrir --id 7 --confirmar 7       (descarta o congelado calculado)
  producao edicao conferir --id 7                    (o congelado x o banco de hoje)
  producao edicao anexar --id 7 --file rpcmtec.pdf
  producao subsecao gravar --id 7 --numero 7.1 --data '{...}'
  producao subsecao copiar-mes-anterior --id 7
  producao capacitacao-ministrada listar --ano 2026   (2.6; módulo Produção)
  producao capacitacao-recebida listar --ano 2026     (6.2; módulo Efetivo)
  producao anuario ods --ano 2026 --mes 7 [--saida anuario.ods]
  producao anuario rtm-ods --ano 2026 --mes 7

RECURSOS  (${listarChaves().join(', ')})

SESSÃO
  producao status                       o SCA está no ar? há token em cache?
  producao login                        autentica uma vez e guarda o token (~1h)
  producao logout                       descarta o token em cache

AMBIENTE  (catálogo em env-guia.md; nunca ponha senha na linha de comando)
  SCA_URL     URL do backend, ex.: http://IP:porta
  SCA_USER    login                 SCA_SENHA   senha
  SCA_TOKEN   JWT pronto (dispensa login)

FLAGS GLOBAIS
  --json          saída crua e completa (para encadear)
  --formato       tsv (padrão) | tabela | json
  --campos a,b    recorta colunas na saída
  --data '{...}'  corpo da escrita     --data-file corpo.json
  --file X        arquivo a enviar     --saida X   onde gravar o download
  --confirmar V   confirma ato irreversível, repetindo o identificador
  --dry-run       valida contra o Joi e mostra a requisição; não envia nada
  --server URL    sobrepõe SCA_URL
  --cliente       cliente de auth (padrão sca_web)
  --insecure      aceita HTTPS com certificado self-signed
  --sem-cache     não lê nem grava o token em cache

GUARDA  (confira o detalhe por operação em: producao schema <recurso>)
  ler a meta, o Extra-PIT, a mídia, o exercício e a revisão   exige só LOGIN
  ler a execução mensal (grade e resumo)                      exige GERENTE de
                                                              qualquer módulo
  lançar a execução mensal e o Extra-PIT                      exige OPERADOR em
                                                              Produção
  a capacitação MINISTRADA (2.6), inteira                     exige OPERADOR em
                                                              Produção
  a capacitação RECEBIDA (6.2), inteira                       exige OPERADOR em
                                                              Efetivo
  a META e a REVISÃO do PIT, e a mídia                        exige ADMINISTRADOR
  a EDIÇÃO do RPCMTec, inclusive a leitura                    exige ADMINISTRADOR

Produção e Efetivo viraram módulos na 1.33.0, para haver como dar menos que a
flag global. Alterar a META continua sendo do administrador: mudar o PIT é ato
da DSG, e o que está no sistema é transcrição do documento assinado.

/api/metas e /api/rpcmtec são rotas de PLATAFORMA: sem prefixo de módulo, como
/api/usuarios. O efetivo (passagens, impedimentos, mapa) fica no efetivo_cli.`

const ROTEADOR = {
  schema: './comandos/schema',
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

  let modulo = ROTEADOR[comando]
  if (!modulo && RECURSOS[comando]) modulo = './comandos/operacao'

  if (!modulo) {
    process.stderr.write(
      `Comando desconhecido: "${comando}".\n` +
      `Comandos: ${Object.keys(ROTEADOR).join(', ')}.\n` +
      `Recursos: ${listarChaves().join(', ')}.\n` +
      'Use producao --ajuda para o mapa completo.\n'
    )
    return 1
  }

  const cmd = require(modulo)

  // Nada que responda so com conhecimento do repo pode exigir servidor ou
  // credencial: nem o `schema`, nem o --dry-run de uma escrita (que valida
  // contra o Joi sem tocar a rede), nem o erro de operacao inexistente. Pedir
  // SCA_URL para dizer "essa operacao nao existe" seria trocar uma resposta util
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
  return 0
}

principal()
  .then(codigo => { process.exitCode = codigo })
  .catch(err => {
    // Erro ja formatado (a validacao local com o contrato junto, a recusa de um
    // ato irreversivel) sai limpo; o resto sai com o prefixo, sem stack: stack em
    // CLI de agente e ruido.
    for (const aviso of err.avisos || []) {
      process.stderr.write('[aviso] ' + aviso + '\n')
    }
    process.stderr.write(
      (err.jaFormatado ? err.message : '[erro] ' + err.message) + '\n'
    )
    process.exitCode = 1
  })
