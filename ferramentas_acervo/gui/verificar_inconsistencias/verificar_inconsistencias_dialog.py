# Path: gui\verificar_inconsistencias\verificar_inconsistencias_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QApplication
from qgis.PyQt.QtCore import Qt
from qgis.core import Qgis

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'verificar_inconsistencias_dialog.ui'))

# A verificação lê e calcula o checksum de todo o acervo no servidor —
# pode levar muito tempo em acervos grandes
VERIFICACAO_TIMEOUT = 3600


class VerificarInconsistenciasDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(VerificarInconsistenciasDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client

        self.executarVerificacaoButton.clicked.connect(self.executar_verificacao)

        # O endpoint retorna contadores ({arquivos_atualizados,
        # arquivos_deletados_atualizados}), não a lista de arquivos — a tabela
        # e o CSV não se aplicam; os detalhes ficam em "Gerenciar Arquivos
        # Incorretos"
        self.resultadosTable.setVisible(False)
        self.baixarCSVButton.setVisible(False)

    def executar_verificacao(self):
        try:
            self.executarVerificacaoButton.setEnabled(False)
            self.setCursor(Qt.CursorShape.WaitCursor)

            # Define a expectativa antes da chamada bloqueante (que roda na
            # thread da UI): processEvents força a mensagem a pintar antes
            self.iface.messageBar().pushMessage(
                "Verificação em andamento",
                "Calculando os checksums do acervo. Isto pode levar vários minutos "
                "e o QGIS pode ficar sem resposta durante o processo.",
                level=Qgis.MessageLevel.Info
            )
            QApplication.processEvents()

            response = self.api_client.post(
                'gerencia/verificar_inconsistencias',
                timeout=VERIFICACAO_TIMEOUT
            )

            if response and isinstance(response.get('dados'), dict):
                dados = response['dados']
                arquivos = int(dados.get('arquivos_atualizados') or 0)
                deletados = int(dados.get('arquivos_deletados_atualizados') or 0)

                if arquivos or deletados:
                    QMessageBox.information(
                        self, "Resultado",
                        "Verificação concluída.\n\n"
                        f"Arquivos marcados com erro de carregamento: {arquivos}\n"
                        f"Arquivos deletados marcados com erro de exclusão: {deletados}\n\n"
                        "Use o diálogo 'Gerenciar Arquivos com Problemas' para ver os detalhes."
                    )
                else:
                    QMessageBox.information(self, "Resultado", "Não foram encontradas inconsistências.")
            elif response is not None:
                QMessageBox.warning(self, "Aviso", "A verificação foi concluída, mas não retornou dados.")
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Ocorreu um erro ao executar a verificação: {str(e)}")
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)
            self.executarVerificacaoButton.setEnabled(True)
