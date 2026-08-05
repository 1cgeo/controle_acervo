# Path: gui\mapa_utils.py
"""Ponte entre as telas do plugin e o canvas do QGIS.

O cliente web embute um mapa (MapLibre) porque o navegador não tem um. Aqui o
mapa JÁ existe e é o do QGIS, então "ver no mapa" não é desenhar um mapa: é
entregar uma camada. O que estas funções fazem é a tradução dessa diferença, e
elas moram fora dos diálogos porque a busca do acervo e a de ponto de controle
fazem exatamente o mesmo gesto.
"""
import json

from qgis.core import (Qgis, QgsCategorizedSymbolRenderer, QgsCoordinateReferenceSystem,
                       QgsCoordinateTransform, QgsDataSourceUri, QgsGeometry, QgsJsonUtils,
                       QgsPointXY, QgsProject, QgsRendererCategory, QgsSymbol, QgsVectorLayer,
                       QgsWkbTypes)
from qgis.gui import QgsMapToolEmitPoint, QgsRubberBand
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QColor
from qgis.PyQt.QtWidgets import QMessageBox

# SIRGAS 2000: o CRS de acervo.produto.geom e de ponto_controle.ponto.geom.
SRID_ACERVO = 4674


def bbox_do_canvas(iface, dialogo=None):
    """'minLon,minLat,maxLon,maxLat' da área visível, em graus, ou None.

    REPROJETA sempre que preciso. O canvas pode estar em qualquer projeção e as
    rotas esperam coordenadas geográficas. Num projeto em UTM, mandar o extent
    cru enviaria metros, e o servidor recusaria por estar fora do intervalo de
    latitude e longitude, com uma mensagem que não aponta o CRS do projeto.
    """
    canvas = iface.mapCanvas()
    extensao = canvas.extent()
    origem = canvas.mapSettings().destinationCrs()
    destino = QgsCoordinateReferenceSystem('EPSG:4326')

    if origem.isValid() and origem != destino:
        try:
            transformacao = QgsCoordinateTransform(origem, destino, QgsProject.instance())
            extensao = transformacao.transformBoundingBox(extensao)
        except Exception:
            if dialogo is not None:
                QMessageBox.warning(
                    dialogo, "Área do mapa",
                    "Não consegui converter a área visível para coordenadas geográficas. "
                    "A consulta foi feita sem o recorte espacial."
                )
            return None

    if extensao.isEmpty():
        return None

    return (f"{extensao.xMinimum():.6f},{extensao.yMinimum():.6f},"
            f"{extensao.xMaximum():.6f},{extensao.yMaximum():.6f}")


def geometria_de_geojson(geojson):
    """QgsGeometry a partir do GeoJSON que as rotas devolvem.

    O servidor já faz `JSON.parse` do `ST_AsGeoJSON`, então o que chega é
    OBJETO; `geometryFromGeoJson` recebe texto, e por isso ele volta a texto
    aqui.
    """
    if not geojson:
        return None
    try:
        texto = geojson if isinstance(geojson, str) else json.dumps(geojson)
        geom = QgsJsonUtils.geometryFromGeoJson(texto)
        return geom if geom and not geom.isNull() else None
    except Exception:
        return None


def criar_camada(nome, tipo_geometria, campos):
    """Camada de memória em SIRGAS 2000, com os campos declarados.

    `campos` é uma lista de (nome, tipo) em que o tipo é 'int', 'double' ou
    'str'. A URI é montada aqui para os chamadores não repetirem a string de
    provider, que é onde se erra o CRS em silêncio.
    """
    conversao = {'int': 'integer', 'double': 'double', 'str': 'string'}
    uri = f"{tipo_geometria}?crs=EPSG:{SRID_ACERVO}"
    uri += ''.join(f"&field={nome}:{conversao[tipo]}" for nome, tipo in campos)

    camada = QgsVectorLayer(uri, nome, 'memory')
    return camada if camada.isValid() else None


def adicionar_ao_projeto(iface, camada, enquadrar=True):
    """Publica a camada e leva o mapa até ela."""
    QgsProject.instance().addMapLayer(camada)
    if enquadrar and not camada.extent().isEmpty():
        canvas = iface.mapCanvas()
        destino = camada.extent()

        # A extensão da camada está no CRS DELA, e o canvas pode estar noutro.
        # Sem converter, o enquadramento manda a câmera para perto de (0, 0),
        # que num projeto em UTM fica no mar.
        crs_canvas = canvas.mapSettings().destinationCrs()
        if crs_canvas.isValid() and crs_canvas != camada.crs():
            try:
                destino = QgsCoordinateTransform(
                    camada.crs(), crs_canvas, QgsProject.instance()
                ).transformBoundingBox(destino)
            except Exception:
                destino = None

        if destino is not None and not destino.isEmpty():
            # Um ponto isolado tem extensão ZERO, e enquadrar nele daria zoom
            # infinito. O buffer é em unidades do canvas: 0,01 grau (~1 km) num
            # projeto geográfico, 1.000 m num projetado.
            if destino.width() == 0 and destino.height() == 0:
                destino.grow(0.01 if crs_canvas.isGeographic() else 1000.0)
            canvas.setExtent(destino)
        canvas.refresh()


def categorizar(camada, campo, categorias, tipo_simbolo=None):
    """Pinta a camada por um campo de domínio.

    `categorias` é uma lista de (valor, rótulo, cor em hexadecimal). A ordem é a
    da legenda. Valor fora da lista fica com o símbolo padrão, e isso é
    deliberado: domínio novo aparece na tela como "não classificado" em vez de
    sumir da camada.
    """
    itens = []
    for valor, rotulo, cor in categorias:
        simbolo = QgsSymbol.defaultSymbol(camada.geometryType())
        simbolo.setColor(QColor(cor))
        if tipo_simbolo == 'ponto':
            simbolo.setSize(2.6)
        itens.append(QgsRendererCategory(valor, simbolo, rotulo))

    camada.setRenderer(QgsCategorizedSymbolRenderer(campo, itens))
    camada.triggerRepaint()


def carregar_camadas_matview(dialogo, camadas):
    """Publica no projeto as views materializadas devolvidas por `camadas_produto`.

    A conexão vem do próprio servidor, no campo `banco_dados` da resposta. Ela
    NUNCA é escrita aqui: o plugin não conhece host, porta nem senha.

    Devolve (carregadas, falhas), com `falhas` sendo os rótulos que não abriram.
    """
    carregadas, falhas = 0, []
    for camada in camadas:
        banco = camada['banco_dados']
        rotulo = f"{camada['tipo_produto']} - {camada['tipo_escala']}"

        uri = QgsDataSourceUri()
        uri.setConnection(banco['servidor'], str(banco['porta']), banco['nome_db'],
                          banco['login'], banco['senha'])
        uri.setDataSource('acervo', camada['matviewname'], 'geom', "", 'id')
        uri.setSrid(str(SRID_ACERVO))

        vetorial = QgsVectorLayer(uri.uri(), rotulo, "postgres")
        if vetorial.isValid():
            QgsProject.instance().addMapLayer(vetorial)
            carregadas += 1
        else:
            falhas.append(rotulo)

    if falhas:
        QMessageBox.warning(
            dialogo, "Camadas não carregadas",
            f"{len(falhas)} camada(s) não abriram:\n- " + "\n- ".join(falhas)
            + "\n\nConfira se esta máquina alcança o banco do acervo e se as visões "
              "materializadas já foram criadas no servidor."
        )
    return carregadas, falhas


class FerramentaPoligono(QgsMapToolEmitPoint):
    """Desenha um polígono no canvas e o entrega ao diálogo que a criou.

    Clique esquerdo acrescenta vértice; clique direito com três ou mais
    vértices fecha o polígono, chama `dialogo.set_geometry(geometria)` e devolve
    o controle à ferramenta de navegação.
    """

    def __init__(self, iface, dialogo):
        self.iface = iface
        self.canvas = iface.mapCanvas()
        self.dialogo = dialogo
        QgsMapToolEmitPoint.__init__(self, self.canvas)
        self.pontos = []

        self.faixa = QgsRubberBand(self.canvas, QgsWkbTypes.PolygonGeometry)
        self.faixa.setColor(QColor(255, 0, 0, 100))
        self.faixa.setWidth(2)

    def canvasReleaseEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.pontos.append(QgsPointXY(self.toMapCoordinates(event.pos())))
            self.faixa.reset(QgsWkbTypes.PolygonGeometry)
            if len(self.pontos) > 1:
                self.faixa.setToGeometry(QgsGeometry.fromPolygonXY([self.pontos]), None)
            return

        if event.button() == Qt.MouseButton.RightButton:
            if len(self.pontos) < 3:
                self.iface.messageBar().pushMessage(
                    "Polígono incompleto",
                    "Marque pelo menos três pontos antes de fechar o polígono.",
                    level=Qgis.MessageLevel.Warning
                )
                return
            geometria = QgsGeometry.fromPolygonXY([self.pontos])
            self.dialogo.set_geometry(geometria)
            self.limpar()
            self.canvas.unsetMapTool(self)
            # `actionPan()` devolve uma QAction, e não uma QgsMapTool: quem
            # volta ao modo de navegação é o trigger dela.
            self.iface.actionPan().trigger()

    def limpar(self):
        self.pontos = []
        self.faixa.reset(QgsWkbTypes.PolygonGeometry)

    def deactivate(self):
        """Apaga o rascunho quando o QGIS troca de ferramenta."""
        self.limpar()
        super().deactivate()
