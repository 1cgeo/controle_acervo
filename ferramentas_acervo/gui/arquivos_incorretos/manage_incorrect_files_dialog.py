# Path: gui\arquivos_incorretos\manage_incorrect_files_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QTableWidgetItem, QHeaderView, QFileDialog
from qgis.PyQt.QtCore import Qt, QDateTime
from qgis.core import Qgis
import csv

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'manage_incorrect_files_dialog.ui'))

class ManageIncorrectFilesDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(ManageIncorrectFilesDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.current_page = 1
        self.page_size = 20
        self.total_pages = 1
        self.total_items = 0
        
        self.setup_ui()
        self.load_incorrect_files()
        
    def setup_ui(self):
        self.setWindowTitle("Gerenciar Arquivos com Problemas")
        
        # Configure the table
        self.filesTable.setColumnCount(8)
        self.filesTable.setHorizontalHeaderLabels([
            'ID', 'Nome', 'Nome do Arquivo', 'Extensão', 
            'Volume', 'Tipo de Problema', 'Data', 'Tipo'
        ])
        self.filesTable.setSelectionBehavior(self.filesTable.SelectRows)
        self.filesTable.setEditTriggers(self.filesTable.NoEditTriggers)
        
        # Set column widths
        header = self.filesTable.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeToContents)  # ID
        header.setSectionResizeMode(1, QHeaderView.Stretch)           # Nome
        header.setSectionResizeMode(2, QHeaderView.Stretch)           # Nome do Arquivo
        header.setSectionResizeMode(3, QHeaderView.ResizeToContents)  # Extensão
        header.setSectionResizeMode(4, QHeaderView.ResizeToContents)  # Volume
        header.setSectionResizeMode(5, QHeaderView.ResizeToContents)  # Tipo de Status
        header.setSectionResizeMode(6, QHeaderView.ResizeToContents)  # Data
        header.setSectionResizeMode(7, QHeaderView.ResizeToContents)  # Tipo
        
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
        
    def load_incorrect_files(self):
        """Load incorrect files from the API with pagination."""
        try:
            self.setCursor(Qt.WaitCursor)
            
            response = self.api_client.get(
                f'gerencia/arquivos_incorretos?page={self.current_page}&limit={self.page_size}'
            )
            
            if response and 'dados' in response:
                self.update_pagination_info(response.get('pagination', {}))
                self.populate_files_table(response['dados'])
            else:
                QMessageBox.warning(
                    self,
                    "Aviso",
                    "Não foi possível carregar os arquivos com problemas."
                )
                
        except Exception as e:
            QMessageBox.critical(
                self,
                "Erro",
                f"Erro ao carregar arquivos com problemas: {str(e)}"
            )
        finally:
            self.setCursor(Qt.ArrowCursor)
            
    def update_pagination_info(self, pagination):
        """Update pagination controls and info."""
        self.total_items = pagination.get('totalItems', 0)
        self.total_pages = pagination.get('totalPages', 1)
        self.current_page = pagination.get('currentPage', 1)
        
        # Update pagination controls
        self.pageInfoLabel.setText(f"Página {self.current_page} de {self.total_pages} (Total: {self.total_items} itens)")
        
        # Enable/disable navigation buttons
        self.firstPageButton.setEnabled(self.current_page > 1)
        self.prevPageButton.setEnabled(self.current_page > 1)
        self.nextPageButton.setEnabled(self.current_page < self.total_pages)
        self.lastPageButton.setEnabled(self.current_page < self.total_pages)
    
    def populate_files_table(self, files):
        """Populate the table with incorrect files data."""
        self.filesTable.setRowCount(len(files))
        
        for row, file in enumerate(files):
            # Add file information
            self.filesTable.setItem(row, 0, QTableWidgetItem(str(file.get('id', ''))))
            self.filesTable.setItem(row, 1, QTableWidgetItem(file.get('nome', '')))
            self.filesTable.setItem(row, 2, QTableWidgetItem(file.get('nome_arquivo', '')))
            self.filesTable.setItem(row, 3, QTableWidgetItem(file.get('extensao', '')))
            
            volume_info = f"{file.get('volume_nome', '')} ({file.get('volume', '')})"
            self.filesTable.setItem(row, 4, QTableWidgetItem(volume_info))
            
            # Get status type based on tipo_status_id
            status_type = ""
            if file.get('tipo_status_id') == 2:
                status_type = "Erro na validação"
            elif file.get('tipo_status_id') == 4:
                status_type = "Erro em arquivo deletado"
            
            self.filesTable.setItem(row, 5, QTableWidgetItem(status_type))
            
            # Use the most recent date available
            date = file.get('data_modificacao') or file.get('data_delete') or file.get('data_cadastramento', '')
            if date:
                date_dt = QDateTime.fromString(date, Qt.ISODate)
                date_formatted = date_dt.toString('dd/MM/yyyy HH:mm:ss')
            else:
                date_formatted = "Sem data"
            self.filesTable.setItem(row, 6, QTableWidgetItem(date_formatted))
            
            # File type (regular or deleted)
            self.filesTable.setItem(row, 7, QTableWidgetItem(file.get('tipo', '')))
            
    def go_to_first_page(self):
        """Navigate to the first page."""
        if self.current_page > 1:
            self.current_page = 1
            self.load_incorrect_files()
    
    def go_to_prev_page(self):
        """Navigate to the previous page."""
        if self.current_page > 1:
            self.current_page -= 1
            self.load_incorrect_files()
    
    def go_to_next_page(self):
        """Navigate to the next page."""
        if self.current_page < self.total_pages:
            self.current_page += 1
            self.load_incorrect_files()
    
    def go_to_last_page(self):
        """Navigate to the last page."""
        if self.current_page < self.total_pages:
            self.current_page = self.total_pages
            self.load_incorrect_files()
    
    def change_page_size(self, new_size):
        """Change the number of items per page."""
        try:
            new_size_int = int(new_size)
            if new_size_int != self.page_size:
                self.page_size = new_size_int
                self.current_page = 1  # Reset to first page
                self.load_incorrect_files()
        except ValueError:
            pass
    
    def refresh_data(self):
        """Refresh the current page data."""
        self.load_incorrect_files()
        
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