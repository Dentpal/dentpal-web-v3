// Extend the Window interface to allow __orderHandler for handler tracking
interface Window {
  __orderHandler?: {
    id?: string;
    email?: string;
    displayName?: string;
  };
}