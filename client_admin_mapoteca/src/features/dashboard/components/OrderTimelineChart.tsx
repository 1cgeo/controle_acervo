// Path: features\dashboard\components\OrderTimelineChart.tsx
import { Card, CardContent, CardHeader, useTheme } from '@mui/material';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { OrdersTimeline } from '@/types/dashboard';

interface OrderTimelineChartProps {
  data: OrdersTimeline[];
}

export const OrderTimelineChart = ({ data }: OrderTimelineChartProps) => {
  const theme = useTheme();

  // Format date for X-axis
  const formatXAxis = (tickItem: string) => {
    try {
      const date = new Date(tickItem);
      return date.toLocaleDateString('pt-BR', {
        month: 'short',
        day: 'numeric',
      });
    } catch (error) {
      return tickItem;
    }
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const startDate = new Date(label);
      const endDate = new Date(
        data.find(item => item.semana_inicio === label)?.semana_fim || label
      );
      
      return (
        <Card sx={{ p: 1, boxShadow: theme.shadows[3] }}>
          <CardContent sx={{ p: 1 }}>
            <p><strong>Semana de {startDate.toLocaleDateString('pt-BR')} a {endDate.toLocaleDateString('pt-BR')}</strong></p>
            <p>Pedidos: {payload[0].value}</p>
            <p>Produtos: {payload[1].value}</p>
          </CardContent>
        </Card>
      );
    }
    return null;
  };

  return (
    <Card sx={{ height: 400 }}>
      <CardHeader
        title="Pedidos por Semana"
        subheader="Quantidade de pedidos e produtos por semana"
      />
      <CardContent sx={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{
              top: 5,
              right: 30,
              left: 20,
              bottom: 5,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="semana_inicio"
              tickFormatter={formatXAxis}
              tick={{ fontSize: 12 }}
            />
            <YAxis />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Bar
              name="Pedidos"
              dataKey="total_pedidos"
              fill={theme.palette.primary.main}
              barSize={20}
            />
            <Bar
              name="Produtos"
              dataKey="total_produtos"
              fill={theme.palette.secondary.main}
              barSize={20}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};