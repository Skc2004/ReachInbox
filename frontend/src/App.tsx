import { useState } from 'react';
import { Mail, LayoutDashboard, Settings } from 'lucide-react';
import Dashboard from './components/Dashboard';
import EmailsView from './components/EmailsView';

function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'emails'>('emails');

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
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {activeTab === 'dashboard' ? <Dashboard /> : <EmailsView />}
      </main>
    </div>
  );
}

export default App;
