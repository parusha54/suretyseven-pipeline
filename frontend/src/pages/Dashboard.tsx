import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useQuery } from '@tanstack/react-query';
import { Upload, Search, FileText, ChevronLeft, ChevronRight, X, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '../lib/api';

export const StatusBadge = ({ status }: { status: string }) => {
  const styles: any = {
    UPLOADED: 'bg-gray-100 text-gray-800 border-gray-200',
    PROCESSING: 'bg-blue-100 text-blue-800 border-blue-200 animate-pulse',
    PROCESSED: 'bg-green-100 text-green-800 border-green-200',
    FAILED: 'bg-red-100 text-red-800 border-red-200',
    VALIDATION_FAILED: 'bg-orange-100 text-orange-800 border-orange-200',
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles[status] || styles.UPLOADED}`}>
      {status}
    </span>
  );
};

export default function Dashboard() {
  // UI State
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // TanStack React Query (Replaces manual useEffect & useState)
  const { data, isError, isPending, refetch } = useQuery({
    queryKey: ['documents', page, search, statusFilter, typeFilter],
    queryFn: async () => {
      const res = await api.get('/documents', {
        params: { page, limit: 10, search, status: statusFilter, documentType: typeFilter }
      });
      return res.data;
    },
    refetchInterval: 5000 // Automatic background polling!
  });

  // Safely extract data from the cache
  const documents = data?.data || [];
  const stats = data?.stats || { total: 0, processed: 0, failed: 0, processing: 0 };
  const meta = data?.meta || { page: 1, totalPages: 1 };

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const file = formData.get('file') as File;

    if (!file || file.type !== 'application/pdf') {
      return toast.error('Please select a valid PDF file.');
    }

    setIsUploading(true);
    try {
      const res = await api.post('/documents', formData);
      if (res.data.message?.includes('Duplicate')) {
        toast.success('Duplicate detected! Re-using existing document.');
      } else {
        toast.success('Document uploaded successfully!');
      }
      setIsUploadOpen(false);
      refetch(); // Instantly update the UI via React Query
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Document Processing Pipeline</h1>
        <button
          onClick={() => setIsUploadOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium flex items-center transition-colors shadow-sm"
        >
          <Upload className="w-4 h-4 mr-2" /> Upload Document
        </button>
      </div>

      {/* Dashboard Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex flex-col">
          <span className="text-sm text-gray-500 font-medium">Total Documents</span>
          <span className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</span>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex flex-col">
          <span className="text-sm text-blue-500 font-medium">Currently Processing</span>
          <span className="text-2xl font-bold text-blue-600 mt-1 animate-pulse">{stats.processing}</span>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex flex-col">
          <span className="text-sm text-green-500 font-medium">Successfully Processed</span>
          <span className="text-2xl font-bold text-green-600 mt-1">{stats.processed}</span>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100 flex flex-col">
          <span className="text-sm text-red-500 font-medium">Failed / Invalid</span>
          <span className="text-2xl font-bold text-red-600 mt-1">{stats.failed}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-lg shadow-sm border">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search filenames..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9 pr-4 py-2 w-full border rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="border rounded-md px-4 py-2 bg-white">
          <option value="">All Statuses</option>
          <option value="UPLOADED">UPLOADED</option>
          <option value="PROCESSING">PROCESSING</option>
          <option value="PROCESSED">PROCESSED</option>
          <option value="FAILED">FAILED</option>
          <option value="VALIDATION_FAILED">VALIDATION_FAILED</option>
        </select>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="border rounded-md px-4 py-2 bg-white">
          <option value="">All Types</option>
          <option value="INVOICE">INVOICE</option>
          <option value="CONTRACT">CONTRACT</option>
          <option value="FINANCIAL_STATEMENT">FINANCIAL_STATEMENT</option>
          <option value="OTHER">OTHER</option>
        </select>
      </div>

      {isError && (
        <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span>
            {data
              ? 'Could not refresh the document list. Showing the last loaded results.'
              : 'Could not load the document list. Check that the API is running, then try again.'}
          </span>
          <button type="button" onClick={() => void refetch()} className="self-start font-medium underline sm:self-auto">
            Retry
          </button>
        </div>
      )}

      {/* Data Table */}
      <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b text-sm text-gray-600 uppercase tracking-wider">
              <th className="p-4 font-medium">Document ID</th>
              <th className="p-4 font-medium">Filename</th>
              <th className="p-4 font-medium">Type</th>
              <th className="p-4 font-medium">Status</th>
              <th className="p-4 font-medium">Upload Date</th>
            </tr>
          </thead>
          <tbody className="divide-y text-sm">
            {isPending ? (
              <tr><td colSpan={5} className="p-8 text-center text-gray-500" role="status">Loading documents...</td></tr>
            ) : isError && !data ? (
              <tr><td colSpan={5} className="p-8 text-center text-gray-500">The document list is unavailable. Use Retry above to try again.</td></tr>
            ) : documents.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-gray-500">No documents found.</td></tr>
            ) : (
              documents.map((doc: any) => (
                <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                  <td className="p-4">
                    <Link to={`/documents/${doc.id}`} className="text-blue-600 hover:underline font-mono">
                      {doc.id.split('-')[0]}...
                    </Link>
                  </td>
                  <td className="p-4 flex items-center font-medium text-gray-900">
                    <FileText className="w-4 h-4 mr-2 text-gray-400" /> {doc.filename}
                  </td>
                  <td className="p-4 text-gray-600">{doc.documentType}</td>
                  <td className="p-4"><StatusBadge status={doc.status} /></td>
                  <td className="p-4 text-gray-500">{format(new Date(doc.createdAt), 'MMM d, yyyy HH:mm')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="p-4 border-t flex justify-between items-center text-sm text-gray-600">
          <div>Page {meta.page} of {meta.totalPages || 1}</div>
          <div className="flex space-x-2">
            <button
              disabled={meta.page === 1}
              onClick={() => setPage(page - 1)}
              className="p-1 border rounded hover:bg-gray-50 disabled:opacity-50"
            ><ChevronLeft className="w-5 h-5" /></button>
            <button
              disabled={meta.page === meta.totalPages || meta.totalPages === 0}
              onClick={() => setPage(page + 1)}
              className="p-1 border rounded hover:bg-gray-50 disabled:opacity-50"
            ><ChevronRight className="w-5 h-5" /></button>
          </div>
        </div>
      </div>

      {/* Upload Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center p-4 border-b">
              <h2 className="text-lg font-semibold">Upload Document</h2>
              <button onClick={() => setIsUploadOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleUpload} className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">File (PDF Only) <span className="text-red-500">*</span></label>
                <input type="file" name="file" accept="application/pdf" required className="w-full border rounded-md p-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Document Type <span className="text-red-500">*</span></label>
                <select name="documentType" required className="w-full border rounded-md p-2 text-sm bg-white">
                  <option value="">Select Type...</option>
                  <option value="INVOICE">Invoice</option>
                  <option value="CONTRACT">Contract</option>
                  <option value="FINANCIAL_STATEMENT">Financial Statement</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Optional Metadata (JSON)</label>
                <textarea name="metadata" placeholder='{"department": "HR"}' rows={3} className="w-full border rounded-md p-2 text-sm font-mono"></textarea>
              </div>
              <button
                type="submit"
                disabled={isUploading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-md font-medium flex justify-center items-center"
              >
                {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Upload & Process'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
