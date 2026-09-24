import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { ArrowLeft, Clock, AlertTriangle, FileJson, Calendar, Hash } from 'lucide-react';
import { format } from 'date-fns';
import { StatusBadge } from './Dashboard';
import { api } from '../lib/api';

const terminalStatuses = new Set(['PROCESSED', 'VALIDATION_FAILED']);

export default function DocumentDetails() {
  const { id } = useParams();
  const {
    data: doc,
    error,
    isError,
    isFetching,
    isPending,
    refetch,
  } = useQuery({
    queryKey: ['document', id],
    queryFn: async () => {
      const res = await api.get(`/documents/${id}`);
      return res.data;
    },
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const currentDocument = query.state.data;
      if (terminalStatuses.has(currentDocument?.status)) return false;
      if (currentDocument?.status === 'FAILED' && currentDocument.retryCount >= 3) return false;
      if (axios.isAxiosError(query.state.error) && query.state.error.response?.status === 404) return false;
      return 3000;
    },
  });

  if (isPending) return <div className="p-8 animate-pulse flex space-x-4">Loading document details...</div>;

  if (!doc && isError) {
    const message = axios.isAxiosError(error) && error.response?.status === 404
      ? 'Document not found.'
      : 'Could not load document details.';

    return (
      <div className="p-8 text-red-700 bg-red-50 rounded-lg" role="alert">
        <p>{message}</p>
        <button onClick={() => refetch()} className="mt-3 underline font-medium">Try again</button>
      </div>
    );
  }

  if (!doc) return null;

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center">
          Document Details <span className="ml-4 font-mono text-lg text-gray-400">#{doc.documentId.split('-')[0]}</span>
        </h1>
        <StatusBadge status={doc.status} />
      </div>

      {isError && (
        <div className="p-3 text-amber-800 bg-amber-50 border border-amber-200 rounded-md" role="status">
          Could not refresh this document. Showing the last loaded information.
          <button onClick={() => refetch()} className="ml-2 underline font-medium">Retry now</button>
        </div>
      )}
      {!isError && isFetching && (
        <p className="text-xs text-gray-500" aria-live="polite">Refreshing status…</p>
      )}
      {doc.status === 'FAILED' && doc.retryCount < 3 && (
        <div className="p-3 text-amber-800 bg-amber-50 border border-amber-200 rounded-md" role="status">
          Attempt {doc.retryCount} failed. The worker will retry this document (up to 3 total attempts).
        </div>
      )}
      {doc.status === 'FAILED' && doc.retryCount >= 3 && (
        <div className="p-3 text-red-800 bg-red-50 border border-red-200 rounded-md" role="alert">
          Processing stopped after 3 total attempts.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Extraction & Metadata */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4 border-b pb-2 flex items-center">
              <FileJson className="w-5 h-5 mr-2 text-blue-500" /> Extracted Data
            </h2>

            {doc.status === 'VALIDATION_FAILED' && (
              <div className="mb-4 bg-orange-50 border-l-4 border-orange-400 p-4 rounded-r-md flex items-start">
                <AlertTriangle className="w-5 h-5 text-orange-400 mr-2 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-medium text-orange-800">Validation Failure</h3>
                  <p className="text-sm text-orange-700 mt-1">The AI returned data that did not pass our strict validation rules. See timeline for exact details.</p>
                </div>
              </div>
            )}

            {doc.result ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                {Object.entries(doc.result).map(([key, value]) => (
                  <div key={key} className="bg-gray-50 p-4 rounded-lg border border-gray-100 flex flex-col hover:bg-blue-50 transition-colors">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                    <span className="text-gray-900 font-medium text-lg">
                      {typeof value === 'number' && key.toLowerCase().includes('revenue')
                        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
                        : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-400 border-2 border-dashed rounded-md bg-gray-50 mt-4">
                No data extracted yet. Document is currently {doc.status}.
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4 border-b pb-2">System Metadata</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500 mb-1">Filename</p>
                <p className="font-medium text-gray-900 break-all">{doc.filename}</p>
              </div>
              <div>
                <p className="text-gray-500 mb-1 flex items-center"><Hash className="w-4 h-4 mr-1"/> Document Type</p>
                <p className="font-medium text-gray-900">{doc.documentType}</p>
              </div>
              <div>
                <p className="text-gray-500 mb-1 flex items-center"><Calendar className="w-4 h-4 mr-1"/> Upload Date</p>
                <p className="font-medium text-gray-900">{format(new Date(doc.createdAt), 'PPpp')}</p>
              </div>
              <div>
                <p className="text-gray-500 mb-1 flex items-center"><Clock className="w-4 h-4 mr-1"/> Last Updated</p>
                <p className="font-medium text-gray-900">{format(new Date(doc.updatedAt), 'PPpp')}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Processing Timeline */}
        <div className="bg-white rounded-lg shadow-sm border p-6 h-fit">
          <h2 className="text-lg font-semibold mb-6 border-b pb-2">Processing Timeline</h2>
          <div className="space-y-6">
            {doc.history?.map((event: any, idx: number) => (
              <div key={idx} className="relative flex gap-4">
                {/* Timeline Line */}
                {idx !== doc.history.length - 1 && (
                  <div className="absolute left-2.5 top-7 bottom-[-1.5rem] w-px bg-gray-200" />
                )}

                {/* Timeline Dot */}
                <div className={`relative z-10 w-5 h-5 rounded-full mt-1 flex-shrink-0 border-2 bg-white ${
                  event.status === 'PROCESSED' ? 'border-green-500' :
                  event.status.includes('FAIL') ? 'border-red-500' :
                  event.status === 'PROCESSING' ? 'border-blue-500' : 'border-gray-400'
                }`} />

                {/* Timeline Content */}
                <div className="flex-1 pb-2">
                  <p className="font-semibold text-sm text-gray-900">{event.status}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{format(new Date(event.timestamp || event.createdAt), 'PPpp')}</p>
                  {event.reason && (
                    <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded border border-red-100">
                      {event.reason}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
