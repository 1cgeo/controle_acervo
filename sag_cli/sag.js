#!/usr/bin/env node
'use strict'

// sag - CLI de LEITURA do SAG (Sistema de Apoio a Gestao), desenhado para AGENTES.
//
// O SAG e o espelho do SIAFI que a administracao do Exercito ja usa, e e onde o
// chefe confere. Este CLI existe para que o modulo `orcamento` do SCA pare de
// ser alimentado a mao a partir de PDF: o dado nasce no SIAFI, e daqui sai
// pronto para comparar e para lancar.
//
// Tres principios, herdados dos CLIs irmaos, e o codigo os segue:
//   1. Nada de contrato copiado. Coluna, filtro e valor de dominio saem da tela
//      viva do SAG em tempo de execucao. O unico dado local e o nome do arquivo
//      PHP de cada documento.
//   2. Saida compacta por padrao. --json existe para encadear, nao e o default.
//   3. So leitura. O SAG e alimentado pelo SIAFI e pela SALC; escrever daqui
//      criaria uma segunda origem para o mesmo fato. A escrita do nosso lado
//      continua no orcamento_cli, contra o SCA.

const argsLib = require('./lib/args')
const { resolver } = require('./lib/config')
const { listarChaves } = require('./lib/documentos')

const AJUDA = `sag - CLI de leitura do SAG, para agentes

CONTRATO (leia antes de montar uma consulta)
  sag schema                    os documentos que este CLI consulta
  sag schema nc                 colunas, periodos e filtros da tela, lidos do SAG vivo

CONSULTA  (documentos: ${listarChaves().join(', ')})
  sag nc listar --ano 2026 [--ug-fav 160382]
  sag nc listar --de 2026-01-01 --ate 2026-06-30 --campos NUMERO_NC,VALOR_NC,OBS
  sag ne listar --ano 2026 --filtro ND=339015 --filtro ND=339030
  sag <doc> listar [--limite N] [--formato tsv|tabela|json] [--largura 60]

CONFERENCIA COM O SCA (a razao de este CLI existir)
  sag conferir nc --ano 2026 --acao 20XE
  sag conferir ne --ano 2026 --acao 20XE --so-diferencas
  sag conferir nc --ano 2026 --acao 20XE --corpo    (imprime o JSON para o orcamento_cli)

SESSAO
  sag status                    o SAG responde? ha sessao em cache?
  sag login                     autentica e guarda o cookie
  sag logout                    descarta o cookie em cache

AMBIENTE  (catalogo em .env.example; nunca ponha senha na linha de comando)
  SAG_URL       URL do SAG
  SAG_USUARIO   CPF, 11 digitos       SAG_SENHA   senha de 6 digitos
  SCA_URL       backend do SCA, so para o comando conferir
  SCA_TOKEN     JWT pronto, ou o par SCA_USER e SCA_SENHA

FLAGS GLOBAIS
  --json          saida crua e completa (para encadear)
  --formato       tsv (padrao na consulta) | tabela | json
  --campos a,b    escolhe as colunas; veja quais em sag schema <doc>
  --filtro C=v    filtra por seletor da tela; pode repetir
  --ano N         atalho para o exercicio inteiro
  --de / --ate    periodo explicito, em aaaa-mm-dd
  --limite N      para de paginar em N registros (o corte SEMPRE sai avisado)
  --server URL    sobrepoe SAG_URL
  --insecure      aceita HTTPS com certificado nao confiavel
  --sem-cache     nao le nem grava o cookie em cache

O SAG so responde de dentro da rede do EB, e NAO passa pelo proxy: o Node ignora
HTTP_PROXY por padrao, e e o que faz este CLI funcionar onde o curl falha.`

const ROTEADOR = {
  schema: './comandos/schema',
  conferir: './comandos/conferir',
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
  if (!modulo && listarChaves().includes(comando)) modulo = './comandos/listar'

  if (!modulo) {
    process.stderr.write(
      `Comando desconhecido: "${comando}".\n` +
      `Comandos: ${Object.keys(ROTEADOR).join(', ')}.\n` +
      `Documentos: ${listarChaves().join(', ')}.\n` +
      'Use sag --ajuda para o mapa completo.\n'
    )
    return 1
  }

  const cmd = require(modulo)
  // `precisaServidor` pode ser funcao: `sag schema` sem argumento so lista o
  // mapa local de documentos, e cobrar SAG_URL ali seria pedir configuracao
  // para uma operacao que nao toca a rede.
  const precisa = typeof cmd.precisaServidor === 'function'
    ? cmd.precisaServidor(args)
    : cmd.precisaServidor
  const cfg = precisa ? resolver(args.flags) : null
  const resultado = await cmd.executar(args, cfg)

  // Avisos vao para stderr: nao poluem o stdout que o agente pode estar
  // encadeando (--json), mas continuam visiveis.
  for (const aviso of resultado.avisos || []) {
    process.stderr.write('[aviso] ' + aviso + '\n')
  }
  if (resultado.texto) process.stdout.write(resultado.texto + '\n')
  return 0
}

// So executa quando invocado como programa. Sob require (os testes importam o
// roteamento) o arquivo apenas exporta, sem disparar nada.
if (require.main === module) {
  principal()
    .then(codigo => { process.exitCode = codigo })
    .catch(err => {
      process.stderr.write('[erro] ' + err.message + '\n')
      process.exitCode = 1
    })
}

module.exports = { AJUDA, ROTEADOR }
