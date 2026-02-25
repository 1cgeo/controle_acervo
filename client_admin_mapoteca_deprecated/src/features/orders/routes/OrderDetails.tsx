// Path: features\orders\routes\OrderDetails.tsx
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Grid,
  Paper,
  Divider,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Card,
  CardContent,
  Alert,
  IconButton,
  Stack,
  Tooltip,
  useTheme,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  ReceiptLong as ReceiptLongIcon,
  Person as PersonIcon,
  CalendarToday as CalendarTodayIcon,
  DocumentScanner as DocumentScannerIcon,
  Visibility as VisibilityIcon,
  LocalShipping as LocalShippingIcon,
  Description as DescriptionIcon,
} from '@mui/icons-material';
import { useConfirm } from 'material-ui-confirm';
import Page from '@/components/Page/Page';
import Loading from '@/components/ui/Loading';
import { formatDate } from '@/utils/formatters';
import { useMapotecaOrders } from '@/hooks/useMapotecaOrders';
import OrderEditDialog from '../components/OrderEditDialog';
import ProductAddDialog from '../components/ProductAddDialog';

const OrderDetails = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { id } = useParams<{ id: string }>();
  const orderId = id ? parseInt(id, 10) : undefined;
  
  const { 
    getOrder, 
    mediaTypes,
    updateOrder,
    addProduct,
    deleteProducts,
    isAddingProduct,
    deleteOrders
  } = useMapotecaOrders();

  const { data: order, isLoading, isError, error, refetch } = getOrder(orderId);
  
  const [openEditDialog, setOpenEditDialog] = useState(false);
  const [openAddProductDialog, setOpenAddProductDialog] = useState(false);

  // Handle navigation back to orders list
  const handleBack = () => {
    navigate('/pedidos');
  };

  // Handle editing order
  const handleEdit = () => {
    setOpenEditDialog(true);
  };

  // Handle deleting order
  const handleDeleteOrder = async () => {
    if (!orderId) return;
    
    try {
      await confirm({
        title: 'Confirmar exclusão',
        description: `Você tem certeza que deseja excluir o pedido #${orderId}?`,
        confirmationText: 'Excluir',
        confirmationButtonProps: { color: 'error' },
      });

      await deleteOrders([orderId]);
      navigate('/pedidos');
    } catch (error) {
      // User canceled or there was an error
      console.error('Error deleting order:', error);
    }
  };

  // Handle viewing client
  const handleViewClient = () => {
    if (order?.cliente_id) {
      navigate(`/clientes/${order.cliente_id}`);
    }
  };

  // Handle deleting product
  const handleDeleteProduct = async (productId: number) => {
    try {
      await confirm({
        title: 'Confirmar exclusão',
        description: 'Você tem certeza que deseja excluir este produto do pedido?',
        confirmationText: 'Excluir',
        confirmationButtonProps: { color: 'error' },
      });

      await deleteProducts([productId]);
      refetch();
    } catch (error) {
      console.error('Error deleting product:', error);
    }
  };

  // Handle adding product
  const handleAddProduct = () => {
    setOpenAddProductDialog(true);
  };

  // Get status color
  const getStatusColor = (statusId: number) => {
    switch (statusId) {
      case 1: // Pré-cadastramento
        return 'default';
      case 2: // DIEx/Ofício recebido
        return 'info';
      case 3: // Em andamento
        return 'primary';
      case 4: // Remetido
        return 'secondary';
      case 5: // Concluído
        return 'success';
      case 6: // Cancelado
        return 'error';
      default:
        return 'default';
    }
  };

  if (isLoading) {
    return <Loading fullScreen />;
  }

  if (isError || !order) {
    return (
      <Page title="Detalhes do Pedido | Mapoteca Admin">
        <Container maxWidth="xl" sx={{ py: 3 }}>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={handleBack}
            sx={{ mb: 3 }}
          >
            Voltar
          </Button>
          
          <Alert severity="error" sx={{ mb: 3 }}>
            {error?.message || 'Erro ao carregar dados do pedido'}
          </Alert>
        </Container>
      </Page>
    );
  }

  return (
    <Page title={`Pedido #${order.id} | Mapoteca Admin`}>
      <Container maxWidth="xl" sx={{ py: 3 }}>
        {/* Header with back button and edit */}
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={handleBack}
          >
            Voltar para Pedidos
          </Button>
          
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              color="primary"
              startIcon={<EditIcon />}
              onClick={handleEdit}
            >
              Editar Pedido
            </Button>
            <Button
              variant="contained"
              color="secondary"
              startIcon={<AddIcon />}
              onClick={handleAddProduct}
            >
              Adicionar Produto
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={handleDeleteOrder}
            >
              Excluir
            </Button>
          </Stack>
        </Box>

        {/* Order information */}
        <Paper sx={{ p: 3, mb: 4 }}>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Box display="flex" alignItems="center" flexWrap="wrap" gap={2}>
                <Typography variant="h4" component="h1">
                  Pedido #{order.id}
                </Typography>
                <Chip 
                  label={order.situacao_pedido_nome} 
                  color={getStatusColor(order.situacao_pedido_id) as any} 
                  size="medium"
                />
                {order.localizador_pedido && (
                  <Chip 
                    label={`Localizador: ${order.localizador_pedido}`} 
                    color="info" 
                    size="medium"
                  />
                )}
              </Box>
            </Grid>

            <Grid item xs={12}>
              <Divider />
            </Grid>

            <Grid item xs={12} md={6} lg={3}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Box display="flex" alignItems="center" mb={1}>
                    <CalendarTodayIcon color="primary" sx={{ mr: 1 }} />
                    <Typography variant="h6">
                      Datas
                    </Typography>
                  </Box>
                  <Box mt={2}>
                    <Typography variant="body2" color="text.secondary">
                      Data do Pedido
                    </Typography>
                    <Typography variant="body1" fontWeight="medium">
                      {formatDate(order.data_pedido)}
                    </Typography>
                  </Box>
                  {order.data_atendimento && (
                    <Box mt={2}>
                      <Typography variant="body2" color="text.secondary">
                        Data de Atendimento
                      </Typography>
                      <Typography variant="body1">
                        {formatDate(order.data_atendimento)}
                      </Typography>
                    </Box>
                  )}
                  {order.prazo && (
                    <Box mt={2}>
                      <Typography variant="body2" color="text.secondary">
                        Prazo
                      </Typography>
                      <Typography variant="body1">
                        {formatDate(order.prazo)}
                      </Typography>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6} lg={3}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                    <Box display="flex" alignItems="center">
                      <PersonIcon color="primary" sx={{ mr: 1 }} />
                      <Typography variant="h6">
                        Cliente
                      </Typography>
                    </Box>
                    <Tooltip title="Ver detalhes do cliente">
                      <IconButton size="small" onClick={handleViewClient}>
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  <Box mt={2}>
                    <Typography variant="body2" color="text.secondary">
                      Nome
                    </Typography>
                    <Typography variant="body1" fontWeight="medium">
                      {order.cliente_nome}
                    </Typography>
                  </Box>
                  {order.tipo_cliente_nome && (
                    <Box mt={2}>
                      <Typography variant="body2" color="text.secondary">
                        Tipo de Cliente
                      </Typography>
                      <Typography variant="body1">
                        {order.tipo_cliente_nome}
                      </Typography>
                    </Box>
                  )}
                  {order.ponto_contato && (
                    <Box mt={2}>
                      <Typography variant="body2" color="text.secondary">
                        Ponto de Contato
                      </Typography>
                      <Typography variant="body1">
                        {order.ponto_contato}
                      </Typography>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6} lg={3}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Box display="flex" alignItems="center" mb={1}>
                    <DocumentScannerIcon color="primary" sx={{ mr: 1 }} />
                    <Typography variant="h6">
                      Documento
                    </Typography>
                  </Box>
                  {order.documento_solicitacao && (
                    <Box mt={2}>
                      <Typography variant="body2" color="text.secondary">
                        Documento
                      </Typography>
                      <Typography variant="body1">
                        {order.documento_solicitacao}
                      </Typography>
                    </Box>
                  )}
                  {order.documento_solicitacao_nup && (
                    <Box mt={2}>
                      <Typography variant="body2" color="text.secondary">
                        NUP
                      </Typography>
                      <Typography variant="body1">
                        {order.documento_solicitacao_nup}
                      </Typography>
                    </Box>
                  )}
                  {order.operacao && (
                    <Box mt={2}>
                      <Typography variant="body2" color="text.secondary">
                        Operação
                      </Typography>
                      <Typography variant="body1">
                        {order.operacao}
                      </Typography>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12} md={6} lg={3}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Box display="flex" alignItems="center" mb={1}>
                    <LocalShippingIcon color="primary" sx={{ mr: 1 }} />
                    <Typography variant="h6">
                      Entrega
                    </Typography>
                  </Box>
                  {order.endereco_entrega && (
                    <Box mt={2}>
                      <Typography variant="body2" color="text.secondary">
                        Endereço de Entrega
                      </Typography>
                      <Typography variant="body1">
                        {order.endereco_entrega}
                      </Typography>
                    </Box>
                  )}
                  {order.localizador_envio && (
                    <Box mt={2}>
                      <Typography variant="body2" color="text.secondary">
                        Localizador de Envio
                      </Typography>
                      <Typography variant="body1">
                        {order.localizador_envio}
                      </Typography>
                    </Box>
                  )}
                  {order.observacao_envio && (
                    <Box mt={2}>
                      <Typography variant="body2" color="text.secondary">
                        Observação de Envio
                      </Typography>
                      <Typography variant="body1">
                        {order.observacao_envio}
                      </Typography>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Additional Information */}
          {(order.observacao || order.palavras_chave?.length || order.motivo_cancelamento) && (
            <>
              <Divider sx={{ my: 3 }} />
              <Grid container spacing={3}>
                {order.observacao && (
                  <Grid item xs={12} md={4}>
                    <Box>
                      <Box display="flex" alignItems="center" mb={1}>
                        <DescriptionIcon color="action" sx={{ mr: 1 }} />
                        <Typography variant="subtitle1" fontWeight="medium">
                          Observações
                        </Typography>
                      </Box>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                        {order.observacao}
                      </Typography>
                    </Box>
                  </Grid>
                )}

                {order.palavras_chave && order.palavras_chave.length > 0 && (
                  <Grid item xs={12} md={4}>
                    <Box>
                      <Typography variant="subtitle1" fontWeight="medium" mb={1}>
                        Palavras-chave
                      </Typography>
                      <Box display="flex" flexWrap="wrap" gap={1}>
                        {order.palavras_chave.map((palavra, index) => (
                          <Chip 
                            key={index} 
                            label={palavra} 
                            size="small" 
                            color="default" 
                          />
                        ))}
                      </Box>
                    </Box>
                  </Grid>
                )}

                {order.motivo_cancelamento && (
                  <Grid item xs={12} md={4}>
                    <Box>
                      <Typography variant="subtitle1" fontWeight="medium" color="error" mb={1}>
                        Motivo de Cancelamento
                      </Typography>
                      <Typography variant="body2" color="error.main">
                        {order.motivo_cancelamento}
                      </Typography>
                    </Box>
                  </Grid>
                )}
              </Grid>
            </>
          )}
        </Paper>

        {/* Products */}
        <Paper sx={{ p: 3, mb: 4 }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
            <Typography variant="h5">
              Produtos
            </Typography>
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddIcon />}
              onClick={handleAddProduct}
            >
              Adicionar Produto
            </Button>
          </Box>

          {order.produtos.length > 0 ? (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>Produto</TableCell>
                    <TableCell>MI</TableCell>
                    <TableCell>INOM</TableCell>
                    <TableCell>Escala</TableCell>
                    <TableCell>Tipo de Mídia</TableCell>
                    <TableCell align="center">Quantidade</TableCell>
                    <TableCell align="center">Produção Específica</TableCell>
                    <TableCell align="center">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {order.produtos.map((product) => (
                    <TableRow key={product.id} hover>
                      <TableCell>{product.id}</TableCell>
                      <TableCell>{product.produto_nome || '-'}</TableCell>
                      <TableCell>{product.mi || '-'}</TableCell>
                      <TableCell>{product.inom || '-'}</TableCell>
                      <TableCell>{product.escala || '-'}</TableCell>
                      <TableCell>{product.tipo_midia_nome}</TableCell>
                      <TableCell align="center">{product.quantidade}</TableCell>
                      <TableCell align="center">
                        {product.producao_especifica ? 'Sim' : 'Não'}
                      </TableCell>
                      <TableCell align="center">
                        <Tooltip title="Excluir">
                          <IconButton 
                            size="small" 
                            color="error"
                            onClick={() => handleDeleteProduct(product.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Alert severity="info">
              Este pedido ainda não possui produtos.
            </Alert>
          )}
        </Paper>

        {/* Edit Dialog */}
        {order && (
          <OrderEditDialog
            open={openEditDialog}
            order={order}
            onClose={() => {
              setOpenEditDialog(false);
              refetch();
            }}
          />
        )}

        {/* Add Product Dialog */}
        {orderId && (
          <ProductAddDialog
            open={openAddProductDialog}
            orderId={orderId}
            onClose={() => {
              setOpenAddProductDialog(false);
              refetch();
            }}
          />
        )}
      </Container>
    </Page>
  );
};

export default OrderDetails;