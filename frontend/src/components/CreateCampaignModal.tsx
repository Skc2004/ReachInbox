import { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Loader2 } from 'lucide-react';

const API_BASE = 'http://localhost:3000/api';

interface CreateCampaignModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateCampaignModal({ onClose, onSuccess }: CreateCampaignModalProps) {
  const [senders, setSenders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Form State
  const [subject, setSubject] = useState('Welcome to ReachInbox!');
  const [body, setBody] = useState('We are glad to have you on board.');
  const [recipientsText, setRecipientsText] = useState('test1@example.com\ntest2@example.com');
  const [startAt, setStartAt] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 5);
    return d.toISOString().slice(0, 16);
  });
  const [delay, setDelay] = useState(2000);
  const [hourlyLimit, setHourlyLimit] = useState(50);
  const [selectedSenders, setSelectedSenders] = useState<string[]>([]);

  useEffect(() => {
    // Fetch available senders
    axios.get(`${API_BASE}/senders`, { withCredentials: true })
      .then(res => {
        setSenders(res.data);
        if (res.data.length > 0) {
          setSelectedSenders([res.data[0].id]);
        }
      })
      .catch(err => console.error('Failed to load senders', err));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const recipientsList = recipientsText.split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      await axios.post(`${API_BASE}/campaigns/schedule`, {
        subject,
        body,
        recipients: recipientsList,
        startAt: new Date(startAt).toISOString(),
        delayBetweenMs: delay,
        hourlyLimit,
        senderIds: selectedSenders
      }, { withCredentials: true });

      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to schedule campaign');
    } finally {
      setLoading(false);
    }
  };

  const handleSenderToggle = (id: string) => {
    setSelectedSenders(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Schedule New Campaign</h2>
          <button className="close-btn" onClick={onClose}><X size={24} /></button>
        </div>
        
        <div className="modal-body">
          {error && (
            <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '1rem', borderRadius: '0.5rem', marginBottom: '1.5rem' }}>
              {JSON.stringify(error)}
            </div>
          )}
          
          <form id="campaign-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Subject</label>
              <input 
                type="text" 
                className="form-control" 
                value={subject} 
                onChange={(e) => setSubject(e.target.value)} 
                required 
              />
            </div>
            
            <div className="form-group">
              <label>Email Body</label>
              <textarea 
                className="form-control" 
                value={body} 
                onChange={(e) => setBody(e.target.value)} 
                rows={4} 
                required 
              />
            </div>
            
            <div className="form-group">
              <label>Recipients (One per line)</label>
              <textarea 
                className="form-control" 
                value={recipientsText} 
                onChange={(e) => setRecipientsText(e.target.value)} 
                rows={5} 
                required 
              />
              <p className="text-muted mt-2" style={{ fontSize: '0.75rem' }}>
                Paste up to 10,000 emails. They will be deduplicated automatically.
              </p>
            </div>
            
            <div className="stats-grid" style={{ gap: '1rem', marginBottom: '1.25rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Start Sending At (Local Time)</label>
                <input 
                  type="datetime-local" 
                  className="form-control" 
                  value={startAt} 
                  onChange={(e) => setStartAt(e.target.value)} 
                  required 
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Delay Between Emails (ms)</label>
                <input 
                  type="number" 
                  className="form-control" 
                  value={delay} 
                  onChange={(e) => setDelay(parseInt(e.target.value))} 
                  required 
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Campaign Hourly Limit</label>
                <input 
                  type="number" 
                  className="form-control" 
                  value={hourlyLimit} 
                  onChange={(e) => setHourlyLimit(parseInt(e.target.value))} 
                  required 
                />
              </div>
            </div>

            <div className="form-group">
              <label>Select Senders (Round-Robin)</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '150px', overflowY: 'auto', padding: '1rem', backgroundColor: 'var(--bg-tertiary)', borderRadius: '0.5rem' }}>
                {senders.length === 0 ? (
                  <p className="text-muted text-sm">No senders found. Please create one.</p>
                ) : (
                  senders.map(s => (
                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 'normal' }}>
                      <input 
                        type="checkbox" 
                        checked={selectedSenders.includes(s.id)}
                        onChange={() => handleSenderToggle(s.id)}
                      />
                      {s.email}
                    </label>
                  ))
                )}
              </div>
            </div>
          </form>
        </div>
        
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} type="button">Cancel</button>
          <button 
            className="btn" 
            form="campaign-form" 
            type="submit"
            disabled={loading || selectedSenders.length === 0}
          >
            {loading ? <Loader2 className="loader" style={{ width: 18, height: 18, margin: 0, borderWidth: 2 }} /> : 'Schedule Campaign'}
          </button>
        </div>
      </div>
    </div>
  );
}
