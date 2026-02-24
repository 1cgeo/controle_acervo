# Path: gui\informacao_produto\relationship_edit_dialog.py
"""
Diálogo para edição de relacionamentos entre versões.
"""

import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QComboBox
from qgis.PyQt.QtCore import Qt

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'relationship_edit_dialog.ui'))

class RelationshipEditDialog(QDialog, FORM_CLASS):
    """
    Diálogo para edição de relacionamentos entre versões.
    """
    def __init__(self, api_client, relationship_data, parent=None):
        """
        Inicializa o diálogo de edição de relacionamento.
        
        Args:
            api_client: Cliente da API para realizar requisições
            relationship_data (dict): Dados atuais do relacionamento
            parent: Widget pai
        """
        super(RelationshipEditDialog, self).__init__(parent)
        self.setupUi(self)
        self.api_client = api_client
        self.relationship_data = relationship_data
        
        # Carregar valores em comboboxes
        self.load_combos()
        
        # Preencher campos com dados atuais
        self.populate_fields()
        
        # Conectar sinais
        self.buttonBox.accepted.connect(self.save_relationship)
        self.buttonBox.rejected.connect(self.reject)
        
    def load_combos(self):
        """Carrega os dados nas caixas de combinação (combos)."""
        try:
            # Carregar tipos de relacionamento
            response = self.api_client.get('gerencia/dominio/tipo_relacionamento')
            if response and 'dados' in response:
                self.tipoRelacionamentoComboBox.clear()
                for tipo in response['dados']:
                    self.tipoRelacionamentoComboBox.addItem(tipo['nome'], tipo['code'])
                    
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao carregar dados: {str(e)}")
        
    def populate_fields(self):
        """Preenche os campos do formulário com os dados do relacionamento."""
        if not self.relationship_data:
            return
            
        self.idLineEdit.setText(str(self.relationship_data.get('id', '')))
        
        # Exibir informações das versões (não são editáveis)
        self.versao1LineEdit.setText(self.relationship_data.get('source_version_name', ''))
        self.versao2LineEdit.setText(self.relationship_data.get('target_version_name', ''))
        self.produto1LineEdit.setText(self.relationship_data.get('source_product_name', ''))
        self.produto2LineEdit.setText(self.relationship_data.get('target_product_name', ''))
        
        # Selecionar tipo de relacionamento
        tipo_rel_id = self.relationship_data.get('relationship_type_id')
        index = self.tipoRelacionamentoComboBox.findData(tipo_rel_id)
        if index >= 0:
            self.tipoRelacionamentoComboBox.setCurrentIndex(index)
        
    def validate_inputs(self):
        """Valida os campos do formulário."""
        if self.tipoRelacionamentoComboBox.currentIndex() < 0:
            QMessageBox.warning(self, "Validação", "É necessário selecionar um tipo de relacionamento.")
            return False
            
        return True
        
    def save_relationship(self):
        """Salva as alterações no relacionamento."""
        if not self.validate_inputs():
            return
            
        try:
            # Preparar dados
            relationship = {
                'id': int(self.idLineEdit.text()),
                'versao_id_1': self.relationship_data['source_version_id'],
                'versao_id_2': self.relationship_data['target_version_id'],
                'tipo_relacionamento_id': self.tipoRelacionamentoComboBox.currentData()
            }
            
            # Enviar para API
            response = self.api_client.put('produtos/versao_relacionamento', {
                'versao_relacionamento': [relationship]
            })
            
            if response:
                QMessageBox.information(self, "Sucesso", "Relacionamento atualizado com sucesso!")
                self.accept()
            else:
                QMessageBox.warning(self, "Erro", "Não foi possível atualizar o relacionamento.")
                
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao salvar relacionamento: {str(e)}")