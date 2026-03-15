import { Outlet, Navigate } from 'react-router';
import { useState, useCallback, useMemo } from 'react';
import { Sidebar } from './Sidebar';
import { AuthContext } from '@/lib/auth';
import { api } from '@/lib/api-client';

export function BackofficeLayout() {
  const [isAuthenticated, setIsAuthenticated] = useState(api.isAuthenticated());

  const login = useCallback(async (username: string, password: string) => {
    const tokens = await api.login(username, password);
    api.setTokens(tokens);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    api.clearTokens();
    setIsAuthenticated(false);
  }, []);

  const contextValue = useMemo(() => ({ isAuthenticated, login, logout }), [isAuthenticated, login, logout]);

  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  return (
    <AuthContext.Provider value={contextValue}>
      <div className="min-h-screen bg-zinc-950 relative">
        {/* Subtle background glow */}
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute top-0 left-60 right-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/[0.04] blur-[120px] rounded-full" />
        </div>
        <Sidebar />
        <main className="ml-60 p-6 relative">
          <Outlet />
        </main>
      </div>
    </AuthContext.Provider>
  );
}
