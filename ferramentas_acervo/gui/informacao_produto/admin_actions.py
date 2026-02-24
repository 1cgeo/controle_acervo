# Path: gui\informacao_produto\admin_actions.py
"""
Funcionalidades administrativas para o diálogo de informações do produto.
"""

from qgis.PyQt.QtWidgets import (
    QWidget, QHBoxLayout, QPushButton, QMessageBox
)
from .deletion_confirmation_dialog import DeletionConfirmationDialog
from .product_edit_dialog import ProductEditDialog
from .version_edit_dialog import VersionEditDialog
from .file_edit_dialog import FileEditDialog

class AdminActions:
    @staticmethod
    def create_file_actions_widget(parent, file, edit_callback=None, delete_callback=None):
        """Cria um widget com botões de ação para um arquivo."""
        widget = QWidget(parent)
        layout = QHBoxLayout(widget)
        layout.setContentsMargins(0, 0, 0, 0)
        
        edit_btn = QPushButton("Editar")
        edit_btn.setProperty("file_id", file['id'])
        if edit_callback:
            edit_btn.clicked.connect(lambda: edit_callback(file))
        layout.addWidget(edit_btn)
        
        delete_btn = QPushButton("Excluir")
        delete_btn.setProperty("file_id", file['id'])
        delete_btn.setStyleSheet("background-color: #CF222E; color: white;")
        if delete_callback:
            delete_btn.clicked.connect(lambda: delete_callback(file))
        layout.addWidget(delete_btn)
        
        return widget
    
    @staticmethod
    def edit_product(dialog, api_client, product_data, refresh_callback=None):
        """Abre o diálogo de edição do produto."""
        edit_dialog = ProductEditDialog(api_client, product_data)
        result = edit_dialog.exec_()
        
        if result and refresh_callback:
            refresh_callback()
    
    @staticmethod
    def delete_product(dialog, api_client, product_data, close_callback=None):
        """Abre o diálogo de confirmação de exclusão do produto."""
        confirm_dialog = DeletionConfirmationDialog("produto", product_data['nome'])
        result = confirm_dialog.exec_()
        
        if result == QMessageBox.Accepted:
            motivo = confirm_dialog.get_motivo()
            
            try:
                response = api_client.delete('produtos/produto', {
                    'produto_ids': [product_data['id']],
                    'motivo_exclusao': motivo
                })
                
                if response:
                    QMessageBox.information(dialog, "Sucesso", "Produto excluído com sucesso!")
                    if close_callback:
                        close_callback()
                else:
                    QMessageBox.warning(dialog, "Erro", "Não foi possível excluir o produto.")
            except Exception as e:
                QMessageBox.critical(dialog, "Erro", f"Erro ao excluir produto: {str(e)}")
    
    @staticmethod
    def edit_version(dialog, api_client, version_data, refresh_callback=None):
        """Abre o diálogo de edição da versão."""
        edit_dialog = VersionEditDialog(api_client, version_data)
        result = edit_dialog.exec_()
        
        if result and refresh_callback:
            refresh_callback()
    
    @staticmethod
    def delete_version(dialog, api_client, version_data, refresh_callback=None):
        """Abre o diálogo de confirmação de exclusão da versão."""
        version_name = f"{version_data['versao']} - {version_data['nome_versao']}"
        confirm_dialog = DeletionConfirmationDialog("versão", version_name)
        result = confirm_dialog.exec_()
        
        if result == QMessageBox.Accepted:
            motivo = confirm_dialog.get_motivo()
            
            try:
                response = api_client.delete('produtos/versao', {
                    'versao_ids': [version_data['versao_id']],
                    'motivo_exclusao': motivo
                })
                
                if response:
                    QMessageBox.information(dialog, "Sucesso", "Versão excluída com sucesso!")
                    if refresh_callback:
                        refresh_callback()
                else:
                    QMessageBox.warning(dialog, "Erro", "Não foi possível excluir a versão.")
            except Exception as e:
                QMessageBox.critical(dialog, "Erro", f"Erro ao excluir versão: {str(e)}")
    
    @staticmethod
    def edit_file(dialog, api_client, file_data, refresh_callback=None):
        """Abre o diálogo de edição do arquivo."""
        edit_dialog = FileEditDialog(api_client, file_data)
        result = edit_dialog.exec_()
        
        if result and refresh_callback:
            refresh_callback()
    
    @staticmethod
    def delete_file(dialog, api_client, file_data, refresh_callback=None):
        """Abre o diálogo de confirmação de exclusão do arquivo."""
        confirm_dialog = DeletionConfirmationDialog("arquivo", file_data['nome'])
        result = confirm_dialog.exec_()
        
        if result == QMessageBox.Accepted:
            motivo = confirm_dialog.get_motivo()
            
            try:
                response = api_client.delete('arquivo/arquivo', {
                    'arquivo_ids': [file_data['id']],
                    'motivo_exclusao': motivo
                })
                
                if response:
                    QMessageBox.information(dialog, "Sucesso", "Arquivo excluído com sucesso!")
                    if refresh_callback:
                        refresh_callback()
                else:
                    QMessageBox.warning(dialog, "Erro", "Não foi possível excluir o arquivo.")
            except Exception as e:
                QMessageBox.critical(dialog, "Erro", f"Erro ao excluir arquivo: {str(e)}")