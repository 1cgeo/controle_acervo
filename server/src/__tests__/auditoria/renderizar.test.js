'use strict'

// O DIFF QUE A TELA MOSTRA.
//
// Este arquivo guarda a correcao do defeito que originou o trabalho de
// rastreabilidade: ate 2026-08-02 a tela do pedido mostrava
// `campos_alterados.join(', ')`, ou seja o NOME DA COLUNA DO BANCO
// ("situacao_pedido_id, prazo"), enquanto `dados_antes` e `dados_depois`
// chegavam na resposta e eram jogados fora. Quem lia sabia que algo mudou, sem
// saber DE QUE PARA QUE.
//
// Nao toca o banco: o cache de dominios entra por injecao nos testes, e o que se
// prova aqui e a REGRA de formatacao.

const { montarMudancas, montarResumo, textoDoValor } = require('../../auditoria/renderizar')

// O catalogo como o cache do servidor o monta: nome por codigo, em texto.
const CATALOGOS = {
  'mapoteca.situacao_pedido': new Map([['3', 'Em produção'], ['5', 'Concluído']]),
  'mapoteca.tipo_midia': new Map([['5', 'Papel']])
}

const evento = (over = {}) => ({
  tabela: 'mapoteca.pedido',
  operacao: 'U',
  campos_alterados: [],
  dados_antes: {},
  dados_depois: {},
  ...over
})

describe('montarMudancas: a resposta que faltava', () => {
  it('traduz o codigo de dominio para o NOME, com o codigo ao lado', () => {
    const m = montarMudancas(evento({
      campos_alterados: ['situacao_pedido_id'],
      dados_antes: { situacao_pedido_id: 3 },
      dados_depois: { situacao_pedido_id: 5 }
    }), CATALOGOS)

    expect(m).toHaveLength(1)
    expect(m[0].rotulo).toBe('Situação')
    // A resposta inteira numa linha: e isto que a tela mostra sem nenhum clique.
    expect(m[0].antes_texto).toBe('Em produção (3)')
    expect(m[0].depois_texto).toBe('Concluído (5)')
  })

  it('codigo SEM traducao sai como numero cru, e nao como vazio', () => {
    // Inventar traducao e pior do que mostrar o numero, e sumir com o valor e
    // pior ainda: o codigo desconhecido e justamente o que se quer investigar.
    const m = montarMudancas(evento({
      campos_alterados: ['situacao_pedido_id'],
      dados_antes: { situacao_pedido_id: 99 },
      dados_depois: { situacao_pedido_id: 5 }
    }), CATALOGOS)

    expect(m[0].antes_texto).toBe('99')
  })

  it('data sai no formato da casa, sem fuso atravessar o dia', () => {
    const m = montarMudancas(evento({
      campos_alterados: ['prazo'],
      dados_antes: { prazo: '2026-08-10' },
      dados_depois: { prazo: '2026-08-20' }
    }), CATALOGOS)

    expect(m[0].antes_texto).toBe('10/08/2026')
    expect(m[0].depois_texto).toBe('20/08/2026')
  })

  it('nulo sai como NULO, para a tela poder escrever a palavra "vazio"', () => {
    // Celula em branco se leria como "esta coluna nao se aplica", e "passou a ter
    // observacao" e "sempre foi vazio" sao fatos diferentes.
    const m = montarMudancas(evento({
      campos_alterados: ['observacao'],
      dados_antes: { observacao: null },
      dados_depois: { observacao: 'Cliente pediu urgência' }
    }), CATALOGOS)

    expect(m[0].antes_texto).toBeNull()
    expect(m[0].depois_texto).toBe('Cliente pediu urgência')
  })

  it('booleano vira Sim e Nao, e nao true e false', () => {
    const m = montarMudancas(evento({
      campos_alterados: ['previsto_pit'],
      dados_antes: { previsto_pit: false },
      dados_depois: { previsto_pit: true }
    }), CATALOGOS)

    expect(m[0].antes_texto).toBe('Não')
    expect(m[0].depois_texto).toBe('Sim')
  })

  it('FK para entidade NAO e traduzida: sai o id, com a entidade alvo', () => {
    // O nome do cliente pode ter mudado depois do evento. Mostrar o nome de hoje
    // ao lado de um valor de um ano atras afirma algo que pode ser falso.
    const m = montarMudancas(evento({
      campos_alterados: ['cliente_id'],
      dados_antes: { cliente_id: 7 },
      dados_depois: { cliente_id: 9 }
    }), CATALOGOS)

    expect(m[0].tipo).toBe('entidade')
    expect(m[0].entidade_alvo).toBe('cliente')
    expect(m[0].antes_texto).toBe('#7')
  })

  it('a ORDEM e a da declaracao do mapa, e nao alfabetica', () => {
    // A declaracao espelha a ordem da ficha, entao o historico se le na mesma
    // sequencia do formulario que produziu a mudanca.
    const m = montarMudancas(evento({
      // Alfabeticamente seria observacao, prazo, situacao_pedido_id.
      campos_alterados: ['observacao', 'prazo', 'situacao_pedido_id'],
      dados_antes: { observacao: 'a', prazo: '2026-01-01', situacao_pedido_id: 3 },
      dados_depois: { observacao: 'b', prazo: '2026-02-01', situacao_pedido_id: 5 }
    }), CATALOGOS)

    expect(m.map(x => x.campo)).toEqual(['situacao_pedido_id', 'prazo', 'observacao'])
  })

  it('campo NAO DECLARADO nao some: sai com o nome de coluna e marcado', () => {
    // Um mapa que silencia o desconhecido esconde justamente o campo que ninguem
    // esta olhando. Coluna nova entra no historico enquanto ninguem a declarou.
    const m = montarMudancas(evento({
      campos_alterados: ['coluna_nova_que_ninguem_declarou'],
      dados_antes: { coluna_nova_que_ninguem_declarou: 'a' },
      dados_depois: { coluna_nova_que_ninguem_declarou: 'b' }
    }), CATALOGOS)

    expect(m[0].rotulo).toBe('coluna_nova_que_ninguem_declarou')
    expect(m[0].declarado).toBe(false)
    expect(m[0].antes_texto).toBe('a')
  })

  it('campo nao declarado vai para o FIM, depois dos declarados', () => {
    const m = montarMudancas(evento({
      campos_alterados: ['zzz_nao_declarado', 'observacao'],
      dados_antes: { zzz_nao_declarado: 1, observacao: 'a' },
      dados_depois: { zzz_nao_declarado: 2, observacao: 'b' }
    }), CATALOGOS)

    expect(m.map(x => x.campo)).toEqual(['observacao', 'zzz_nao_declarado'])
  })

  it('valor sanitizado se explica em vez de aparecer como objeto', () => {
    const m = montarMudancas(evento({
      tabela: 'mapoteca.anexo_pedido',
      campos_alterados: ['conteudo'],
      dados_antes: { conteudo: { _omitido: 'conteudo', bytes: 2048 } },
      dados_depois: { conteudo: { _omitido: 'conteudo', bytes: 4096 } }
    }), CATALOGOS)

    expect(m[0].antes_texto).toBe('(2048 bytes, não guardado)')
    expect(m[0].depois_texto).toBe('(4096 bytes, não guardado)')
  })
})

describe('montarResumo', () => {
  it('identifica o registro pelo que a pessoa usa para falar dele', () => {
    const resumo = montarResumo(evento({
      operacao: 'I',
      dados_depois: { id: 312, localizador_pedido: '7KQ2-M4XP-91BD' }
    }))

    expect(resumo).toBe('Pedido 7KQ2-M4XP-91BD')
  })

  it('na EXCLUSAO sai do dados_antes, que e o unico lado que existe', () => {
    const resumo = montarResumo(evento({
      operacao: 'D',
      dados_antes: { id: 312, localizador_pedido: '7KQ2-M4XP-91BD' },
      dados_depois: null
    }))

    expect(resumo).toBe('Pedido 7KQ2-M4XP-91BD')
  })

  it('resumo que quebra NAO derruba a leitura do historico', () => {
    // O historico e acessorio; a ficha e o trabalho. Dado antigo com coluna
    // faltando nao pode tirar a tela do ar.
    const resumo = montarResumo(evento({
      dados_antes: null,
      dados_depois: null
    }))

    expect(resumo).toBe('mapoteca.pedido')
  })
})

describe('textoDoValor: as regras de formatacao', () => {
  it('dinheiro sai em reais, porque o modulo orcamento depende disso', () => {
    // '12400.00' se le errado com pressa, e o orcamento inteiro passa por aqui.
    //
    // O espaco depois de "R$" e ESPACO SEM QUEBRA (U+00A0), e nao espaco comum:
    // e o que o `toLocaleString('pt-BR', {style:'currency'})` produz, e o que
    // impede o valor de quebrar em duas linhas na tabela. Comparar com espaco
    // comum reprova um resultado certo, e foi o que este teste fez na primeira
    // escrita: as duas strings parecem iguais no relatorio de falha.
    const semNbsp = textoDoValor('12400.00', { tipo: 'dinheiro' }, null).replace(/ /g, ' ')

    expect(semNbsp).toBe('R$ 12.400,00')
  })

  it('numero usa o separador brasileiro', () => {
    expect(textoDoValor(1234567, { tipo: 'numero' }, null)).toBe('1.234.567')
  })

  it('lista vazia se anuncia, em vez de virar texto em branco', () => {
    expect(textoDoValor([], { tipo: 'lista' }, null)).toBe('(lista vazia)')
    expect(textoDoValor(['a', 'b'], { tipo: 'lista' }, null)).toBe('a, b')
  })

  it('texto longo e recortado com o tamanho ao lado', () => {
    const longo = 'a'.repeat(400)
    const saida = textoDoValor(longo, { tipo: 'texto' }, null)

    expect(saida).toContain('400 caracteres')
    expect(saida.length).toBeLessThan(400)
  })

  it('nulo devolve nulo, e nunca a string "null"', () => {
    // Foi assim que apareceu uma fatia chamada `null` no grafico do dashboard da
    // mapoteca; a licao nao se repete aqui.
    expect(textoDoValor(null, { tipo: 'texto' }, null)).toBeNull()
  })
})
