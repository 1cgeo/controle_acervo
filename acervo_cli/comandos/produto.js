'use strict'

// `acervo produto` - o encadeamento mais repetido do dia a dia do acervo,
// colapsado num comando:
//
//   acervo produto 2965-2                   busca a folha e lista as versoes dela
//   acervo produto 2965-2 --escala 50k --tipo carta-topografica
//   acervo produto --id 4211 --arquivos     os arquivos de cada versao
//   acervo produto --id 4211 --arquivos --caminho    com o caminho no volume
//
// Hoje, responder "que edicoes tem essa carta?" custa GET /acervo/busca (para
// achar o produto_id), GET /acervo/produto/detalhado/<id> (que devolve produto +
// versoes + relacionamentos + arquivos aninhados) e um recorte manual. Responder
// "qual e o arquivo mais recente do MI X?" custa ainda um GET
// /volumes/volume_armazenamento para montar o caminho. Este verbo faz a cadeia e
// devolve TSV.
//
// Nao ha regra nova: e busca, detalhe e juncao com o volume, tudo do servidor.
// O CLI so escolhe o que mostrar.

const http = require('../lib/http')
const saida = require('../lib/saida')
const argsLib = require('../lib/args')
const dominios = require('../lib/dominios')

/** Resolve o produto_id: --id explicito, ou busca pelo termo posicional. */
async function resolverProduto (args, cfg) {
  const flags = args.flags
  if (flags.id !== undefined && flags.id !== true) {
    return { id: Number(flags.id), avisos: [] }
  }

  const termo = args._[1]
  if (!termo) {
    throw new Error(
      'Informe o termo de busca (MI, INOM ou nome) ou --id do produto.\n' +
      '  acervo produto 2965-2\n' +
      '  acervo produto --id 4211'
    )
  }

  const params = { termo, limit: 50 }
  if (flags.escala) params.tipo_escala_id = dominios.resolver('tipo_escala', flags.escala)
  if (flags.tipo) params.tipo_produto_id = dominios.resolver('tipo_produto', flags.tipo)

  const r = await http.autenticada(cfg, 'GET', '/acervo/busca' + http.query(params))
  const achados = (r.dados && r.dados.dados) || []

  if (!achados.length) {
    throw new Error(
      `Nenhum produto casa com "${termo}"` +
      (params.tipo_escala_id ? ` na escala pedida` : '') + '.\n' +
      'A busca casa por ILIKE em nome, mi e inom. Confira a grafia da folha.'
    )
  }

  if (achados.length > 1) {
    // Ambiguidade nao se resolve por chute: a mesma folha costuma ter Carta
    // Topografica e Ortoimagem (produtos distintos), e ainda a versao militar.
    // Escolher "o primeiro" aqui e como o agente acaba lendo a carta errada.
    return { id: null, candidatos: achados, avisos: [] }
  }

  return { id: Number(achados[0].id), avisos: [] }
}

/** Mapa volume_armazenamento_id -> caminho do volume (uma chamada, admin). */
async function mapaVolumes (cfg) {
  const r = await http.autenticada(cfg, 'GET', '/volumes/volume_armazenamento')
  const mapa = new Map()
  for (const v of r.dados || []) mapa.set(Number(v.id), v.volume)
  return mapa
}

async function executar (args, cfg) {
  const flags = args.flags
  const opcoesSaida = {
    formato: flags.json ? 'json' : (flags.formato || 'tsv'),
    campos: argsLib.lista(flags.campos)
  }

  const alvo = await resolverProduto(args, cfg)

  if (alvo.candidatos) {
    const out = saida.lista(alvo.candidatos, {
      ...opcoesSaida,
      padrao: ['id', 'nome', 'mi', 'inom', 'escala', 'tipo_produto', 'num_versoes']
    })
    return {
      texto: out.texto + '\nMais de um produto casa com o termo. Escolha um: acervo produto --id <id>',
      avisos: out.avisos
    }
  }

  const r = await http.autenticada(cfg, 'GET', `/acervo/produto/detalhado/${alvo.id}`)
  const p = r.dados || {}

  if (flags.json) return { texto: JSON.stringify(p, null, 2) }

  const versoes = p.versoes || []
  const cabecalho = [
    `produto ${p.id}  ${p.nome || '(sem nome)'}`,
    `  mi ${p.mi || '-'}   inom ${p.inom || '-'}   escala ${p.escala || p.tipo_escala_id}   ` +
      `tipo_produto_id ${p.tipo_produto_id}`,
    `  ${versoes.length} versao(oes)`,
    ''
  ]

  // ---- modo arquivos -----------------------------------------------------
  if (flags.arquivos) {
    const volumes = flags.caminho ? await mapaVolumes(cfg) : null
    const linhas = []
    for (const v of versoes) {
      for (const a of v.arquivos || []) {
        const linha = {
          versao_id: v.versao_id,
          versao: v.versao,
          data_edicao: v.versao_data_edicao,
          arquivo_id: a.id,
          tipo_arquivo: a.tipo_arquivo,
          nome_arquivo: a.nome_arquivo,
          extensao: a.extensao,
          tamanho_mb: a.tamanho_mb,
          checksum: a.checksum
        }
        if (volumes) {
          const base = volumes.get(Number(a.volume_armazenamento_id))
          // Junta volume + nome + extensao do mesmo jeito que o acervo monta o
          // destino; sem extensao (Tileserver) o nome_arquivo ja e a URL.
          linha.caminho = base && a.extensao
            ? `${base.replace(/[\\/]+$/, '')}/${a.nome_arquivo}.${a.extensao}`
            : a.nome_arquivo
        }
        linhas.push(linha)
      }
    }

    if (!linhas.length) {
      return {
        texto: cabecalho.join('\n') + '(nenhum arquivo; as versoes podem ser Registro Historico, que nasce sem arquivo)'
      }
    }

    linhas.sort((a, b) => String(b.data_edicao).localeCompare(String(a.data_edicao)))
    const padrao = ['versao_id', 'versao', 'data_edicao', 'arquivo_id', 'tipo_arquivo', 'nome_arquivo', 'extensao', 'tamanho_mb']
    if (flags.caminho) padrao.push('caminho')
    const out = saida.lista(linhas, { ...opcoesSaida, padrao })
    const aviso = flags.caminho
      ? ['O caminho contem pasta de rede: nao grave esta saida em arquivo versionado, wiki ou memoria.']
      : ['Para o caminho no volume (util para abrir o arquivo): --caminho']
    return { texto: cabecalho.join('\n') + out.texto, avisos: [...aviso, ...out.avisos] }
  }

  // ---- modo versoes (padrao) ---------------------------------------------
  if (!versoes.length) {
    return { texto: cabecalho.join('\n') + '(nenhuma versao cadastrada)' }
  }

  const linhas = versoes.map(v => ({
    versao_id: v.versao_id,
    versao: v.versao,
    nome_versao: v.nome_versao,
    tipo_versao_id: v.tipo_versao_id,
    subtipo_produto_id: v.subtipo_produto_id,
    data_criacao: v.versao_data_criacao,
    data_edicao: v.versao_data_edicao,
    lote: v.lote_nome,
    pit: v.lote_pit,
    orgao_produtor: v.orgao_produtor,
    arquivos: (v.arquivos || []).length,
    relacionamentos: (v.relacionamentos || []).length
  }))
  linhas.sort((a, b) => String(b.data_edicao).localeCompare(String(a.data_edicao)))

  const out = saida.lista(linhas, {
    ...opcoesSaida,
    padrao: ['versao_id', 'versao', 'tipo_versao_id', 'subtipo_produto_id', 'data_edicao', 'lote', 'arquivos', 'relacionamentos']
  })

  return {
    texto: cabecalho.join('\n') + out.texto +
      '\nArquivos de cada versao: --arquivos   |   com caminho no volume: --arquivos --caminho',
    avisos: out.avisos
  }
}

module.exports = { executar, precisaServidor: true }
