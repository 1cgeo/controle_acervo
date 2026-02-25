// Path: routes\index.tsx
import { Suspense, lazy, ReactNode } from 'react';
import {
  createBrowserRouter,
  Navigate,
  redirect,
  RouteObject,
  ScrollRestoration,
} from 'react-router-dom';
import { CircularProgress, Box, Typography } from '@mui/material';
import { UserRole } from '@/types/auth';
import { ErrorBoundaryRoute } from './ErrorBoundaryRoute';
import { tokenService } from '../services/tokenService';

// Layouts
const AppLayout = lazy(() => import('@/components/layouts/AppLayout'));

// Pages with lazy loading
const Login = lazy(() => import('@/features/auth/routes/Login'));
const Dashboard = lazy(() => import('@/features/dashboard/routes/Dashboard'));

// Client management
const ClientList = lazy(() => import('@/features/clients/routes/ClientList'));
const ClientDetails = lazy(() => import('@/features/clients/routes/ClientDetails'));

// Order management
const OrderList = lazy(() => import('@/features/orders/routes/OrderList'));
const OrderDetails = lazy(() => import('@/features/orders/routes/OrderDetails'));
const OrderCreate = lazy(() => import('@/features/orders/routes/OrderCreate'));

// Materials management
const MaterialList = lazy(() => import('@/features/materials/routes/MaterialList'));
const MaterialDetails = lazy(() => import('@/features/materials/routes/MaterialDetails'));
const StockList = lazy(() => import('@/features/materials/routes/StockList'));
const ConsumptionList = lazy(() => import('@/features/materials/routes/ConsumptionList'));

// Plotter management
const PlotterList = lazy(() => import('@/features/plotters/routes/PlotterList'));
const PlotterDetails = lazy(() => import('@/features/plotters/routes/PlotterDetails'));

// Error pages
const NotFound = lazy(() => import('./NotFound'));
const Unauthorized = lazy(() => import('./Unauthorized'));

const LoadingFallback = () => (
  <Box
    sx={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
    }}
  >
    <CircularProgress />
  </Box>
);

// Create an error boundary wrapper to fix the children prop issue
const ErrorBoundaryWrapper = ({ children }: { children?: ReactNode }) => (
  <ErrorBoundaryRoute>
    {children || <Typography>An error occurred</Typography>}
  </ErrorBoundaryRoute>
);

// Safely check if token is expired
const checkTokenExpiration = (): boolean => {
  return tokenService.isTokenExpiredOrMissing();
};

// Auth loaders for protected routes
const authLoader = () => {
  try {
    const token = localStorage.getItem('@mapoteca-Token');
    const isAuthenticated = !!token && !checkTokenExpiration();

    if (!isAuthenticated) {
      // Redirect to login and remember the intended destination
      const currentPath = window.location.pathname;
      return redirect(`/login?from=${encodeURIComponent(currentPath)}`);
    }

    return null; // Continue to the route if authenticated
  } catch (error) {
    console.error('Error in auth loader:', error);
    return redirect('/login');
  }
};

// Admin role checker
const adminLoader = () => {
  try {
    const role = localStorage.getItem('@mapoteca-User-Authorization');

    if (role !== UserRole.ADMIN) {
      return redirect('/unauthorized');
    }

    return null; // Continue if admin
  } catch (error) {
    console.error('Error in admin loader:', error);
    return redirect('/unauthorized');
  }
};

// Helper for layout with scroll restoration
const AppLayoutWithScrollRestoration = () => (
  <>
    <AppLayout />
    <ScrollRestoration />
  </>
);

// Define routes using the object format
const routes: RouteObject[] = [
  // Public routes
  {
    path: 'login',
    element: (
      <Suspense fallback={<LoadingFallback />}>
        <Login />
      </Suspense>
    ),
    errorElement: <ErrorBoundaryWrapper />,
  },

  // Protected routes - Admin only
  {
    path: '/',
    element: (
      <Suspense fallback={<LoadingFallback />}>
        <AppLayoutWithScrollRestoration />
      </Suspense>
    ),
    loader: authLoader, // Apply auth check to the entire section
    errorElement: <ErrorBoundaryWrapper />,
    children: [
      {
        path: '',
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'dashboard',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <Dashboard />
          </Suspense>
        ),
        loader: adminLoader,
      },
      // Client management
      {
        path: 'clientes',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <ClientList />
          </Suspense>
        ),
        loader: adminLoader,
      },
      {
        path: 'clientes/:id',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <ClientDetails />
          </Suspense>
        ),
        loader: adminLoader,
      },
      // Order management
      {
        path: 'pedidos',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <OrderList />
          </Suspense>
        ),
        loader: adminLoader,
      },
      {
        path: 'pedidos/novo',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <OrderCreate />
          </Suspense>
        ),
        loader: adminLoader,
      },
      {
        path: 'pedidos/:id',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <OrderDetails />
          </Suspense>
        ),
        loader: adminLoader,
      },
      // Material management
      {
        path: 'materiais',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <MaterialList />
          </Suspense>
        ),
        loader: adminLoader,
      },
      {
        path: 'materiais/:id',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <MaterialDetails />
          </Suspense>
        ),
        loader: adminLoader,
      },
      {
        path: 'estoque',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <StockList />
          </Suspense>
        ),
        loader: adminLoader,
      },
      {
        path: 'consumo',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <ConsumptionList />
          </Suspense>
        ),
        loader: adminLoader,
      },
      // Plotter management
      {
        path: 'plotters',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <PlotterList />
          </Suspense>
        ),
        loader: adminLoader,
      },
      {
        path: 'plotters/:id',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <PlotterDetails />
          </Suspense>
        ),
        loader: adminLoader,
      },
    ],
  },

  // Error routes
  {
    path: 'unauthorized',
    element: (
      <Suspense fallback={<LoadingFallback />}>
        <Unauthorized />
      </Suspense>
    ),
    errorElement: <ErrorBoundaryWrapper />,
  },
  {
    path: '404',
    element: (
      <Suspense fallback={<LoadingFallback />}>
        <NotFound />
      </Suspense>
    ),
    errorElement: <ErrorBoundaryWrapper />,
  },
  {
    path: '*',
    element: <Navigate to="/404" replace />,
  },
];

// Create the router with the routes configuration
const router = createBrowserRouter(routes);

// Export router instance for use outside of components
export default router;

// Export a function to perform navigation from outside React components
export const navigateToLogin = () => {
  router.navigate('/login', { replace: true });
};