# Path: core\upload_flow.py
"""A máquina de upload em duas fases, num lugar só.

O SERVIDOR faz o upload em duas fases: `prepare-upload/*` reserva a sessão e
devolve, para cada arquivo, o `destination_path` no volume; o cliente copia os
bytes; `confirm-upload` fecha a transação. Seis diálogos do plugin faziam esse
mesmo bailado, cada um com a sua cópia -- e a medição de 2026-08-01 mostrou
`file_transfer_complete`, `calculate_checksum` e `_retry_failed_transfers`
IDÊNTICOS (similaridade 1,00) nos três diálogos de lote, com `confirm_upload`,
`setup_ui` e `initiate_load_process` acima de 0,97.

Não era só repetição: as cópias já tinham DIVERGIDO, e nos dois pontos que mais
custam.

  1. `FileTransferThread.ensure_smb_credentials()` era chamado em UM lugar, o
     gerente de download. Nenhum caminho de upload o chamava, então no Linux
     todo upload morria em "Credenciais de rede (SMB) não disponíveis" -- a
     thread de trabalho não pode abrir o diálogo de senha, e ninguém o abria
     antes. Aqui ele é chamado uma vez, na thread principal, antes de qualquer
     transferência.

  2. `arquivo/cancel-upload` era chamado por dois dos seis diálogos. Os outros
     quatro abandonavam a sessão no servidor quando a cópia falhava e a pessoa
     desistia. É por isso que "Gerenciar Sessões de Upload" vivia cheia de
     sessão pendurada. Aqui, desistir CANCELA.

O que muda de um diálogo para outro é só a FORMA da resposta do prepare (lista
plana de arquivos, ou aninhada em produtos/versões) e como se acha o arquivo
local correspondente. As duas coisas entram como funções.
"""
import hashlib
import logging
import os
import uuid

from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtWidgets import QMessageBox

from .file_transfer import FileTransferThread
from .dominios import eh_tileserver


def calcular_checksum(caminho, bloco=1024 * 1024):
    """SHA-256 de um arquivo.

    Blocos de 1 MB, e não de 4 KB como estava nas cópias: num arquivo de 8 GB a
    diferença é entre duzentas mil e oito mil idas ao disco, e o hash é o que
    faz a tela parecer travada antes de a transferência começar.
    """
    h = hashlib.sha256()
    with open(caminho, 'rb') as f:
        for pedaco in iter(lambda: f.read(bloco), b''):
            h.update(pedaco)
    return h.hexdigest()


def tamanho_mb(caminho):
    return os.path.getsize(caminho) / (1024 * 1024)


def marcar_e_medir(arquivo, caminho):
    """Põe no arquivo o `uuid_arquivo`, o checksum e o tamanho. Devolve o uuid.

    O UUID é gerado pelo CLIENTE, e é isso que permite reencontrar o arquivo
    local quando o servidor devolve a lista do prepare. As respostas de
    `prepare-upload/version` e `prepare-upload/product` NÃO trazem `versao_id`
    nas entradas de arquivo (só a de `/files` traz), e casar por `nome_arquivo`
    é ambíguo: duas versões do mesmo produto costumam ter arquivos de mesmo
    nome, e a troca mandaria o byte de uma para o destino da outra sem erro
    nenhum, porque os dois caminhos existem.
    """
    identificador = str(uuid.uuid4())
    arquivo['uuid_arquivo'] = identificador
    arquivo['checksum'] = calcular_checksum(caminho)
    arquivo['tamanho_mb'] = tamanho_mb(caminho)
    return identificador


def achatar_arquivos(dados):
    """Extrai a lista de arquivos de uma resposta de prepare, seja qual for o
    aninhamento.

    As três rotas devolvem a mesma coisa em profundidades diferentes:
    `prepare-upload/files` traz `arquivos` na raiz, `prepare-upload/version`
    traz `versoes[].arquivos[]`, e `prepare-upload/product` traz
    `produtos[].versoes[].arquivos[]`. Descer sozinho é o que permite um
    chamador só, em vez de três leitores quase iguais que divergem quando a
    resposta ganha um nível.
    """
    if not dados:
        return []

    arquivos = list(dados.get('arquivos') or [])

    for versao in (dados.get('versoes') or []):
        arquivos.extend(versao.get('arquivos') or [])

    for produto in (dados.get('produtos') or []):
        for versao in (produto.get('versoes') or []):
            arquivos.extend(versao.get('arquivos') or [])

    return arquivos


class UploadFlowMixin:
    """Prepare -> copiar -> confirm, com retentativa e cancelamento.

    O diálogo que usa isto precisa ter `self.api_client` e implementar
    `upload_origem_de(arquivo_info)`. Os widgets de status e progresso são
    opcionais: sem eles a máquina roda calada, o que é o que os testes querem.
    """

    # --- o diálogo pode sobrescrever ---------------------------------------

    def upload_origem_de(self, arquivo_info):
        """Caminho local do arquivo que corresponde a esta entrada do servidor.

        Devolver None significa "não achei", e a máquina para ANTES de copiar
        qualquer byte, em vez de subir metade do lote.
        """
        raise NotImplementedError

    def upload_concluido(self, mensagem):
        """Gancho para o diálogo reagir ao fim bem-sucedido."""

    # --- estado -------------------------------------------------------------

    def _upload_zerar(self):
        self.transfer_threads = []
        self.failed_transfers = []
        self.arquivos_transferidos = 0
        self.arquivos_com_falha = 0
        self._fila = []
        self._total_a_copiar = 0

    # --- interface (tolerante à ausência dos widgets) -----------------------

    def _status(self, texto):
        rotulo = getattr(self, 'statusLabel', None)
        if rotulo is not None:
            rotulo.setText(texto)

    def _barra(self):
        return getattr(self, 'progressBar', None)

    def _ocupado(self, ocupado):
        self.setCursor(Qt.CursorShape.WaitCursor if ocupado else Qt.CursorShape.ArrowCursor)
        for nome in ('loadButton', 'saveButton', 'uploadButton'):
            botao = getattr(self, nome, None)
            if botao is not None:
                botao.setEnabled(not ocupado)

    # --- fase 1 -------------------------------------------------------------

    def executar_upload(self, endpoint, payload):
        """Roda o fluxo inteiro. Devolve False se nem chegou a começar."""
        self.current_session_uuid = None
        self._upload_zerar()

        # A senha de rede é pedida AQUI, na thread principal e antes de existir
        # qualquer thread de transferência: abrir diálogo a partir da thread de
        # trabalho derruba o QGIS por crash nativo. No Windows isto devolve True
        # sem perguntar nada.
        if not FileTransferThread.ensure_smb_credentials(self):
            self._status("Transferência cancelada: credenciais de rede não informadas.")
            return False

        self._ocupado(True)
        self._status("Preparando o upload no servidor...")
        try:
            resposta = self.api_client.post(endpoint, payload)
        except Exception as e:
            self._ocupado(False)
            self._status(f"Erro ao preparar o upload: {e}")
            QMessageBox.critical(self, "Erro", f"Erro ao preparar o upload: {e}")
            return False

        if not resposta or 'dados' not in resposta:
            # A causa já foi mostrada pelo api_client (400 traz a mensagem do
            # servidor). Repetir aqui daria dois popups para o mesmo erro.
            self._ocupado(False)
            self._status("O servidor não aceitou os dados enviados.")
            return False

        dados = resposta['dados']
        self.current_session_uuid = dados.get('session_uuid')
        arquivos = achatar_arquivos(dados)

        if not self.current_session_uuid:
            self._ocupado(False)
            self._status("Resposta do servidor sem identificador de sessão.")
            QMessageBox.critical(self, "Erro", "Resposta do servidor sem identificador de sessão.")
            return False

        return self._transferir(arquivos)

    # --- fase 2 -------------------------------------------------------------

    def _transferir(self, arquivos):
        """Resolve as origens ANTES de copiar, e só então dispara as threads."""
        a_copiar = []
        nao_encontrados = []

        for info in arquivos:
            # Tileserver é URL: está catalogado, não há byte para copiar.
            if eh_tileserver(info.get('tipo_arquivo_id')):
                continue

            origem = self.upload_origem_de(info)
            if not origem:
                nao_encontrados.append(info.get('nome_arquivo') or info.get('nome') or '(sem nome)')
                continue
            a_copiar.append((origem, info))

        # Resolver tudo primeiro é o que permite ABORTAR inteiro: antes, o
        # diálogo copiava os que achou, avisava dos que faltaram e confirmava
        # assim mesmo, gravando uma versão com menos arquivo do que se pediu.
        if nao_encontrados:
            self._abortar(
                "Não foi possível localizar o arquivo de origem para:\n- "
                + "\n- ".join(nao_encontrados)
                + "\n\nNenhum arquivo foi enviado e a sessão foi cancelada."
            )
            return False

        if not a_copiar:
            # Só entradas de tileserver: não há o que copiar, mas há o que
            # confirmar.
            self._status("Nenhum arquivo físico a transferir. Confirmando...")
            return self._confirmar()

        barra = self._barra()
        if barra is not None:
            barra.setVisible(True)
            barra.setRange(0, len(a_copiar))
            barra.setValue(0)

        self._total_a_copiar = len(a_copiar)
        self._fila = list(a_copiar)
        self._status(f"Transferindo {len(a_copiar)} arquivo(s)...")
        self._proximo()
        return True

    # A transferência é SEQUENCIAL, um arquivo por vez.
    #
    # Três dos seis diálogos disparavam uma thread por arquivo de uma vez só. Num
    # lote de cartas isso são dezenas de cópias simultâneas do mesmo share SMB,
    # que disputam rede e disco e terminam mais devagar do que em fila -- e a
    # barra de progresso vira ficção, porque mostra "3/40 concluídos" enquanto as
    # quarenta estão pela metade. O `adicionar_produto` já fazia em fila; é essa
    # a versão que ficou.
    def _proximo(self):
        if not self._fila:
            self._acabou()
            return

        origem, info = self._fila[0]
        self._status(
            f"Transferindo {os.path.basename(origem)} "
            f"({self.arquivos_transferidos + 1}/{self._total_a_copiar})..."
        )

        thread = FileTransferThread(origem, info.get('destination_path'), info.get('checksum'))
        thread.progress_update.connect(self._progresso_do_arquivo)
        thread.file_transferred.connect(self._arquivo_terminou)
        self.transfer_threads.append(thread)
        thread.start()

    def _progresso_do_arquivo(self, atual, total):
        if total <= 0 or not self._fila:
            return
        origem = self._fila[0][0]
        self._status(
            f"Transferindo {os.path.basename(origem)} "
            f"({self.arquivos_transferidos + 1}/{self._total_a_copiar}) - "
            f"{atual / (1024 * 1024):.1f} / {total / (1024 * 1024):.1f} MB"
        )

    def _arquivo_terminou(self, sucesso, destino, identificador, mensagem_erro=None):
        atual = self._fila.pop(0) if self._fila else None
        self.arquivos_transferidos += 1

        if not sucesso and atual is not None:
            self.arquivos_com_falha += 1
            self.failed_transfers.append({
                'source_path': atual[0],
                'info': atual[1],
                'error': mensagem_erro,
            })
            self._status(
                f"Erro ao transferir {os.path.basename(destino or '')}"
                + (f": {mensagem_erro}" if mensagem_erro else "")
            )

        barra = self._barra()
        if barra is not None:
            barra.setValue(self.arquivos_transferidos)

        self._proximo()

    def _acabou(self):
        if self.arquivos_com_falha == 0:
            self._status("Arquivos transferidos. Confirmando no servidor...")
            self._confirmar()
            return

        causas = sorted({f['error'] for f in self.failed_transfers if f.get('error')})
        detalhe = ("\n\nCausa(s):\n" + "\n".join(f"- {c}" for c in causas)) if causas else ""
        resposta = QMessageBox.question(
            self, "Falha na transferência",
            f"{self.arquivos_com_falha} arquivo(s) não foram transferidos.{detalhe}\n\n"
            "Tentar novamente apenas os que falharam?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No
        )

        if resposta == QMessageBox.StandardButton.Yes:
            self._retentar()
        else:
            # Desistir CANCELA a sessão. Deixá-la aberta era o que enchia a tela
            # de "Sessões de Upload" de sessão que ninguém ia retomar.
            self._abortar(
                f"{self.arquivos_com_falha} arquivo(s) falharam. A sessão foi cancelada no servidor."
            )

    def _retentar(self):
        pendentes = [(f['source_path'], f['info']) for f in self.failed_transfers]
        self._upload_zerar()

        barra = self._barra()
        if barra is not None:
            barra.setMaximum(len(pendentes))
            barra.setValue(0)

        self._total_a_copiar = len(pendentes)
        self._fila = pendentes
        self._status(f"Retentando {len(pendentes)} arquivo(s)...")
        self._proximo()

    # --- fase 3 -------------------------------------------------------------

    def _confirmar(self):
        try:
            resposta = self.api_client.post(
                'arquivo/confirm-upload', {'session_uuid': self.current_session_uuid}
            )
        except Exception as e:
            self._ocupado(False)
            self._status(f"Erro ao confirmar: {e}")
            QMessageBox.critical(self, "Erro", f"Erro ao confirmar o upload: {e}")
            return False

        self._ocupado(False)
        barra = self._barra()
        if barra is not None:
            barra.setVisible(False)

        if resposta and resposta.get('success'):
            self.current_session_uuid = None
            self._status("Upload concluído.")
            self.upload_concluido("Upload concluído com sucesso.")
            return True

        # O confirm é onde os gatilhos do banco falam: sequência de versão,
        # subtipo incompatível, nome físico repetido. A mensagem do servidor vale
        # muito mais que um "falhou" nosso, e ela vem no envelope.
        motivo = (resposta or {}).get('message') or "O servidor recusou a confirmação."
        self._status(f"Erro: {motivo}")
        QMessageBox.critical(self, "Falha na confirmação", motivo)
        return False

    # --- desistência --------------------------------------------------------

    def _abortar(self, mensagem):
        self.cancelar_sessao()
        self._ocupado(False)
        barra = self._barra()
        if barra is not None:
            barra.setVisible(False)
        self._status(mensagem.split('\n')[0])
        QMessageBox.warning(self, "Upload não concluído", mensagem)

    def cancelar_sessao(self):
        """Avisa o servidor que a sessão não vai ser confirmada.

        Silencioso de propósito: isto roda em caminho de erro e ao fechar a
        janela, e um popup de "não consegui cancelar" em cima de uma falha que a
        pessoa já viu só atrapalha. O registro fica no log.
        """
        if not getattr(self, 'current_session_uuid', None):
            return
        try:
            self.api_client.post('arquivo/cancel-upload',
                                 {'session_uuid': self.current_session_uuid})
        except Exception as e:
            logging.warning(f"Falha ao cancelar a sessão de upload: {e}")
        finally:
            self.current_session_uuid = None

    def closeEvent(self, event):
        """Fechar a janela no meio de um upload cancela a sessão.

        Sem isto, fechar era a forma mais fácil de deixar sessão pendurada, e a
        mais comum: é o que se faz quando a transferência empaca.
        """
        for thread in getattr(self, 'transfer_threads', []):
            thread.cancel()
        self.cancelar_sessao()
        super().closeEvent(event)
