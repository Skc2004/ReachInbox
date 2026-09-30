import { useState, useEffect } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { Search, Plus, RefreshCw, AlertCircle } from 'lucide-react';
import CreateCampaignModal from './CreateCampaignModal';

const API_BASE = '/api';

interface EmailRecord {
  id: string;
  campaignId: string;
  recipientEmail: string;
  subject: string;
  status: string;
  scheduledAt: string;
  sentAt?: string;
  lastError?: string;
}

export default function EmailsView() {
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchEmails = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/emails`, {
        params: { q: search, status: statusFilter, page, limit: 10 }
      });
      setEmails(res.data.data);
      setTotal(res.data.total);
    } catch (err) {
      console.error('Failed to fetch emails', err);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmails();
    
    // Poll every 3 seconds for live updates
    const interval = setInterval(() => {
      fetchEmails(false);
    }, 3000);
    
    return () => clearInterval(interval);
  }, [search, statusFilter, page]);

  return (
    <div>
      <div className="header">
        <h1>Emails Log (Elasticsearch)</h1>
        <button className="btn" onClick={() => setIsModalOpen(true)}>
          <Plus size={18} /> New Campaign
        </button>
      </div>

      <div className="card flex items-center justify-between mb-4 gap-4">
        <div className="search-bar">
          <Search size={18} color="var(--text-secondary)" />
          <input 
            type="text" 
            placeholder="Search subject, email, errors..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        
        <div className="flex gap-4">
          <select 
            className="form-control" 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="">All Statuses</option>
            <option value="pending_enqueue">Pending</option>
            <option value="scheduled">Scheduled</option>
            <option value="processing">Processing</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
          <button className="btn btn-secondary" onClick={() => fetchEmails()}>
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      <div className="card table-container">
        {loading && emails.length === 0 ? (
          <div className="loader"></div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Scheduled For</th>
                  <th>Sent At</th>
                  <th>Error (if any)</th>
                </tr>
              </thead>
              <tbody>
                {emails.map(email => (
                  <tr key={email.id}>
                    <td>{email.recipientEmail}</td>
                    <td>{email.subject}</td>
                    <td>
                      <span className={`badge badge-${email.status}`}>
                        {email.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td>{format(new Date(email.scheduledAt), 'MMM d, HH:mm:ss')}</td>
                    <td>{email.sentAt ? format(new Date(email.sentAt), 'HH:mm:ss') : '-'}</td>
                    <td>
                      {email.lastError && (
                        <div className="flex items-center gap-2" style={{ color: 'var(--status-failed)'}}>
                          <AlertCircle size={14} /> 
                          <span style={{ fontSize: '0.75rem' }}>{email.lastError.substring(0, 30)}...</span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {emails.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '3rem' }}>
                      <p className="text-muted">No emails found matching your criteria.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            
            <div className="pagination">
              <button 
                disabled={page === 1} 
                onClick={() => setPage(p => p - 1)}
              >
                Previous
              </button>
              <span className="text-muted">
                Page {page} of {Math.max(1, Math.ceil(total / 10))} ({total} total)
              </span>
              <button 
                disabled={page * 10 >= total}
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>

      {isModalOpen && (
        <CreateCampaignModal 
          onClose={() => setIsModalOpen(false)} 
          onSuccess={() => {
            setIsModalOpen(false);
            fetchEmails();
          }} 
        />
      )}
    </div>
  );
}
