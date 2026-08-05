# Path: gui\campos_acervo.py
"""Os campos do acervo e os construtores de corpo, num lugar só.

Cinco telas criam produto (a avulsa, a histórica e três de lote). O dicionário
do produto sai TODO daqui, e não de cada uma delas: campo novo em
`acervo.produto` entra nos cinco caminhos de uma vez.

O que se perde montando o corpo à mão é silencioso. O servidor grava `?? null`
no campo que não veio, então um produto sem `subtipo_produto_id` nasce sem
identidade e sem erro. A conta chega no `confirm-upload`, quando o gatilho
`acervo.validate_version` recusa a versão: como é exceção do PostgreSQL, ela
volta como 500 genérico, e os bytes já foram copiados para o volume.
"""
import datetime
import json

from qgis.PyQt.QtCore import QDate, QDateTime, Qt

from .camada_modelo import Campo, geometria_ewkt, sem_null
from ..core.dominios import TIPO_ESCALA_PERSONALIZADA

# --- campos de camada-modelo -------------------------------------------------

CAMPOS_PRODUTO = [
    Campo('nome', 'string', True, 'nome do produto (ex.: "Ponta Grossa")'),
    Campo('mi', 'string', False, 'índice de nomenclatura MI (ex.: "2965-1")'),
    Campo('inom', 'string', False, 'índice de nomenclatura INOM (ex.: "SG-22-X-A-I")'),
    Campo('tipo_produto_id', 'integer', True, 'código do tipo de produto'),
    Campo('subtipo_produto_id', 'integer', False,
          'código do subtipo que DEFINE a identidade do produto. Obrigatório para os '
          'subtipos que exigem produto próprio (Carta Topográfica Militar); deixe em '
          'branco para produto comum'),
    Campo('tipo_escala_id', 'integer', True, 'código da escala'),
    Campo('denominador_escala_especial', 'integer', False,
          f'só para escala personalizada (tipo {TIPO_ESCALA_PERSONALIZADA}); em branco nas demais'),
    Campo('descricao', 'string', False, 'texto livre'),
    Campo('geom', 'string', True,
          'WKT do polígono. Desnecessário se a camada já for de polígonos: '
          'nesse caso a geometria da feição é usada'),
]

# Os três campos que colidiriam com os do produto levam o sufixo `_versao`. É a
# nomenclatura das camadas COMBINADAS (produto e versão na mesma linha), e é a
# que `montar_versao` lê por padrão.
CAMPOS_VERSAO = [
    Campo('versao', 'string', True, 'rótulo da edição: "1-DSG" ou "1ª Edição"'),
    Campo('nome_versao', 'string', False, 'nome da versão'),
    Campo('tipo_versao_id', 'integer', True, 'código do tipo de versão'),
    Campo('subtipo_produto_id', 'integer', True, 'código do subtipo desta versão'),
    Campo('lote_id', 'integer', False, 'código do lote'),
    Campo('orgao_produtor', 'string', True, 'quem produziu (ex.: "1º CGEO")'),
    Campo('palavras_chave', 'string', False, 'etiquetas separadas por vírgula'),
    Campo('data_criacao', 'string', True, 'AAAA-MM-DD'),
    Campo('data_edicao', 'string', True, 'AAAA-MM-DD, nunca anterior a data_criacao'),
    Campo('descricao_versao', 'string', False, 'texto livre'),
    Campo('metadado_versao', 'string', False, 'JSON'),
]

CAMPOS_ARQUIVO = [
    Campo('nome', 'string', True, 'nome descritivo do arquivo'),
    Campo('nome_arquivo', 'string', True, 'nome do arquivo no volume, SEM extensão'),
    Campo('tipo_arquivo_id', 'integer', True, 'código do tipo de arquivo'),
    Campo('extensao', 'string', True, 'extensão sem o ponto (ex.: "tif")'),
    Campo('path', 'string', True, 'caminho completo do arquivo NESTA máquina'),
    Campo('situacao_carregamento_id', 'integer', True, 'código da situação de carregamento'),
    Campo('descricao', 'string', False, 'texto livre'),
    Campo('metadado', 'string', False, 'JSON'),
    Campo('crs_original', 'string', False, 'ex.: "EPSG:31982"'),
]


# --- conversões que toda camada precisa --------------------------------------

def data_iso(valor):
    """Data em 'AAAA-MM-DD'. Levanta ValueError quando não dá para ler.

    Confira a validade SEMPRE, e nunca confie no `try/except` em volta de
    `QDate.fromString`: com texto inválido ela não levanta exceção, devolve um
    QDate inválido, e o `toString` dele é a string VAZIA. Sem esta conferência,
    "12 de março" vira data em branco e segue para o servidor, que responde 400
    falando de um campo que a pessoa jurava ter preenchido.
    """
    if valor in (None, ''):
        raise ValueError("data em branco")

    if isinstance(valor, QDateTime):
        valor = valor.date()
    if isinstance(valor, QDate):
        if not valor.isValid():
            raise ValueError("data inválida")
        return valor.toString(Qt.DateFormat.ISODate)
    if isinstance(valor, datetime.datetime):
        return valor.date().isoformat()
    if isinstance(valor, datetime.date):
        return valor.isoformat()

    texto = str(valor).strip()
    for formato in ('%Y-%m-%d', '%d/%m/%Y', '%d-%m-%Y', '%Y/%m/%d'):
        try:
            return datetime.datetime.strptime(texto[:10], formato).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"data não reconhecida: '{texto}' (use AAAA-MM-DD)")


def palavras_chave(valor):
    """Lista de etiquetas a partir do texto separado por vírgula."""
    if not valor:
        return []
    if isinstance(valor, (list, tuple)):
        return [str(p).strip() for p in valor if str(p).strip()]
    return [p.strip() for p in str(valor).split(',') if p.strip()]


def metadado_json(valor):
    """Objeto do campo metadado. Levanta ValueError se o JSON não presta.

    Vazio vira `{}`, e não `None`: os schemas de versão e arquivo pedem objeto.
    """
    if valor in (None, '', {}):
        return {}
    if isinstance(valor, dict):
        return valor
    try:
        lido = json.loads(str(valor))
    except Exception:
        raise ValueError("metadado não é um JSON válido")
    if not isinstance(lido, dict):
        raise ValueError("metadado precisa ser um objeto JSON")
    return lido


# --- construtores de corpo ---------------------------------------------------

def montar_versao(feature, presentes, sufixo='', versao_sozinha=False):
    """Dicionário da versão. Devolve (versao, erro).

    `sufixo` cobre as camadas em que produto e versão convivem e os nomes
    colidiriam: lá a versão é `nome_versao` e `descricao_versao`.

    `versao_sozinha` diz que na camada não há produto, e então `nome` e
    `descricao` sem sufixo são da VERSÃO. É compatibilidade com as camadas que a
    equipe já montou: as telas de versão avulsa sempre chamaram esses campos
    assim, e renomeá-los agora invalidaria planilha pronta. Na camada em que as
    duas entidades convivem o fallback não vale, senão o nome do produto entraria
    como nome da versão sem erro nenhum.
    """
    def ler(nome, alternativo=None):
        chave = f'{nome}{sufixo}' if sufixo else nome
        if chave in presentes:
            valor = sem_null(feature[chave])
            if valor not in (None, ''):
                return valor
        if alternativo and alternativo in presentes:
            return sem_null(feature[alternativo])
        return None

    try:
        criacao = data_iso(ler('data_criacao'))
        edicao = data_iso(ler('data_edicao'))
    except ValueError as e:
        return None, str(e)

    # Espelha o CHECK data_edicao >= data_criacao de acervo.versao. Cobrar aqui
    # evita mandar um lote inteiro para tomar 400 por causa de uma linha.
    if edicao < criacao:
        return None, f"data_edicao ({edicao}) é anterior a data_criacao ({criacao})"

    try:
        # `metadado_versao` na camada em que produto e versão convivem (lá o
        # `metadado` seco seria ambíguo), `metadado` na camada só de versões.
        metadado = metadado_json(ler('metadado_versao', 'metadado' if versao_sozinha else None))
    except ValueError as e:
        return None, str(e)

    versao = {
        'uuid_versao': ler('uuid_versao'),
        'versao': ler('versao'),
        'nome': ler('nome_versao', 'nome' if versao_sozinha else None),
        'subtipo_produto_id': ler('subtipo_produto_id'),
        'lote_id': ler('lote_id'),
        'metadado': metadado,
        'descricao': ler('descricao_versao', 'descricao' if versao_sozinha else None) or '',
        'orgao_produtor': ler('orgao_produtor'),
        'palavras_chave': palavras_chave(ler('palavras_chave')),
        'data_criacao': criacao,
        'data_edicao': edicao,
    }

    # `tipo_versao_id` só quando a camada o tem, e a diferença é de ROTA, não de
    # gosto: as rotas de upload (`prepare-upload/version` e `/product`) o
    # EXIGEM, e as de versão histórica não o aceitam, porque lá o tipo é
    # decidido pela rota. Mandar a chave onde ela não cabe faz o servidor
    # responder 200 avisando que descartou o campo.
    if 'tipo_versao_id' in presentes:
        versao['tipo_versao_id'] = sem_null(feature['tipo_versao_id'])

    return versao, None


def montar_produto(feature, presentes, dominios, nome_campo='nome', descricao_campo='descricao'):
    """Dicionário do produto a partir de uma feição. Devolve (produto, erro).

    `nome_campo` e `descricao_campo` existem porque na camada COMBINADA eles
    seriam ambíguos e se chamam `produto_nome` e `descricao_produto`.

    Aqui moram as três regras que o servidor cobra e que cada cópia aplicava (ou
    esquecia) por conta própria: o denominador só existe na escala
    personalizada, a geometria é obrigatória, e o subtipo de identidade tem que
    ser um subtipo do tipo escolhido.
    """
    tipo_produto_id = sem_null(feature['tipo_produto_id'])
    tipo_escala_id = sem_null(feature['tipo_escala_id'])

    denominador = sem_null(feature['denominador_escala_especial']) \
        if 'denominador_escala_especial' in presentes else None
    if tipo_escala_id == TIPO_ESCALA_PERSONALIZADA:
        if denominador is None:
            return None, ("denominador_escala_especial é obrigatório na escala "
                          f"personalizada (tipo {TIPO_ESCALA_PERSONALIZADA})")
    else:
        # O CHECK do banco exige NULL fora da escala personalizada. Zerar aqui
        # evita 400 para quem preencheu a coluna inteira por descuido.
        denominador = None

    geom, erro_geom = geometria_ewkt(feature, presentes)
    if erro_geom:
        return None, erro_geom

    subtipo = sem_null(feature['subtipo_produto_id']) if 'subtipo_produto_id' in presentes else None
    if subtipo is not None:
        linha = dominios.subtipo(subtipo)
        if linha is None:
            return None, f"subtipo_produto_id {subtipo} não existe"
        if linha.get('tipo_id') != tipo_produto_id:
            return None, (f"o subtipo {subtipo} ({linha['nome']}) não pertence ao "
                          f"tipo de produto {tipo_produto_id}")

    return {
        'nome': sem_null(feature[nome_campo]) if nome_campo in presentes else None,
        'mi': sem_null(feature['mi']) if 'mi' in presentes else None,
        'inom': sem_null(feature['inom']) if 'inom' in presentes else None,
        'tipo_escala_id': tipo_escala_id,
        'denominador_escala_especial': denominador,
        'tipo_produto_id': tipo_produto_id,
        # A identidade do produto. Ver o cabeçalho deste módulo.
        'subtipo_produto_id': subtipo,
        'descricao': (sem_null(feature[descricao_campo]) if descricao_campo in presentes else None) or '',
        'geom': geom,
    }, None


def agrupar_produtos_versoes(camada, dominios, com_arquivos=False):
    """Lê a camada COMBINADA e devolve (produtos, invalidas, total).

    A camada é PLANA (uma linha por arquivo, ou por versão quando não há
    arquivo), e `produto_grupo_id` / `versao_grupo_id` dizem quais linhas são o
    mesmo produto e a mesma versão.

    A divergência dentro de um grupo é RELATADA, e nunca ignorada: deixar a
    primeira linha definir o produto faria uma escala digitada errada na linha
    2 sumir sem aviso.
    """
    presentes = {f.name() for f in camada.fields()}
    produtos, invalidas = {}, []
    total = 0

    for feature in camada.getFeatures():
        total += 1
        pgid = sem_null(feature['produto_grupo_id'])
        vgid = sem_null(feature['versao_grupo_id'])
        if pgid is None or vgid is None:
            invalidas.append((feature.id(), "produto_grupo_id e versao_grupo_id são obrigatórios"))
            continue

        produto, erro = montar_produto(feature, presentes, dominios,
                                       nome_campo='produto_nome',
                                       descricao_campo='descricao_produto')
        if erro:
            invalidas.append((feature.id(), erro))
            continue

        versao, erro = montar_versao(feature, presentes)
        if erro:
            invalidas.append((feature.id(), erro))
            continue

        if pgid not in produtos:
            produtos[pgid] = {'produto': produto, 'versoes': {}, 'linha': feature.id()}
        else:
            divergentes = [c for c, v in produto.items()
                           if c != 'geom' and produtos[pgid]['produto'].get(c) != v]
            if divergentes:
                invalidas.append((
                    feature.id(),
                    f"produto_grupo_id {pgid} já foi definido na feição "
                    f"{produtos[pgid]['linha']} com outro valor em: {', '.join(divergentes)}"
                ))
                continue

        chave_versao = (pgid, vgid)
        if chave_versao not in produtos[pgid]['versoes']:
            produtos[pgid]['versoes'][chave_versao] = {**versao, 'arquivos': []}

        if com_arquivos:
            arquivo, erro = montar_arquivo(feature, presentes, descricao_campo='descricao_arquivo')
            if erro:
                invalidas.append((feature.id(), erro))
                continue
            produtos[pgid]['versoes'][chave_versao]['arquivos'].append((arquivo, feature))

    saida = []
    for pgid, dados in produtos.items():
        versoes = list(dados['versoes'].values())
        if com_arquivos:
            versoes = [v for v in versoes if v['arquivos']]
        else:
            # Sem arquivo, a chave `arquivos` não existe no contrato da versão
            # histórica: mandá-la vazia faria o servidor responder 200 avisando
            # que descartou um campo, o que parece defeito e não é.
            versoes = [{k: v for k, v in versao.items() if k != 'arquivos'}
                       for versao in versoes]
        if not versoes:
            continue
        saida.append({**dados['produto'], 'versoes': versoes})

    return saida, invalidas, total


def montar_arquivo(feature, presentes, descricao_campo='descricao'):
    """Dicionário do arquivo, MENOS o que é medido na hora de enviar
    (uuid, checksum e tamanho). Devolve (arquivo, erro).

    `descricao_campo` porque nas camadas em que arquivo e versão convivem ele se
    chama `descricao_arquivo`.
    """
    from ..core.dominios import eh_tileserver

    tipo = sem_null(feature['tipo_arquivo_id'])
    extensao = sem_null(feature['extensao']) if 'extensao' in presentes else None

    if eh_tileserver(tipo):
        # O CHECK de acervo.arquivo exige extensão, tamanho e checksum NULOS
        # para tileserver, e nome_arquivo tem que ser URL http(s).
        extensao = None
    elif not extensao:
        return None, "extensao é obrigatória fora do tileserver"

    try:
        metadado = metadado_json(sem_null(feature['metadado']) if 'metadado' in presentes else None)
    except ValueError as e:
        return None, str(e)

    return {
        'nome': sem_null(feature['nome']),
        'nome_arquivo': sem_null(feature['nome_arquivo']),
        'tipo_arquivo_id': tipo,
        'extensao': extensao,
        'metadado': metadado,
        'situacao_carregamento_id': sem_null(feature['situacao_carregamento_id']),
        'descricao': (sem_null(feature[descricao_campo]) if descricao_campo in presentes else None) or '',
        'crs_original': (sem_null(feature['crs_original']) if 'crs_original' in presentes else None) or '',
    }, None


def conferir_identidade(produto_subtipo_id, versoes_subtipo_ids, dominios):
    """A regra do gatilho `acervo.validate_version`, aplicada ANTES do envio.

    O gatilho recusa quando (a) a versão tem subtipo diferente do produto que já
    tem um, ou (b) o subtipo da versão exige produto próprio (`define_produto`)
    e o produto não tem exatamente esse subtipo. Hoje o segundo caso é o 24,
    Carta Topográfica Militar.

    Perguntar aqui é a diferença entre uma frase que diz o que fazer e um 500
    genérico depois de horas de cópia. Devolve a mensagem, ou None se está bom.
    """
    for subtipo_versao in versoes_subtipo_ids:
        if subtipo_versao is None:
            continue

        if produto_subtipo_id is not None and subtipo_versao != produto_subtipo_id:
            return (f"A versão é do subtipo {dominios.nome_subtipo(subtipo_versao)} e o produto "
                    f"é do subtipo {dominios.nome_subtipo(produto_subtipo_id)}. "
                    "Os dois têm que ser o mesmo.")

        if dominios.exige_produto_proprio(subtipo_versao) and produto_subtipo_id != subtipo_versao:
            nome = dominios.nome_subtipo(subtipo_versao)
            return (f"O subtipo '{nome}' exige PRODUTO PRÓPRIO: o subtipo do produto "
                    f"precisa ser '{nome}' também.\n\n"
                    "Preencha o subtipo do produto (e não só o da versão) antes de enviar. "
                    "Sem isso o servidor recusa a gravação depois de os arquivos já terem "
                    "sido copiados para o volume.")

    return None
