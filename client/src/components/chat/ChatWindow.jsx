import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import api, { apiErrorMessage } from '../../lib/api';
import Icon from '../Icon';
import { Avatar, ErrorState, Spinner, StatusBadge } from '../ui';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { useToast } from '../../contexts/ToastContext';
import { cn, formatDate, formatTime, timeAgo } from '../../lib/utils';
import {
  getQueuedOfflineMessages,
  queueOfflineMessage,
  subscribeToOfflineMessages,
} from '../../lib/offlineRequests';

const EMOJIS = ['👍', '🙏', '😊', '🔧', '⏰', '✅', '📷', '❓'];
const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(value) {
  const date = new Date(value);
  const today = new Date();
  if (dayKey(date) === dayKey(today)) return 'Today';
  if (dayKey(date) === dayKey(new Date(today.getTime() - DAY_MS))) return 'Yesterday';
  return formatDate(date, { weekday: 'short' });
}

function locationMapUrl(location) {
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

function geolocationErrorMessage(error) {
  if (error.code === 1) return 'Allow location access in your browser and try again.';
  if (error.code === 2) return 'Your current location could not be determined. Try again outdoors.';
  if (error.code === 3) return 'Getting your current location took too long. Please try again.';
  return 'Your current location could not be shared. Check your browser location settings.';
}

export default function ChatWindow({ conversation, onBack }) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [typingName, setTypingName] = useState('');
  const [queuedCount, setQueuedCount] = useState(0);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const typingSentAt = useRef(0);
  const typingStopTimer = useRef(null);
  const remoteTypingTimer = useRef(null);
  const fileRef = useRef(null);

  const messagesKey = useMemo(
    () => ['conversations', conversation.id, 'messages'],
    [conversation.id]
  );

  useEffect(() => {
    let active = true;
    const refresh = () => {
      getQueuedOfflineMessages()
        .then((records) => {
          if (active) {
            setQueuedCount(records.filter((record) => record.conversationId === conversation.id).length);
          }
        })
        .catch(() => {});
    };
    refresh();
    const unsubscribe = subscribeToOfflineMessages(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [conversation.id]);

  const messagesQuery = useInfiniteQuery({
    queryKey: messagesKey,
    queryFn: ({ pageParam }) =>
      api
        .get(`/conversations/${conversation.id}/messages`, {
          params: { page: pageParam, limit: 30 },
        })
        .then((response) => response.data.data),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.meta.page < lastPage.meta.totalPages ? lastPage.meta.page + 1 : undefined,
  });

  const messages = useMemo(() => {
    const pages = messagesQuery.data?.pages || [];
    const seen = new Set();
    const flatten = [];
    for (const page of pages) {
      for (const message of page.items) {
        if (!seen.has(message.id)) {
          seen.add(message.id);
          flatten.push(message);
        }
      }
    }
    return flatten.sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt) || a.id - b.id
    );
  }, [messagesQuery.data]);

  const isAdmin = user.role === 'admin';
  const otherUser =
    conversation.otherUser ||
    (conversation.customer?.id === user.id ? conversation.technician : conversation.customer);
  const conversationTitle = isAdmin
    ? [conversation.customer?.name, conversation.technician?.name].filter(Boolean).join(' / ') ||
      'Conversation'
    : otherUser?.name || 'Conversation';
  const isClosed =
    conversation.request?.status === 'cancelled' || conversation.request?.status === 'pending';
  const canReply = !isAdmin && !isClosed;
  const canShareLocation =
    canReply &&
    user.role === 'customer' &&
    Boolean(conversation.request?.id) &&
    ['accepted', 'on_the_way', 'arrived', 'in_progress'].includes(conversation.request?.status);
  const requestLink = conversation.request ? `/requests/${conversation.request.id}` : null;
  const latest = messages[messages.length - 1];

  const appendMessage = useCallback(
    (message) => {
      queryClient.setQueryData(messagesKey, (current) => {
        if (!current?.pages?.length) return current;
        if (current.pages.some((page) => page.items.some((item) => item.id === message.id))) {
          return current;
        }
        return {
          ...current,
          pages: current.pages.map((page, index) =>
            index === 0
              ? {
                  ...page,
                  items: [...page.items, message],
                  meta: { ...page.meta, total: (page.meta.total || 0) + 1 },
                }
              : page
          ),
        };
      });
    },
    [queryClient, messagesKey]
  );

  useEffect(() => {
    if (!socket) return undefined;
    function onMessage(message) {
      if (message.conversationId !== conversation.id) return;
      appendMessage(message);
    }
    function onTyping(payload) {
      if (payload.conversationId !== conversation.id || payload.userId === user.id) return;
      window.clearTimeout(remoteTypingTimer.current);
      if (payload.isTyping) {
        setTypingName(payload.name || 'Someone');
        remoteTypingTimer.current = window.setTimeout(() => setTypingName(''), 3000);
      } else {
        setTypingName('');
      }
    }
    function onRead(payload) {
      if (payload.conversationId !== conversation.id || payload.readerId === user.id) return;
      queryClient.setQueryData(messagesKey, (current) => {
        if (!current?.pages) return current;
        return {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            items: page.items.map((message) =>
              Number(message.senderId) === Number(user.id) && !message.seenAt
                ? { ...message, seenAt: payload.seenAt, deliveredAt: message.deliveredAt || payload.seenAt }
                : message
            ),
          })),
        };
      });
    }
    socket.on('chat:message', onMessage);
    socket.on('chat:typing', onTyping);
    socket.on('chat:read', onRead);
    return () => {
      socket.off('chat:message', onMessage);
      socket.off('chat:typing', onTyping);
      socket.off('chat:read', onRead);
      window.clearTimeout(remoteTypingTimer.current);
    };
  }, [socket, conversation.id, user.id, appendMessage, queryClient, messagesKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [conversation.id, latest?.id]);

  useEffect(() => {
    if (!latest?.id || isAdmin) return undefined;
    let active = true;
    const timer = window.setTimeout(async () => {
      queryClient.setQueryData(['conversations'], (current) => {
        if (!current?.items) return current;
        return {
          ...current,
          items: current.items.map((item) =>
            item.id === conversation.id ? { ...item, unreadCount: 0 } : item
          ),
        };
      });
      try {
        await api.patch(`/conversations/${conversation.id}/read`);
        if (!active) return;
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
      } catch {
        return;
      }
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [conversation.id, latest?.id, isAdmin, queryClient]);

  useEffect(
    () => () => {
      window.clearTimeout(typingStopTimer.current);
      window.clearTimeout(remoteTypingTimer.current);
    },
    []
  );

  function stopTyping() {
    window.clearTimeout(typingStopTimer.current);
    if (socket) socket.emit('chat:typing', { conversationId: conversation.id, isTyping: false });
  }

  function handleTextChange(event) {
    setText(event.target.value);
    if (!socket) return;
    const now = Date.now();
    if (now - typingSentAt.current > 1200) {
      typingSentAt.current = now;
      socket.emit('chat:typing', { conversationId: conversation.id, isTyping: true });
    }
    window.clearTimeout(typingStopTimer.current);
    typingStopTimer.current = window.setTimeout(stopTyping, 2200);
  }

  async function sendText(event) {
    event?.preventDefault();
    const body = text.trim();
    if (!body || sending || !canReply) return;
    setText('');
    setSending(true);
    setEmojiOpen(false);
    stopTyping();
    try {
      if (socket?.connected) {
        const result = await new Promise((resolve, reject) => {
          const timer = window.setTimeout(
            () => reject(new Error('Message timed out. Check your connection and try again.')),
            12000
          );
          socket.emit('chat:send', { conversationId: conversation.id, body }, (response) => {
            window.clearTimeout(timer);
            resolve(response);
          });
        });
        if (!result?.ok) throw new Error(result?.error || 'Message could not be sent');
        appendMessage(result.message);
      } else {
        const response = await api.post(`/conversations/${conversation.id}/messages`, { body });
        appendMessage(response.data.data.message);
      }
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      textareaRef.current?.focus();
    } catch (error) {
      if (!navigator.onLine || !socket?.connected) {
        await queueOfflineMessage(conversation.id, body);
        toast.info('Message saved on this device. It will send when you reconnect.');
      } else {
        setText(body);
        toast.error(apiErrorMessage(error, 'Message could not be sent'));
      }
    } finally {
      setSending(false);
    }
  }
  async function uploadImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (isAdmin || isClosed) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Choose a JPG, PNG or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Images must be 5 MB or smaller.');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const response = await api.post(`/conversations/${conversation.id}/messages`, formData);
      appendMessage(response.data.data.message);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Photo could not be sent'));
    } finally {
      setUploading(false);
    }
  }

  async function shareServiceLocation() {
    if (!canShareLocation || sharingLocation) return;
    if (!navigator.geolocation) {
      toast.error('This browser does not support location sharing.');
      return;
    }
    setSharingLocation(true);
    try {
      const position = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 20000,
        })
      );
      const response = await api.post(`/conversations/${conversation.id}/location`, {
        lat: Number(position.coords.latitude.toFixed(7)),
        lng: Number(position.coords.longitude.toFixed(7)),
      });
      appendMessage(response.data.data.message);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch (error) {
      toast.error(
        typeof error?.code === 'number'
          ? geolocationErrorMessage(error)
          : apiErrorMessage(error, 'Current location could not be shared')
      );
    } finally {
      setSharingLocation(false);
    }
  }

  function addEmoji(emoji) {
    setText((current) => `${current}${emoji}`);
    setEmojiOpen(false);
    textareaRef.current?.focus();
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendText();
    }
  }

  let lastOwnIndex = -1;
  messages.forEach((message, index) => {
    if (Number(message.senderId) === Number(user.id)) lastOwnIndex = index;
  });

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-slate-50/60">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-3 sm:px-4">
        <button
          type="button"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden"
          onClick={onBack}
          aria-label="Back to conversations"
        >
          <Icon name="chevron-left" className="h-5 w-5" />
        </button>
        <div className="relative">
          <Avatar name={conversationTitle} src={otherUser?.avatarUrl} size="sm" />
          {otherUser && (
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white',
                otherUser.online ? 'bg-emerald-500' : 'bg-slate-300'
              )}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-900">{conversationTitle}</p>
          <p className="text-[11px] text-slate-500">
            {otherUser?.online
              ? 'Online now'
              : otherUser?.lastActiveAt
                ? `Active ${timeAgo(otherUser.lastActiveAt)}`
                : 'Offline'}
          </p>
        </div>
        {conversation.request && (
          <Link
            to={requestLink}
            className="hidden items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 sm:inline-flex"
          >
            <span>{conversation.request.category?.icon || 'wrench'}</span>
            <span>Request #{conversation.request.id}</span>
            <StatusBadge status={conversation.request.status} />
          </Link>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-5">
        {messagesQuery.isLoading && (
          <div className="flex h-full items-center justify-center">
            <Spinner className="h-6 w-6 text-brand-700" />
          </div>
        )}
        {messagesQuery.isError && (
          <ErrorState message="Messages could not be loaded." onRetry={messagesQuery.refetch} />
        )}
        {!messagesQuery.isLoading && !messagesQuery.isError && messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
              <Icon name="message" className="h-7 w-7" />
            </span>
            <p className="mt-3 font-semibold text-slate-900">Start the conversation</p>
            <p className="mt-1 max-w-xs text-sm text-slate-500">
              Say hello and share any details that will help with the visit.
            </p>
          </div>
        )}

        {messagesQuery.hasNextPage && (
          <div className="mb-4 flex justify-center">
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => messagesQuery.fetchNextPage()}
              disabled={messagesQuery.isFetchingNextPage}
            >
              {messagesQuery.isFetchingNextPage ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <Icon name="chevron-up" className="h-3.5 w-3.5" />
              )}
              Load earlier messages
            </button>
          </div>
        )}

        <div className="space-y-1">
          {messages.map((message, index) => {
            const mine = Number(message.senderId) === Number(user.id);
            const newDay =
              index === 0 || dayKey(messages[index - 1].createdAt) !== dayKey(message.createdAt);
            const showAvatar =
              !mine &&
              (index === messages.length - 1 ||
                Number(messages[index + 1]?.senderId) !== Number(message.senderId));
            return (
              <Fragment key={message.id}>
                {newDay && (
                  <div className="flex items-center gap-3 py-4">
                    <span className="h-px flex-1 bg-slate-200" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {dayLabel(message.createdAt)}
                    </span>
                    <span className="h-px flex-1 bg-slate-200" />
                  </div>
                )}
                <div
                  className={cn('flex items-end gap-2', mine ? 'justify-end' : 'justify-start')}
                  data-message-id={message.id}
                  data-message-type={message.type}
                >
                  {!mine &&
                    (showAvatar ? (
                      <Avatar name={message.sender?.name} src={message.sender?.avatarUrl} size="xs" />
                    ) : (
                      <span className="w-7 shrink-0" />
                    ))}
                  <div className={cn('max-w-[78%] sm:max-w-[68%]', mine ? 'items-end' : 'items-start')}>
                    {message.type === 'image' && message.imageUrl ? (
                      <a
                        href={message.imageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                      >
                        <img
                          src={message.imageUrl}
                          alt={message.body || 'Shared photo'}
                          className="max-h-72 w-full max-w-xs object-cover"
                          onLoad={() => bottomRef.current?.scrollIntoView({ block: 'end' })}
                        />
                      </a>
                    ) : message.type === 'location' && message.locationShare ? (
                      <div
                        className={cn(
                          'rounded-2xl px-4 py-3 text-sm shadow-sm',
                          mine ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'
                        )}
                      >
                        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
                          <Icon name="map-pin" className="h-4 w-4" />
                          {message.locationShare.mode === 'live'
                            ? 'Live location shared'
                            : 'Current location shared'}
                        </p>
                        {message.body && (
                          <p className={cn('mt-1 text-xs', mine ? 'text-brand-100' : 'text-slate-500')}>
                            {message.body}
                          </p>
                        )}
                        <p className={cn('mt-1 text-xs', mine ? 'text-brand-100' : 'text-slate-500')}>
                          {Number(message.locationShare.lat).toFixed(5)},{' '}
                          {Number(message.locationShare.lng).toFixed(5)}
                        </p>
                        <a
                          href={locationMapUrl(message.locationShare)}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            'mt-2 inline-flex items-center gap-1.5 text-xs font-semibold underline',
                            mine ? 'text-white' : 'text-brand-700'
                          )}
                        >
                          <Icon name="external-link" className="h-3.5 w-3.5" />
                          Open map
                        </a>
                        {message.locationShare.stoppedAt && (
                          <p className={cn('mt-1 text-[11px]', mine ? 'text-brand-200' : 'text-slate-400')}>
                            Sharing stopped
                          </p>
                        )}
                      </div>
                    ) : (
                      <div
                        className={cn(
                          'whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm',
                          mine
                            ? 'rounded-br-md bg-brand-700 text-white'
                            : 'rounded-bl-md bg-white text-slate-700 ring-1 ring-slate-200'
                        )}
                      >
                        {message.body}
                      </div>
                    )}
                    {message.type === 'image' && message.body && (
                      <p className={cn('mt-1 text-xs', mine ? 'text-slate-500' : 'text-slate-500')}>
                        {message.body}
                      </p>
                    )}
                    <div
                      className={cn(
                        'mt-1 flex items-center gap-2 text-[10px] text-slate-400',
                        mine ? 'justify-end' : 'justify-start'
                      )}
                    >
                      <span>{formatTime(message.createdAt)}</span>
                      {mine && index === lastOwnIndex && (
                        <span className={message.seenAt ? 'text-brand-700' : ''} data-message-status>
                          {message.seenAt ? 'Seen' : message.deliveredAt ? 'Delivered' : 'Sent'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Fragment>
            );
          })}
        </div>

        {typingName && (
          <div className="mt-3 flex items-end gap-2" data-typing-indicator>
            <Avatar name={typingName} size="xs" />
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-white px-3.5 py-3 ring-1 ring-slate-200">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <footer className="border-t border-slate-200 bg-white p-3">
        {isAdmin ? (
          <div className="rounded-xl bg-slate-100 px-4 py-3 text-center text-xs text-slate-500">
            Admin view is read-only. Messages cannot be sent from this account.
          </div>
        ) : isClosed ? (
          <div className="rounded-xl bg-slate-100 px-4 py-3 text-center text-xs text-slate-500">
            This conversation is closed because the request was cancelled.
          </div>
        ) : (
          <form onSubmit={sendText}>
            {queuedCount > 0 && (
              <p className="mb-2 flex items-center gap-1.5 text-xs text-amber-700">
                <Icon name="clock" className="h-3.5 w-3.5" />
                {queuedCount} message{queuedCount === 1 ? '' : 's'} waiting to send
              </p>
            )}
            <div className="relative flex items-end gap-1.5">
              <label
                className={cn(
                  'flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800',
                  uploading && 'pointer-events-none opacity-50'
                )}
                title="Take a photo or attach an image"
              >
                {uploading ? <Spinner className="h-4 w-4" /> : <Icon name="camera" className="h-5 w-5" />}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  className="sr-only"
                  onChange={uploadImage}
                  disabled={uploading}
                />
              </label>

              {canShareLocation && (
                <button
                  type="button"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={shareServiceLocation}
                  disabled={sharingLocation}
                  aria-label="Share my current location"
                  title="Share my current location"
                >
                  {sharingLocation ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <Icon name="map-pin" className="h-5 w-5" />
                  )}
                </button>
              )}

              <textarea
                ref={textareaRef}
                rows={1}
                value={text}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                placeholder="Write a message..."
                className="input max-h-32 min-h-10 flex-1 resize-none py-2.5"
                aria-label="Message"
              />

              <div className="relative">
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                  onClick={() => setEmojiOpen((open) => !open)}
                  aria-label="Add emoji"
                >
                  <Icon name="smile" className="h-5 w-5" />
                </button>
                {emojiOpen && (
                  <div className="absolute bottom-12 right-0 z-10 grid w-40 grid-cols-4 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                    {EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="rounded-lg p-1.5 text-lg hover:bg-slate-100"
                        onClick={() => addEmoji(emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={!text.trim() || sending}
                aria-label="Send message"
              >
                {sending ? <Spinner className="h-4 w-4" /> : <Icon name="arrow-up" className="h-4 w-4" />}
              </button>
            </div>
          </form>
        )}
      </footer>
    </div>
  );
}