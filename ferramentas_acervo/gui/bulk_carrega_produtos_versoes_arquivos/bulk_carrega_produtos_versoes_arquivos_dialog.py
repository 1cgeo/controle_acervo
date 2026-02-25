# Path: gui\bulk_carrega_produtos_versoes_arquivos\bulk_carrega_produtos_versoes_arquivos_dialog.py
import os
import json
import hashlib
import datetime
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QProgressBar, QVBoxLayout
from qgis.PyQt.QtCore import Qt, QThread, pyqtSignal, QDate
from qgis.core import QgsProject, QgsVectorLayer, QgsWkbTypes, Qgis, NULL
from ...core.file_transfer import FileTransferThread

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'bulk_carrega_produtos_versoes_arquivos_dialog.ui'))

def null_to_none(value):
    return None if value == NULL else value

class LoadProductsDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(LoadProductsDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.transfer_threads = []
        self.setup_ui()

    def setup_ui(self):
        self.setWindowTitle("Adicionar Produtos Completos")

        # Configurar o combobox para selecionar a camada
        self.layerComboBox.clear()
        layers = QgsProject.instance().mapLayers().values()
        valid_layers = []
        for layer in layers:
            if isinstance(layer, QgsVectorLayer) and layer.geometryType() == QgsWkbTypes.NullGeometry:
                valid_layers.append(layer)
                self.layerComboBox.addItem(layer.name(), layer)

        # Se não houver camadas válidas, desabilitar o combobox e o botão de carregar
        if not valid_layers:
            self.layerComboBox.setEnabled(False)
            self.loadButton.setEnabled(False)
            self.statusLabel.setText("Nenhuma camada tabular encontrada no projeto.")

        self.progressBar = QProgressBar(self)
        self.progressBar.setVisible(False)
        self.verticalLayout.addWidget(self.progressBar)

        # Conectar sinais
        self.loadButton.clicked.connect(self.initiate_load_process)
        self.createModelLayerButton.clicked.connect(self.create_model_layer)

    def initiate_load_process(self):
        """Inicia o processo de carregamento de produtos completos"""
        layer = self.layerComboBox.currentData()
        if not layer:
            QMessageBox.warning(self, "Aviso", "Selecione uma camada válida.")
            return

        is_valid, error_message = self.validate_layer_structure(layer)
        if not is_valid:
            QMessageBox.critical(self, "Erro de Estrutura", f"A camada não possui a estrutura correta. {error_message}")
            return

        # Preparar os dados para envio
        prepared_data = self.prepare_data_from_layer(layer)
        if not prepared_data or not prepared_data['produtos']:
            QMessageBox.warning(self, "Aviso", "Nenhum produto válido para carregar.")
            return

        # Iniciar o processo de upload de duas fases
        try:
            self.statusLabel.setText("Enviando dados para o servidor...")
            self.setCursor(Qt.WaitCursor)
            
            # Fase 1: Preparar o upload
            response = self.api_client.post('arquivo/prepare-upload/product', prepared_data)
            self.process_prepare_response(response)
            
        except Exception as e:
            self.setCursor(Qt.ArrowCursor)
            QMessageBox.critical(self, "Erro", f"Erro ao iniciar o processo de carregamento: {str(e)}")
            self.statusLabel.setText(f"Erro: {str(e)}")

    def validate_layer_structure(self, layer):
        """Valida se a camada tem a estrutura necessária para o upload"""
        required_fields = [
            'produto_grupo_id', 'produto_nome', 'tipo_escala_id', 
            'tipo_produto_id', 'geom', 'versao_grupo_id', 'versao', 'nome_versao', 
            'tipo_versao_id', 'subtipo_produto_id', 'orgao_produtor',
            'data_criacao', 'data_edicao', 'nome', 'nome_arquivo', 
            'tipo_arquivo_id', 'path', 'situacao_carregamento_id'
        ]
        
        field_names = [field.name() for field in layer.fields()]
        
        # Verificar campos obrigatórios
        missing_fields = [field for field in required_fields if field not in field_names]
        if missing_fields:
            return False, f"Campos obrigatórios ausentes: {', '.join(missing_fields)}"
        
        return True, ""

    def prepare_data_from_layer(self, layer):
        """Prepara os dados da camada para o formato esperado pela API"""
        field_names = [field.name() for field in layer.fields()]
        
        # Dictionary para agrupar dados por produto, versão e arquivo
        produtos_por_grupo = {}
        invalid_features = []
        
        for feature in layer.getFeatures():
            # Verificação de campos não nulos obrigatórios
            non_null_fields = [
                'produto_grupo_id', 'produto_nome', 'tipo_escala_id', 'tipo_produto_id', 'geom',
                'versao_grupo_id', 'versao', 'nome_versao', 'tipo_versao_id', 'subtipo_produto_id', 
                'orgao_produtor', 'data_criacao', 'data_edicao', 'nome', 'nome_arquivo', 
                'tipo_arquivo_id', 'path', 'situacao_carregamento_id'
            ]
            null_fields = [field for field in non_null_fields if feature[field] == NULL]
            
            if null_fields:
                invalid_features.append((feature.id(), f"Campos não podem ser nulos: {', '.join(null_fields)}"))
                continue
            
            # Verificar tipo de arquivo 9 (Tileserver) - regras especiais
            tipo_arquivo_id = feature['tipo_arquivo_id']
            extensao = null_to_none(feature['extensao'])
            
            if tipo_arquivo_id != 9 and not extensao:
                invalid_features.append((feature.id(), "Extensão é obrigatória para este tipo de arquivo"))
                continue
            
            # Verificar se o arquivo existe no caminho especificado
            file_path = feature['path']
            if tipo_arquivo_id != 9 and not os.path.exists(file_path):
                invalid_features.append((feature.id(), f"Arquivo não encontrado: {file_path}"))
                continue
            
            # Calcular checksum (exceto para tipo 9)
            checksum = None
            tamanho_mb = None
            
            if tipo_arquivo_id != 9:
                try:
                    checksum = self.calculate_checksum(file_path)
                    tamanho_mb = os.path.getsize(file_path) / (1024 * 1024)
                except Exception as e:
                    invalid_features.append((feature.id(), f"Erro ao acessar arquivo: {str(e)}"))
                    continue
            
            # Verificar metadado JSON (se existir)
            metadado = null_to_none(feature['metadado'])
            if metadado:
                try:
                    if isinstance(metadado, str):
                        metadado = json.loads(metadado)
                except Exception:
                    invalid_features.append((feature.id(), "Metadado não é um JSON válido"))
                    continue
                    
            metadado_versao = null_to_none(feature['metadado_versao']) if 'metadado_versao' in field_names else None
            if metadado_versao:
                try:
                    if isinstance(metadado_versao, str):
                        metadado_versao = json.loads(metadado_versao)
                except Exception:
                    invalid_features.append((feature.id(), "Metadado da versão não é um JSON válido"))
                    continue
            
            # Formatar palavras-chave
            palavras_chave = []
            if null_to_none(feature['palavras_chave']):
                palavras_chave = [palavra.strip() for palavra in feature['palavras_chave'].split(',')]
            
            # Formatar datas para ISO
            try:
                data_criacao = self.format_date_to_iso(feature['data_criacao'])
                data_edicao = self.format_date_to_iso(feature['data_edicao'])
            except Exception as e:
                invalid_features.append((feature.id(), f"Formato de data inválido: {str(e)}"))
                continue
            
            # Chaves para agrupar dados
            produto_grupo_id = feature['produto_grupo_id']
            versao_grupo_id = feature['versao_grupo_id']
            produto_key = str(produto_grupo_id)
            versao_key = f"{produto_grupo_id}_{versao_grupo_id}"
            
            # Criar objeto de arquivo para API
            arquivo = {
                "uuid_arquivo": null_to_none(feature['uuid_arquivo']) if 'uuid_arquivo' in field_names else None,
                "nome": feature['nome'],
                "nome_arquivo": feature['nome_arquivo'],
                "tipo_arquivo_id": tipo_arquivo_id,
                "extensao": extensao,
                "tamanho_mb": tamanho_mb,
                "checksum": checksum,
                "metadado": metadado or {},
                "situacao_carregamento_id": feature['situacao_carregamento_id'],
                "descricao": null_to_none(feature['descricao_arquivo']) if 'descricao_arquivo' in field_names else "",
                "crs_original": null_to_none(feature['crs_original']) if 'crs_original' in field_names else ""
            }
            
            # Garantir que a geometria tenha o prefixo SRID
            geom_text = feature['geom']
            geom_ewkt = geom_text if geom_text.startswith('SRID=') else f"SRID=4674;{geom_text}"

            # Adicionar produto se ainda não existe no dicionário
            if produto_key not in produtos_por_grupo:
                produtos_por_grupo[produto_key] = {
                    "produto": {
                        "nome": feature['produto_nome'],
                        "mi": null_to_none(feature['mi']) or None,
                        "inom": null_to_none(feature['inom']) or None,
                        "tipo_escala_id": feature['tipo_escala_id'],
                        "denominador_escala_especial": null_to_none(feature['denominador_escala_especial']),
                        "tipo_produto_id": feature['tipo_produto_id'],
                        "descricao": null_to_none(feature['descricao_produto']) if 'descricao_produto' in field_names else None,
                        "geom": geom_ewkt
                    },
                    "versoes": {}
                }
            
            # Adicionar versão se ainda não existe no dicionário do produto
            if versao_key not in produtos_por_grupo[produto_key]["versoes"]:
                produtos_por_grupo[produto_key]["versoes"][versao_key] = {
                    "uuid_versao": null_to_none(feature['uuid_versao']) if 'uuid_versao' in field_names else None,
                    "versao": feature['versao'],
                    "nome": feature['nome_versao'],
                    "tipo_versao_id": feature['tipo_versao_id'],
                    "subtipo_produto_id": feature['subtipo_produto_id'],
                    "lote_id": null_to_none(feature['lote_id']),
                    "metadado": metadado_versao or {},
                    "descricao": null_to_none(feature['descricao_versao']) if 'descricao_versao' in field_names else "",
                    "orgao_produtor": feature['orgao_produtor'],
                    "palavras_chave": palavras_chave,
                    "data_criacao": data_criacao,
                    "data_edicao": data_edicao,
                    "arquivos": []
                }
            
            # Adicionar arquivo à versão
            produtos_por_grupo[produto_key]["versoes"][versao_key]["arquivos"].append(arquivo)
        
        # Informar sobre features inválidas
        if invalid_features:
            error_msg = "As seguintes features têm problemas:\n"
            for id, reason in invalid_features:
                error_msg += f"ID {id}: {reason}\n"
            QMessageBox.warning(self, "Problemas encontrados", error_msg)
        
        # Converter para o formato esperado pela API
        produtos = []
        for produto_key, produto_data in produtos_por_grupo.items():
            # Converter o dicionário de versões para lista
            versoes = list(produto_data["versoes"].values())
            
            # Remover versões sem arquivos
            versoes_com_arquivos = [v for v in versoes if v["arquivos"]]
            if len(versoes_com_arquivos) < len(versoes):
                QMessageBox.warning(self, "Aviso", f"Foram ignoradas versões sem arquivos para o produto {produto_data['produto']['nome']}.")
            
            if not versoes_com_arquivos:
                continue  # Ignorar produtos sem versões válidas
            
            produtos.append({
                "produto": produto_data["produto"],
                "versoes": versoes_com_arquivos
            })
        
        return {"produtos": produtos}

    def format_date_to_iso(self, date_value):
        """Converte uma data em formato QDate ou string para ISO 8601"""
        if isinstance(date_value, QDate):
            return date_value.toString(Qt.ISODate)
        elif isinstance(date_value, datetime.date):
            return date_value.isoformat()
        elif isinstance(date_value, str):
            # Tentar interpretar a string como data
            try:
                return QDate.fromString(date_value, Qt.ISODate).toString(Qt.ISODate)
            except:
                # Formato diferente, tentando outros padrões comuns
                try:
                    date_obj = datetime.datetime.strptime(date_value, "%d/%m/%Y")
                    return date_obj.isoformat().split('T')[0]
                except:
                    raise ValueError(f"Formato de data não reconhecido: {date_value}")
        else:
            raise ValueError(f"Tipo de data não suportado: {type(date_value)}")

    def calculate_checksum(self, file_path):
        """Calcula o checksum SHA-256 de um arquivo"""
        sha256_hash = hashlib.sha256()
        with open(file_path, "rb") as f:
            for byte_block in iter(lambda: f.read(4096), b""):
                sha256_hash.update(byte_block)
        return sha256_hash.hexdigest()

    def process_prepare_response(self, response):
        """Processa a resposta da API de preparação e inicia a transferência de arquivos"""
        if not response or 'dados' not in response:
            self.setCursor(Qt.ArrowCursor)
            QMessageBox.critical(self, "Erro", "Resposta inválida do servidor")
            return
        
        session_data = response['dados']
        session_uuid = session_data.get('session_uuid')
        produtos = session_data.get('produtos', [])
        
        if not session_uuid or not produtos:
            self.setCursor(Qt.ArrowCursor)
            QMessageBox.critical(self, "Erro", "Dados incompletos na resposta do servidor")
            return
        
        # Extrair todos os arquivos para transferência de todos os produtos e versões
        transfer_files = []
        for produto in produtos:
            for versao in produto.get('versoes', []):
                transfer_files.extend(versao.get('arquivos', []))
        
        # Configurar barra de progresso
        self.progressBar.setVisible(True)
        self.progressBar.setRange(0, len(transfer_files))
        self.progressBar.setValue(0)
        
        # Iniciar a transferência de arquivos
        self.statusLabel.setText(f"Transferindo {len(transfer_files)} arquivos...")
        self.transfer_files(session_uuid, transfer_files)

    def transfer_files(self, session_uuid, files_info):
        """Inicia a transferência dos arquivos"""
        self.transfer_threads = []
        self.arquivos_transferidos = 0
        self.arquivos_com_falha = 0
        self.failed_transfers = []
        self.current_session_uuid = session_uuid

        layer = self.layerComboBox.currentData()
        field_names = [field.name() for field in layer.fields()]
        files_map = {}
        
        # Primeiro, criar um mapa de nomes de arquivos para caminhos de origem
        for feature in layer.getFeatures():
            nome_arquivo = feature['nome_arquivo']
            nome = feature['nome']
            path = feature['path']
            files_map[nome_arquivo] = path
            files_map[nome] = path  # Usar também o nome como chave alternativa
        
        for file_info in files_info:
            # Obter caminho de origem do mapa
            source_path = None
            destination_path = file_info.get('destination_path')
            nome_arquivo = file_info.get('nome_arquivo', '')
            nome = file_info.get('nome', '')
            
            if nome_arquivo in files_map:
                source_path = files_map[nome_arquivo]
            elif nome in files_map:
                source_path = files_map[nome]
            
            if not source_path or (file_info.get('tipo_arquivo_id') != 9 and not os.path.exists(source_path)):
                self.statusLabel.setText(f"Erro: Não foi possível encontrar o arquivo de origem para {nome_arquivo or nome}")
                continue
            
            # Iniciar thread de transferência
            thread = FileTransferThread(
                source_path, 
                destination_path,
                file_info.get('checksum')
            )
            thread.progress_update.connect(self.update_file_progress)
            thread.file_transferred.connect(self.file_transfer_complete)
            self.transfer_threads.append(thread)
            thread.start()

    def update_file_progress(self, current, total):
        """Atualiza o progresso da transferência de um arquivo individual"""
        if total > 0:
            current_mb = current / (1024 * 1024)
            total_mb = total / (1024 * 1024)
            idx = self.arquivos_transferidos + 1
            total_files = self.progressBar.maximum()
            self.statusLabel.setText(
                f"Transferindo arquivo {idx}/{total_files} - {current_mb:.1f} / {total_mb:.1f} MB"
            )

    def file_transfer_complete(self, success, file_path, checksum):
        """Manipula a conclusão da transferência de um arquivo"""
        self.arquivos_transferidos += 1
        if not success:
            self.arquivos_com_falha += 1
            for thread in self.transfer_threads:
                if thread.destination_path == file_path:
                    self.failed_transfers.append({
                        'source_path': thread.source_path,
                        'destination_path': thread.destination_path,
                        'identifier': thread.identifier
                    })
                    break
            self.statusLabel.setText(f"Erro na transferência de {os.path.basename(file_path)}")
        self.progressBar.setValue(self.arquivos_transferidos)

        # Se todos os arquivos foram transferidos, verificar sucesso antes de confirmar
        if self.arquivos_transferidos == len(self.transfer_threads):
            if self.arquivos_com_falha > 0:
                reply = QMessageBox.question(
                    self, "Falha na Transferência",
                    f"{self.arquivos_com_falha} arquivo(s) falharam na transferência.\n"
                    "Deseja tentar novamente apenas os arquivos que falharam?",
                    QMessageBox.Yes | QMessageBox.No
                )
                if reply == QMessageBox.Yes:
                    self._retry_failed_transfers()
                else:
                    self.statusLabel.setText(f"Erro: {self.arquivos_com_falha} arquivo(s) falharam")
                    self.setCursor(Qt.ArrowCursor)
                    self.loadButton.setEnabled(True)
            else:
                self.statusLabel.setText("Todos os arquivos transferidos. Confirmando upload...")
                self.confirm_upload()

    def _retry_failed_transfers(self):
        """Retenta apenas os arquivos que falharam na transferência."""
        failed = self.failed_transfers[:]
        self.failed_transfers = []
        self.transfer_threads = []
        self.arquivos_transferidos = 0
        self.arquivos_com_falha = 0

        self.progressBar.setMaximum(len(failed))
        self.progressBar.setValue(0)
        self.statusLabel.setText(f"Retentando {len(failed)} arquivo(s)...")

        for info in failed:
            thread = FileTransferThread(
                info['source_path'],
                info['destination_path'],
                info['identifier']
            )
            thread.progress_update.connect(self.update_file_progress)
            thread.file_transferred.connect(self.file_transfer_complete)
            self.transfer_threads.append(thread)
            thread.start()

    def confirm_upload(self):
        """Confirma o upload após a transferência de todos os arquivos"""
        try:
            # Fase 2: Confirmar o upload
            response = self.api_client.post('arquivo/confirm-upload', {'session_uuid': self.current_session_uuid})
            
            if response and response.get('success'):
                self.statusLabel.setText("Upload concluído com sucesso!")
                self.setCursor(Qt.ArrowCursor)
                QMessageBox.information(self, "Sucesso", "Todos os produtos, versões e arquivos foram carregados com sucesso.")
                self.progressBar.setVisible(False)
            else:
                error_message = "Falha na confirmação do upload"
                if response and 'message' in response:
                    error_message = response['message']
                
                self.statusLabel.setText(f"Erro: {error_message}")
                self.setCursor(Qt.ArrowCursor)
                QMessageBox.critical(self, "Erro", f"Falha na confirmação do upload: {error_message}")
        except Exception as e:
            self.statusLabel.setText(f"Erro na confirmação: {str(e)}")
            self.setCursor(Qt.ArrowCursor)
            QMessageBox.critical(self, "Erro", f"Erro ao confirmar upload: {str(e)}")

    def create_model_layer(self):
        """Cria uma camada modelo com a estrutura necessária para upload de produtos completos"""
        layer_name = "Modelo de Produtos Completos"
        
        # Definir a estrutura da camada (sem geometria)
        uri = ("NoGeometry?crs=EPSG:4326"
               "&field=produto_grupo_id:integer"
               "&field=produto_nome:string"
               "&field=mi:string"
               "&field=inom:string"
               "&field=tipo_escala_id:integer"
               "&field=denominador_escala_especial:integer"
               "&field=tipo_produto_id:integer"
               "&field=descricao_produto:string"
               "&field=geom:string"
               "&field=versao_grupo_id:integer"
               "&field=versao:string"
               "&field=nome_versao:string"
               "&field=tipo_versao_id:integer"
               "&field=subtipo_produto_id:integer"
               "&field=lote_id:integer"
               "&field=descricao_versao:string"
               "&field=orgao_produtor:string"
               "&field=palavras_chave:string"
               "&field=data_criacao:date"
               "&field=data_edicao:date"
               "&field=metadado_versao:string"
               "&field=nome:string"
               "&field=nome_arquivo:string"
               "&field=tipo_arquivo_id:integer"
               "&field=extensao:string"
               "&field=path:string"
               "&field=situacao_carregamento_id:integer"
               "&field=descricao_arquivo:string"
               "&field=metadado:string"
               "&field=crs_original:string")
        
        # Criar a camada
        layer = QgsVectorLayer(uri, layer_name, "memory")
        
        if not layer.isValid():
            QMessageBox.critical(self, "Erro", "Não foi possível criar a camada modelo.")
            return

        # Adicionar a camada ao projeto
        QgsProject.instance().addMapLayer(layer)
        
        # Selecionar a camada recém-criada no combobox
        self.layerComboBox.clear()
        self.layerComboBox.addItem(layer_name, layer)
        
        # Habilitar botões
        self.layerComboBox.setEnabled(True)
        self.loadButton.setEnabled(True)
        
        # Mensagem de sucesso
        self.iface.messageBar().pushMessage(
            "Sucesso", 
            "Camada modelo criada com sucesso. Agora você deve adicionar registros a esta camada.",
            level=Qgis.Success
        )
        
        # Instruções detalhadas
        QMessageBox.information(
            self,
            "Camada Modelo Criada",
            "Uma nova camada modelo foi criada com a estrutura necessária.\n\n"
            "Instruções de preenchimento:\n\n"
            "1. Para cada produto, atribua um identificador único no campo 'produto_grupo_id'\n"
            "2. Para cada versão, atribua um identificador único no campo 'versao_grupo_id'\n"
            "3. Todos os registros de um mesmo produto devem ter o mesmo 'produto_grupo_id'\n"
            "4. Todos os arquivos de uma mesma versão devem ter o mesmo 'versao_grupo_id'\n"
            "5. Preencha os dados do produto (mesmos valores para todas as versões do mesmo produto)\n"
            "6. Preencha os dados da versão (mesmos valores para arquivos do mesmo grupo)\n"
            "7. Preencha os dados específicos de cada arquivo\n"
            "8. O campo 'geom' deve conter a geometria em formato WKT (ex: POLYGON((...)))\n"
            "9. Datas devem estar no formato ISO (aaaa-mm-dd)\n"
            "10. O campo 'palavras_chave' deve conter valores separados por vírgula\n"
            "11. Os campos 'metadado' e 'metadado_versao' devem conter JSON válido\n\n"
            "Organize seus dados de forma hierárquica: Produto > Versão > Arquivo"
        )