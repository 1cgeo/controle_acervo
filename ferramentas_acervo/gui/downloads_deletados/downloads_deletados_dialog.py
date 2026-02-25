# Path: gui\downloads_deletados\downloads_deletados_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QTableWidgetItem, QHeaderView, QFileDialog
from qgis.PyQt.QtCore import Qt, QDateTime
import csv

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'downloads_deletados_dialog.ui'))

class DownloadsDeletadosDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(DownloadsDeletadosDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.current_page = 1
        self.page_size = 20
        self.total_pages = 1
        self.total_items = 0

        self.setup_ui()
        self.load_downloads_deletados()

    def setup_ui(self):
        self.setWindowTitle("Downloads Excluídos")

        self.downloadsTable.setColumnCount(7)
        self.downloadsTable.setHorizontalHeaderLabels([
            'ID', 'Arquivo', 'Nome do Arquivo', 'Usuário',
            'Data Download', 'Motivo Exclusão', 'Data Exclusão'
        ])
        self.downloadsTable.setSelectionBehavior(self.downloadsTable.SelectRows)
        self.downloadsTable.setEditTriggers(self.downloadsTable.NoEditTriggers)

        header = self.downloadsTable.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(1, QHeaderView.Stretch)
        header.setSectionResizeMode(2, QHeaderView.Stretch)
        header.setSectionResizeMode(3, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(4, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(5, QHeaderView.Stretch)
        header.setSectionResizeMode(6, QHeaderView.ResizeToContents)

        self.firstPageButton.clicked.connect(self.go_to_first_page)
        self.prevPageButton.clicked.connect(self.go_to_prev_page)
        self.nextPageButton.clicked.connect(self.go_to_next_page)
        self.lastPageButton.clicked.connect(self.go_to_last_page)
        self.refreshButton.clicked.connect(self.refresh_data)
        self.exportCSVButton.clicked.connect(self.export_csv)
        self.closeButton.clicked.connect(self.reject)

        self.pageSizeComboBox.addItems(['10', '20', '50', '100'])
        self.pageSizeComboBox.setCurrentText(str(self.page_size))
        self.pageSizeComboBox.currentTextChanged.connect(self.change_page_size)

    def load_downloads_deletados(self):
        try:
            self.setCursor(Qt.WaitCursor)
            response = self.api_client.get(
                f'gerencia/downloads_deletados?page={self.current_page}&limit={self.page_size}'
            )
            if response and 'dados' in response:
                dados = response['dados']
                total = dados.get('total', 0)
                page = dados.get('page', 1)
                limit = dados.get('limit', self.page_size)
                downloads = dados.get('dados', [])
                self.total_items = total
                self.total_pages = max(1, -(-total // limit))
                self.current_page = page
                self.update_pagination_info()
                self.populate_downloads_table(downloads)
            else:
                QMessageBox.warning(self, "Aviso", "Não foi possível carregar os downloads excluídos.")
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao carregar downloads excluídos: {str(e)}")
        finally:
            self.setCursor(Qt.ArrowCursor)

    def update_pagination_info(self):
        self.pageInfoLabel.setText(
            f"Página {self.current_page} de {self.total_pages} (Total: {self.total_items} itens)"
        )
        self.firstPageButton.setEnabled(self.current_page > 1)
        self.prevPageButton.setEnabled(self.current_page > 1)
        self.nextPageButton.setEnabled(self.current_page < self.total_pages)
        self.lastPageButton.setEnabled(self.current_page < self.total_pages)

    def populate_downloads_table(self, downloads):
        self.downloadsTable.setRowCount(len(downloads))
        for row, download in enumerate(downloads):
            self.downloadsTable.setItem(row, 0, QTableWidgetItem(str(download.get('id', ''))))
            self.downloadsTable.setItem(row, 1, QTableWidgetItem(download.get('arquivo_nome', '') or ''))
            self.downloadsTable.setItem(row, 2, QTableWidgetItem(download.get('nome_arquivo', '') or ''))
            self.downloadsTable.setItem(row, 3, QTableWidgetItem(download.get('usuario_nome', '') or ''))
            for col, field in [(4, 'data_download'), (6, 'data_delete')]:
                date = download.get(field, '')
                if date:
                    date_dt = QDateTime.fromString(date, Qt.ISODate)
                    date_formatted = date_dt.toString('dd/MM/yyyy HH:mm:ss')
                else:
                    date_formatted = ""
                self.downloadsTable.setItem(row, col, QTableWidgetItem(date_formatted))
            self.downloadsTable.setItem(row, 5, QTableWidgetItem(download.get('motivo_exclusao', '') or ''))

    def go_to_first_page(self):
        if self.current_page > 1:
            self.current_page = 1
            self.load_downloads_deletados()

    def go_to_prev_page(self):
        if self.current_page > 1:
            self.current_page -= 1
            self.load_downloads_deletados()

    def go_to_next_page(self):
        if self.current_page < self.total_pages:
            self.current_page += 1
            self.load_downloads_deletados()

    def go_to_last_page(self):
        if self.current_page < self.total_pages:
            self.current_page = self.total_pages
            self.load_downloads_deletados()

    def change_page_size(self, new_size):
        try:
            new_size_int = int(new_size)
            if new_size_int != self.page_size:
                self.page_size = new_size_int
                self.current_page = 1
                self.load_downloads_deletados()
        except ValueError:
            pass

    def refresh_data(self):
        self.load_downloads_deletados()

    def export_csv(self):
        if self.downloadsTable.rowCount() == 0:
            QMessageBox.warning(self, "Aviso", "Não há dados para exportar.")
            return
        filename, _ = QFileDialog.getSaveFileName(self, "Exportar para CSV", "", "Arquivos CSV (*.csv)")
        if not filename:
            return
        try:
            with open(filename, 'w', newline='', encoding='utf-8') as file:
                writer = csv.writer(file)
                headers = []
                for column in range(self.downloadsTable.columnCount()):
                    headers.append(self.downloadsTable.horizontalHeaderItem(column).text())
                writer.writerow(headers)
                for row in range(self.downloadsTable.rowCount()):
                    row_data = []
                    for column in range(self.downloadsTable.columnCount()):
                        item = self.downloadsTable.item(row, column)
                        row_data.append(item.text() if item else "")
                    writer.writerow(row_data)
            QMessageBox.information(self, "Sucesso", f"Dados exportados com sucesso para {filename}")
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao exportar dados: {str(e)}")
