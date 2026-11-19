import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import api, { apiErrorMessage } from '../lib/api';
import Icon from '../components/Icon';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  Avatar,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  PageLoader,
  Spinner,
  VerifiedBadge,
} from '../components/ui';
import { cn, VERIFICATION_STYLES, titleCase } from '../lib/utils';
import { fetchPushConfig, isPushSupported, subscribeToPush, unsubscribeFromPush } from '../lib/push';

const emptyAddress = { label: '', address: '', city: '', lat: '', lng: '', isDefault: false };

export default function ProfilePage() {
  const { user, refreshUser, logout } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState('profile');
  const [addressModal, setAddressModal] = useState(null);
  const [locating, setLocating] = useState(false);
  const [pushPermission, setPushPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );
  const avatarInput = useRef(null);

  const profileForm = useForm({ defaultValues: { name: user?.name || '', phone: user?.phone || '' } });
  const addressForm = useForm({ defaultValues: emptyAddress });
  const passwordForm = useForm({ defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' } });

  useEffect(() => {
    profileForm.reset({ name: user?.name || '', phone: user?.phone || '' });
  }, [user, profileForm]);

  const addressesQuery = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api.get('/users/me/addresses').then((res) => res.data.data.items),
  });
  const serviceAreasQuery = useQuery({
    queryKey: ['technicians', 'meta'],
    queryFn: () => api.get('/technicians/meta').then((res) => res.data.data),
    staleTime: 5 * 60 * 1000,
  });
  const pushConfigQuery = useQuery({
    queryKey: ['push', 'config'],
    queryFn: fetchPushConfig,
    enabled: tab === 'notifications',
  });

  const saveProfile = useMutation({
    mutationFn: (values) => api.patch('/auth/me', values).then((res) => res.data.data.user),
    onSuccess: (nextUser) => {
      toast.success('Profile updated');
      queryClient.invalidateQueries({ queryKey: ['auth'] });
      refreshUser().catch(() => {});
      profileForm.reset({ name: nextUser.name, phone: nextUser.phone || '' });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const avatarMutation = useMutation({
    mutationFn: (file) => {
      const formData = new FormData();
      formData.append('avatar', file);
      return api.post('/auth/me/avatar', formData).then((res) => res.data.data);
    },
    onSuccess: () => {
      toast.success('Profile photo updated');
      refreshUser().catch(() => {});
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not upload that image')),
  });

  const addressMutation = useMutation({
    mutationFn: ({ id, values }) =>
      id
        ? api.patch(`/users/me/addresses/${id}`, values)
        : api.post('/users/me/addresses', values),
    onSuccess: () => {
      toast.success(addressModal?.id ? 'Address updated' : 'Address saved');
      setAddressModal(null);
      addressForm.reset(emptyAddress);
      queryClient.invalidateQueries({ queryKey: ['addresses'] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const deleteAddress = useMutation({
    mutationFn: (id) => api.delete(`/users/me/addresses/${id}`),
    onSuccess: () => {
      toast.success('Address removed');
      queryClient.invalidateQueries({ queryKey: ['addresses'] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const passwordMutation = useMutation({
    mutationFn: (values) => api.post('/auth/change-password', values),
    onSuccess: async () => {
      toast.success('Password changed. Please log in again.');
      await logout();
      navigate('/login', { replace: true });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const enablePushMutation = useMutation({
    mutationFn: () => subscribeToPush(pushConfigQuery.data?.publicKey),
    onSuccess: () => {
      toast.success('Desktop notifications enabled on this device');
      setPushPermission('granted');
      pushConfigQuery.refetch();
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not enable notifications')),
  });

  const disablePushMutation = useMutation({
    mutationFn: unsubscribeFromPush,
    onSuccess: () => {
      toast.success('Desktop notifications turned off on this device');
      pushConfigQuery.refetch();
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not disable notifications')),
  });

  const testPushMutation = useMutation({
    mutationFn: () => api.post('/notifications/push/test'),
    onSuccess: () => toast.success('Test notification sent. Check your screen.'),
    onError: (error) => toast.error(apiErrorMessage(error, 'Could not send a test notification')),
  });

  if (!user) return <PageLoader />;

  function openAddressModal(address = null) {
    setAddressModal(address || { id: null });
    addressForm.reset(
      address
        ? {
            label: address.label,
            address: address.address,
            city: address.city,
            lat: address.lat,
            lng: address.lng,
            isDefault: address.isDefault,
          }
        : emptyAddress
    );
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      toast.error('Your browser does not support geolocation.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        addressForm.setValue('lat', position.coords.latitude.toFixed(7));
        addressForm.setValue('lng', position.coords.longitude.toFixed(7));
        setLocating(false);
        toast.success('Coordinates captured. Add a complete street address.');
      },
      () => {
        setLocating(false);
        toast.error('Location permission denied. Enter the coordinates manually or pick later.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function submitAddress(values) {
    addressMutation.mutate({
      id: addressModal?.id,
      values: {
        ...values,
        lat: Number(values.lat),
        lng: Number(values.lng),
        isDefault: Boolean(values.isDefault),
      },
    });
  }

  const tabs = [
    { key: 'profile', label: 'Profile', icon: 'user' },
    { key: 'addresses', label: 'Saved addresses', icon: 'map-pin' },
    { key: 'security', label: 'Security', icon: 'shield' },
    { key: 'notifications', label: 'Notifications', icon: 'bell' },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Your profile"
        subtitle="Manage your details, saved service addresses and account security."
        actions={
          user.role === 'technician' ? (
            <Link to="/technician/profile" className="btn-secondary">
              <Icon name="wrench" className="h-4 w-4" />
              Technician profile
            </Link>
          ) : null
        }
      />

      <div className="card mt-4 overflow-hidden">
        <div className="h-24 bg-gradient-to-r from-brand-800 to-brand-600" />
        <div className="flex flex-col gap-4 px-5 pb-5 pt-0 sm:px-6 sm:pt-0">
          <div className="-mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <button
                type="button"
                className="group relative rounded-full"
                onClick={() => avatarInput.current?.click()}
                aria-label="Change profile photo"
              >
                <Avatar name={user.name} src={user.avatarUrl} size="xl" className="ring-4" />
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-950/50 text-white opacity-0 transition group-hover:opacity-100">
                  {avatarMutation.isPending ? <Spinner className="h-5 w-5 text-white" /> : <Icon name="camera" className="h-5 w-5" />}
                </span>
              </button>
              <input
                ref={avatarInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) avatarMutation.mutate(file);
                  event.target.value = '';
                }}
              />
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-slate-900">{user.name}</h2>
                <p className="text-sm text-slate-500">{user.email}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="badge-slate capitalize">{user.role}</span>
                  {user.role === 'technician' && user.technicianProfile && (
                    user.technicianProfile.verificationStatus === 'verified' ? (
                      <VerifiedBadge />
                    ) : (
                      <span className={VERIFICATION_STYLES[user.technicianProfile.verificationStatus]}>
                        {titleCase(user.technicianProfile.verificationStatus)}
                      </span>
                    )
                  )}
                </div>
              </div>
            </div>

            <p className="self-center text-[11px] text-slate-400 sm:pr-2">
              Click your photo to upload a new one
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition',
              tab === item.key ? 'bg-brand-50 text-brand-800' : 'text-slate-500 hover:bg-slate-50'
            )}
          >
            <Icon name={item.icon} className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <div className="card mt-4 p-5 sm:p-6">
          <h2 className="text-lg font-bold text-slate-900">Personal details</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            This is how you appear in chats and service requests.
          </p>
          <form onSubmit={profileForm.handleSubmit((values) => saveProfile.mutate(values))} className="mt-5 space-y-4">
            <Field label="Full name" htmlFor="profile-name" error={profileForm.formState.errors.name?.message} required>
              <input
                id="profile-name"
                className="input"
                {...profileForm.register('name', { required: 'Name is required' })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email address" htmlFor="profile-email" hint="Email changes are handled by support.">
                <input id="profile-email" className="input bg-slate-50" value={user.email} readOnly />
              </Field>
              <Field label="Phone number" htmlFor="profile-phone">
                <input
                  id="profile-phone"
                  className="input"
                  placeholder="+63 917 000 0000"
                  {...profileForm.register('phone')}
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <button type="submit" className="btn-primary" disabled={saveProfile.isPending}>
                {saveProfile.isPending && <Spinner />}
                Save changes
              </button>
            </div>
          </form>
        </div>
      )}

      {tab === 'addresses' && (
        <div className="card mt-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Saved addresses</h2>
              <p className="text-sm text-slate-500">Choose a pin for faster future bookings.</p>
            </div>
            <button type="button" className="btn-primary btn-sm" onClick={() => openAddressModal()}>
              <Icon name="plus" className="h-4 w-4" />
              Add address
            </button>
          </div>

          {addressesQuery.isLoading && <div className="mt-5 skeleton h-28" />}
          {addressesQuery.isError && <div className="mt-5"><ErrorState message="Could not load addresses." onRetry={addressesQuery.refetch} /></div>}
          {addressesQuery.data?.length === 0 && (
            <div className="mt-5 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center">
              <Icon name="map-pin" className="mx-auto h-6 w-6 text-slate-400" />
              <p className="mt-2 text-sm font-semibold text-slate-700">No saved addresses yet</p>
              <p className="text-xs text-slate-500">Add your home or office so booking takes seconds.</p>
            </div>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(addressesQuery.data || []).map((address) => (
              <div key={address.id} className="relative rounded-2xl border border-slate-200 p-4">
                {address.isDefault && <span className="badge-brand mb-2">Default</span>}
                <p className="font-semibold text-slate-900">{address.label}</p>
                <p className="mt-1 text-sm text-slate-600">{address.address}</p>
                <p className="text-xs text-slate-400">{address.city}</p>
                <p className="mt-2 flex items-center gap-1 text-[11px] text-slate-400">
                  <Icon name="map-pin" className="h-3.5 w-3.5" />
                  {Number(address.lat).toFixed(4)}, {Number(address.lng).toFixed(4)}
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => openAddressModal(address)}>
                    <Icon name="edit" className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm text-rose-600 hover:bg-rose-50"
                    onClick={() => {
                      if (window.confirm(`Remove "${address.label}"?`)) deleteAddress.mutate(address.id);
                    }}
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="card mt-4 p-5 sm:p-6">
          <h2 className="text-lg font-bold text-slate-900">Change password</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Changing your password logs you out on every device.
          </p>
          <form
            onSubmit={passwordForm.handleSubmit((values) =>
              passwordMutation.mutate({ currentPassword: values.currentPassword, newPassword: values.newPassword })
            )}
            className="mt-5 max-w-lg space-y-4"
          >
            <Field label="Current password" htmlFor="current-password" error={passwordForm.formState.errors.currentPassword?.message} required>
              <input
                id="current-password"
                type="password"
                className="input"
                autoComplete="current-password"
                {...passwordForm.register('currentPassword', { required: 'Current password is required' })}
              />
            </Field>
            <Field label="New password" htmlFor="new-password" error={passwordForm.formState.errors.newPassword?.message} required hint="At least 8 characters.">
              <input
                id="new-password"
                type="password"
                className="input"
                autoComplete="new-password"
                {...passwordForm.register('newPassword', {
                  required: 'New password is required',
                  minLength: { value: 8, message: 'Use at least 8 characters' },
                })}
              />
            </Field>
            <Field label="Confirm new password" htmlFor="confirm-new-password" error={passwordForm.formState.errors.confirmPassword?.message} required>
              <input
                id="confirm-new-password"
                type="password"
                className="input"
                autoComplete="new-password"
                {...passwordForm.register('confirmPassword', {
                  required: 'Please confirm the new password',
                  validate: (value) => value === passwordForm.watch('newPassword') || 'Passwords do not match',
                })}
              />
            </Field>
          <button type="submit" className="btn-primary" disabled={passwordMutation.isPending}>
            {passwordMutation.isPending && <Spinner />}
            Update password
          </button>
        </form>
      </div>
      )}

      {tab === 'notifications' && (
        <div className="card mt-4 p-5 sm:p-6">
          <h2 className="text-lg font-bold text-slate-900">Desktop notifications</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Get a notification on this laptop for new jobs, request updates and messages, even when
            FixitNow is not open.
          </p>

          <div className="mt-5 space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
            <p className="flex items-center justify-between gap-3">
              <span className="text-slate-600">Browser support</span>
              <span className={cn('font-semibold', isPushSupported() ? 'text-emerald-700' : 'text-rose-600')}>
                {isPushSupported() ? 'Available' : 'Not supported'}
              </span>
            </p>
            <p className="flex items-center justify-between gap-3">
              <span className="text-slate-600">Server configuration</span>
              <span className={cn('font-semibold', pushConfigQuery.data?.configured ? 'text-emerald-700' : 'text-rose-600')}>
                {pushConfigQuery.isLoading
                  ? 'Checking…'
                  : pushConfigQuery.data?.configured
                    ? 'Ready'
                    : 'Unavailable'}
              </span>
            </p>
            <p className="flex items-center justify-between gap-3">
              <span className="text-slate-600">Browser permission</span>
              <span className={cn('font-semibold', pushPermission === 'granted' ? 'text-emerald-700' : 'text-amber-700')}>
                {titleCase(pushPermission)}
              </span>
            </p>
            <p className="flex items-center justify-between gap-3">
              <span className="text-slate-600">This device</span>
              <span className={cn('font-semibold', pushConfigQuery.data?.subscribed ? 'text-emerald-700' : 'text-slate-700')}>
                {pushConfigQuery.data?.subscribed ? 'Enabled' : 'Not enabled'}
              </span>
            </p>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {pushConfigQuery.data?.subscribed && pushPermission === 'granted' ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => disablePushMutation.mutate()}
                disabled={disablePushMutation.isPending}
              >
                {disablePushMutation.isPending && <Spinner />}
                Turn off on this device
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary"
                onClick={() => enablePushMutation.mutate()}
                disabled={
                  !isPushSupported() ||
                  !pushConfigQuery.data?.configured ||
                  pushConfigQuery.isLoading ||
                  enablePushMutation.isPending
                }
              >
                {enablePushMutation.isPending && <Spinner />}
                Enable desktop notifications
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => testPushMutation.mutate()}
              disabled={testPushMutation.isPending}
            >
              {testPushMutation.isPending && <Spinner />}
              Send test notification
            </button>
            <button type="button" className="btn-ghost" onClick={() => pushConfigQuery.refetch()}>
              Refresh status
            </button>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            Allow browser notifications when prompted. Desktop delivery requires the site to be
            opened over HTTPS (localhost is allowed during development), and Chrome or Edge must be
            running with notifications enabled for this device.
          </p>
        </div>
      )}

      <Modal
        open={Boolean(addressModal)}
        onClose={() => setAddressModal(null)}
        title={addressModal?.id ? 'Edit saved address' : 'Add a saved address'}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setAddressModal(null)}>Cancel</button>
            <button type="submit" form="address-form" className="btn-primary" disabled={addressMutation.isPending}>
              {addressMutation.isPending && <Spinner />}
              Save address
            </button>
          </>
        }
      >
        <form id="address-form" onSubmit={addressForm.handleSubmit(submitAddress)} className="space-y-4">
          <Field label="Label" htmlFor="address-label" error={addressForm.formState.errors.label?.message} required>
            <input id="address-label" className="input" placeholder="Home, Office, Rental unit" {...addressForm.register('label', { required: 'Label is required' })} />
          </Field>
          <Field label="Complete address" htmlFor="address-line" error={addressForm.formState.errors.address?.message} required>
            <textarea id="address-line" rows={2} className="input" placeholder="House number, street, barangay" {...addressForm.register('address', { required: 'Address is required' })} />
          </Field>
          <Field label="Municipality / city" htmlFor="address-city" error={addressForm.formState.errors.city?.message} required>
            <select
              id="address-city"
              className="input"
              disabled={serviceAreasQuery.isLoading || serviceAreasQuery.isError}
              {...addressForm.register('city', { required: 'Choose a municipality or city' })}
            >
              <option value="">Choose a municipality or city</option>
              {(serviceAreasQuery.data?.cities || []).map((city) => <option key={city} value={city}>{city}</option>)}
            </select>
          </Field>
          <p className="text-xs text-slate-500">Saved service addresses must be within Oriental Mindoro.</p>
          {serviceAreasQuery.isError && (
            <div className="flex items-center justify-between gap-3 text-xs text-rose-600">
              <span>Service areas could not be loaded.</span>
              <button type="button" className="font-semibold underline" onClick={() => serviceAreasQuery.refetch()}>
                Try again
              </button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-600">Map pin</p>
            <button type="button" className="btn-secondary btn-sm" onClick={useCurrentLocation} disabled={locating}>
              {locating ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="locate" className="h-3.5 w-3.5" />}
              Use my location
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude" htmlFor="address-lat" error={addressForm.formState.errors.lat?.message} required>
              <input
                id="address-lat"
                className="input"
                inputMode="decimal"
                placeholder="13.1537659"
                {...addressForm.register('lat', {
                  required: 'Latitude is required',
                  min: { value: -90, message: 'Invalid latitude' },
                  max: { value: 90, message: 'Invalid latitude' },
                })}
              />
            </Field>
            <Field label="Longitude" htmlFor="address-lng" error={addressForm.formState.errors.lng?.message} required>
              <input
                id="address-lng"
                className="input"
                inputMode="decimal"
                placeholder="121.1860637"
                {...addressForm.register('lng', {
                  required: 'Longitude is required',
                  min: { value: -180, message: 'Invalid longitude' },
                  max: { value: 180, message: 'Invalid longitude' },
                })}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-700" {...addressForm.register('isDefault')} />
            Make this my default address
          </label>
        </form>
      </Modal>
    </div>
  );
}