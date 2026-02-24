# Path: gui\volumes\manage_volumes_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QTableWidget, QTableWidgetItem, QMessageBox
from qgis.PyQt.QtCore import Qt
from .edit_volume_dialog import EditVolumeDialog

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'manage_volumes_dialog.ui'))

class ManageVolumesDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(ManageVolumesDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client

        self.setup_ui()
        self.load_volumes()

    def setup_ui(self):
        self.setWindowTitle("Gerenciar Volumes de Armazenamento")
        
        # Configurar a tabela de volumes
        self.volumesTable.setColumnCount(4)
        self.volumesTable.setHorizontalHeaderLabels(['Id', 'Nome', 'Volume', 'Capacidade (GB)'])
        self.volumesTable.setSelectionBehavior(QTableWidget.SelectRows)
        self.volumesTable.setEditTriggers(QTableWidget.NoEditTriggers)

        # Conectar botões
        self.addButton.clicked.connect(self.add_volume)
        self.editButton.clicked.connect(self.edit_volume)
        self.deleteButton.clicked.connect(self.delete_volume)

    def load_volumes(self):
        response = self.api_client.get('volumes/volume_armazenamento')
        if response is None:
            QMessageBox.warning(self, "Erro", "Não foi possível carregar os volumes.")
            return

        self.volumes = response.get('dados', [])
        self.volumesTable.setRowCount(len(self.volumes))
        for row, volume in enumerate(self.volumes):
            self.volumesTable.setItem(row, 0, QTableWidgetItem(str(volume['id'])))
            self.volumesTable.setItem(row, 1, QTableWidgetItem(volume['nome']))
            self.volumesTable.setItem(row, 2, QTableWidgetItem(volume['volume']))
            self.volumesTable.setItem(row, 3, QTableWidgetItem(str(volume['capacidade_gb'])))

        self.volumesTable.resizeColumnsToContents()

    def add_volume(self):
        dialog = EditVolumeDialog(self.api_client)
        if dialog.exec_():
            self.load_volumes()

    def edit_volume(self):
        selected_rows = self.volumesTable.selectionModel().selectedRows()
        if len(selected_rows) == 1:
            id = int(self.volumesTable.item(selected_rows[0].row(), 0).text())
            # Correção: usando self.volumes em vez de self.volumesTable
            volume_data = next((item for item in self.volumes if str(item['id']) == str(id)), None)

            if volume_data:
                dialog = EditVolumeDialog(self.api_client, volume_data)
                if dialog.exec_():
                    self.load_volumes()
            else:
                QMessageBox.warning(self, "Erro", "Não foi possível encontrar os dados do volume selecionado.")
        else:
            QMessageBox.warning(self, "Aviso", "Por favor, selecione um volume para editar.")

    def delete_volume(self):
        selected_rows = self.volumesTable.selectionModel().selectedRows()
        if len(selected_rows) == 1:
            volume_id = int(self.volumesTable.item(selected_rows[0].row(), 0).text())
            reply = QMessageBox.question(self, 'Confirmar Exclusão',
                                         'Tem certeza que deseja excluir este volume?',
                                         QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
            if reply == QMessageBox.Yes:
                success = self.api_client.delete('volumes/volume_armazenamento', {'volume_armazenamento_ids': [volume_id]})
                if success:
                    self.load_volumes()
                    QMessageBox.information(self, "Sucesso", "Volume excluído com sucesso.")
                else:
                    QMessageBox.warning(self, "Erro", "Não foi possível excluir o volume.")
        else:
            QMessageBox.warning(self, "Aviso", "Por favor, selecione um volume para excluir.")

    def showEvent(self, event):
        super().showEvent(event)
        self.load_volumes()