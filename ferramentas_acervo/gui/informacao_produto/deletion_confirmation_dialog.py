# Path: gui\informacao_produto\deletion_confirmation_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QDialogButtonBox, QMessageBox, QStyle
from qgis.PyQt.QtCore import Qt

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'deletion_confirmation_dialog.ui'))

class DeletionConfirmationDialog(QDialog, FORM_CLASS):
    """
    Diálogo para confirmar exclusão de itens com verificação de segurança.
    Requer que o usuário digite o nome do item para confirmar e forneça um motivo.
    """
    def __init__(self, item_type, item_name, parent=None):
        """
        Inicializa o diálogo de confirmação de exclusão.
        
        Args:
            item_type (str): Tipo do item (ex: "produto", "versão", "arquivo")
            item_name (str): Nome do item a ser excluído
            parent: Widget pai
        """
        super(DeletionConfirmationDialog, self).__init__(parent)
        self.setupUi(self)
        
        self.item_type = item_type
        self.item_name = item_name
        
        # Ícone de aviso a partir do tema atual (o pixmap do .ui apontava para
        # um arquivo inexistente; usar o ícone padrão evita um label vazio)
        warning_icon = self.style().standardIcon(QStyle.StandardPixmap.SP_MessageBoxWarning)
        self.warningIconLabel.setPixmap(warning_icon.pixmap(48, 48))

        # Configurar strings específicas
        self.setWindowTitle(f"Confirmar Exclusão de {item_type.title()}")
        self.warningLabel.setText(f"Você está prestes a excluir o {item_type} <b>{item_name}</b>. Esta ação não pode ser desfeita.")
        self.confirmLabel.setText(f"Digite o nome do {item_type} para confirmar:")
        self.nameLineEdit.setPlaceholderText(f"Digite '{item_name}' para confirmar")
        
        # Conectar eventos
        self.nameLineEdit.textChanged.connect(self.validate_form)
        self.motivoTextEdit.textChanged.connect(self.validate_form)
        self.buttonBox.button(QDialogButtonBox.StandardButton.Ok).setText("Excluir")
        self.buttonBox.button(QDialogButtonBox.StandardButton.Ok).setEnabled(False)
        
        # Estilizar o botão de exclusão
        delete_button = self.buttonBox.button(QDialogButtonBox.StandardButton.Ok)
        delete_button.setStyleSheet("background-color: #CF222E; color: white;")

    def validate_form(self):
        """Verifica se o formulário está válido para habilitar o botão de exclusão."""
        name_valid = self.nameLineEdit.text() == self.item_name
        motivo_valid = len(self.motivoTextEdit.toPlainText().strip()) > 0
        
        self.buttonBox.button(QDialogButtonBox.StandardButton.Ok).setEnabled(name_valid and motivo_valid)
        
    def get_motivo(self):
        """Retorna o motivo fornecido para a exclusão."""
        return self.motivoTextEdit.toPlainText().strip()