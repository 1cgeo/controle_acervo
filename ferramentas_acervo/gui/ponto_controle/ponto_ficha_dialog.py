# Path: gui\ponto_controle\ponto_ficha_dialog.py
"""Ficha do ponto de controle.

Segue a MESMA hierarquia da ficha web (`ponto-dialog.js`). A ordem é a resposta
a uma pilha de 56 linhas rótulo-valor com o mesmo peso, em que a latitude de
oito casas sai igual ao "Fuso":

  1. O que IDENTIFICA o ponto (coordenada, altitude, método, data) vem no topo.
  2. Os ARQUIVOS vêm logo depois, porque são o que a pessoa veio buscar.
  3. Os blocos de detalhe descem, que é onde se confere, não onde se olha.

Duas coisas que a versão QGIS faz e a web não:

  - **Levar o mapa até o ponto.** Onde a web desenha um mapinha, aqui o mapa já
    existe: o botão voa o canvas até a coordenada.
  - **Copiar a coordenada** CRUA, com todas as casas e ponto decimal. Quem cola
    isto cola noutro programa, e vírgula decimal ou casa perdida viram erro de
    posição de metros.
"""
import os

from qgis.core import (Qgis, QgsCoordinateReferenceSystem, QgsCoordinateTransform,
                       QgsPointXY, QgsProject, QgsRectangle)
from qgis.PyQt import uic
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtWidgets import (QApplication, QDialog, QFileDialog, QHeaderView,
                                 QMessageBox, QTableWidgetItem, QTreeWidgetItem)

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'ponto_ficha_dialog.ui'))

# O código 9999 dos domínios do plugin significa "A SER PREENCHIDO", e não um
# valor: ele é o NULO daquele modelo. Mostrá-lo resolvido encheria a ficha de
# linhas dizendo que não se sabe.
NAO_PREENCHIDO = 9999

TIPO_POR_CODIGO = {1: 'pacote', 2: 'monografia'}


def _vazio(valor):
    return (valor is None or valor == ''
            or (isinstance(valor, str) and valor.strip().upper() == 'A SER PREENCHIDO'))


def _numero(valor, casas=3, sufixo=''):
    """Número com casas decimais FIXAS, em pt-BR.

    As casas são fixas de propósito: numa ficha de ponto de controle a casa
    decimal É o dado. -30,123° e -30,12345678° são lugares a 400 m um do outro.
    """
    if _vazio(valor):
        return None
    try:
        texto = f"{float(valor):.{casas}f}".replace('.', ',')
    except (TypeError, ValueError):
        return None
    return f"{texto}{sufixo}"


def _sim_nao(valor):
    if valor is True:
        return 'Sim'
    if valor is False:
        return 'Não'
    return None


def _data(valor):
    if _vazio(valor):
        return None
    texto = str(valor)[:10]
    partes = texto.split('-')
    return f"{partes[2]}/{partes[1]}/{partes[0]}" if len(partes) == 3 else texto


def _data_hora(valor):
    if _vazio(valor):
        return None
    texto = str(valor)
    dia = _data(texto)
    hora = texto[11:16] if len(texto) >= 16 else ''
    return f"{dia} {hora}".strip()


def _dominio(ponto, chave):
    """Valor de um campo de domínio, já resolvido pelo servidor.

    O servidor devolve o código em `<dominio>` e o nome em `<dominio>_nome`. A
    ficha mostra o NOME, e nunca o código cru, senão "9999" aparece na tela.
    """
    if ponto.get(chave) == NAO_PREENCHIDO:
        return None
    valor = ponto.get(f'{chave}_nome')
    return None if _vazio(valor) else valor


def _coordenada(ponto, eixo):
    """A coordenada que VALE: a da geometria.

    A tabela tem colunas `latitude`/`longitude` em REAL, vindas do plugin, e o
    servidor devolve as derivadas da geometria com nome próprio (`geom_*`). As
    da geometria são double precision; REAL tem uns 7 dígitos significativos, e
    na sétima casa decimal isso já é 1 cm. As colunas do plugin ficam de reserva
    para o ponto antigo, sem geometria.
    """
    for chave in (f'geom_{eixo}', eixo):
        valor = ponto.get(chave)
        if valor is not None:
            try:
                return float(valor)
            except (TypeError, ValueError):
                continue
    return None


class PontoFichaDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, cod_ponto, parent=None):
        super(PontoFichaDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.cod_ponto = cod_ponto
        self.ponto = None

        self.setup_ui()
        self.carregar()

    def setup_ui(self):
        self.setWindowTitle(f"Ponto de controle {self.cod_ponto}")

        self.detalheTree.setColumnCount(2)
        self.detalheTree.setHeaderLabels(['Campo', 'Valor'])
        self.detalheTree.header().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)

        self.arquivosTable.setColumnCount(4)
        self.arquivosTable.setHorizontalHeaderLabels(
            ['Tipo', 'Arquivo', 'Tamanho (MB)', 'Cadastrado em'])
        self.arquivosTable.setEditTriggers(self.arquivosTable.EditTrigger.NoEditTriggers)
        self.arquivosTable.setSelectionBehavior(self.arquivosTable.SelectionBehavior.SelectRows)
        self.arquivosTable.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch)

        self.vaziosCheckBox.toggled.connect(self.preencher_detalhe)
        self.copiarButton.clicked.connect(self.copiar_coordenada)
        self.irAoPontoButton.clicked.connect(self.ir_ao_ponto)
        self.baixarButton.clicked.connect(self.baixar_selecionado)
        self.fecharButton.clicked.connect(self.reject)

        self.arquivosTable.itemSelectionChanged.connect(
            lambda: self.baixarButton.setEnabled(
                len(self.arquivosTable.selectionModel().selectedRows()) == 1)
        )
        self.baixarButton.setEnabled(False)

    # --- dados --------------------------------------------------------------

    def carregar(self):
        self.setCursor(Qt.CursorShape.WaitCursor)
        try:
            resposta = self.api_client.get(f'ponto_controle/{self.cod_ponto}')
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)

        if not resposta or 'dados' not in resposta:
            self.resumoLabel.setText("Não foi possível carregar o ponto.")
            return

        self.ponto = resposta['dados']
        self.preencher_resumo()
        self.preencher_arquivos()
        self.preencher_detalhe()

    def preencher_resumo(self):
        p = self.ponto
        lat, lon = _coordenada(p, 'latitude'), _coordenada(p, 'longitude')

        partes = [f"<b>{p.get('cod_ponto')}</b>"]
        situacao = _dominio(p, 'tipo_situacao')
        if situacao:
            partes.append(f"Situação: {situacao}")
        if p.get('projeto_nome'):
            partes.append(f"Projeto: {p['projeto_nome']}")
        if p.get('lote_nome'):
            partes.append(f"Lote: {p['lote_nome']}")

        fatos = [
            ('Latitude', _numero(lat, 8, '°')),
            ('Longitude', _numero(lon, 8, '°')),
            ('Alt. ortométrica', _numero(p.get('altitude_ortometrica'), 3, ' m')),
            ('Método', _dominio(p, 'metodo_posicionamento')),
            ('Rastreio', _data(p.get('data_rastreio'))),
        ]
        linha_fatos = "&nbsp;&nbsp;|&nbsp;&nbsp;".join(
            f"{rotulo}: <b>{valor}</b>" for rotulo, valor in fatos if valor
        )

        self.resumoLabel.setText(
            "<br>".join(partes) + ("<br><br>" + linha_fatos if linha_fatos else "")
        )

        tem_coordenada = lat is not None and lon is not None
        self.copiarButton.setEnabled(tem_coordenada)
        self.irAoPontoButton.setEnabled(tem_coordenada)

    def preencher_arquivos(self):
        """Os dois arquivos, com a MONOGRAFIA primeiro.

        Inverte a ordem do banco de propósito, como a web: é a monografia que se
        abre para conferir o ponto, e o pacote de 20 MB é o que se baixa quando
        já se decidiu.
        """
        arquivos = sorted(self.ponto.get('arquivos') or [],
                          key=lambda a: 0 if a.get('tipo_arquivo_id') == 2 else 1)

        self.arquivosTable.setRowCount(len(arquivos))
        for linha, arquivo in enumerate(arquivos):
            nome = arquivo.get('nome_arquivo') or ''
            if arquivo.get('extensao'):
                nome = f"{nome}.{arquivo['extensao']}"

            item_tipo = QTableWidgetItem(arquivo.get('tipo_arquivo') or '')
            item_tipo.setData(Qt.ItemDataRole.UserRole, arquivo)
            self.arquivosTable.setItem(linha, 0, item_tipo)
            self.arquivosTable.setItem(linha, 1, QTableWidgetItem(nome))
            self.arquivosTable.setItem(
                linha, 2, QTableWidgetItem(_numero(arquivo.get('tamanho_mb'), 2) or ''))
            self.arquivosTable.setItem(
                linha, 3, QTableWidgetItem(_data_hora(arquivo.get('data_cadastramento')) or ''))

        self.arquivosTable.resizeColumnsToContents()
        if not arquivos:
            self.arquivosLabel.setText("Este ponto não tem arquivo registrado.")
        else:
            self.arquivosLabel.setText(
                "Selecione um arquivo e clique em Baixar. O caminho no volume não "
                "aparece aqui: é infraestrutura, e o servidor nem o envia."
            )

    def blocos(self):
        """Os blocos de detalhe, na mesma ordem e com os mesmos rótulos da web."""
        p = self.ponto
        return [
            ('Identificação', [
                ('Projeto', p.get('projeto_nome')),
                ('Lote (missão)', p.get('lote_nome')),
                ('PIT', p.get('pit')),
                ('Tipo de referência', _dominio(p, 'tipo_ref')),
                ('Classificação do ponto', _dominio(p, 'classificacao_ponto')),
                ('Ponto de referência geodésico/topográfico',
                 _dominio(p, 'tipo_pto_ref_geod_topo')),
                ('Rede de referência', _dominio(p, 'rede_referencia')),
                ('Órgão executante', p.get('orgao_executante')),
                ('Reserva', _sim_nao(p.get('reserva'))),
                ('Projeto informado em campo', p.get('projeto')),
                ('Lote informado em campo', p.get('lote')),
            ]),
            ('Posição', [
                ('Latitude', _numero(_coordenada(p, 'latitude'), 8, '°')),
                ('Longitude', _numero(_coordenada(p, 'longitude'), 8, '°')),
                ('Norte', _numero(p.get('norte'), 3, ' m')),
                ('Leste', _numero(p.get('leste'), 3, ' m')),
                ('Fuso', p.get('fuso')),
                ('Meridiano central', p.get('meridiano_central')),
                ('Altitude ortométrica', _numero(p.get('altitude_ortometrica'), 3, ' m')),
                ('Altitude geométrica', _numero(p.get('altitude_geometrica'), 3, ' m')),
                ('Sistema geodésico', _dominio(p, 'sistema_geodesico')),
                ('Outra referência planimétrica', p.get('outra_ref_plan')),
                ('Referencial altimétrico', _dominio(p, 'referencial_altim')),
                ('Outra referência altimétrica', p.get('outro_ref_alt')),
                ('Referencial gravimétrico', _dominio(p, 'referencial_grav')),
                ('Latitude planejada', _numero(p.get('latitude_planejada'), 8, '°')),
                ('Longitude planejada', _numero(p.get('longitude_planejada'), 8, '°')),
                ('Geometria aproximada', _sim_nao(p.get('geometria_aproximada'))),
            ]),
            ('Rastreio', [
                ('Data', _data(p.get('data_rastreio'))),
                ('Início', _data_hora(p.get('inicio_rastreio'))),
                ('Fim', _data_hora(p.get('fim_rastreio'))),
                ('Medidor', p.get('medidor')),
                ('Método de posicionamento', _dominio(p, 'metodo_posicionamento')),
                ('Ponto base', p.get('ponto_base')),
                ('Taxa de gravação', _numero(p.get('taxa_gravacao'), 0, ' s')),
                ('Máscara de elevação', _numero(p.get('mascara_elevacao'), 0, '°')),
            ]),
            ('Equipamento', [
                ('Modelo do GPS', p.get('modelo_gps')),
                ('Nº de série do GPS', p.get('numero_serie_gps')),
                ('Modelo da antena', p.get('modelo_antena')),
                ('Nº de série da antena', p.get('numero_serie_antena')),
                ('Altura da antena', _numero(p.get('altura_antena'), 3, ' m')),
                ('Tipo de medição da altura', _dominio(p, 'tipo_medicao_altura')),
                ('Referência da medição da altura',
                 _dominio(p, 'referencia_medicao_altura')),
                ('Altura do objeto', _numero(p.get('altura_objeto'), 3, ' m')),
            ]),
            ('Processamento', [
                ('Data', _data(p.get('data_processamento'))),
                ('Órbita', _dominio(p, 'orbita')),
                ('Frequência processada', p.get('freq_processada')),
                ('Modelo geoidal', p.get('modelo_geoidal')),
                ('Precisão horizontal esperada',
                 _numero(p.get('precisao_horizontal_esperada'), 3, ' m')),
                ('Precisão vertical esperada',
                 _numero(p.get('precisao_vertical_esperada'), 3, ' m')),
                ('Engenheiro responsável', p.get('engenheiro_responsavel')),
                ('CREA', p.get('crea_engenheiro_responsavel')),
            ]),
            ('Marco no terreno', [
                ('Materializado', _sim_nao(p.get('materializado'))),
                ('Situação do marco', _dominio(p, 'situacao_marco')),
                ('Tipo de marco limite', _dominio(p, 'tipo_marco_limite')),
                ('Data da visita', _data(p.get('data_visita'))),
                ('Valor da gravidade', _numero(p.get('valor_gravidade'), 3)),
            ]),
            ('Observação', [('Observação', p.get('observacao'))]),
            ('Registro no acervo', [
                ('Cadastrado em', _data_hora(p.get('data_cadastramento'))),
                ('Última modificação', _data_hora(p.get('data_modificacao'))),
            ]),
        ]

    def preencher_detalhe(self):
        """Monta a árvore de blocos.

        Por padrão o campo vazio NÃO aparece: a medição preenche um subconjunto
        que muda por método (um ponto de PPP não tem os campos de RTK, e
        vice-versa), e mostrar tudo encheria a ficha de traços. O interruptor
        revela os vazios para quem está conferindo o que FALTA preencher.
        """
        if not self.ponto:
            return

        mostrar_vazios = self.vaziosCheckBox.isChecked()
        self.detalheTree.clear()

        for titulo, campos in self.blocos():
            visiveis = [(r, v) for r, v in campos if mostrar_vazios or not _vazio(v)]
            if not visiveis:
                continue
            grupo = QTreeWidgetItem([titulo, ''])
            fonte = grupo.font(0)
            fonte.setBold(True)
            grupo.setFont(0, fonte)
            for rotulo, valor in visiveis:
                QTreeWidgetItem(grupo, [rotulo, '-' if _vazio(valor) else str(valor)])
            self.detalheTree.addTopLevelItem(grupo)

        self.detalheTree.expandAll()
        self.detalheTree.resizeColumnToContents(0)

    # --- ações --------------------------------------------------------------

    def copiar_coordenada(self):
        """Copia o par CRU, com todas as casas e ponto decimal."""
        lat = _coordenada(self.ponto, 'latitude')
        lon = _coordenada(self.ponto, 'longitude')
        if lat is None or lon is None:
            return
        QApplication.clipboard().setText(f"{lat}, {lon}")
        self.iface.messageBar().pushMessage(
            "Coordenada copiada", f"{lat}, {lon}", level=Qgis.MessageLevel.Success
        )

    def ir_ao_ponto(self):
        """Voa o canvas até o ponto.

        A coordenada está em geográficas (SIRGAS 2000); o canvas pode estar em
        qualquer projeção, e sem converter a câmera iria para o lugar errado.
        O retângulo tem lado fixo porque ponto não tem extensão para caber.
        """
        lat = _coordenada(self.ponto, 'latitude')
        lon = _coordenada(self.ponto, 'longitude')
        if lat is None or lon is None:
            return

        canvas = self.iface.mapCanvas()
        ponto = QgsPointXY(lon, lat)
        origem = QgsCoordinateReferenceSystem('EPSG:4674')
        destino = canvas.mapSettings().destinationCrs()

        if destino.isValid() and destino != origem:
            try:
                ponto = QgsCoordinateTransform(
                    origem, destino, QgsProject.instance()
                ).transform(ponto)
            except Exception:
                QMessageBox.warning(
                    self, "Ir ao ponto",
                    "Não consegui converter a coordenada para o sistema do projeto."
                )
                return

        # Meia largura em unidades do canvas: 0,01 grau (~1 km) quando o projeto
        # é geográfico, 1.000 m quando é projetado.
        meia = 0.01 if destino.isGeographic() else 1000.0
        canvas.setExtent(QgsRectangle(ponto.x() - meia, ponto.y() - meia,
                                      ponto.x() + meia, ponto.y() + meia))
        canvas.refresh()

    def baixar_selecionado(self):
        linhas = self.arquivosTable.selectionModel().selectedRows()
        if len(linhas) != 1:
            return

        arquivo = self.arquivosTable.item(linhas[0].row(), 0).data(Qt.ItemDataRole.UserRole)
        tipo = TIPO_POR_CODIGO.get(arquivo.get('tipo_arquivo_id'))
        if not tipo:
            QMessageBox.warning(self, "Tipo desconhecido",
                                "Este tipo de arquivo não tem rota de download.")
            return

        pasta = QFileDialog.getExistingDirectory(self, "Pasta de destino")
        if not pasta:
            return

        self.setCursor(Qt.CursorShape.WaitCursor)
        try:
            # Destino é a PASTA: o nome vem do Content-Disposition, com a
            # extensão certa e o acento preservado.
            caminho = self.api_client.download_file(
                f"ponto_controle/{self.cod_ponto}/download/{tipo}", pasta
            )
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)

        if caminho:
            QMessageBox.information(self, "Download concluído",
                                    f"Arquivo salvo em:\n{caminho}")
