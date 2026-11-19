import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api, { apiErrorMessage } from '../../lib/api';
import Icon from '../../components/Icon';
import { Avatar, ErrorState, Field, PageHeader, PageLoader, Spinner, VerifiedBadge } from '../../components/ui';
import { useToast } from '../../contexts/ToastContext';
import { cn, formatDate, todayISO } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';
import { cacheOfflineFormData, getCachedOfflineFormData, queueOfflineRequest } from '../../lib/offlineRequests';
import { coordinatesForCity, reverseGeocode } from '../../lib/geocode';

const TIME_SLOTS = [
  '08:00-10:00',
  '10:00-12:00',
  '13:00-15:00',
  '15:00-17:00',
  '17:00-19:00',
];

const URGENCIES = [
  { value: 'low', label: 'Low', text: 'Can wait a few days' },
  { value: 'normal', label: 'Normal', text: 'Convenient schedule' },
  { value: 'high', label: 'High', text: 'Needs attention soon' },
  { value: 'emergency', label: 'Emergency', text: 'Unsafe or urgent' },
];

const EMPTY_FORM = {
  categoryId: '',
  applianceBrand: '',
  applianceModel: '',
  issueDescription: '',
  urgency: 'normal',
  preferredDate: todayISO(1),
  timeSlot: '10:00-12:00',
  addressMode: 'saved',
  savedAddressId: '',
  addressLabel: '',
  address: '',
  city: '',
  lat: '',
  lng: '',
};

export default function RequestFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [preferredId, setPreferredId] = useState(searchParams.get('technicianId'));
  const [photos, setPhotos] = useState([]);
  const [formError, setFormError] = useState('');
  const [locating, setLocating] = useState(false);
  const [queuePending, setQueuePending] = useState(false);
  const photosRef = useRef([]);
  const initialized = useRef(false);

  const metaQuery = useQuery({
    queryKey: ['request-form', 'meta'],
    queryFn: async () => {
      try {
        const response = await api.get('/technicians/meta');
        cacheOfflineFormData('request-form:meta', response.data.data).catch((error) => {
          console.error('Could not cache request form categories for offline use.', error);
        });
        return response.data.data;
      } catch (error) {
        if (!navigator.onLine) {
          const cached = await getCachedOfflineFormData('request-form:meta');
          if (cached) return cached;
        }
        throw error;
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  const addressesQuery = useQuery({
    queryKey: ['addresses', 'list', user.id],
    queryFn: async () => {
      try {
        const response = await api.get('/users/me/addresses');
        const addresses = response.data.data.items;
        cacheOfflineFormData(`request-form:addresses:${user.id}`, addresses).catch((error) => {
          console.error('Could not cache saved addresses for offline use.', error);
        });
        return addresses;
      } catch (error) {
        if (!navigator.onLine) {
          const cached = await getCachedOfflineFormData(`request-form:addresses:${user.id}`);
          if (cached) return cached;
        }
        throw error;
      }
    },
  });

  const requestQuery = useQuery({
    queryKey: ['requests', 'detail', id],
    queryFn: () => api.get(`/requests/${id}`).then((res) => res.data.data.request),
    enabled: isEdit,
  });

  const preferredQuery = useQuery({
    queryKey: ['technicians', 'public', preferredId],
    queryFn: () => api.get(`/technicians/${preferredId}`).then((res) => res.data.data.profile),
    enabled: Boolean(preferredId),
    retry: false,
  });

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    getValues,
    trigger,
    formState: { errors },
  } = useForm({ defaultValues: EMPTY_FORM });

  const addressMode = watch('addressMode');
  const savedAddressId = watch('savedAddressId');
  const categoryId = watch('categoryId');
  const preferredDate = watch('preferredDate');
  const timeSlot = watch('timeSlot');
  const urgency = watch('urgency');

  const addresses = useMemo(
    () => (addressesQuery.data || []).filter((address) => (metaQuery.data?.cities || []).includes(address.city)),
    [addressesQuery.data, metaQuery.data]
  );
  const serviceCities = metaQuery.data?.cities;
  const categories = metaQuery.data?.categories || [];
  const request = requestQuery.data;
  const scheduleOnly = isEdit && request?.status === 'accepted';
  const editable =
    !isEdit || (request && ['pending', 'accepted'].includes(request.status));

  photosRef.current = photos;
  useEffect(
    () => () => {
      photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.preview));
    },
    []
  );

  useEffect(() => {
    if (initialized.current) return;
    if (!metaQuery.isSuccess || !addressesQuery.isSuccess) return;
    if (isEdit && !requestQuery.isSuccess) return;
    if (preferredId && !preferredQuery.isFetched) return;

    if (isEdit) {
      reset({
        categoryId: String(request.categoryId),
        applianceBrand: request.applianceBrand || '',
        applianceModel: request.applianceModel || '',
        issueDescription: request.issueDescription,
        urgency: request.urgency,
        preferredDate: String(request.preferredDate).slice(0, 10),
        timeSlot: request.timeSlot,
        addressMode: 'manual',
        savedAddressId: '',
        addressLabel: '',
        address: request.address || '',
        city: request.city || '',
        lat: request.lat === null || request.lat === undefined ? '' : Number(request.lat),
        lng: request.lng === null || request.lng === undefined ? '' : Number(request.lng),
      });
      initialized.current = true;
      return;
    }

    const defaultAddress = addresses.find((item) => item.isDefault) || addresses[0];
    const preferredCategory = preferredQuery.data?.skills?.[0]?.id;
    reset({
      ...EMPTY_FORM,
      categoryId: preferredCategory ? String(preferredCategory) : '',
      addressMode: defaultAddress ? 'saved' : 'manual',
      savedAddressId: defaultAddress ? String(defaultAddress.id) : '',
    });
    initialized.current = true;
  }, [
    addresses,
    addressesQuery.isSuccess,
    isEdit,
    metaQuery.isSuccess,
    preferredId,
    preferredQuery.data,
    preferredQuery.isFetched,
    request,
    requestQuery.isSuccess,
    reset,
  ]);

  const createMutation = useMutation({
    mutationFn: (formData) => api.post('/requests', formData).then((res) => res.data.data.request),
  });

  const updateMutation = useMutation({
    mutationFn: (payload) => api.patch(`/requests/${id}`, payload).then((res) => res.data.data.request),
  });

  const saveAddressMutation = useMutation({
    mutationFn: (values) => api.post('/users/me/addresses', values).then((res) => res.data.data),
    onSuccess: (address) => {
      queryClient.setQueryData(['addresses', 'list'], (current) => [
        address,
        ...(current || []).filter((item) => item.id !== address.id),
      ]);
      queryClient.setQueryData(['addresses', 'list', user.id], (current) => [
        address,
        ...(current || []).filter((item) => item.id !== address.id),
      ]);
      cacheOfflineFormData(`request-form:addresses:${user.id}`, [
        address,
        ...addresses.filter((item) => item.id !== address.id),
      ]).catch((error) => console.error('Could not update cached saved addresses.', error));
      queryClient.invalidateQueries({ queryKey: ['addresses'] });
      setValue('addressMode', 'saved', { shouldDirty: true });
      setValue('savedAddressId', String(address.id), { shouldDirty: true });
      toast.success('Address added to your saved addresses.');
    },
    onError: (error) => toast.error(apiErrorMessage(error, 'Address could not be saved.')),
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending || queuePending;
  const selectedCategory = categories.find((category) => String(category.id) === String(categoryId));
  const selectedAddress = addresses.find((item) => String(item.id) === String(savedAddressId));

  const pageTitle = scheduleOnly
    ? 'Reschedule your visit'
    : isEdit
      ? 'Edit service request'
      : 'Book a repair';
  const pageSubtitle = scheduleOnly
    ? 'Your technician is assigned. Choose a new date or time slot and we will notify them.'
    : isEdit
      ? 'Update the details while the request is still open.'
      : 'Tell us what is wrong, choose a visit window and we will match you with a verified pro.';

  if (
    (!isEdit && (!metaQuery.isSuccess || !addressesQuery.isSuccess)) ||
    (isEdit && (requestQuery.isLoading || !metaQuery.isSuccess || !addressesQuery.isSuccess))
  ) {
    return <PageLoader label="Preparing your booking form" />;
  }
  if (metaQuery.isError || addressesQuery.isError || (isEdit && requestQuery.isError) || !editable) {
    return (
      <ErrorState
        message="We could not prepare this request form."
        onRetry={() => {
          metaQuery.refetch();
          addressesQuery.refetch();
          if (isEdit) requestQuery.refetch();
        }}
      />
    );
  }

  function addPhotos(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const remaining = 5 - photos.length;
    if (remaining <= 0) {
      toast.warning('You can attach up to 5 photos.');
      event.target.value = '';
      return;
    }
    const accepted = [];
    for (const file of files) {
      if (accepted.length >= remaining) {
        toast.warning('Only the first 5 photos were added.');
        break;
      }
      if (!file.type.startsWith('image/')) {
        toast.error(`${file.name} is not an image.`);
        continue;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name} is larger than 5 MB.`);
        continue;
      }
      accepted.push({ file, preview: URL.createObjectURL(file) });
    }
    setPhotos((current) => [...current, ...accepted]);
    event.target.value = '';
  }

  function removePhoto(index) {
    setPhotos((current) => {
      URL.revokeObjectURL(current[index].preview);
      return current.filter((_, photoIndex) => photoIndex !== index);
    });
  }

  async function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error('Location is not available in this browser.');
      return;
    }
    setLocating(true);
    let coordinatesAdded = false;
    try {
      const position = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
        })
      );
      const lat = Number(position.coords.latitude.toFixed(7));
      const lng = Number(position.coords.longitude.toFixed(7));
      setValue('lat', lat, { shouldValidate: true, shouldDirty: true });
      setValue('lng', lng, { shouldValidate: true, shouldDirty: true });
      coordinatesAdded = true;

      const location = await reverseGeocode(lat, lng, serviceCities || []);
      setValue('address', location.address, { shouldValidate: true, shouldDirty: true });
      setValue('city', location.city, { shouldValidate: true, shouldDirty: true });

      if (location.address && location.city) {
        toast.success('Location filled. Please review the detected address.');
      } else {
        toast.warning('Coordinates were added. Review the address and choose a supported municipality.');
      }
    } catch (error) {
      if (typeof error?.code === 'number') {
        toast.error('We could not read your location. Check your browser permission and try again.');
      } else if (coordinatesAdded) {
        toast.warning('Coordinates were added, but address lookup failed. Enter the address and municipality manually.');
      } else {
        toast.error(apiErrorMessage(error, 'We could not read your location. Try again or enter it manually.'));
      }
    } finally {
      setLocating(false);
    }
  }

  async function saveManualAddress() {
    const valid = await trigger(['address', 'city']);
    if (!valid) {
      toast.error('Complete the address and municipality before saving.');
      return;
    }

    const values = getValues();
    if (!values.addressLabel.trim()) {
      toast.error('Enter a label such as Home or Office before saving.');
      return;
    }
    const coordinates = coordinatesForCity(values.city.trim());
    const address = {
      label: values.addressLabel.trim(),
      address: values.address.trim(),
      city: values.city,
      lat: Number.isFinite(Number(values.lat)) ? Number(values.lat) : coordinates.lat,
      lng: Number.isFinite(Number(values.lng)) ? Number(values.lng) : coordinates.lng,
      isDefault: false,
    };
    const duplicate = addresses.find(
      (item) =>
        item.address.toLowerCase() === address.address.toLowerCase() &&
        item.city === address.city &&
        Number(item.lat) === address.lat &&
        Number(item.lng) === address.lng
    );
    if (duplicate) {
      setValue('addressMode', 'saved', { shouldDirty: true });
      setValue('savedAddressId', String(duplicate.id), { shouldDirty: true });
      toast.success('This address is already saved and has been selected.');
      return;
    }
    saveAddressMutation.mutate(address);
  }

  async function onSubmit(values) {
    setFormError('');
    try {
      if (isEdit) {
        const payload = scheduleOnly
          ? { preferredDate: values.preferredDate, timeSlot: values.timeSlot }
          : {
              categoryId: Number(values.categoryId),
              applianceBrand: values.applianceBrand.trim() || null,
              applianceModel: values.applianceModel.trim() || null,
              issueDescription: values.issueDescription.trim(),
              urgency: values.urgency,
              preferredDate: values.preferredDate,
              timeSlot: values.timeSlot,
              ...(values.addressMode === 'saved'
                ? { savedAddressId: Number(values.savedAddressId) }
                : {
                    address: values.address.trim(),
                    city: values.city.trim(),
                    lat: Number(values.lat),
                    lng: Number(values.lng),
                  }),
            };
        const updated = await updateMutation.mutateAsync(payload);
        queryClient.invalidateQueries({ queryKey: ['requests'] });
        toast.success(scheduleOnly ? 'Visit rescheduled' : 'Request updated');
        navigate(`/requests/${updated.id}`);
        return;
      }

      const formData = new FormData();
      formData.append('categoryId', String(values.categoryId));
      if (values.applianceBrand.trim()) formData.append('applianceBrand', values.applianceBrand.trim());
      if (values.applianceModel.trim()) formData.append('applianceModel', values.applianceModel.trim());
      formData.append('issueDescription', values.issueDescription.trim());
      formData.append('urgency', values.urgency);
      formData.append('preferredDate', values.preferredDate);
      formData.append('timeSlot', values.timeSlot);
      if (values.addressMode === 'saved') {
        formData.append('savedAddressId', String(values.savedAddressId));
      } else {
        const coordinates = coordinatesForCity(values.city.trim());
        const lat = Number.isFinite(Number(values.lat)) ? Number(values.lat) : coordinates.lat;
        const lng = Number.isFinite(Number(values.lng)) ? Number(values.lng) : coordinates.lng;
        formData.append('address', values.address.trim());
        formData.append('city', values.city.trim());
        formData.append('lat', String(lat));
        formData.append('lng', String(lng));
      }
      if (preferredId && preferredQuery.data) {
        formData.append('preferredTechnicianId', String(preferredId));
      }
      photos.forEach((photo) => formData.append('photos', photo.file));

      if (!navigator.onLine) {
        const entries = Array.from(formData.entries());
        const addressSummary =
          values.addressMode === 'saved'
            ? selectedAddress?.address || ''
            : values.address.trim();
        setQueuePending(true);
        try {
          await queueOfflineRequest(user.id, entries, {
            category: selectedCategory?.name || 'Service request',
            issueDescription: values.issueDescription.trim(),
            preferredDate: values.preferredDate,
            timeSlot: values.timeSlot,
            address: addressSummary,
            city: values.addressMode === 'saved' ? selectedAddress?.city || '' : values.city.trim(),
            photoCount: photos.length,
          });
        } finally {
          setQueuePending(false);
        }
        toast.success('Request saved on this device. It will be sent when you reconnect.');
        navigate('/requests');
        return;
      }

      const created = await createMutation.mutateAsync(formData);
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'customer'] });
      toast.success('Request submitted. We will notify you when a technician responds.');
      navigate(`/requests/${created.id}`);
    } catch (error) {
      const message = apiErrorMessage(error, 'We could not save your request.');
      setFormError(message);
      toast.error(message);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={pageTitle}
        subtitle={pageSubtitle}
        backTo={isEdit ? `/requests/${id}` : '/requests'}
        backLabel="Back to requests"
      />

      <form onSubmit={handleSubmit(onSubmit)}>
        {formError && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0" />
            {formError}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            <section className="card p-5 sm:p-6">
              <div className="mb-5 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <Icon name="wrench" className="h-4 w-4" />
                </span>
                <h2 className="text-lg font-bold text-slate-900">The appliance</h2>
              </div>

              <div className="space-y-4">
                <Field label="Service category" htmlFor="categoryId" error={errors.categoryId?.message} required>
                  <select
                    id="categoryId"
                    className="input"
                    disabled={scheduleOnly}
                    {...register('categoryId', { required: 'Choose a service category' })}
                  >
                    <option value="">Select a category</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.icon} {category.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Brand" htmlFor="applianceBrand" hint="Optional">
                    <input
                      id="applianceBrand"
                      className="input"
                      placeholder="e.g. LG, Samsung, Carrier"
                      disabled={scheduleOnly}
                      {...register('applianceBrand')}
                    />
                  </Field>
                  <Field label="Model" htmlFor="applianceModel" hint="Optional">
                    <input
                      id="applianceModel"
                      className="input"
                      placeholder="e.g. FC1200S4W"
                      disabled={scheduleOnly}
                      {...register('applianceModel')}
                    />
                  </Field>
                </div>

                <Field
                  label="What is happening?"
                  htmlFor="issueDescription"
                  error={errors.issueDescription?.message}
                  hint="Include sounds, leaks, error codes and when the problem started."
                  required
                >
                  <textarea
                    id="issueDescription"
                    rows={5}
                    className="input resize-y"
                    placeholder="Describe the problem so your technician can prepare the right tools and parts."
                    disabled={scheduleOnly}
                    {...register('issueDescription', {
                      required: 'Describe the problem',
                      minLength: { value: 10, message: 'Please add at least 10 characters' },
                      maxLength: { value: 4000, message: 'Keep the description under 4000 characters' },
                    })}
                  />
                </Field>

                <Field label="How urgent is it?" error={errors.urgency?.message}>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {URGENCIES.map((option) => (
                      <label
                        key={option.value}
                        className={cn(
                          'cursor-pointer rounded-xl border px-3 py-2.5 text-center transition',
                          urgency === option.value
                            ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-500/30'
                            : 'border-slate-200 hover:border-slate-300',
                          scheduleOnly && 'cursor-not-allowed opacity-60'
                        )}
                      >
                        <input
                          type="radio"
                          value={option.value}
                          className="sr-only"
                          disabled={scheduleOnly}
                          {...register('urgency', { required: 'Choose an urgency' })}
                        />
                        <span className="block text-xs font-bold text-slate-900">{option.label}</span>
                        <span className="mt-0.5 block text-[10px] leading-tight text-slate-500">{option.text}</span>
                      </label>
                    ))}
                  </div>
                </Field>
              </div>
            </section>

            <section className="card p-5 sm:p-6">
              <div className="mb-5 flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <Icon name="calendar" className="h-4 w-4" />
                </span>
                <h2 className="text-lg font-bold text-slate-900">Preferred visit</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Date" htmlFor="preferredDate" error={errors.preferredDate?.message} required>
                  <input
                    id="preferredDate"
                    type="date"
                    min={todayISO()}
                    className="input"
                    {...register('preferredDate', { required: 'Choose a visit date' })}
                  />
                </Field>
                <Field label="Time slot" htmlFor="timeSlot" error={errors.timeSlot?.message} required>
                  <select
                    id="timeSlot"
                    className="input"
                    {...register('timeSlot', { required: 'Choose a time slot' })}
                  >
                    {TIME_SLOTS.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot.replace('-', ' – ')}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-400">
                <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                You can reschedule or cancel from the request page until the technician starts
                the visit.
              </p>
            </section>

            {!scheduleOnly && (
              <section className="card p-5 sm:p-6">
                <div className="mb-5 flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                    <Icon name="map-pin" className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Service address</h2>
                    <p className="text-xs text-slate-500">We currently serve Oriental Mindoro only.</p>
                  </div>
                </div>

                {addresses.length > 0 && (
                  <div className="mb-4 grid gap-2 sm:grid-cols-2">
                    {addresses.map((address) => (
                      <label
                        key={address.id}
                        className={cn(
                          'cursor-pointer rounded-xl border p-3 transition',
                          addressMode === 'saved' && String(savedAddressId) === String(address.id)
                            ? 'border-brand-600 bg-brand-50/60 ring-1 ring-brand-500/20'
                            : 'border-slate-200 hover:border-slate-300'
                        )}
                      >
                        <input
                          type="radio"
                          value={address.id}
                          className="sr-only"
                          {...register('savedAddressId')}
                          onClick={() => setValue('addressMode', 'saved')}
                        />
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900">{address.label}</span>
                          {address.isDefault && <span className="badge-brand">Default</span>}
                        </span>
                        <span className="mt-1 block text-xs text-slate-500">{address.address}</span>
                        <span className="text-xs text-slate-400">{address.city}</span>
                      </label>
                    ))}
                    <label
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition',
                        addressMode === 'manual'
                          ? 'border-brand-600 bg-brand-50/60 ring-1 ring-brand-500/20'
                          : 'border-slate-200 hover:border-slate-300'
                      )}
                    >
                      <input type="radio" value="manual" className="sr-only" {...register('addressMode')} />
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                        <Icon name="edit" className="h-4 w-4" />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-slate-900">Use another address</span>
                        <span className="text-xs text-slate-500">Enter a one-time service address</span>
                      </span>
                    </label>
                  </div>
                )}

                {addressMode === 'manual' && (
                  <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                    <Field label="Street address" htmlFor="address" error={errors.address?.message} required>
                      <input
                        id="address"
                        className="input"
                        placeholder="House number, street and barangay"
                        {...register('address', {
                          required: 'Enter the street address',
                          minLength: { value: 5, message: 'Add more address detail' },
                        })}
                      />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Municipality / city" htmlFor="city" error={errors.city?.message} required>
                        <select
                          id="city"
                          className="input"
                          {...register('city', { required: 'Choose your municipality or city' })}
                        >
                          <option value="">Choose a municipality or city</option>
                          {(serviceCities || []).map((city) => <option key={city} value={city}>{city}</option>)}
                        </select>
                      </Field>
                      <div className="flex items-end">
                        <button
                          type="button"
                          className="btn-secondary w-full"
                          onClick={useMyLocation}
                          disabled={locating}
                        >
                          {locating ? <Spinner className="h-4 w-4" /> : <Icon name="locate" className="h-4 w-4" />}
                          {locating ? 'Finding your address...' : 'Use my location'}
                        </button>
                      </div>
                    </div>
                    <p className="flex items-start gap-1.5 text-xs text-slate-500">
                      <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-700" />
                      Use my location fills in your address automatically. Otherwise, choose your
                      municipality and we will place the map pin for you.
                    </p>
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <Field
                        label="Save this address as"
                        htmlFor="addressLabel"
                        error={errors.addressLabel?.message}
                        hint="For example: Home or Office"
                      >
                        <input
                          id="addressLabel"
                          className="input"
                          placeholder="Home, Office, or another label"
                          maxLength={80}
                          {...register('addressLabel', {
                            maxLength: { value: 80, message: 'Keep the label under 80 characters' },
                          })}
                        />
                      </Field>
                      <button
                        type="button"
                        className="btn-secondary btn-sm mt-3"
                        onClick={saveManualAddress}
                        disabled={saveAddressMutation.isPending}
                      >
                        {saveAddressMutation.isPending ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <Icon name="plus" className="h-4 w-4" />
                        )}
                        Save address for future requests
                      </button>
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-400">
                      Coordinates power the service map and arrival view. Address details are provided by OpenStreetMap; please verify them before booking.
                    </p>
                  </div>
                )}
              </section>
            )}

            {!isEdit && (
              <section className="card p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                      <Icon name="camera" className="h-4 w-4" />
                    </span>
                    <div>
                      <h2 className="text-lg font-bold text-slate-900">Photos</h2>
                      <p className="text-xs text-slate-500">Optional but helpful for diagnosis.</p>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-slate-400">{photos.length}/5</span>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.map((photo, index) => (
                    <div key={photo.preview} className="group relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                      <img src={photo.preview} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removePhoto(index)}
                        className="absolute right-1.5 top-1.5 rounded-full bg-slate-950/70 p-1 text-white hover:bg-rose-600"
                        aria-label="Remove photo"
                      >
                        <Icon name="x" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {photos.length < 5 && (
                    <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 bg-white text-slate-500 transition hover:border-brand-400 hover:bg-brand-50/40 hover:text-brand-700">
                      <Icon name="plus" className="h-6 w-6" />
                      <span className="text-[11px] font-semibold">Add photo</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        className="sr-only"
                        onChange={addPhotos}
                      />
                    </label>
                  )}
                </div>
                <p className="mt-3 text-[11px] text-slate-400">
                  JPG, PNG or WebP, up to 5 MB each. Photos are only shared with your technician and
                  admins.
                </p>
              </section>
            )}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <div className="card p-5">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Booking summary</h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-slate-500">Service</dt>
                  <dd className="text-right font-semibold text-slate-900">
                    {selectedCategory ? `${selectedCategory.icon} ${selectedCategory.name}` : 'Not chosen'}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-slate-500">Date</dt>
                  <dd className="text-right font-semibold text-slate-900">{formatDate(preferredDate)}</dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-slate-500">Time</dt>
                  <dd className="text-right font-semibold text-slate-900">{timeSlot}</dd>
                </div>
                {!scheduleOnly && (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-slate-500">Address</dt>
                    <dd className="max-w-[65%] text-right text-xs font-medium leading-relaxed text-slate-700">
                      {addressMode === 'saved'
                        ? selectedAddress
                          ? `${selectedAddress.label}: ${selectedAddress.address}`
                          : 'Choose a saved address'
                        : 'One-time address'}
                    </dd>
                  </div>
                )}
                <div className="flex items-start justify-between gap-3">
                  <dt className="text-slate-500">Urgency</dt>
                  <dd className="font-semibold capitalize text-slate-900">{urgency}</dd>
                </div>
              </dl>

              <button
                type="submit"
                className="btn-primary mt-5 w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? <Spinner className="h-4 w-4" /> : <Icon name="check" className="h-4 w-4" />}
                {scheduleOnly ? 'Save new schedule' : isEdit ? 'Save changes' : 'Submit request'}
              </button>
              <p className="mt-2 text-center text-[11px] text-slate-400">
                You can review everything before a technician is assigned.
              </p>
            </div>

            {preferredId && preferredQuery.data && (
              <div className="card border-brand-200 bg-brand-50/50 p-5">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-bold text-brand-900">Preferred technician</h2>
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-brand-700 hover:underline"
                    onClick={() => setPreferredId(null)}
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <Avatar name={preferredQuery.data.name} src={preferredQuery.data.user?.avatarUrl} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">{preferredQuery.data.name}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <VerifiedBadge />
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-brand-900/70">
                  We will send this job directly to {preferredQuery.data.name.split(' ')[0]} first.
                </p>
              </div>
            )}

            {preferredId && preferredQuery.isError && (
              <div className="card border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                <div className="flex items-start gap-2">
                  <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="flex-1">
                    This technician is not available for direct booking. Your request will go to
                    the open job board.
                  </div>
                  <button type="button" className="font-semibold hover:underline" onClick={() => setPreferredId(null)}>
                    Clear
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-2xl bg-slate-900 p-5 text-white">
              <h3 className="flex items-center gap-2 text-sm font-bold">
                <Icon name="shield-check" className="h-4 w-4 text-brand-300" />
                What happens next?
              </h3>
              <ol className="mt-3 space-y-2.5 text-xs leading-relaxed text-slate-300">
                <li className="flex gap-2"><span className="font-bold text-brand-300">1.</span> A verified technician accepts your request.</li>
                <li className="flex gap-2"><span className="font-bold text-brand-300">2.</span> Chat and live arrival details open on the request page.</li>
                <li className="flex gap-2"><span className="font-bold text-brand-300">3.</span> Pay only after the job is completed.</li>
              </ol>
            </div>

            <Link to="/technicians" className="flex items-center justify-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-900">
              <Icon name="users" className="h-4 w-4" />
              Browse verified technicians
            </Link>
          </aside>
        </div>
      </form>
    </div>
  );
}