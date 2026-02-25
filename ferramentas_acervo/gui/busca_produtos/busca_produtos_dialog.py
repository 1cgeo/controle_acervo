# Path: gui\busca_produtos\busca_produtos_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QTableWidgetItem, QHeaderView, QFileDialog
from qgis.PyQt.QtCore import Qt, QDateTime
import csv

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
        self.resultsTable.setSelectionBehavior(self.resultsTable.SelectRows)
        self.resultsTable.setEditTriggers(self.resultsTable.NoEditTriggers)

        # Set column widths
        header = self.resultsTable.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeToContents)   # ID
        header.setSectionResizeMode(1, QHeaderView.Stretch)            # Nome
        header.setSectionResizeMode(2, QHeaderView.ResizeToContents)   # MI
        header.setSectionResizeMode(3, QHeaderView.ResizeToContents)   # INOM
        header.setSectionResizeMode(4, QHeaderView.ResizeToContents)   # Escala
        header.setSectionResizeMode(5, QHeaderView.ResizeToContents)   # Tipo Produto
        header.setSectionResizeMode(6, QHeaderView.Stretch)            # Descrição
        header.setSectionResizeMode(7, QHeaderView.ResizeToContents)   # Data Cadastramento
        header.setSectionResizeMode(8, QHeaderView.ResizeToContents)   # Data Modificação
        header.setSectionResizeMode(9, QHeaderView.ResizeToContents)   # Nº Versões

        # Connect buttons
        self.searchButton.clicked.connect(self.search_produtos)
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
        """Load filter combo box options from domain endpoints."""
        try:
            self.setCursor(Qt.WaitCursor)

            # Tipo Produto
            self.tipoProdutoComboBox.clear()
            self.tipoProdutoComboBox.addItem("Todos", None)
            response = self.api_client.get('gerencia/dominio/tipo_produto')
            if response and 'dados' in response:
                for item in response['dados']:
                    self.tipoProdutoComboBox.addItem(item['nome'], item['code'])

            # Tipo Escala
            self.tipoEscalaComboBox.clear()
            self.tipoEscalaComboBox.addItem("Todas", None)
            response = self.api_client.get('gerencia/dominio/tipo_escala')
            if response and 'dados' in response:
                for item in response['dados']:
                    self.tipoEscalaComboBox.addItem(item['nome'], item['code'])

            # Projetos
            self.projetoComboBox.clear()
            self.projetoComboBox.addItem("Todos", None)
            response = self.api_client.get('projetos/projeto')
            if response and 'dados' in response:
                for item in response['dados']:
                    self.projetoComboBox.addItem(item['nome'], item['id'])

            # Lotes
            self.loteComboBox.clear()
            self.loteComboBox.addItem("Todos", None)
            response = self.api_client.get('projetos/lote')
            if response and 'dados' in response:
                for item in response['dados']:
                    self.loteComboBox.addItem(item['nome'], item['id'])

        except Exception as e:
            QMessageBox.critical(
                self,
                "Erro",
                f"Erro ao carregar filtros: {str(e)}"
            )
        finally:
            self.setCursor(Qt.ArrowCursor)

    def search_produtos(self):
        """Execute product search with current filters."""
        self.current_page = 1
        self.load_results()

    def load_results(self):
        """Load search results from the API with pagination."""
        try:
            self.setCursor(Qt.WaitCursor)

            # Build query parameters
            params = f'page={self.current_page}&limit={self.page_size}'

            termo = self.termoLineEdit.text().strip()
            if termo:
                params += f'&termo={termo}'

            tipo_produto_id = self.tipoProdutoComboBox.currentData()
            if tipo_produto_id is not None:
                params += f'&tipo_produto_id={tipo_produto_id}'

            tipo_escala_id = self.tipoEscalaComboBox.currentData()
            if tipo_escala_id is not None:
                params += f'&tipo_escala_id={tipo_escala_id}'

            projeto_id = self.projetoComboBox.currentData()
            if projeto_id is not None:
                params += f'&projeto_id={projeto_id}'

            lote_id = self.loteComboBox.currentData()
            if lote_id is not None:
                params += f'&lote_id={lote_id}'

            response = self.api_client.get(f'acervo/busca?{params}')

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
            self.setCursor(Qt.ArrowCursor)

    def update_pagination_info(self):
        """Update pagination controls and info."""
        self.pageInfoLabel.setText(
            f"Página {self.current_page} de {self.total_pages} (Total: {self.total_items} itens)"
        )

        self.firstPageButton.setEnabled(self.current_page > 1)
        self.prevPageButton.setEnabled(self.current_page > 1)
        self.nextPageButton.setEnabled(self.current_page < self.total_pages)
        self.lastPageButton.setEnabled(self.current_page < self.total_pages)

    def populate_results_table(self, produtos):
        """Populate the table with search results."""
        self.resultsTable.setRowCount(len(produtos))

        for row, produto in enumerate(produtos):
            id_item = QTableWidgetItem(str(produto.get('id', '')))
            id_item.setData(Qt.UserRole, produto.get('id'))
            self.resultsTable.setItem(row, 0, id_item)

            self.resultsTable.setItem(row, 1, QTableWidgetItem(produto.get('nome', '')))
            self.resultsTable.setItem(row, 2, QTableWidgetItem(produto.get('mi', '')))
            self.resultsTable.setItem(row, 3, QTableWidgetItem(produto.get('inom', '')))
            self.resultsTable.setItem(row, 4, QTableWidgetItem(produto.get('escala', '')))
            self.resultsTable.setItem(row, 5, QTableWidgetItem(produto.get('tipo_produto', '')))
            self.resultsTable.setItem(row, 6, QTableWidgetItem(produto.get('descricao', '') or ''))

            # Format dates
            for col, field in [(7, 'data_cadastramento'), (8, 'data_modificacao')]:
                date = produto.get(field, '')
                if date:
                    date_dt = QDateTime.fromString(date, Qt.ISODate)
                    date_formatted = date_dt.toString('dd/MM/yyyy HH:mm:ss')
                else:
                    date_formatted = ""
                self.resultsTable.setItem(row, col, QTableWidgetItem(date_formatted))

            num_versoes = produto.get('num_versoes', 0)
            self.resultsTable.setItem(row, 9, QTableWidgetItem(str(num_versoes)))

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
        product_id = self.resultsTable.item(row, 0).data(Qt.UserRole)

        if product_id is not None:
            from ..informacao_produto.product_info_dialog import ProductInfoDialog
            dialog = ProductInfoDialog(self.iface, self.api_client, product_id=product_id)
            dialog.exec_()

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
