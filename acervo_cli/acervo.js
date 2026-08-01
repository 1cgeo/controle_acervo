#!/usr/bin/env node
// Path: acervo.js
'use strict'

// acervo - interface de linha de comando do SCA, desenhada para AGENTES.
//
// O acervo_client serve humanos; este CLI serve agentes. Sao dois clientes da
// mesma API, com ergonomias diferentes de proposito: a tela otimiza clique e
// descoberta visual, o CLI otimiza contexto e encadeamento.
//
// Cinco principios, e o codigo os segue:
//   1. Nada de contrato copiado. Campos, tipos e filtros saem do Joi vivo do
//      server/ em tempo de execucao. Nao ha arquivo gerado para apodrecer.
//   2. Prosa curada so para o que o describe() nao alcanca (lib/regras.js).
//   3. Saida compacta por padrao. O consumidor tem janela finita: --json existe
//      para encadear, mas nao e o default.
//   4. Verbos de intencao, nao espelho do CRUD. Verbo que precisaria de regra de
//      negocio nova pertence ao backend, nao aqui.
//   5. O guardrail mora na interface. Validacao local, --dry-run OFFLINE e
//      confirmacao de acao irreversivel ficam aqui, nao na skill que chama:
//      skill e de um cliente so, a interface serve todos.

const argsLib = require('./lib/args')
const { resolver } = require('./lib/config')
const { RECURSOS, listarChaves } = require('./lib/recursos')

const AJUDA = `acervo - CLI do Sistema de Controle do Acervo (SCA), para agentes

CONTRATO (nao gasta rede, leia isto antes de montar um corpo)
  acervo schema                    lista os recursos e suas operacoes
  acervo schema produtos           campos, tipos, obrigatorios e regras da escrita
  acervo dominio                   os ids de dominio e os apelidos aceitos
  acervo dominio tipo_escala       a tabela viva (exige perfil consulta)

DIA A DIA
  acervo cobertura --mi 2965-2,2965-4 --escala 50k --anos 10
                                   ja temos essa carta? (rota publica)
  acervo cobertura --escala 250k --so-faltantes
  acervo cobertura --area moldura.geojson --escala 50k [--limiar 0.01]
                                   que folhas esta AREA toca (recorte no
                                   PostGIS; --limiar e a fracao da folha
                                   coberta). GeoJSON; para GPKG/shapefile,
                                   ogr2ogr -f GeoJSON antes
  acervo auditar                   os invariantes logicos do acervo (admin)
  acervo auditar --severidade DEFECT   so o que TEM de dar zero
  acervo auditar --check 2a --amostra 50   as linhas de um invariante
  acervo produto 2965-2            as versoes/edicoes da folha
  acervo produto --id 4211 --arquivos --caminho
                                   os arquivos, com o caminho no volume
  acervo finalizados --ano 2026 --mes 7
                                   o que foi finalizado no periodo (rota publica)
  acervo rpcmtec --ano 2026 --mes 7 [--docx] [--anuario]
                                   o RPCMTec inteiro (e o Anuario Estatistico)

ESCRITA GUARDADA (acervo de PRODUCAO)
  acervo editar versao  --id 7244 --set data_edicao=2019-05-01 --dry-run
  acervo editar versao  --id 7244 --set data_edicao=2019-05-01 --confirmar 7244
  acervo editar produto --id 4211 --set nome="Serra Azul" --set subtipo_produto_id=24
  acervo editar arquivo --id 9001 --produto 4211 --set tipo_arquivo_id=2

  O PUT do SCA sobrescreve o objeto INTEIRO. O editar le o registro, casa os
  nomes, aplica so o que voce pediu, RECUSA quando a leitura nao traz um campo
  que o PUT gravaria com default (apagando o valor real), mostra o diff e so
  entao grava.

OPERACOES DA API  (uma por rota real; nao ha CRUD generico no SCA)
  acervo <recurso>                 lista as operacoes do recurso
  acervo <recurso> <operacao> [--data '{...}' | --data-file corpo.json]
                                   [--dry-run] [--confirmar <ids>]
  recursos: ${listarChaves().join(', ')}

SESSAO
  acervo status                    o SCA esta no ar? ha token em cache?
  acervo login                     autentica uma vez e guarda o token (~1h)
  acervo logout                    descarta o token em cache

AMBIENTE  (catalogo em env-guia.md; nunca ponha senha na linha de comando)
  SCA_URL     URL do backend, ex.: http://IP:3015
  SCA_USER    login de admin        SCA_SENHA   senha
  SCA_TOKEN   JWT pronto (dispensa login)

FLAGS GLOBAIS
  --json          saida crua e completa (para encadear)
  --formato       tsv (padrao) | tabela | json
  --campos a,b    recorta colunas na saida
  --dry-run       valida contra o Joi e mostra a requisicao; NAO toca a rede,
                  nao precisa de servidor nem de credencial
  --server URL    sobrepoe SCA_URL
  --cliente       aplicacao no servico de auth (padrao sca_web)
  --insecure      aceita HTTPS com certificado self-signed
  --sem-cache     nao le nem grava o token em cache

Sem login: /api (health), /api/integracao/* e os GET de /api/gerencia/dominio/*.
Leitura exige perfil de consulta no modulo acervo; catalogar exige operador; excluir exige gerente. O administrador passa em tudo.`

const ROTEADOR = {
  schema: './comandos/schema',
  cobertura: './comandos/cobertura',
  produto: './comandos/produto',
  editar: './comandos/editar',
  auditar: './comandos/auditar',
  finalizados: './comandos/relatorio',
  rpcmtec: './comandos/relatorio',
  dominio: './comandos/dominio',
  login: './comandos/sessao',
  logout: './comandos/sessao',
  status: './comandos/sessao'
}

async function principal () {
  const args = argsLib.parse(process.argv.slice(2))
  const comando = args._[0]

  const pediuAjuda = args.flags.ajuda || args.flags.help

  if (!comando) {
    process.stdout.write(AJUDA + '\n')
    return 0
  }

  let modulo = ROTEADOR[comando]
  if (!modulo && RECURSOS[comando]) modulo = './comandos/api'

  // Comando que traz ajuda PROPRIA responde por ela; os outros caem no mapa
  // geral, como sempre. Sem isto, `acervo auditar --ajuda` imprimia o mapa
  // geral e a ajuda especifica ficava inalcancavel, escrita e morta.
  if (pediuAjuda) {
    const proprio = modulo && require(modulo).ajudaPropria
    if (!proprio) {
      process.stdout.write(AJUDA + '\n')
      return 0
    }
  }

  if (!modulo) {
    process.stderr.write(
      `Comando desconhecido: "${comando}".\n` +
      `Comandos: ${Object.keys(ROTEADOR).join(', ')}.\n` +
      `Recursos: ${listarChaves().join(', ')}.\n` +
      'Use acervo --ajuda para o mapa completo.\n'
    )
    return 1
  }

  const cmd = require(modulo)

  // Nada que responda so com conhecimento do repo pode exigir servidor ou
  // credencial: nem o `schema`, nem o --dry-run (que valida contra o Joi e
  // mostra a requisicao sem tocar a rede), nem o erro de recurso ou operacao
  // inexistente. Pedir SCA_URL para dizer "essa operacao nao existe" seria
  // trocar uma resposta util por uma exigencia de configuracao.
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
