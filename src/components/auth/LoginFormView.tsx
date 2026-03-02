import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, EyeOff, Mail, Lock, AlertCircle, XCircle, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  email: string;
  password: string;
  rememberMe: boolean;
  showPassword: boolean;
  loading: boolean;
  error?: string | null;
  showErrorDialog: boolean;
  errorMessage: string;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
  onRemember: (v: boolean) => void;
  onTogglePassword: () => void;
  onCloseError: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onForgotPassword?: () => void;
};

export default function LoginFormView({
  email,
  password,
  rememberMe,
  showPassword,
  loading,
  error,
  showErrorDialog,
  errorMessage,
  onEmail,
  onPassword,
  onRemember,
  onTogglePassword,
  onCloseError,
  onSubmit,
  onForgotPassword,
}: Props) {
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <div className="space-y-5">
        <div className="relative">
          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
          <Input
            id="email"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => onEmail(e.target.value)}
            disabled={loading}
            autoComplete="username"
            className={`pl-12 ${email ? 'pr-12' : ''} h-14 bg-gray-50 rounded-xl text-gray-700 placeholder-gray-400 focus:bg-white transition-colors duration-200 ${
              error ? "border-red-300 focus:border-red-500 focus:ring-red-500" : "border-gray-200 focus:border-teal-500 focus:ring-teal-500"
            }`}
            required
          />
          {email && !loading && (
            <button
              type="button"
              onClick={() => onEmail('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              aria-label="Clear email"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="relative">
          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(e) => onPassword(e.target.value)}
            disabled={loading}
            autoComplete="current-password"
            className={`pl-12 pr-12 h-14 bg-gray-50 rounded-xl text-gray-700 placeholder-gray-400 focus:bg-white transition-colors duration-200 ${
              error ? "border-red-300 focus:border-red-500 focus:ring-red-500" : "border-gray-200 focus:border-teal-500 focus:ring-teal-500"
            }`}
            required
          />
          <button type="button" onClick={onTogglePassword} disabled={loading} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="remember"
          checked={rememberMe}
          onCheckedChange={(c) => onRemember(Boolean(c))}
          disabled={loading}
          className="data-[state=checked]:bg-teal-500 data-[state=checked]:border-teal-500"
        />
        <Label htmlFor="remember" className="text-sm text-gray-600 cursor-pointer">
          Remember me
        </Label>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-sm font-medium text-red-800 mb-1">Authentication Failed</h4>
            <p className="text-sm text-red-700">{error}</p>
          </div>
        </div>
      )}

      <Button type="submit" disabled={loading} className="w-full h-14 bg-teal-500 hover:bg-teal-600 text-white font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed">
        {loading ? "Signing in..." : "Log In"}
      </Button>

      <div className="text-center">
        <button 
          type="button" 
          onClick={onForgotPassword}
          className="text-sm text-teal-600 hover:text-teal-700 font-medium" 
          disabled={loading}
        >
          Forgot Password?
        </button>
      </div>

     <AlertDialog
  open={showErrorDialog}
  onOpenChange={(open) => {
    if (!open) onCloseError();
  }}
>
  <AlertDialogContent className="sm:max-w-sm p-0 overflow-hidden rounded-3xl border border-gray-100 shadow-xl bg-white">
    <div className="p-7 text-center flex flex-col items-center">

      {/* Icon wrapper */}
      <div className="h-16 w-16 rounded-2xl bg-red-50 flex items-center justify-center shadow-inner mb-5">
        <XCircle className="h-10 w-10 text-red-500" />
      </div>

      {/* Header */}
      <AlertDialogHeader className="space-y-1">
        <AlertDialogTitle className="text-[20px] font-semibold text-gray-900 tracking-wide">
          Something went wrong
        </AlertDialogTitle>

        <AlertDialogDescription className="text-sm text-gray-500">
          Please try again or check your connection.
        </AlertDialogDescription>
      </AlertDialogHeader>

      {/* Error message */}
      {errorMessage && (
        <div className="mt-3 text-sm text-red-600 bg-red-50 w-full py-2 px-3 rounded-lg">
          {errorMessage}
        </div>
      )}

      {/* Footer */}
      <AlertDialogFooter className="mt-7 w-full">
        <AlertDialogAction
          className="w-full h-11 rounded-xl font-medium bg-red-500 hover:bg-red-600 active:scale-[0.98] transition-all text-white shadow-md"
        >
          Try Again
        </AlertDialogAction>
      </AlertDialogFooter>
    </div>
  </AlertDialogContent>
</AlertDialog>

    </form>
  );
}