# Path: core\upload_flow.py
"""A máquina de upload em duas fases, num lugar só.

O upload tem três passos: `prepare-upload/*` reserva a sessão e devolve o
`destination_path` de cada arquivo; o cliente copia os bytes; `confirm-upload`
fecha a transação. Todo diálogo de carga do plugin passa por aqui.

Duas regras que esta máquina faz cumprir para todos:

  1. `FileTransferThread.ensure_smb_credentials()` roda UMA vez, na thread
     principal, antes de existir qualquer thread de transferência. A thread de
     trabalho não pode abrir o diálogo de senha.
  2. Desistir CANCELA a sessão no servidor (`arquivo/cancel-upload`). Sessão
     abandonada fica pendurada na tela "Gerenciar Sessões de Upload".

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

# Quanto o fechamento da janela espera cada thread de transferência terminar.
FECHAR_ESPERA_MS = 10000

# Threads que sobreviveram ao fechamento da janela (a espera de FECHAR_ESPERA_MS
# estourou e elas continuam vivas). Ficam retidas aqui porque o diálogo dono é
# WA_DeleteOnClose: destruído ele, morre `self.transfer_threads`, que é a única
# referência Python à QThread, e o GC destrói uma QThread EM EXECUÇÃO, o que
# aborta o QGIS inteiro (crash nativo, sem traceback). Mesma rede de segurança do
# `_orphaned_managers` do DownloadManager.
_uploads_orfaos = set()


def _reter_uploads_orfaos(threads):
    """Retém as threads ainda vivas e solta as de fechamentos anteriores.

    A limpeza roda SEMPRE na thread principal, e nunca no slot de `finished`:
    soltar a última referência de dentro da própria thread de trabalho seria
    destruir a QThread de dentro dela mesma, que é o crash que esta rede evita.
    """
    for thread in list(_uploads_orfaos):
        if thread.isFinished():
            _uploads_orfaos.discard(thread)
            thread.deleteLater()

    for thread in threads:
        if thread.isRunning():
            _uploads_orfaos.add(thread)

    if _uploads_orfaos:
        logging.warning(
            f"{len(_uploads_orfaos)} thread(s) de transferência continuam vivas "
            "depois do fechamento da janela; retidas até terminarem para evitar "
            "crash do QGIS"
        )


def calcular_checksum(caminho, bloco=1024 * 1024):
    """SHA-256 de um arquivo.

    O bloco é de 1 MB: num arquivo de vários GB, bloco pequeno multiplica as
    idas ao disco e o hash é o que faz a tela parecer travada antes de a
    transferência começar.
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
    `produtos[].versoes[].arquivos[]`. Descer os três níveis aqui mantém UM
    leitor para as três rotas.
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
        # As threads NÃO são descartadas em bloco. Entre o `file_transferred`
        # (última linha do `run`) e o `finished`, a thread ainda está em
        # execução: soltar aqui a única referência Python a ela deixaria o GC
        # destruir uma QThread viva, e o QGIS cai por crash nativo. É o caminho
        # do `_retentar`, que chama este método logo depois do último arquivo.
        # Sai da lista só quem já terminou de fato.
        self.transfer_threads = [
            t for t in getattr(self, 'transfer_threads', []) if not t.isFinished()
        ]
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

        # Resolver tudo antes de copiar é o que permite ABORTAR inteiro. Copiar
        # só os que se acha e confirmar assim mesmo gravaria uma versão com
        # menos arquivo do que se pediu.
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

    # A transferência é SEQUENCIAL, um arquivo por vez. Dezenas de cópias
    # simultâneas do mesmo compartilhamento de rede disputam rede e disco, e
    # terminam mais devagar que em fila. A barra de progresso também deixa de
    # informar: ela mostraria "3/40 concluídos" com as quarenta pela metade.
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
            # Desistir CANCELA a sessão. Deixá-la aberta enche a tela de
            # "Sessões de Upload" de sessão que ninguém vai retomar.
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

    def _confirmar(self, _renovada=False):
        """Fecha a sessão no servidor. Devolve True quando o acervo gravou.

        SESSÃO VENCIDA SE RENOVA UMA VEZ. O prazo da sessão é de 24 horas contadas
        do prepare, e uma cópia de centenas de GB por SMB atravessa isso com
        facilidade; desde 2026-09-05 o servidor recusa o confirm da sessão vencida
        com 400 e cita `POST /api/arquivo/renovar-upload`. Os bytes já copiados
        continuam valendo, então renovar e confirmar de novo é o caminho certo, e
        é o que se faz aqui, uma vez só (`_renovada`), para não girar em círculo.

        O corpo da resposta traz os ids REAIS do que entrou: em `add_version`,
        `dados.versoes[].versao_id` e `.produto_id`; em `add_product`,
        `dados.produtos[].produto_id` e `.versoes[].versao_id`. Nenhum diálogo
        deste plugin os lê hoje, e por isso esta função só devolve o booleano.
        Quem passar a precisar do id da versão criada, leia daí: até 2026-08-05
        o campo carregava o id da tabela temporária da sessão, que não aponta
        para versão nenhuma do acervo.
        """
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
        # muito mais que um "falhou" nosso, e ela vem no envelope. Em erro HTTP o
        # `post` devolve None, e a frase fica em `ultima_mensagem_do_servidor`.
        motivo = ((resposta or {}).get('message')
                  or getattr(self.api_client, 'ultima_mensagem_do_servidor', None)
                  or "O servidor recusou a confirmação.")
        if not _renovada and 'renovar-upload' in motivo:
            self._status("A sessão venceu. Renovando por mais 24 horas e confirmando de novo...")
            renovacao = self.api_client.post(
                'arquivo/renovar-upload', {'session_uuid': self.current_session_uuid}
            )
            if renovacao and renovacao.get('success'):
                self._ocupado(True)
                return self._confirmar(_renovada=True)
            motivo = ("A sessão venceu e não pôde ser renovada. "
                      + ((renovacao or {}).get('message')
                         or getattr(self.api_client, 'ultima_mensagem_do_servidor', None)
                         or ""))
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

        ESPERAR A THREAD TERMINAR NÃO É ZELO: o diálogo é destruído logo depois
        (os diálogos do painel são WA_DeleteOnClose), e com ele a única
        referência Python à QThread. Destruir uma QThread em execução aborta o
        processo do QGIS inteiro, por crash nativo e sem traceback. É a mesma
        razão do `shutdown()` do DownloadManager.
        """
        threads = list(getattr(self, 'transfer_threads', []))
        for thread in threads:
            thread.cancel()
        for thread in threads:
            if thread.isRunning():
                # O cancelamento é conferido a cada bloco de 1 MB e a cada 0,1 s
                # do backoff, então a espera normal é curta. O teto existe para
                # não travar o QGIS se a leitura do compartilhamento de rede
                # empacar de vez.
                thread.wait(FECHAR_ESPERA_MS)

        # A espera pode ESTOURAR (leitura de rede pendurada num read que não
        # volta). Quem sobreviveu vai para o conjunto de módulo: esperar não
        # basta, porque logo abaixo o diálogo é destruído com a lista dentro.
        _reter_uploads_orfaos(threads)

        self.cancelar_sessao()
        super().closeEvent(event)
