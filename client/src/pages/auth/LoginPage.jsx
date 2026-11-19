import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { apiErrorMessage } from '../../lib/api';
import { roleHome, useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import Icon from '../../components/Icon';
import { Field, Spinner } from '../../components/ui';

export default function LoginPage() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { email: '', password: '' } });

  async function onSubmit(values) {
    try {
      const user = await login(values);
      toast.success(`Welcome back, ${user.name.split(' ')[0]}!`);
      const from = location.state?.from;
      const destination = from ? `${from.pathname}${from.search || ''}` : roleHome(user.role);
      navigate(destination, { replace: true });
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Unable to log in'));
    }
  }

  return (
    <div>
      <Link to="/" className="mb-8 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-900">
        <Icon name="chevron-left" className="h-4 w-4" />
        Back to home
      </Link>
      <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Welcome back</h1>
      <p className="mt-2 text-sm text-slate-500">
        Log in to track repairs, manage jobs or run the FixitNow console.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-7 space-y-4" noValidate>
        <Field label="Email address" htmlFor="email" error={errors.email?.message} required>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="input"
            placeholder="you@example.com"
            {...register('email', { required: 'Email is required' })}
          />
        </Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message} required>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className="input pr-11"
              placeholder="Enter your password"
              {...register('password', { required: 'Password is required' })}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-600"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <Icon name={showPassword ? 'eye-off' : 'eye'} className="h-4 w-4" />
            </button>
          </div>
        </Field>
        <div className="-mt-2 text-right">
          <Link to="/forgot-password" className="text-xs font-semibold text-brand-700 hover:text-brand-900">
            Forgot password?
          </Link>
        </div>
        <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
          {isSubmitting ? <Spinner /> : null}
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-slate-500">
        New to FixitNow?{' '}
        <Link to="/register" className="font-semibold text-brand-700 hover:text-brand-900">
          Create an account
        </Link>
      </p>
    </div>
  );
}