# Path: gui\versao_relacionamento\versao_relacionamento_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QTableWidgetItem, QHeaderView, QFileDialog
from qgis.PyQt.QtCore import Qt, QDateTime
import csv

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'versao_relacionamento_dialog.ui'))

class VersaoRelacionamentoDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(VersaoRelacionamentoDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client

        self.setup_ui()
        self.load_relacionamentos()

    def setup_ui(self):
        self.setWindowTitle("Relacionamentos entre Versões")

        self.relationshipsTable.setColumnCount(11)
        self.relationshipsTable.setHorizontalHeaderLabels([
            'ID', 'Tipo Relacionamento',
            'Produto 1', 'MI 1', 'INOM 1', 'Versão 1',
            'Produto 2', 'MI 2', 'INOM 2', 'Versão 2',
            'Data'
        ])
        self.relationshipsTable.setSelectionBehavior(self.relationshipsTable.SelectRows)
        self.relationshipsTable.setEditTriggers(self.relationshipsTable.NoEditTriggers)

        header = self.relationshipsTable.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(2, QHeaderView.Stretch)
        header.setSectionResizeMode(3, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(4, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(5, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(6, QHeaderView.Stretch)
        header.setSectionResizeMode(7, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(8, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(9, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(10, QHeaderView.ResizeToContents)

        self.refreshButton.clicked.connect(self.refresh_data)
        self.exportCSVButton.clicked.connect(self.export_csv)
        self.closeButton.clicked.connect(self.reject)

    def load_relacionamentos(self):
        try:
            self.setCursor(Qt.WaitCursor)
            response = self.api_client.get('produtos/versao_relacionamento')
            if response and 'dados' in response:
                self.populate_table(response['dados'])
            else:
                QMessageBox.warning(self, "Aviso", "Não foi possível carregar os relacionamentos entre versões.")
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao carregar relacionamentos: {str(e)}")
        finally:
            self.setCursor(Qt.ArrowCursor)

    def populate_table(self, relacionamentos):
        self.relationshipsTable.setRowCount(len(relacionamentos))
        for row, rel in enumerate(relacionamentos):
            self.relationshipsTable.setItem(row, 0, QTableWidgetItem(str(rel.get('id', ''))))
            self.relationshipsTable.setItem(row, 1, QTableWidgetItem(rel.get('tipo_relacionamento_nome', '')))
            self.relationshipsTable.setItem(row, 2, QTableWidgetItem(rel.get('produto_nome_1', '')))
            self.relationshipsTable.setItem(row, 3, QTableWidgetItem(rel.get('mi_1', '') or ''))
            self.relationshipsTable.setItem(row, 4, QTableWidgetItem(rel.get('inom_1', '') or ''))
            self.relationshipsTable.setItem(row, 5, QTableWidgetItem(rel.get('versao_1_nome', '')))
            self.relationshipsTable.setItem(row, 6, QTableWidgetItem(rel.get('produto_nome_2', '')))
            self.relationshipsTable.setItem(row, 7, QTableWidgetItem(rel.get('mi_2', '') or ''))
            self.relationshipsTable.setItem(row, 8, QTableWidgetItem(rel.get('inom_2', '') or ''))
            self.relationshipsTable.setItem(row, 9, QTableWidgetItem(rel.get('versao_2_nome', '')))
            date = rel.get('data_relacionamento', '')
            if date:
                date_dt = QDateTime.fromString(date, Qt.ISODate)
                date_formatted = date_dt.toString('dd/MM/yyyy HH:mm:ss')
            else:
                date_formatted = ""
            self.relationshipsTable.setItem(row, 10, QTableWidgetItem(date_formatted))

    def refresh_data(self):
        self.load_relacionamentos()

    def export_csv(self):
        if self.relationshipsTable.rowCount() == 0:
            QMessageBox.warning(self, "Aviso", "Não há dados para exportar.")
            return
        filename, _ = QFileDialog.getSaveFileName(self, "Exportar para CSV", "", "Arquivos CSV (*.csv)")
        if not filename:
            return
        try:
            with open(filename, 'w', newline='', encoding='utf-8') as file:
                writer = csv.writer(file)
                headers = []
                for column in range(self.relationshipsTable.columnCount()):
                    headers.append(self.relationshipsTable.horizontalHeaderItem(column).text())
                writer.writerow(headers)
                for row in range(self.relationshipsTable.rowCount()):
                    row_data = []
                    for column in range(self.relationshipsTable.columnCount()):
                        item = self.relationshipsTable.item(row, column)
                        row_data.append(item.text() if item else "")
                    writer.writerow(row_data)
            QMessageBox.information(self, "Sucesso", f"Dados exportados com sucesso para {filename}")
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao exportar dados: {str(e)}")
