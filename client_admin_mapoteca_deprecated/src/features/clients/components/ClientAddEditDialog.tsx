// Path: features\clients\components\ClientAddEditDialog.tsx
import { useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  Grid,
  SelectChangeEvent,
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Client, ClientCreateRequest, ClientUpdateRequest } from '@/types/client';
import { useMapotecaClient } from '@/hooks/useMapotecaClient';

interface ClientAddEditDialogProps {
  open: boolean;
  client?: Client;
  onClose: () => void;
}

// Form validation schema
const clientSchema = z.object({
  id: z.number().optional(),
  nome: z.string().min(1, 'Nome é obrigatório'),
  ponto_contato_principal: z.string().optional(),
  endereco_entrega_principal: z.string().optional(),
  tipo_cliente_id: z.number({
    required_error: 'Tipo de cliente é obrigatório',
    invalid_type_error: 'Tipo de cliente inválido',
  }).min(1, 'Tipo de cliente é obrigatório'),
});

type FormValues = z.infer<typeof clientSchema>;

const ClientAddEditDialog = ({
  open,
  client,
  onClose,
}: ClientAddEditDialogProps) => {
  // Use the enhanced hook with client types from API
  const { 
    clientTypes, 
    isLoadingClientTypes,
    createClient, 
    updateClient, 
    isCreating, 
    isUpdating 
  } = useMapotecaClient();

  const {
    control,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
  } = useForm<FormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      nome: '',
      ponto_contato_principal: '',
      endereco_entrega_principal: '',
      tipo_cliente_id: 0,
    },
  });

  // Set form values when client data changes
  useEffect(() => {
    if (client) {
      setValue('id', client.id);
      setValue('nome', client.nome);
      setValue('ponto_contato_principal', client.ponto_contato_principal || '');
      setValue('endereco_entrega_principal', client.endereco_entrega_principal || '');
      setValue('tipo_cliente_id', client.tipo_cliente_id);
    } else {
      reset({
        nome: '',
        ponto_contato_principal: '',
        endereco_entrega_principal: '',
        tipo_cliente_id: 0,
      });
    }
  }, [client, setValue, reset]);

  const handleClose = () => {
    reset();
    onClose();
  };

  const onSubmit = async (data: FormValues) => {
    try {
      if (client) {
        // Update existing client
        const updateData: ClientUpdateRequest = {
          id: client.id,
          nome: data.nome,
          ponto_contato_principal: data.ponto_contato_principal,
          endereco_entrega_principal: data.endereco_entrega_principal,
          tipo_cliente_id: data.tipo_cliente_id,
        };
        await updateClient(updateData);
      } else {
        // Create new client
        const createData: ClientCreateRequest = {
          nome: data.nome,
          ponto_contato_principal: data.ponto_contato_principal,
          endereco_entrega_principal: data.endereco_entrega_principal,
          tipo_cliente_id: data.tipo_cliente_id,
        };
        await createClient(createData);
      }
      handleClose();
    } catch (error) {
      console.error('Error saving client:', error);
    }
  };

  const isProcessing = isCreating || isUpdating;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      aria-labelledby="client-dialog-title"
      maxWidth="md"
      fullWidth
    >
      <DialogTitle id="client-dialog-title">
        {client ? 'Editar Cliente' : 'Adicionar Cliente'}
      </DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Controller
                name="nome"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Nome"
                    fullWidth
                    margin="normal"
                    error={!!errors.nome}
                    helperText={errors.nome?.message}
                    disabled={isProcessing}
                  />
                )}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <Controller
                name="tipo_cliente_id"
                control={control}
                render={({ field }) => (
                  <FormControl
                    fullWidth
                    margin="normal"
                    error={!!errors.tipo_cliente_id}
                    disabled={isProcessing || isLoadingClientTypes}
                  >
                    <InputLabel>Tipo de Cliente</InputLabel>
                    <Select
                      {...field}
                      value={field.value || 0}
                      onChange={(e: SelectChangeEvent<number>) => {
                        field.onChange(Number(e.target.value));
                      }}
                      label="Tipo de Cliente"
                    >
                      <MenuItem value={0} disabled>
                        Selecione o tipo de cliente
                      </MenuItem>
                      {clientTypes.map((type) => (
                        <MenuItem key={type.code} value={type.code}>
                          {type.nome}
                        </MenuItem>
                      ))}
                    </Select>
                    {errors.tipo_cliente_id && (
                      <FormHelperText>
                        {errors.tipo_cliente_id.message}
                      </FormHelperText>
                    )}
                  </FormControl>
                )}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <Controller
                name="ponto_contato_principal"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Ponto de Contato"
                    fullWidth
                    margin="normal"
                    error={!!errors.ponto_contato_principal}
                    helperText={errors.ponto_contato_principal?.message}
                    disabled={isProcessing}
                  />
                )}
              />
            </Grid>

            <Grid item xs={12}>
              <Controller
                name="endereco_entrega_principal"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Endereço de Entrega"
                    fullWidth
                    margin="normal"
                    multiline
                    rows={3}
                    error={!!errors.endereco_entrega_principal}
                    helperText={errors.endereco_entrega_principal?.message}
                    disabled={isProcessing}
                  />
                )}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={isProcessing}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={isProcessing}
          >
            {isProcessing
              ? client
                ? 'Atualizando...'
                : 'Criando...'
              : client
              ? 'Atualizar'
              : 'Criar'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default ClientAddEditDialog;