import { useState, useEffect } from 'react';
import axios from 'axios';
import { Mail, LayoutDashboard, Settings, LogOut } from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';
import Dashboard from './components/Dashboard';
import EmailsView from './components/EmailsView';

axios.defaults.withCredentials = true;

function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'emails'>('emails');
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if we are already logged in
    axios.get('/api/auth/me')
      .then(res => {
        setUser(res.data);
      })
      .catch(() => {
        // Not logged in
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const handleGoogleSuccess = async (credentialResponse: any) => {
    try {
      const res = await axios.post('/api/auth/google', {
        credential: credentialResponse.credential
      });
      setUser(res.data);
    } catch (err) {
      console.error("Login failed", err);
      alert("Failed to login with Google");
    }
  };

  const handleLogout = async () => {
    try {
      await axios.post('/api/auth/logout');
      setUser(null);
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return <div className="dashboard-container flex items-center justify-center"><div className="loader"></div></div>;
  }

  if (!user) {
    return (
      <div className="dashboard-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="card" style={{ width: '100%', maxWidth: '400px', textAlign: 'center' }}>
          <div className="logo" style={{ justifyContent: 'center', marginBottom: '2rem' }}>
            <Mail className="logo-icon" color="#6366f1" size={32} />
            <span style={{ fontSize: '1.5rem' }}>ReachInbox</span>
          </div>
          <h2 style={{ marginBottom: '1.5rem', color: 'white' }}>Sign in to continue</h2>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => {
                console.log('Login Failed');
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo">
          <Mail className="logo-icon" color="#6366f1" />
          <span>ReachInbox</span>
        </div>
        
        <nav className="nav-links">
          <a 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <LayoutDashboard size={20} />
            Dashboard
          </a>
          <a 
            className={`nav-item ${activeTab === 'emails' ? 'active' : ''}`}
            onClick={() => setActiveTab('emails')}
          >
            <Mail size={20} />
            Emails Log
          </a>
          <a className="nav-item">
            <Settings size={20} />
            Settings
          </a>
        </nav>

        <div style={{ marginTop: 'auto' }}>
          <div style={{ marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Logged in as<br/>
            <span style={{ color: 'white', fontWeight: 500 }}>{user.email}</span>
          </div>
          <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={handleLogout}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {activeTab === 'dashboard' ? <Dashboard /> : <EmailsView />}
      </main>
    </div>
  );
}

export default App;
