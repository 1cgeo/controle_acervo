#!/usr/bin/env python3
"""Carga do schema `campo` a partir do `controle_campo` do SAP.

POR QUE ISTO E UM SCRIPT, E NAO UMA MIGRACAO VERSIONADA
-------------------------------------------------------
O repositorio e PUBLICO. As linhas do SAP trazem nome de militar, placa de
viatura e coordenada de operacao, e uma migracao em `migrations/` publicaria
todos eles para sempre, em texto, sem volta. Por isso o dado nunca entra em
arquivo versionado: as conexoes chegam como ARGUMENTO na hora de rodar, e o SQL
gerado sai para um caminho FORA do repositorio, escolhido pelo operador em
`--saida` (e o script recusa `--saida` apontando para dentro do repositorio).

E o mesmo desenho de `scripts/carregar_equipamento_dmt.py`, e o mesmo precedente
da implantacao da mapoteca. Este arquivo, que E versionado, carrega REGRA e
nunca DADO.

O QUE PRECISA ESTAR PRONTO ANTES
--------------------------------
1. A migracao `migrations/2026-08-08_campo.sql` aplicada no banco do SCA.
2. O `controle_campo` do SAP restaurado DENTRO do banco do SCA, num schema de
   apoio. E de proposito: sao 283 MB (179 de foto e video, 97 de ponto de GPS), e
   fazer esses bytes atravessarem um processo Python seria pagar caro por nada.
   Dentro do mesmo banco, o `INSERT ... SELECT` os move sem sair do servidor.

       pg_restore --no-owner --no-privileges -n controle_campo \\
           -d <banco do SCA> <dump do SAP>

   E o `dgeo.usuario` do SAP tambem, num schema separado (`sap_dgeo`), porque o
   `dgeo.usuario` do SCA e outro e os dois nao podem colidir:

       pg_restore --no-owner --no-privileges -t usuario -f - <dump> \\
         | sed 's/dgeo\\.usuario/sap_dgeo.usuario/g' | psql -d <banco do SCA>

USO
---
    python scripts/carregar_campo_sap.py --banco <nome> [--host ...] [--porta ...]
        [--usuario-banco ...] --usuario <uuid>

    python scripts/carregar_campo_sap.py --banco <nome> --usuario <uuid> \\
        --aplicar --saida <caminho fora do repositorio>.sql

SEM `--aplicar` o script NAO ESCREVE NADA: le, confere e imprime o relatorio.
Esse e o padrao, e e o produto de verdade deste script. `--aplicar` gera o
arquivo `.sql`, e esse arquivo e UMA transacao (`BEGIN` ... `COMMIT`) com guardas
no inicio e conferencia de contagem no fim: ou entra inteira, ou nao entra.

    psql -v ON_ERROR_STOP=1 -f <o arquivo gerado>

A SENHA vem de `PGPASSWORD` no ambiente, como todo cliente do Postgres. Ela nunca
e argumento: argumento aparece na lista de processos da maquina.

AS TRES DECISOES DO CHEFE QUE ESTA CARGA EXECUTA (2026-08-08)
-------------------------------------------------------------
1. O ANO APONTA `pit.pit` DE VERDADE. Os campos do SAP vao de 2013 a 2026 e
   o PIT so tem 2025 e 2026, entao a carga CRIA os exercicios que faltam, como
   Encerrados. Sem eles a chave estrangeira recusa 44 dos 54 campos.
2. A GEOMETRIA E OBRIGATORIA. Os 7 campos sem poligono (todos voos de drone de
   2026) NAO entram inventados: o script os LISTA e o SQL gerado se RECUSA a
   rodar enquanto eles nao forem corrigidos. Quem tiver os poligonos os fornece
   em `--geometrias`, um arquivo `nome<TAB>WKT` fora do repositorio.
3. O VINCULO COM VERSAO E OPCIONAL. Ele casa `macrocontrole.produto.uuid` com
   `acervo.versao.uuid_versao`; o que nao casar e REPORTADO e nao impede nada.
   Viagem internacional e exercicio nao geram produto a apontar.

O QUE A CARGA NAO FAZ
---------------------
Nao registra `auditoria.evento`. A auditoria do SCA e do SERVIDOR (usuario da
sessao HTTP, estado antes e depois lidos do banco), e carga inicial roda por fora
do servico, como a implantacao da mapoteca e a do equipamento. O relatorio diz
isso em voz alta.

Sem dependencia: quem fala com o banco e o `psql` que ja esta instalado.
"""

import argparse
import os
import re
import subprocess
import sys

# Os codigos de dominio semeados em `er/campo.sql`. Espelham
# `server/src/utils/domain_constants.js`; dois lugares com o mesmo numero escrito
# a mao divergem no primeiro que alguem renumerar, e por isso a lista esta aqui
# INTEIRA e o script confere cada nome do SAP contra ela.
SITUACAO = {
    'Previsto': 1,
    'Em Execução': 2,
    'Finalizado': 3,
    'Cancelado': 4,
}

# O ENUM `controle_campo.categoria_campo` do SAP nao tem numero a herdar: os
# codigos abaixo sao NOVOS, e a ordem e a da declaracao do ENUM de la.
CATEGORIA = {
    'Reambulação': 1,
    'Modelos 3D': 2,
    'Imagens Panorâmicas em 360º': 3,
    'Pontos de Controle': 4,
    'Ortoimagens de Drone': 5,
}

# `dominio.situacao_exercicio`: os exercicios que a carga cria nascem Encerrados.
# Nao e detalhe -- exercicio Vigente aceita lancamento, e 2013 nao pode aceitar.
EXERCICIO_ENCERRADO = 3

SEPARADOR = '-' * 78


# ---------------------------------------------------------------------------
# Conversa com o banco
# ---------------------------------------------------------------------------

def psql(conexao, sql):
    """Roda o SQL e devolve as linhas como listas de texto.

    `-tA` tira cabecalho e alinhamento; `-F` fixa o separador. O separador e um
    caractere de controle (unidade de dado, 0x1f) e nao um ponto e virgula:
    nome de militar, descricao e motivo trazem virgula, ponto e virgula e
    tabulacao de verdade, e qualquer separador imprimivel partiria a linha no
    meio de um dado.
    """
    comando = [
        conexao['psql'], '-h', conexao['host'], '-p', str(conexao['porta']),
        '-U', conexao['usuario'], '-d', conexao['banco'],
        '-tA', '-F', '\x1f', '-v', 'ON_ERROR_STOP=1', '-c', sql,
    ]
    resultado = subprocess.run(comando, capture_output=True, text=True, encoding='utf-8')
    if resultado.returncode != 0:
        raise SystemExit(f'psql falhou:\n{resultado.stderr.strip()}')
    linhas = []
    for bruta in resultado.stdout.splitlines():
        if bruta == '':
            continue
        linhas.append(bruta.split('\x1f'))
    return linhas


def um_valor(conexao, sql):
    linhas = psql(conexao, sql)
    return linhas[0][0] if linhas else None


# ---------------------------------------------------------------------------
# Leitura do lado do SAP
# ---------------------------------------------------------------------------

def ler_campos(conexao, anos=None):
    """Os campos do SAP, com o que a conversao precisa decidir.

    `anos` recorta a carga. Ele existe para a IMPLANTACAO EM ETAPAS: trazer 2026
    primeiro, conferir na tela, e so entao trazer os treze anos anteriores. Sem
    ele a unica escolha seria tudo ou nada, e "tudo" inclui 79 militares que nao
    existem mais no cadastro e sete poligonos que faltam.

    O RECORTE VALE PARA A CARGA INTEIRA, e nao so para a tabela `campo`: imagem,
    track e vinculo entram pelo JOIN com os campos que passaram, entao um campo
    de fora do recorte nao deixa foto orfa para tras.
    """
    filtro = ''
    if anos:
        filtro = ' WHERE c.pit IN (' + ', '.join(str(int(a)) for a in anos) + ')'
    linhas = psql(conexao, """
        SELECT c.nome, c.pit, s.nome, c.geom IS NULL,
               COALESCE(array_to_string(c.categorias::text[], '|'), ''),
               COALESCE(c.militares, ''),
               c.inicio::date, c.fim::date
        FROM controle_campo.campo AS c
        INNER JOIN controle_campo.situacao AS s ON s.code = c.situacao_id
    """ + filtro + """
        ORDER BY c.pit, c.nome
    """)
    campos = []
    for nome, pit, situacao, sem_geom, categorias, militares, inicio, fim in linhas:
        campos.append({
            'nome': nome,
            'ano': int(pit),
            'situacao': situacao,
            'sem_geom': sem_geom == 't',
            'categorias': [c for c in categorias.split('|') if c],
            'militares': [m.strip() for m in militares.split(',') if m.strip()],
            'inicio': inicio,
            'fim': fim,
        })
    return campos


def ler_usuarios_do_sca(conexao):
    """O cadastro do SCA: 'posto nome_guerra' -> uuid, e 'nome_guerra' -> uuid.

    DOIS MAPAS, e a ordem em que se consultam importa. `militares` do SAP guarda
    a patente DA EPOCA ('ST Ferraz' hoje era '1o Sgt Ferraz' antes), entao o
    casamento exato acerta pouco e o casamento so pelo nome de guerra acerta
    mais. O exato vem primeiro porque e o unico que nao pode errar de pessoa.

    O SEGUNDO MAPA DESCARTA O HOMONIMO. Dois 'Silva' no cadastro tornam o nome
    de guerra ambiguo, e escolher um deles gravaria a pessoa errada num
    registro que ninguem vai reconferir. Ambiguo cai em `militares_externos`,
    que e a resposta honesta.
    """
    linhas = psql(conexao, """
        SELECT u.uuid, p.nome_abrev, u.nome_guerra
        FROM dgeo.usuario AS u
        INNER JOIN dominio.tipo_posto_grad AS p ON p.code = u.tipo_posto_grad_id
    """)
    exato = {}
    por_guerra = {}
    ambiguos = set()
    for uuid, posto, guerra in linhas:
        exato[f'{posto} {guerra}'.strip().lower()] = uuid
        chave = guerra.strip().lower()
        if chave in por_guerra and por_guerra[chave] != uuid:
            ambiguos.add(chave)
        por_guerra[chave] = uuid
    for chave in ambiguos:
        del por_guerra[chave]
    return exato, por_guerra, ambiguos


# O posto/graduacao na frente do nome, para separa-lo. A lista e a de
# `dominio.tipo_posto_grad` (er/dominio.sql), mais 'Al' e 'Ten', que aparecem no
# texto do SAP e NAO existem no dominio: 'Al' (aluno) nunca existiu, e 'Ten' e
# uma abreviacao informal de 1o ou 2o Tenente.
POSTOS = (
    'Civ', 'MOT', 'Sd EV', 'Sd EP', 'Sd', 'Cb', '3º Sgt', '2º Sgt', '1º Sgt',
    'ST', 'Asp', '2º Ten', '1º Ten', 'Cap', 'Maj', 'TC', 'Cel', 'Al', 'Ten',
    'Sgt',
)
RE_POSTO = re.compile(r'^(' + '|'.join(re.escape(p) for p in POSTOS) + r')\s+', re.IGNORECASE)


def separar_posto(token):
    """'2º Sgt Ramos' -> ('2º Sgt', 'Ramos'). Sem posto reconhecido, ('', token).

    O SINAL DE GRAU vira ORDINAL MASCULINO antes de tudo. O acervo do SAP tem um
    '3° Sgt Tolfo' com '°' (U+00B0) onde o resto usa 'º' (U+00BA): sao dois
    caracteres diferentes, e sem esta troca aquele militar nunca casaria com o
    cadastro por um pixel de diferenca.
    """
    limpo = token.replace('°', 'º').strip()
    achado = RE_POSTO.match(limpo)
    if not achado:
        return '', limpo
    return achado.group(1), limpo[achado.end():].strip()


def casar_militares(tokens, exato, por_guerra):
    """Separa os nomes do SAP entre os que sao do cadastro e os que nao sao.

    @returns (uuids, nomes_de_fora)
    """
    uuids = []
    fora = []
    for token in tokens:
        posto, guerra = separar_posto(token)
        chave_exata = f'{posto} {guerra}'.strip().lower()
        uuid = exato.get(chave_exata) or por_guerra.get(guerra.lower())
        if uuid and uuid not in uuids:
            uuids.append(uuid)
        elif not uuid:
            fora.append(token.replace('°', 'º').strip())
    return uuids, fora


# ---------------------------------------------------------------------------
# Geometrias fornecidas a mao
# ---------------------------------------------------------------------------

def ler_geometrias(caminho):
    """`nome<TAB>WKT`, uma por linha. Linha em branco e `#` sao ignoradas.

    O WKT chega no SRID DE ORIGEM do desenho, que e o 4326 do SAP: a conversao
    para 4674 e do SQL gerado, exatamente como a dos campos que ja tem geometria.
    Pedir dois sistemas de referencia diferentes no mesmo arquivo seria a forma
    mais facil de alguem gravar o poligono deslocado sem nada acusar.
    """
    if not caminho:
        return {}
    mapa = {}
    with open(caminho, encoding='utf-8') as arquivo:
        for numero, bruta in enumerate(arquivo, start=1):
            linha = bruta.rstrip('\n')
            if not linha.strip() or linha.lstrip().startswith('#'):
                continue
            if '\t' not in linha:
                raise SystemExit(
                    f'{caminho}:{numero}: esperava `nome<TAB>WKT`, e nao ha tabulacao na linha'
                )
            nome, wkt = linha.split('\t', 1)
            mapa[nome.strip()] = wkt.strip()
    return mapa


# ---------------------------------------------------------------------------
# O plano
# ---------------------------------------------------------------------------

def montar_plano(conexao, geometrias_fornecidas, anos=None):
    """Le os dois lados e decide o que vai acontecer. NAO escreve nada."""
    campos = ler_campos(conexao, anos)
    exato, por_guerra, ambiguos = ler_usuarios_do_sca(conexao)

    anos_do_sap = sorted({c['ano'] for c in campos})
    anos_do_pit = {int(l[0]) for l in psql(conexao, 'SELECT ano FROM pit.pit')}
    anos_a_criar = [a for a in anos_do_sap if a not in anos_do_pit]

    bloqueados = []
    for campo in campos:
        if campo['sem_geom'] and campo['nome'] not in geometrias_fornecidas:
            bloqueados.append(campo['nome'])

    desconhecidas = set()
    for campo in campos:
        for categoria in campo['categorias']:
            if categoria not in CATEGORIA:
                desconhecidas.add(categoria)
        if campo['situacao'] not in SITUACAO:
            desconhecidas.add(f'situacao {campo["situacao"]}')

    casados = 0
    for campo in campos:
        uuids, fora = casar_militares(campo['militares'], exato, por_guerra)
        campo['uuids'] = uuids
        campo['fora'] = fora
        casados += len(uuids)

    # O VINCULO COM VERSAO. Casa `macrocontrole.produto.uuid` com
    # `acervo.versao.uuid_versao`. `macrocontrole` pode nao ter sido restaurado
    # -- ele nao e necessario para a carga -- e nesse caso o vinculo inteiro fica
    # de fora, sem impedir nada.
    tem_macrocontrole = um_valor(conexao, """
        SELECT count(*) FROM information_schema.tables
         WHERE table_schema = 'macrocontrole' AND table_name = 'produto'
    """) != '0'
    # O MESMO RECORTE, escrito uma vez: ele entra em cinco consultas abaixo, e
    # cinco copias divergiriam no dia em que o filtro mudasse.
    recorte_sql = ''
    if anos:
        recorte_sql = ' WHERE c.pit IN (' + ', '.join(str(int(a)) for a in anos) + ')'

    versoes_casadas = 0
    versoes_orfas = 0
    if tem_macrocontrole:
        versoes_casadas = int(um_valor(conexao, """
            SELECT count(*)
              FROM controle_campo.relacionamento_campo_produto AS r
              INNER JOIN controle_campo.campo AS c ON c.id = r.campo_id
              INNER JOIN macrocontrole.produto AS p ON p.id = r.produto_id
              INNER JOIN acervo.versao AS v ON v.uuid_versao::text = p.uuid
        """ + recorte_sql))
        versoes_orfas = int(um_valor(conexao, """
            SELECT count(*)
              FROM controle_campo.relacionamento_campo_produto AS r
              INNER JOIN controle_campo.campo AS c ON c.id = r.campo_id
              INNER JOIN macrocontrole.produto AS p ON p.id = r.produto_id
              LEFT JOIN acervo.versao AS v ON v.uuid_versao::text = p.uuid
             WHERE v.id IS NULL
        """ + (recorte_sql.replace(' WHERE ', ' AND ') if recorte_sql else '')))

    return {
        'campos': campos,
        'anos_a_criar': anos_a_criar,
        'bloqueados': bloqueados,
        'desconhecidas': sorted(desconhecidas),
        'ambiguos': sorted(ambiguos),
        'militares_casados': casados,
        'tem_macrocontrole': tem_macrocontrole,
        'versoes_casadas': versoes_casadas,
        'versoes_orfas': versoes_orfas,
        'imagens': int(um_valor(conexao, f'''
            SELECT count(*) FROM controle_campo.imagem AS i
             INNER JOIN controle_campo.campo AS c ON c.id = i.campo_id{recorte_sql}''')),
        'tracks': int(um_valor(conexao, f'''
            SELECT count(*) FROM controle_campo.track AS t
             INNER JOIN controle_campo.campo AS c ON c.id = t.campo_id{recorte_sql}''')),
        'pontos': int(um_valor(conexao, f'''
            SELECT count(*) FROM controle_campo.track_p AS p
             INNER JOIN controle_campo.track AS t ON t.id = p.track_id
             INNER JOIN controle_campo.campo AS c ON c.id = t.campo_id{recorte_sql}''')),
        'geometrias_fornecidas': geometrias_fornecidas,
        'anos_do_recorte': sorted(anos) if anos else None,
    }


def imprimir_relatorio(plano):
    campos = plano['campos']
    print(SEPARADOR)
    print('CARGA DO SCHEMA `campo` A PARTIR DO `controle_campo` DO SAP')
    print(SEPARADOR)
    if plano['anos_do_recorte']:
        anos = ', '.join(str(a) for a in plano['anos_do_recorte'])
        print(f'RECORTE: so os anos {anos}. O resto do SAP fica de fora desta etapa.')
        print()
    print(f'campos no SAP:                {len(campos)}')
    if campos:
        print(f'  anos:                       {campos[0]["ano"]} a {campos[-1]["ano"]}')
    print(f'imagens (fotos e videos):     {plano["imagens"]}')
    print(f'trajetos:                     {plano["tracks"]} ({plano["pontos"]} pontos de GPS)')
    print()

    print('EXERCICIOS DO PIT A CRIAR (Encerrados)')
    if plano['anos_a_criar']:
        print('  ' + ', '.join(str(a) for a in plano['anos_a_criar']))
        print('  Sem eles a chave estrangeira `campo.ano -> pit.pit` recusa os campos')
        print('  desses anos. Eles nascem vazios: nenhuma meta, nenhuma execucao.')
    else:
        print('  nenhum: todo ano do SAP ja tem exercicio no PIT.')
    print()

    print('MILITARES')
    tokens = sum(len(c['militares']) for c in campos)
    fora = sum(len(c['fora']) for c in campos)
    print(f'  citacoes no texto do SAP:   {tokens}')
    print(f'  casadas com `dgeo.usuario`: {plano["militares_casados"]}')
    print(f'  para `militares_externos`:  {fora}')
    print('  Quem nao casa NAO se perde: vai para a coluna de texto, que e o que')
    print('  sustenta o efetivo da subsecao 2.5 dos anos antigos.')
    if plano['ambiguos']:
        print(f'  AMBIGUOS (nome de guerra repetido no cadastro): {", ".join(plano["ambiguos"])}')
        print('  Esses caem em `militares_externos` de proposito: escolher um dos dois')
        print('  gravaria a pessoa errada num registro que ninguem vai reconferir.')
    print()

    print('VINCULO COM `acervo.versao` (opcional)')
    if not plano['tem_macrocontrole']:
        print('  `macrocontrole.produto` nao esta neste banco: o vinculo NAO sera criado.')
        print('  Isso nao impede a carga. Restaure aquele schema e rode de novo se quiser.')
    else:
        print(f'  casados com `uuid_versao`:  {plano["versoes_casadas"]}')
        print(f'  sem versao no acervo:       {plano["versoes_orfas"]}')
        print('  O vinculo e OPCIONAL: viagem internacional e exercicio nao geram produto.')
    print()

    if plano['desconhecidas']:
        print('CODIGO DE DOMINIO DESCONHECIDO -- A CARGA NAO PODE PROSSEGUIR')
        for nome in plano['desconhecidas']:
            print(f'  {nome}')
        print('  Acrescente-o em `er/campo.sql`, na migracao e neste script antes de seguir.')
        print()

    print('GEOMETRIA')
    fornecidas = len(plano['geometrias_fornecidas'])
    if fornecidas:
        print(f'  fornecidas em --geometrias: {fornecidas}')
    if plano.get('pulados'):
        print(f'  PULADOS por falta de poligono: {len(plano["pulados"])} '
              '-- eles NAO entram nesta carga')
        for nome in plano['pulados']:
            print(f'    {nome}')
        print('  Eles continuam no SAP e podem entrar depois, quando alguem desenhar')
        print('  a area: rode de novo com --geometrias, so para eles.')
    if plano['bloqueados']:
        print(f'  SEM POLIGONO E SEM SUBSTITUTO: {len(plano["bloqueados"])} -- A CARGA ESTA BLOQUEADA')
        for nome in plano['bloqueados']:
            print(f'    {nome}')
        print()
        print('  `campo.geom` e NOT NULL por decisao do chefe em 2026-08-08, e este')
        print('  script NAO inventa um ponto no meio do municipio. Desenhe os poligonos')
        print('  (no SAP ou no QGIS) e forneca-os num arquivo `nome<TAB>WKT`, em')
        print('  EPSG:4326, fora do repositorio:')
        print()
        print('      python scripts/carregar_campo_sap.py ... --geometrias <caminho>.tsv')
    else:
        print('  todos os campos tem poligono.')
    print(SEPARADOR)


# ---------------------------------------------------------------------------
# O SQL
# ---------------------------------------------------------------------------

def literal(texto):
    """Literal de texto do Postgres, ou NULL."""
    if texto is None or texto == '':
        return 'NULL'
    return "'" + texto.replace("'", "''") + "'"


def gerar_sql(plano, usuario_uuid):
    campos = plano['campos']
    linhas = []
    escrever = linhas.append

    escrever('-- Carga do schema `campo` a partir do `controle_campo` do SAP.')
    escrever('-- GERADO por scripts/carregar_campo_sap.py. Nao edite a mao: rode de novo.')
    escrever('--')
    escrever('-- UMA TRANSACAO. Ou entra inteira, ou nao entra.')
    escrever('--')
    escrever('-- NAO grava `auditoria.evento`: a auditoria do SCA e do SERVIDOR, e carga')
    escrever('-- inicial roda por fora do servico. E o mesmo da implantacao da mapoteca e')
    escrever('-- da do equipamento.')
    if plano['anos_do_recorte']:
        escrever('--')
        escrever('-- CARGA PARCIAL, so dos anos '
                 + ', '.join(str(a) for a in plano['anos_do_recorte']) + '.')
    if plano.get('pulados'):
        escrever('--')
        escrever(f'-- {len(plano["pulados"])} CAMPOS FICARAM DE FORA por nao terem poligono, e')
        escrever('-- estao nomeados abaixo. Nenhuma geometria foi inventada; eles continuam no')
        escrever('-- SAP e entram numa carga posterior, com --geometrias:')
        for nome in plano['pulados']:
            escrever(f'--   {nome}')
    escrever('')
    escrever('BEGIN;')
    escrever('')
    escrever('-- --- Guardas ------------------------------------------------------------')
    escrever('--')
    escrever('-- As tres coisas que, se nao forem verdade, fariam a carga gravar lixo em')
    escrever('-- silencio. Elas param a transacao ANTES da primeira escrita.')
    escrever('DO $guarda$')
    escrever('BEGIN')
    escrever("  IF to_regclass('campo.campo') IS NULL THEN")
    escrever("    RAISE EXCEPTION 'o schema `campo` nao existe: aplique migrations/2026-08-08_campo.sql antes';")
    escrever('  END IF;')
    escrever("  IF to_regclass('controle_campo.campo') IS NULL THEN")
    escrever("    RAISE EXCEPTION 'o schema de apoio `controle_campo` nao esta neste banco: restaure o dump do SAP nele';")
    escrever('  END IF;')
    # A GUARDA RESPEITA O RECORTE. Sem isso, a segunda etapa (os anos antigos,
    # depois de 2026 ja estar na tela) seria recusada pela primeira. O que ela
    # protege continua sendo o mesmo: esta carga e INICIAL para os anos que
    # traz, e nao sabe conciliar linha que ja esteja la.
    if plano['anos_do_recorte']:
        anos = ', '.join(str(a) for a in plano['anos_do_recorte'])
        escrever(f'  IF EXISTS (SELECT 1 FROM campo.campo WHERE ano IN ({anos})) THEN')
        escrever(f"    RAISE EXCEPTION 'campo.campo JA TEM LINHA de {anos}: esta carga e inicial e nao sabe conciliar';")
        escrever('  END IF;')
    else:
        escrever('  IF EXISTS (SELECT 1 FROM campo.campo) THEN')
        escrever("    RAISE EXCEPTION 'campo.campo JA TEM LINHA: esta carga e inicial e nao sabe conciliar';")
        escrever('  END IF;')
    escrever(f'  IF NOT EXISTS (SELECT 1 FROM dgeo.usuario WHERE uuid = {literal(usuario_uuid)}) THEN')
    escrever("    RAISE EXCEPTION 'o usuario de cadastramento informado nao existe em dgeo.usuario';")
    escrever('  END IF;')
    escrever('END')
    escrever('$guarda$;')
    escrever('')

    if plano['anos_a_criar']:
        escrever('-- --- Exercicios do PIT --------------------------------------------------')
        escrever('--')
        escrever('-- ENCERRADOS, e nao Vigentes: exercicio vigente aceita lancamento, e 2013')
        escrever('-- nao pode aceitar. Eles nascem VAZIOS -- nenhuma meta, nenhuma execucao --')
        escrever('-- e existem para que `campo.ano` aponte o plano de verdade em vez de ser um')
        escrever('-- numero solto. Decisao do chefe em 2026-08-08.')
        valores = ', '.join(
            f'({ano}, {EXERCICIO_ENCERRADO}, {literal(usuario_uuid)})'
            for ano in plano['anos_a_criar']
        )
        escrever('INSERT INTO pit.pit (ano, situacao_id, usuario_cadastramento_uuid)')
        escrever(f'VALUES {valores}')
        escrever('ON CONFLICT (ano) DO NOTHING;')
        escrever('')

    escrever('-- --- Os campos ----------------------------------------------------------')
    escrever('--')
    escrever('-- `ST_Transform(..., 4674)` porque o SAP guarda em 4326 e todo o SCA guarda')
    escrever('-- em 4674 (SIRGAS2000). A diferenca entre os dois e subcentimetrica, mas sem')
    escrever('-- a conversao o cruzamento com `limites.municipio` -- que e de onde sai a')
    escrever('-- coluna "Local" da subsecao 2.5 -- pediria um ST_Transform em toda consulta.')
    escrever('--')
    escrever('-- `orgao` NAO vem: era "1o CGEO" em 54 linhas de 54.')
    escrever('-- `inicio`/`fim` viram DATE: campo comeca num dia e acaba noutro, e a hora')
    escrever('-- nunca foi perguntada por ninguem.')
    escrever('--')
    escrever('-- A LISTA DE `militares_externos` E CALCULADA AQUI, e nao copiada do SAP: ela')
    escrever('-- traz SO quem nao casou com `dgeo.usuario`, e quem casou vira linha em')
    escrever('-- `campo.campo_militar`. Copiar o texto inteiro gravaria cada militar duas')
    escrever('-- vezes, e o efetivo da 2.5 sairia dobrado.')

    for campo in campos:
        wkt = plano['geometrias_fornecidas'].get(campo['nome'])
        if wkt:
            geom = f'ST_Transform(ST_Multi(ST_GeomFromText({literal(wkt)}, 4326)), 4674)'
        else:
            geom = ('(SELECT ST_Transform(ST_Multi(o.geom), 4674) '
                    'FROM controle_campo.campo AS o WHERE o.nome = '
                    f'{literal(campo["nome"])})')
        externos = ', '.join(campo['fora'])
        escrever('INSERT INTO campo.campo')
        escrever('  (nome, descricao, ano, situacao_id, data_inicio, data_fim,')
        escrever('   placas_vtr, militares_externos, geom, usuario_cadastramento_uuid)')
        escrever('SELECT o.nome, o.descricao, o.pit, '
                 f'{SITUACAO[campo["situacao"]]}, o.inicio::date, o.fim::date,')
        escrever(f'       o.placas_vtr, {literal(externos)}, {geom}, {literal(usuario_uuid)}')
        escrever(f'  FROM controle_campo.campo AS o WHERE o.nome = {literal(campo["nome"])};')
    escrever('')

    escrever('-- --- Finalidade ---------------------------------------------------------')
    escrever('--')
    escrever('-- O ARRAY DE ENUM DO SAP VIRA LINHA DE JUNCAO. Array de enum nao tem chave')
    escrever('-- estrangeira: um valor removido do dominio sobrevivia dentro do array de')
    escrever('-- quem ja o usava, sem nada reclamar.')
    for campo in campos:
        for categoria in campo['categorias']:
            escrever('INSERT INTO campo.campo_categoria (campo_id, categoria_id)')
            escrever(f'SELECT id, {CATEGORIA[categoria]} FROM campo.campo '
                     f'WHERE nome = {literal(campo["nome"])};')
    escrever('')

    escrever('-- --- Militares da Divisao -----------------------------------------------')
    escrever('--')
    escrever('-- SO QUEM CASOU com `dgeo.usuario`. O casamento foi feito pelo script, que')
    escrever('-- tentou "posto mais nome de guerra" e depois so o nome de guerra: o texto do')
    escrever('-- SAP guarda a patente DA EPOCA, entao o exato acerta pouco. Nome de guerra')
    escrever('-- repetido no cadastro NAO casa com ninguem, de proposito.')
    for campo in campos:
        for uuid in campo['uuids']:
            escrever('INSERT INTO campo.campo_militar (campo_id, usuario_uuid)')
            escrever(f'SELECT id, {literal(uuid)} FROM campo.campo '
                     f'WHERE nome = {literal(campo["nome"])};')
    escrever('')

    escrever('-- --- Imagens ------------------------------------------------------------')
    escrever('--')
    escrever('-- OS BYTES NAO PASSAM POR AQUI: sao 179 MB, e o INSERT ... SELECT os move')
    escrever('-- dentro do servidor. E por isso que a restauracao do SAP tem de ser no MESMO')
    escrever('-- banco do SCA.')
    escrever('--')
    escrever('-- O `mime_type` SE ADIVINHA PELO NUMERO MAGICO quando o SAP o deixou nulo,')
    escrever('-- que e o caso de 133 das 143 linhas. O que nao se reconhece fica NULO e a')
    escrever('-- rota serve com o tipo generico: inventar "image/jpeg" para tudo gravaria um')
    escrever('-- palpite, e vídeo servido como imagem nao toca.')
    escrever('INSERT INTO campo.imagem')
    escrever('  (campo_id, descricao, data_imagem, tipo, mime_type, conteudo,')
    escrever('   usuario_cadastramento_uuid)')
    escrever('SELECT c.id, o.descricao, o.data_imagem::date, o.tipo,')
    escrever('       COALESCE(o.mime_type,')
    escrever("         CASE WHEN substring(o.imagem_bin FROM 1 FOR 3) = '\\xffd8ff'::bytea THEN 'image/jpeg'")
    escrever("              WHEN substring(o.imagem_bin FROM 1 FOR 8) = '\\x89504e470d0a1a0a'::bytea THEN 'image/png'")
    escrever("              WHEN substring(o.imagem_bin FROM 1 FOR 4) = '\\x47494638'::bytea THEN 'image/gif'")
    escrever("              WHEN substring(o.imagem_bin FROM 5 FOR 4) = '\\x66747970'::bytea THEN 'video/mp4'")
    escrever('              ELSE NULL END),')
    escrever(f'       o.imagem_bin, {literal(usuario_uuid)}')
    escrever('  FROM controle_campo.imagem AS o')
    escrever('  INNER JOIN controle_campo.campo AS oc ON oc.id = o.campo_id')
    escrever('  INNER JOIN campo.campo AS c ON c.nome = oc.nome')
    escrever("  WHERE o.imagem_bin IS NOT NULL;")
    escrever('')

    escrever('-- --- Trajetos -----------------------------------------------------------')
    escrever('--')
    escrever('-- `x_ll` e `y_ll` do SAP NAO vem: eram a longitude e a latitude do MESMO')
    escrever('-- ponto que `geom` ja guarda. Duas copias de uma coordenada nao tem como')
    escrever('-- estarem as duas certas depois da primeira correcao.')
    escrever('--')
    escrever('-- A LINHA do trajeto tambem nao: ela e a VIEW `campo.track_linha`, costurada')
    escrever('-- na leitura. No SAP era materializada, e linha velha mente sem avisar.')
    escrever('INSERT INTO campo.track')
    escrever('  (campo_id, chefe_vtr, motorista, placa_vtr, dia, usuario_cadastramento_uuid)')
    escrever(f'SELECT c.id, o.chefe_vtr, o.motorista, o.placa_vtr, o.dia, {literal(usuario_uuid)}')
    escrever('  FROM controle_campo.track AS o')
    escrever('  INNER JOIN controle_campo.campo AS oc ON oc.id = o.campo_id')
    escrever('  INNER JOIN campo.campo AS c ON c.nome = oc.nome;')
    escrever('')
    escrever('-- O ponto casa o track pela TRINCA (campo, placa, dia), que e o que o')
    escrever('-- identifica: os ids do SAP sao uuid e os daqui sao BIGSERIAL, entao nao ha')
    escrever('-- id em comum para ligar os dois lados.')
    escrever('--')
    escrever('-- Ponto SEM `geom` fica de fora: `campo.track_ponto.geom` e NOT NULL, e um')
    escrever('-- ponto de GPS sem coordenada nao e um ponto.')
    escrever('INSERT INTO campo.track_ponto (track_id, geom, elevacao, momento)')
    escrever('SELECT t.id, ST_Transform(op.geom, 4674), op.elevation, op.creation_time')
    escrever('  FROM controle_campo.track_p AS op')
    escrever('  INNER JOIN controle_campo.track AS ot ON ot.id = op.track_id')
    escrever('  INNER JOIN controle_campo.campo AS oc ON oc.id = ot.campo_id')
    escrever('  INNER JOIN campo.campo AS c ON c.nome = oc.nome')
    escrever('  INNER JOIN campo.track AS t')
    escrever('     ON t.campo_id = c.id AND t.placa_vtr = ot.placa_vtr AND t.dia = ot.dia')
    escrever('  WHERE op.geom IS NOT NULL;')
    escrever('')

    if plano['tem_macrocontrole']:
        escrever('-- --- Versoes atendidas (OPCIONAL) ---------------------------------------')
        escrever('--')
        escrever('-- Casa `macrocontrole.produto.uuid` com `acervo.versao.uuid_versao`. O que')
        escrever('-- nao casar simplesmente NAO entra, e nao e falha: o vinculo e opcional, e')
        escrever('-- viagem internacional e exercicio nao geram produto a apontar.')
        escrever('INSERT INTO campo.campo_versao (campo_id, versao_id)')
        escrever('SELECT c.id, v.id')
        escrever('  FROM controle_campo.relacionamento_campo_produto AS r')
        escrever('  INNER JOIN controle_campo.campo AS oc ON oc.id = r.campo_id')
        escrever('  INNER JOIN campo.campo AS c ON c.nome = oc.nome')
        escrever('  INNER JOIN macrocontrole.produto AS p ON p.id = r.produto_id')
        escrever('  INNER JOIN acervo.versao AS v ON v.uuid_versao::text = p.uuid')
        escrever('ON CONFLICT DO NOTHING;')
        escrever('')

    escrever('-- --- Conferencia --------------------------------------------------------')
    escrever('--')
    escrever('-- O que o RELATORIO prometeu tem de ser o que entrou. Divergiu, a transacao')
    escrever('-- inteira volta: e o unico jeito de a carga nao deixar um estado pela metade.')
    total_categorias = sum(len(c['categorias']) for c in campos)
    total_militares = sum(len(c['uuids']) for c in campos)
    escrever('DO $confere$')
    escrever('DECLARE')
    escrever('  n bigint;')
    escrever('BEGIN')
    onde = ''
    if plano['anos_do_recorte']:
        onde = ' WHERE ano IN (' + ', '.join(str(a) for a in plano['anos_do_recorte']) + ')'
    escrever(f'  SELECT count(*) INTO n FROM campo.campo{onde};')
    escrever(f'  IF n <> {len(campos)} THEN')
    escrever(f"    RAISE EXCEPTION 'esperava {len(campos)} campos, entraram %', n;")
    escrever('  END IF;')
    escrever('  SELECT count(*) INTO n FROM campo.campo_categoria cc'
             ' INNER JOIN campo.campo c ON c.id = cc.campo_id'
             + (onde.replace(' WHERE ', ' WHERE c.') if onde else '') + ';')
    escrever(f'  IF n <> {total_categorias} THEN')
    escrever(f"    RAISE EXCEPTION 'esperava {total_categorias} finalidades, entraram %', n;")
    escrever('  END IF;')
    escrever('  SELECT count(*) INTO n FROM campo.campo_militar cm'
             ' INNER JOIN campo.campo c ON c.id = cm.campo_id'
             + (onde.replace(' WHERE ', ' WHERE c.') if onde else '') + ';')
    escrever(f'  IF n <> {total_militares} THEN')
    escrever(f"    RAISE EXCEPTION 'esperava {total_militares} militares, entraram %', n;")
    escrever('  END IF;')
    escrever('END')
    escrever('$confere$;')
    escrever('')
    escrever('COMMIT;')
    escrever('')
    escrever('-- DEPOIS DE CONFERIR, o schema de apoio pode sair:')
    escrever('--   DROP SCHEMA controle_campo CASCADE;')
    escrever('--   DROP SCHEMA IF EXISTS sap_dgeo CASCADE;')
    escrever('-- Ele ocupa os mesmos 283 MB que acabaram de ser copiados.')
    escrever('')

    return '\n'.join(linhas)


# ---------------------------------------------------------------------------
# Entrada
# ---------------------------------------------------------------------------

def dentro_do_repositorio(caminho):
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    alvo = os.path.abspath(caminho)
    try:
        comum = os.path.commonpath([raiz, alvo])
    except ValueError:
        # Unidades diferentes no Windows (a saida numa unidade e o repositorio
        # em outra). E o caminho CERTO (fora do repositorio), e sem este
        # except ele morria com traceback antes de a carga comecar. Mesmo trato
        # do irmao `carregar_equipamento_dmt.py`.
        return False
    return comum == raiz


def main():
    parser = argparse.ArgumentParser(
        description='Carga do schema `campo` a partir do `controle_campo` do SAP.'
    )
    parser.add_argument('--banco', required=True,
                        help='banco do SCA, ja com o `controle_campo` do SAP restaurado nele')
    parser.add_argument('--host', default='localhost')
    parser.add_argument('--porta', default='5432')
    parser.add_argument('--usuario-banco', default='postgres',
                        help='papel de conexao (a senha vem de PGPASSWORD)')
    parser.add_argument('--psql', default='psql', help='caminho do cliente psql')
    parser.add_argument('--usuario', required=True,
                        help='uuid de `dgeo.usuario` que assina a carga')
    parser.add_argument('--geometrias',
                        help='arquivo `nome<TAB>WKT` (EPSG:4326) com os poligonos que faltam')
    parser.add_argument('--sem-geometria', choices=['parar', 'pular'], default='parar',
                        help='o que fazer com o campo sem poligono. `parar` (padrao) bloqueia a '
                             'carga inteira; `pular` deixa o campo DE FORA, nomeado no relatorio '
                             'e no cabecalho do SQL. Nenhum dos dois inventa geometria')
    parser.add_argument('--ano', action='append', type=int,
                        help='recorta a carga a estes anos (repetivel). Sem ele, vem tudo. '
                             'Serve para implantar em etapas: 2026 primeiro, conferir, depois o resto')
    parser.add_argument('--aplicar', action='store_true',
                        help='gera o arquivo .sql (exige --saida)')
    parser.add_argument('--saida', help='caminho do .sql gerado, FORA do repositorio')
    args = parser.parse_args()

    if args.aplicar and not args.saida:
        raise SystemExit('--aplicar exige --saida')
    if args.saida and dentro_do_repositorio(args.saida):
        raise SystemExit(
            '--saida aponta para DENTRO do repositorio, e ele e publico. '
            'Escolha um caminho fora dele.'
        )

    conexao = {
        'psql': args.psql, 'host': args.host, 'porta': args.porta,
        'usuario': args.usuario_banco, 'banco': args.banco,
    }

    plano = montar_plano(conexao, ler_geometrias(args.geometrias), args.ano)
    plano['sem_geometria'] = args.sem_geometria

    # `pular` TIRA os campos sem poligono do plano, e nao os marca para ignorar
    # depois: o plano e o MESMO objeto que gera o SQL, entao o que o relatorio
    # promete e o que acontece. Deixa-los dentro com uma marca abriria a porta
    # para o gerador esquecer da marca.
    if args.sem_geometria == 'pular' and plano['bloqueados']:
        fora = set(plano['bloqueados'])
        plano['pulados'] = sorted(fora)
        plano['campos'] = [c for c in plano['campos'] if c['nome'] not in fora]
        plano['bloqueados'] = []

    imprimir_relatorio(plano)

    if not args.aplicar:
        print()
        print('MODO LEITURA: nada foi escrito. Use --aplicar --saida <caminho> para gerar o SQL.')
        return 0

    if plano['bloqueados']:
        raise SystemExit(
            '\nA carga esta BLOQUEADA pelos campos sem poligono listados acima. '
            'Nada foi gerado.'
        )
    if plano['desconhecidas']:
        raise SystemExit(
            '\nA carga esta BLOQUEADA por codigo de dominio desconhecido. Nada foi gerado.'
        )

    sql = gerar_sql(plano, args.usuario)
    with open(args.saida, 'w', encoding='utf-8', newline='\n') as arquivo:
        arquivo.write(sql)
    print()
    print(f'SQL gerado em {args.saida}')
    print('Confira e aplique com:  psql -v ON_ERROR_STOP=1 -f <o arquivo>')
    return 0


if __name__ == '__main__':
    sys.exit(main())
