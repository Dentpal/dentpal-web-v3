export const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);

// Helper to normalize Firestore Timestamp/number/string to Date
const normalizeToDate = (value: any): Date | null => {
  try {
    if (!value) return null;
    
    // If it's already a Date
    if (value instanceof Date) {
      return value;
    }
    
    // If it's a Firestore Timestamp with toDate method
    if (typeof value.toDate === 'function') {
      return value.toDate();
    }
    
    // If it's a Firestore Timestamp with seconds property
    if (typeof value.seconds === 'number') {
      return new Date(value.seconds * 1000);
    }
    
    // If it's a number (epoch milliseconds or seconds)
    if (typeof value === 'number') {
      // If it's in seconds (less than year 2100 in milliseconds)
      const date = value < 1e12 ? new Date(value * 1000) : new Date(value);
      return isNaN(date.getTime()) ? null : date;
    }
    
    // If it's a string
    if (typeof value === 'string') {
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date;
    }
  } catch {
    return null;
  }
  return null;
};

export const formatDate = (value: any) => {
  const date = normalizeToDate(value);
  if (!date) return 'Invalid Date';

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();

  return `${month}/${day}/${year}`;
};

// Readable date: "January 15, 2025"
export const fmtDate = (val: any): string => {
  const d = normalizeToDate(val);
  if (!d) return '—';
  return d.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

// Readable datetime: "Jan 15, 2025, 02:30 PM"
export const fmtDateTime = (val: any): string => {
  const d = normalizeToDate(val);
  if (!d) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Mask name for privacy: "Michael Garcia" → "M****** G*****"
export const maskName = (firstName?: string, lastName?: string): string => {
  const maskWord = (word: string) => {
    if (!word || word.length === 0) return '';
    if (word.length === 1) return word;
    return word[0] + '*'.repeat(word.length - 1);
  };
  const first = maskWord(firstName?.trim() || '');
  const last = maskWord(lastName?.trim() || '');
  if (!first && !last) return 'Unknown User';
  if (!last) return first;
  if (!first) return last;
  return `${first} ${last}`;
};

// Mask phone: "09171234567" → "09******567"
export const maskContact = (raw: any): string => {
  if (!raw) return '—';
  const digits = String(raw).replace(/[^0-9]/g, '');
  if (digits.length < 10) return String(raw);
  return digits.slice(0, 2) + '******' + digits.slice(-3);
};