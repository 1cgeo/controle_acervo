#!/usr/bin/env python3
"""Carga inicial do modulo `equipamento` a partir do Relatorio DMT (.ods).

POR QUE ISTO E UM SCRIPT, E NAO UMA MIGRACAO VERSIONADA
-------------------------------------------------------
O repositorio e PUBLICO. As linhas da planilha trazem numero de patrimonio, OM
de afastamento e valor orcado, e uma migracao em `migrations/` publicaria todos
eles para sempre, em texto, sem volta. Por isso o dado nunca entra em arquivo
versionado: o caminho da planilha chega como ARGUMENTO na hora de rodar, e o SQL
gerado sai para um caminho FORA do repositorio, escolhido pelo operador em
`--saida` (e o script recusa `--saida` apontando para dentro do repositorio).

O precedente da casa e o mesmo: os dados de implantacao da mapoteca (fichas de
almoxarifado, snapshot de estoque) nunca entraram no repositorio.

Este arquivo, que E versionado, carrega REGRA e nunca DADO. Aqui estao os
codigos de dominio do DDL, os nove nomes de tipo semeados em `er/equipamento.sql`
e as regras de conversao. Nenhum numero de patrimonio, nenhuma OM, nenhum modelo
de bem e nenhum valor estao escritos aqui: tudo isso e lido da planilha ou
resolvido por regra em tempo de execucao.

USO
---
    python scripts/carregar_equipamento_dmt.py --ods <caminho> --usuario <uuid>
    python scripts/carregar_equipamento_dmt.py --ods <caminho> --usuario <uuid> \\
        --aplicar --saida <caminho fora do repositorio>.sql

SEM `--aplicar` o script NAO ESCREVE NADA: le, converte, confere e imprime o
relatorio. Esse e o padrao, e e o produto de verdade deste script. `--aplicar` e
o que gera o arquivo `.sql`, e esse arquivo e UMA transacao (`BEGIN` ... `COMMIT`)
com guardas no inicio e conferencia de contagem no fim: ou entra inteira, ou nao
entra. O operador o aplica com o cliente de linha de comando do Postgres:

    psql -v ON_ERROR_STOP=1 -f <o arquivo gerado>

O plano que o relatorio imprime e o MESMO objeto que gera o SQL, entao o que o
relatorio promete e o que acontece.

POR QUE ARQUIVO `.sql`, E NAO CONEXAO DIRETA
--------------------------------------------
O projeto nao usa driver Postgres em Python: os dois scripts Python daqui
(`fumaca.py`, `check_vazamento.py`) sao de dependencia zero, e quem fala com o
banco fala por Node. Instalar um driver so para esta carga unica seria dependencia
nova para uma coisa que roda uma vez. O arquivo `.sql` tambem tem a vantagem de
ser CONFERIVEL antes de aplicar, linha a linha, pelo mesmo humano que leu o
relatorio.

Sem dependencia: `zipfile` mais `xml.etree` leem o ODS.

O QUE A CARGA NAO FAZ
---------------------
Nao registra `auditoria.evento`. A auditoria do SCA e do SERVIDOR (usuario da
sessao HTTP, estado antes e depois lidos do banco), e carga inicial roda por fora
do servico, como a implantacao da mapoteca. O relatorio diz isso em voz alta.
"""

import datetime
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

# ---------------------------------------------------------------------------
# REGRA: os codigos de dominio, espelho do DDL de `er/equipamento.sql`
# ---------------------------------------------------------------------------

CLASSE_SUPRIMENTO = {'VI': 6, 'IX': 9}

SECAO_DETENTORA = {'Cia Lev': 1, 'Cia Prod': 2}

# SUPOSICAO A1, ja avisada ao chefe: a planilha nao conhece as duas secoes do
# DDL, e sim os nomes internos da Divisao. O relatorio imprime este remapeamento
# em destaque justamente porque e suposicao, e nao leitura.
REMAPA_SECAO = {'DMT': 'Cia Lev', 'Mapoteca': 'Cia Prod'}

SITUACAO = {
    'Disponível': 1, 'Afastado': 2, 'Em manutenção': 3,
    'Indisponível': 4, 'Baixado': 5,
}

TIPO_TRANSFERENCIA_DESCARGA = 3
SITUACAO_TRANSFERENCIA_SOLICITADA = 1

# Os nove tipos semeados em `er/equipamento.sql`, com a vida util em MESES. A
# carga casa o texto da coluna "Tipo Equipamento (conforme QDMP)" contra estes
# nomes por igualdade EXATA. Nome que nao casa PARA a carga: seria sintoma de a
# semente ter divergido, e criar tipo novo aqui esconderia isso ate a tela de
# cadastro mostrar dez tipos onde o QDMP tem nove.
TIPOS_SEMEADOS = {
    'Estação Total': 120,
    'Rastreador Satelital para Navegação (GPS) Individual': 60,
    'Rastreador Satelital para Navegação (GPS) veicular': 60,
    'Conjunto de Rastreamento Satelital GNSS': 120,
    'Conjunto de Rastreamento Satelital GNSS com RTK': 120,
    'Impressora de Grande Formato (Plotter)': 120,
    'Aeronave Remotamente Pilotada (Drone)': 60,
    'Bastão para topografia': 180,
    'Bipé para Bastão': 180,
}

TIPO_PLOTTER = 'Impressora de Grande Formato (Plotter)'

# ---------------------------------------------------------------------------
# REGRA: o layout da planilha
# ---------------------------------------------------------------------------

# Indice 0-based da coluna na linha. A linha 0 do documento sao as faixas
# mescladas ("Inventário Geral", "Afastamento", "Indisponibilidade",
# "Transferência"), a linha 1 e o cabecalho e o corpo comeca na linha 2.
LINHA_CABECALHO = 1
PRIMEIRA_LINHA_DE_DADO = 2

COL_ID = 0
COL_CLASSE = 1
COL_TIPO = 2
COL_MODELO = 3
COL_PATRIMONIO = 4
COL_ENTRADA = 5
COL_VIDA_ANOS = 6
COL_SECAO = 7
COL_SITUACAO = 8
COL_AFAST_OM = 9
COL_AFAST_MOTIVO = 10
COL_AFAST_INICIO = 11
COL_AFAST_PREVISAO = 12
COL_INDISP_MOTIVO = 13
COL_INDISP_INICIO = 14
COL_ORCAMENTO = 15
COL_PDR = 16
COL_CERTAME = 17
COL_PREVISAO = 18
COL_TRANSF_OM = 19
COL_TRANSF_DOCUMENTO = 20
COL_TRANSF_DATA = 21
COL_TRANSF_SIAFI = 22
COL_APROPRIADO_SIAFI = 23
COL_PUBLICACAO = 24
COL_DESCRICAO = 25

# O cabecalho que a carga espera encontrar, por coluna. Nao e o texto inteiro (o
# cabecalho real e prolixo), e sim um pedaco que identifica a coluna sem ambiguidade.
# Serve para PARAR a carga se alguem inserir ou reordenar coluna na planilha: sem
# isso, a carga leria modelo na coluna do patrimonio e ninguem veria.
CABECALHO_ESPERADO = {
    COL_ID: 'ID',
    COL_CLASSE: 'Classe',
    COL_TIPO: 'Tipo Equipamento',
    COL_MODELO: 'Modelo',
    COL_PATRIMONIO: 'Patrimônio',
    COL_ENTRADA: 'Data Entrada em Carga',
    COL_VIDA_ANOS: 'Vida útil',
    COL_SECAO: 'Seção ou Depósito',
    COL_SITUACAO: 'Situação',
    COL_AFAST_OM: 'Local',
    COL_AFAST_MOTIVO: 'Motivo afastamento',
    COL_AFAST_INICIO: 'Início afastamento',
    COL_AFAST_PREVISAO: 'Previsão término afastamento',
    COL_INDISP_MOTIVO: 'Motivo Indisponibilidade',
    COL_INDISP_INICIO: 'Data início Indisponibilidade',
    COL_ORCAMENTO: 'Orçamento',
    COL_PDR: 'Previsão de recurso',
    COL_CERTAME: 'Certame',
    COL_PREVISAO: 'Previsão disponibilidade ou descarga',
}

# A celula da coluna 18 que vira uma transferencia de Descarga Solicitada.
MARCA_DESCARGA = 'solicitado descarga'

# ---------------------------------------------------------------------------
# REGRA: as suposicoes que a carga assume, e que o relatorio imprime em destaque
# ---------------------------------------------------------------------------

# SUPOSICAO A2. Onde o gestor escreveu so o ANO como previsao de retorno, a carga
# grava 31 de dezembro daquele ano: e a unica leitura de "2026" que nao antecipa
# o retorno. Vale para as indisponibilidades de PLOTTER, que sao as duas em que
# isso aconteceu.
ANO_PREVISAO_RETORNO_PLOTTER = 2026

# A 12a indisponibilidade NAO esta na planilha. O RPCMTec de julho de 2026 tem 12
# linhas e a planilha (de 03/08) so explica 11: o segundo plotter quebrou depois
# de a planilha ser fechada, e a coluna Situacao dele ainda diz Disponivel. Sem
# esta linha, julho passa a imprimir 11 onde o gestor digitou 12.
#
# O bem NAO e identificado aqui por numero de patrimonio (dado, e este arquivo e
# publico), e sim por REGRA: e o GEMEO do plotter que ja consta indisponivel na
# planilha, isto e, o unico outro bem de mesmo tipo e mesmo modelo que aparece
# como disponivel. A carga exige que exista exatamente UM gemeo e para se nao
# houver, e imprime em destaque qual bem foi resolvido, para conferencia humana.
# Se um dia a regra deixar de valer, `--extra-indisponibilidade <arquivo.json>`
# aponta o patrimonio na mao.
EXTRA_MOTIVO = 'Erro de firmware'
EXTRA_DATA_INICIO = '2026-07-17'

LARGURA = 100

# ---------------------------------------------------------------------------
# Leitura do ODS, sem dependencia
# ---------------------------------------------------------------------------

NS = {
    'table': 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
    'text': 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
    'office': 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
}

CELULA_VAZIA = {'texto': '', 'tipo': None, 'num': None, 'data': None}


class ErroDeCarga(Exception):
    """Erro que PARA a carga. A mensagem sai em portugues, para o operador."""


def _q(prefixo, tag):
    return '{%s}%s' % (NS[prefixo], tag)


def _texto_da_celula(celula):
    partes = []
    for paragrafo in celula.iter(_q('text', 'p')):
        partes.append(''.join(paragrafo.itertext()))
    return '\n'.join(partes).strip()


def ler_ods(caminho):
    """Devolve [(nome da aba, [linha, ...])], cada linha uma lista de celulas.

    Cada celula e um dicionario com o texto VISIVEL, o tipo declarado, o
    `office:value` e o `office:date-value`. Resolve `number-columns-repeated` e
    `number-rows-repeated`, que e como o ODS grava celula repetida.
    """
    try:
        with zipfile.ZipFile(caminho) as arquivo:
            conteudo = arquivo.read('content.xml')
    except (OSError, zipfile.BadZipFile, KeyError) as erro:
        raise ErroDeCarga(
            'Não foi possível ler a planilha informada em --ods: %s' % erro)

    raiz = ET.fromstring(conteudo)
    abas = []
    for tabela in raiz.iter(_q('table', 'table')):
        nome = tabela.get(_q('table', 'name'))
        linhas = []
        for linha in tabela.iter(_q('table', 'table-row')):
            repete_linha = int(linha.get(_q('table', 'number-rows-repeated'), 1))
            celulas = []
            for celula in linha:
                if celula.tag not in (_q('table', 'table-cell'),
                                      _q('table', 'covered-table-cell')):
                    continue
                repete = min(int(celula.get(_q('table', 'number-columns-repeated'), 1)), 60)
                valor = {
                    'texto': _texto_da_celula(celula),
                    'tipo': celula.get(_q('office', 'value-type')),
                    'num': celula.get(_q('office', 'value')),
                    'data': celula.get(_q('office', 'date-value')),
                }
                for _ in range(repete):
                    celulas.append(valor)
            while celulas and not celulas[-1]['texto']:
                celulas.pop()
            # Linha repetida centenas de vezes e o rodape vazio do documento.
            if repete_linha > 5:
                continue
            for _ in range(repete_linha):
                linhas.append(celulas)
        abas.append((nome, linhas))
    return abas


# ---------------------------------------------------------------------------
# Conversoes, com o antes e o depois guardados para o relatorio
# ---------------------------------------------------------------------------

RE_DATA_TEXTO = re.compile(r'^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})$')
RE_DINHEIRO = re.compile(r'R\$\s*([\d.]*\d(?:,\d{1,2})?)')
RE_UUID = re.compile(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')


def expandir_ano(aa):
    """Ano de dois digitos (defeito 5 da planilha).

    A planilha escreve o ano com dois digitos em quase toda data. A regra e
    `aa <= 50` vira `20aa`, senao `19aa`: `29/07/14` e 2014 e `09/04/26` e 2026.
    O corte em 50 e generoso de proposito. O acervo mais antigo da Divisao e dos
    anos 1990, e nenhum bem de topografia entra em carga em 2051.
    """
    return 2000 + aa if aa <= 50 else 1900 + aa


def celula(linha, indice):
    return linha[indice] if indice < len(linha) else CELULA_VAZIA


def texto_visivel(linha, indice):
    """Texto da celula, com `-` e vazio virando None (defeito 4 da planilha).

    `-` e a celula vazia DESTE documento: quem preencheu usou o traco no lugar do
    branco, em todas as colunas.
    """
    bruto = (celula(linha, indice)['texto'] or '').strip()
    return None if bruto in ('', '-') else bruto


def converter_data(linha, indice, onde, diario):
    """Data de calendario, com os dois formatos que a planilha usa.

    Defeito 2: dez das onze datas de indisponibilidade tem `office:date-value` e
    uma foi digitada como TEXTO, com ano de quatro digitos. Aqui:

    1. quando existe `office:date-value`, ele manda, porque e o que a planilha
       calculou e o que o gestor viu na tela;
    2. senao, o texto visivel e lido como `dd/mm/aa` ou `dd/mm/aaaa`;
    3. em qualquer dos dois, o texto visivel tambem e lido e CONFERIDO contra o
       resultado, e a divergencia vira achado no relatorio em vez de silencio.
    """
    cel = celula(linha, indice)
    visivel = (cel['texto'] or '').strip()
    if visivel in ('', '-'):
        return None

    do_atributo = None
    if cel['data']:
        try:
            do_atributo = datetime.date.fromisoformat(cel['data'][:10])
        except ValueError:
            do_atributo = None

    do_texto = None
    dois_digitos = False
    casamento = RE_DATA_TEXTO.match(visivel)
    if casamento:
        dia, mes, ano = (int(x) for x in casamento.groups())
        if len(casamento.group(3)) == 2:
            dois_digitos = True
            ano = expandir_ano(ano)
        try:
            do_texto = datetime.date(ano, mes, dia)
        except ValueError:
            do_texto = None

    escolhida = do_atributo or do_texto
    if escolhida is None:
        raise ErroDeCarga(
            'Data ilegível em %s: %r. A carga aceita o atributo de data do ODS '
            'ou o texto no formato dd/mm/aa ou dd/mm/aaaa.' % (onde, visivel))

    diario.append({
        'onde': onde,
        'antes': visivel,
        'depois': escolhida.isoformat(),
        'origem': 'atributo do ODS' if do_atributo else 'texto da célula',
        'dois_digitos': dois_digitos,
        'divergente': bool(do_atributo and do_texto and do_atributo != do_texto),
        'texto_diz': do_texto.isoformat() if do_texto else None,
    })
    return escolhida


def converter_patrimonio(linha, onde, diario):
    """Numero de patrimonio (defeito 3 da planilha).

    A carga usa o TEXTO VISIVEL da celula, com `strip()`, e NUNCA o
    `office:value`: 88 das 105 celulas estao gravadas como numero, e o valor
    numerico volta como `104820700014462.0` ou em notacao exponencial
    (`1.048207e+14`). O texto visivel e o que o gestor le e o que o inventario
    diz, e a coluna do banco e VARCHAR justamente por isso.
    """
    cel = celula(linha, COL_PATRIMONIO)
    bruto = (cel['texto'] or '')
    limpo = re.sub(r'\s+', '', bruto)
    if not limpo or limpo == '-':
        raise ErroDeCarga('Patrimônio vazio em %s. Não invente número.' % onde)
    if len(limpo) > 30:
        raise ErroDeCarga(
            'Patrimônio com %d caracteres em %s, e a coluna do banco tem 30.'
            % (len(limpo), onde))
    if not re.match(r'^[0-9A-Za-z./-]+$', limpo):
        raise ErroDeCarga(
            'Patrimônio com caractere inesperado em %s: %r.' % (onde, limpo))

    if cel['tipo'] == 'float':
        diario.append({'onde': onde, 'antes': 'número %s' % cel['num'],
                       'depois': limpo, 'motivo': 'célula gravada como número'})
    elif bruto != limpo:
        diario.append({'onde': onde, 'antes': repr(bruto), 'depois': limpo,
                       'motivo': 'espaço em branco na célula'})
    return limpo


def converter_dinheiro(texto, onde, diario):
    """`Valor prévio orçado de R$600,00` vira 600.00.

    A planilha guarda o dinheiro dentro de uma FRASE, e nao numa celula numerica.
    A carga extrai o primeiro `R$` da frase, e para se a frase tiver `R$` e nao
    tiver numero atras: valor de manutencao errado por leitura frouxa e coisa que
    ninguem confere de novo.
    """
    if texto is None:
        return None
    casamento = RE_DINHEIRO.search(texto)
    if not casamento:
        raise ErroDeCarga(
            'Não foi possível extrair o valor em reais de %s: %r.' % (onde, texto))
    cru = casamento.group(1).replace('.', '').replace(',', '.')
    valor = round(float(cru), 2)
    if valor <= 0:
        raise ErroDeCarga(
            'Valor não positivo em %s: %r. O banco recusa valor <= 0.' % (onde, texto))
    diario.append({'onde': onde, 'antes': texto, 'depois': '%.2f' % valor})
    return valor


# ---------------------------------------------------------------------------
# Montagem do plano
# ---------------------------------------------------------------------------

def montar_plano(linhas, correcoes, extra_patrimonio, dia_referencia):
    """Le a planilha inteira e devolve o plano, que e o que o SQL executa.

    O plano do ensaio e o MESMO objeto que gera o SQL: o que o relatorio promete
    e o que acontece.
    """
    diario_datas = []
    diario_patrimonios = []
    diario_dinheiro = []
    diario_secoes = []
    diario_correcoes = []
    achados = []

    corpo = [linha for linha in linhas[PRIMEIRA_LINHA_DE_DADO:] if linha]
    if not corpo:
        raise ErroDeCarga('A planilha não tem nenhuma linha de dado.')

    lidos = []
    for linha in corpo:
        rotulo_id = texto_visivel(linha, COL_ID)
        if rotulo_id is None:
            continue
        onde = 'linha %s' % rotulo_id

        nome_tipo = texto_visivel(linha, COL_TIPO)
        if nome_tipo not in TIPOS_SEMEADOS:
            raise ErroDeCarga(
                'Tipo de equipamento que não casa com a semente de '
                'equipamento.tipo_equipamento, em %s: %r.\n'
                'A carga PARA aqui de propósito. Ou a planilha mudou o nome do '
                'tipo, ou a semente de er/equipamento.sql divergiu do QDMP. '
                'Criar um tipo novo por conta esconderia as duas coisas.'
                % (onde, nome_tipo))

        nome_classe = texto_visivel(linha, COL_CLASSE)
        if nome_classe not in CLASSE_SUPRIMENTO:
            raise ErroDeCarga(
                'Classe de suprimento desconhecida em %s: %r. O domínio conhece '
                'apenas %s.' % (onde, nome_classe, ', '.join(sorted(CLASSE_SUPRIMENTO))))

        secao_planilha = texto_visivel(linha, COL_SECAO)
        if secao_planilha not in REMAPA_SECAO:
            raise ErroDeCarga(
                'Seção detentora desconhecida em %s: %r. O remapeamento conhece '
                'apenas %s.' % (onde, secao_planilha, ', '.join(sorted(REMAPA_SECAO))))
        secao_carga = REMAPA_SECAO[secao_planilha]
        diario_secoes.append({'onde': onde, 'antes': secao_planilha, 'depois': secao_carga})

        modelo = texto_visivel(linha, COL_MODELO)
        if modelo is None:
            raise ErroDeCarga('Modelo vazio em %s, e a coluna do banco é NOT NULL.' % onde)

        patrimonio = converter_patrimonio(linha, onde, diario_patrimonios)
        if rotulo_id in correcoes:
            corrigido = str(correcoes[rotulo_id]).strip()
            if not corrigido:
                raise ErroDeCarga(
                    'A correção informada para a linha %s está vazia.' % rotulo_id)
            diario_correcoes.append({'onde': onde, 'antes': patrimonio, 'depois': corrigido})
            patrimonio = corrigido

        entrada = converter_data(linha, COL_ENTRADA, '%s, entrada em carga' % onde, diario_datas)

        vida_anos_texto = texto_visivel(linha, COL_VIDA_ANOS)
        vida_planilha = None
        if vida_anos_texto is not None:
            try:
                vida_planilha = int(float(vida_anos_texto.replace(',', '.'))) * 12
            except ValueError:
                raise ErroDeCarga(
                    'Vida útil ilegível em %s: %r.' % (onde, vida_anos_texto))

        # `vida_util_meses` do BEM fica NULO quando a planilha repete a vida util
        # do TIPO, que e o caso de toda linha medida em 2026-08-03. E o que faz a
        # rota devolver `vida_util_herdada: true`, e o que faz a correcao da vida
        # util de um tipo alcancar os bens dele em vez de parar no primeiro
        # cadastro. So quem DIVERGE do tipo grava valor proprio.
        vida_tipo = TIPOS_SEMEADOS[nome_tipo]
        vida_no_bem = None if vida_planilha == vida_tipo else vida_planilha
        if vida_no_bem is not None:
            achados.append(
                '%s: vida útil de %s meses diverge dos %s meses do tipo %r, e por '
                'isso é gravada no próprio bem.' % (onde, vida_no_bem, vida_tipo, nome_tipo))

        situacao_planilha = texto_visivel(linha, COL_SITUACAO)
        if situacao_planilha is not None and situacao_planilha not in SITUACAO:
            raise ErroDeCarga(
                'Situação desconhecida em %s: %r.' % (onde, situacao_planilha))

        registro = {
            'rotulo': rotulo_id,
            'onde': onde,
            'nr_patrimonio': patrimonio,
            'classe_nome': nome_classe,
            'classe_id': CLASSE_SUPRIMENTO[nome_classe],
            'tipo_nome': nome_tipo,
            'modelo': modelo,
            'nr_serie': None,           # a planilha nao tem coluna de numero de serie
            'data_entrada_carga': entrada,
            'vida_util_meses': vida_no_bem,
            'vida_util_planilha': vida_planilha,
            'secao_planilha': secao_planilha,
            'secao_nome': secao_carga,
            'secao_id': SECAO_DETENTORA[secao_carga],
            'ativo': True,              # descarga SOLICITADA nao e baixa: o bem segue na carga
            'observacao': None,
            'situacao_planilha': situacao_planilha,
            'linha': linha,
        }
        lidos.append(registro)

    # ---- defeito 1: patrimonio repetido -----------------------------------
    por_patrimonio = {}
    for registro in lidos:
        por_patrimonio.setdefault(registro['nr_patrimonio'], []).append(registro)

    pendencias = []
    excluidos = set()
    for patrimonio, grupo in sorted(por_patrimonio.items()):
        if len(grupo) == 1:
            continue
        # Fica a PRIMEIRA ocorrencia e saem as demais. A carga NAO INVENTA numero
        # de patrimonio: o chefe disse que e erro de digitacao, mas nao disse qual
        # das linhas esta errada, e escolher um numero aqui criaria um bem que nao
        # existe em lugar nenhum. As linhas de fora viram pendencia de cadastro
        # manual pela tela, e `--correcoes` as recupera no dia em que o chefe
        # disser o numero certo.
        for registro in grupo[1:]:
            excluidos.add(id(registro))
            pendencias.append({
                'onde': registro['onde'],
                'nr_patrimonio': patrimonio,
                'tipo': registro['tipo_nome'],
                'modelo': registro['modelo'],
                'entrada': registro['data_entrada_carga'],
                'conflita_com': grupo[0]['onde'],
            })

    bens = [registro for registro in lidos if id(registro) not in excluidos]

    # ---- indisponibilidade, afastamento, manutencao e transferencia -------
    indisponibilidades = []
    afastamentos = []
    manutencoes = []
    transferencias = []

    for registro in bens:
        linha = registro['linha']
        onde = registro['onde']

        motivo_indisp = texto_visivel(linha, COL_INDISP_MOTIVO)
        inicio_indisp = converter_data(
            linha, COL_INDISP_INICIO, '%s, início da indisponibilidade' % onde, diario_datas)
        if motivo_indisp is not None or inicio_indisp is not None:
            if motivo_indisp is None or inicio_indisp is None:
                raise ErroDeCarga(
                    'Indisponibilidade pela metade em %s: motivo=%r, início=%r. '
                    'As duas colunas são obrigatórias no banco.'
                    % (onde, motivo_indisp, inicio_indisp))
            indisponibilidades.append({
                'onde': onde,
                'nr_patrimonio': registro['nr_patrimonio'],
                'tipo_nome': registro['tipo_nome'],
                'modelo': registro['modelo'],
                'data_inicio': inicio_indisp,
                'data_fim': None,       # nenhuma das da planilha tem fim
                'motivo': motivo_indisp,
                'previsao_retorno': None,
                'origem': 'planilha',
            })

        om_afast = texto_visivel(linha, COL_AFAST_OM)
        motivo_afast = texto_visivel(linha, COL_AFAST_MOTIVO)
        inicio_afast = converter_data(
            linha, COL_AFAST_INICIO, '%s, início do afastamento' % onde, diario_datas)
        previsao_afast = converter_data(
            linha, COL_AFAST_PREVISAO, '%s, previsão de término do afastamento' % onde,
            diario_datas)
        if any(x is not None for x in (om_afast, motivo_afast, inicio_afast)):
            faltando = [nome for nome, valor in
                        (('OM', om_afast), ('motivo', motivo_afast), ('início', inicio_afast))
                        if valor is None]
            if faltando:
                raise ErroDeCarga(
                    'Afastamento pela metade em %s: falta %s. As três colunas são '
                    'obrigatórias no banco.' % (onde, ', '.join(faltando)))
            afastamentos.append({
                'onde': onde,
                'nr_patrimonio': registro['nr_patrimonio'],
                'modelo': registro['modelo'],
                'om': om_afast,
                'motivo': motivo_afast,
                'data_inicio': inicio_afast,
                'previsao_termino': previsao_afast,
                'data_fim': None,
            })

        orcado = texto_visivel(linha, COL_ORCAMENTO)
        pdr = texto_visivel(linha, COL_PDR)
        certame = texto_visivel(linha, COL_CERTAME)
        if any(x is not None for x in (orcado, pdr, certame)):
            if inicio_indisp is None:
                raise ErroDeCarga(
                    'Manutenção em %s sem indisponibilidade na mesma linha. A carga '
                    'amarra a manutenção à indisponibilidade daquele bem, e não '
                    'sabe a data de início sozinha.' % onde)
            manutencoes.append({
                'onde': onde,
                'nr_patrimonio': registro['nr_patrimonio'],
                'modelo': registro['modelo'],
                'data_inicio': inicio_indisp,
                'data_fim': None,
                'descricao': None,
                'valor': None,          # nada foi gasto ainda: so ha previsao
                'valor_orcado': converter_dinheiro(
                    orcado, '%s, orçamento (CGEO)' % onde, diario_dinheiro),
                'valor_pdr': converter_dinheiro(
                    pdr, '%s, previsão de recurso (PDR)' % onde, diario_dinheiro),
                'certame': certame,
            })

        previsao = texto_visivel(linha, COL_PREVISAO)
        if previsao is not None:
            if previsao.strip().lower() != MARCA_DESCARGA:
                raise ErroDeCarga(
                    'Coluna "Previsão disponibilidade ou descarga" com texto que a '
                    'carga não conhece, em %s: %r. A única marca tratada é %r.'
                    % (onde, previsao, MARCA_DESCARGA))
            transferencias.append({
                'onde': onde,
                'nr_patrimonio': registro['nr_patrimonio'],
                'modelo': registro['modelo'],
                'tipo_id': TIPO_TRANSFERENCIA_DESCARGA,
                'tipo_nome': 'Descarga',
                'situacao_id': SITUACAO_TRANSFERENCIA_SOLICITADA,
                'situacao_nome': 'Solicitada',
                'texto_planilha': previsao,
            })

        for indice, nome in ((COL_TRANSF_OM, 'OM'),
                             (COL_TRANSF_DOCUMENTO, 'documento de solicitação'),
                             (COL_TRANSF_DATA, 'data da transferência'),
                             (COL_TRANSF_SIAFI, 'transferido SIAFI'),
                             (COL_APROPRIADO_SIAFI, 'apropriado SIAFI'),
                             (COL_PUBLICACAO, 'publicação de autorização'),
                             (COL_DESCRICAO, 'descrição')):
            if texto_visivel(linha, indice) is not None:
                achados.append(
                    '%s: a coluna de transferência %r está preenchida (%r) e a carga '
                    'NÃO a está lendo. Confira antes de aplicar.'
                    % (onde, nome, texto_visivel(linha, indice)))

    # ---- a 12a indisponibilidade, que nao esta na planilha ----------------
    extra, nota_extra = resolver_extra(bens, indisponibilidades, extra_patrimonio)
    indisponibilidades.append(extra)

    # ---- SUPOSICAO A2: previsao de retorno escrita so com o ano ----------
    previsao_a2 = datetime.date(ANO_PREVISAO_RETORNO_PLOTTER, 12, 31)
    for item in indisponibilidades:
        if item['tipo_nome'] == TIPO_PLOTTER and item['previsao_retorno'] is None:
            item['previsao_retorno'] = previsao_a2
            item['previsao_por_suposicao'] = True

    # ---- conferencias que valem antes de escrever ------------------------
    conferir_sobreposicao(indisponibilidades, 'indisponibilidade')
    conferir_sobreposicao(afastamentos, 'afastamento')

    patrimonios = {registro['nr_patrimonio'] for registro in bens}
    for grupo, rotulo in ((indisponibilidades, 'indisponibilidade'),
                          (afastamentos, 'afastamento'),
                          (manutencoes, 'manutenção'),
                          (transferencias, 'transferência')):
        for item in grupo:
            if item['nr_patrimonio'] not in patrimonios:
                raise ErroDeCarga(
                    'A %s de %s aponta para um bem que não está sendo carregado '
                    '(patrimônio %s).' % (rotulo, item['onde'], item['nr_patrimonio']))

    por_patrimonio_final = {registro['nr_patrimonio']: registro for registro in bens}
    for registro in bens:
        registro['situacao_derivada'] = derivar_situacao(
            registro, indisponibilidades, afastamentos, manutencoes, dia_referencia)

    return {
        'bens': bens,
        'indisponibilidades': indisponibilidades,
        'afastamentos': afastamentos,
        'manutencoes': manutencoes,
        'transferencias': transferencias,
        'pendencias': pendencias,
        'lidos': lidos,
        'indice': por_patrimonio_final,
        'diario_datas': diario_datas,
        'diario_patrimonios': diario_patrimonios,
        'diario_dinheiro': diario_dinheiro,
        'diario_secoes': diario_secoes,
        'diario_correcoes': diario_correcoes,
        'achados': achados,
        'nota_extra': nota_extra,
        'dia_referencia': dia_referencia,
    }


def resolver_extra(bens, indisponibilidades, extra_patrimonio):
    """Acha o bem da 12a indisponibilidade, a que nao esta na planilha."""
    if extra_patrimonio is not None:
        escolhidos = [b for b in bens if b['nr_patrimonio'] == extra_patrimonio]
        if len(escolhidos) != 1:
            raise ErroDeCarga(
                'O patrimônio informado em --extra-indisponibilidade não casa com '
                'exatamente um bem da planilha (%d encontrados).' % len(escolhidos))
        alvo = escolhidos[0]
        nota = ('informado à mão em --extra-indisponibilidade')
    else:
        ja_indisponiveis = {i['nr_patrimonio'] for i in indisponibilidades}
        quebrados = [b for b in bens
                     if b['tipo_nome'] == TIPO_PLOTTER
                     and b['nr_patrimonio'] in ja_indisponiveis]
        if len(quebrados) != 1:
            raise ErroDeCarga(
                'A regra da 12ª indisponibilidade esperava exatamente UM plotter já '
                'indisponível na planilha, e encontrou %d. Informe o bem à mão com '
                '--extra-indisponibilidade <arquivo.json>.' % len(quebrados))
        referencia = quebrados[0]
        gemeos = [b for b in bens
                  if b['tipo_nome'] == TIPO_PLOTTER
                  and b['modelo'] == referencia['modelo']
                  and b['nr_patrimonio'] != referencia['nr_patrimonio']]
        if len(gemeos) != 1:
            raise ErroDeCarga(
                'A regra da 12ª indisponibilidade esperava exatamente UM plotter de '
                'mesmo modelo que o já indisponível, e encontrou %d. Informe o bem à '
                'mão com --extra-indisponibilidade <arquivo.json>.' % len(gemeos))
        alvo = gemeos[0]
        nota = ('resolvido por regra: é o único outro plotter de mesmo modelo que o '
                'plotter já indisponível de %s' % referencia['onde'])

    if any(i['nr_patrimonio'] == alvo['nr_patrimonio'] for i in indisponibilidades):
        raise ErroDeCarga(
            'O bem da 12ª indisponibilidade (%s) já tem indisponibilidade vinda da '
            'planilha. A restrição EXCLUDE do banco recusaria as duas.' % alvo['onde'])

    return {
        'onde': '%s (fora da planilha)' % alvo['onde'],
        'nr_patrimonio': alvo['nr_patrimonio'],
        'tipo_nome': alvo['tipo_nome'],
        'modelo': alvo['modelo'],
        'data_inicio': datetime.date.fromisoformat(EXTRA_DATA_INICIO),
        'data_fim': None,
        'motivo': EXTRA_MOTIVO,
        'previsao_retorno': None,
        'origem': 'fora da planilha (a 12ª linha da 7.1 do RPCMTec de julho de 2026)',
    }, nota


def conferir_sobreposicao(itens, rotulo):
    """O banco tem EXCLUDE por bem e intervalo. Melhor falhar aqui do que la."""
    por_bem = {}
    for item in itens:
        por_bem.setdefault(item['nr_patrimonio'], []).append(item)
    for patrimonio, grupo in por_bem.items():
        if len(grupo) < 2:
            continue
        for i in range(len(grupo)):
            for j in range(i + 1, len(grupo)):
                a, b = grupo[i], grupo[j]
                fim_a = a['data_fim'] or datetime.date.max
                fim_b = b['data_fim'] or datetime.date.max
                if a['data_inicio'] <= fim_b and b['data_inicio'] <= fim_a:
                    raise ErroDeCarga(
                        'Duas linhas de %s do mesmo bem com intervalos que se '
                        'sobrepõem (%s e %s). A restrição EXCLUDE do banco recusaria '
                        'a segunda.' % (rotulo, a['onde'], b['onde']))


def derivar_situacao(registro, indisponibilidades, afastamentos, manutencoes, dia):
    """O que `equipamento.situacao_em(dia)` vai responder para este bem.

    Reproduz a precedencia do DDL: vale o degrau mais alto que se aplicar no dia.
    Serve so para o relatorio, e e o que permite conferir a coluna Situacao da
    planilha contra o que o sistema passara a mostrar.
    """
    if not registro['ativo']:
        return 'Baixado'
    patrimonio = registro['nr_patrimonio']

    def vigente(itens):
        for item in itens:
            if item['nr_patrimonio'] != patrimonio:
                continue
            if item['data_inicio'] <= dia and (item['data_fim'] is None
                                               or item['data_fim'] >= dia):
                return True
        return False

    if vigente(indisponibilidades):
        return 'Indisponível'
    if vigente(manutencoes):
        return 'Em manutenção'
    if vigente(afastamentos):
        return 'Afastado'
    return 'Disponível'


# ---------------------------------------------------------------------------
# O relatorio de conferencia, que e o produto de verdade deste script
# ---------------------------------------------------------------------------

def secao(titulo):
    print()
    print('=' * LARGURA)
    print(titulo)
    print('=' * LARGURA)


def subsecao(titulo):
    print()
    print(titulo)
    print('-' * LARGURA)


def contar(valores):
    contagem = {}
    for valor in valores:
        contagem[valor] = contagem.get(valor, 0) + 1
    return sorted(contagem.items(), key=lambda par: (-par[1], par[0]))


def data_br(valor):
    return '' if valor is None else valor.strftime('%d/%m/%Y')


def imprimir_relatorio(plano, caminho_ods, aba, usuario_uuid, saida, aplicar):
    bens = plano['bens']
    lidos = plano['lidos']
    dia = plano['dia_referencia']

    secao('CARGA DO MÓDULO EQUIPAMENTO A PARTIR DO RELATÓRIO DMT')
    print('Planilha .......... %s' % os.path.basename(caminho_ods))
    print('Aba ............... %s' % aba)
    print('Linhas de dado .... %d' % len(lidos))
    print('Usuário de cadastramento (uuid) ... %s' % usuario_uuid)
    print('Dia de referência da situação derivada ... %s' % dia.isoformat())
    if aplicar:
        print('Modo .............. APLICAR: gera o SQL em %s' % saida)
        print('                    Nada é escrito no banco por este script. O SQL')
        print('                    gerado é UMA transação, e o operador o aplica.')
    else:
        print('Modo .............. ENSAIO: nada é escrito, em lugar nenhum.')
        print('                    Use --aplicar com --saida para gerar o SQL.')

    # -----------------------------------------------------------------
    secao('1. AS LINHAS, UMA A UMA')
    print('Esta tabela existe para ser lida UMA vez, contra a planilha aberta ao lado.')
    print('Depois dela, ninguém mais relerá as %d linhas.' % len(lidos))
    print()
    tipos_ordenados = list(TIPOS_SEMEADOS)
    print('Legenda do tipo:')
    for indice, nome in enumerate(tipos_ordenados, start=1):
        print('  %d = %s (%d meses de vida útil)' % (indice, nome, TIPOS_SEMEADOS[nome]))
    print()

    largura_patrimonio = max([len(r['nr_patrimonio']) for r in lidos] + [10])
    largura_modelo = max([len(r['modelo']) for r in lidos] + [6])
    cabecalho = ('%-4s %-*s %2s %-*s %-10s %-4s %-9s %-9s %-13s %-13s %s'
                 % ('lin', largura_patrimonio, 'patrimônio', 'tp', largura_modelo,
                    'modelo', 'entrada', 'cls', 'seç.plan.', 'seç.carga',
                    'sit.planilha', 'sit.derivada', 'destino'))
    print(cabecalho)
    print('-' * len(cabecalho))
    fora = {p['onde'] for p in plano['pendencias']}
    for registro in lidos:
        destino = 'PENDÊNCIA' if registro['onde'] in fora else 'carga'
        derivada = registro.get('situacao_derivada', '')
        marca = ''
        if destino == 'carga' and derivada != registro['situacao_planilha']:
            marca = '  <-- situação muda'
        print('%-4s %-*s %2d %-*s %-10s %-4s %-9s %-9s %-13s %-13s %s%s'
              % (registro['rotulo'], largura_patrimonio, registro['nr_patrimonio'],
                 tipos_ordenados.index(registro['tipo_nome']) + 1,
                 largura_modelo, registro['modelo'],
                 data_br(registro['data_entrada_carga']),
                 registro['classe_nome'], registro['secao_planilha'],
                 registro['secao_nome'], registro['situacao_planilha'] or '',
                 derivada, destino, marca))

    # -----------------------------------------------------------------
    secao('2. AS CONTAGENS, PARA BATER COM A PLANILHA')
    print('Linhas na planilha ......... %d' % len(lidos))
    print('Bens que a carga escreve ... %d' % len(bens))
    print('Pendências de cadastro ..... %d' % len(plano['pendencias']))

    subsecao('2.1 Por tipo')
    print('%-56s %8s %8s' % ('tipo', 'planilha', 'carga'))
    contagem_carga = dict(contar([r['tipo_nome'] for r in bens]))
    for nome, quantidade in contar([r['tipo_nome'] for r in lidos]):
        print('%-56s %8d %8d' % (nome, quantidade, contagem_carga.get(nome, 0)))

    subsecao('2.2 Por classe de suprimento')
    contagem_carga = dict(contar([r['classe_nome'] for r in bens]))
    for nome, quantidade in contar([r['classe_nome'] for r in lidos]):
        print('%-56s %8d %8d' % ('%s (code %d)' % (nome, CLASSE_SUPRIMENTO[nome]),
                                 quantidade, contagem_carga.get(nome, 0)))

    subsecao('2.3 Por seção, antes e depois do remapeamento')
    contagem_carga = dict(contar([r['secao_nome'] for r in bens]))
    for nome, quantidade in contar([r['secao_planilha'] for r in lidos]):
        destino = REMAPA_SECAO[nome]
        print('%-24s -> %-24s planilha %3d    carga %3d'
              % (nome, '%s (code %d)' % (destino, SECAO_DETENTORA[destino]),
                 quantidade, contagem_carga.get(destino, 0)))

    subsecao('2.4 Por situação: a coluna da planilha contra a derivada em %s'
             % dia.isoformat())
    print('A situação não é coluna do banco: ela sai de equipamento.situacao_em(dia),')
    print('pela precedência Baixado > Indisponível > Em manutenção > Afastado > Disponível.')
    print()
    contagem_derivada = dict(contar([r['situacao_derivada'] for r in bens]))
    todas = sorted(set(list(contagem_derivada)
                       + [r['situacao_planilha'] for r in lidos if r['situacao_planilha']]),
                   key=lambda nome: SITUACAO[nome])
    contagem_planilha = dict(contar([r['situacao_planilha'] for r in lidos]))
    print('%-20s %10s %10s' % ('situação', 'planilha', 'derivada'))
    for nome in todas:
        print('%-20s %10d %10d'
              % (nome, contagem_planilha.get(nome, 0), contagem_derivada.get(nome, 0)))

    # -----------------------------------------------------------------
    secao('3. AS TRANSFORMAÇÕES, COM O ANTES E O DEPOIS')

    subsecao('3.1 Remapeamento de seção (SUPOSIÇÃO A1, já avisada ao chefe)')
    print('A planilha usa os nomes internos da Divisão; o domínio do banco tem dois')
    print('códigos. O remapeamento é suposição, e não leitura: confira-o.')
    print()
    for antes, quantidade in contar([d['antes'] for d in plano['diario_secoes']]):
        print('  %-14s -> %-14s  %3d linha(s)' % (antes, REMAPA_SECAO[antes], quantidade))

    subsecao('3.2 Patrimônios normalizados (%d)' % len(plano['diario_patrimonios']))
    print('A célula gravada como número volta como 104820700014462.0 ou em notação')
    print('exponencial. A carga usa o TEXTO VISÍVEL, com strip(), sempre.')
    print()
    for item in plano['diario_patrimonios']:
        print('  %-12s %-28s -> %-20s (%s)'
              % (item['onde'], item['antes'], item['depois'], item['motivo']))

    subsecao('3.3 Datas convertidas (%d)' % len(plano['diario_datas']))
    for item in plano['diario_datas']:
        alerta = ''
        if item['divergente']:
            alerta = '  <-- ATENÇÃO: o texto da célula diz %s' % item['texto_diz']
        print('  %-52s %-12s -> %-12s  (%s)%s'
              % (item['onde'], item['antes'], item['depois'], item['origem'], alerta))

    subsecao('3.4 Anos de dois dígitos')
    print('A regra: aa <= 50 vira 20aa, senão 19aa. Assim 29/07/14 é 2014 e 09/04/26')
    print('é 2026. O corte em 50 é generoso: o acervo mais antigo é dos anos 1990, e')
    print('nenhum bem de topografia entra em carga em 2051.')
    print()
    de_dois = [d for d in plano['diario_datas'] if d['dois_digitos']]
    de_texto = [d for d in plano['diario_datas'] if d['origem'] == 'texto da célula']
    print('  Células escritas com ano de dois dígitos ..... %d de %d'
          % (len(de_dois), len(plano['diario_datas'])))
    print('  Células sem atributo de data no ODS .......... %d' % len(de_texto))
    print()
    anos = {}
    for item in de_dois:
        anos.setdefault(item['antes'][-2:], item['depois'][:4])
    print('  Expansões distintas: %s'
          % ', '.join('%s -> %s' % par for par in sorted(anos.items())))
    if de_texto:
        print()
        print('  As que a regra realmente decidiu, porque o ODS não trazia a data:')
        for item in de_texto:
            print('    %-52s %-12s -> %s' % (item['onde'], item['antes'], item['depois']))

    if plano['diario_dinheiro']:
        subsecao('3.5 Valores em reais, extraídos da frase (%d)'
                 % len(plano['diario_dinheiro']))
        print('A planilha guarda o dinheiro dentro de uma frase, e não em célula numérica.')
        print()
        for item in plano['diario_dinheiro']:
            print('  %-52s %-34s -> %s' % (item['onde'], item['antes'], item['depois']))

    if plano['diario_correcoes']:
        subsecao('3.6 Correções de patrimônio informadas em --correcoes (%d)'
                 % len(plano['diario_correcoes']))
        for item in plano['diario_correcoes']:
            print('  %-12s %-20s -> %s' % (item['onde'], item['antes'], item['depois']))

    # -----------------------------------------------------------------
    secao('4. AS LINHAS QUE MERECEM OLHO')

    numero = 0

    if plano['pendencias']:
        numero += 1
        subsecao('4.%d Patrimônio repetido: dois bens diferentes com o mesmo número'
                 % numero)
        print('O chefe disse que é erro de digitação, e não disse QUAL das linhas está')
        print('errada. A carga não inventa número: fica a primeira e a outra sai, para')
        print('cadastro manual pela tela. Com --correcoes, ela volta.')
        for item in plano['pendencias']:
            gemea = plano['indice'].get(item['nr_patrimonio'])
            print()
            print('  FICA    %-10s %s  %s  entrada %s'
                  % (gemea['onde'], gemea['nr_patrimonio'], gemea['modelo'],
                     data_br(gemea['data_entrada_carga'])))
            print('          tipo: %s' % gemea['tipo_nome'])
            print('  SAI     %-10s %s  %s  entrada %s'
                  % (item['onde'], item['nr_patrimonio'], item['modelo'],
                     data_br(item['entrada'])))
            print('          tipo: %s' % item['tipo'])
            print('          -> PENDÊNCIA: cadastrar pela tela, com o número correto.')

    numero += 1
    subsecao('4.%d Plotter fora da Mapoteca, que o remapeamento manda para a Cia Lev'
             % numero)
    print('A regra da seção 3.1 é por SEÇÃO, e não por tipo. Plotter cuja seção na')
    print('planilha é a de levantamento vai para a Cia Lev, e isso pode estar certo')
    print('(é o plotter de campo) ou pode ser lançamento errado na planilha.')
    print()
    achou = False
    for registro in bens:
        if registro['tipo_nome'] == TIPO_PLOTTER and registro['secao_nome'] != 'Cia Prod':
            achou = True
            print('  %-10s %s  %s' % (registro['onde'], registro['nr_patrimonio'],
                                      registro['modelo']))
            print('             seção na planilha %r -> %r na carga'
                  % (registro['secao_planilha'], registro['secao_nome']))
    if not achou:
        print('  Nenhum. Todos os plotters da planilha caem na Cia Prod.')

    de_texto = [d for d in plano['diario_datas'] if d['origem'] == 'texto da célula']
    if de_texto:
        numero += 1
        subsecao('4.%d Data digitada como texto, em outro formato que o resto' % numero)
        print('O ODS não trouxe atributo de data para estas células, e o ano veio com')
        print('quatro dígitos onde as demais usam dois. Foram lidas pelo texto.')
        print()
        for item in de_texto:
            print('  %-52s %-12s -> %s' % (item['onde'], item['antes'], item['depois']))

    por_suposicao = [i for i in plano['indisponibilidades'] if i.get('previsao_por_suposicao')]
    if por_suposicao:
        numero += 1
        subsecao('4.%d Previsão de retorno que o gestor escreveu só com o ano '
                 '(SUPOSIÇÃO A2)' % numero)
        print('Onde o gestor escreveu apenas o ano, a carga grava 31 de dezembro: é a')
        print('única leitura que não antecipa o retorno. Confira as duas.')
        print()
        for item in por_suposicao:
            print('  %-28s %s  %s' % (item['onde'], item['nr_patrimonio'], item['modelo']))
            print('       início %s, motivo %r'
                  % (data_br(item['data_inicio']), item['motivo']))
            print('       previsão de retorno: "%d" -> %s'
                  % (ANO_PREVISAO_RETORNO_PLOTTER, data_br(item['previsao_retorno'])))

    fora_da_planilha = [i for i in plano['indisponibilidades'] if i['origem'] != 'planilha']
    if fora_da_planilha:
        numero += 1
        subsecao('4.%d A indisponibilidade que NÃO está na planilha' % numero)
        print('O RPCMTec de julho de 2026 tem 12 linhas na 7.1 e a planilha só explica 11.')
        print('Sem esta, julho passa a imprimir 11 onde o gestor digitou 12.')
        print('O bem foi %s.' % plano['nota_extra'])
        print()
        for item in fora_da_planilha:
            print('  %-28s %s  %s' % (item['onde'], item['nr_patrimonio'], item['modelo']))
            print('       início %s, sem data de fim, motivo %r'
                  % (data_br(item['data_inicio']), item['motivo']))

    divergentes = [r for r in bens if r['situacao_derivada'] != r['situacao_planilha']]
    if divergentes:
        numero += 1
        subsecao('4.%d Bens cuja situação MUDA em relação à coluna da planilha' % numero)
        print('A situação passa a ser derivada dos lançamentos. Onde ela diverge da')
        print('coluna da planilha, ou a planilha está desatualizada, ou o lançamento está')
        print('errado. Não há terceira hipótese.')
        print()
        for registro in divergentes:
            print('  %-10s %s  %-34s planilha %-13s -> derivada %s'
                  % (registro['onde'], registro['nr_patrimonio'], registro['modelo'],
                     registro['situacao_planilha'], registro['situacao_derivada']))

    if plano['achados']:
        numero += 1
        subsecao('4.%d Outros achados' % numero)
        for texto in plano['achados']:
            print('  %s' % texto)

    # -----------------------------------------------------------------
    secao('5. O QUE SERÁ ESCRITO, TABELA POR TABELA')
    linhas_por_tabela = [
        ('equipamento.equipamento', len(bens)),
        ('equipamento.indisponibilidade', len(plano['indisponibilidades'])),
        ('equipamento.afastamento', len(plano['afastamentos'])),
        ('equipamento.manutencao', len(plano['manutencoes'])),
        ('equipamento.transferencia', len(plano['transferencias'])),
    ]
    for nome, quantidade in linhas_por_tabela:
        print('  %-34s %4d linha(s)' % (nome, quantidade))
    print('  %-34s %4d linha(s)' % ('TOTAL', sum(q for _, q in linhas_por_tabela)))
    print()
    print('Nenhuma linha de domínio é escrita: classe_suprimento, secao_detentora,')
    print('situacao, situacao_transferencia, tipo_transferencia e tipo_equipamento vêm')
    print('semeadas em er/equipamento.sql, e a carga apenas as CASA por nome.')
    print()
    print('A carga NÃO escreve auditoria.evento. A auditoria do SCA é do servidor')
    print('(usuário da sessão, estado antes e depois lidos do banco), e carga inicial')
    print('roda por fora do serviço, como a implantação da mapoteca.')

    subsecao('5.1 As indisponibilidades (%d)' % len(plano['indisponibilidades']))
    for item in sorted(plano['indisponibilidades'], key=lambda x: x['data_inicio']):
        dias = (dia - item['data_inicio']).days
        print('  %-28s %-18s início %s (%4d dias)  previsão %s'
              % (item['onde'], item['nr_patrimonio'], data_br(item['data_inicio']),
                 dias, data_br(item['previsao_retorno']) or 'nenhuma'))
        print('       %s' % item['motivo'])

    subsecao('5.2 Os afastamentos (%d)' % len(plano['afastamentos']))
    for item in plano['afastamentos']:
        print('  %-28s %-18s OM %s, início %s, previsão de término %s'
              % (item['onde'], item['nr_patrimonio'], item['om'],
                 data_br(item['data_inicio']),
                 data_br(item['previsao_termino']) or 'nenhuma'))
        print('       %s' % item['motivo'])

    subsecao('5.3 As manutenções (%d)' % len(plano['manutencoes']))
    for item in plano['manutencoes']:
        print('  %-28s %-18s início %s' % (item['onde'], item['nr_patrimonio'],
                                           data_br(item['data_inicio'])))
        print('       orçado %s, PDR %s, certame %s, valor gasto %s'
              % (sql_dinheiro(item['valor_orcado']), sql_dinheiro(item['valor_pdr']),
                 item['certame'],
                 sql_dinheiro(item['valor']) if item['valor'] is not None else 'nenhum'))
        print('       ligada à indisponibilidade do mesmo bem, de mesma data de início.')

    subsecao('5.4 As transferências (%d)' % len(plano['transferencias']))
    print('Cada célula %r da coluna "Previsão disponibilidade ou descarga" vira uma'
          % MARCA_DESCARGA)
    print('transferência de tipo Descarga (%d) em situação Solicitada (%d), sem OM, sem'
          % (TIPO_TRANSFERENCIA_DESCARGA, SITUACAO_TRANSFERENCIA_SOLICITADA))
    print('documento e sem data: a planilha não traz nenhuma dessas colunas preenchida.')
    print('Descarga SOLICITADA não é baixa, e por isso os bens seguem com ativo = TRUE.')
    print()
    for item in plano['transferencias']:
        print('  %-10s %-18s %-34s %s / %s'
              % (item['onde'], item['nr_patrimonio'], item['modelo'],
                 item['tipo_nome'], item['situacao_nome']))

    # -----------------------------------------------------------------
    secao('6. PENDÊNCIAS PARA CADASTRO MANUAL PELA TELA')
    if not plano['pendencias']:
        print('Nenhuma. Todas as linhas da planilha entram na carga.')
    else:
        for item in plano['pendencias']:
            print('  %s: %s, %s, entrada %s, patrimônio %s repetido com %s.'
                  % (item['onde'], item['modelo'], item['tipo'],
                     data_br(item['entrada']), item['nr_patrimonio'],
                     item['conflita_com']))
        print()
        print('Cadastre pela tela #/equipamento/bens depois de o chefe dizer qual dos')
        print('dois números de patrimônio está errado, ou rode de novo com')
        print('--correcoes <arquivo.json>, no formato {"<linha>": "<patrimônio>"}.')

    print()
    print('=' * LARGURA)
    if aplicar:
        print('FIM DO RELATÓRIO. O SQL foi gerado em %s' % saida)
        print('Aplique com: psql -v ON_ERROR_STOP=1 -f <o arquivo gerado>')
    else:
        print('FIM DO RELATÓRIO. ENSAIO: nada foi escrito.')
    print('=' * LARGURA)


# ---------------------------------------------------------------------------
# Geracao do SQL
# ---------------------------------------------------------------------------

def sql_texto(valor):
    if valor is None:
        return 'NULL'
    return "'" + str(valor).replace("'", "''") + "'"


def sql_data(valor):
    return 'NULL' if valor is None else "DATE '%s'" % valor.isoformat()


def sql_numero(valor):
    return 'NULL' if valor is None else str(valor)


def sql_dinheiro(valor):
    """NUMERIC(14,2): duas casas SEMPRE, e nunca notacao exponencial."""
    return 'NULL' if valor is None else '%.2f' % valor


def sql_bem_por_patrimonio(patrimonio):
    return ('(SELECT id FROM equipamento.equipamento WHERE nr_patrimonio = %s)'
            % sql_texto(patrimonio))


def gerar_sql(plano, usuario_uuid, nome_planilha):
    """Monta UMA transacao. Ou entra inteira, ou nao entra.

    As guardas do inicio param a transacao com mensagem em portugues ANTES de
    qualquer escrita, e a conferencia do fim confere as contagens ainda dentro da
    transacao, para que numero errado vire ROLLBACK e nao vire cadastro torto.
    """
    usuario = "%s::uuid" % sql_texto(usuario_uuid)
    partes = []

    partes.append('-- Carga inicial do módulo equipamento, gerada por')
    partes.append('-- scripts/carregar_equipamento_dmt.py em %s'
                  % datetime.date.today().isoformat())
    partes.append('-- Fonte: %s' % nome_planilha)
    partes.append('--')
    partes.append('-- ESTE ARQUIVO CONTÉM DADO REAL (patrimônio, OM, valor orçado).')
    partes.append('-- Ele NÃO pode entrar no repositório, que é público.')
    partes.append('--')
    partes.append('-- Aplique com: psql -v ON_ERROR_STOP=1 -f <este arquivo>')
    partes.append('--')
    partes.append('-- Linhas: equipamento %d, indisponibilidade %d, afastamento %d,'
                  % (len(plano['bens']), len(plano['indisponibilidades']),
                     len(plano['afastamentos'])))
    partes.append('--         manutencao %d, transferencia %d.'
                  % (len(plano['manutencoes']), len(plano['transferencias'])))
    partes.append('')
    partes.append("SET client_encoding TO 'UTF8';")
    partes.append('')
    partes.append('BEGIN;')
    partes.append('')

    # ---- guardas ---------------------------------------------------------
    partes.append('-- Guarda 1: o usuário de cadastramento tem de existir.')
    partes.append('DO $carga$')
    partes.append('BEGIN')
    partes.append('  IF NOT EXISTS (SELECT 1 FROM dgeo.usuario WHERE uuid = %s) THEN'
                  % usuario)
    partes.append("    RAISE EXCEPTION 'Usuário de cadastramento não existe em "
                  "dgeo.usuario.';")
    partes.append('  END IF;')
    partes.append('END')
    partes.append('$carga$;')
    partes.append('')

    nomes = ', '.join(sql_texto(nome) for nome in TIPOS_SEMEADOS)
    partes.append('-- Guarda 2: os nove tipos semeados têm de estar lá, com o nome exato.')
    partes.append('-- A carga casa o tipo por NOME. Semente divergente viraria tipo_id')
    partes.append('-- nulo, e o erro sairia como violação de NOT NULL, sem dizer por quê.')
    partes.append('DO $carga$')
    partes.append('DECLARE achados INTEGER;')
    partes.append('BEGIN')
    partes.append('  SELECT count(*) INTO achados FROM equipamento.tipo_equipamento')
    partes.append('   WHERE nome IN (%s);' % nomes)
    partes.append('  IF achados <> %d THEN' % len(TIPOS_SEMEADOS))
    partes.append("    RAISE EXCEPTION 'A semente de equipamento.tipo_equipamento "
                  "divergiu: esperados %% dos nove nomes do QDMP, encontrados %%.', "
                  "%d, achados;" % len(TIPOS_SEMEADOS))
    partes.append('  END IF;')
    partes.append('END')
    partes.append('$carga$;')
    partes.append('')

    partes.append('-- Guarda 3: esta é carga INICIAL, e roda uma vez só.')
    partes.append('DO $carga$')
    partes.append('BEGIN')
    partes.append('  IF EXISTS (SELECT 1 FROM equipamento.equipamento) THEN')
    partes.append("    RAISE EXCEPTION 'equipamento.equipamento já tem linhas. Esta "
                  "carga é inicial e não sabe conciliar com o que já está lá.';")
    partes.append('  END IF;')
    partes.append('END')
    partes.append('$carga$;')
    partes.append('')

    # ---- bens ------------------------------------------------------------
    partes.append('-- %d bens. `tipo_id` sai de uma subconsulta por NOME: se a semente'
                  % len(plano['bens']))
    partes.append('-- divergir, ela devolve NULL e a coluna NOT NULL derruba a transação.')
    partes.append('INSERT INTO equipamento.equipamento')
    partes.append('  (nr_patrimonio, classe_id, tipo_id, modelo, nr_serie,')
    partes.append('   data_entrada_carga, vida_util_meses, secao_detentora_id, ativo,')
    partes.append('   observacao, usuario_cadastramento_uuid)')
    partes.append('VALUES')
    valores = []
    for registro in plano['bens']:
        valores.append(
            '  (%s, %d, (SELECT id FROM equipamento.tipo_equipamento WHERE nome = %s),\n'
            '   %s, %s, %s, %s, %d, %s, %s, %s)'
            % (sql_texto(registro['nr_patrimonio']), registro['classe_id'],
               sql_texto(registro['tipo_nome']), sql_texto(registro['modelo']),
               sql_texto(registro['nr_serie']), sql_data(registro['data_entrada_carga']),
               sql_numero(registro['vida_util_meses']), registro['secao_id'],
               'TRUE' if registro['ativo'] else 'FALSE',
               sql_texto(registro['observacao']), usuario))
    partes.append(',\n'.join(valores) + ';')
    partes.append('')

    # ---- indisponibilidades ---------------------------------------------
    if plano['indisponibilidades']:
        partes.append('-- %d indisponibilidades. A última NÃO vem da planilha: é a 12ª'
                      % len(plano['indisponibilidades']))
        partes.append('-- linha da 7.1 do RPCMTec de julho de 2026, que a planilha de')
        partes.append('-- agosto não explica.')
        partes.append('INSERT INTO equipamento.indisponibilidade')
        partes.append('  (equipamento_id, data_inicio, data_fim, motivo, previsao_retorno,')
        partes.append('   usuario_cadastramento_uuid)')
        partes.append('VALUES')
        valores = []
        for item in plano['indisponibilidades']:
            valores.append(
                '  (%s,\n   %s, %s, %s, %s, %s)'
                % (sql_bem_por_patrimonio(item['nr_patrimonio']),
                   sql_data(item['data_inicio']), sql_data(item['data_fim']),
                   sql_texto(item['motivo']), sql_data(item['previsao_retorno']), usuario))
        partes.append(',\n'.join(valores) + ';')
        partes.append('')

    # ---- afastamentos ----------------------------------------------------
    if plano['afastamentos']:
        partes.append('-- %d afastamentos.' % len(plano['afastamentos']))
        partes.append('INSERT INTO equipamento.afastamento')
        partes.append('  (equipamento_id, om, motivo, data_inicio, previsao_termino,')
        partes.append('   data_fim, usuario_cadastramento_uuid)')
        partes.append('VALUES')
        valores = []
        for item in plano['afastamentos']:
            valores.append(
                '  (%s,\n   %s, %s, %s, %s, %s, %s)'
                % (sql_bem_por_patrimonio(item['nr_patrimonio']),
                   sql_texto(item['om']), sql_texto(item['motivo']),
                   sql_data(item['data_inicio']), sql_data(item['previsao_termino']),
                   sql_data(item['data_fim']), usuario))
        partes.append(',\n'.join(valores) + ';')
        partes.append('')

    # ---- manutencoes -----------------------------------------------------
    for item in plano['manutencoes']:
        partes.append('-- Manutenção de %s, amarrada à indisponibilidade do MESMO bem,'
                      % item['onde'])
        partes.append('-- de mesma data de início. Um INSERT ... SELECT porque o id da')
        partes.append('-- indisponibilidade só existe depois do INSERT acima.')
        partes.append('INSERT INTO equipamento.manutencao')
        partes.append('  (equipamento_id, indisponibilidade_id, data_inicio, data_fim,')
        partes.append('   descricao, valor, valor_orcado, valor_pdr, certame,')
        partes.append('   usuario_cadastramento_uuid)')
        partes.append('SELECT e.id, i.id, %s, %s, %s, %s, %s, %s, %s, %s'
                      % (sql_data(item['data_inicio']), sql_data(item['data_fim']),
                         sql_texto(item['descricao']), sql_dinheiro(item['valor']),
                         sql_dinheiro(item['valor_orcado']), sql_dinheiro(item['valor_pdr']),
                         sql_texto(item['certame']), usuario))
        partes.append('  FROM equipamento.equipamento AS e')
        partes.append('  JOIN equipamento.indisponibilidade AS i')
        partes.append('    ON i.equipamento_id = e.id AND i.data_inicio = %s'
                      % sql_data(item['data_inicio']))
        partes.append(' WHERE e.nr_patrimonio = %s;' % sql_texto(item['nr_patrimonio']))
        partes.append('')

    # ---- transferencias --------------------------------------------------
    if plano['transferencias']:
        partes.append('-- %d descargas SOLICITADAS, uma por célula da coluna 18. Sem OM,'
                      % len(plano['transferencias']))
        partes.append('-- sem documento e sem data: a planilha não traz nada disso.')
        partes.append('INSERT INTO equipamento.transferencia')
        partes.append('  (equipamento_id, tipo_id, situacao_id, usuario_cadastramento_uuid)')
        partes.append('VALUES')
        valores = []
        for item in plano['transferencias']:
            valores.append('  (%s, %d, %d, %s)'
                           % (sql_bem_por_patrimonio(item['nr_patrimonio']),
                              item['tipo_id'], item['situacao_id'], usuario))
        partes.append(',\n'.join(valores) + ';')
        partes.append('')

    # ---- conferencia dentro da transacao ---------------------------------
    esperados = (
        ('equipamento.equipamento', len(plano['bens'])),
        ('equipamento.indisponibilidade', len(plano['indisponibilidades'])),
        ('equipamento.afastamento', len(plano['afastamentos'])),
        ('equipamento.manutencao', len(plano['manutencoes'])),
        ('equipamento.transferencia', len(plano['transferencias'])),
    )
    partes.append('-- Conferência AINDA DENTRO da transação: contagem errada vira')
    partes.append('-- ROLLBACK, e não cadastro torto. O INSERT ... SELECT da manutenção')
    partes.append('-- é o que mais precisa disto: sem linha casada, ele insere zero e')
    partes.append('-- não reclama.')
    partes.append('DO $carga$')
    partes.append('DECLARE achados BIGINT;')
    partes.append('BEGIN')
    for tabela, quantidade in esperados:
        partes.append('  SELECT count(*) INTO achados FROM %s;' % tabela)
        partes.append('  IF achados <> %d THEN' % quantidade)
        partes.append("    RAISE EXCEPTION '%s deveria ficar com %d linha(s), e ficou "
                      "com %%.', achados;" % (tabela, quantidade))
        partes.append('  END IF;')
    partes.append('END')
    partes.append('$carga$;')
    partes.append('')
    partes.append('COMMIT;')
    partes.append('')

    return '\n'.join(partes)


# ---------------------------------------------------------------------------
# Linha de comando
# ---------------------------------------------------------------------------

AJUDA = """Carga inicial do módulo equipamento a partir do Relatório DMT (.ods).

Uso:
  python scripts/carregar_equipamento_dmt.py --ods <caminho> --usuario <uuid>
  python scripts/carregar_equipamento_dmt.py --ods <caminho> --usuario <uuid> \\
      --aplicar --saida <caminho fora do repositório>.sql

  --ods <caminho>       a planilha. Obrigatório. Nunca fica no repositório.
  --usuario <uuid>      o uuid de dgeo.usuario que assina o cadastramento.
  --aplicar             gera o SQL. SEM ele, nada é escrito em lugar nenhum.
  --saida <caminho>     onde gravar o SQL. Obrigatório com --aplicar, e recusado
                        se apontar para dentro do repositório: o SQL traz dado
                        real, e o repositório é público.
  --correcoes <arq>     JSON {"<linha>": "<patrimônio>"} que corrige o número de
                        patrimônio de uma linha, para o dia em que o chefe disser
                        qual das duas linhas repetidas está errada.
  --extra-indisponibilidade <arq>
                        JSON {"nr_patrimonio": "<patrimônio>"} que aponta à mão o
                        bem da 12ª indisponibilidade, a que não está na planilha.
                        Sem isto, ela é resolvida por regra.
  --dia <aaaa-mm-dd>    dia de referência da situação derivada no relatório.
                        Padrão: hoje.
  --ajuda               esta ajuda.

O relatório de conferência sai SEMPRE, com ou sem --aplicar. Ele é o produto:
existe para alguém reler as linhas da planilha uma vez, porque é a única vez em
que isso vai acontecer.
"""

# Credencial nunca entra por argumento de linha de comando: ali ela fica no
# historico do shell e aparece na lista de processos para qualquer um logado na
# maquina. Este script nem se conecta ao banco, entao nao ha o que passar.
OPCOES_RECUSADAS = ('--senha', '--password', '--db-url', '--conexao', '--credencial')

OPCOES_COM_VALOR = ('--ods', '--usuario', '--saida', '--correcoes',
                    '--extra-indisponibilidade', '--dia')
BANDEIRAS = ('--aplicar', '--ajuda', '-h')


def ler_argumentos(argv):
    opcoes = {'aplicar': False, 'ajuda': False}
    resto = list(argv)
    while resto:
        atual = resto.pop(0)
        if atual in OPCOES_RECUSADAS:
            raise ErroDeCarga(
                'A opção %s não existe, e não vai existir: credencial em linha de '
                'comando fica no histórico do shell e aparece na lista de processos. '
                'Este script não se conecta a banco nenhum.' % atual)
        if atual in BANDEIRAS:
            if atual == '--aplicar':
                opcoes['aplicar'] = True
            else:
                opcoes['ajuda'] = True
            continue
        if atual in OPCOES_COM_VALOR:
            if not resto:
                raise ErroDeCarga('A opção %s precisa de um valor.' % atual)
            opcoes[atual.lstrip('-').replace('-', '_')] = resto.pop(0)
            continue
        raise ErroDeCarga('Opção desconhecida: %r. Use --ajuda.' % atual)
    return opcoes


def caminho_dentro_do_repositorio(caminho):
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    alvo = os.path.abspath(caminho)
    try:
        comum = os.path.commonpath([raiz, alvo])
    except ValueError:      # unidades diferentes no Windows
        return False
    return comum == raiz


def ler_json(caminho, rotulo):
    try:
        with open(caminho, encoding='utf-8') as arquivo:
            return json.load(arquivo)
    except OSError as erro:
        raise ErroDeCarga('Não foi possível ler o arquivo de %s: %s' % (rotulo, erro))
    except ValueError as erro:
        raise ErroDeCarga('O arquivo de %s não é JSON válido: %s' % (rotulo, erro))


def conferir_cabecalho(linhas):
    if len(linhas) <= LINHA_CABECALHO:
        raise ErroDeCarga('A planilha não tem a linha de cabeçalho esperada.')
    cabecalho = linhas[LINHA_CABECALHO]
    for indice, pedaco in sorted(CABECALHO_ESPERADO.items()):
        lido = (celula(cabecalho, indice)['texto'] or '').strip()
        if pedaco.lower() not in lido.lower():
            raise ErroDeCarga(
                'A coluna %d da planilha deveria conter %r no cabeçalho, e contém %r.\n'
                'A carga PARA aqui: se a planilha mudou de layout, ler modelo na coluna '
                'do patrimônio não daria erro nenhum, e ninguém veria.'
                % (indice, pedaco, lido))


def principal(argv):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, ValueError):
        pass

    try:
        opcoes = ler_argumentos(argv)
    except ErroDeCarga as erro:
        print('PARADO: %s' % erro)
        return 2

    if opcoes['ajuda'] or not argv:
        print(AJUDA)
        return 0

    try:
        caminho_ods = opcoes.get('ods')
        if not caminho_ods:
            raise ErroDeCarga('Informe a planilha em --ods. Veja --ajuda.')
        if not os.path.isfile(caminho_ods):
            raise ErroDeCarga('A planilha informada em --ods não existe.')

        usuario_uuid = (opcoes.get('usuario') or '').strip()
        if not RE_UUID.match(usuario_uuid):
            raise ErroDeCarga(
                'Informe em --usuario o uuid de dgeo.usuario que assina o '
                'cadastramento, no formato 8-4-4-4-12.')

        saida = opcoes.get('saida')
        if opcoes['aplicar']:
            if not saida:
                raise ErroDeCarga(
                    'Com --aplicar é obrigatório informar --saida, o caminho do arquivo '
                    '.sql. Ele traz dado real e tem de ficar FORA do repositório.')
            if caminho_dentro_do_repositorio(saida):
                raise ErroDeCarga(
                    'O caminho de --saida aponta para dentro do repositório, que é '
                    'PÚBLICO. O SQL gerado traz número de patrimônio, OM de afastamento '
                    'e valor orçado. Escolha um caminho fora do repositório.')
        elif saida:
            raise ErroDeCarga(
                '--saida só faz sentido com --aplicar. Sem --aplicar este script não '
                'escreve nada, em lugar nenhum.')

        correcoes = {}
        if opcoes.get('correcoes'):
            cru = ler_json(opcoes['correcoes'], 'correções')
            if not isinstance(cru, dict):
                raise ErroDeCarga(
                    'O arquivo de correções deve ser um objeto JSON no formato '
                    '{"<linha>": "<patrimônio>"}.')
            correcoes = {str(chave).strip(): str(valor) for chave, valor in cru.items()}

        extra_patrimonio = None
        if opcoes.get('extra_indisponibilidade'):
            cru = ler_json(opcoes['extra_indisponibilidade'], 'indisponibilidade extra')
            if not isinstance(cru, dict) or not cru.get('nr_patrimonio'):
                raise ErroDeCarga(
                    'O arquivo de --extra-indisponibilidade deve ser um objeto JSON '
                    'com a chave "nr_patrimonio".')
            extra_patrimonio = str(cru['nr_patrimonio']).strip()

        if opcoes.get('dia'):
            try:
                dia = datetime.date.fromisoformat(opcoes['dia'])
            except ValueError:
                raise ErroDeCarga('O --dia deve vir no formato aaaa-mm-dd.')
        else:
            dia = datetime.date.today()

        abas = ler_ods(caminho_ods)
        if not abas:
            raise ErroDeCarga('A planilha não tem nenhuma aba.')
        if len(abas) > 1:
            raise ErroDeCarga(
                'A planilha tem %d abas, e a carga espera UMA. Confira o arquivo.'
                % len(abas))
        nome_aba, linhas = abas[0]
        conferir_cabecalho(linhas)

        plano = montar_plano(linhas, correcoes, extra_patrimonio, dia)

        for rotulo in correcoes:
            if not any(registro['rotulo'] == rotulo for registro in plano['lidos']):
                raise ErroDeCarga(
                    'O arquivo de correções aponta para a linha %r, que não existe na '
                    'planilha.' % rotulo)

        imprimir_relatorio(plano, caminho_ods, nome_aba, usuario_uuid, saida,
                           opcoes['aplicar'])

        if opcoes['aplicar']:
            texto = gerar_sql(plano, usuario_uuid, os.path.basename(caminho_ods))
            with open(saida, 'w', encoding='utf-8', newline='\n') as arquivo:
                arquivo.write(texto)

        return 0

    except ErroDeCarga as erro:
        print()
        print('=' * LARGURA)
        print('PARADO. Nada foi escrito.')
        print('=' * LARGURA)
        print(erro)
        return 1


if __name__ == '__main__':
    sys.exit(principal(sys.argv[1:]))
