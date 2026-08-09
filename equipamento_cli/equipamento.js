#!/usr/bin/env node
'use strict'

// equipamento - CLI do modulo equipamento do SAP, desenhado para AGENTES.
//
// O client web serve humanos; este CLI serve agentes. Sao dois clientes da mesma
// API, com ergonomias diferentes de proposito: a tela otimiza clique e
// descoberta visual, o CLI otimiza contexto e encadeamento.
//
// Irmao do acervo_cli, do mapoteca_cli e do orcamento_cli: mesmo servidor, mesmo
// login, mesma sessao em cache. Muda so o modulo com que cada um fala.
//
// Tres principios, e o codigo os segue:
//   1. Nada de contrato copiado. Campos, tipos, obrigatorios e filtros saem do
//      Joi vivo do server/ em tempo de execucao. Nao ha arquivo gerado para
//      apodrecer, e uma coluna nova no schema vira flag aceita no mesmo commit.
//   2. Saida compacta por padrao. O consumidor tem janela finita: --json existe
//      para encadear, mas nao e o default.
//   3. O guardrail mora na interface. O PUT deste modulo SUBSTITUI a linha, e
//      quem protege disso e o ciclo ler-mesclar-reenviar destes comandos, nao a
//      skill que os chama: skill e de um cliente so, a interface serve todos.

const argsLib = require('./lib/args')
const { resolver } = require('./lib/config')
const { listarChaves, historicos } = require('./lib/recursos')

const AJUDA = `equipamento - CLI do módulo equipamento do SAP, para agentes

O parque de material da Divisão: estação total, GNSS, plotter, drone. O que
temos, em que situação cada bem está HOJE, e o que já aconteceu com ele.

CONTRATO (não gasta rede, leia isto antes de montar um corpo)
  equipamento schema                    lista os recursos e as regras gerais
  equipamento schema manutencao         campos, tipos, obrigatórios e regras
  equipamento dominio                   os códigos que entram nos campos *_id

O PARQUE
  equipamento listar [--situacao_id N] [--secao_detentora_id N] [--tipo_id N] [--ativo false]
  equipamento ver --id 12
  equipamento ver --patrimonio 104820700014462
  equipamento dashboard                 o retrato de hoje, em seis blocos
  equipamento relatorio dmt --para relatorio_dmt.ods

A CARGA  (perfil GERENTE)
  equipamento cadastrar --nr_patrimonio ... --classe_id 6 --tipo_id 1 --modelo "..." --secao_detentora_id 1
  equipamento alterar --id 12 --nr_serie ABC123
  equipamento baixar  --id 12           dá BAIXA no bem (ativo = false)
  equipamento apagar  --id 12 --confirmar 12

O QUE ACONTECE COM O BEM  (perfil OPERADOR; transferência é de GERENTE)
  equipamento <historico> listar [--equipamento_id N] [--aberta]
  equipamento <historico> abrir  --equipamento_id N --data_inicio AAAA-MM-DD ...
  equipamento <historico> fechar --id N --data_fim AAAA-MM-DD
  equipamento <historico> editar --id N --<campo> <valor>
  equipamento <historico> apagar --id N --confirmar N
  <historico>: ${historicos().join(', ')}
  transferência não tem fechar (não tem data_fim): use editar --situacao_id <code>
  e o verbo de criação dela chama-se lancar

TIPO DE EQUIPAMENTO  (é cadastro, não domínio)
  equipamento tipo listar
  equipamento tipo cadastrar --nome "Estação Total" --vida_util_meses 120
  equipamento tipo alterar --id 3 --ativo false
  equipamento tipo apagar --id 3 --confirmar 3

SESSÃO
  equipamento status                    o SAP está no ar? há token em cache?
  equipamento login                     autentica uma vez e guarda o token (~1h)
  equipamento logout                    descarta o token em cache

AMBIENTE  (nunca ponha senha na linha de comando)
  SCA_URL     URL do backend do SAP
  SCA_USER    login                     SCA_SENHA   senha
  SCA_TOKEN   JWT pronto (dispensa login)

FLAGS GLOBAIS
  --json          saída crua e completa (para encadear)
  --formato       tsv (padrão) | tabela | json
  --campos a,b    recorta colunas na listagem
  --data '{...}'  corpo inteiro em JSON (--data-file lê de arquivo)
  --<campo> v     um campo do corpo; os nomes saem do schema Joi vivo
  --<campo> null  limpa o campo (o PUT substitui a linha)
  --dry-run       monta e mostra a requisição, não envia
  --server URL    sobrepõe SCA_URL
  --insecure      aceita HTTPS com certificado self-signed
  --sem-cache     não lê nem grava o token em cache

O PUT DESTE MÓDULO SUBSTITUI A LINHA INTEIRA. Por isso alterar, editar e fechar
LEEM o registro, aplicam o que muda e reenviam o corpo completo, e imprimem o
antes e o depois de cada campo. Campo com default no schema (ativo,
transferido_siafi, apropriado_siafi) volta ao default quando omitido: default é
valor, não ausência.

Acesso por perfil no módulo equipamento: consulta lê, operador lança o que
acontece com o bem e cadastra tipo, gerente mexe na carga (bem, transferência e
remoção de tipo). O administrador passa em tudo. O CLI não afrouxa nada: quem
recusa é o servidor. Recursos: ${listarChaves().join(', ')}.`

// Verbos do BEM que sao comandos de primeiro nivel: o bem e o assunto do modulo,
// e `equipamento listar` le melhor que `equipamento bem listar`.
const VERBOS_BEM = ['listar', 'ver', 'cadastrar', 'alterar', 'baixar', 'apagar']

const ROTEADOR = {
  schema: './comandos/schema',
  dominio: './comandos/dominio',
  dashboard: './comandos/painel',
  painel: './comandos/painel',
  relatorio: './comandos/relatorio',
  tipo: './comandos/tipo',
  // `tipos` no plural e aceito porque e como se fala da tela.
  tipos: './comandos/tipo',
  login: './comandos/sessao',
  logout: './comandos/sessao',
  status: './comandos/sessao'
}

for (const verbo of VERBOS_BEM) ROTEADOR[verbo] = './comandos/bem'
for (const chave of historicos()) ROTEADOR[chave] = './comandos/historico'

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
      'Use equipamento --ajuda para o mapa completo.\n'
    )
    return 1
  }

  const cmd = require(modulo)
  // Comandos que so leem o schema local (equipamento schema) nao exigem servidor
  // nem credencial: o contrato e conhecimento estatico do repo. Com --dry-run,
  // idem, EXCETO nos verbos que precisam ler o registro para montar o corpo
  // completo; esses cobram a URL na hora, com a mensagem de exigirServidor().
  //
  // `precisaServidor` aceita FUNCAO porque ha comando que so as vezes fala com a
  // rede: `equipamento relatorio` sem argumento so lista o que existe, e cobrar
  // SCA_URL para imprimir texto estatico esconderia a lista de quem ainda nao
  // configurou o ambiente.
  const precisa = typeof cmd.precisaServidor === 'function'
    ? cmd.precisaServidor(args)
    : cmd.precisaServidor
  const cfg = precisa ? resolver(args.flags, !args.flags['dry-run']) : null

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

module.exports = { AJUDA, ROTEADOR, VERBOS_BEM }
