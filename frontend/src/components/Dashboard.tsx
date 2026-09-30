import { useState, useEffect } from 'react';
import axios from 'axios';
import { Mail, Clock, CheckCircle, AlertTriangle } from 'lucide-react';

const API_BASE = 'http://localhost:3000/api';

export default function Dashboard() {
  const [stats, setStats] = useState({
    total: 0,
    sent: 0,
    processing: 0,
    failed: 0,
    scheduled: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // In a real app, this would be a dedicated stats endpoint.
    // Here we make a few concurrent requests to ES.
    const fetchStats = async () => {
      try {
        const [totalRes, sentRes, procRes, failedRes, schedRes] = await Promise.all([
          axios.get(`${API_BASE}/emails?limit=1`),
          axios.get(`${API_BASE}/emails?status=sent&limit=1`),
          axios.get(`${API_BASE}/emails?status=processing&limit=1`),
          axios.get(`${API_BASE}/emails?status=failed&limit=1`),
          axios.get(`${API_BASE}/emails?status=scheduled&limit=1`)
        ]);

        setStats({
          total: totalRes.data.total,
          sent: sentRes.data.total,
          processing: procRes.data.total,
          failed: failedRes.data.total,
          scheduled: schedRes.data.total
        });
      } catch (err) {
        console.error('Failed to fetch stats', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <div className="header">
        <h1>Campaign Dashboard</h1>
      </div>

      {loading ? (
        <div className="loader"></div>
      ) : (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="flex items-center justify-between mb-2">
                <div className="stat-title">Total Emails</div>
                <Mail size={20} color="var(--accent-primary)" />
              </div>
              <div className="stat-value">{stats.total}</div>
            </div>
            
            <div className="stat-card">
              <div className="flex items-center justify-between mb-2">
                <div className="stat-title">Successfully Sent</div>
                <CheckCircle size={20} color="var(--status-sent)" />
              </div>
              <div className="stat-value">{stats.sent}</div>
            </div>
            
            <div className="stat-card">
              <div className="flex items-center justify-between mb-2">
                <div className="stat-title">Processing</div>
                <RefreshCw size={20} color="var(--status-processing)" />
              </div>
              <div className="stat-value">{stats.processing}</div>
            </div>
            
            <div className="stat-card">
              <div className="flex items-center justify-between mb-2">
                <div className="stat-title">Scheduled</div>
                <Clock size={20} color="var(--status-scheduled)" />
              </div>
              <div className="stat-value">{stats.scheduled}</div>
            </div>
            
            <div className="stat-card">
              <div className="flex items-center justify-between mb-2">
                <div className="stat-title">Failed</div>
                <AlertTriangle size={20} color="var(--status-failed)" />
              </div>
              <div className="stat-value">{stats.failed}</div>
            </div>
          </div>

          <div className="card">
            <h2>Welcome to ReachInbox Scheduler</h2>
            <p className="text-muted mt-4">
              This system is built to handle massively concurrent email campaigns.
              Go to the <strong>Emails Log</strong> tab to schedule a new campaign and watch the progress in real-time.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// Temporary icon to avoid importing RefreshCw at the top if it was forgotten
function RefreshCw(props: any) {
  return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
}
