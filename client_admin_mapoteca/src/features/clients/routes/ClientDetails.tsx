// Path: features\clients\routes\ClientDetails.tsx
import { useState, useEffect } from 'react';
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
  Visibility as VisibilityIcon,
  Email as EmailIcon,
  LocationOn as LocationOnIcon,
  Phone as PhoneIcon,
  Business as BusinessIcon,
} from '@mui/icons-material';
import Page from '@/components/Page/Page';
import Loading from '@/components/ui/Loading';
import { formatDate } from '@/utils/formatters';
import { useMapotecaClient } from '@/hooks/useMapotecaClient';
import ClientAddEditDialog from '../components/ClientAddEditDialog';

const ClientDetails = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const clientId = id ? parseInt(id, 10) : undefined;
  
  const { getClient, isLoadingClient } = useMapotecaClient();
  const { data: client, isLoading, isError, error } = getClient(clientId);
  
  const [openDialog, setOpenDialog] = useState(false);

  // Handle navigation back to clients list
  const handleBack = () => {
    navigate('/clientes');
  };

  // Handle editing client
  const handleEdit = () => {
    setOpenDialog(true);
  };

  // Handle viewing order details
  const handleViewOrder = (orderId: number) => {
    navigate(`/pedidos/${orderId}`);
  };

  if (isLoading || isLoadingClient) {
    return <Loading fullScreen />;
  }

  if (isError || !client) {
    return (
      <Page title="Detalhes do Cliente | Mapoteca Admin">
        <Container maxWidth="xl" sx={{ py: 3 }}>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={handleBack}
            sx={{ mb: 3 }}
          >
            Voltar
          </Button>
          
          <Alert severity="error" sx={{ mb: 3 }}>
            {error?.message || 'Erro ao carregar dados do cliente'}
          </Alert>
        </Container>
      </Page>
    );
  }

  return (
    <Page title={`${client.nome} | Mapoteca Admin`}>
      <Container maxWidth="xl" sx={{ py: 3 }}>
        {/* Header with back button and edit */}
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={handleBack}
          >
            Voltar para Clientes
          </Button>
          
          <Button
            variant="contained"
            color="primary"
            startIcon={<EditIcon />}
            onClick={handleEdit}
          >
            Editar Cliente
          </Button>
        </Box>

        {/* Client information */}
        <Paper sx={{ p: 3, mb: 4 }}>
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Stack direction="row" spacing={2} alignItems="center">
                <Typography variant="h4" component="h1">
                  {client.nome}
                </Typography>
                <Chip 
                  label={client.tipo_cliente_nome} 
                  color="primary" 
                  size="medium"
                />
              </Stack>
            </Grid>

            <Grid item xs={12}>
              <Divider />
            </Grid>

            <Grid item xs={12} md={6}>
              <Stack spacing={2}>
                <Box display="flex" alignItems="center">
                  <BusinessIcon color="action" sx={{ mr: 1 }} />
                  <Typography variant="subtitle1" fontWeight="medium">
                    ID do Cliente: {client.id}
                  </Typography>
                </Box>
                
                {client.ponto_contato_principal && (
                  <Box display="flex" alignItems="center">
                    <PhoneIcon color="action" sx={{ mr: 1 }} />
                    <Typography variant="body1">
                      Ponto de Contato: {client.ponto_contato_principal}
                    </Typography>
                  </Box>
                )}
                
                {client.endereco_entrega_principal && (
                  <Box display="flex" alignItems="flex-start">
                    <LocationOnIcon color="action" sx={{ mr: 1, mt: 0.3 }} />
                    <Typography variant="body1">
                      Endereço: {client.endereco_entrega_principal}
                    </Typography>
                  </Box>
                )}
              </Stack>
            </Grid>

            <Grid item xs={12} md={6}>
              <Card sx={{ height: '100%', bgcolor: theme.palette.grey[50] }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Estatísticas
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Total de Pedidos
                      </Typography>
                      <Typography variant="h6">
                        {client.estatisticas.total_pedidos}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Pedidos em Andamento
                      </Typography>
                      <Typography variant="h6">
                        {client.estatisticas.pedidos_em_andamento}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Pedidos Concluídos
                      </Typography>
                      <Typography variant="h6">
                        {client.estatisticas.pedidos_concluidos}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">
                        Total de Produtos
                      </Typography>
                      <Typography variant="h6">
                        {client.estatisticas.total_produtos}
                      </Typography>
                    </Grid>
                    <Grid item xs={12}>
                      <Typography variant="body2" color="text.secondary">
                        Primeiro Pedido
                      </Typography>
                      <Typography variant="body1">
                        {client.estatisticas.data_primeiro_pedido 
                          ? formatDate(client.estatisticas.data_primeiro_pedido) 
                          : 'N/A'}
                      </Typography>
                    </Grid>
                    <Grid item xs={12}>
                      <Typography variant="body2" color="text.secondary">
                        Último Pedido
                      </Typography>
                      <Typography variant="body1">
                        {client.estatisticas.data_ultimo_pedido 
                          ? formatDate(client.estatisticas.data_ultimo_pedido) 
                          : 'N/A'}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Paper>

        {/* Recent orders */}
        <Box mb={3}>
          <Typography variant="h5" gutterBottom>
            Pedidos Recentes
          </Typography>
          
          {client.ultimos_pedidos.length > 0 ? (
            <TableContainer component={Paper}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>ID</TableCell>
                    <TableCell>Data</TableCell>
                    <TableCell>Documento</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Prazo</TableCell>
                    <TableCell align="center">Produtos</TableCell>
                    <TableCell align="center">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {client.ultimos_pedidos.map((order) => {
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

                    return (
                      <TableRow key={order.id} hover>
                        <TableCell>{order.id}</TableCell>
                        <TableCell>{formatDate(order.data_pedido)}</TableCell>
                        <TableCell>{order.documento_solicitacao || '-'}</TableCell>
                        <TableCell>
                          <Chip 
                            label={order.situacao_pedido_nome} 
                            color={getStatusColor(order.situacao_pedido_id) as any}
                            size="small" 
                          />
                        </TableCell>
                        <TableCell>
                          {order.prazo ? formatDate(order.prazo) : '-'}
                        </TableCell>
                        <TableCell align="center">{order.quantidade_produtos}</TableCell>
                        <TableCell align="center">
                          <Tooltip title="Ver detalhes">
                            <IconButton 
                              size="small" 
                              onClick={() => handleViewOrder(order.id)}
                              color="primary"
                            >
                              <VisibilityIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Alert severity="info">
              Este cliente ainda não possui pedidos.
            </Alert>
          )}
        </Box>

        {/* Edit Dialog */}
        <ClientAddEditDialog
          open={openDialog}
          client={client}
          onClose={() => setOpenDialog(false)}
        />
      </Container>
    </Page>
  );
};

export default ClientDetails;