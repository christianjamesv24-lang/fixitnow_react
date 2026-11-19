import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api';
import Icon from '../../components/Icon';
import { Avatar, ErrorState, Spinner, StatusBadge } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { cn, timeAgo } from '../../lib/utils';
import { showDesktopNotification } from '../../lib/desktopNotifications';
import { useToast } from '../../contexts/ToastContext';
import ChatWindow from '../../components/chat/ChatWindow';
import DesktopNotificationOptIn from '../../components/DesktopNotificationOptIn';

function previewText(message) {
  if (!message) return 'No messages yet';
  if (message.type === 'image') return 'Photo';
  if (message.type === 'location') return 'Shared a live location';
  return message.body || '';
}

function conversationName(conversation, userId, isAdmin) {
  if (!isAdmin) return conversation.otherUser?.name || 'Conversation';
  const names = [conversation.customer?.name, conversation.technician?.name].filter(Boolean);
  return names.join(' / ') || 'Conversation';
}

export default function MessagesPage() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const rawSelectedId = searchParams.get('conversation');
  const selectedId = rawSelectedId ? Number(rawSelectedId) : null;

  const conversationsQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.get('/conversations').then((response) => response.data.data),
  });

  const items = useMemo(
    () => conversationsQuery.data?.items || [],
    [conversationsQuery.data]
  );
  const fromList = items.find((conversation) => conversation.id === selectedId);

  const detailQuery = useQuery({
    queryKey: ['conversations', 'detail', selectedId],
    queryFn: () =>
      api
        .get(`/conversations/${selectedId}`)
        .then((response) => response.data.data.conversation),
    enabled:
      Boolean(selectedId) &&
      !fromList &&
      !conversationsQuery.isLoading &&
      !conversationsQuery.isFetching,
    retry: false,
  });

  const selected = fromList || detailQuery.data || null;

  useEffect(() => {
    if (!socket) return undefined;
    function onMessage(message) {
      const current = queryClient.getQueryData(['conversations']);
      const exists = current?.items?.some((item) => item.id === message.conversationId);
      queryClient.setQueryData(['conversations'], (data) => {
        if (!data?.items) return data;
        const nextItems = data.items.map((conversation) => {
          if (conversation.id !== message.conversationId) return conversation;
          const isOpen = Number(rawSelectedId) === conversation.id;
          const isMine = Number(message.senderId) === Number(user.id);
          return {
            ...conversation,
            lastMessage: message,
            lastMessageAt: message.createdAt,
            unreadCount: isMine || isOpen ? conversation.unreadCount || 0 : (conversation.unreadCount || 0) + 1,
          };
        });
        nextItems.sort(
          (a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0)
        );
        return { ...data, items: nextItems };
      });
      if (!exists) queryClient.invalidateQueries({ queryKey: ['conversations'] });

      if (Number(message.senderId) !== Number(user.id)) {
        const title = `New message from ${message.sender?.name || 'FixitNow'}`;
        const body = previewText(message);
        showDesktopNotification({
          title,
          body,
          url: `/messages?conversation=${message.conversationId}`,
          tag: `chat-${message.id}`,
        });
        toast.info(body, { title });
      }
    }
    function onPresence(payload) {
      queryClient.setQueryData(['conversations'], (data) => {
        if (!data?.items) return data;
        return {
          ...data,
          items: data.items.map((conversation) => {
            const customer =
              conversation.customer?.id === payload.userId
                ? {
                    ...conversation.customer,
                    online: payload.online,
                    lastActiveAt: payload.lastActiveAt || conversation.customer.lastActiveAt,
                  }
                : conversation.customer;
            const technician =
              conversation.technician?.id === payload.userId
                ? {
                    ...conversation.technician,
                    online: payload.online,
                    lastActiveAt: payload.lastActiveAt || conversation.technician.lastActiveAt,
                  }
                : conversation.technician;
            const otherUser =
              conversation.otherUser?.id === payload.userId
                ? {
                    ...conversation.otherUser,
                    online: payload.online,
                    lastActiveAt: payload.lastActiveAt || conversation.otherUser.lastActiveAt,
                  }
                : conversation.otherUser;
            return { ...conversation, customer, technician, otherUser };
          }),
        };
      });
    }
    socket.on('chat:message', onMessage);
    socket.on('presence:update', onPresence);
    return () => {
      socket.off('chat:message', onMessage);
      socket.off('presence:update', onPresence);
    };
  }, [socket, queryClient, user.id, rawSelectedId, toast]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((conversation) => {
      const name = conversationName(conversation, user.id, user.role === 'admin').toLowerCase();
      const category = conversation.request?.category?.name?.toLowerCase() || '';
      return name.includes(term) || category.includes(term) || String(conversation.request?.id).includes(term);
    });
  }, [items, search, user.id, user.role]);

  const unreadTotal = items.reduce(
    (total, conversation) => total + (conversation.unreadCount || 0),
    0
  );

  function openConversation(id) {
    const next = new URLSearchParams(searchParams);
    next.set('conversation', String(id));
    setSearchParams(next);
  }

  function closeConversation() {
    const next = new URLSearchParams(searchParams);
    next.delete('conversation');
    setSearchParams(next);
  }

  return (
    <div className="h-full min-h-0 w-full overflow-hidden border-slate-200 bg-white">
      <div className="flex h-full min-h-0">
        <aside
          className={cn(
            'w-full shrink-0 flex-col border-slate-200 md:flex md:w-80 md:border-r lg:w-[22rem]',
            selected ? 'hidden' : 'flex'
          )}
        >
          <div className="border-b border-slate-200 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-slate-900">Messages</h1>
                {unreadTotal > 0 && (
                  <span className="rounded-full bg-brand-700 px-2 py-0.5 text-[10px] font-bold text-white">
                    {unreadTotal}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <DesktopNotificationOptIn compact />
                {user.role === 'customer' && (
                  <Link
                    to="/technicians"
                    className="btn-secondary btn-sm whitespace-nowrap"
                    title="Find a technician to message"
                  >
                    <Icon name="plus" className="h-4 w-4" />
                    New
                  </Link>
                )}
              </div>
            </div>
            <div className="relative mt-3">
              <Icon
                name="search"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search conversations"
                className="input py-2 pl-9 text-sm"
                aria-label="Search conversations"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {conversationsQuery.isLoading && (
              <div className="space-y-1 p-2">
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="flex animate-pulse items-center gap-3 rounded-xl p-3">
                    <span className="h-11 w-11 rounded-full bg-slate-200" />
                    <div className="flex-1 space-y-2">
                      <span className="block h-3 w-1/2 rounded bg-slate-200" />
                      <span className="block h-2.5 w-3/4 rounded bg-slate-100" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {conversationsQuery.isError && (
              <div className="p-4">
                <ErrorState
                  message="Conversations could not be loaded."
                  onRetry={conversationsQuery.refetch}
                />
              </div>
            )}
            {!conversationsQuery.isLoading &&
              !conversationsQuery.isError &&
              filteredItems.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                    <Icon name={search ? 'search' : 'message'} className="h-7 w-7" />
                  </span>
                  <p className="mt-3 font-semibold text-slate-900">
                    {search ? 'No conversations found' : 'No conversations yet'}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {search
                      ? 'Try another name, category, or request number.'
                      : user.role === 'customer'
                        ? 'Message a technician from their profile, or after booking a service.'
                        : 'Chats open here once a customer request is accepted.'}
                  </p>
                  {!search && user.role === 'customer' && (
                    <Link to="/technicians" className="btn-primary btn-sm mt-4">
                      Find a technician
                    </Link>
                  )}
                  {!search && user.role === 'technician' && (
                    <Link to="/technician/jobs" className="btn-primary btn-sm mt-4">
                      Browse jobs
                    </Link>
                  )}
                </div>
              )}

            {filteredItems.map((conversation) => {
              const isActive = conversation.id === selectedId;
              const name = conversationName(conversation, user.id, user.role === 'admin');
              const other = conversation.otherUser;
              const last = conversation.lastMessage;
              const mine = last && Number(last.senderId) === Number(user.id);
              return (
                <button
                  key={conversation.id}
                  type="button"
                  data-conversation-id={conversation.id}
                  data-unread={conversation.unreadCount || 0}
                  onClick={() => openConversation(conversation.id)}
                  className={cn(
                    'flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50',
                    isActive && 'bg-brand-50/70 hover:bg-brand-50'
                  )}
                >
                  <div className="relative mt-0.5">
                    <Avatar name={name} src={other?.avatarUrl} size="md" />
                    {other && (
                      <span
                        className={cn(
                          'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white',
                          other.online ? 'bg-emerald-500' : 'bg-slate-300'
                        )}
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-bold text-slate-900">{name}</p>
                      <span className="shrink-0 text-[10px] text-slate-400">
                        {conversation.lastMessageAt ? timeAgo(conversation.lastMessageAt) : ''}
                      </span>
                    </div>
                    <p
                      className={cn(
                        'mt-0.5 truncate text-xs',
                        conversation.unreadCount > 0 ? 'font-semibold text-slate-700' : 'text-slate-500'
                      )}
                    >
                      {mine && last ? 'You: ' : ''}
                      {previewText(last)}
                    </p>
                    {conversation.request && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="truncate text-[10px] font-medium text-slate-400">
                          #{conversation.request.id}{' '}
                          {conversation.request.category?.name || conversation.request.title}
                        </span>
                        <StatusBadge status={conversation.request.status} />
                      </div>
                    )}
                    {!conversation.request && (
                      <p className="mt-1.5 text-[10px] font-medium text-slate-400">Consultation</p>
                    )}
                  </div>
                  {conversation.unreadCount > 0 && (
                    <span className="mt-1 flex min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-700 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        <section className={cn('min-w-0 flex-1', selected ? 'flex' : 'hidden md:flex')}>
          {selected ? (
            <ChatWindow
              key={selected.id}
              conversation={selected}
              onBack={closeConversation}
            />
          ) : selectedId && detailQuery.isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <Spinner className="h-6 w-6 text-brand-700" />
            </div>
          ) : selectedId && detailQuery.isError ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <ErrorState
                message="This conversation could not be opened."
                onRetry={() => detailQuery.refetch()}
              />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                <Icon name="message" className="h-8 w-8" />
              </span>
              <p className="mt-4 text-lg font-bold text-slate-900">Your conversations</p>
              <p className="mt-1 max-w-sm text-sm text-slate-500">
                Select a chat to message your technician, share photos, and keep track of the job.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}