'use strict'

// A aba EXTRA_PIT do RTM: a CAMADA DE DADOS, e só ela.
//
// O gerador do .ods é outro módulo (`rtm_ods.js`). Aqui moram duas coisas: a
// consulta que recorta o que a aba afirma, e a tradução das linhas do banco para
// as sete chaves da aba.
//
// ---------------------------------------------------------------------------
// A ABA É O CRUZAMENTO DE DUAS TABELAS, e foi medido
// ---------------------------------------------------------------------------
//
// Contra a produção, em 2026-09-11:
//
//   pit.demanda_extra, ano 2026 ....... 15 registros (11 Concluído, 3 Previsto,
//                                       1 Enviado; 12 com data_entrega)
//   LAI dentro dela ................... 0 (a busca por 'Lei de Acesso' na
//                                       descrição e no tipo_produto não achou)
//   aba EXTRA_PIT do RTM de agosto .... 44 linhas, 29 delas LAI
//   mapoteca.pedido, 2026 ............. 202, sendo LAI 34, Órgão Público
//                                       Estadual 2, Federal 1, Municipal 1
//
// Quinze contra quarenta e quatro: a demanda autorizada sozinha não é a aba.
// Quem completa é o pedido CIVIL da mapoteca, e o corte é por tipo de cliente.
// As duas fontes estão dentro do SAP 3.0, e o SAP antigo não entra em nenhuma
// das duas -- o vault registrava o contrário, e a medida desmente.
//
//   1. `pit.demanda_extra`: a exceção AUTORIZADA ao PIT (`documento_autorizacao`
//      é NOT NULL, er/pit.sql:524-548). É o lado militar e os apoios.
//   2. `mapoteca.pedido` de cliente LAI ou de órgão público, que é como a Lei de
//      Acesso à Informação chega ao SCA. O mesmo corte alimenta a subseção 3.4
//      do RPCMTec (`rpcmtec_ctrl.montarLai`).
//
// Cada linha carrega a coluna interna `origem`, que diz de qual das duas ela
// veio. Ela NÃO sai na planilha -- a aba tem sete colunas e nenhuma é essa --,
// mas existe no código e no teste, porque uma linha errada numa aba de 44 não se
// investiga sem saber em que tabela procurar.
//
// ---------------------------------------------------------------------------

const { db } = require('../database')
// DE QUEM É ESTA INSTALAÇÃO, no ponto único. Mesma razão do bloco OMDS de
// `mapoteca/relatorio_ctrl.js`: a coluna OMDS da aba é PARÂMETRO, e não coluna
// de tabela nenhuma.
const instituicaoCtrl = require('../instituicao/instituicao_ctrl')

const {
  domainConstants: { SITUACAO_EXTRA_PIT, SITUACAO_PEDIDO, TIPO_CLIENTE }
} = require('../utils')

// Fragmentos da mapoteca, e não reescritos aqui: `QTD_EFETIVA` é o lugar onde
// "quanto se entregou" tem UMA resposta, e `JOIN_PRODUTO_ITEM` é o LEFT que
// inclui o item avulso. O módulo só importa `utils`, então não há ciclo.
const {
  QTD_EFETIVA,
  JOIN_PRODUTO_ITEM
} = require('../mapoteca/query_fragments')

const controller = {}

// De qual das duas tabelas a linha veio. Coluna INTERNA: não sai na planilha.
const ORIGEM_LINHA = {
  DEMANDA_EXTRA: 'demanda_extra',
  PEDIDO_CIVIL: 'pedido_civil'
}

// ---------------------------------------------------------------------------
// RÉGUA 1: que DEMANDA EXTRA entra na aba
// ---------------------------------------------------------------------------
//
// `dominio.situacao_extra_pit` tem CINCO códigos (er/dominio.sql:429-434):
// Previsto (1), Em produção (2), Enviado (3), Concluído (4) e Cancelado (5).
//
// A aba do RTM lista o que foi ATENDIDO no período, então entram as duas
// situações que AFIRMAM que alguma coisa saiu daqui: Enviado e Concluído. É a
// mesma dupla que `pit/pit_extra_ctrl.js:39-42` já usa para cobrar
// materialização, e vem de `utils/domain_constants` em vez de reescrita em
// número aqui -- duas cópias dos códigos divergiriam na primeira que fosse
// corrigida, e uma régua que enumera família incompleta reprova o caso certo.
//
// Previsto e Em produção ficam de fora porque ainda não aconteceram, e Cancelado
// porque não vai acontecer. Reportar qualquer um dos três seria dizer que a
// Divisão entregou o que não entregou. Na produção de 2026 isso descarta 3
// Previsto de 15.
const SITUACOES_NA_ABA = [
  SITUACAO_EXTRA_PIT.ENVIADO,
  SITUACAO_EXTRA_PIT.CONCLUIDO
]

// ---------------------------------------------------------------------------
// RÉGUA 2: que PEDIDO da mapoteca entra na aba
// ---------------------------------------------------------------------------
//
// O corte é o TIPO DE CLIENTE, e o domínio inteiro está em er/mapoteca.sql:5-19:
//
//     INSERT INTO mapoteca.tipo_cliente (code, nome) VALUES
//     (1, 'OM EB'),
//     (2, 'OM Aeronáutica'),
//     (3, 'OM Marinha'),
//     (4, 'Órgão Publico Federal'),
//     (5, 'Órgão Publico Estadual'),
//     (6, 'Órgão Publico Municipal'),
//     (7, 'Pessoa Jurídica'),
//     (8, 'Pessoa Física'),
//     (9, 'Lei de Acesso à Informação (LAI)');
//
// Entram a LAI e os três órgãos públicos. As três OM militares (1, 2, 3) ficam
// de fora porque são a Meta 4 (impressão), que é a aba META4_DETALHADA ao lado,
// e contá-las aqui somaria a mesma entrega duas vezes no mesmo relatório.
//
// PESSOA JURÍDICA E PESSOA FÍSICA FICAM DE FORA, e isto é DECISÃO, não medida: a
// produção de 2026 tem ZERO pedido dos dois tipos (202 pedidos, 164 OM EB, 34
// LAI, 4 de órgão público), então nenhum dado desmente nem confirma a escolha. É
// pergunta para o chefe, e está no relatório.
const TIPOS_CLIENTE_NA_ABA = [
  TIPO_CLIENTE.LAI,
  TIPO_CLIENTE.ORGAO_PUBLICO_FEDERAL,
  TIPO_CLIENTE.ORGAO_PUBLICO_ESTADUAL,
  TIPO_CLIENTE.ORGAO_PUBLICO_MUNICIPAL
]

// Situações do pedido que AFIRMAM entrega, como a 3.1 e a 3.2 já as usam
// (`rpcmtec_ctrl.js:97`). Cancelado não é nem entregue nem pendente.
const SITUACOES_PEDIDO_ENTREGUE = [
  SITUACAO_PEDIDO.REMETIDO,
  SITUACAO_PEDIDO.CONCLUIDO
]

// ---------------------------------------------------------------------------
// O DEMANDANTE DA LAI É 'DSG', E ISSO NÃO ESTÁ NO BANCO
// ---------------------------------------------------------------------------
//
// No RTM de agosto, as 29 linhas de LAI têm TODAS `Demandante` = 'DSG', e não o
// nome de quem pediu. A explicação institucional é que o pedido de Lei de Acesso
// não chega ao 1º CGEO pelo cidadão: ele entra pelo e-SIC, a DSG o recebe e o
// encaminha, e quem demanda desta Divisão é a DSG. O NUP do próprio pedido diz o
// mesmo ('60143.000014/2026-78': o 60143 é a unidade protocoladora).
//
// SÓ QUE ISSO NÃO É COLUNA. `mapoteca.pedido.demandante` é VARCHAR(255) anulável
// e nada obriga o 'DSG' a estar lá, e `mapoteca.cliente.nome` não serve: o DDL
// semeia um cliente único para a LAI de cidadão e diz por quê
// (er/mapoteca.sql:141-145):
//
//     -- Cliente padrão para demanda de civil anônima / LAI de cidadão:
//     -- distingue-se pelo NUP, sem gravar dado pessoal do requerente (LGPD).
//     INSERT INTO mapoteca.cliente (nome, tipo_cliente_id) VALUES
//     ('Cidadão (LAI)', 9);
//
// Ou seja: o nome do cliente sai 'Cidadão (LAI)', que não é o que a planilha
// traz, e o nome de quem pediu o banco não guarda de propósito. A constante
// abaixo é do GERADOR, e é usada só como fallback: se o pedido tem `demandante`
// preenchido, é ele que sai.
//
// PERGUNTA PARA O CHEFE, e está no relatório: confirmar o 'DSG' como constante,
// ou fazer nascer a coluna que o diga. Enquanto for constante, ela é o que este
// repositório acabou de podar de `mapoteca.pedido.omds` -- uma constante
// disfarçada --, e fica aqui declarada como tal em vez de escondida numa query.
const DEMANDANTE_LAI = 'DSG'

// O rótulo com que a planilha abre TODA linha de LAI, medido nas 29 do RTM de
// agosto: 'Lei de Acesso a Informação ' seguido do NUP. Por extenso e sem crase,
// como está lá, e não a sigla.
const ROTULO_LAI = 'Lei de Acesso a Informação'

// E o que a planilha escreve quando o NUP falta, também medido (2 das 29
// linhas). A frase NOMEIA O SCA, o que é a pista de que estas linhas já saem de
// cá e não de uma planilha paralela.
const LAI_SEM_NUP = '(NUP não registrado no SCA)'

// ---------------------------------------------------------------------------
// As duas consultas, unidas
// ---------------------------------------------------------------------------
//
// O RECORTE É O DO RTM: o acumulado do EXERCÍCIO até o mês, e não o mês isolado.
// É o mesmo da rota `/rtm/ods` da META4_DETALHADA, e é o que a aba mostra (as
// datas do RTM de agosto vão de 08/01/26 a 30/07/26). Difere de propósito da
// subseção 3.3 do RPCMTec, que é SÓ do mês.
//
// O ANO SAI DE LUGARES DIFERENTES NOS DOIS LADOS, e a assimetria é do modelo:
// `pit.demanda_extra.ano` é o EXERCÍCIO do PIT (FK para `pit.pit`), e o pedido da
// mapoteca não tem exercício nenhum -- o ano dele é o da CONCLUSÃO
// (`data_atendimento`), que é a mesma data que a aba publica. Igualar os dois
// pelo ano da conclusão jogaria fora a demanda do exercício concluída na virada,
// e igualar pelo exercício exigiria do pedido uma coluna que não existe.
//
// NÃO HÁ PISO de data em nenhum dos dois: o teto do mês basta, e um
// `>= 1º de janeiro` jogaria fora, calado, o que ficou fora da janela.

const CONSULTA_DEMANDA_EXTRA = `
    SELECT
      '${ORIGEM_LINHA.DEMANDA_EXTRA}'::text AS origem,
      $<omds> AS omds,
      d.demandante::text AS demandante,
      -- A coluna C da aba ('Descrição do Produto/Serviço') sai de
      -- \`tipo_produto\`, e a coluna G ('Observação') sai de \`descricao\`. Os
      -- nomes se cruzam, e a medida decide: \`tipo_produto\` é VARCHAR(255) NOT
      -- NULL e a coluna C está preenchida em 44/44 linhas; \`descricao\` é TEXT
      -- anulável e a coluna G, em 41/44.
      d.tipo_produto::text AS produto,
      d.descricao::text AS nota,
      -- A quantidade DECLARADA, e não a materializada. Ver o bloco QUANTIDADE.
      d.quantidade AS quantidade,
      (
        SELECT count(*)::int FROM acervo.versao AS v
        WHERE v.demanda_extra_id = d.id
      ) AS quantidade_materializada,
      d.documento_autorizacao::text AS documento_autorizacao,
      -- ::text porque a coluna é DATE e a aba não tem fuso. O driver já devolve
      -- a cadeia crua (o type parser do OID 1082, em database/db.js), e o cast
      -- mantém isso verdadeiro mesmo que aquele parser mude.
      d.data_entrega::text AS data_conclusao,
      s.nome::text AS situacao,
      ('demanda_extra:' || d.id)::text AS referencia
    FROM pit.demanda_extra AS d
    INNER JOIN dominio.situacao_extra_pit AS s ON s.code = d.situacao_id
    WHERE d.ano = $<ano>
      -- E ENTRA SÓ A QUE TEM DATA. \`data_entrega\` é anulável, e nada no banco
      -- impede uma demanda Concluída sem data. Sem esta cláusula os dois
      -- recortes discordariam: a versão anual traria essa linha com a célula de
      -- data em branco, e a versão até o mês a deixaria cair sozinha, porque
      -- \`<\` sobre NULL não é verdadeiro.
      AND d.data_entrega IS NOT NULL
      AND d.situacao_id IN ($<situacoesExtra:csv>)`

const CONSULTA_PEDIDO_CIVIL = `
    SELECT
      '${ORIGEM_LINHA.PEDIDO_CIVIL}'::text AS origem,
      $<omds> AS omds,
      -- O que o pedido declarar; na falta, 'DSG' para a LAI (ver o bloco
      -- DEMANDANTE_LAI) e o nome do cliente para o órgão público, que é o que a
      -- planilha traz em 'UFRGS', 'COPEL' e 'Prefeitura de Dois Irmãos'.
      COALESCE(
        NULLIF(btrim(p.demandante), ''),
        CASE WHEN c.tipo_cliente_id = $<tipoLai>
             THEN $<demandanteLai>
             ELSE c.nome
        END
      )::text AS demandante,
      -- A coluna C. Na LAI é o rótulo mais o NUP, medido nas 29 linhas do RTM de
      -- agosto. No órgão público é o PRODUTO do pedido, que é o que a coluna
      -- pergunta; sem item cadastrado cai no ofício e depois no tipo de cliente,
      -- para a célula nunca sair vazia numa coluna que a planilha traz cheia.
      CASE WHEN c.tipo_cliente_id = $<tipoLai>
           THEN $<rotuloLai> || ' ' ||
                COALESCE(NULLIF(btrim(p.documento_solicitacao_nup), ''), $<laiSemNup>)
           ELSE COALESCE(
                  NULLIF(btrim(itens.produtos), ''),
                  NULLIF(btrim(p.documento_solicitacao), ''),
                  tc.nome
                )
      END::text AS produto,
      -- A coluna G. A planilha escreve 'Imbé / Fotos aéreas da cidade de
      -- Imbé-RS' quando há município e só o resumo quando não há
      -- ('Fotos aéreas no município de Canoas – RS'): é exatamente o que
      -- concat_ws faz, porque ele PULA o nulo em vez de deixar o separador solto.
      NULLIF(btrim(concat_ws(' / ',
        NULLIF(btrim(p.municipio), ''),
        NULLIF(btrim(p.observacao), '')
      )), '')::text AS nota,
      -- A quantidade do pedido CIVIL é a contagem de imagens, que é o campo que
      -- o DDL declara para este cliente ('Campos de pedido de CIVIL
      -- (LAI/órgão/empresa/pessoa); NULL para OM', er/mapoteca.sql:230-234) e o
      -- que explica os 151 e os 178 da coluna 'Qnt'. Sem ela, a soma dos itens
      -- impressos. Sem as duas fica NULA, e a célula sai VAZIA: um zero ali
      -- afirmaria que nada foi entregue.
      COALESCE(NULLIF(p.qtd_imagens, 0), NULLIF(itens.quantidade, 0)) AS quantidade,
      NULL::int AS quantidade_materializada,
      -- SEM DOCUMENTO DE AUTORIZAÇÃO, e é decisão. O ofício e o NUP são a
      -- SOLICITAÇÃO, e a coluna F existe para provar a AUTORIZAÇÃO da exceção --
      -- é o que torna \`pit.demanda_extra.documento_autorizacao\` NOT NULL.
      -- Pôr um no lugar do outro relabela um documento no exato campo que existe
      -- para distingui-los. E reproduz a planilha: no RTM de agosto a coluna F
      -- está preenchida em 2 de 44 linhas, nenhuma delas de LAI.
      NULL::text AS documento_autorizacao,
      p.data_atendimento::text AS data_conclusao,
      sp.nome::text AS situacao,
      ('pedido:' || p.id)::text AS referencia
    FROM mapoteca.pedido AS p
    INNER JOIN mapoteca.cliente AS c ON c.id = p.cliente_id
    INNER JOIN mapoteca.tipo_cliente AS tc ON tc.code = c.tipo_cliente_id
    INNER JOIN mapoteca.situacao_pedido AS sp ON sp.code = p.situacao_pedido_id
    LEFT JOIN LATERAL (
      SELECT SUM(${QTD_EFETIVA})::int AS quantidade,
             string_agg(DISTINCT COALESCE(tp.nome, pp.nome_avulso), ', ') AS produtos
      FROM mapoteca.produto_pedido AS pp
      ${JOIN_PRODUTO_ITEM}
      WHERE pp.pedido_id = p.id
    ) AS itens ON TRUE
    WHERE c.tipo_cliente_id IN ($<tiposCliente:csv>)
      AND p.situacao_pedido_id IN ($<situacoesPedido:csv>)
      -- Mesma regra do outro lado: sem data de conclusão a linha não aconteceu.
      AND p.data_atendimento IS NOT NULL
      AND EXTRACT(YEAR FROM p.data_atendimento) = $<ano>`

/**
 * As linhas da aba EXTRA_PIT do RTM, das DUAS fontes.
 *
 * Com `mes`, o acumulado do exercício de janeiro até ele; sem `mes`, o exercício
 * inteiro. É o que o RTM exige, porque ele sobe para a DSG todo mês com o
 * acumulado.
 *
 * @param {number} ano
 * @param {number} [mes] - 1 a 12; acumula de janeiro até ele
 * @returns {Promise<Array<Object>>} linhas cruas, para `paraAbaExtraPit`
 */
controller.buscarExtraPitDetalhado = async (ano, mes = null) => {
  const instituicao = await instituicaoCtrl.paraDocumento()

  // O teto do mês entra ou não entra na consulta, e não como `$<mes> IS NULL OR
  // ...`: com `mes` nulo aquele caminho chamaria `make_date(2026, null, 1)`, e
  // um argumento sem tipo não resolve a função. Mesmo remédio do
  // `filtroPeriodoMes` da mapoteca, que é montado em JavaScript pela mesma razão.
  const teto = coluna => mes
    ? `AND ${coluna} < (make_date($<ano>, $<mes>, 1) + interval '1 month')`
    : ''

  return db.conn.any(
    `${CONSULTA_DEMANDA_EXTRA}
      ${teto('d.data_entrega')}

    UNION ALL

    ${CONSULTA_PEDIDO_CIVIL}
      ${teto('p.data_atendimento')}

    -- A ordem da aba, com as duas fontes já misturadas. \`data_conclusao\` é
    -- texto ISO ('AAAA-MM-DD'), que ordena por data exatamente como uma data.
    ORDER BY data_conclusao, demandante, produto`,
    {
      ano,
      mes,
      omds: instituicao.sigla,
      situacoesExtra: SITUACOES_NA_ABA,
      tiposCliente: TIPOS_CLIENTE_NA_ABA,
      situacoesPedido: SITUACOES_PEDIDO_ENTREGUE,
      tipoLai: TIPO_CLIENTE.LAI,
      demandanteLai: DEMANDANTE_LAI,
      rotuloLai: ROTULO_LAI,
      laiSemNup: LAI_SEM_NUP
    }
  )
}

// ---------------------------------------------------------------------------
// QUANTIDADE: a declarada, e é uma divergência deliberada com a 3.3
// ---------------------------------------------------------------------------
//
// A subseção 3.3 do RPCMTec imprime `quantidade_materializada` (a contagem de
// `acervo.versao.demanda_extra_id`) desde 2026-08-08, por decisão do chefe: a
// 3.3 de abril afirmava 76 produtos onde o acervo tinha 26.
//
// A ABA NÃO PODE HERDAR ISSO COMO ESTÁ, e a medida diz por quê: a materializada
// sai ZERO na demanda de origem Manual, que é a que nunca vai ter versão no
// acervo (er/pit.sql:537-544), e a coluna 'Qnt' do RTM de agosto está preenchida
// em 44 de 44 linhas, com valores como 151 e 178 em linhas que não são produção
// de carta. Imprimir a materializada esvaziaria a coluna. E do lado civil ela
// nem existe: pedido da mapoteca não materializa versão nenhuma.
//
// Então a aba leva `quantidade`. A consulta traz as duas do lado da demanda, e
// trocar a que vai para a aba é uma linha aqui -- mas é decisão do chefe, e não
// de quem editar este arquivo, porque é a mesma pergunta que ele já respondeu
// uma vez para a 3.3.

// NÚMERO de verdade: é o que a planilha de destino soma. Texto passaria
// despercebido e zeraria a coluna no RTM. A célula fica VAZIA no que não for
// número, que é visível na planilha; um texto no lugar não seria.
const numeroDaAba = valor => {
  if (valor === null || valor === undefined || valor === '') return null
  const n = Number(valor)
  return Number.isFinite(n) ? n : null
}

// A data como 'AAAA-MM-DD', SEM passar por fuso. A coluna é DATE e chega assim
// do driver; quem passar um `Date` tem os componentes LOCAIS lidos, e não o ISO
// em UTC, senão o dia anda. É a mesma regra de `rtm_ods.celulaData`, e é o
// gerador que a repete do outro lado.
const dataDaAba = valor => {
  if (!valor) return null
  if (valor instanceof Date) {
    return `${valor.getFullYear()}-` +
      `${String(valor.getMonth() + 1).padStart(2, '0')}-` +
      `${String(valor.getDate()).padStart(2, '0')}`
  }
  return String(valor).slice(0, 10)
}

// Cadeia em branco e ausência querem dizer a mesma coisa na planilha: célula
// VAZIA. A aba EXTRA_PIT não usa o literal '-' em coluna nenhuma (medido no RTM
// de agosto), ao contrário da META4_DETALHADA.
const textoDaAba = valor => {
  if (valor === null || valor === undefined) return null
  const texto = String(valor).trim()
  return texto === '' ? null : texto
}

/**
 * Traduz as linhas de `buscarExtraPitDetalhado` para o vocabulário da aba.
 *
 * As SETE chaves, na ordem das colunas A a G do modelo:
 *
 *   omds                   A  'OMDS'
 *   demandante             B  'Demandante'
 *   descricao              C  'Descrição do Produto/Serviço'
 *   quantidade             D  'Qnt'                           NÚMERO
 *   data_conclusao         E  'Data de Conclusão/Entrega'
 *   documento_autorizacao  F  'Documento de Autorização (se houver)'
 *   observacao             G  'Observação'
 *
 * As duas origens já chegam aqui com os mesmos nomes de campo (`produto` e
 * `nota`), resolvidas cada uma na sua consulta: traduzir por origem AQUI seria
 * pôr metade da regra no SQL e metade no JavaScript, e a metade de cá é a que
 * ninguém lembra de atualizar.
 *
 * O DOCUMENTO SAI VERBATIM, e só a demanda autorizada tem um. Ele é NOT NULL
 * naquela tabela e a planilha o traz em 2 de 44 linhas, então a aba gerada vai
 * mostrá-lo onde a preenchida à mão deixa em branco. Isso é diferença de FONTE,
 * e não defeito: o banco sabe de autorização que a planilha não registrou.
 *
 * ORDEM CRONOLÓGICA pela conclusão, que é a da aba. A consulta já entrega assim;
 * a ordenação é repetida aqui para que a ordem seja propriedade DA ABA, e não de
 * quem consultou. Linha sem data vai para o fim, porque ainda não aconteceu.
 *
 * @param {Array<Object>} dados - saída de buscarExtraPitDetalhado
 * @returns {Array<Object>}
 */
controller.paraAbaExtraPit = dados =>
  [...(dados || [])]
    .sort((a, b) => {
      const da = dataDaAba(a.data_conclusao) || '9999-12-31'
      const dbb = dataDaAba(b.data_conclusao) || '9999-12-31'
      if (da !== dbb) return da < dbb ? -1 : 1
      return 0
    })
    .map(l => ({
      omds: textoDaAba(l.omds),
      demandante: textoDaAba(l.demandante),
      descricao: textoDaAba(l.produto),
      quantidade: numeroDaAba(l.quantidade),
      data_conclusao: dataDaAba(l.data_conclusao),
      documento_autorizacao: textoDaAba(l.documento_autorizacao),
      observacao: textoDaAba(l.nota)
    }))

// As sete chaves, na ordem das colunas do modelo. Exportadas para o gerador
// casar coluna com cabeçalho sem reescrever a lista, que é como a nona coluna
// some sem ninguém notar.
controller.CHAVES_ABA_EXTRA_PIT = [
  'omds',
  'demandante',
  'descricao',
  'quantidade',
  'data_conclusao',
  'documento_autorizacao',
  'observacao'
]

// As réguas e as constantes, exportadas para quem precisar explicá-las (e para
// os testes que as cobram).
controller.ORIGEM_LINHA = ORIGEM_LINHA
controller.SITUACOES_NA_ABA = SITUACOES_NA_ABA
controller.TIPOS_CLIENTE_NA_ABA = TIPOS_CLIENTE_NA_ABA
controller.SITUACOES_PEDIDO_ENTREGUE = SITUACOES_PEDIDO_ENTREGUE
controller.DEMANDANTE_LAI = DEMANDANTE_LAI
controller.ROTULO_LAI = ROTULO_LAI

module.exports = controller
