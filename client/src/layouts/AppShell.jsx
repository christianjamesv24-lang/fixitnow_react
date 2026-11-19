import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import Logo from '../components/Logo';
import Icon from '../components/Icon';
import { Avatar } from '../components/ui';
import NotificationBell from '../components/NotificationBell';
import OfflineBanner from '../components/OfflineBanner';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../lib/utils';
import {
  MESSAGE_SYNC_TAG,
  REQUEST_SYNC_TAG,
  syncOfflineMessages,
  syncOfflineRequests,
} from '../lib/offlineRequests';

const adminNav = [
  { label: 'Overview', to: '/admin', icon: 'dashboard', end: true },
  { label: 'Service requests', to: '/admin/requests', icon: 'clipboard' },
  { label: 'Users', to: '/admin/users', icon: 'users' },
  { label: 'Verification', to: '/admin/verification', icon: 'shield-check' },
  { label: 'Reviews', to: '/admin/reviews', icon: 'star' },
  { label: 'Categories', to: '/admin/categories', icon: 'layers' },
  { label: 'Site content', to: '/admin/content', icon: 'edit' },
  { label: 'Announcements', to: '/admin/announcements', icon: 'bell' },
  { label: 'Archive', to: '/admin/archive', icon: 'archive' },
  { label: 'Audit log', to: '/admin/audit', icon: 'activity' },
];

const technicianNav = [
  { label: 'Dashboard', to: '/technician', icon: 'dashboard', end: true },
  { label: 'Job board', to: '/technician/jobs', icon: 'briefcase' },
  { label: 'Messages', to: '/messages', icon: 'message' },
  { label: 'My profile', to: '/technician/profile', icon: 'user' },
  { label: 'Verification', to: '/technician/verification', icon: 'shield-check' },
  { label: 'Reviews', to: '/technician/reviews', icon: 'star' },
];

const customerNav = [
  { label: 'Dashboard', to: '/dashboard', icon: 'home', end: true },
  { label: 'My requests', to: '/requests', icon: 'clipboard' },
  { label: 'Technicians', to: '/technicians', icon: 'wrench' },
  { label: 'Messages', to: '/messages', icon: 'message' },
];

const customerTabs = [
  { label: 'Home', to: '/dashboard', icon: 'home', end: true },
  { label: 'Requests', to: '/requests', icon: 'clipboard' },
  { label: 'Book', to: '/requests/new', icon: 'plus', primary: true },
  { label: 'Messages', to: '/messages', icon: 'message' },
  { label: 'Profile', to: '/profile', icon: 'user' },
];

function SidebarContent({ nav, user, logout, onNavigate }) {
  return (
    <div className="flex h-full flex-col bg-slate-100">
      <div className="px-5 pb-5 pt-5">
        <Logo to={user.role === 'admin' ? '/admin' : '/technician'} />
      </div>
      <div className="mx-4 mb-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={user.name} src={user.avatarUrl} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-brand-700">
              {user.role}
            </p>
          </div>
        </div>
      </div>
      <nav className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) => cn('nav-link', isActive && 'nav-link-active')}
          >
            <Icon name={item.icon} className="h-[18px] w-[18px]" />
            {item.label}
          </NavLink>
        ))}
        <Link to="/notifications" onClick={onNavigate} className="nav-link">
          <Icon name="bell" className="h-[18px] w-[18px]" />
          Notifications
        </Link>
        <Link to="/settings" onClick={onNavigate} className="nav-link">
          <Icon name="settings" className="h-[18px] w-[18px]" />
          Settings
        </Link>
      </nav>
      <div className="border-t border-slate-200 p-3">
        <button type="button" onClick={logout} className="nav-link w-full text-left text-rose-600 hover:bg-rose-50 hover:text-rose-700">
          <Icon name="logout" className="h-[18px] w-[18px]" />
          Log out
        </button>
      </div>
    </div>
  );
}

function StaffShell({ nav, user, logout }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="min-h-dvh bg-slate-50">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 lg:block">
        <SidebarContent nav={nav} user={user} logout={logout} />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/50"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
          />
          <aside className="relative h-full w-72 max-w-[85vw] shadow-2xl">
            <SidebarContent
              nav={nav}
              user={user}
              logout={logout}
              onNavigate={() => setDrawerOpen(false)}
            />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
                onClick={() => setDrawerOpen(true)}
                aria-label="Open menu"
              >
                <Icon name="menu" className="h-5 w-5" />
              </button>
              <div className="lg:hidden">
                <Logo to={user.role === 'admin' ? '/admin' : '/technician'} />
              </div>
              <p className="hidden text-sm font-medium text-slate-500 lg:block">
                {user.role === 'admin' ? 'Operations console' : 'Technician workspace'}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <NotificationBell />
              <Link to="/profile" className="ml-1 rounded-full" aria-label="Your profile">
                <Avatar name={user.name} src={user.avatarUrl} size="sm" />
              </Link>
            </div>
          </div>
        </header>
        <main
          className={cn(
            'mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8',
            location.pathname.startsWith('/messages') && 'h-[calc(100dvh-4rem)] max-w-none p-0'
          )}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function CustomerShell({ user, logout }) {
  const location = useLocation();

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo to="/dashboard" />
          <nav className="hidden items-center gap-1 md:flex">
            {customerNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900',
                    isActive && 'bg-brand-50 text-brand-800'
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1.5">
            <NotificationBell />
            <Link to="/profile" className="rounded-full" aria-label="Your profile">
              <Avatar name={user.name} src={user.avatarUrl} size="sm" />
            </Link>
            <button
              type="button"
              onClick={logout}
              className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
              title="Log out"
            >
              <Icon name="logout" className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main
        className={cn(
          'mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8',
          location.pathname.startsWith('/messages')
            ? 'h-[calc(100dvh-4rem)] max-w-none p-0'
            : 'pb-24 md:pb-10'
        )}
      >
        <Outlet />
      </main>

      {!location.pathname.startsWith('/messages') && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          <div className="mx-auto grid max-w-md grid-cols-5">
            {customerTabs.map((tab) => {
              const active =
                tab.end
                  ? location.pathname === tab.to
                  : location.pathname === tab.to || location.pathname.startsWith(`${tab.to}/`);
              return (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  className={cn(
                    'flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold',
                    active ? 'text-brand-800' : 'text-slate-500'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-xl',
                      tab.primary && 'bg-brand-700 text-white shadow-md',
                      !tab.primary && active && 'bg-brand-50'
                    )}
                  >
                    <Icon name={tab.icon} className="h-5 w-5" />
                  </span>
                  {tab.label}
                </NavLink>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const nav = user.role === 'admin' ? adminNav : technicianNav;

  useEffect(() => {
    const flushRequests = () => {
      if (user.role !== 'customer') return Promise.resolve(0);
      return syncOfflineRequests(user.id).then((sent) => {
        if (sent) {
          queryClient.invalidateQueries({ queryKey: ['requests'] });
          queryClient.invalidateQueries({ queryKey: ['dashboard', 'customer'] });
        }
        return sent;
      });
    };

    const flushMessages = () =>
      syncOfflineMessages().then((sent) => {
        if (sent) {
          queryClient.invalidateQueries({ queryKey: ['conversations'] });
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
        }
        return sent;
      });

    const flushAll = () => {
      flushRequests().catch((error) => console.error('Could not sync offline service requests.', error));
      flushMessages().catch((error) => console.error('Could not sync offline messages.', error));
    };

    const onServiceWorkerMessage = (event) => {
      if (event.data?.type !== 'fixitnow:sync') return;
      if (event.data.tag === REQUEST_SYNC_TAG) {
        flushRequests().catch((error) => console.error('Could not sync offline service requests.', error));
      } else if (event.data.tag === MESSAGE_SYNC_TAG) {
        flushMessages().catch((error) => console.error('Could not sync offline messages.', error));
      }
    };

    flushAll();
    window.addEventListener('online', flushAll);
    navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage);

    return () => {
      window.removeEventListener('online', flushAll);
      navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
    };
  }, [queryClient, user.id, user.role]);

  return (
    <>
      <OfflineBanner canQueueRequests={user.role === 'customer'} />
      {user.role === 'customer' ? (
        <CustomerShell user={user} logout={logout} />
      ) : (
        <StaffShell nav={nav} user={user} logout={logout} />
      )}
    </>
  );
}