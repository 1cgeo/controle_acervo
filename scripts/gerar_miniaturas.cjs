// Path: scripts/gerar_miniaturas.cjs
'use strict'

/**
 * Gera as miniaturas do acervo e as grava em `acervo.miniatura_versao`.
 *
 * A ficha do produto mostra a imagem da carta. Esta e a carga que preenche o
 * acervo ja existente; versao nova ganha miniatura no proprio cadastro.
 *
 * O QUE ELE ESCOLHE, POR VERSAO. Uma miniatura por versao, a partir de UM
 * arquivo. Prefere PDF a TIF, e o menor entre os candidatos. O PDF ja e a
 * pagina montada (mapa, legenda, articulacao), e ler 15 MB pela rede custa uma
 * fracao de um GeoTIFF de centenas de MB. Versao so vetorial (zip, sqlite) nao
 * tem raster para renderizar e simplesmente nao entra.
 *
 * O QUE ELE NAO REFAZ. Versao que ja tem miniatura do MESMO arquivo, com o
 * MESMO checksum, e pulada. Trocado o arquivo, o checksum muda e ela e refeita.
 * Falha vira linha de erro, e nao ausencia: sem isso, toda execucao tentaria de
 * novo os mesmos arquivos quebrados. Para insistir neles, `--refazer-erros`.
 *
 * Uso:
 *   node scripts/gerar_miniaturas.cjs --limite 50 --embaralhar --dry-run
 *   node scripts/gerar_miniaturas.cjs --limite 50 --embaralhar
 *   node scripts/gerar_miniaturas.cjs --concorrencia 4
 *   node scripts/gerar_miniaturas.cjs --versao 7244 --refazer-erros
 *   node scripts/gerar_miniaturas.cjs --ajuda
 *
 * Opcao fora da lista PARA o script, e numero que nao converte tambem: um
 * `--dryrun` aceito em silencio gravaria no banco acreditando ensaiar.
 *
 * O `--dry-run` LE o volume e RENDERIZA de verdade, e para so antes de gravar.
 * Um ensaio que so imprimisse a intencao nao exercitaria justamente o que
 * falha: o acesso ao volume e o binario de renderizacao.
 *
 * Conexao pelas variaveis de `server/config.env`. Os binarios saem de
 * `MINIATURA_PDFTOPPM`, `MINIATURA_GDAL_TRANSLATE` e `MINIATURA_GDALINFO`,
 * com o nome no PATH como padrao (em Windows o GDAL vive dentro do QGIS).
 *
 * Extensao .cjs, e nao .js: o package.json da RAIZ declara "type": "module".
 * Mesma razao do ecosystem.config.cjs e do ensaiar_migracao.cjs.
 */

const path = require('path')
const { createRequire } = require('module')

const RAIZ = path.resolve(__dirname, '..')

// `pg` e `dotenv` sao dependencias do SERVIDOR, e nao da raiz. Resolver por ele
// evita duplicar as duas no package.json da raiz so para este script, e garante
// que a carga fale com o banco pela mesma versao de driver que o servico usa.
const requireDoServer = createRequire(path.join(RAIZ, 'server', 'package.json'))
const { Client } = requireDoServer('pg')

requireDoServer('dotenv').config({
  path: path.join(RAIZ, 'server', 'config.env'),
  quiet: true
})

// A politica de fila (que arquivo por versao, o que refazer, a ordem dos campos
// da gravacao) vem do MESMO modulo que o cron do servidor usa. Duplicar aqui
// faria os dois divergirem em silencio.
const {
  SQL_CANDIDATOS,
  SQL_GRAVAR,
  processar,
  valoresParaGravar
} = require(path.join(RAIZ, 'server', 'src', 'utils', 'miniatura_fila.js'))

// --- Argumentos --------------------------------------------------------------

// Chave fora desta lista PARA o script, e a lista existe por um motivo caro: o
// parser guardava qualquer `--chave` num objeto e nunca reclamava. Quem digitava
// `--dryrun` (ou `--dry_run`, ou `--dry-run=1`, que vira a chave `dry-run=1`)
// acreditava estar ensaiando, e a carga GRAVAVA em `acervo.miniatura_versao`.
// `--limit 50`, sem o `e`, deixava LIMITE em null e processava o acervo INTEIRO.
const ACEITAS = [
  'limite', 'concorrencia', 'versao', 'embaralhar', 'refazer-erros', 'dry-run', 'ajuda'
]

const AJUDA = [
  'Uso: node scripts/gerar_miniaturas.cjs [opcoes]',
  '',
  '  --limite N          processa so as N primeiras candidatas (padrao: todas)',
  '  --concorrencia N    quantas renderizacoes em paralelo (padrao: 4)',
  '  --versao ID         so a versao ID',
  '  --embaralhar        sorteia a ordem ANTES do --limite (para o piloto)',
  '  --refazer-erros     inclui as versoes cuja ultima tentativa falhou',
  '  --dry-run           le o volume e RENDERIZA de verdade, e para antes de gravar',
  '  --ajuda             esta ajuda, sem abrir conexao com o banco',
  '',
  'Conexao e binarios saem das chaves de server/config.env (catalogo em .env.example).'
].join('\n')

/** Para com mensagem, em vez de seguir com uma intencao que nao foi entendida. */
const recusar = (mensagem) => {
  console.error(mensagem)
  process.exit(1)
}

const argumentos = {}
for (let i = 2; i < process.argv.length; i += 1) {
  const atual = process.argv[i]
  if (!atual.startsWith('--')) {
    recusar(`Argumento solto: ${atual}. As opcoes vem como --chave [valor]. Veja --ajuda.`)
  }
  const chave = atual.replace(/^--/, '')
  if (!ACEITAS.includes(chave)) {
    recusar(`Opcao desconhecida: --${chave}. Aceitas: ${ACEITAS.map(c => '--' + c).join(', ')}.`)
  }
  const proximo = process.argv[i + 1]
  if (proximo && !proximo.startsWith('--')) {
    argumentos[chave] = proximo
    i += 1
  } else {
    argumentos[chave] = true
  }
}

// ANTES de qualquer conexao: pedir a ajuda nao pode exigir banco de pe nem
// credencial. Ate 2026-09-05 `--ajuda` nem existia, e o script conectava e saia
// executando a consulta.
if (argumentos.ajuda) {
  console.log(AJUDA)
  process.exit(0)
}

/**
 * Inteiro de opcao, ou parada. `--limite abc` virava NaN, que e falsy, e o
 * script processava o acervo INTEIRO acreditando ter recebido um teto.
 */
const inteiro = (chave, padrao) => {
  const bruto = argumentos[chave]
  if (bruto === undefined) return padrao
  if (bruto === true) recusar(`--${chave} exige um numero (ex.: --${chave} 50).`)
  const n = Number(String(bruto).trim())
  if (!Number.isInteger(n) || n < 1) {
    recusar(`--${chave} precisa ser um inteiro maior que zero (recebi ${JSON.stringify(bruto)}).`)
  }
  return n
}

const LIMITE = inteiro('limite', null)
const CONCORRENCIA = inteiro('concorrencia', 4)
const DRY_RUN = Boolean(argumentos['dry-run'])
const REFAZER_ERROS = Boolean(argumentos['refazer-erros'])
const VERSAO = inteiro('versao', null)
// So faz sentido junto de `--limite`, e existe para o PILOTO: as 50 primeiras
// candidatas sao as 50 versoes mais antigas do acervo, todas da mesma epoca e
// do mesmo formato de folha. Medir nelas e medir um canto, e a projecao sairia
// errada por construcao.
const EMBARALHAR = Boolean(argumentos.embaralhar)

const conexao = {
  host: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
}

// --- Execucao ----------------------------------------------------------------

const formatarBytes = (n) => `${(n / 1024).toFixed(0)} KB`
const formatarMs = (n) => `${(n / 1000).toFixed(1)} s`

const processarUm = async (cliente, candidato, estado) => {
  const { resultado, erro, duracao } = await processar(candidato)

  if (!DRY_RUN) {
    await cliente.query(SQL_GRAVAR, valoresParaGravar(candidato, resultado, erro))
  }

  estado.feitos += 1

  if (resultado) {
    estado.sucessos += 1
    estado.bytes += resultado.conteudo.length
    estado.ms += duracao
    estado.porExtensao[candidato.extensao.toLowerCase()] =
      (estado.porExtensao[candidato.extensao.toLowerCase()] || 0) + 1
  } else {
    estado.falhas += 1
    // Guarda a mensagem, e nao o caminho: o caminho tem host de rede interna.
    estado.motivos[erro] = (estado.motivos[erro] || 0) + 1
  }

  const marca = resultado
    ? `${resultado.largura}x${resultado.altura} ${formatarBytes(resultado.conteudo.length)}`
    : `FALHA: ${erro}`

  process.stdout.write(
    `[${estado.feitos}/${estado.total}] versao ${candidato.versao_id} ` +
    `(${candidato.extensao}) ${formatarMs(duracao)} ${marca}\n`
  )
}

/** Roda N por vez, cada trabalhador puxando o proximo da fila. */
const emParalelo = async (itens, n, tarefa) => {
  let proximo = 0
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const meu = proximo
      proximo += 1
      await tarefa(itens[meu])
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, trabalhador))
}

const principal = async () => {
  const cliente = new Client(conexao)
  await cliente.connect()

  try {
    const { rows } = await cliente.query(SQL_CANDIDATOS, [VERSAO, REFAZER_ERROS])

    if (EMBARALHAR) {
      for (let i = rows.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[rows[i], rows[j]] = [rows[j], rows[i]]
      }
    }

    const candidatos = LIMITE ? rows.slice(0, LIMITE) : rows

    console.log(`candidatas: ${rows.length}${LIMITE ? ` (processando ${candidatos.length})` : ''}`)
    console.log(`concorrencia: ${CONCORRENCIA}`)
    if (DRY_RUN) console.log('DRY-RUN: renderiza de verdade e NAO grava\n')
    else console.log('')

    if (!candidatos.length) {
      console.log('nada a fazer.')
      return
    }

    const estado = {
      total: candidatos.length,
      feitos: 0,
      sucessos: 0,
      falhas: 0,
      bytes: 0,
      ms: 0,
      porExtensao: {},
      motivos: {}
    }

    const relogio = Date.now()
    await emParalelo(candidatos, CONCORRENCIA, (c) => processarUm(cliente, c, estado))
    const parede = Date.now() - relogio

    const medioBytes = estado.sucessos ? estado.bytes / estado.sucessos : 0
    const medioMs = estado.sucessos ? estado.ms / estado.sucessos : 0

    console.log('\n--- resumo ---')
    console.log(`sucesso:            ${estado.sucessos}`)
    console.log(`falha:              ${estado.falhas}`)
    console.log(`por extensao:       ${JSON.stringify(estado.porExtensao)}`)
    console.log(`tamanho medio:      ${formatarBytes(medioBytes)}`)
    console.log(`tempo medio/arquivo:${formatarMs(medioMs)}`)
    console.log(`tempo de parede:    ${formatarMs(parede)}`)

    if (estado.falhas) {
      console.log('\nmotivos de falha:')
      for (const [motivo, n] of Object.entries(estado.motivos).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${n}x  ${motivo}`)
      }
    }

    // A projecao serve para decidir ESCALAR ou nao, e por isso usa o tempo de
    // parede medido, ja com a concorrencia desta execucao, e nao o tempo por
    // arquivo (que ignoraria o paralelismo e mentiria por um fator de N).
    if (LIMITE && rows.length > candidatos.length && estado.sucessos) {
      const fator = rows.length / candidatos.length
      console.log('\n--- projecao para as candidatas restantes ---')
      console.log(`candidatas totais:  ${rows.length}`)
      console.log(`tempo estimado:     ${(parede * fator / 60000).toFixed(0)} min`)
      console.log(`espaco estimado:    ${(medioBytes * rows.length / (1024 * 1024)).toFixed(0)} MB`)
    }
  } finally {
    await cliente.end()
  }
}

principal().catch((e) => {
  console.error(`\nERRO: ${(e && e.message) || e}`)
  process.exit(1)
})
