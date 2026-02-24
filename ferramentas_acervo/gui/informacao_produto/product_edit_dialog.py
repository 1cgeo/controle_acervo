# Path: gui\informacao_produto\product_edit_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QComboBox
from qgis.PyQt.QtCore import Qt

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'product_edit_dialog.ui'))

class ProductEditDialog(QDialog, FORM_CLASS):
    """
    Diálogo para edição de informações de um produto.
    """
    def __init__(self, api_client, produto_data, parent=None):
        """
        Inicializa o diálogo de edição de produto.
        
        Args:
            api_client: Cliente da API para realizar requisições
            produto_data (dict): Dados atuais do produto
            parent: Widget pai
        """
        super(ProductEditDialog, self).__init__(parent)
        self.setupUi(self)
        self.api_client = api_client
        self.produto_data = produto_data
        
        # Carregar valores em comboboxes
        self.load_combos()
        
        # Preencher campos com dados atuais
        self.populate_fields()
        
        # Conectar sinais
        self.buttonBox.accepted.connect(self.save_product)
        self.buttonBox.rejected.connect(self.reject)
        self.tipoEscalaComboBox.currentIndexChanged.connect(self.toggle_denominador_field)
        
    def load_combos(self):
        """Carrega os dados nas caixas de combinação (combos)."""
        try:
            # Carregar tipos de escala
            escala_response = self.api_client.get('gerencia/dominio/tipo_escala')
            if escala_response and 'dados' in escala_response:
                self.tipoEscalaComboBox.clear()
                for escala in escala_response['dados']:
                    self.tipoEscalaComboBox.addItem(escala['nome'], escala['code'])
            
            # Carregar tipos de produto
            produto_response = self.api_client.get('gerencia/dominio/tipo_produto')
            if produto_response and 'dados' in produto_response:
                self.tipoProdutoComboBox.clear()
                for produto in produto_response['dados']:
                    self.tipoProdutoComboBox.addItem(produto['nome'], produto['code'])
                    
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao carregar dados: {str(e)}")
        
    def populate_fields(self):
        """Preenche os campos do formulário com os dados do produto."""
        if not self.produto_data:
            return
            
        self.idLineEdit.setText(str(self.produto_data.get('id', '')))
        self.nomeLineEdit.setText(self.produto_data.get('nome', ''))
        self.miLineEdit.setText(self.produto_data.get('mi', ''))
        self.inomLineEdit.setText(self.produto_data.get('inom', ''))
        
        # Definir tipo de escala
        tipo_escala_id = self.produto_data.get('tipo_escala_id')
        index = self.tipoEscalaComboBox.findData(tipo_escala_id)
        if index >= 0:
            self.tipoEscalaComboBox.setCurrentIndex(index)
            
        # Definir denominador escala especial
        denominador = self.produto_data.get('denominador_escala_especial')
        if denominador:
            self.denominadorSpinBox.setValue(denominador)
            
        # Definir tipo de produto
        tipo_produto_id = self.produto_data.get('tipo_produto_id')
        index = self.tipoProdutoComboBox.findData(tipo_produto_id)
        if index >= 0:
            self.tipoProdutoComboBox.setCurrentIndex(index)
            
        # Descrição
        self.descricaoTextEdit.setPlainText(self.produto_data.get('descricao', ''))
        
        # Atualizar visibilidade do campo de denominador
        self.toggle_denominador_field()
        
    def toggle_denominador_field(self):
        """Ativa/desativa o campo de denominador baseado na escala selecionada."""
        # Escala personalizada (valor 5) requer denominador
        escala_id = self.tipoEscalaComboBox.currentData()
        is_custom_scale = escala_id == 5
        
        self.denominadorLabel.setVisible(is_custom_scale)
        self.denominadorSpinBox.setVisible(is_custom_scale)
        self.denominadorSpinBox.setEnabled(is_custom_scale)
        
        if not is_custom_scale:
            self.denominadorSpinBox.setValue(0)
            
    def validate_inputs(self):
        """Valida os campos do formulário."""
        if not self.nomeLineEdit.text().strip():
            QMessageBox.warning(self, "Validação", "O nome do produto é obrigatório.")
            return False
            
        escala_id = self.tipoEscalaComboBox.currentData()
        is_custom_scale = escala_id == 5
        
        if is_custom_scale and self.denominadorSpinBox.value() <= 0:
            QMessageBox.warning(self, "Validação", "Para escala personalizada, o denominador é obrigatório.")
            return False
            
        return True
        
    def save_product(self):
        """Salva as alterações no produto."""
        if not self.validate_inputs():
            return
            
        try:
            # Preparar dados
            produto = {
                'id': int(self.idLineEdit.text()),
                'nome': self.nomeLineEdit.text(),
                'mi': self.miLineEdit.text(),
                'inom': self.inomLineEdit.text(),
                'tipo_escala_id': self.tipoEscalaComboBox.currentData(),
                'denominador_escala_especial': self.denominadorSpinBox.value() if self.tipoEscalaComboBox.currentData() == 5 else None,
                'tipo_produto_id': self.tipoProdutoComboBox.currentData(),
                'descricao': self.descricaoTextEdit.toPlainText()
            }
            
            # Enviar para API
            response = self.api_client.put('produtos/produto', produto)
            
            if response:
                QMessageBox.information(self, "Sucesso", "Produto atualizado com sucesso!")
                self.accept()
            else:
                QMessageBox.warning(self, "Erro", "Não foi possível atualizar o produto.")
                
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao salvar produto: {str(e)}")