# Path: gui\arquivos_deletados\arquivos_deletados_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QTableWidget, QTableWidgetItem, QHeaderView, QFileDialog
from qgis.PyQt.QtCore import Qt, QDateTime
from qgis.core import Qgis
from ..ui_utils import sortable_item, sortable_int_item
import csv

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'arquivos_deletados_dialog.ui'))

class ArquivosDeletedDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(ArquivosDeletedDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.current_page = 1
        self.page_size = 20
        self.total_pages = 1
        self.total_items = 0
        
        self.setup_ui()
        self.load_arquivos_deletados()
        
    def setup_ui(self):
        self.setWindowTitle("Arquivos Deletados")
        
        # Configure the table
        self.filesTable.setColumnCount(14)
        self.filesTable.setHorizontalHeaderLabels([
            'ID', 'Nome', 'Nome do Arquivo', 'Extensão', 
            'Produto', 'MI', 'INOM', 'Lote', 'PIT',
            'Versão', 'Volume', 'Tamanho (MB)', 'Data de Exclusão', 'Motivo de Exclusão'
        ])
        self.filesTable.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.filesTable.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        
        # Set column widths
        header = self.filesTable.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)  # ID
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)           # Nome
        header.setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)           # Nome do Arquivo
        header.setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)  # Extensão
        header.setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)           # Produto
        header.setSectionResizeMode(5, QHeaderView.ResizeMode.ResizeToContents)  # MI
        header.setSectionResizeMode(6, QHeaderView.ResizeMode.ResizeToContents)  # INOM
        header.setSectionResizeMode(7, QHeaderView.ResizeMode.ResizeToContents)  # Lote
        header.setSectionResizeMode(8, QHeaderView.ResizeMode.ResizeToContents)  # PIT
        header.setSectionResizeMode(9, QHeaderView.ResizeMode.ResizeToContents)  # Versão
        header.setSectionResizeMode(10, QHeaderView.ResizeMode.ResizeToContents) # Volume
        header.setSectionResizeMode(11, QHeaderView.ResizeMode.ResizeToContents) # Tamanho
        header.setSectionResizeMode(12, QHeaderView.ResizeMode.ResizeToContents) # Data de Exclusão
        header.setSectionResizeMode(13, QHeaderView.ResizeMode.Stretch)          # Motivo de Exclusão
        
        # Connect buttons
        self.firstPageButton.clicked.connect(self.go_to_first_page)
        self.prevPageButton.clicked.connect(self.go_to_prev_page)
        self.nextPageButton.clicked.connect(self.go_to_next_page)
        self.lastPageButton.clicked.connect(self.go_to_last_page)
        self.refreshButton.clicked.connect(self.refresh_data)
        self.exportCSVButton.clicked.connect(self.export_csv)
        self.closeButton.clicked.connect(self.reject)
        
        # Setup page size combobox
        self.pageSizeComboBox.addItems(['10', '20', '50', '100'])
        self.pageSizeComboBox.setCurrentText(str(self.page_size))
        self.pageSizeComboBox.currentTextChanged.connect(self.change_page_size)
        
    def load_arquivos_deletados(self):
        """Load deleted files from the API with pagination."""
        try:
            self.setCursor(Qt.CursorShape.WaitCursor)
            
            response = self.api_client.get(
                f'gerencia/arquivos_deletados?page={self.current_page}&limit={self.page_size}'
            )
            
            if response and 'dados' in response:
                self.update_pagination_info(response.get('pagination', {}))
                self.populate_files_table(response['dados'])
            else:
                QMessageBox.warning(
                    self,
                    "Aviso",
                    "Não foi possível carregar os arquivos deletados."
                )
                
        except Exception as e:
            QMessageBox.critical(
                self,
                "Erro",
                f"Erro ao carregar arquivos deletados: {str(e)}"
            )
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)
            
    def update_pagination_info(self, pagination):
        """Update pagination controls and info."""
        self.total_items = pagination.get('totalItems', 0)
        self.total_pages = pagination.get('totalPages', 1)
        self.current_page = pagination.get('currentPage', 1)
        
        # Update pagination controls
        if self.total_items == 0:
            self.pageInfoLabel.setText("Nenhum arquivo deletado registrado.")
        else:
            self.pageInfoLabel.setText(f"Página {self.current_page} de {self.total_pages} (Total: {self.total_items} itens)")
        
        # Enable/disable navigation buttons
        self.firstPageButton.setEnabled(self.current_page > 1)
        self.prevPageButton.setEnabled(self.current_page > 1)
        self.nextPageButton.setEnabled(self.current_page < self.total_pages)
        self.lastPageButton.setEnabled(self.current_page < self.total_pages)
    
    def populate_files_table(self, files):
        """Populate the table with deleted files data."""
        # Desliga a ordenação durante o preenchimento: com sorting ativo, popular
        # por índice embaralha as células de uma mesma linha
        self.filesTable.setSortingEnabled(False)
        self.filesTable.setRowCount(len(files))

        for row, file in enumerate(files):
            # `get(chave, '')` não cobre valor None vindo do servidor (colunas
            # nuláveis e LEFT JOINs) — usar `or ''` para não passar None ao Qt
            self.filesTable.setItem(row, 0, sortable_int_item(file.get('id')))
            self.filesTable.setItem(row, 1, QTableWidgetItem(file.get('nome') or ''))
            self.filesTable.setItem(row, 2, QTableWidgetItem(file.get('nome_arquivo') or ''))
            self.filesTable.setItem(row, 3, QTableWidgetItem(file.get('extensao') or ''))
            self.filesTable.setItem(row, 4, QTableWidgetItem(file.get('produto') or ''))
            self.filesTable.setItem(row, 5, QTableWidgetItem(file.get('mi') or ''))
            self.filesTable.setItem(row, 6, QTableWidgetItem(file.get('inom') or ''))
            self.filesTable.setItem(row, 7, QTableWidgetItem(file.get('lote') or ''))
            self.filesTable.setItem(row, 8, QTableWidgetItem(file.get('pit') or ''))

            versao_info = f"{file.get('versao_nome') or ''} ({file.get('versao') or ''})"
            self.filesTable.setItem(row, 9, QTableWidgetItem(versao_info))

            volume_info = f"{file.get('volume_armazenamento_nome') or ''} ({file.get('volume_armazenamento') or ''})"
            self.filesTable.setItem(row, 10, QTableWidgetItem(volume_info))

            tamanho = file.get('tamanho_mb', 0)
            tamanho_formatado = f"{tamanho:.2f}" if tamanho else ""
            self.filesTable.setItem(row, 11, sortable_item(tamanho_formatado, float(tamanho or 0)))

            # Format the date (ordena pela chave ISO, exibe dd/MM/yyyy)
            date = file.get('data_delete') or ''
            if date:
                date_dt = QDateTime.fromString(date, Qt.DateFormat.ISODate)
                date_formatted = date_dt.toString('dd/MM/yyyy HH:mm:ss')
                self.filesTable.setItem(row, 12, sortable_item(date_formatted, date))
            else:
                self.filesTable.setItem(row, 12, sortable_item("Sem data", ""))

            self.filesTable.setItem(row, 13, QTableWidgetItem(file.get('motivo_exclusao') or ''))

        self.filesTable.setSortingEnabled(True)
            
    def go_to_first_page(self):
        """Navigate to the first page."""
        if self.current_page > 1:
            self.current_page = 1
            self.load_arquivos_deletados()
    
    def go_to_prev_page(self):
        """Navigate to the previous page."""
        if self.current_page > 1:
            self.current_page -= 1
            self.load_arquivos_deletados()
    
    def go_to_next_page(self):
        """Navigate to the next page."""
        if self.current_page < self.total_pages:
            self.current_page += 1
            self.load_arquivos_deletados()
    
    def go_to_last_page(self):
        """Navigate to the last page."""
        if self.current_page < self.total_pages:
            self.current_page = self.total_pages
            self.load_arquivos_deletados()
    
    def change_page_size(self, new_size):
        """Change the number of items per page."""
        try:
            new_size_int = int(new_size)
            if new_size_int != self.page_size:
                self.page_size = new_size_int
                self.current_page = 1  # Reset to first page
                self.load_arquivos_deletados()
        except ValueError:
            pass
    
    def refresh_data(self):
        """Refresh the current page data."""
        self.load_arquivos_deletados()
        
    def export_csv(self):
        """Export the table data to a CSV file."""
        if self.filesTable.rowCount() == 0:
            QMessageBox.warning(
                self,
                "Aviso",
                "Não há dados para exportar."
            )
            return
            
        filename, _ = QFileDialog.getSaveFileName(
            self,
            "Exportar para CSV",
            "",
            "Arquivos CSV (*.csv)"
        )
        
        if not filename:
            return
            
        try:
            with open(filename, 'w', newline='', encoding='utf-8') as file:
                writer = csv.writer(file)
                
                # Write header
                headers = []
                for column in range(self.filesTable.columnCount()):
                    headers.append(self.filesTable.horizontalHeaderItem(column).text())
                writer.writerow(headers)
                
                # Write data
                for row in range(self.filesTable.rowCount()):
                    row_data = []
                    for column in range(self.filesTable.columnCount()):
                        item = self.filesTable.item(row, column)
                        row_data.append(item.text() if item else "")
                    writer.writerow(row_data)
                    
            QMessageBox.information(
                self,
                "Sucesso",
                f"Dados exportados com sucesso para {filename}"
            )
            
        except Exception as e:
            QMessageBox.critical(
                self,
                "Erro",
                f"Erro ao exportar dados: {str(e)}"
            )