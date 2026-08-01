#!/usr/bin/env node
'use strict'

// mapoteca - interface de linha de comando da Mapoteca do SCA, para AGENTES.
//
// O mapoteca_client serve humanos; este CLI serve agentes. Sao dois clientes da
// mesma API, com ergonomias diferentes de proposito: a tela otimiza clique e
// descoberta visual, o CLI otimiza contexto e encadeamento.
//
// Cinco principios, e o codigo os segue:
//   1. Nada de contrato copiado. Campos, tipos e obrigatorios saem do Joi vivo
//      do server/ em tempo de execucao. Nao ha catalogo nem arquivo gerado para
//      apodrecer.
//   2. A prosa curada (lib/regras.js) cobre SO o que o describe() nao alcanca.
//      O que o Joi ja diz nao se repete la, para nao haver duas verdades.
//   3. Saida compacta por padrao. O consumidor tem janela finita: --json existe
//      para encadear, mas nao e o default.
//   4. Verbos de intencao, nao espelho do CRUD. Verbo que precisasse de regra de
//      negocio NOVA pertenceria ao backend, nao a este CLI.
//   5. O guardrail mora na interface: validacao local, --dry-run offline e
//      confirmacao antes do irreversivel ficam aqui, nao na skill que chama.
//      Skill e de um cliente so; a interface serve todos.

const argsLib = require('./lib/args')
const { resolver } = require('./lib/config')
const { RECURSOS, DOMINIOS, RELATORIOS, listarChaves } = require('./lib/recursos')

// Subcomandos de `pedido` que sao verbo de intencao, e nao o CRUD generico.
const VERBOS_PEDIDO = new Set(['cadastrar', 'itens', 'situacao', 'corrigir', 'anexar', 'anexos'])

const AJUDA = `mapoteca - CLI da Mapoteca do SCA (pedidos de cartas), para agentes

CONTRATO (nao gasta rede; leia isto antes de montar um corpo)
  mapoteca schema                 lista os recursos e as regras gerais
  mapoteca schema pedido          campos, tipos, obrigatorios e regras do pedido
  mapoteca dominio                quais dominios existem (GET publico)
  mapoteca dominio situacao_pedido    os codes de um deles

RESOLVER (o passo caro do dia a dia: documento -> identificador da API)
  mapoteca resolver 2962-4-NE 2963-1        folha -> uuid_versao no acervo
  mapoteca resolver --plano pedido.json     resolve os MIs de um plano inteiro
  mapoteca cliente resolver "6 RCB"         sigla -> cliente_id (evita duplicar OM)

PEDIDO (verbos de intencao)
  mapoteca pedido cadastrar --plano pedido.json [--dry-run]
      cria o cliente se preciso, o pedido, os itens e sobe os anexos, numa so
      invocacao, e confere lendo de volta. Idempotente: rodar de novo completa.
  mapoteca pedido itens    --id 42          so os itens, recortados
  mapoteca pedido situacao --id 42 --situacao 5 --data-atendimento 2026-07-24
      le o pedido, troca so o que muda e reenvia o corpo completo (o PUT da
      mapoteca SUBSTITUI a linha: mandar so um campo apaga o resto)
  mapoteca pedido corrigir --id 29 documento_solicitacao="PIT 07" previsto_pit=true
      mesma leitura-altera-reenvia do situacao, para QUALQUER campo. Os pares
      campo=valor vao posicionais (flag repetida sobrescreveria a anterior).
      Aceita null, true e false literais. --dry-run mostra o diff campo a campo.
  mapoteca item mover --de 43 --para 56 [--ids 449,462]
      troca o pedido_id do item, sem apagar e recriar: preserva quantidade
      fornecida, data de entrega e observacao. Sem --ids, move todos.
  mapoteca pedido anexar   --id 42 --file DIEx_123_6RCB.pdf [--tipo-anexo 1]
  mapoteca pedido anexos   --id 42
  mapoteca imprimir --item 88 --qtd 5       registra a impressao de um item

ACOMPANHAMENTO
  mapoteca pendentes [--dias 15]  a fila em aberto, ordenada pelo prazo
  mapoteca painel [--ano 2026]    resumo do ano (pedidos, entregas, OMs, custo)
  mapoteca relatorio              as abas da planilha de controle
  mapoteca relatorio detalhado --ano 2026 --csv    grava o CSV do servidor
  mapoteca anuario --ano 2026 --mes 7 [--ods]      Anuario Estatistico (Tab 5.4.9)
  mapoteca localizador ABCD-EFGH-IJKL   consulta publica de um pedido

RECURSOS  (${listarChaves().join(', ')})
  mapoteca <recurso> listar [--campos a,b] [--formato tsv|tabela|json]
  mapoteca <recurso> obter     --id 42
  mapoteca <recurso> criar     --data '{...}'              [--dry-run]
  mapoteca <recurso> atualizar --data '{...}'              [--dry-run]
      o id vai no CORPO, e o PUT substitui a linha inteira
  mapoteca <recurso> deletar   --ids 42,43 --confirmar 42,43
      o DELETE e sempre em LOTE e e irreversivel

SESSAO
  mapoteca status                 o SCA esta no ar? ha token em cache?
  mapoteca login                  autentica uma vez e guarda o token
  mapoteca logout                 descarta o token em cache

AMBIENTE  (catalogo em env-guia.md; nunca ponha senha na linha de comando)
  SCA_URL     URL do backend, ex.: http://IP:porta
  SCA_USER    login de admin      SCA_SENHA   senha
  SCA_TOKEN   JWT pronto (dispensa login)

FLAGS GLOBAIS
  --json          saida crua e completa (para encadear)
  --formato       tsv (padrao) | tabela | json
  --campos a,b    recorta colunas na listagem
  --dry-run       valida contra o Joi e mostra a requisicao, SEM tocar a rede
  --server URL    sobrepoe SCA_URL
  --insecure      aceita HTTPS com certificado self-signed
  --sem-cache     nao le nem grava o token em cache

Leitura exige login; toda ESCRITA exige administrador. Publicos: /api (health),
/api/login, os GET de /api/mapoteca/dominio e a consulta por localizador.`

const ROTEADOR = {
  schema: './comandos/schema',
  dominio: './comandos/dominio',
  resolver: './comandos/resolver',
  imprimir: './comandos/pedido',
  pendentes: './comandos/relatorio',
  painel: './comandos/relatorio',
  relatorio: './comandos/relatorio',
  anuario: './comandos/relatorio',
  localizador: './comandos/relatorio',
  login: './comandos/sessao',
  logout: './comandos/sessao',
  status: './comandos/sessao'
}

/**
 * Escolhe o modulo que atende a invocacao.
 *
 * Um recurso cai no CRUD generico, EXCETO quando o subcomando e um verbo de
 * intencao (mapoteca pedido cadastrar, mapoteca cliente resolver). E o unico
 * ponto do CLI que precisa saber que os dois convivem sob o mesmo nome.
 */
function escolherModulo (comando, sub) {
  if (comando === 'pedido' && VERBOS_PEDIDO.has(sub)) return './comandos/pedido'
  // `item mover` mexe em item, mas so faz sentido entre dois PEDIDOS, e por
  // isso mora no modulo do pedido, junto do resto que remonta corpo completo.
  if (comando === 'item' && sub === 'mover') return './comandos/pedido'
  if (comando === 'cliente' && sub === 'resolver') return './comandos/resolver'
  if (ROTEADOR[comando]) return ROTEADOR[comando]
  if (RECURSOS[comando]) return './comandos/crud'
  return null
}

async function principal () {
  const args = argsLib.parse(process.argv.slice(2))
  const comando = args._[0]

  if (!comando || args.flags.ajuda || args.flags.help) {
    process.stdout.write(AJUDA + '\n')
    return 0
  }

  const modulo = escolherModulo(comando, args._[1])

  if (!modulo) {
    process.stderr.write(
      `Comando desconhecido: "${comando}".\n` +
      `Comandos: ${Object.keys(ROTEADOR).join(', ')}.\n` +
      `Recursos: ${listarChaves().join(', ')}.\n` +
      'Use mapoteca --ajuda para o mapa completo.\n'
    )
    return 1
  }

  const cmd = require(modulo)
  // Comandos que so leem o schema local (mapoteca schema) nao exigem servidor
  // nem credencial: o contrato e conhecimento estatico do repo. Com --dry-run,
  // idem: valida contra o Joi e mostra a requisicao, sem tocar a rede.
  //
  // precisaServidor pode ser funcao: ha comandos que so as vezes falam com a
  // rede (mapoteca relatorio sem argumento lista as abas, com argumento busca
  // os dados). Exigir URL para a listagem seria pedir configuracao para uma
  // pergunta que o CLI responde sozinho.
  const precisa = typeof cmd.precisaServidor === 'function'
    ? cmd.precisaServidor(args)
    : cmd.precisaServidor
  const cfg = precisa
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

// So executa quando invocado como programa. Sob require (os testes importam o
// roteamento) o arquivo apenas exporta, sem disparar nada.
if (require.main === module) {
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
}

module.exports = { escolherModulo, AJUDA, VERBOS_PEDIDO, DOMINIOS, RELATORIOS }
