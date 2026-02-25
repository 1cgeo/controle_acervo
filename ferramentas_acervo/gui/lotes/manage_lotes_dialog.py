# Path: gui\lotes\manage_lotes_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QTableWidget, QTableWidgetItem, QMessageBox
from qgis.PyQt.QtCore import Qt, QDate
from .edit_lote_dialog import EditLoteDialog

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'manage_lotes_dialog.ui'))

class ManageLotesDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(ManageLotesDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.lotes = []

        self.setup_ui()
        self.load_lotes()

    def setup_ui(self):
        self.setWindowTitle("Gerenciar Lotes")
        
        # Configurar a tabela de lotes
        self.lotesTable.setColumnCount(8)
        self.lotesTable.setHorizontalHeaderLabels(['Id', 'Nome', 'PIT', 'Projeto', 'Descrição', 'Data Início', 'Data Fim', 'Status'])
        self.lotesTable.setSelectionBehavior(QTableWidget.SelectRows)
        self.lotesTable.setEditTriggers(QTableWidget.NoEditTriggers)

        # Conectar botões
        self.addButton.clicked.connect(self.add_lote)
        self.editButton.clicked.connect(self.edit_lote)
        self.deleteButton.clicked.connect(self.delete_lote)

        # Conectar campo de busca
        self.searchLineEdit.textChanged.connect(self.filter_lotes)

    def load_lotes(self):
        response = self.api_client.get('projetos/lote')
        if response is None:
            QMessageBox.warning(self, "Erro", "Não foi possível carregar os lotes.")
            return

        self.lotes = response.get('dados', [])
        if not isinstance(self.lotes, list):
            QMessageBox.warning(self, "Erro", "Formato de resposta inesperado.")
            return

        self.display_lotes(self.lotes)

    def display_lotes(self, lotes):
        self.lotesTable.setRowCount(len(lotes))
        for row, lote in enumerate(lotes):
            if not isinstance(lote, dict):
                continue
            self.lotesTable.setItem(row, 0, QTableWidgetItem(str(lote.get('id', ''))))
            self.lotesTable.setItem(row, 1, QTableWidgetItem(lote.get('nome', '')))
            self.lotesTable.setItem(row, 2, QTableWidgetItem(lote.get('pit', '')))
            self.lotesTable.setItem(row, 3, QTableWidgetItem(str(lote.get('projeto', ''))))
            self.lotesTable.setItem(row, 4, QTableWidgetItem(lote.get('descricao', '')))

            data_inicio = QDate.fromString(lote.get('data_inicio', ''), Qt.ISODate)
            self.lotesTable.setItem(row, 5, QTableWidgetItem(data_inicio.toString('yyyy-MM-dd')))
           
            data_fim = lote.get('data_fim', '')
            if data_fim:
                data_fim = QDate.fromString(data_fim, Qt.ISODate).toString('yyyy-MM-dd')
            else:
                data_fim = 'Não definida'
            self.lotesTable.setItem(row, 6, QTableWidgetItem(data_fim))

            self.lotesTable.setItem(row, 7, QTableWidgetItem(str(lote.get('status_execucao', ''))))
        self.lotesTable.resizeColumnsToContents()

    def filter_lotes(self):
        search_text = self.searchLineEdit.text().lower()
        filtered_lotes = [
            lote for lote in self.lotes
            if search_text in lote.get('nome', '').lower() or 
               search_text in lote.get('pit', '').lower() or 
               search_text in lote.get('descricao', '').lower()
        ]
        self.display_lotes(filtered_lotes)

    def add_lote(self):
        dialog = EditLoteDialog(self.api_client)
        if dialog.exec_():
            self.load_lotes()

    def edit_lote(self):
        selected_rows = self.lotesTable.selectionModel().selectedRows()
        if len(selected_rows) == 1:
            id = int(self.lotesTable.item(selected_rows[0].row(), 0).text())
            # Correção: usando self.lotes em vez de self.projects
            lote_data = next((item for item in self.lotes if str(item['id']) == str(id)), None)

            if lote_data:
                dialog = EditLoteDialog(self.api_client, lote_data)
                if dialog.exec_():
                    self.load_lotes()
            else:
                QMessageBox.warning(self, "Erro", "Não foi possível encontrar os dados do lote selecionado.")
        else:
            QMessageBox.warning(self, "Aviso", "Por favor, selecione um lote para editar.")

    def delete_lote(self):
        selected_rows = self.lotesTable.selectionModel().selectedRows()
        if len(selected_rows) == 1:
            lote_id = int(self.lotesTable.item(selected_rows[0].row(), 0).text())
            reply = QMessageBox.question(self, 'Confirmar Exclusão',
                                         'Tem certeza que deseja excluir este lote?',
                                         QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
            if reply == QMessageBox.Yes:
                success = self.api_client.delete('projetos/lote', {'lote_ids': [lote_id]})
                if success:
                    self.load_lotes()
                    QMessageBox.information(self, "Sucesso", "Lote excluído com sucesso.")
                else:
                    QMessageBox.warning(self, "Erro", "Não foi possível excluir o lote.")
        else:
            QMessageBox.warning(self, "Aviso", "Por favor, selecione um lote para excluir.")

    def showEvent(self, event):
        super().showEvent(event)
        self.load_lotes()