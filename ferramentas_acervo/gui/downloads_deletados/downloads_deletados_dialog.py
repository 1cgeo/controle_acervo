# Path: gui\downloads_deletados\downloads_deletados_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QTableWidget, QTableWidgetItem, QHeaderView
from qgis.PyQt.QtCore import Qt, QDateTime
from ..ui_utils import exportar_tabela_csv, sortable_item, sortable_int_item

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
        self.downloadsTable.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.downloadsTable.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)

        header = self.downloadsTable.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        header.setSectionResizeMode(5, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(6, QHeaderView.ResizeMode.ResizeToContents)

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
            self.setCursor(Qt.CursorShape.WaitCursor)
            response = self.api_client.get(
                f'gerencia/downloads_deletados?page={self.current_page}&limit={self.page_size}'
            )
            if response and 'dados' in response:
                downloads = response.get('dados') or []
                pagination = response.get('pagination') or {}
                self.total_items = int(pagination.get('totalItems', len(downloads)))
                self.total_pages = int(pagination.get('totalPages', 1)) or 1
                self.current_page = int(pagination.get('currentPage', self.current_page))
                self.update_pagination_info()
                self.populate_downloads_table(downloads)
            else:
                QMessageBox.warning(self, "Aviso", "Não foi possível carregar os downloads excluídos.")
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao carregar downloads excluídos: {str(e)}")
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)

    def update_pagination_info(self):
        if self.total_items == 0:
            self.pageInfoLabel.setText("Nenhum download excluído registrado.")
        else:
            self.pageInfoLabel.setText(
                f"Página {self.current_page} de {self.total_pages} (Total: {self.total_items} itens)"
            )
        self.firstPageButton.setEnabled(self.current_page > 1)
        self.prevPageButton.setEnabled(self.current_page > 1)
        self.nextPageButton.setEnabled(self.current_page < self.total_pages)
        self.lastPageButton.setEnabled(self.current_page < self.total_pages)

    def populate_downloads_table(self, downloads):
        # Desliga a ordenação durante o preenchimento para não embaralhar células
        self.downloadsTable.setSortingEnabled(False)
        self.downloadsTable.setRowCount(len(downloads))
        for row, download in enumerate(downloads):
            self.downloadsTable.setItem(row, 0, sortable_int_item(download.get('id')))
            self.downloadsTable.setItem(row, 1, QTableWidgetItem(download.get('arquivo_nome', '') or ''))
            self.downloadsTable.setItem(row, 2, QTableWidgetItem(download.get('nome_arquivo', '') or ''))
            self.downloadsTable.setItem(row, 3, QTableWidgetItem(download.get('usuario_nome', '') or ''))
            for col, field in [(4, 'data_download'), (6, 'data_delete')]:
                date = download.get(field, '')
                if date:
                    date_dt = QDateTime.fromString(date, Qt.DateFormat.ISODate)
                    date_formatted = date_dt.toString('dd/MM/yyyy HH:mm:ss')
                    self.downloadsTable.setItem(row, col, sortable_item(date_formatted, date))
                else:
                    self.downloadsTable.setItem(row, col, sortable_item("", ""))
            self.downloadsTable.setItem(row, 5, QTableWidgetItem(download.get('motivo_exclusao', '') or ''))
        self.downloadsTable.setSortingEnabled(True)

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
        """Exporta a PÁGINA ATUAL para CSV. Não há rota de CSV para esta lista."""
        QMessageBox.information(
            self, "Exportar CSV",
            f"O arquivo terá os {self.downloadsTable.rowCount()} registro(s) da página atual, "
            f"de um total de {self.total_items}.\n\n"
            "Aumente os itens por página para exportar mais de uma vez só."
        )
        exportar_tabela_csv(self, self.downloadsTable, 'downloads-excluidos.csv')
