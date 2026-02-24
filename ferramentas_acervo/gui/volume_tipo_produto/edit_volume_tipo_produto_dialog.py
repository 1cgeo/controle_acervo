# Path: gui\volume_tipo_produto\edit_volume_tipo_produto_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'edit_volume_tipo_produto_dialog.ui'))

class EditVolumeTipoProdutoDialog(QDialog, FORM_CLASS):
    def __init__(self, api_client, volume_tipo_produto_data=None, parent=None):
        super(EditVolumeTipoProdutoDialog, self).__init__(parent)
        self.setupUi(self)
        self.api_client = api_client
        self.volume_tipo_produto_data = volume_tipo_produto_data

        self.setup_ui()
        if volume_tipo_produto_data:
            self.load_volume_tipo_produto()

    def setup_ui(self):
        self.setWindowTitle("Editar Relacionamento" if self.volume_tipo_produto_data else "Adicionar Relacionamento")
        
        # Carregar tipos de produto e volumes de armazenamento para os comboboxes
        self.load_tipos_produto()
        self.load_volumes_armazenamento()

        # Conectar sinais
        self.buttonBox.accepted.connect(self.save_volume_tipo_produto)
        self.buttonBox.rejected.connect(self.reject)

    def load_tipos_produto(self):
        response = self.api_client.get('gerencia/dominio/tipo_produto')
        if response and 'dados' in response:
            tipos_produto = response['dados']
            self.tipoProdutoComboBox.clear()
            for tipo in tipos_produto:
                self.tipoProdutoComboBox.addItem(tipo['nome'], tipo['code'])

    def load_volumes_armazenamento(self):
        response = self.api_client.get('volumes/volume_armazenamento')
        if response and 'dados' in response:
            volumes = response['dados']
            self.volumeArmazenamentoComboBox.clear()
            for volume in volumes:
                self.volumeArmazenamentoComboBox.addItem(f"{volume['nome']} ({volume['volume']})", volume['id'])

    def load_volume_tipo_produto(self):
        self.tipoProdutoComboBox.setCurrentIndex(self.tipoProdutoComboBox.findData(self.volume_tipo_produto_data['tipo_produto_id']))
        self.volumeArmazenamentoComboBox.setCurrentIndex(self.volumeArmazenamentoComboBox.findData(self.volume_tipo_produto_data['volume_armazenamento_id']))
        self.primarioCheckBox.setChecked(self.volume_tipo_produto_data['primario'])

    def save_volume_tipo_produto(self):
        if not self.validate_inputs():
            return

        data = {
            'tipo_produto_id': self.tipoProdutoComboBox.currentData(),
            'volume_armazenamento_id': self.volumeArmazenamentoComboBox.currentData(),
            'primario': self.primarioCheckBox.isChecked()
        }

        if self.volume_tipo_produto_data:
            data['id'] = self.volume_tipo_produto_data['id']
            success = self.api_client.put('volumes/volume_tipo_produto', {'volume_tipo_produto': [data]})
        else:
            success = self.api_client.post('volumes/volume_tipo_produto', {'volume_tipo_produto': [data]})

        if success:
            QMessageBox.information(self, "Sucesso", "Relacionamento salvo com sucesso.")
            self.accept()
        else:
            QMessageBox.warning(self, "Erro", "Não foi possível salvar o relacionamento.")

    def validate_inputs(self):
        if self.tipoProdutoComboBox.currentIndex() == -1:
            QMessageBox.warning(self, "Erro", "É necessário selecionar um tipo de produto.")
            return False
        if self.volumeArmazenamentoComboBox.currentIndex() == -1:
            QMessageBox.warning(self, "Erro", "É necessário selecionar um volume de armazenamento.")
            return False
        return True