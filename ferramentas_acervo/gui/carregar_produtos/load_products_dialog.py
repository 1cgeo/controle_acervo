# Path: gui\carregar_produtos\load_products_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QCheckBox, QPushButton, QMessageBox, QLabel,
    QGroupBox, QGridLayout, QTableWidget, QTableWidgetItem, QHeaderView
)
from qgis.PyQt.QtCore import Qt
from qgis.core import QgsVectorLayer, QgsProject, QgsDataSourceUri

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'load_product_layers_dialog.ui'))

class LoadProductLayersDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(LoadProductLayersDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.layers = []
        
        # Keep track of UI elements
        self.product_type_checkboxes = {}
        self.scale_type_checkboxes = {}
        self.layer_checkboxes = {}

        self.setup_ui()
        self.load_layers()

    def setup_ui(self):
        self.setWindowTitle("Carregar Camadas de Produtos")
        
        # Clear existing layout in scrollAreaWidgetContents
        if self.scrollAreaWidgetContents.layout():
            while self.scrollAreaWidgetContents.layout().count():
                item = self.scrollAreaWidgetContents.layout().takeAt(0)
                if item.widget():
                    item.widget().deleteLater()
        else:
            self.mainLayout = QVBoxLayout(self.scrollAreaWidgetContents)
        
        # Product types group
        self.productTypesGroup = QGroupBox("Tipos de Produto")
        self.productTypesLayout = QGridLayout()
        self.productTypesGroup.setLayout(self.productTypesLayout)
        self.mainLayout.addWidget(self.productTypesGroup)
        
        # Scale types group
        self.scaleTypesGroup = QGroupBox("Tipos de Escala")
        self.scaleTypesLayout = QGridLayout()
        self.scaleTypesGroup.setLayout(self.scaleTypesLayout)
        self.mainLayout.addWidget(self.scaleTypesGroup)
        
        # Available layers group
        self.availableLayersGroup = QGroupBox("Camadas Disponíveis")
        self.availableLayersLayout = QVBoxLayout()
        self.availableLayersGroup.setLayout(self.availableLayersLayout)
        self.mainLayout.addWidget(self.availableLayersGroup)
        
        # Quick selection buttons
        self.selectionButtonsLayout = QHBoxLayout()
        
        self.selectAllProductsBtn = QPushButton("Selecionar Todos os Produtos")
        self.selectAllProductsBtn.clicked.connect(self.select_all_products)
        self.selectionButtonsLayout.addWidget(self.selectAllProductsBtn)
        
        self.selectAllScalesBtn = QPushButton("Selecionar Todas as Escalas")
        self.selectAllScalesBtn.clicked.connect(self.select_all_scales)
        self.selectionButtonsLayout.addWidget(self.selectAllScalesBtn)
        
        self.selectAllLayersBtn = QPushButton("Selecionar Todas as Camadas")
        self.selectAllLayersBtn.clicked.connect(self.select_all_layers)
        self.selectionButtonsLayout.addWidget(self.selectAllLayersBtn)
        
        self.mainLayout.addLayout(self.selectionButtonsLayout)
        
        # Connect filter checkboxes to update function
        self.buttonBox.accepted.connect(self.load_selected_layers)
        self.buttonBox.rejected.connect(self.reject)

        self.select_all_check.stateChanged.connect(self.toggle_select_all_products)

    def toggle_select_all_products(self, state):
        """Seleciona ou desseleciona todos os produtos disponíveis."""
        for row in range(self.productsTable.rowCount()):
            item = self.productsTable.item(row, 0)  # Coluna do checkbox
            if item:
                item.setCheckState(Qt.Checked if state else Qt.Unchecked)

    def load_layers(self):
        try:
            response = self.api_client.get('acervo/camadas_produto')
            if response and 'dados' in response:
                self.layers = [layer for layer in response['dados'] if layer['quantidade_produtos'] > 0]
                
                if not self.layers:
                    self.show_no_layers_message()
                    return
                
                # Extract unique product types and scale types with counts
                product_types = {}
                scale_types = {}
                
                for layer in self.layers:
                    product_id = layer['tipo_produto_id']
                    scale_id = layer['tipo_escala_id']
                    
                    if product_id not in product_types:
                        product_types[product_id] = {
                            'name': layer['tipo_produto'],
                            'count': layer['quantidade_produtos']
                        }
                    else:
                        product_types[product_id]['count'] += layer['quantidade_produtos']
                    
                    if scale_id not in scale_types:
                        scale_types[scale_id] = {
                            'name': layer['tipo_escala'],
                            'count': layer['quantidade_produtos']
                        }
                    else:
                        scale_types[scale_id]['count'] += layer['quantidade_produtos']
                
                # Create checkboxes for product types
                row, col = 0, 0
                max_cols = 3  # Number of columns in the grid
                
                for product_id, product_info in sorted(product_types.items()):
                    checkbox = QCheckBox(f"{product_info['name']} ({product_info['count']} produtos)")
                    checkbox.setChecked(True)  # Default to checked
                    checkbox.stateChanged.connect(self.update_available_layers)
                    self.product_type_checkboxes[product_id] = checkbox
                    
                    self.productTypesLayout.addWidget(checkbox, row, col)
                    col += 1
                    if col >= max_cols:
                        col = 0
                        row += 1
                
                # Create checkboxes for scale types
                row, col = 0, 0
                
                for scale_id, scale_info in sorted(scale_types.items()):
                    checkbox = QCheckBox(f"{scale_info['name']} ({scale_info['count']} produtos)")
                    checkbox.setChecked(True)  # Default to checked
                    checkbox.stateChanged.connect(self.update_available_layers)
                    self.scale_type_checkboxes[scale_id] = checkbox
                    
                    self.scaleTypesLayout.addWidget(checkbox, row, col)
                    col += 1
                    if col >= max_cols:
                        col = 0
                        row += 1
                
                # Update available layers
                self.update_available_layers()
            else:
                self.show_no_layers_message()
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao carregar camadas: {str(e)}")
            self.show_no_layers_message()

    def show_no_layers_message(self):
        message_label = QLabel("Não há camadas de produtos disponíveis no momento.")
        message_label.setAlignment(Qt.AlignCenter)
        self.mainLayout.addWidget(message_label)
        self.buttonBox.button(self.buttonBox.Ok).setEnabled(False)

    def update_available_layers(self):
        # Clear previous layer checkboxes
        self.layer_checkboxes.clear()
        
        # Clear the available layers layout
        while self.availableLayersLayout.count():
            item = self.availableLayersLayout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        
        # Get selected product types and scale types
        selected_product_ids = [
            product_id for product_id, checkbox in self.product_type_checkboxes.items() 
            if checkbox.isChecked()
        ]
        
        selected_scale_ids = [
            scale_id for scale_id, checkbox in self.scale_type_checkboxes.items() 
            if checkbox.isChecked()
        ]
        
        # Filter layers
        filtered_layers = [
            layer for layer in self.layers
            if layer['tipo_produto_id'] in selected_product_ids and 
               layer['tipo_escala_id'] in selected_scale_ids
        ]
        
        if not filtered_layers:
            message_label = QLabel("Nenhuma camada corresponde aos filtros selecionados.")
            message_label.setAlignment(Qt.AlignCenter)
            self.availableLayersLayout.addWidget(message_label)
            return
        
        # Create checkboxes for filtered layers
        for layer in filtered_layers:
            layer_key = f"{layer['tipo_produto_id']}_{layer['tipo_escala_id']}"
            checkbox = QCheckBox(f"{layer['tipo_produto']} - {layer['tipo_escala']} ({layer['quantidade_produtos']} produtos)")
            checkbox.setChecked(True)  # Default to checked
            self.layer_checkboxes[layer_key] = {
                'checkbox': checkbox,
                'layer': layer
            }
            self.availableLayersLayout.addWidget(checkbox)

    def select_all_products(self):
        for checkbox in self.product_type_checkboxes.values():
            checkbox.setChecked(True)
        self.update_available_layers()

    def select_all_scales(self):
        for checkbox in self.scale_type_checkboxes.values():
            checkbox.setChecked(True)
        self.update_available_layers()

    def select_all_layers(self):
        for layer_info in self.layer_checkboxes.values():
            layer_info['checkbox'].setChecked(True)

    def load_selected_layers(self):
        selected_layers = []
        
        # Get selected layers
        for layer_key, layer_info in self.layer_checkboxes.items():
            if layer_info['checkbox'].isChecked():
                selected_layers.append(layer_info['layer'])
        
        if not selected_layers:
            QMessageBox.warning(self, "Aviso", "Nenhuma camada selecionada.")
            return

        for layer in selected_layers:
            uri = QgsDataSourceUri()
            uri.setConnection(
                layer['banco_dados']['servidor'],
                str(layer['banco_dados']['porta']),
                layer['banco_dados']['nome_db'],
                layer['banco_dados']['login'],
                layer['banco_dados']['senha']
            )
            uri.setDataSource(
                'acervo',
                layer['matviewname'],
                'geom',
                "",
                'id'
            )
            uri.setSrid('4326')

            vector_layer = QgsVectorLayer(uri.uri(), f"{layer['tipo_produto']} - {layer['tipo_escala']}", "postgres")
            
            if vector_layer.isValid():
                QgsProject.instance().addMapLayer(vector_layer)
            else:
                QMessageBox.warning(self, "Erro", f"Não foi possível carregar a camada: {layer['tipo_produto']} - {layer['tipo_escala']}")

        self.accept()