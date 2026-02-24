# Path: gui\volume_tipo_produto\manage_volume_tipo_produto_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QVBoxLayout, QTableWidget, QPushButton, QMessageBox, QTableWidgetItem
from qgis.PyQt.QtCore import Qt
from .edit_volume_tipo_produto_dialog import EditVolumeTipoProdutoDialog

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'manage_volume_tipo_produto_dialog.ui'))

class ManageVolumeTipoProdutoDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(ManageVolumeTipoProdutoDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client

        self.setup_ui()
        self.load_volume_tipo_produto()

    def setup_ui(self):
        self.setWindowTitle("Gerenciar Relacionamento Volume e Tipo de Produto")
        
        # Configurar a tabela
        self.volumeTipoProdutoTable.setColumnCount(6)
        self.volumeTipoProdutoTable.setHorizontalHeaderLabels(['Id', 'Tipo Produto', 'Volume Armazenamento', 'Nome Volume', 'Capacidade GB', 'Primário'])
        self.volumeTipoProdutoTable.setSelectionBehavior(QTableWidget.SelectRows)
        self.volumeTipoProdutoTable.setEditTriggers(QTableWidget.NoEditTriggers)

        # Conectar botões
        self.addButton.clicked.connect(self.add_volume_tipo_produto)
        self.editButton.clicked.connect(self.edit_volume_tipo_produto)
        self.deleteButton.clicked.connect(self.delete_volume_tipo_produto)

    def load_volume_tipo_produto(self):
        response = self.api_client.get('volumes/volume_tipo_produto')
        if response is None:
            QMessageBox.warning(self, "Erro", "Não foi possível carregar os relacionamentos.")
            return

        self.volume_tipo_produto = response.get('dados', [])
        self.volumeTipoProdutoTable.setRowCount(len(self.volume_tipo_produto))
        for row, item in enumerate(self.volume_tipo_produto):
            self.volumeTipoProdutoTable.setItem(row, 0, QTableWidgetItem(str(item.get('id', ''))))
            self.volumeTipoProdutoTable.setItem(row, 1, QTableWidgetItem(str(item.get('tipo_produto', ''))))
            self.volumeTipoProdutoTable.setItem(row, 2, QTableWidgetItem(item.get('volume', '')))
            self.volumeTipoProdutoTable.setItem(row, 3, QTableWidgetItem(item.get('nome_volume', '')))
            self.volumeTipoProdutoTable.setItem(row, 4, QTableWidgetItem(str(item.get('volume_capacidade_gb', ''))))
            self.volumeTipoProdutoTable.setItem(row, 5, QTableWidgetItem('Sim' if item.get('primario') else 'Não'))
        self.volumeTipoProdutoTable.resizeColumnsToContents()

    def add_volume_tipo_produto(self):
        dialog = EditVolumeTipoProdutoDialog(self.api_client)
        if dialog.exec_():
            self.load_volume_tipo_produto()

    def edit_volume_tipo_produto(self):
        selected_rows = self.volumeTipoProdutoTable.selectionModel().selectedRows()
        if len(selected_rows) == 1:
            row = selected_rows[0].row()
            id = int(self.volumeTipoProdutoTable.item(row, 0).text())
            item_data = next((item for item in self.volume_tipo_produto if str(item['id']) == str(id)), None)
            if item_data:
                dialog = EditVolumeTipoProdutoDialog(self.api_client, item_data)
                if dialog.exec_():
                    self.load_volume_tipo_produto()
            else:
                QMessageBox.warning(self, "Erro", "Não foi possível encontrar os dados do volume/tipo de produto selecionado.")
        else:
            QMessageBox.warning(self, "Aviso", "Por favor, selecione um item para editar.")

    def delete_volume_tipo_produto(self):
        selected_rows = self.volumeTipoProdutoTable.selectionModel().selectedRows()
        if len(selected_rows) == 1:
            id = int(self.volumeTipoProdutoTable.item(selected_rows[0].row(), 0).text())
            reply = QMessageBox.question(self, 'Confirmar Exclusão',
                                         'Tem certeza que deseja excluir este relacionamento?',
                                         QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
            if reply == QMessageBox.Yes:
                success = self.api_client.delete('volumes/volume_tipo_produto', {'volume_tipo_produto_ids': [id]})
                if success:
                    self.load_volume_tipo_produto()
                    QMessageBox.information(self, "Sucesso", "Relacionamento excluído com sucesso.")
                else:
                    QMessageBox.warning(self, "Erro", "Não foi possível excluir o relacionamento.")
        else:
            QMessageBox.warning(self, "Aviso", "Por favor, selecione um item para excluir.")

    def showEvent(self, event):
        super().showEvent(event)
        self.load_volume_tipo_produto()