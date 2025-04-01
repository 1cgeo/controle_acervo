// Path: features\orders\components\OrderEditDialog.tsx
import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  SelectChangeEvent,
  Box,
  Chip,
  IconButton,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { ptBR } from 'date-fns/locale';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { 
  OrderDetail, 
  OrderUpdateRequest 
} from '@/types/order';
import { useMapotecaOrders } from '@/hooks/useMapotecaOrders';
import { useMapotecaClient } from '@/hooks/useMapotecaClient';
import AddIcon from '@mui/icons-material/Add';
import CancelIcon from '@mui/icons-material/Cancel';

// Schema for order editing
const orderSchema = z.object({
  id: z.number().int().positive(),
  cliente_id: z.number().int().positive('Cliente é obrigatório'),
  situacao_pedido_id: z.number().int().positive('Status é obrigatório'),
  data_pedido: z.date(),
  data_atendimento: z.date().nullable().optional(),
  ponto_contato: z.string().optional(),
  documento_solicitacao: z.string().optional(),
  documento_solicitacao_nup: z.string().optional(),
  endereco_entrega: z.string().optional(),
  palavras_chave: z.array(z.string()).optional(),
  operacao: z.string().optional(),
  prazo: z.date().nullable().optional(),
  observacao: z.string().optional(),
  localizador_envio: z.string().optional(),
  observacao_envio: z.string().optional(),
  motivo_cancelamento: z.string().optional(),
});

type OrderFormValues = z.infer<typeof orderSchema>;

interface OrderEditDialogProps {
  open: boolean;
  onClose: () => void;
  order: OrderDetail;
}

const OrderEditDialog = ({
  open,
  onClose,
  order,
}: OrderEditDialogProps) => {
  const { clients, isLoadingClients } = useMapotecaClient();
  const { 
    statuses, 
    updateOrder, 
    isUpdatingOrder 
  } = useMapotecaOrders();

  // State for new keyword input
  const [newKeyword, setNewKeyword] = useState('');
  const [keywordError, setKeywordError] = useState('');

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<OrderFormValues>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      id: order.id,
      cliente_id: order.cliente_id,
      situacao_pedido_id: order.situacao_pedido_id,
      data_pedido: new Date(order.data_pedido),
      data_atendimento: order.data_atendimento ? new Date(order.data_atendimento) : null,
      ponto_contato: order.ponto_contato || '',
      documento_solicitacao: order.documento_solicitacao || '',
      documento_solicitacao_nup: order.documento_solicitacao_nup || '',
      endereco_entrega: order.endereco_entrega || '',
      palavras_chave: order.palavras_chave || [],
      operacao: order.operacao || '',
      prazo: order.prazo ? new Date(order.prazo) : null,
      observacao: order.observacao || '',
      localizador_envio: order.localizador_envio || '',
      observacao_envio: order.observacao_envio || '',
      motivo_cancelamento: order.motivo_cancelamento || '',
    }
  });

  // Watch palavras_chave to update the UI
  const palavrasChave = watch('palavras_chave') || [];

  // Set form values when order data changes
  useEffect(() => {
    if (order && open) {
      setValue('id', order.id);
      setValue('cliente_id', order.cliente_id);
      setValue('situacao_pedido_id', order.situacao_pedido_id);
      setValue('data_pedido', new Date(order.data_pedido));
      setValue('data_atendimento', order.data_atendimento ? new Date(order.data_atendimento) : null);
      setValue('ponto_contato', order.ponto_contato || '');
      setValue('documento_solicitacao', order.documento_solicitacao || '');
      setValue('documento_solicitacao_nup', order.documento_solicitacao_nup || '');
      setValue('endereco_entrega', order.endereco_entrega || '');
      setValue('palavras_chave', order.palavras_chave || []);
      setValue('operacao', order.operacao || '');
      setValue('prazo', order.prazo ? new Date(order.prazo) : null);
      setValue('observacao', order.observacao || '');
      setValue('localizador_envio', order.localizador_envio || '');
      setValue('observacao_envio', order.observacao_envio || '');
      setValue('motivo_cancelamento', order.motivo_cancelamento || '');
      setNewKeyword('');
      setKeywordError('');
    }
  }, [order, open, setValue]);

  const onSubmit = async (data: OrderFormValues) => {
    try {
      const updateData: OrderUpdateRequest = {
        ...data,
        data_pedido: data.data_pedido.toISOString(),
        data_atendimento: data.data_atendimento ? data.data_atendimento.toISOString() : null,
        prazo: data.prazo ? data.prazo.toISOString() : null,
      };
      
      await updateOrder(updateData);
      handleClose();
    } catch (error) {
      console.error('Error updating order:', error);
    }
  };

  const handleClose = () => {
    onClose();
  };

  // Handle adding a keyword
  const handleAddKeyword = () => {
    if (!newKeyword.trim()) {
      setKeywordError('Palavra-chave não pode ser vazia');
      return;
    }

    if (palavrasChave.includes(newKeyword.trim())) {
      setKeywordError('Palavra-chave já existe');
      return;
    }

    setValue('palavras_chave', [...palavrasChave, newKeyword.trim()]);
    setNewKeyword('');
    setKeywordError('');
  };

  // Handle removing a keyword
  const handleRemoveKeyword = (keywordToRemove: string) => {
    setValue(
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

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ptBR}>
      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>Editar Pedido #{order.id}</DialogTitle>
          <DialogContent dividers>
            <Grid container spacing={2}>
              {/* Basic Information */}
              <Grid item xs={12}>
                <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
                  Informações Básicas
                </Typography>
              </Grid>

              <Grid item xs={12} md={6}>
                <Controller
                  name="cliente_id"
                  control={control}
                  render={({ field }) => (
                    <FormControl
                      fullWidth
                      margin="normal"
                      error={!!errors.cliente_id}
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
                      {errors.cliente_id && (
                        <FormHelperText>
                          {errors.cliente_id.message}
                        </FormHelperText>
                      )}
                    </FormControl>
                  )}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <Controller
                  name="situacao_pedido_id"
                  control={control}
                  render={({ field }) => (
                    <FormControl
                      fullWidth
                      margin="normal"
                      error={!!errors.situacao_pedido_id}
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
                      {errors.situacao_pedido_id && (
                        <FormHelperText>
                          {errors.situacao_pedido_id.message}
                        </FormHelperText>
                      )}
                    </FormControl>
                  )}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <Controller
                  name="data_pedido"
                  control={control}
                  render={({ field }) => (
                    <DatePicker
                      label="Data do Pedido"
                      value={field.value}
                      onChange={(date) => field.onChange(date)}
                      slotProps={{
                        textField: {
                          fullWidth: true,
                          margin: 'normal',
                          error: !!errors.data_pedido,
                          helperText: errors.data_pedido?.message as string,
                        },
                      }}
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <Controller
                  name="data_atendimento"
                  control={control}
                  render={({ field }) => (
                    <DatePicker
                      label="Data de Atendimento"
                      value={field.value}
                      onChange={(date) => field.onChange(date)}
                      slotProps={{
                        textField: {
                          fullWidth: true,
                          margin: 'normal',
                          error: !!errors.data_atendimento,
                          helperText: errors.data_atendimento?.message as string,
                        },
                      }}
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <Controller
                  name="documento_solicitacao"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Documento de Solicitação"
                      fullWidth
                      margin="normal"
                      error={!!errors.documento_solicitacao}
                      helperText={errors.documento_solicitacao?.message}
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <Controller
                  name="documento_solicitacao_nup"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="NUP do Documento"
                      fullWidth
                      margin="normal"
                      error={!!errors.documento_solicitacao_nup}
                      helperText={errors.documento_solicitacao_nup?.message}
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <Controller
                  name="prazo"
                  control={control}
                  render={({ field }) => (
                    <DatePicker
                      label="Prazo"
                      value={field.value}
                      onChange={(date) => field.onChange(date)}
                      slotProps={{
                        textField: {
                          fullWidth: true,
                          margin: 'normal',
                          error: !!errors.prazo,
                          helperText: errors.prazo?.message as string,
                        },
                      }}
                    />
                  )}
                />
              </Grid>

              {/* Client Information */}
              <Grid item xs={12}>
                <Typography variant="subtitle1" fontWeight="medium" gutterBottom mt={2}>
                  Informações do Cliente
                </Typography>
              </Grid>

              <Grid item xs={12} md={6}>
                <Controller
                  name="ponto_contato"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Ponto de Contato"
                      fullWidth
                      margin="normal"
                      error={!!errors.ponto_contato}
                      helperText={errors.ponto_contato?.message}
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <Controller
                  name="operacao"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Operação"
                      fullWidth
                      margin="normal"
                      error={!!errors.operacao}
                      helperText={errors.operacao?.message}
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12}>
                <Controller
                  name="endereco_entrega"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Endereço de Entrega"
                      fullWidth
                      margin="normal"
                      multiline
                      rows={2}
                      error={!!errors.endereco_entrega}
                      helperText={errors.endereco_entrega?.message}
                    />
                  )}
                />
              </Grid>

              {/* Delivery Information */}
              <Grid item xs={12}>
                <Typography variant="subtitle1" fontWeight="medium" gutterBottom mt={2}>
                  Informações de Entrega
                </Typography>
              </Grid>

              <Grid item xs={12} md={6}>
                <Controller
                  name="localizador_envio"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Localizador de Envio"
                      fullWidth
                      margin="normal"
                      error={!!errors.localizador_envio}
                      helperText={errors.localizador_envio?.message}
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12} md={6}>
                <Controller
                  name="observacao_envio"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Observação de Envio"
                      fullWidth
                      margin="normal"
                      error={!!errors.observacao_envio}
                      helperText={errors.observacao_envio?.message}
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12}>
                <Controller
                  name="observacao"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Observações"
                      fullWidth
                      margin="normal"
                      multiline
                      rows={3}
                      error={!!errors.observacao}
                      helperText={errors.observacao?.message}
                    />
                  )}
                />
              </Grid>

              {/* Additional Information */}
              <Grid item xs={12}>
                <Typography variant="subtitle1" fontWeight="medium" gutterBottom mt={2}>
                  Informações Adicionais
                </Typography>
              </Grid>

              <Grid item xs={12}>
                <Typography variant="body2" gutterBottom>
                  Palavras-chave
                </Typography>
                <Box display="flex" alignItems="center" mb={2}>
                  <TextField
                    label="Nova palavra-chave"
                    value={newKeyword}
                    onChange={(e) => {
                      setNewKeyword(e.target.value);
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

              <Grid item xs={12}>
                <Controller
                  name="motivo_cancelamento"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Motivo de Cancelamento"
                      fullWidth
                      margin="normal"
                      multiline
                      rows={2}
                      error={!!errors.motivo_cancelamento}
                      helperText={errors.motivo_cancelamento?.message}
                    />
                  )}
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleClose} disabled={isUpdatingOrder}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={isUpdatingOrder}
            >
              {isUpdatingOrder ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </LocalizationProvider>
  );
};

export default OrderEditDialog;