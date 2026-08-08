'use strict'

// A saida COMPACTA, e as duas confusoes que ela evita: meses lidos como dinheiro
// e timestamp lido como dia de calendario.
//   Rodar: cd equipamento_cli && node --test

const { test } = require('node:test')
const assert = require('node:assert')

const saida = require('../lib/saida')
const esquema = require('../lib/schema')
const { RECURSOS } = require('../lib/recursos')

test('as tres colunas de dinheiro saem como moeda pt-BR', () => {
  assert.strictEqual(saida.celula('valor', '600.00'), '600,00')
  assert.strictEqual(saida.celula('valor_orcado', 1234.5), '1.234,50')
  assert.strictEqual(saida.celula('valor_pdr', null), '-')
})

test('vida_util_meses NAO e dinheiro: e uma contagem de MESES', () => {
  // Formata-la como moeda ("120,00") sugeriria casa decimal onde nao ha, e o
  // numero que se digita no formulario e 120.
  assert.strictEqual(saida.celula('vida_util_meses', 120), '120')
  assert.strictEqual(saida.celula('vida_util_meses', '180'), '180')
})

test('booleano sai em portugues, porque a coluna e para ler', () => {
  assert.strictEqual(saida.celula('ativo', true), 'sim')
  assert.strictEqual(saida.celula('transferido_siafi', false), 'não')
  assert.strictEqual(saida.celula('vida_util_herdada', true), 'sim')
})

test('timestamp ISO sai como dia de calendario', () => {
  // As onze colunas DATE do modulo sao dia de calendario, e a hora custa
  // caracteres sem responder nenhuma pergunta.
  assert.strictEqual(saida.celula('data_inicio', '2026-05-11T03:00:00.000Z'), '2026-05-11')
  assert.strictEqual(saida.celula('data_entrada_carga', '2014-07-29'), '2014-07-29')
})

test('o recorte de data e do PREFIXO, e nao conversao de fuso', () => {
  // Em UTC-3 a meia-noite local de um dia serializa como 'AAAA-MM-DDT03:00:00Z',
  // e o prefixo e o dia certo. Converter para Date aqui devolveria o dia errado.
  assert.strictEqual(esquema.soData('2026-05-11T03:00:00.000Z'), '2026-05-11')
  assert.strictEqual(esquema.soData('2026-05-11'), '2026-05-11')
  assert.strictEqual(esquema.soData(null), null)
  assert.strictEqual(esquema.soData('sem forma de data'), 'sem forma de data')
})

test('lista vazia com --json sai como [], e nao como prosa', () => {
  // Quem encadeia faz JSON.parse da saida, e o caso mais comum e justamente a
  // consulta que nao achou nada.
  assert.strictEqual(saida.lista([], { formato: 'json' }).texto, '[]')
  assert.strictEqual(saida.lista([], { formato: 'tsv' }).texto, '(nenhum registro)')
})

test('coluna pedida que nao existe vira AVISO, e nao coluna vazia calada', () => {
  const r = saida.lista([{ id: 1, modelo: 'TOPCON' }], { campos: ['id', 'inexistente'] })
  assert.ok(r.avisos.join(' ').includes('inexistente'))
  assert.ok(r.texto.includes('id'))
})

test('a listagem do bem mostra vida_util_herdada, sem a qual o 120 mente', () => {
  // Sem ela, um 120 na coluna de vida util nao diz se o bem declarou a propria ou
  // se pegou a do tipo, e quem for editar acha que o campo esta preenchido.
  assert.ok(RECURSOS.bem.colunas.includes('vida_util_meses'))
  assert.ok(RECURSOS.bem.colunas.includes('vida_util_herdada'))
})

test('as colunas padrao dos historicos identificam o BEM dono do lancamento', () => {
  // A lista solta de um historico e do modulo inteiro: sem `equipamento_id` e
  // `nr_patrimonio`, a linha nao diz de que bem ela fala.
  for (const chave of ['indisponibilidade', 'afastamento', 'manutencao', 'transferencia']) {
    assert.ok(RECURSOS[chave].colunas.includes('equipamento_id'), chave)
    assert.ok(RECURSOS[chave].colunas.includes('nr_patrimonio'), chave)
  }
})

test('o rodape conta os registros e diz quantas colunas ficaram de fora', () => {
  const r = saida.lista(
    [{ id: 1, modelo: 'TOPCON', nr_serie: null }],
    { padrao: ['id', 'modelo'] }
  )
  assert.ok(r.texto.includes('(1 registro, 2 de 3 colunas)'), r.texto)
})
