// Path: features\orders\routes\OrderCreate.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Grid,
  Paper,
  Divider,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  SelectChangeEvent,
  Stepper,
  Step,
  StepLabel,
  Alert,
  Chip,
  Stack,
  IconButton,
  useTheme,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  Add as AddIcon,
  ArrowForward as ArrowForwardIcon,
  ArrowBackIos as ArrowBackIosIcon,
  Check as CheckIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { ptBR } from 'date-fns/locale';
import Page from '@/components/Page/Page';
import Loading from '@/components/ui/Loading';
import { useMapotecaOrders } from '@/hooks/useMapotecaOrders';
import { useMapotecaClient } from '@/hooks/useMapotecaClient';
import { OrderCreateRequest, OrderProductCreateRequest } from '@/types/order';

// Schema for order basic information
const orderBasicSchema = z.object({
  cliente_id: z.number().int().positive('Cliente é obrigatório'),
  situacao_pedido_id: z.number().int().positive('Status é obrigatório'),
  data_pedido: z.date(),
  data_atendimento: z.date().nullable().optional(),
  documento_solicitacao: z.string().optional(),
  documento_solicitacao_nup: z.string().optional(),
  prazo: z.date().nullable().optional(),
});

// Schema for order additional information
const orderAdditionalSchema = z.object({
  ponto_contato: z.string().optional(),
  endereco_entrega: z.string().optional(),
  palavras_chave: z.array(z.string()).optional(),
  operacao: z.string().optional(),
  observacao: z.string().optional(),
  localizador_envio: z.string().optional(),
  observacao_envio: z.string().optional(),
  motivo_cancelamento: z.string().optional(),
});

// Schema for product
const productSchema = z.object({
  uuid_versao: z.string().uuid('UUID de versão é obrigatório'),
  tipo_midia_id: z.number().int().positive('Tipo de mídia é obrigatório'),
  quantidade: z.number().int().positive('Quantidade deve ser positiva'),
  producao_especifica: z.boolean().default(false),
});

type OrderBasicFormValues = z.infer<typeof orderBasicSchema>;
type OrderAdditionalFormValues = z.infer<typeof orderAdditionalSchema>;
type ProductFormValues = z.infer<typeof productSchema>;

// Step titles
const steps = ['Informações Básicas', 'Informações Adicionais', 'Produtos', 'Revisão'];

const OrderCreate = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  
  const { clients, isLoadingClients } = useMapotecaClient();
  const { 
    createOrder, 
    statuses, 
    mediaTypes, 
    isCreatingOrder, 
    isLoadingStatuses, 
    isLoadingMediaTypes 
  } = useMapotecaOrders();

  // State
  const [activeStep, setActiveStep] = useState(0);
  const [orderData, setOrderData] = useState<OrderCreateRequest | null>(null);
  const [products, setProducts] = useState<ProductFormValues[]>([]);
  const [newProduct, setNewProduct] = useState<ProductFormValues | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [keyword, setKeyword] = useState('');
  const [keywordError, setKeywordError] = useState('');

  // Basic form
  const {
    control: basicControl,
    handleSubmit: handleBasicSubmit,
    formState: { errors: basicErrors },
  } = useForm<OrderBasicFormValues>({
    resolver: zodResolver(orderBasicSchema),
    defaultValues: {
      cliente_id: 0,
      situacao_pedido_id: 0,
      data_pedido: new Date(),
      data_atendimento: null,
      documento_solicitacao: '',
      documento_solicitacao_nup: '',
      prazo: null,
    },
  });

  // Additional form
  const {
    control: additionalControl,
    handleSubmit: handleAdditionalSubmit,
    setValue: setAdditionalValue,
    watch: watchAdditional,
    formState: { errors: additionalErrors },
  } = useForm<OrderAdditionalFormValues>({
    resolver: zodResolver(orderAdditionalSchema),
    defaultValues: {
      ponto_contato: '',
      endereco_entrega: '',
      palavras_chave: [],
      operacao: '',
      observacao: '',
      localizador_envio: '',
      observacao_envio: '',
      motivo_cancelamento: '',
    },
  });

  // Product form
  const {
    control: productControl,
    handleSubmit: handleProductSubmit,
    reset: resetProductForm,
    formState: { errors: productErrors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      uuid_versao: '',
      tipo_midia_id: 0,
      quantidade: 1,
      producao_especifica: false,
    },
  });

  // Watch for palavras_chave from additional form
  const palavrasChave = watchAdditional('palavras_chave') || [];

  // Handle navigation back to orders list
  const handleBack = () => {
    navigate('/pedidos');
  };

  // Steps navigation
  const handleNext = () => {
    setActiveStep((prevActiveStep) => prevActiveStep + 1);
  };

  const handleBack2 = () => {
    setActiveStep((prevActiveStep) => prevActiveStep - 1);
  };

  // Submit functions for each step
  const onBasicSubmit = (data: OrderBasicFormValues) => {
    setOrderData({
      ...data,
      data_pedido: data.data_pedido.toISOString(),
      data_atendimento: data.data_atendimento ? data.data_atendimento.toISOString() : null,
      prazo: data.prazo ? data.prazo.toISOString() : null,
      // Include empty values for the additional fields
      ponto_contato: '',
      endereco_entrega: '',
      palavras_chave: [],
      operacao: '',
      observacao: '',
      localizador_envio: '',
      observacao_envio: '',
      motivo_cancelamento: '',
    });
    handleNext();
  };

  const onAdditionalSubmit = (data: OrderAdditionalFormValues) => {
    if (orderData) {
      setOrderData({
        ...orderData,
        ...data,
      });
    }
    handleNext();
  };

  const onProductSubmit = (data: ProductFormValues) => {
    setProducts([...products, data]);
    resetProductForm();
    setNewProduct(null);
  };

  // Create order
  const handleCreateOrder = async () => {
    if (!orderData) return;

    try {
      const response = await createOrder(orderData);
      
      if (response && products.length > 0) {
        // We have the order ID, now add products
        setOrderId(response.id);
        
        // Move to review step - products will be added later when the user confirms
        handleNext();
      } else if (response) {
        // No products to add, navigate to the created order
        navigate(`/pedidos/${response.id}`);
      }
    } catch (error) {
      console.error('Error creating order:', error);
    }
  };

  // Handle removing a product
  const handleRemoveProduct = (index: number) => {
    setProducts(products.filter((_, i) => i !== index));
  };

  // Handle adding a keyword
  const handleAddKeyword = () => {
    if (!keyword.trim()) {
      setKeywordError('Palavra-chave não pode ser vazia');
      return;
    }

    if (palavrasChave.includes(keyword.trim())) {
      setKeywordError('Palavra-chave já existe');
      return;
    }

    setAdditionalValue('palavras_chave', [...palavrasChave, keyword.trim()]);
    setKeyword('');
    setKeywordError('');
  };

  // Handle removing a keyword
  const handleRemoveKeyword = (keywordToRemove: string) => {
    setAdditionalValue(
      'palavras_chave',
      palavrasChave.filter((k) => k !== keywordToRemove)
    );
  };

  // Handle key press for adding keyword
  const handleKeywordKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddKeyword();
    }
  };

  // Loading state
  const isLoading = isLoadingClients || isLoadingStatuses || isLoadingMediaTypes;

  if (isLoading) {
    return <Loading />;
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ptBR}>
      <Page title="Novo Pedido | Mapoteca Admin">
        <Container maxWidth="lg" sx={{ py: 3 }}>
          {/* Header with back button */}
          <Box display="flex" alignItems="center" mb={3}>
            <Button
              startIcon={<ArrowBackIcon />}
              onClick={handleBack}
            >
              Voltar para Pedidos
            </Button>
            <Typography variant="h4" component="h1" sx={{ ml: 2 }}>
              Novo Pedido
            </Typography>
          </Box>

          {/* Stepper */}
          <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
            {steps.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          <Paper sx={{ p: 3, mb: 3 }}>
            {/* Step 1: Basic Information */}
            {activeStep === 0 && (
              <form onSubmit={handleBasicSubmit(onBasicSubmit)}>
                <Typography variant="h5" gutterBottom>
                  Informações Básicas
                </Typography>
                <Divider sx={{ mb: 3 }} />
                
                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <Controller
                      name="cliente_id"
                      control={basicControl}
                      render={({ field }) => (
                        <FormControl
                          fullWidth
                          margin="normal"
                          error={!!basicErrors.cliente_id}
                        >
                          <InputLabel>Cliente</InputLabel>
                          <Select
                            {...field}
                            value={field.value || 0}
                            onChange={(e: SelectChangeEvent<number>) => {
                              field.onChange(Number(e.target.value));
                            }}
                            label="Cliente"
                          >
                            <MenuItem value={0} disabled>
                              Selecione o cliente
                            </MenuItem>
                            {clients.map((client) => (
                              <MenuItem key={client.id} value={client.id}>
                                {client.nome}
                              </MenuItem>
                            ))}
                          </Select>
                          {basicErrors.cliente_id && (
                            <FormHelperText>
                              {basicErrors.cliente_id.message}
                            </FormHelperText>
                          )}
                        </FormControl>
                      )}
                    />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <Controller
                      name="situacao_pedido_id"
                      control={basicControl}
                      render={({ field }) => (
                        <FormControl
                          fullWidth
                          margin="normal"
                          error={!!basicErrors.situacao_pedido_id}
                        >
                          <InputLabel>Status</InputLabel>
                          <Select
                            {...field}
                            value={field.value || 0}
                            onChange={(e: SelectChangeEvent<number>) => {
                              field.onChange(Number(e.target.value));
                            }}
                            label="Status"
                          >
                            <MenuItem value={0} disabled>
                              Selecione o status
                            </MenuItem>
                            {statuses.map((status) => (
                              <MenuItem key={status.code} value={status.code}>
                                {status.nome}
                              </MenuItem>
                            ))}
                          </Select>
                          {basicErrors.situacao_pedido_id && (
                            <FormHelperText>
                              {basicErrors.situacao_pedido_id.message}
                            </FormHelperText>
                          )}
                        </FormControl>
                      )}
                    />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <Controller
                      name="data_pedido"
                      control={basicControl}
                      render={({ field }) => (
                        <DatePicker
                          label="Data do Pedido"
                          value={field.value}
                          onChange={(date) => field.onChange(date)}
                          slotProps={{
                            textField: {
                              fullWidth: true,
                              margin: 'normal',
                              error: !!basicErrors.data_pedido,
                              helperText: basicErrors.data_pedido?.message as string,
                            },
                          }}
                        />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <Controller
                      name="data_atendimento"
                      control={basicControl}
                      render={({ field }) => (
                        <DatePicker
                          label="Data de Atendimento"
                          value={field.value}
                          onChange={(date) => field.onChange(date)}
                          slotProps={{
                            textField: {
                              fullWidth: true,
                              margin: 'normal',
                              error: !!basicErrors.data_atendimento,
                              helperText: basicErrors.data_atendimento?.message as string,
                            },
                          }}
                        />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <Controller
                      name="documento_solicitacao"
                      control={basicControl}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="Documento de Solicitação"
                          fullWidth
                          margin="normal"
                          error={!!basicErrors.documento_solicitacao}
                          helperText={basicErrors.documento_solicitacao?.message}
                        />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <Controller
                      name="documento_solicitacao_nup"
                      control={basicControl}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="NUP do Documento"
                          fullWidth
                          margin="normal"
                          error={!!basicErrors.documento_solicitacao_nup}
                          helperText={basicErrors.documento_solicitacao_nup?.message}
                        />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <Controller
                      name="prazo"
                      control={basicControl}
                      render={({ field }) => (
                        <DatePicker
                          label="Prazo"
                          value={field.value}
                          onChange={(date) => field.onChange(date)}
                          slotProps={{
                            textField: {
                              fullWidth: true,
                              margin: 'normal',
                              error: !!basicErrors.prazo,
                              helperText: basicErrors.prazo?.message as string,
                            },
                          }}
                        />
                      )}
                    />
                  </Grid>
                </Grid>

                <Box display="flex" justifyContent="flex-end" mt={3}>
                  <Button
                    variant="contained"
                    color="primary"
                    type="submit"
                    endIcon={<ArrowForwardIcon />}
                  >
                    Próximo
                  </Button>
                </Box>
              </form>
            )}

            {/* Step 2: Additional Information */}
            {activeStep === 1 && (
              <form onSubmit={handleAdditionalSubmit(onAdditionalSubmit)}>
                <Typography variant="h5" gutterBottom>
                  Informações Adicionais
                </Typography>
                <Divider sx={{ mb: 3 }} />
                
                <Grid container spacing={3}>
                  <Grid item xs={12} md={6}>
                    <Controller
                      name="ponto_contato"
                      control={additionalControl}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="Ponto de Contato"
                          fullWidth
                          margin="normal"
                          error={!!additionalErrors.ponto_contato}
                          helperText={additionalErrors.ponto_contato?.message}
                        />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <Controller
                      name="operacao"
                      control={additionalControl}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="Operação"
                          fullWidth
                          margin="normal"
                          error={!!additionalErrors.operacao}
                          helperText={additionalErrors.operacao?.message}
                        />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <Controller
                      name="endereco_entrega"
                      control={additionalControl}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="Endereço de Entrega"
                          fullWidth
                          margin="normal"
                          multiline
                          rows={2}
                          error={!!additionalErrors.endereco_entrega}
                          helperText={additionalErrors.endereco_entrega?.message}
                        />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <Controller
                      name="localizador_envio"
                      control={additionalControl}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="Localizador de Envio"
                          fullWidth
                          margin="normal"
                          error={!!additionalErrors.localizador_envio}
                          helperText={additionalErrors.localizador_envio?.message}
                        />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12} md={6}>
                    <Controller
                      name="observacao_envio"
                      control={additionalControl}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="Observação de Envio"
                          fullWidth
                          margin="normal"
                          error={!!additionalErrors.observacao_envio}
                          helperText={additionalErrors.observacao_envio?.message}
                        />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <Controller
                      name="observacao"
                      control={additionalControl}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="Observações"
                          fullWidth
                          margin="normal"
                          multiline
                          rows={3}
                          error={!!additionalErrors.observacao}
                          helperText={additionalErrors.observacao?.message}
                        />
                      )}
                    />
                  </Grid>

                  <Grid item xs={12}>
                    <Typography variant="subtitle1" gutterBottom>
                      Palavras-chave
                    </Typography>
                    <Box display="flex" alignItems="center" mb={2}>
                      <TextField
                        label="Nova palavra-chave"
                        value={keyword}
                        onChange={(e) => {
                          setKeyword(e.target.value);
                          if (keywordError) setKeywordError('');
                        }}
                        onKeyPress={handleKeywordKeyPress}
                        error={!!keywordError}
                        helperText={keywordError}
                        sx={{ flexGrow: 1, mr: 1 }}
                      />
                      <Button 
                        variant="contained" 
                        onClick={handleAddKeyword} 
                        startIcon={<AddIcon />}
                      >
                        Adicionar
                      </Button>
                    </Box>
                    <Box display="flex" flexWrap="wrap" gap={1}>
                      {palavrasChave.map((palavra, index) => (
                        <Chip
                          key={index}
                          label={palavra}
                          onDelete={() => handleRemoveKeyword(palavra)}
                        />
                      ))}
                    </Box>
                  </Grid>
                </Grid>

                <Box display="flex" justifyContent="space-between" mt={3}>
                  <Button
                    variant="outlined"
                    color="primary"
                    onClick={handleBack2}
                    startIcon={<ArrowBackIosIcon />}
                  >
                    Voltar
                  </Button>
                  <Button
                    variant="contained"
                    color="primary"
                    type="submit"
                    endIcon={<ArrowForwardIcon />}
                  >
                    Próximo
                  </Button>
                </Box>
              </form>
            )}

            {/* Step 3: Products */}
            {activeStep === 2 && (
              <Box>
                <Typography variant="h5" gutterBottom>
                  Produtos
                </Typography>
                <Divider sx={{ mb: 3 }} />

                {products.length > 0 ? (
                  <Box mb={4}>
                    <Typography variant="subtitle1" gutterBottom>
                      Produtos adicionados
                    </Typography>
                    <Grid container spacing={2}>
                      {products.map((product, index) => (
                        <Grid item xs={12} key={index}>
                          <Paper
                            sx={{
                              p: 2,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              bgcolor: theme.palette.grey[50],
                            }}
                          >
                            <Box>
                              <Typography variant="subtitle2">
                                UUID: {product.uuid_versao}
                              </Typography>
                              <Typography variant="body2">
                                Tipo de Mídia: {mediaTypes.find(m => m.code === product.tipo_midia_id)?.nome || 'Desconhecido'}
                              </Typography>
                              <Typography variant="body2">
                                Quantidade: {product.quantidade}
                              </Typography>
                              <Typography variant="body2">
                                Produção Específica: {product.producao_especifica ? 'Sim' : 'Não'}
                              </Typography>
                            </Box>
                            <IconButton 
                              color="error" 
                              onClick={() => handleRemoveProduct(index)}
                            >
                              <DeleteIcon />
                            </IconButton>
                          </Paper>
                        </Grid>
                      ))}
                    </Grid>
                  </Box>
                ) : (
                  <Alert severity="info" sx={{ mb: 3 }}>
                    Nenhum produto adicionado ainda.
                  </Alert>
                )}

                {newProduct ? (
                  <Box>
                    <Typography variant="subtitle1" gutterBottom>
                      Adicionar produto
                    </Typography>
                    <form onSubmit={handleProductSubmit(onProductSubmit)}>
                      <Grid container spacing={2}>
                        <Grid item xs={12}>
                          <Controller
                            name="uuid_versao"
                            control={productControl}
                            render={({ field }) => (
                              <TextField
                                {...field}
                                label="UUID da Versão"
                                fullWidth
                                margin="normal"
                                error={!!productErrors.uuid_versao}
                                helperText={productErrors.uuid_versao?.message}
                              />
                            )}
                          />
                        </Grid>

                        <Grid item xs={12} md={6}>
                          <Controller
                            name="tipo_midia_id"
                            control={productControl}
                            render={({ field }) => (
                              <FormControl
                                fullWidth
                                margin="normal"
                                error={!!productErrors.tipo_midia_id}
                              >
                                <InputLabel>Tipo de Mídia</InputLabel>
                                <Select
                                  {...field}
                                  value={field.value || 0}
                                  onChange={(e: SelectChangeEvent<number>) => {
                                    field.onChange(Number(e.target.value));
                                  }}
                                  label="Tipo de Mídia"
                                >
                                  <MenuItem value={0} disabled>
                                    Selecione o tipo de mídia
                                  </MenuItem>
                                  {mediaTypes.map((type) => (
                                    <MenuItem key={type.code} value={type.code}>
                                      {type.nome}
                                    </MenuItem>
                                  ))}
                                </Select>
                                {productErrors.tipo_midia_id && (
                                  <FormHelperText>
                                    {productErrors.tipo_midia_id.message}
                                  </FormHelperText>
                                )}
                              </FormControl>
                            )}
                          />
                        </Grid>

                        <Grid item xs={12} md={6}>
                          <Controller
                            name="quantidade"
                            control={productControl}
                            render={({ field }) => (
                              <TextField
                                {...field}
                                label="Quantidade"
                                fullWidth
                                margin="normal"
                                type="number"
                                inputProps={{ min: "1", step: "1" }}
                                onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                                error={!!productErrors.quantidade}
                                helperText={productErrors.quantidade?.message}
                              />
                            )}
                          />
                        </Grid>

                        <Grid item xs={12}>
                          <Controller
                            name="producao_especifica"
                            control={productControl}
                            render={({ field: { onChange, value } }) => (
                              <FormControlLabel
                                control={
                                  <Switch 
                                    checked={value} 
                                    onChange={(e) => onChange(e.target.checked)} 
                                  />
                                }
                                label="Produção Específica"
                              />
                            )}
                          />
                        </Grid>
                      </Grid>

                      <Box display="flex" justifyContent="space-between" mt={2}>
                        <Button
                          variant="outlined"
                          color="inherit"
                          onClick={() => setNewProduct(null)}
                        >
                          Cancelar
                        </Button>
                        <Button
                          variant="contained"
                          color="primary"
                          type="submit"
                        >
                          Adicionar Produto
                        </Button>
                      </Box>
                    </form>
                  </Box>
                ) : (
                  <Button
                    variant="contained"
                    color="secondary"
                    startIcon={<AddIcon />}
                    onClick={() => setNewProduct({})}
                    sx={{ mb: 3 }}
                  >
                    Adicionar Produto
                  </Button>
                )}

                <Box display="flex" justifyContent="space-between" mt={3}>
                  <Button
                    variant="outlined"
                    color="primary"
                    onClick={handleBack2}
                    startIcon={<ArrowBackIosIcon />}
                  >
                    Voltar
                  </Button>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleCreateOrder}
                    disabled={isCreatingOrder}
                    endIcon={<ArrowForwardIcon />}
                  >
                    {isCreatingOrder ? 'Criando...' : 'Criar Pedido'}
                  </Button>
                </Box>
              </Box>
            )}

            {/* Step 4: Review */}
            {activeStep === 3 && orderId && (
              <Box>
                <Typography variant="h5" gutterBottom>
                  Pedido Criado com Sucesso!
                </Typography>
                <Divider sx={{ mb: 3 }} />

                <Alert 
                  severity="success" 
                  sx={{ mb: 3 }}
                  icon={<CheckIcon fontSize="inherit" />}
                >
                  O pedido foi criado com sucesso. ID do Pedido: {orderId}
                </Alert>

                <Typography variant="body1" paragraph>
                  Você pode visualizar e gerenciar o pedido agora ou voltar para a lista de pedidos.
                </Typography>

                <Box display="flex" justifyContent="space-around" mt={3}>
                  <Button
                    variant="outlined"
                    color="primary"
                    onClick={handleBack}
                  >
                    Voltar para Lista
                  </Button>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={() => navigate(`/pedidos/${orderId}`)}
                    endIcon={<VisibilityIcon />}
                  >
                    Ver Pedido
                  </Button>
                </Box>
              </Box>
            )}
          </Paper>
        </Container>
      </Page>
    </LocalizationProvider>
  );
};

export default OrderCreate;