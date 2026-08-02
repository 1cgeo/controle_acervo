// Path: migrations\ensaiar_migracao.cjs
'use strict'

/**
 * Ensaia uma migração ANTES de aplicá-la em produção.
 *
 * NÃO é um dry-run raso que só imprime a intenção. Ele monta DOIS bancos
 * descartáveis e compara o resultado:
 *
 *   A) banco na versão ANTERIOR (o `er/` sem os arquivos que a migração
 *      introduz) e depois a MIGRAÇÃO aplicada por cima;
 *   B) banco novo, instalado direto pelo `er/` completo.
 *
 * Se a migração estiver certa, A e B têm o mesmo schema. É o único jeito de
 * provar que o caminho de ATUALIZAÇÃO chega onde a INSTALAÇÃO NOVA chega, que é
 * a promessa do README: `er/` é instalação nova, `migrations/` é atualização, e
 * nada garante sozinho que os dois convergem.
 *
 * Aplica a migração DUAS vezes no banco A, porque o README também promete
 * idempotência.
 *
 * A ordem dos arquivos `er/` sai do PRÓPRIO create_config.js, e não de uma
 * lista copiada aqui: lista copiada apodrece, e o dia em que alguém acrescentar
 * um arquivo lá este ensaio passaria sem exercitá-lo.
 *
 * Uso:
 *   node migrations/ensaiar_migracao.cjs \
 *     --migracao migrations/2026-07-28_ponto_controle.sql \
 *     --novos er/ponto_controle.sql \
 *     --versao-anterior 1.5.0 \
 *     --versao-esperada 1.6.0 \
 *     --schemas ponto_controle,acervo
 *
 * `--novos` são os arquivos de `er/` que a migração INTRODUZ: eles saem da
 * montagem do banco A, senão o "banco de ontem" já nasceria com o de hoje e o
 * ensaio aprovaria qualquer coisa.
 *
* Extensão .cjs, e não .js: o package.json da RAIZ declara "type": "module", então
 * um .js aqui seria lido como ESM e o require morreria. Mesma razão do
 * ecosystem.config.cjs.
 *
 * Conexão pelas mesmas variáveis do servidor (DB_SERVER, DB_PORT, DB_USER,
 * DB_PASSWORD). Cria e derruba `sca_ensaio_migrado` e `sca_ensaio_novo`; não
 * toca em nenhum outro banco.
 */

const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')
const { Client } = require('pg')

const RAIZ = path.resolve(__dirname, '..')

// --- Argumentos --------------------------------------------------------------

const argumentos = {}
for (let i = 2; i < process.argv.length; i += 2) {
  argumentos[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
}

// Aceita UMA migracao ou uma CADEIA separada por virgula, na ordem de
// aplicacao. A cadeia existe porque uma funcionalidade pode entrar em mais de um
// passo por boa razao: a rastreabilidade (2026-08-02) veio em dois, o primeiro
// criando o schema (reversivel por um DROP) e o segundo movendo dado que ja
// existia. Ensaiar so o primeiro reprovaria na versao, e ensaiar cada um
// isolado nao provaria o que interessa -- que a SEQUENCIA chega onde a
// instalacao nova chega.
const MIGRACAO = argumentos.migracao
const MIGRACOES = (argumentos.migracao || '').split(',').filter(Boolean)
const NOVOS = (argumentos.novos || '').split(',').filter(Boolean)
  .map(a => path.basename(a))
const VERSAO_ANTERIOR = argumentos['versao-anterior']
const VERSAO_ESPERADA = argumentos['versao-esperada']
const SCHEMAS = (argumentos.schemas || 'acervo').split(',').filter(Boolean)
// Revisao do git de onde sai o er/ do banco ANTERIOR. Sem ela, o banco
// "anterior" nasce com o er/ de hoje, e migracao que muda CONTEUDO (dominio,
// default, codigo) passa sem ser exercitada.
const ER_DE = argumentos['er-de']

if (!MIGRACAO) {
  console.error('Falta --migracao <arquivo>. Veja o cabeçalho deste arquivo.')
  process.exit(2)
}

/**
 * A ordem dos `er/` como o create_config.js a executa.
 *
 * Lida do arquivo, e não copiada: é o que faz um `er/` novo entrar sozinho no
 * ensaio. Se o formato daquela função mudar, este ensaio para de achar os
 * arquivos e reclama, em vez de rodar sobre uma lista velha.
 */
const ordemDoCreateConfig = () => {
  const fonte = fs.readFileSync(path.join(RAIZ, 'create_config.js'), 'utf8')
  const achados = [...fonte.matchAll(/readSqlFile\('\.\/er\/([\w.]+\.sql)'\)/g)]
    .map(m => m[1])
  // permissao*.sql recebe parâmetro (o nome do role) e não entra no ensaio.
  const ordem = achados.filter(a => !a.startsWith('permissao'))
  if (ordem.length === 0) {
    throw new Error(
      'Não achei nenhum er/*.sql em create_config.js. O formato mudou?'
    )
  }
  return [...new Set(ordem)]
}

const conexao = {
  host: process.env.DB_SERVER || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres'
}

// --- Bancada -----------------------------------------------------------------

const recriar = async nome => {
  const mestre = new Client({ ...conexao, database: 'postgres' })
  await mestre.connect()
  await mestre.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [nome]
  )
  await mestre.query(`DROP DATABASE IF EXISTS ${nome}`)
  await mestre.query(`CREATE DATABASE ${nome}`)
  await mestre.end()

  const c = new Client({ ...conexao, database: nome })
  await c.connect()
  await c.query('CREATE EXTENSION IF NOT EXISTS postgis')
  await c.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
  return c
}

/**
 * Le um er/*.sql, opcionalmente de uma REVISAO do git.
 *
 * O `--er-de` existe por um erro real (2026-07-29): a migracao trocava o
 * dominio de nove codigos para dois, e o ensaio montou o banco "anterior" com o
 * er/ de HOJE, que ja tinha os dois. A migracao virou no-op e o ensaio aprovou
 * sem exercitar nada. Versao o script ja forcava; o CONTEUDO, nao.
 *
 * A bancada do "antes" tem de ser o estado anterior DE VERDADE.
 */
const lerEr = (arquivo, revisao) => {
  if (!revisao) {
    const caminho = path.join(RAIZ, 'er', arquivo)
    return fs.existsSync(caminho) ? fs.readFileSync(caminho, 'utf8') : null
  }
  try {
    return execSync(`git show ${revisao}:er/${arquivo}`, {
      cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
    })
  } catch {
    // Arquivo que ainda nao existia naquela revisao: e o caso normal do
    // schema recem-criado, e o banco "anterior" deve mesmo ficar sem ele.
    return null
  }
}

const rodarEr = async (cliente, ordem, revisao) => {
  for (const arquivo of ordem) {
    const sql = lerEr(arquivo, revisao)
    if (!sql) continue
    try {
      await cliente.query(sql)
    } catch (e) {
      throw new Error(`er/${arquivo}${revisao ? ' @' + revisao : ''}: ${e.message}`)
    }
  }
}

// --- A radiografia do schema -------------------------------------------------
//
// Coluna a coluna, com tipo, nulidade e default; mais restrições, índices e os
// CÓDIGOS de domínio. Os códigos entram porque migração que cria a tabela e
// esquece o INSERT deixa a tela sem opção nenhuma, e o schema pareceria igual.

const lista = SCHEMAS.map(s => `'${s}'`).join(', ')

const CONSULTAS = {
  COLUNAS: `
    SELECT table_schema || '.' || table_name || '.' || column_name || ' :: ' ||
           data_type ||
           COALESCE('(' || character_maximum_length || ')', '') ||
           ' null=' || is_nullable ||
           ' default=' || COALESCE(column_default, '-') AS linha
    FROM information_schema.columns
    WHERE table_schema IN (${lista})
    ORDER BY 1`,

  RESTRICOES: `
    SELECT n.nspname || '.' || c.conname || ' :: ' || pg_get_constraintdef(c.oid) AS linha
    FROM pg_constraint c
    INNER JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname IN (${lista})
    ORDER BY 1`,

  INDICES: `
    SELECT schemaname || '.' || indexname || ' :: ' || indexdef AS linha
    FROM pg_indexes
    WHERE schemaname IN (${lista})
    ORDER BY 1`,

  // Funcao e trigger dos schemas em exame, com a ASSINATURA e o CORPO.
  //
  // Entrou em 2026-07-29, depois de um caso real: a `acervo.nome_arquivo_padrao`
  // existia so na migration e nunca foi para o `er/`, entao o banco atualizado a
  // tinha e a INSTALACAO NOVA nao. O ensaio aprovou assim mesmo, porque olhava
  // coluna, restricao e indice, e funcao nao e nenhuma das tres. Quem pegou foi
  // o teste da auditoria, por acaso e tarde.
  //
  // Compara o corpo, e nao so o nome: funcao que existe dos dois lados com regra
  // diferente e pior do que funcao ausente, porque nada acusa.
  FUNCOES: `
    SELECT n.nspname || '.' || p.proname || '(' ||
           pg_get_function_identity_arguments(p.oid) || ') => ' ||
           -- Sem tirar o CR o corpo diverge por FIM DE LINHA. Com --er-de, o
           -- git show entrega LF e a copia de trabalho no Windows tem CRLF;
           -- sem normalizar, as 21 funcoes divergiam TODAS e o ensaio acusaria
           -- defeito onde so ha fim de linha.
           md5(replace(pg_get_functiondef(p.oid), chr(13), '')) AS linha
    FROM pg_proc AS p
    INNER JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname IN (${lista})
    ORDER BY 1`,

  GATILHOS: `
    SELECT event_object_schema || '.' || event_object_table || '.' ||
           trigger_name || ' ' || action_timing || ' ' || event_manipulation ||
           ' => ' || replace(action_statement, E'
', '') AS linha
    FROM information_schema.triggers
    WHERE event_object_schema IN (${lista})
    ORDER BY 1`,

  // Toda tabela de código dos schemas em exame, linha a linha. Descobre as
  // tabelas pela FORMA (tem `code` e um rótulo), em vez de listá-las aqui.
  DOMINIOS: `
    SELECT string_agg(
      format('SELECT %L || '' '' || code || ''='' || %I AS linha FROM %I.%I',
             table_name, rotulo, table_schema, table_name),
      ' UNION ALL ')
    FROM (
      SELECT c.table_schema, c.table_name,
             MIN(c2.column_name) AS rotulo
      FROM information_schema.columns AS c
      INNER JOIN information_schema.columns AS c2
        ON c2.table_schema = c.table_schema AND c2.table_name = c.table_name
       AND c2.column_name IN ('nome', 'code_name')
      WHERE c.table_schema IN (${lista}) AND c.column_name = 'code'
      GROUP BY c.table_schema, c.table_name
    ) AS t`
}

const radiografia = async cliente => {
  const partes = {}
  for (const chave of ['COLUNAS', 'RESTRICOES', 'INDICES', 'FUNCOES', 'GATILHOS']) {
    const r = await cliente.query(CONSULTAS[chave])
    partes[chave] = r.rows.map(x => x.linha)
  }

  const montagem = await cliente.query(CONSULTAS.DOMINIOS)
  const sql = montagem.rows[0] && montagem.rows[0].string_agg
  if (sql) {
    const r = await cliente.query(`SELECT linha FROM (${sql}) AS d ORDER BY 1`)
    partes.DOMINIOS = r.rows.map(x => x.linha)
  } else {
    partes.DOMINIOS = []
  }
  return partes
}

const comparar = (a, b) => {
  const problemas = []
  for (const chave of Object.keys(a)) {
    for (const x of a[chave].filter(x => !b[chave].includes(x))) {
      problemas.push(`[${chave}] só no MIGRADO: ${x}`)
    }
    for (const x of b[chave].filter(x => !a[chave].includes(x))) {
      problemas.push(`[${chave}] só no NOVO:    ${x}`)
    }
  }
  return problemas
}

// --- Execução ----------------------------------------------------------------

;(async () => {
  const sqls = MIGRACOES.map(m => ({
    nome: m,
    sql: fs.readFileSync(path.join(RAIZ, m), 'utf8')
  }))
  const ordemCompleta = ordemDoCreateConfig()
  const ordemAnterior = ordemCompleta.filter(a => !NOVOS.includes(a))

  console.log(`migração: ${MIGRACOES.join(' -> ')}`)
  console.log(`er/ do banco anterior: ${ordemAnterior.join(', ')}`)
  console.log(`er/ vindo de: ${ER_DE || 'working tree (ATENCAO: so serve se a migracao nao mudar CONTEUDO do er/)'}`)
  console.log(`schemas comparados: ${SCHEMAS.join(', ')}`)
  console.log('')

  console.log('A) banco na versão ANTERIOR')
  const a = await recriar('sca_ensaio_migrado')
  await rodarEr(a, ordemAnterior, ER_DE)

  // O er/versao.sql do repo JÁ está na versão de destino, então o banco
  // "anterior" nasceria com ela e o UPDATE da migração seria um no-op
  // disfarçado de sucesso. Aqui ele volta à versão de verdade.
  if (VERSAO_ANTERIOR) {
    await a.query('UPDATE public.versao SET nome = $1 WHERE code = 1', [
      VERSAO_ANTERIOR
    ])
  }
  const antes = (await a.query('SELECT nome FROM public.versao WHERE code = 1'))
    .rows[0].nome
  console.log(`   versão antes: ${antes}`)

  console.log('   aplicando a migração...')
  for (const { nome, sql } of sqls) {
    if (sqls.length > 1) console.log(`     ${nome}`)
    await a.query(sql)
  }
  const depois = (await a.query('SELECT nome FROM public.versao WHERE code = 1'))
    .rows[0].nome
  console.log(`   versão depois: ${depois}`)
  if (VERSAO_ESPERADA && depois !== VERSAO_ESPERADA) {
    throw new Error(
      `a migração não levou a versão a ${VERSAO_ESPERADA}: ficou em ${depois}`
    )
  }

  // A CADEIA inteira de novo, e nao cada uma isolada: em producao ninguem
  // reaplica so o passo do meio.
  console.log('   aplicando a MESMA migração de novo (idempotência)...')
  for (const { sql } of sqls) {
    await a.query(sql)
  }
  console.log('   passou duas vezes.')

  console.log('B) banco novo pelo er/ completo')
  const b = await recriar('sca_ensaio_novo')
  await rodarEr(b, ordemCompleta)

  const radA = await radiografia(a)
  const radB = await radiografia(b)
  const problemas = comparar(radA, radB)

  console.log('')
  console.log(`colunas conferidas:        ${radA.COLUNAS.length}`)
  console.log(`funcoes conferidas:        ${radA.FUNCOES.length}`)
  console.log(`gatilhos conferidos:       ${radA.GATILHOS.length}`)
  console.log(`restrições conferidas:     ${radA.RESTRICOES.length}`)
  console.log(`índices conferidos:        ${radA.INDICES.length}`)
  console.log(`códigos de domínio:        ${radA.DOMINIOS.length}`)
  console.log('')

  if (problemas.length === 0) {
    console.log('RESULTADO: o banco MIGRADO e o banco NOVO têm o mesmo schema.')
  } else {
    console.log(`RESULTADO: ${problemas.length} divergência(s):`)
    for (const p of problemas) console.log('  ' + p)
  }

  await a.end()
  await b.end()
  process.exit(problemas.length === 0 ? 0 : 1)
})().catch(e => {
  console.error('FALHOU:', e.message)
  process.exit(2)
})
