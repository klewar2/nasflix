import { createBrowserRouter } from 'react-router';
import App from './App';
import HomePage from './pages/HomePage';
import FilmsPage from './pages/FilmsPage';
import SeriesPage from './pages/SeriesPage';
import MediaDetailPage from './pages/MediaDetailPage';
import SearchPage from './pages/SearchPage';
import LoginPage from './pages/backoffice/LoginPage';
import DashboardPage from './pages/backoffice/DashboardPage';
import MediaListPage from './pages/backoffice/MediaListPage';
import MediaEditPage from './pages/backoffice/MediaEditPage';
import SyncPage from './pages/backoffice/SyncPage';
import SettingsPage from './pages/backoffice/SettingsPage';
import { WebappLayout } from './components/layout/WebappLayout';
import { BackofficeLayout } from './components/layout/BackofficeLayout';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      {
        element: <WebappLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'films', element: <FilmsPage /> },
          { path: 'series', element: <SeriesPage /> },
          { path: 'media/:id', element: <MediaDetailPage /> },
          { path: 'search', element: <SearchPage /> },
        ],
      },
      {
        path: 'admin',
        children: [
          { path: 'login', element: <LoginPage /> },
          {
            element: <BackofficeLayout />,
            children: [
              { path: 'dashboard', element: <DashboardPage /> },
              { path: 'media', element: <MediaListPage /> },
              { path: 'media/:id', element: <MediaEditPage /> },
              { path: 'sync', element: <SyncPage /> },
              { path: 'settings', element: <SettingsPage /> },
            ],
          },
        ],
      },
    ],
  },
]);
