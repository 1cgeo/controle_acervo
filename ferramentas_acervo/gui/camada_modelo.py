# Path: gui\camada_modelo.py
"""A camada-modelo das operações em lote, declarada em vez de escrita à mão.

Sete diálogos criavam a sua camada de memória com uma URI montada por
concatenação de string e explicavam os campos numa `QMessageBox` escrita à mão.
Duas listas para a mesma coisa, e elas JÁ tinham divergido: o texto de
"Carregar Arquivos" mandava preencher sete campos e a URI declarava dez, sem
dizer que `metadado` e `crs_original` existiam.

Aqui a lista de campos é UMA. A URI, a validação da camada escolhida e o texto
de ajuda saem todos dela, então acrescentar um campo não tem como esquecer de
avisar quem vai preenchê-lo.
"""
from qgis.core import Qgis, QgsProject, QgsVectorLayer, QgsWkbTypes, NULL
from qgis.PyQt.QtWidgets import QMessageBox


def sem_null(valor):
    """NULL do QGIS vira None. O NULL do Qt não é falsy nem é None, então
    `feature['x'] or ''` devolvia o próprio NULL e ele viajava até o JSON."""
    return None if valor == NULL else valor


class Campo:
    """Um campo da camada-modelo.

    `obrigatorio` participa de duas coisas: a validação recusa a feição que o
    deixar nulo, e a ajuda o marca. `ajuda` é o que a pessoa lê para saber o que
    escrever ali.
    """

    def __init__(self, nome, tipo='string', obrigatorio=False, ajuda=''):
        self.nome = nome
        self.tipo = tipo
        self.obrigatorio = obrigatorio
        self.ajuda = ajuda


class CamadaModelo:
    """Descreve a camada que uma operação em lote espera."""

    def __init__(self, titulo, campos, com_geometria=False, observacao=''):
        self.titulo = titulo
        self.campos = campos
        self.com_geometria = com_geometria
        self.observacao = observacao

    # --- criação ------------------------------------------------------------

    def uri(self):
        base = 'Polygon?crs=EPSG:4674' if self.com_geometria else 'NoGeometry?crs=EPSG:4674'
        return base + ''.join(f'&field={c.nome}:{c.tipo}' for c in self.campos)

    def criar(self, dialogo, combo=None, iface=None):
        """Cria a camada no projeto e a seleciona no combo do diálogo."""
        camada = QgsVectorLayer(self.uri(), self.titulo, 'memory')
        if not camada.isValid():
            QMessageBox.critical(dialogo, "Erro", "Não foi possível criar a camada modelo.")
            return None

        QgsProject.instance().addMapLayer(camada)

        if combo is not None:
            combo.addItem(camada.name(), camada)
            combo.setCurrentIndex(combo.count() - 1)
            combo.setEnabled(True)

        if iface is not None:
            iface.messageBar().pushMessage(
                "Camada modelo criada",
                f"'{self.titulo}' foi adicionada ao projeto. Preencha as feições e volte aqui.",
                level=Qgis.MessageLevel.Success
            )

        QMessageBox.information(dialogo, "Camada modelo criada", self.ajuda())
        return camada

    # --- ajuda --------------------------------------------------------------

    def ajuda(self):
        """Texto derivado dos campos, e por isso impossível de desatualizar."""
        obrigatorios = [c for c in self.campos if c.obrigatorio]
        opcionais = [c for c in self.campos if not c.obrigatorio]

        linhas = [
            f"A camada '{self.titulo}' foi criada no projeto.",
            "",
            "Para usá-la: abra a tabela de atributos, ative a edição, "
            "adicione as feições e volte a este diálogo.",
            "",
            "CAMPOS OBRIGATÓRIOS",
        ]
        linhas += [f"  {c.nome}: {c.ajuda}" for c in obrigatorios]

        if opcionais:
            linhas += ["", "CAMPOS OPCIONAIS"]
            linhas += [f"  {c.nome}: {c.ajuda}" for c in opcionais]

        if self.com_geometria:
            linhas += ["", "A geometria do polígono é obrigatória em toda feição."]

        if self.observacao:
            linhas += ["", self.observacao]

        return "\n".join(linhas)

    # --- validação ----------------------------------------------------------

    def validar_camada(self, camada):
        """Confere se a camada escolhida serve.

        Devolve (ok, mensagem). Só cobra os campos OBRIGATÓRIOS: a pessoa pode
        ter montado a camada por conta própria, e exigir os opcionais recusaria
        uma camada que funcionaria.

        Quando a operação precisa de geometria, a camada pode trazê-la de dois
        jeitos (polígono de verdade, ou campo `geom` em texto), então basta UM
        dos dois. Ver `geometria_ewkt`.
        """
        if camada is None:
            return False, "Selecione uma camada."

        presentes = {f.name() for f in camada.fields()}
        tem_geom = camada.geometryType() != QgsWkbTypes.NullGeometry

        if self.com_geometria and not tem_geom and 'geom' not in presentes:
            return False, ("Esta operação precisa da geometria do produto: use uma camada de "
                           "polígonos ou uma camada com o campo de texto 'geom'.")
        if not self.com_geometria and tem_geom:
            return False, "Esta operação exige uma camada sem geometria (tabular)."

        faltando = [c.nome for c in self.campos
                    if c.obrigatorio and c.nome != 'geom' and c.nome not in presentes]
        if faltando:
            return False, "Campos obrigatórios ausentes na camada: " + ", ".join(faltando)

        return True, ""

    def campos_nulos(self, feature, presentes):
        """Nomes dos campos obrigatórios que esta feição deixou em branco."""
        return [c.nome for c in self.campos
                if c.obrigatorio and (c.nome not in presentes or sem_null(feature[c.nome]) in (None, ''))]

    def ler(self, feature, presentes, nome):
        """Valor do campo, ou None quando a camada nem tem a coluna."""
        if nome not in presentes:
            return None
        return sem_null(feature[nome])


SRID_ACERVO = 4674  # SIRGAS 2000, o CRS de acervo.produto.geom


def geometria_ewkt(feature, presentes):
    """EWKT do polígono da feição, ou (None, motivo).

    DUAS ORIGENS, e a ordem importa. Primeiro a geometria DE VERDADE da feição:
    é o que permite digitalizar a folha no QGIS, que é o programa em que este
    plugin roda.

    O segundo caminho é o campo de texto `geom`, com WKT colado à mão. Ele
    continua valendo porque as camadas que a equipe já montou têm esse campo, e
    recusá-las quebraria o trabalho pronto.
    """
    if feature.hasGeometry() and not feature.geometry().isEmpty():
        wkt = feature.geometry().asWkt()
        if wkt:
            return f"SRID={SRID_ACERVO};{wkt}", None

    texto = sem_null(feature['geom']) if 'geom' in presentes else None
    if not texto:
        return None, "sem geometria: desenhe o polígono ou preencha o campo 'geom' com WKT"

    texto = str(texto).strip()
    if texto.startswith('SRID='):
        return texto, None
    if texto.upper().startswith(('POLYGON', 'MULTIPOLYGON')):
        return f"SRID={SRID_ACERVO};{texto}", None

    return None, "o campo 'geom' precisa ser POLYGON ou MULTIPOLYGON em WKT ou EWKT"


def preencher_combo_de_camadas(combo, com_geometria):
    """Popula um combo com as camadas do projeto compatíveis. Devolve quantas.

    Operação com geometria aceita polígono E tabular-com-campo-`geom`, pelo
    mesmo motivo de `validar_camada`.
    """
    combo.clear()
    encontradas = 0
    for camada in QgsProject.instance().mapLayers().values():
        if not isinstance(camada, QgsVectorLayer):
            continue
        tem_geom = camada.geometryType() != QgsWkbTypes.NullGeometry
        if com_geometria:
            serve = tem_geom or 'geom' in {f.name() for f in camada.fields()}
        else:
            serve = not tem_geom
        if not serve:
            continue
        combo.addItem(camada.name(), camada)
        encontradas += 1
    return encontradas


def relatar_feicoes_invalidas(dialogo, invalidas, total):
    """Mostra o que foi recusado, com teto, e diz se vale seguir.

    Devolve True se a operação deve continuar. A lista é limitada a 20 linhas:
    uma camada com 4.000 feições erradas abria uma caixa de diálogo mais alta
    que a tela, sem botão alcançável.
    """
    if not invalidas:
        return True

    amostra = invalidas[:20]
    texto = "\n".join(f"  feição {fid}: {motivo}" for fid, motivo in amostra)
    if len(invalidas) > len(amostra):
        texto += f"\n  ... e mais {len(invalidas) - len(amostra)}."

    validas = total - len(invalidas)
    if validas == 0:
        QMessageBox.warning(
            dialogo, "Nenhuma feição válida",
            f"As {len(invalidas)} feições da camada têm problemas:\n\n{texto}"
        )
        return False

    resposta = QMessageBox.question(
        dialogo, "Feições com problema",
        f"{len(invalidas)} de {total} feições serão IGNORADAS:\n\n{texto}\n\n"
        f"Continuar com as {validas} feições válidas?",
        QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
    )
    return resposta == QMessageBox.StandardButton.Yes
