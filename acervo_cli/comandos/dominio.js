// Path: comandos\dominio.js
'use strict'

// `acervo dominio [tabela]` - as tabelas de dominio do SCA.
//
//   acervo dominio                     que tabelas existem, e os apelidos offline
//   acervo dominio tipo_escala         a tabela viva, do servidor
//
// Por que ganha comando proprio: o acervo inteiro e dirigido por id numerico de
// dominio (tipo_escala_id, tipo_produto_id, subtipo_produto_id, tipo_arquivo_id),
// e trocar 50k por 250k de cabeca ja custou uma auditoria rodada na escala
// errada. Onde o CLI aceita apelido (--escala 50k), este comando e o dicionario;
// onde nao aceita, e a fonte do numero.
//
// Os GET de dominio JA FORAM publicos, e nao sao mais: desde 2026-07-25 eles
// exigem perfil `consulta` no modulo acervo (verifyPerfil em
// server/src/gerencia/gerencia_route.js). Eram anonimos por omissao, nao por
// escolha, e a reforma de perfil fechou isso. Este comentario dizia o contrario
// e a listagem chamava sem token, o que dava 401 em vez de dado.
// O indice OFFLINE (`acervo dominio` sem tabela) segue sem rede e sem login.

const http = require('../lib/http')
const saida = require('../lib/saida')
const argsLib = require('../lib/args')
const dominios = require('../lib/dominios')

// As tabelas que o servidor expoe em /api/gerencia/dominio/<tabela>. Sao rotas,
// nao contrato de campo: por isso vivem aqui e nao saem de um describe().
const ROTAS = [
  'tipo_posto_grad',
  'tipo_produto',
  'tipo_escala',
  'subtipo_produto',
  'situacao_carregamento',
  'tipo_arquivo',
  'tipo_relacionamento',
  'tipo_status_arquivo',
  'tipo_versao',
  'tipo_status_execucao'
]

function indiceOffline () {
  const linhas = []
  for (const tabela of dominios.listarTabelas()) {
    const mapa = dominios.mapaDe(tabela)
    if (!mapa) continue
    const meta = dominios.TABELAS[tabela]
    // Um code pode ter dois apelidos (escala-50k e 50k): mostrar o mais curto.
    const porCode = new Map()
    for (const [apelido, code] of mapa) {
      const atual = porCode.get(code)
      if (!atual || apelido.length < atual.length) porCode.set(code, apelido)
    }
    const itens = [...porCode.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([code, apelido]) => `${code}=${apelido}`)
      .join('  ')
    linhas.push(`  ${tabela}${meta.completa ? '' : ' (SUBCONJUNTO)'}`)
    linhas.push(`    ${itens}`)
  }
  return linhas
}

async function executar (args, cfg) {
  const tabela = args._[1]
  const flags = args.flags

  if (!tabela) {
    return {
      texto: [
        'Tabelas de dominio do SCA (a tabela viva exige perfil consulta):',
        ...ROTAS.map(r => '  ' + r),
        '',
        'Listar uma: acervo dominio tipo_escala',
        '',
        'Apelidos que o CLI resolve OFFLINE (--escala 50k, --tipo carta-topografica),',
        'derivados de utils/domain_constants.js do server/:',
        ...indiceOffline(),
        '',
        'Onde diz SUBCONJUNTO, o offline so conhece o que o servidor usa em query:',
        'a tabela inteira so sai do servidor.'
      ].join('\n')
    }
  }

  if (!ROTAS.includes(tabela)) {
    throw new Error(
      `Dominio desconhecido: "${tabela}". Disponiveis: ${ROTAS.join(', ')}.`
    )
  }

  const r = await http.autenticada(cfg, 'GET', `/gerencia/dominio/${tabela}`)
  const out = saida.lista(r.dados, {
    formato: flags.json ? 'json' : (flags.formato || 'tsv'),
    campos: argsLib.lista(flags.campos),
    padrao: ['code', 'nome']
  })
  return { texto: out.texto, avisos: out.avisos }
}

module.exports = { executar, precisaServidor: true }
