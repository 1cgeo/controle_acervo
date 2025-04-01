// Path: features\orders\components\ProductAddDialog.tsx
import { useEffect } from 'react';
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
  FormControlLabel,
  Switch,
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { OrderProductCreateRequest, OrderProductUpdateRequest } from '@/types/order';
import { useMapotecaOrders } from '@/hooks/useMapotecaOrders';

// Schema for product addition/editing
const productSchema = z.object({
  id: z.number().optional(),
  uuid_versao: z.string().uuid('UUID de versão é obrigatório'),
  pedido_id: z.number().int().positive(),
  tipo_midia_id: z.number().int().positive('Tipo de mídia é obrigatório'),
  quantidade: z.number().int().positive('Quantidade deve ser positiva'),
  producao_especifica: z.boolean().default(false),
});

type ProductFormValues = z.infer<typeof productSchema>;

interface ProductAddDialogProps {
  open: boolean;
  onClose: () => void;
  orderId: number;
  product?: {
    id: number;
    uuid_versao: string;
    tipo_midia_id: number;
    quantidade: number;
    producao_especifica: boolean;
  };
}

const ProductAddDialog = ({
  open,
  onClose,
  orderId,
  product,
}: ProductAddDialogProps) => {
  const { 
    mediaTypes, 
    addProduct, 
    updateProduct, 
    isAddingProduct,
    isUpdatingProduct
  } = useMapotecaOrders();

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      pedido_id: orderId,
      uuid_versao: '',
      tipo_midia_id: 0,
      quantidade: 1,
      producao_especifica: false,
    },
  });

  // Set form values when product data changes
  useEffect(() => {
    setValue('pedido_id', orderId);
    
    if (product) {
      setValue('id', product.id);
      setValue('uuid_versao', product.uuid_versao);
      setValue('tipo_midia_id', product.tipo_midia_id);
      setValue('quantidade', product.quantidade);
      setValue('producao_especifica', product.producao_especifica);
    } else {
      reset({
        pedido_id: orderId,
        uuid_versao: '',
        tipo_midia_id: 0,
        quantidade: 1,
        producao_especifica: false,
      });
    }
  }, [product, orderId, setValue, reset, open]);

  const isProcessing = isAddingProduct || isUpdatingProduct;

  const onSubmit = async (data: ProductFormValues) => {
    try {
      if (product) {
        // Update existing product
        const updateData: OrderProductUpdateRequest = {
          id: product.id,
          uuid_versao: data.uuid_versao,
          pedido_id: data.pedido_id,
          tipo_midia_id: data.tipo_midia_id,
          quantidade: data.quantidade,
          producao_especifica: data.producao_especifica,
        };
        await updateProduct(updateData);
      } else {
        // Add new product
        const createData: OrderProductCreateRequest = {
          uuid_versao: data.uuid_versao,
          pedido_id: data.pedido_id,
          tipo_midia_id: data.tipo_midia_id,
          quantidade: data.quantidade,
          producao_especifica: data.producao_especifica,
        };
        await addProduct(createData);
      }
      handleClose();
    } catch (error) {
      console.error('Error saving product:', error);
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogTitle>
          {product ? 'Editar Produto' : 'Adicionar Produto'}
        </DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Controller
                name="uuid_versao"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="UUID da Versão"
                    fullWidth
                    margin="normal"
                    error={!!errors.uuid_versao}
                    helperText={errors.uuid_versao?.message}
                  />
                )}
              />
            </Grid>

            <Grid item xs={12}>
              <Controller
                name="tipo_midia_id"
                control={control}
                render={({ field }) => (
                  <FormControl
                    fullWidth
                    margin="normal"
                    error={!!errors.tipo_midia_id}
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
                    {errors.tipo_midia_id && (
                      <FormHelperText>
                        {errors.tipo_midia_id.message}
                      </FormHelperText>
                    )}
                  </FormControl>
                )}
              />
            </Grid>

            <Grid item xs={12}>
              <Controller
                name="quantidade"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Quantidade"
                    fullWidth
                    margin="normal"
                    type="number"
                    inputProps={{ min: "1", step: "1" }}
                    onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                    error={!!errors.quantidade}
                    helperText={errors.quantidade?.message}
                  />
                )}
              />
            </Grid>

            <Grid item xs={12}>
              <Controller
                name="producao_especifica"
                control={control}
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
              ? product
                ? 'Salvando...'
                : 'Adicionando...'
              : product
              ? 'Salvar'
              : 'Adicionar'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default ProductAddDialog;