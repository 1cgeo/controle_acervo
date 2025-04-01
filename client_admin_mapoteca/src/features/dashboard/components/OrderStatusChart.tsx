// Path: features\dashboard\components\OrderStatusChart.tsx
import { Card, CardContent, CardHeader, useTheme } from '@mui/material';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from 'recharts';
import { OrderStatusDistribution } from '@/types/dashboard';

interface OrderStatusChartProps {
  data: {
    id: number;
    nome: string;
    quantidade: number;
  }[];
}

export const OrderStatusChart = ({ data }: OrderStatusChartProps) => {
  const theme = useTheme();

  // Custom colors for different statuses
  const COLORS = [
    theme.palette.primary.main,
    theme.palette.info.main,
    theme.palette.success.main,
    theme.palette.warning.main,
    theme.palette.error.main,
    theme.palette.secondary.main,
  ];

  // Calculate total quantity for percentage calculations
  const totalQuantity = data.reduce(
    (sum, item) => sum + item.quantidade,
    0,
  );

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const percentage = ((payload[0].value / totalQuantity) * 100).toFixed(1);
      
      return (
        <Card sx={{ p: 1, boxShadow: theme.shadows[3] }}>
          <CardContent sx={{ p: 1 }}>
            <p><strong>{payload[0].name}</strong></p>
            <p>Quantidade: {payload[0].value}</p>
            <p>Percentual: {percentage}%</p>
          </CardContent>
        </Card>
      );
    }
    return null;
  };

  // Format chart data
  const chartData = data.map(item => ({
    name: item.nome,
    value: item.quantidade,
    id: item.id,
  }));

  // Custom label for pie chart slices
  const renderCustomizedLabel = ({ name, percent }: any) => {
    return `${name} (${(percent * 100).toFixed(0)}%)`;
  };

  return (
    <Card sx={{ height: 400 }}>
      <CardHeader
        title="Status dos Pedidos"
        subheader="Distribuição de pedidos por status"
      />
      <CardContent sx={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={false}
              outerRadius={120}
              fill={theme.palette.primary.main}
              dataKey="value"
              nameKey="name"
              label={renderCustomizedLabel}
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};