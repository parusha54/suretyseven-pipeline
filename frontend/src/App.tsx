import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { LayoutDashboard } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import DocumentDetails from './pages/DocumentDetails';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <div className="min-h-screen flex flex-col">
          <nav className="bg-white border-b px-6 py-4 flex items-center space-x-2 shadow-sm">
            <LayoutDashboard className="text-blue-600" />
            <Link to="/" className="text-xl font-bold text-gray-800 tracking-tight">SuretySeven Pipeline</Link>
          </nav>
        <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/documents/:id" element={<DocumentDetails />} />
          </Routes>
        </main>
      </div>
      <Toaster position="top-right" />
      </Router>
    </QueryClientProvider>
  );
}
