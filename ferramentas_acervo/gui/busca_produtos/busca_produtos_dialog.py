# Path: gui\busca_produtos\busca_produtos_dialog.py
import csv
import os

from qgis.core import Qgis, QgsFeature
from qgis.PyQt import uic
from qgis.PyQt.QtCore import Qt, QDateTime
from qgis.PyQt.QtWidgets import (QDialog, QFileDialog, QHeaderView, QMessageBox,
                                 QTableWidget, QTableWidgetItem)

from ..mapa_utils import adicionar_ao_projeto, bbox_do_canvas, criar_camada, geometria_de_geojson
from ..ui_utils import sortable_item, sortable_int_item

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'busca_produtos_dialog.ui'))

class BuscaProdutosDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(BuscaProdutosDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.current_page = 1
        self.page_size = 20
        self.total_pages = 1
        self.total_items = 0

        self.setup_ui()
        self.load_filters()

    def setup_ui(self):
        self.setWindowTitle("Buscar Produtos")

        # Configure the results table
        self.resultsTable.setColumnCount(10)
        self.resultsTable.setHorizontalHeaderLabels([
            'ID', 'Nome', 'MI', 'INOM', 'Escala',
            'Tipo Produto', 'Descrição', 'Data Cadastramento',
            'Data Modificação', 'Nº Versões'
        ])
        self.resultsTable.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.resultsTable.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)

        # Set column widths
        header = self.resultsTable.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)   # ID
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)            # Nome
        header.setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)   # MI
        header.setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)   # INOM
        header.setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)   # Escala
        header.setSectionResizeMode(5, QHeaderView.ResizeMode.ResizeToContents)   # Tipo Produto
        header.setSectionResizeMode(6, QHeaderView.ResizeMode.Stretch)            # Descrição
        header.setSectionResizeMode(7, QHeaderView.ResizeMode.ResizeToContents)   # Data Cadastramento
        header.setSectionResizeMode(8, QHeaderView.ResizeMode.ResizeToContents)   # Data Modificação
        header.setSectionResizeMode(9, QHeaderView.ResizeMode.ResizeToContents)   # Nº Versões

        # Connect buttons
        self.searchButton.clicked.connect(self.search_produtos)
        self.carregarCamadaButton.clicked.connect(self.carregar_camada)
        # Trocar o tipo de produto refaz a lista de subtipos: subtipo que não
        # pertence ao tipo escolhido deixou de fazer sentido, e mantê-lo daria
        # uma busca que nunca acha nada.
        self.tipoProdutoComboBox.currentIndexChanged.connect(self.load_subtipos)
        # Botão padrão: Enter dispara a busca a partir de qualquer filtro
        self.searchButton.setDefault(True)
        self.firstPageButton.clicked.connect(self.go_to_first_page)
        self.prevPageButton.clicked.connect(self.go_to_prev_page)
        self.nextPageButton.clicked.connect(self.go_to_next_page)
        self.lastPageButton.clicked.connect(self.go_to_last_page)
        self.detailsButton.clicked.connect(self.open_product_details)
        self.exportCSVButton.clicked.connect(self.export_csv)
        self.closeButton.clicked.connect(self.reject)

        # Connect table selection
        self.resultsTable.itemSelectionChanged.connect(self.on_selection_changed)

        # Allow Enter key to trigger search
        self.termoLineEdit.returnPressed.connect(self.search_produtos)

        # Setup page size combobox
        self.pageSizeComboBox.addItems(['10', '20', '50', '100'])
        self.pageSizeComboBox.setCurrentText(str(self.page_size))
        self.pageSizeComboBox.currentTextChanged.connect(self.change_page_size)

    def load_filters(self):
        """Popula os filtros a partir do cache de domínios da sessão."""
        try:
            self.setCursor(Qt.CursorShape.WaitCursor)
            dominios = self.api_client.dominios

            self.tipoProdutoComboBox.clear()
            self.tipoProdutoComboBox.addItem("Todos", None)
            for item in dominios.get('tipo_produto'):
                self.tipoProdutoComboBox.addItem(item['nome'], item['code'])

            self.tipoEscalaComboBox.clear()
            self.tipoEscalaComboBox.addItem("Todas", None)
            for item in dominios.get('tipo_escala'):
                self.tipoEscalaComboBox.addItem(item['nome'], item['code'])

            self.projetoComboBox.clear()
            self.projetoComboBox.addItem("Todos", None)
            for item in dominios.get('projeto'):
                self.projetoComboBox.addItem(item['nome'], item['id'])

            self.loteComboBox.clear()
            self.loteComboBox.addItem("Todos", None)
            for item in dominios.get('lote'):
                self.loteComboBox.addItem(item['nome'], item['id'])

            self.load_subtipos()
            self.load_palavras_chave()

        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao carregar filtros: {e}")
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)

    def load_subtipos(self):
        """Subtipos do tipo escolhido, ou todos quando o tipo é 'Todos'."""
        anterior = self.subtipoComboBox.currentData()
        tipo_produto_id = self.tipoProdutoComboBox.currentData()

        self.subtipoComboBox.clear()
        self.subtipoComboBox.addItem("Todos", None)

        subtipos = (self.api_client.dominios.subtipos_do_tipo(tipo_produto_id)
                    if tipo_produto_id is not None
                    else self.api_client.dominios.get('subtipo_produto'))
        for item in subtipos:
            self.subtipoComboBox.addItem(item['nome'], item['code'])

        indice = self.subtipoComboBox.findData(anterior)
        self.subtipoComboBox.setCurrentIndex(indice if indice >= 0 else 0)

    def load_palavras_chave(self):
        """As etiquetas mais usadas, com a contagem.

        A rota limita a 20 de propósito e o acervo tem mais etiquetas que isso,
        então o campo é editável: quem sabe a etiqueta digita.
        """
        self.palavraChaveComboBox.clear()
        self.palavraChaveComboBox.setEditable(True)
        self.palavraChaveComboBox.addItem("", None)

        resposta = self.api_client.get('acervo/palavras_chave', params={'limit': 50})
        for item in (resposta or {}).get('dados', []) or []:
            palavra = item.get('palavra') or ''
            self.palavraChaveComboBox.addItem(f"{palavra} ({item.get('usos')})", palavra)

        self.palavraChaveComboBox.setCurrentIndex(0)

    def search_produtos(self):
        """Execute product search with current filters."""
        self.current_page = 1
        self.load_results()

    # --- filtros ------------------------------------------------------------

    def montar_filtros(self):
        """Os filtros da tela, no formato da API.

        UM lugar só, porque as duas rotas que os consomem -- a lista paginada e a
        camada de geometrias -- respondem à MESMA pergunta. Montá-los duas vezes
        é o que faria o mapa mostrar um conjunto e a tabela outro.
        """
        params = {}

        termo = self.termoLineEdit.text().strip()
        if termo:
            params['termo'] = termo

        for chave, combo in (('tipo_produto_id', self.tipoProdutoComboBox),
                             ('subtipo_produto_id', self.subtipoComboBox),
                             ('tipo_escala_id', self.tipoEscalaComboBox),
                             ('projeto_id', self.projetoComboBox),
                             ('lote_id', self.loteComboBox)):
            valor = combo.currentData()
            if valor is not None:
                params[chave] = valor

        # O combo é editável: vale o que está escrito, que pode ser uma etiqueta
        # fora das 50 mais usadas.
        palavra = self.palavraChaveComboBox.currentData()
        if not palavra:
            texto = self.palavraChaveComboBox.currentText().strip()
            # Descarta o "(123)" quando a pessoa escolheu da lista e o texto
            # ficou com a contagem junto.
            palavra = texto.rsplit(' (', 1)[0] if texto.endswith(')') and ' (' in texto else texto
        if palavra:
            params['palavra_chave'] = palavra

        if self.bboxCheckBox.isChecked():
            bbox = self.bbox_do_mapa()
            if bbox:
                params['bbox'] = bbox

        return params

    def bbox_do_mapa(self):
        return bbox_do_canvas(self.iface, self)

    # --- camada -------------------------------------------------------------

    def carregar_camada(self):
        """Traz a geometria de TODOS os produtos filtrados como camada no QGIS.

        Não é a página atual: a rota de geometrias existe justamente porque
        paginar o mapa engana -- vinte polígonos numa busca de oitocentos fazem
        parecer que o acervo tem vinte cartas ali.
        """
        self.setCursor(Qt.CursorShape.WaitCursor)
        try:
            resposta = self.api_client.get(
                'acervo/busca/geometrias', params=self.montar_filtros(), timeout=180
            )
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)

        if not resposta or 'dados' not in resposta:
            return

        dados = resposta['dados']
        produtos = dados.get('dados') or []
        if not produtos:
            QMessageBox.information(
                self, "Nada a mostrar",
                "Nenhum produto atende aos filtros informados."
            )
            return

        camada = criar_camada("Busca no acervo", "Polygon",
                              [('id', 'int'), ('nome', 'str'),
                               ('mi', 'str'), ('escala', 'str')])
        if camada is None:
            QMessageBox.critical(self, "Erro", "Não foi possível criar a camada.")
            return
        provedor = camada.dataProvider()

        feicoes = []
        sem_geometria = 0
        for produto in produtos:
            geom = self._geometria(produto.get('geom'))
            if geom is None or geom.isEmpty():
                sem_geometria += 1
                continue
            feicao = QgsFeature(camada.fields())
            feicao.setGeometry(geom)
            feicao.setAttributes([produto.get('id'), produto.get('nome') or '',
                                  produto.get('mi') or '', produto.get('escala') or ''])
            feicoes.append(feicao)

        provedor.addFeatures(feicoes)
        camada.updateExtents()
        adicionar_ao_projeto(self.iface, camada)

        recado = f"{len(feicoes)} produto(s) carregados na camada 'Busca no acervo'."
        if dados.get('truncado'):
            # O servidor avisa quando cortou em vez de mentir por omissão, e o
            # aviso tem que chegar a quem está olhando o mapa.
            recado += (f"\n\nA busca tem {dados.get('total')} produtos e o servidor "
                       "truncou o resultado. Refine os filtros para ver o conjunto inteiro.")
        if sem_geometria:
            recado += f"\n\n{sem_geometria} produto(s) sem geometria utilizável ficaram de fora."

        self.iface.messageBar().pushMessage(
            "Busca no acervo", recado.split('\n')[0], level=Qgis.MessageLevel.Success
        )
        if dados.get('truncado') or sem_geometria:
            QMessageBox.warning(self, "Camada carregada", recado)

    @staticmethod
    def _geometria(geojson):
        return geometria_de_geojson(geojson)

    def load_results(self):
        """Load search results from the API with pagination."""
        try:
            self.setCursor(Qt.CursorShape.WaitCursor)

            params = dict(self.montar_filtros(),
                          page=self.current_page, limit=self.page_size)

            response = self.api_client.get('acervo/busca', params=params)

            if response and 'dados' in response:
                dados = response['dados']
                # This endpoint returns {total, page, limit, dados: [...]}
                total = int(dados.get('total', 0))
                page = int(dados.get('page', 1))
                limit = int(dados.get('limit', self.page_size))
                produtos = dados.get('dados', [])

                self.total_items = total
                self.total_pages = max(1, -(-total // limit))  # ceil division
                self.current_page = page

                self.update_pagination_info()
                self.populate_results_table(produtos)
            else:
                QMessageBox.warning(
                    self,
                    "Aviso",
                    "Não foi possível realizar a busca."
                )

        except Exception as e:
            QMessageBox.critical(
                self,
                "Erro",
                f"Erro ao buscar produtos: {str(e)}"
            )
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)

    def update_pagination_info(self):
        """Update pagination controls and info."""
        if self.total_items == 0:
            # Estado vazio explícito: distingue "sem resultados" de "falha ao buscar"
            self.pageInfoLabel.setText("Nenhum produto encontrado para os filtros informados.")
        else:
            self.pageInfoLabel.setText(
                f"Página {self.current_page} de {self.total_pages} (Total: {self.total_items} itens)"
            )

        self.firstPageButton.setEnabled(self.current_page > 1)
        self.prevPageButton.setEnabled(self.current_page > 1)
        self.nextPageButton.setEnabled(self.current_page < self.total_pages)
        self.lastPageButton.setEnabled(self.current_page < self.total_pages)

    def populate_results_table(self, produtos):
        """Populate the table with search results."""
        # Desliga a ordenação durante o preenchimento: com sorting ativo, cada
        # setItem reordena as linhas e embaralha as células de uma mesma linha
        self.resultsTable.setSortingEnabled(False)
        self.resultsTable.setRowCount(len(produtos))

        for row, produto in enumerate(produtos):
            # ID ordena numericamente (EditRole inteiro), não como texto
            id_value = produto.get('id')
            id_item = sortable_int_item(id_value)
            id_item.setData(Qt.ItemDataRole.UserRole, id_value)
            self.resultsTable.setItem(row, 0, id_item)

            # `or ''` cobre colunas nuláveis que chegam como None do servidor
            self.resultsTable.setItem(row, 1, QTableWidgetItem(produto.get('nome') or ''))
            self.resultsTable.setItem(row, 2, QTableWidgetItem(produto.get('mi') or ''))
            self.resultsTable.setItem(row, 3, QTableWidgetItem(produto.get('inom') or ''))
            self.resultsTable.setItem(row, 4, QTableWidgetItem(produto.get('escala') or ''))
            self.resultsTable.setItem(row, 5, QTableWidgetItem(produto.get('tipo_produto') or ''))
            self.resultsTable.setItem(row, 6, QTableWidgetItem(produto.get('descricao') or ''))

            # Datas: exibe dd/MM/yyyy mas ordena pela chave ISO (cronológica)
            for col, field in [(7, 'data_cadastramento'), (8, 'data_modificacao')]:
                date = produto.get(field, '')
                if date:
                    date_dt = QDateTime.fromString(date, Qt.DateFormat.ISODate)
                    date_formatted = date_dt.toString('dd/MM/yyyy HH:mm:ss')
                    self.resultsTable.setItem(row, col, sortable_item(date_formatted, date))
                else:
                    self.resultsTable.setItem(row, col, sortable_item("", ""))

            num_versoes = produto.get('num_versoes', 0)
            self.resultsTable.setItem(row, 9, sortable_item(str(num_versoes), int(num_versoes or 0)))

        self.resultsTable.setSortingEnabled(True)
        self.detailsButton.setEnabled(False)

    def on_selection_changed(self):
        """Enable/disable details button based on selection."""
        selected_rows = self.resultsTable.selectionModel().selectedRows()
        self.detailsButton.setEnabled(len(selected_rows) == 1)

    def open_product_details(self):
        """Open ProductInfoDialog for the selected product."""
        selected_rows = self.resultsTable.selectionModel().selectedRows()
        if not selected_rows:
            return

        row = selected_rows[0].row()
        product_id = self.resultsTable.item(row, 0).data(Qt.ItemDataRole.UserRole)

        if product_id is not None:
            from ..informacao_produto.product_info_dialog import ProductInfoDialog
            # Não-modal: permite continuar usando o QGIS e a busca com a janela aberta.
            # O parent (este diálogo) mantém a referência e fecha os detalhes junto com a busca
            dialog = ProductInfoDialog(self.iface, self.api_client, parent=self, product_id=product_id)
            dialog.setAttribute(Qt.WidgetAttribute.WA_DeleteOnClose)
            dialog.show()
            dialog.raise_()
            dialog.activateWindow()

    def go_to_first_page(self):
        if self.current_page > 1:
            self.current_page = 1
            self.load_results()

    def go_to_prev_page(self):
        if self.current_page > 1:
            self.current_page -= 1
            self.load_results()

    def go_to_next_page(self):
        if self.current_page < self.total_pages:
            self.current_page += 1
            self.load_results()

    def go_to_last_page(self):
        if self.current_page < self.total_pages:
            self.current_page = self.total_pages
            self.load_results()

    def change_page_size(self, new_size):
        try:
            new_size_int = int(new_size)
            if new_size_int != self.page_size:
                self.page_size = new_size_int
                self.current_page = 1
                self.load_results()
        except ValueError:
            pass

    def export_csv(self):
        """Export the table data to a CSV file."""
        if self.resultsTable.rowCount() == 0:
            QMessageBox.warning(self, "Aviso", "Não há dados para exportar.")
            return

        filename, _ = QFileDialog.getSaveFileName(
            self, "Exportar para CSV", "", "Arquivos CSV (*.csv)"
        )

        if not filename:
            return

        try:
            with open(filename, 'w', newline='', encoding='utf-8') as file:
                writer = csv.writer(file)

                headers = []
                for column in range(self.resultsTable.columnCount()):
                    headers.append(self.resultsTable.horizontalHeaderItem(column).text())
                writer.writerow(headers)

                for row in range(self.resultsTable.rowCount()):
                    row_data = []
                    for column in range(self.resultsTable.columnCount()):
                        item = self.resultsTable.item(row, column)
                        row_data.append(item.text() if item else "")
                    writer.writerow(row_data)

            QMessageBox.information(
                self, "Sucesso", f"Dados exportados com sucesso para {filename}"
            )

        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao exportar dados: {str(e)}")
