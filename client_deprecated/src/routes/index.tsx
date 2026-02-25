import { Suspense, lazy } from 'react';
import {
  createBrowserRouter,
  Navigate,
  redirect,
  RouteObject,
  ScrollRestoration,
} from 'react-router-dom';
import { CircularProgress, Box } from '@mui/material';
import { UserRole } from '../types/auth';
import { ErrorBoundaryRoute } from './ErrorBoundaryRoute';

// Layouts
const DashboardLayout = lazy(() => import('@/components/layouts/AppLayout'));

// Pages with lazy loading
const Login = lazy(() => import('../features/auth/routes/Login'));
const Dashboard = lazy(() => import('../features/dashboard/routes/Dashboard'));
const Unauthorized = lazy(() => import('./Unauthorized'));
const NotFound = lazy(() => import('./NotFound'));

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

// Safely check if token is expired - moved inline to prevent import issues
const checkTokenExpiration = (): boolean => {
  try {
    const tokenExpiry = localStorage.getItem('@sca_dashboard-Token-Expiry');
    if (!tokenExpiry) return false;

    const expiryTime = new Date(tokenExpiry);
    return expiryTime <= new Date();
  } catch (error) {
    console.error('Error checking token expiry:', error);
    return false;
  }
};

// Auth loaders for protected routes
const authLoader = () => {
  try {
    const token = localStorage.getItem('@sca_dashboard-Token');
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
    const role = localStorage.getItem('@sca_dashboard-User-Authorization');

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
    <DashboardLayout />
    <ScrollRestoration />
  </>
);

// Define routes using the new object format
const routes: RouteObject[] = [
  // Public routes
  {
    path: 'login',
    element: (
      <Suspense fallback={<LoadingFallback />}>
        <Login />
      </Suspense>
    ),
    errorElement: <ErrorBoundaryRoute />,
  },

  // Protected routes
  {
    path: '/',
    element: (
      <Suspense fallback={<LoadingFallback />}>
        <AppLayoutWithScrollRestoration />
      </Suspense>
    ),
    loader: authLoader, // Apply auth check to the entire section
    errorElement: <ErrorBoundaryRoute />,
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
        loader: adminLoader, // Only admins can access the dashboard
        errorElement: <ErrorBoundaryRoute />, // Route-specific error element
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
    errorElement: <ErrorBoundaryRoute />,
  },
  {
    path: '404',
    element: (
      <Suspense fallback={<LoadingFallback />}>
        <NotFound />
      </Suspense>
    ),
    errorElement: <ErrorBoundaryRoute />,
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