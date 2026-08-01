#!/usr/bin/env node
'use strict'

// orcamento - CLI do modulo orcamento do SCA, desenhado para AGENTES.
//
// O client web serve humanos; este CLI serve agentes. Sao dois clientes da
// mesma API, com ergonomias diferentes de proposito: a tela otimiza clique e
// descoberta visual, o CLI otimiza contexto e encadeamento.
//
// Irmao do acervo_cli e do mapoteca_cli: mesmo servidor, mesmo login, mesma
// sessao em cache. Muda so o modulo com que cada um fala.
//
// Tres principios, e o codigo os segue:
//   1. Nada de contrato copiado. Campos, tipos e filtros saem do Joi vivo do
//      server/ em tempo de execucao. Nao ha arquivo gerado para apodrecer.
//   2. Saida compacta por padrao. O consumidor tem janela finita: --json existe
//      para encadear, mas nao e o default.
//   3. O guardrail mora na interface. Confirmacao de acao irreversivel e
//      validacao local ficam aqui, nao na skill que chama: skill e de um cliente
//      so, a interface serve todos.

const argsLib = require('./lib/args')
const { resolver } = require('./lib/config')
const { RECURSOS, listarChaves } = require('./lib/recursos')

const AJUDA = `orcamento - CLI do modulo orcamento do SCA, para agentes

CONTRATO (nao gasta rede, leia isto antes de montar um corpo)
  orcamento schema                      lista os recursos
  orcamento schema nc                   campos, tipos, obrigatorios e regras da NC

DIA A DIA
  orcamento saldo                       quanto falta empenhar e liquidar (total do PDR)
  orcamento saldo --nd 339040           o mesmo, de uma natureza de despesa
  orcamento saldo --extra               a faixa Extra-PDR
  (o RPCMTec saiu daqui em 2026-08-01: e gerado inteiro, fora dos modulos,
   por: acervo rpcmtec --ano N --mes M --docx)

RECURSOS  (${listarChaves().join(', ')})
  orcamento <recurso> listar [--ano 2026] [--campos a,b] [--formato tsv|tabela|json]
  orcamento <recurso> obter --id 42
  orcamento <recurso> criar --data '{...}'            [--dry-run]
  orcamento <recurso> lancar --data '{...}' --anexo nota.pdf     (cria e anexa de uma vez)
  orcamento <recurso> atualizar --id 42 --data '{...}'
  orcamento <recurso> deletar --id 42 --confirmar 42
  orcamento <recurso> anexar --id 42 --file nota.pdf
  orcamento dominio natureza_despesa                  (exige perfil de consulta)

SESSAO
  orcamento status                      o SCA esta no ar? ha token em cache?
  orcamento login                       autentica uma vez e guarda o token (~1h)
  orcamento logout                      descarta o token em cache

AMBIENTE  (catalogo em env-guia.md; nunca ponha senha na linha de comando)
  SCA_URL     URL do backend, ex.: http://IP:porta
  SCA_USER    login de admin        SCA_SENHA   senha
  SCA_TOKEN   JWT pronto (dispensa login)

FLAGS GLOBAIS
  --json          saida crua e completa (para encadear)
  --formato       tsv (padrao) | tabela | json
  --campos a,b    recorta colunas na listagem
  --dry-run       monta e mostra a requisicao, nao envia
  --server URL    sobrepoe SCA_URL
  --cliente       cliente de auth (padrao sca_web)
  --insecure      aceita HTTPS com certificado self-signed
  --sem-cache     nao le nem grava o token em cache

As rotas do modulo ficam sob /api/orcamento/. As excecoes sao /api/login e
/api/usuarios, que sao rotas de plataforma e nao levam prefixo.
Leitura exige perfil de consulta no modulo orcamento. Criar e atualizar exigem
operador. Deletar exige gerente. O administrador passa em tudo.`

const ROTEADOR = {
  schema: './comandos/schema',
  saldo: './comandos/relatorio',
  // Mantido no mapa so para o comando responder com a instrucao certa em vez
  // de "comando desconhecido": quem tinha o verbo na memoria precisa saber para
  // onde ele foi.
  secao3: './comandos/relatorio',
  dominio: './comandos/dominio',
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
  if (!modulo && RECURSOS[comando]) modulo = './comandos/crud'

  if (!modulo) {
    process.stderr.write(
      `Comando desconhecido: "${comando}".\n` +
      `Comandos: ${Object.keys(ROTEADOR).join(', ')}.\n` +
      `Recursos: ${listarChaves().join(', ')}.\n` +
      'Use orcamento --ajuda para o mapa completo.\n'
    )
    return 1
  }

  const cmd = require(modulo)
  // Comandos que so leem o schema local (orcamento schema) nao exigem servidor nem
  // credencial: o contrato e conhecimento estatico do repo. Com --dry-run,
  // idem: valida contra o Joi e mostra a requisicao, sem tocar a rede.
  const cfg = cmd.precisaServidor
    ? resolver(args.flags, !args.flags['dry-run'])
    : null

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
    // Erro ja formatado (validacao local com o contrato junto) sai limpo; o
    // resto sai com o prefixo, sem stack: stack em CLI de agente e ruido.
    for (const aviso of err.avisos || []) {
      process.stderr.write('[aviso] ' + aviso + '\n')
    }
    process.stderr.write(
      (err.jaFormatado ? err.message : '[erro] ' + err.message) + '\n'
    )
    process.exitCode = 1
  })
