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