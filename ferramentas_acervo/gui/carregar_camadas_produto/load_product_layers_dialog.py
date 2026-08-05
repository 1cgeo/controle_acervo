# Path: gui\carregar_camadas_produto\load_product_layers_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QVBoxLayout, QCheckBox, QPushButton, QMessageBox, QLabel, QDialogButtonBox
from qgis.PyQt.QtCore import Qt

from ..mapa_utils import carregar_camadas_matview

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'load_product_layers_dialog.ui'))

class LoadProductLayersDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(LoadProductLayersDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.layers = []
        self.checkboxes = []

        self.setup_ui()
        self.load_layers()

    def setup_ui(self):
        self.setWindowTitle("Carregar Camadas de Produtos")
        self.layout = QVBoxLayout()
        self.scrollArea.setWidget(self.scrollAreaWidgetContents)
        self.scrollAreaWidgetContents.setLayout(self.layout)

        self.selectAllButton = QPushButton("Selecionar Todos")
        self.selectAllButton.clicked.connect(self.toggle_all)
        self.buttonBox.addButton(self.selectAllButton, QDialogButtonBox.ButtonRole.ActionRole)

        self.buttonBox.accepted.connect(self.load_selected_layers)
        self.buttonBox.rejected.connect(self.reject)

    def load_layers(self):
        try:
            response = self.api_client.get('acervo/camadas_produto')
            if response and 'dados' in response:
                self.layers = [layer for layer in response['dados'] if layer['quantidade_produtos'] > 0]
                if self.layers:
                    for layer in self.layers:
                        checkbox = QCheckBox(f"{layer['tipo_produto']} - {layer['tipo_escala']} ({layer['quantidade_produtos']} produtos)")
                        self.checkboxes.append(checkbox)
                        self.layout.addWidget(checkbox)
                else:
                    self.show_no_layers_message()
            else:
                QMessageBox.warning(self, "Erro", "Não foi possível carregar as camadas de produtos.")
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao carregar camadas: {str(e)}")

    def show_no_layers_message(self):
        message_label = QLabel("Não há camadas de produtos disponíveis no momento.")
        message_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.layout.addWidget(message_label)
        self.selectAllButton.setEnabled(False)
        self.buttonBox.button(QDialogButtonBox.StandardButton.Ok).setEnabled(False)

    def toggle_all(self):
        check_all = any(not cb.isChecked() for cb in self.checkboxes)
        for checkbox in self.checkboxes:
            checkbox.setChecked(check_all)

    def load_selected_layers(self):
        selected_layers = [layer for layer, checkbox in zip(self.layers, self.checkboxes) if checkbox.isChecked()]
        if not selected_layers:
            QMessageBox.warning(self, "Aviso", "Nenhuma camada selecionada.")
            return

        carregadas, _ = carregar_camadas_matview(self, selected_layers)
        if carregadas:
            self.accept()