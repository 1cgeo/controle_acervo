# Path: gui\volumes\edit_volume_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'edit_volume_dialog.ui'))

class EditVolumeDialog(QDialog, FORM_CLASS):
    def __init__(self, api_client, volume_data=None, parent=None):
        super(EditVolumeDialog, self).__init__(parent)
        self.setupUi(self)
        self.api_client = api_client
        self.volume_data = volume_data

        self.setup_ui()
        if volume_data:
            self.load_volume()

    def setup_ui(self):
        self.setWindowTitle("Editar Volume" if self.volume_data else "Adicionar Volume")
        
        # Conectar sinais
        self.buttonBox.accepted.connect(self.save_volume)
        self.buttonBox.rejected.connect(self.reject)

    def load_volume(self):
        self.nameLineEdit.setText(self.volume_data['nome'])
        self.volumeLineEdit.setText(self.volume_data['volume'])
        self.capacitySpinBox.setValue(self.volume_data['capacidade_gb'])

    def save_volume(self):
        if not self.validate_inputs():
            return

        volume_data = {
            'nome': self.nameLineEdit.text(),
            'volume': self.volumeLineEdit.text(),
            'capacidade_gb': self.capacitySpinBox.value()
        }

        if self.volume_data:
            volume_data['id'] = self.volume_data['id']
            success = self.api_client.put('volumes/volume_armazenamento', {'volume_armazenamento': [volume_data]})
        else:
            success = self.api_client.post('volumes/volume_armazenamento', {'volume_armazenamento': [volume_data]})

        if success:
            QMessageBox.information(self, "Sucesso", "Volume salvo com sucesso.")
            self.accept()
        else:
            QMessageBox.warning(self, "Erro", "Não foi possível salvar o volume.")

    def validate_inputs(self):
        if not self.nameLineEdit.text():
            QMessageBox.warning(self, "Erro", "O nome do volume é obrigatório.")
            return False
        if not self.volumeLineEdit.text():
            QMessageBox.warning(self, "Erro", "O volume é obrigatório.")
            return False
        if self.capacitySpinBox.value() <= 0:
            QMessageBox.warning(self, "Erro", "A capacidade deve ser maior que zero.")
            return False
        return True